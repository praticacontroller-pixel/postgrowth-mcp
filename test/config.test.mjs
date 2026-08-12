import { test } from "node:test";
import assert from "node:assert/strict";

import { carregarConfig, ErroConfig, BASE_URL_PADRAO } from "../src/config.mjs";

const TOKEN = "token-de-teste";

test("falha quando POSTGROWTH_MCP_TOKEN está ausente", () => {
  assert.throws(() => carregarConfig({}), ErroConfig);
});

test("falha quando POSTGROWTH_MCP_TOKEN está vazio ou só com espaços", () => {
  assert.throws(() => carregarConfig({ POSTGROWTH_MCP_TOKEN: "" }), ErroConfig);
  assert.throws(() => carregarConfig({ POSTGROWTH_MCP_TOKEN: "   " }), ErroConfig);
});

test("a mensagem de erro de token ausente não contém valor de token", () => {
  try {
    carregarConfig({ POSTGROWTH_MCP_TOKEN: "" });
    assert.fail("deveria ter lançado");
  } catch (e) {
    assert.match(e.message, /POSTGROWTH_MCP_TOKEN/);
    assert.doesNotMatch(e.message, /Bearer/);
  }
});

test("base URL usa o padrão de produção quando não informada", () => {
  const c = carregarConfig({ POSTGROWTH_MCP_TOKEN: TOKEN });
  assert.equal(c.baseUrl, BASE_URL_PADRAO);
});

test("base URL vazia cai no padrão de produção", () => {
  const c = carregarConfig({ POSTGROWTH_MCP_TOKEN: TOKEN, POSTGROWTH_MCP_BASE_URL: "  " });
  assert.equal(c.baseUrl, BASE_URL_PADRAO);
});

test("barra final da base URL é removida", () => {
  const c = carregarConfig({
    POSTGROWTH_MCP_TOKEN: TOKEN,
    POSTGROWTH_MCP_BASE_URL: "https://postgrowth.vercel.app/api/mcp///",
  });
  assert.equal(c.baseUrl, BASE_URL_PADRAO);
});

test("localhost é bloqueado por padrão", () => {
  for (const host of [
    "http://localhost:3000/api/mcp",
    "https://localhost/api/mcp",
    "http://127.0.0.1:3000/api/mcp",
    "https://app.localhost/api/mcp",
    "http://[::1]:3000/api/mcp",
  ]) {
    assert.throws(
      () => carregarConfig({ POSTGROWTH_MCP_TOKEN: TOKEN, POSTGROWTH_MCP_BASE_URL: host }),
      ErroConfig,
      `deveria bloquear ${host}`
    );
  }
});

test("rede interna e metadados de nuvem são bloqueados por padrão", () => {
  for (const host of [
    "https://10.0.0.5/api/mcp",
    "https://192.168.1.10/api/mcp",
    "https://172.16.3.4/api/mcp",
    "https://169.254.169.254/api/mcp",
  ]) {
    assert.throws(
      () => carregarConfig({ POSTGROWTH_MCP_TOKEN: TOKEN, POSTGROWTH_MCP_BASE_URL: host }),
      ErroConfig,
      `deveria bloquear ${host}`
    );
  }
});

test("POSTGROWTH_MCP_ALLOW_LOCAL=true libera localhost", () => {
  const c = carregarConfig({
    POSTGROWTH_MCP_TOKEN: TOKEN,
    POSTGROWTH_MCP_BASE_URL: "http://127.0.0.1:3000/api/mcp",
    POSTGROWTH_MCP_ALLOW_LOCAL: "true",
  });
  assert.equal(c.baseUrl, "http://127.0.0.1:3000/api/mcp");
  assert.equal(c.permiteLocal, true);
});

test("só a string exata 'true' libera local — 'TRUE', '1' e 'sim' não valem", () => {
  for (const valor of ["TRUE", "1", "sim", "yes", "True"]) {
    assert.throws(
      () =>
        carregarConfig({
          POSTGROWTH_MCP_TOKEN: TOKEN,
          POSTGROWTH_MCP_BASE_URL: "http://localhost:3000/api/mcp",
          POSTGROWTH_MCP_ALLOW_LOCAL: valor,
        }),
      ErroConfig,
      `'${valor}' não deveria liberar`
    );
  }
});

test("http em host remoto é recusado (o token não trafega em claro)", () => {
  assert.throws(
    () =>
      carregarConfig({
        POSTGROWTH_MCP_TOKEN: TOKEN,
        POSTGROWTH_MCP_BASE_URL: "http://postgrowth.vercel.app/api/mcp",
      }),
    ErroConfig
  );
});

test("URL inválida e protocolo não-HTTP são recusados", () => {
  assert.throws(
    () => carregarConfig({ POSTGROWTH_MCP_TOKEN: TOKEN, POSTGROWTH_MCP_BASE_URL: "isto-nao-e-url" }),
    ErroConfig
  );
  assert.throws(
    () =>
      carregarConfig({ POSTGROWTH_MCP_TOKEN: TOKEN, POSTGROWTH_MCP_BASE_URL: "file:///etc/passwd" }),
    ErroConfig
  );
});

test("timeout tem padrão e valida entrada", () => {
  assert.equal(carregarConfig({ POSTGROWTH_MCP_TOKEN: TOKEN }).timeoutMs, 30_000);
  assert.equal(
    carregarConfig({ POSTGROWTH_MCP_TOKEN: TOKEN, POSTGROWTH_MCP_TIMEOUT_MS: "5000" }).timeoutMs,
    5000
  );
  assert.throws(
    () => carregarConfig({ POSTGROWTH_MCP_TOKEN: TOKEN, POSTGROWTH_MCP_TIMEOUT_MS: "-1" }),
    ErroConfig
  );
  assert.throws(
    () => carregarConfig({ POSTGROWTH_MCP_TOKEN: TOKEN, POSTGROWTH_MCP_TIMEOUT_MS: "abc" }),
    ErroConfig
  );
});
