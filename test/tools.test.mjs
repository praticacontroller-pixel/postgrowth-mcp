import { test } from "node:test";
import assert from "node:assert/strict";

import { FERRAMENTAS, POR_NOME } from "../src/tools.mjs";
import { subirStub, configDoStub } from "./stub.mjs";

const NOMES_ESPERADOS = [
  "listar_clientes",
  "listar_posts_cliente",
  "consultar_post",
  "criar_post",
  "atualizar_post",
  "consultar_tarefa_clickup",
  "subir_midia_clickup",
  "subir_midia_arquivos",
];

const UUID_CLIENTE = "11111111-2222-4333-8444-555555555555";
const UUID_POST = "99999999-8888-4777-8666-555555555555";

test("expõe exatamente as oito ferramentas acordadas", () => {
  assert.deepEqual(
    FERRAMENTAS.map((f) => f.name).sort(),
    [...NOMES_ESPERADOS].sort()
  );
});

test("nenhuma ferramenta genérica de fetch, URL, SQL ou proxy", () => {
  const proibidos = /(^|_)(fetch|http|request|proxy|sql|query|consulta_sql|executar|eval|url|endpoint|rota|path)(_|$)/i;
  for (const f of FERRAMENTAS) {
    assert.ok(!proibidos.test(f.name), `nome suspeito: ${f.name}`);
    for (const campo of Object.keys(f.inputSchema.properties ?? {})) {
      assert.ok(
        !["url", "path", "caminho", "endpoint", "rota", "sql", "query", "metodo", "method", "headers"].includes(
          campo
        ),
        `${f.name} expõe campo genérico perigoso: ${campo}`
      );
    }
    // Schema fechado: o modelo não pode enfiar campo que não declaramos.
    assert.equal(f.inputSchema.additionalProperties, false, `${f.name} deveria ter schema fechado`);
  }
});

test("nenhum schema aceita campo derivado de status ou aprovação", () => {
  const derivados = [
    "status",
    "status_texto",
    "aprovado_em",
    "design_enviado_em",
    "ghl_post_id",
    "ghl_status",
  ];
  for (const f of FERRAMENTAS) {
    for (const campo of Object.keys(f.inputSchema.properties ?? {})) {
      assert.ok(!derivados.includes(campo), `${f.name} aceita campo derivado: ${campo}`);
    }
  }
});

test("clickup_task_id só aparece como entrada nas ferramentas de ClickUp/mídia", () => {
  for (const f of FERRAMENTAS) {
    const temCampo = "clickup_task_id" in (f.inputSchema.properties ?? {});
    const permitido = f.name === "consultar_tarefa_clickup" || f.name === "subir_midia_clickup";
    assert.equal(temCampo, permitido, `${f.name}: clickup_task_id em lugar indevido`);
  }
});

test("subir_midia_clickup está marcada como destrutiva e descreve o risco", () => {
  const f = POR_NOME.get("subir_midia_clickup");
  assert.equal(f.annotations.destructiveHint, true);
  assert.equal(f.annotations.readOnlyHint, false);
  assert.match(f.description, /IRREVERSÍVEL/);
  assert.match(f.description, /CONFIRMAÇÃO EXPLÍCITA/i);
  assert.match(f.description, /ROI SENSEI/);
  assert.match(f.description, /NUNCA use em lote/i);
  assert.equal(f.inputSchema.properties.confirmar_substituicao.default, false);
  assert.deepEqual(f.inputSchema.required, ["clickup_task_id", "cliente_id"]);
});

test("as ferramentas de leitura estão marcadas como readOnly", () => {
  for (const nome of ["listar_clientes", "listar_posts_cliente", "consultar_post", "consultar_tarefa_clickup"]) {
    assert.equal(POR_NOME.get(nome).annotations.readOnlyHint, true, nome);
  }
});

// --- cada ferramenta chama a rota certa -------------------------------------

