#!/usr/bin/env node
// Entrypoint do shim MCP do PostGrowth.
//
// Falha ao iniciar, com código != 0, se POSTGROWTH_MCP_TOKEN estiver ausente.
// Toda mensagem vai para stderr: stdout pertence ao protocolo JSON-RPC.

import { carregarConfig, ErroConfig } from "../src/config.mjs";
import { iniciar, VERSAO } from "../src/server.mjs";

const argumento = process.argv[2];

if (argumento === "--version" || argumento === "-v") {
  process.stdout.write(`${VERSAO}\n`);
  process.exit(0);
}

if (argumento === "--help" || argumento === "-h") {
  process.stdout.write(
    [
      `postgrowth-mcp ${VERSAO} — shim MCP do PostGrowth (transporte stdio)`,
      "",
      "Este programa não é feito para uso interativo. Ele é iniciado pelo seu",
      "cliente MCP (Claude Desktop ou Claude Code), que conversa com ele por stdio.",
      "",
      "Variáveis de ambiente:",
      "  POSTGROWTH_MCP_TOKEN       obrigatório. Token privado das rotas /api/mcp.",
      "  POSTGROWTH_MCP_BASE_URL    opcional. Padrão: produção.",
      "  POSTGROWTH_MCP_ALLOW_LOCAL opcional. 'true' libera host local (desenvolvimento).",
      "  POSTGROWTH_MCP_TIMEOUT_MS  opcional. Padrão: 30000.",
      "",
      "Ver README.md para a configuração no Claude Desktop e no Claude Code.",
      "",
    ].join("\n")
  );
  process.exit(0);
}

let config;
try {
  config = carregarConfig(process.env);
} catch (e) {
  if (e instanceof ErroConfig) {
    process.stderr.write(`postgrowth-mcp: erro de configuração\n${e.message}\n`);
    process.exit(1);
  }
  throw e;
}

try {
  await iniciar(config);
  // A URL é diagnóstico útil e não é segredo. O token nunca é impresso.
  process.stderr.write(`postgrowth-mcp ${VERSAO} pronto — ${config.baseUrl}\n`);
} catch (e) {
  process.stderr.write(`postgrowth-mcp: falha ao iniciar — ${e?.message ?? e}\n`);
  process.exit(1);
}
