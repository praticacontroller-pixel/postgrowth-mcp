// Handshake real: sobe o binário como processo filho e conversa JSON-RPC por
// stdio, como faria o Claude Desktop. Sem SDK do lado do cliente — se o
// protocolo na linha estiver errado, este teste quebra.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { subirStub, TOKEN_FALSO } from "./stub.mjs";

const BIN = fileURLToPath(new URL("../bin/postgrowth-mcp.mjs", import.meta.url));

function abrirCliente(env) {
  const proc = spawn(process.execPath, [BIN], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buffer = "";
  const pendentes = new Map();
  let stderr = "";

  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (pedaco) => {
    buffer += pedaco;
    let quebra;
    while ((quebra = buffer.indexOf("\n")) >= 0) {
      const linha = buffer.slice(0, quebra).trim();
      buffer = buffer.slice(quebra + 1);
      if (!linha) continue;
      const msg = JSON.parse(linha);
      const resolver = pendentes.get(msg.id);
      if (resolver) {
        pendentes.delete(msg.id);
        resolver(msg);
      }
    }
  });
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (p) => (stderr += p));

  let proximoId = 1;
  return {
    proc,
    get stderr() {
      return stderr;
    },
    pedir(method, params) {
      const id = proximoId++;
      const espera = new Promise((ok, falha) => {
        pendentes.set(id, ok);
        setTimeout(() => falha(new Error(`timeout esperando ${method}`)), 10_000).unref();
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      return espera;
    },
    notificar(method, params) {
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    },
    fechar() {
      proc.stdin.end();
      proc.kill();
    },
  };
}

test("initialize + tools/list devolvem as sete ferramentas", async () => {
  const stub = await subirStub(() => ({ status: 200, json: { clientes: [] } }));
  const cliente = abrirCliente({
    POSTGROWTH_MCP_TOKEN: TOKEN_FALSO,
    POSTGROWTH_MCP_BASE_URL: stub.baseUrl,
    POSTGROWTH_MCP_ALLOW_LOCAL: "true",
  });

  try {
    const init = await cliente.pedir("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "teste", version: "0" },
    });
    assert.equal(init.result.serverInfo.name, "postgrowth-mcp");
    assert.ok(init.result.capabilities.tools, "deveria anunciar capability de tools");

    cliente.notificar("notifications/initialized", {});

    const lista = await cliente.pedir("tools/list", {});
    const nomes = lista.result.tools.map((t) => t.name).sort();
    assert.deepEqual(nomes, [
      "atualizar_post",
      "consultar_post",
      "consultar_tarefa_clickup",
      "criar_post",
      "listar_clientes",
      "listar_posts_cliente",
      "subir_midia_clickup",
    ]);
    for (const t of lista.result.tools) {
      assert.equal(t.inputSchema.type, "object", `${t.name} sem inputSchema objeto`);
      assert.ok(t.description.length > 30, `${t.name} com descrição curta demais`);
    }
  } finally {
    cliente.fechar();
    await stub.fechar();
  }
});

test("tools/call de leitura chega na rota certa e devolve o JSON do servidor", async () => {
  const stub = await subirStub(() => ({
    status: 200,
    json: { clientes: [{ id: "abc", nome: "Zone Ti" }], total: 1 },
  }));
  const cliente = abrirCliente({
    POSTGROWTH_MCP_TOKEN: TOKEN_FALSO,
    POSTGROWTH_MCP_BASE_URL: stub.baseUrl,
    POSTGROWTH_MCP_ALLOW_LOCAL: "true",
  });

  try {
    await cliente.pedir("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "teste", version: "0" },
    });
    cliente.notificar("notifications/initialized", {});

    const r = await cliente.pedir("tools/call", {
      name: "listar_clientes",
      arguments: { busca: "zone" },
    });
    assert.ok(!r.result.isError, JSON.stringify(r.result));
    const payload = JSON.parse(r.result.content[0].text);
    assert.equal(payload.total, 1);
    assert.equal(stub.recebidos[0].caminho, "/api/mcp/clientes");
    assert.equal(stub.recebidos[0].query.get("busca"), "zone");
  } finally {
    cliente.fechar();
    await stub.fechar();
  }
});