const CASOS = [
  {
    nome: "listar_clientes",
    args: { busca: "zone" },
    metodo: "GET",
    caminho: "/api/mcp/clientes",
    confereQuery: (q) => assert.equal(q.get("busca"), "zone"),
  },
  {
    nome: "listar_posts_cliente",
    args: { cliente_id: UUID_CLIENTE },
    metodo: "GET",
    caminho: `/api/mcp/clientes/${UUID_CLIENTE}/posts`,
  },
  {
    nome: "consultar_post",
    args: { post_id: UUID_POST },
    metodo: "GET",
    caminho: `/api/mcp/posts/${UUID_POST}`,
  },
  {
    nome: "criar_post",
    args: {
      cliente_id: UUID_CLIENTE,
      tipo: "carrossel",
      titulo: "Post de teste",
      legenda: "legenda",
      data_programada: "2026-09-01",
      horario_programado: "18:30",
      roteiro: ["slide 1", "slide 2"],
    },
    metodo: "POST",
    caminho: "/api/mcp/posts",
    confereCorpo: (c) => {
      assert.deepEqual(c, {
        cliente_id: UUID_CLIENTE,
        tipo: "carrossel",
        titulo: "Post de teste",
        legenda: "legenda",
        data_programada: "2026-09-01",
        horario_programado: "18:30",
        roteiro: ["slide 1", "slide 2"],
      });
    },
  },
  {
    nome: "atualizar_post",
    args: { post_id: UUID_POST, legenda: "nova legenda" },
    metodo: "PATCH",
    caminho: `/api/mcp/posts/${UUID_POST}`,
    confereCorpo: (c) => {
      // Só o campo enviado entra no corpo: o resto do post fica intacto.
      assert.deepEqual(c, { legenda: "nova legenda" });
    },
  },
  {
    nome: "consultar_tarefa_clickup",
    args: { clickup_task_id: "abc123" },
    metodo: "GET",
    caminho: "/api/mcp/clickup/tarefa/abc123",
  },
  {
    nome: "subir_midia_clickup",
    args: { clickup_task_id: "abc123", cliente_id: UUID_CLIENTE },
    metodo: "POST",
    caminho: "/api/mcp/midias",
    confereCorpo: (c) => {
      assert.deepEqual(c, {
        clickup_task_id: "abc123",
        cliente_id: UUID_CLIENTE,
        confirmar_substituicao: false,
      });
    },
  },
];

for (const caso of CASOS) {
  test(`${caso.nome} chama ${caso.metodo} ${caso.caminho}`, async () => {
    const stub = await subirStub(() => ({ status: 200, json: { ok: true } }));
    try {
      const r = await POR_NOME.get(caso.nome).executar(caso.args, configDoStub(stub.baseUrl));
      assert.equal(r.ok, true, r.erro);
      assert.equal(stub.recebidos.length, 1, "deveria fazer exatamente uma chamada");
      const p = stub.recebidos[0];
      assert.equal(p.metodo, caso.metodo);
      assert.equal(p.caminho, caso.caminho);
      caso.confereQuery?.(p.query);
      caso.confereCorpo?.(p.corpo);
    } finally {
      await stub.fechar();
    }
  });
}

test("listar_clientes sem busca não manda parâmetro", async () => {
  const stub = await subirStub(() => ({ status: 200, json: { clientes: [] } }));
  try {
    await POR_NOME.get("listar_clientes").executar({}, configDoStub(stub.baseUrl));
    assert.equal(stub.recebidos[0].query.get("busca"), null);
  } finally {
    await stub.fechar();
  }
});

test("confirmar_substituicao só é true com o booleano true — string 'true' não vale", async () => {
  for (const valor of ["true", 1, "sim", "yes", {}]) {
    const stub = await subirStub(() => ({ status: 200, json: { ok: true } }));
    try {
      await POR_NOME.get("subir_midia_clickup").executar(
        { clickup_task_id: "abc", cliente_id: UUID_CLIENTE, confirmar_substituicao: valor },
        configDoStub(stub.baseUrl)
      );
      assert.equal(
        stub.recebidos[0].corpo.confirmar_substituicao,
        false,
        `coerção aceita para ${JSON.stringify(valor)}`
      );
    } finally {
      await stub.fechar();
    }
  }
});

