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
  apiKey: process.env.ANTHROPIC_API_KEY
});

/* ------------------------------------------------------------------ */
/* Helper — remove blocos markdown antes do JSON.parse                 */
/* ------------------------------------------------------------------ */
function limparMarkdown(texto) {
  return texto
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
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
  var mensagem = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    betas: ['pdfs-2024-09-25'],
    messages: [
      {
        role: 'user',
        content: [
          bufferParaDocumento(arquivoBuffer),
          {
            type: 'text',
            text: [
              'Analise o edital em anexo e extraia as informações a seguir.',
              'Retorne SOMENTE um JSON válido, sem markdown, sem texto adicional.',
              'Estrutura obrigatória:',
              '{',
              '  "objeto": "descrição do objeto",',
              '  "contratante": "nome do órgão contratante",',
              '  "modalidade": "modalidade da licitação",',
              '  "prazo": "prazo de execução",',
              '  "valor_estimado": "valor estimado da contratação",',
              '  "fonte_recursos": "fonte de recursos",',
              '  "condicoes_pagamento": "condições de pagamento",',
              '  "prazo_recebimento": "prazo para recebimento das propostas",',
              '  "penalidades": "penalidades previstas",',
              '  "habilitacao_exigida": "documentos de habilitação exigidos"',
              '}'
            ].join('\n')
          }
        ]
      }
    ]
  });

  var textoResposta = mensagem.content[0].text;
  return JSON.parse(limparMarkdown(textoResposta));
}

/* ------------------------------------------------------------------ */
/* Chamada 2 — Técnico (Sonnet, 4096 tokens)                           */
/* ------------------------------------------------------------------ */
async function analisarTecnico(arquivosBuffer) {
  var conteudo = arquivosBuffer.map(bufferParaDocumento);

  conteudo.push({
    type: 'text',
    text: [
      'Analise os documentos técnicos em anexo e extraia as informações a seguir.',
      'Retorne SOMENTE um JSON válido, sem markdown, sem texto adicional.',
      'Estrutura obrigatória:',
      '{',
      '  "escopo_detalhado": "descrição completa do escopo de serviços",',
      '  "lista_servicos": [',
      '    {',
      '      "codigo": "código do serviço",',
      '      "descricao": "descrição do serviço",',
      '      "unidade": "unidade de medida",',
      '      "quantidade": "quantidade",',
      '      "preco_unitario": "preço unitário",',
      '      "total": "valor total"',
      '    }',
      '  ],',
      '  "cronograma_fisico": [',
      '    {',
      '      "mes": "número do mês",',
      '      "atividades": "atividades previstas para o mês",',
      '      "percentual": "percentual de execução"',
      '    }',
      '  ],',
      '  "composicoes_preco": "descrição das composições de preço encontradas",',
      '  "encargos_sociais": "percentual e composição dos encargos sociais"',
      '}'
    ].join('\n')
  });

  var mensagem = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    betas: ['pdfs-2024-09-25'],
    messages: [
      {
        role: 'user',
        content: conteudo
      }
    ]
  });

  var textoResposta = mensagem.content[0].text;
  return JSON.parse(limparMarkdown(textoResposta));
}

/* ------------------------------------------------------------------ */
/* Chamada 3 — Financeiro (Sonnet, 3000 tokens)                        */
/* ------------------------------------------------------------------ */
async function analisarFinanceiro(arquivosBuffer) {
  var conteudo = arquivosBuffer.map(bufferParaDocumento);

  conteudo.push({
    type: 'text',
    text: [
      'Analise os documentos financeiros em anexo e extraia as informações a seguir.',
      'Retorne SOMENTE um JSON válido, sem markdown, sem texto adicional.',
      'Estrutura obrigatória:',
      '{',
      '  "planilha_orcamentaria": [',
      '    {',
      '      "item": "número do item",',
      '      "descricao": "descrição do item",',
      '      "unidade": "unidade de medida",',
      '      "quantidade": "quantidade",',
      '      "preco_unitario": "preço unitário",',
      '      "total": "valor total"',
      '    }',
      '  ],',
      '  "composicao_bdi": {',
      '    "total_percentual": "percentual total do BDI",',
      '    "componentes": [',
      '      {',
      '        "nome": "nome do componente",',
      '        "percentual": "percentual do componente"',
      '      }',
      '    ]',
      '  },',
      '  "curva_abc": {',
      '    "servicos": [',
      '      {',
      '        "classificacao": "A, B ou C",',
      '        "descricao": "descrição do serviço",',
      '        "valor": "valor",',
      '        "percentual_acumulado": "percentual acumulado"',
      '      }',
      '    ],',
      '    "insumos": [',
      '      {',
      '        "classificacao": "A, B ou C",',
      '        "descricao": "descrição do insumo",',
      '        "valor": "valor",',
      '        "percentual_acumulado": "percentual acumulado"',
      '      }',
      '    ]',
      '  }',
      '}'
    ].join('\n')
  });

  var mensagem = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    betas: ['pdfs-2024-09-25'],
    messages: [
      {
        role: 'user',
        content: conteudo
      }
    ]
  });

  var textoResposta = mensagem.content[0].text;
  return JSON.parse(limparMarkdown(textoResposta));
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