test("erro do servidor vira isError com mensagem, sem derrubar a sessão nem vazar token", async () => {
  const stub = await subirStub(() => ({ status: 404, json: { erro: "Post não encontrado." } }));
  const cliente = abrirCliente({
    POSTGROWTH_MCP_TOKEN: TOKEN_FALSO,
    POSTGROWTH_MCP_BASE_URL: stub.baseUrl,
    POSTGROWTH_MCP_ALLOW_LOCAL: "true",
  });

  try {
    await cliente.pedir("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "teste", version: "0" },
    });
    cliente.notificar("notifications/initialized", {});

    const r = await cliente.pedir("tools/call", {
      name: "consultar_post",
      arguments: { post_id: "11111111-2222-4333-8444-555555555555" },
    });
    assert.equal(r.result.isError, true);
    assert.match(r.result.content[0].text, /Post não encontrado/);
    assert.ok(!r.result.content[0].text.includes(TOKEN_FALSO));

    // A sessão continua viva depois do erro.
    const lista = await cliente.pedir("tools/list", {});
    assert.equal(lista.result.tools.length, 7);

    assert.ok(!cliente.stderr.includes(TOKEN_FALSO), "o token apareceu no stderr");
  } finally {
    cliente.fechar();
    await stub.fechar();
  }
});

test("argumento obrigatório ausente é recusado antes de qualquer chamada HTTP", async () => {
  const stub = await subirStub(() => ({ status: 200, json: {} }));
  const cliente = abrirCliente({
    POSTGROWTH_MCP_TOKEN: TOKEN_FALSO,
    POSTGROWTH_MCP_BASE_URL: stub.baseUrl,
    POSTGROWTH_MCP_ALLOW_LOCAL: "true",
  });

  try {
    await cliente.pedir("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "teste", version: "0" },
    });
    cliente.notificar("notifications/initialized", {});

    const r = await cliente.pedir("tools/call", { name: "consultar_post", arguments: {} });
    assert.equal(r.result.isError, true);
    assert.match(r.result.content[0].text, /post_id/);
    assert.equal(stub.recebidos.length, 0, "não deveria ter chamado o servidor");
  } finally {
    cliente.fechar();
    await stub.fechar();
  }
});

test("sem POSTGROWTH_MCP_TOKEN o processo falha ao iniciar, com código != 0", async () => {
  const env = { ...process.env };
  delete env.POSTGROWTH_MCP_TOKEN;

  const proc = spawn(process.execPath, [BIN], { env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  let stdout = "";
  proc.stderr.on("data", (p) => (stderr += p));
  proc.stdout.on("data", (p) => (stdout += p));

  const codigo = await new Promise((ok) => proc.on("close", ok));

  assert.notEqual(codigo, 0, "deveria sair com código de erro");
  assert.match(stderr, /POSTGROWTH_MCP_TOKEN/);
  assert.equal(stdout, "", "stdout é do protocolo: nada pode ser escrito nele");
});

test("host local é bloqueado ao iniciar sem POSTGROWTH_MCP_ALLOW_LOCAL", async () => {
  const env = {
    ...process.env,
    POSTGROWTH_MCP_TOKEN: TOKEN_FALSO,
    POSTGROWTH_MCP_BASE_URL: "http://localhost:3000/api/mcp",
  };
  delete env.POSTGROWTH_MCP_ALLOW_LOCAL;

  const proc = spawn(process.execPath, [BIN], { env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", (p) => (stderr += p));
  const codigo = await new Promise((ok) => proc.on("close", ok));

  assert.notEqual(codigo, 0);
  assert.match(stderr, /local/i);
  assert.ok(!stderr.includes(TOKEN_FALSO), "o token apareceu no stderr");
});

test("--version não depende de token e não escreve no stderr", async () => {
  const env = { ...process.env };
  delete env.POSTGROWTH_MCP_TOKEN;

  const proc = spawn(process.execPath, [BIN, "--version"], { env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  proc.stdout.on("data", (p) => (stdout += p));
  const codigo = await new Promise((ok) => proc.on("close", ok));

  assert.equal(codigo, 0);
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
});