test("confirmar_substituicao: true é repassado como true", async () => {
  const stub = await subirStub(() => ({ status: 200, json: { ok: true } }));
  try {
    await POR_NOME.get("subir_midia_clickup").executar(
      { clickup_task_id: "abc", cliente_id: UUID_CLIENTE, confirmar_substituicao: true },
      configDoStub(stub.baseUrl)
    );
    assert.equal(stub.recebidos[0].corpo.confirmar_substituicao, true);
  } finally {
    await stub.fechar();
  }
});

test("atualizar_post sem nenhum campo manda corpo vazio e deixa o servidor recusar", async () => {
  // A regra "envie ao menos um campo" é do PostGrowth (lib/mcpSchemas.ts). O
  // shim não a duplica — só garante que a chamada chega lá para ser recusada.
  const stub = await subirStub(() => ({ status: 400, json: { erro: "Nada a atualizar." } }));
  try {
    const r = await POR_NOME.get("atualizar_post").executar(
      { post_id: UUID_POST },
      configDoStub(stub.baseUrl)
    );
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.deepEqual(stub.recebidos[0].corpo, {});
  } finally {
    await stub.fechar();
  }
});

// --- subir_midia_arquivos ---------------------------------------------------

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function pastaComArquivos(arquivos) {
  const dir = await mkdtemp(path.join(tmpdir(), "pg-mcp-"));
  const caminhos = [];
  for (const [nome, bytes] of arquivos) {
    const c = path.join(dir, nome);
    await writeFile(c, bytes);
    caminhos.push(c);
  }
  return { dir, caminhos, limpar: () => rm(dir, { recursive: true, force: true }) };
}

test("subir_midia_arquivos está marcada como destrutiva e descreve o risco", () => {
  const f = POR_NOME.get("subir_midia_arquivos");
  assert.equal(f.annotations.destructiveHint, true);
  assert.match(f.description, /CONFIRMAÇÃO EXPLÍCITA/i);
  assert.match(f.description, /NUNCA use em lote/i);
  assert.match(f.description, /sem passar pelo ClickUp/i);
  assert.equal(f.inputSchema.properties.confirmar_substituicao.default, false);
  assert.deepEqual(f.inputSchema.required, ["post_id", "cliente_id", "arquivos"]);
});

test("subir_midia_arquivos: sobe um arquivo por requisição e grava as URLs na ordem", async () => {
  const pasta = await pastaComArquivos([
    ["slide-1.png", Buffer.from("png-um")],
    ["slide-2.jpg", Buffer.from("jpg-dois")],
  ]);
  let n = 0;
  const stub = await subirStub((p) =>
    p.caminho.endsWith("/midias/arquivo")
      ? { status: 200, json: { ok: true, url: `https://cdn.x/${++n}` } }
      : { status: 200, json: { ok: true, anexadas: p.corpo.urls } }
  );
  try {
    const r = await POR_NOME.get("subir_midia_arquivos").executar(
      { post_id: UUID_POST, cliente_id: UUID_CLIENTE, arquivos: pasta.caminhos },
      configDoStub(stub.baseUrl)
    );
    assert.equal(r.ok, true, r.erro);
    assert.equal(stub.recebidos.length, 3);

    const [a, b, gravar] = stub.recebidos;
    for (const up of [a, b]) {
      assert.equal(up.metodo, "POST");
      assert.equal(up.caminho, `/api/mcp/posts/${UUID_POST}/midias/arquivo`);
      assert.match(up.headers["content-type"], /^multipart\/form-data; boundary=/);
      assert.match(String(up.corpo), new RegExp(UUID_CLIENTE));
    }
    assert.match(String(a.corpo), /slide-1\.png/);
    assert.match(String(a.corpo), /image\/png/);
    assert.match(String(b.corpo), /slide-2\.jpg/);
    assert.match(String(b.corpo), /image\/jpeg/);

    assert.equal(gravar.caminho, `/api/mcp/posts/${UUID_POST}/midias`);
    assert.deepEqual(gravar.corpo, {
      cliente_id: UUID_CLIENTE,
      urls: ["https://cdn.x/1", "https://cdn.x/2"],
      confirmar_substituicao: false,
    });
  } finally {
    await stub.fechar();
    await pasta.limpar();
  }
});

