require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

/* ------------------------------------------------------------------ */
/* Configuração do PostgreSQL                                           */
/* ------------------------------------------------------------------ */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/* ------------------------------------------------------------------ */
/* CORS — deve vir antes de todas as rotas                             */
/* ------------------------------------------------------------------ */
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

/* ------------------------------------------------------------------ */
/* Middlewares gerais                                                   */
/* ------------------------------------------------------------------ */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------------------------------------------------ */
/* Rota de saúde                                                        */
/* ------------------------------------------------------------------ */
app.get('/health', function(req, res) {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

/* ------------------------------------------------------------------ */
/* Rota raiz — serve o index.html                                       */
/* ------------------------------------------------------------------ */
app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ------------------------------------------------------------------ */
/* Configuração do Multer — armazenamento em memória                   */
/* ------------------------------------------------------------------ */
const upload = multer({ storage: multer.memoryStorage() });

/* ------------------------------------------------------------------ */
/* Cliente Anthropic                                                    */
/* ------------------------------------------------------------------ */
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: {
    'anthropic-beta': 'pdfs-2024-09-25'
  }
});

/* ------------------------------------------------------------------ */
/* Helper — remove blocos markdown antes do JSON.parse                 */
/* ------------------------------------------------------------------ */
function limparMarkdown(texto) {
  var limpo = texto.trim();
  limpo = limpo.replace(/^```json\s*/i, '');
  limpo = limpo.replace(/^```\s*/i, '');
  limpo = limpo.replace(/```\s*$/i, '');
  return limpo.trim();
}

/* ------------------------------------------------------------------ */
/* Helper — fecha arrays e objetos abertos em JSON truncado            */
/* ------------------------------------------------------------------ */
function repararJson(texto) {
  var t = texto;
  var abre     = (t.match(/\{/g) || []).length;
  var fecha    = (t.match(/\}/g) || []).length;
  var abreArr  = (t.match(/\[/g) || []).length;
  var fechaArr = (t.match(/\]/g) || []).length;
  var i;
  for (i = 0; i < abreArr - fechaArr; i++) { t += ']'; }
  for (i = 0; i < abre - fecha;     i++) { t += '}'; }
  return t;
}

/* ------------------------------------------------------------------ */
/* Helper — converte Buffer em bloco de documento PDF para a API       */
/* ------------------------------------------------------------------ */
function bufferParaDocumento(buffer) {
  return {
    type: 'document',
    source: {
      type: 'base64',
      media_type: 'application/pdf',
      data: buffer.toString('base64')
    }
  };
}

/* ------------------------------------------------------------------ */
/* Chamada 1 — Edital (Haiku, 1024 tokens)                             */
/* ------------------------------------------------------------------ */
async function analisarEdital(arquivoBuffer) {
  var schema = JSON.stringify({
    objeto:               'descrição em até 150 chars',
    contratante:          'nome do órgão',
    modalidade:           'ex: Pregão Eletrônico',
    valor_estimado:       0.00,
    prazo_execucao:       'ex: 12 meses',
    fonte_recursos:       'ex: Tesouro Municipal',
    prazo_pagamento:      'ex: 30 dias após medição',
    regime_execucao:      'ex: Empreitada por Preço Global',
    garantia_contratual:  'ex: 5% do valor',
    habilitacao_tecnica:  'resumo em até 150 chars'
  }, null, 2);

  var mensagem = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          bufferParaDocumento(arquivoBuffer),
          {
            type: 'text',
            text: 'Analise o edital e retorne APENAS este JSON, sem texto adicional:\n' + schema
          }
        ]
      }
    ]
  });

  var textoResposta = mensagem.content[0].text;
  return JSON.parse(repararJson(limparMarkdown(textoResposta)));
}

/* ------------------------------------------------------------------ */
/* Chamada 2 — Técnico (Sonnet, 4096 tokens)                           */
/* ------------------------------------------------------------------ */
async function analisarTecnico(arquivosBuffer) {
  var schema = JSON.stringify({
    escopo:         'descrição em até 300 chars',
    localizacao:    'endereço ou cidade/UF',
    tipo_construcao: 'ex: Construção de salas de aula',
    servicos: [
      { codigo: '...', descricao: '...', unidade: '...', quantidade: 0, preco_unitario: 0.00, total: 0.00 }
    ],
    cronograma: [
      { mes: 1, percentual_fisico: 0.0, percentual_financeiro: 0.0 }
    ],
    encargos_sociais: { total_percentual: 0.0, composicao: 'resumo em até 150 chars' }
  }, null, 2);

  var instrucao =
    'Analise os documentos técnicos e retorne APENAS este JSON:\n' + schema + '\n' +
    'Regras: inclua no máximo os 20 serviços de maior valor total. ' +
    'Inclua apenas os meses reais do cronograma. Sem texto fora do JSON.';

  var conteudo = arquivosBuffer.map(bufferParaDocumento);
  conteudo.push({ type: 'text', text: instrucao });

  var mensagem = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: conteudo
      }
    ]
  });

  var textoResposta = mensagem.content[0].text;
  return JSON.parse(repararJson(limparMarkdown(textoResposta)));
}

/* ------------------------------------------------------------------ */
/* Chamada 3 — Financeiro (Sonnet, 4096 tokens)                        */
/* ------------------------------------------------------------------ */
async function analisarFinanceiro(arquivosBuffer) {
  var schema = JSON.stringify({
    valor_total:  0.00,
    custo_direto: 0.00,
    bdi: {
      percentual_total:        0.0,
      administracao_central:   0.0,
      seguro_garantia:         0.0,
      despesas_financeiras:    0.0,
      lucro:                   0.0,
      tributos:                0.0
    },
    curva_abc: [
      { posicao: 1, descricao: '...', valor: 0.00, percentual: 0.0, percentual_acumulado: 0.0 }
    ]
  }, null, 2);

  var instrucao =
    'Analise os documentos financeiros e retorne APENAS este JSON:\n' + schema + '\n' +
    'Regras: curva_abc deve conter no máximo 20 itens de maior valor. Sem texto fora do JSON.';

  var conteudo = arquivosBuffer.map(bufferParaDocumento);
  conteudo.push({ type: 'text', text: instrucao });

  var mensagem = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: conteudo
      }
    ]
  });

  var textoResposta = mensagem.content[0].text;
  return JSON.parse(repararJson(limparMarkdown(textoResposta)));
}

/* ------------------------------------------------------------------ */
/* POST /analisar — recebe os PDFs e executa as 3 chamadas             */
/* ------------------------------------------------------------------ */
app.post(
  '/analisar',
  upload.fields([
    { name: 'edital',      maxCount: 1  },
    { name: 'tecnicos',    maxCount: 10 },
    { name: 'financeiros', maxCount: 10 }
  ]),
  async function(req, res) {
    try {
      var arquivosEdital      = req.files['edital']      || [];
      var arquivosTecnicos    = req.files['tecnicos']    || [];
      var arquivosFinanceiros = req.files['financeiros'] || [];

      if (arquivosEdital.length === 0) {
        return res.status(400).json({ erro: 'O arquivo do edital é obrigatório.' });
      }

      var bufferEdital      = arquivosEdital[0].buffer;
      var buffersTecnicos   = arquivosTecnicos.map(function(f) { return f.buffer; });
      var buffersFinanceiros = arquivosFinanceiros.map(function(f) { return f.buffer; });

      /* Executa as 3 chamadas sequencialmente */
      var resultadoEdital     = await analisarEdital(bufferEdital);
      var resultadoTecnico    = buffersTecnicos.length > 0
        ? await analisarTecnico(buffersTecnicos)
        : null;
      var resultadoFinanceiro = buffersFinanceiros.length > 0
        ? await analisarFinanceiro(buffersFinanceiros)
        : null;

      res.json({
        edital:     resultadoEdital,
        tecnico:    resultadoTecnico,
        financeiro: resultadoFinanceiro
      });

    } catch (erro) {
      res.status(500).json({
        erro:      'Falha ao processar os documentos.',
        detalhe:   erro.message
      });
    }
  }
);

/* ------------------------------------------------------------------ */
/* Inicialização do servidor                                            */
/* ------------------------------------------------------------------ */
app.listen(PORT, function() {
  console.log('Servidor rodando na porta ' + PORT);
});

module.exports = app;
