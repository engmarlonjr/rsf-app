require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

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
/* Inicialização do servidor                                            */
/* ------------------------------------------------------------------ */
app.listen(PORT, function() {
  console.log('Servidor rodando na porta ' + PORT);
});

module.exports = app;
