import { test } from "node:test";
import assert from "node:assert/strict";

import { chamar, redigir } from "../src/http.mjs";
import { subirStub, configDoStub, TOKEN_FALSO } from "./stub.mjs";

test("envia o header Authorization: Bearer <token>", async () => {
  const stub = await subirStub(() => ({ status: 200, json: { clientes: [] } }));
  try {
    const r = await chamar(configDoStub(stub.baseUrl), { metodo: "GET", segmentos: ["clientes"] });
    assert.equal(r.ok, true);
    assert.equal(stub.recebidos[0].headers.authorization, `Bearer ${TOKEN_FALSO}`);
  } finally {
    await stub.fechar();
  }
});

test("monta a URL a partir da base, sem duplicar barra", async () => {
  const stub = await subirStub(() => ({ status: 200, json: {} }));
  try {
    await chamar(configDoStub(stub.baseUrl), { metodo: "GET", segmentos: ["posts", "abc"] });
    assert.equal(stub.recebidos[0].caminho, "/api/mcp/posts/abc");
  } finally {
    await stub.fechar();
  }
});

test("codifica segmentos de caminho — não dá para escapar da rota", async () => {
  const stub = await subirStub(() => ({ status: 200, json: {} }));
  try {
    await chamar(configDoStub(stub.baseUrl), {
      metodo: "GET",
      segmentos: ["posts", "../../admin/clientes"],
    });
    assert.equal(stub.recebidos[0].caminho, "/api/mcp/posts/..%2F..%2Fadmin%2Fclientes");
  } finally {
    await stub.fechar();
  }
});

test("query vazia ou nula não vira parâmetro", async () => {
  const stub = await subirStub(() => ({ status: 200, json: {} }));
  try {
    await chamar(configDoStub(stub.baseUrl), {
      metodo: "GET",
      segmentos: ["clientes"],
      query: { busca: "", outro: null, valido: "zone" },
    });
    const q = stub.recebidos[0].query;
    assert.equal(q.get("busca"), null);
    assert.equal(q.get("outro"), null);
    assert.equal(q.get("valido"), "zone");
  } finally {
    await stub.fechar();
  }
});

test("envia corpo JSON com Content-Type quando há corpo", async () => {
  const stub = await subirStub(() => ({ status: 201, json: { ok: true } }));
  try {
    await chamar(configDoStub(stub.baseUrl), {
      metodo: "POST",
      segmentos: ["posts"],
      corpo: { titulo: "x" },
    });
    const p = stub.recebidos[0];
    assert.equal(p.metodo, "POST");
    assert.match(p.headers["content-type"], /application\/json/);
    assert.deepEqual(p.corpo, { titulo: "x" });
  } finally {
    await stub.fechar();
  }
});

test("GET não manda Content-Type nem corpo", async () => {
  const stub = await subirStub(() => ({ status: 200, json: {} }));
  try {
    await chamar(configDoStub(stub.baseUrl), { metodo: "GET", segmentos: ["clientes"] });
    assert.equal(stub.recebidos[0].headers["content-type"], undefined);
  } finally {
    await stub.fechar();
  }
});

test("erro HTTP vira resultado, com o erro do servidor e sem o token", async () => {
  const stub = await subirStub(() => ({ status: 400, json: { erro: "titulo é obrigatório." } }));
  try {
    const r = await chamar(configDoStub(stub.baseUrl), { metodo: "POST", segmentos: ["posts"], corpo: {} });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.match(r.erro, /titulo é obrigatório/);
    assert.ok(!r.erro.includes(TOKEN_FALSO), "o token não pode aparecer no erro");
  } finally {
    await stub.fechar();
  }
});

test("401 traz dica de configuração e nenhum token", async () => {
  const stub = await subirStub(() => ({ status: 401, json: { erro: "Não autorizado." } }));
  try {
    const r = await chamar(configDoStub(stub.baseUrl), { metodo: "GET", segmentos: ["clientes"] });
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
    assert.match(r.erro, /POSTGROWTH_MCP_TOKEN/);
    assert.ok(!r.erro.includes(TOKEN_FALSO));
  } finally {
    await stub.fechar();
  }
});

test("se o servidor ecoar o token, ele é redigido antes de voltar ao modelo", async () => {
  const stub = await subirStub(() => ({
    status: 500,
    json: { erro: `falhou processando Bearer ${TOKEN_FALSO} agora` },
  }));
  try {
    const r = await chamar(configDoStub(stub.baseUrl), { metodo: "GET", segmentos: ["clientes"] });
    assert.ok(!r.erro.includes(TOKEN_FALSO), "o token vazou no erro");
    assert.match(r.erro, /\[REDIGIDO\]/);
  } finally {
    await stub.fechar();
  }
});

test("falha de rede vira resultado, não exceção", async () => {
  const config = configDoStub("http://127.0.0.1:1/api/mcp");
  const r = await chamar(config, { metodo: "GET", segmentos: ["clientes"] });
  assert.equal(r.ok, false);
  assert.equal(r.status, 0);
  assert.match(r.erro, /Falha de rede/);
  assert.ok(!r.erro.includes(TOKEN_FALSO));
});

test("pede redirect:'error' ao fetch — o Bearer não migra de host", async () => {
  let visto = null;
  const r = await chamar(
    configDoStub("https://exemplo.invalido/api/mcp"),
    { metodo: "GET", segmentos: ["clientes"] },
    {
      fetch: async (_url, init) => {
        visto = init;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    }
  );
  assert.equal(r.ok, true);
  assert.equal(visto.redirect, "error");
});

test("redirecionamento real é recusado, não seguido", async () => {
  // Um servidor que responde 302 para outro host: com redirect:"error" o fetch
  // falha e o shim devolve erro de rede, em vez de reenviar o Bearer adiante.
  const { createServer } = await import("node:http");
  const servidor = createServer((_req, res) => {
    res.writeHead(302, { location: "https://exemplo.invalido/roubado" });
    res.end();
  });
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  try {
    const base = `http://127.0.0.1:${servidor.address().port}/api/mcp`;
    const r = await chamar(configDoStub(base), { metodo: "GET", segmentos: ["clientes"] });
    assert.equal(r.ok, false);
    assert.match(r.erro, /Falha de rede/);
    assert.ok(!r.erro.includes(TOKEN_FALSO));
  } finally {
    await new Promise((ok) => servidor.close(ok));
  }
});

test("redigir troca todas as ocorrências e tolera token vazio", () => {
  assert.equal(redigir("a X b X c", "X"), "a [REDIGIDO] b [REDIGIDO] c");
  assert.equal(redigir("nada", ""), "nada");
  assert.equal(redigir(undefined, "X"), "");
});