test("subir_midia_arquivos: arquivo inválido na lista → nada é enviado", async () => {
  const pasta = await pastaComArquivos([
    ["ok.png", Buffer.from("x")],
    ["planilha.xlsx", Buffer.from("x")],
  ]);
  const stub = await subirStub(() => ({ status: 200, json: { ok: true, url: "https://cdn.x/1" } }));
  try {
    const r = await POR_NOME.get("subir_midia_arquivos").executar(
      { post_id: UUID_POST, cliente_id: UUID_CLIENTE, arquivos: [...pasta.caminhos, "/nao/existe.png", "relativo.png"] },
      configDoStub(stub.baseUrl)
    );
    assert.equal(r.ok, false);
    assert.match(r.erro, /Nada foi enviado/);
    assert.match(r.erro, /planilha\.xlsx/);
    assert.match(r.erro, /não encontrado/);
    assert.match(r.erro, /caminho completo/);
    assert.equal(stub.recebidos.length, 0, "não deveria ter chamado o servidor");
  } finally {
    await stub.fechar();
    await pasta.limpar();
  }
});

test("subir_midia_arquivos: arquivo acima do limite da Vercel é recusado antes de enviar", async () => {
  const pasta = await pastaComArquivos([["grande.png", Buffer.alloc(4_400_001)]]);
  const stub = await subirStub(() => ({ status: 200, json: { ok: true } }));
  try {
    const r = await POR_NOME.get("subir_midia_arquivos").executar(
      { post_id: UUID_POST, cliente_id: UUID_CLIENTE, arquivos: pasta.caminhos },
      configDoStub(stub.baseUrl)
    );
    assert.equal(r.ok, false);
    assert.match(r.erro, /limite por arquivo/);
    assert.equal(stub.recebidos.length, 0);
  } finally {
    await stub.fechar();
    await pasta.limpar();
  }
});

test("subir_midia_arquivos: falha no meio não grava o post e avisa quantos já subiram", async () => {
  const pasta = await pastaComArquivos([
    ["1.png", Buffer.from("a")],
    ["2.png", Buffer.from("b")],
  ]);
  let n = 0;
  const stub = await subirStub(() =>
    ++n === 1
      ? { status: 200, json: { ok: true, url: "https://cdn.x/1" } }
      : { status: 502, json: { erro: "ROI fora do ar" } }
  );
  try {
    const r = await POR_NOME.get("subir_midia_arquivos").executar(
      { post_id: UUID_POST, cliente_id: UUID_CLIENTE, arquivos: pasta.caminhos },
      configDoStub(stub.baseUrl)
    );
    assert.equal(r.ok, false);
    assert.match(r.erro, /arquivo 2/);
    assert.match(r.erro, /post NÃO foi alterado/);
    assert.equal(stub.recebidos.length, 2, "não deveria ter chamado a gravação");
  } finally {
    await stub.fechar();
    await pasta.limpar();
  }
});

test("subir_midia_arquivos: confirmar_substituicao só com o booleano true", async () => {
  const pasta = await pastaComArquivos([["1.png", Buffer.from("a")]]);
  for (const [valor, esperado] of [["true", "false"], [true, "true"]]) {
    const stub = await subirStub((p) =>
      p.caminho.endsWith("/arquivo") ? { status: 200, json: { url: "https://cdn.x/1" } } : { status: 200, json: {} }
    );
    try {
      await POR_NOME.get("subir_midia_arquivos").executar(
        { post_id: UUID_POST, cliente_id: UUID_CLIENTE, arquivos: pasta.caminhos, confirmar_substituicao: valor },
        configDoStub(stub.baseUrl)
      );
      assert.match(
        String(stub.recebidos[0].corpo),
        new RegExp(`name="confirmar_substituicao"\\r\\n\\r\\n${esperado}`)
      );
      assert.equal(stub.recebidos[1].corpo.confirmar_substituicao, esperado === "true");
    } finally {
      await stub.fechar();
    }
  }
  await pasta.limpar();
});
