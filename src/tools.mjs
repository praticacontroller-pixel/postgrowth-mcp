// As sete ferramentas. Cada uma amarrada a UMA rota específica.
//
// O que este arquivo deliberadamente NÃO faz:
//
//   - não valida regra de negócio (quem valida é o PostGrowth, em
//     lib/mcpSchemas.ts e nas server actions; duplicar aqui criaria um segundo
//     caminho que pode divergir do primeiro);
//   - não expõe ferramenta genérica de fetch, de URL ou de SQL;
//   - não monta caminho a partir de texto livre do modelo — só de argumentos
//     nomeados, codificados em http.mjs.
//
// Os campos derivados (`status`, `status_texto`, `aprovado_em`,
// `clickup_task_id` em escrita de post…) não aparecem em schema nenhum. Se o
// modelo insistir em mandá-los, o servidor recusa com 400 — o que é o
// comportamento certo: o erro chega ao modelo em vez de ser engolido.

import { chamar } from "./http.mjs";

const UUID_DESC = "UUID do registro, exatamente como devolvido pelas ferramentas de listagem.";

/** @type {Array<{name:string,description:string,inputSchema:object,annotations?:object,executar:Function}>} */
export const FERRAMENTAS = [
  {
    name: "listar_clientes",
    description:
      "Lista os clientes cadastrados no PostGrowth, opcionalmente filtrando por nome. " +
      "Somente leitura. Use para descobrir o cliente_id antes de qualquer outra ferramenta. " +
      "Nunca devolve tokens nem credenciais do cliente.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        busca: {
          type: "string",
          description: "Trecho do nome do cliente. Omita para listar todos.",
        },
      },
      additionalProperties: false,
    },
    executar: (args, config) =>
      chamar(config, { metodo: "GET", segmentos: ["clientes"], query: { busca: args.busca } }),
  },

  {
    name: "listar_posts_cliente",
    description:
      "Lista os posts de um cliente, com status de aprovação de texto e de design. " +
      "Somente leitura. Requer o cliente_id obtido em listar_clientes.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        cliente_id: { type: "string", description: UUID_DESC },
      },
      required: ["cliente_id"],
      additionalProperties: false,
    },
    executar: (args, config) =>
      chamar(config, {
        metodo: "GET",
        segmentos: ["clientes", args.cliente_id, "posts"],
      }),
  },

  {
    name: "consultar_post",
    description:
      "Consulta um post específico: título, legenda, roteiro, datas, mídia e status de aprovação. " +
      "Somente leitura.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        post_id: { type: "string", description: UUID_DESC },
      },
      required: ["post_id"],
      additionalProperties: false,
    },
    executar: (args, config) =>
      chamar(config, { metodo: "GET", segmentos: ["posts", args.post_id] }),
  },

  {
    name: "criar_post",
    description:
      "ESCRITA. Cria um post de texto no PostGrowth (sem arte). " +
      "Efeito colateral relevante: o PostGrowth cria automaticamente a tarefa correspondente no ClickUp, " +
      "e essa tarefa NÃO é apagada mesmo que o post seja excluído depois. " +
      "Não use para testes. Confirme com a pessoa antes de criar. " +
      "O status de aprovação é derivado pelas regras do PostGrowth e não pode ser enviado.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        cliente_id: { type: "string", description: UUID_DESC },
        tipo: {
          type: "string",
          enum: ["unico", "carrossel", "video"],
          description: "Formato do post. 'carrossel' exige pelo menos dois slides de roteiro no uso prático.",
        },
        titulo: { type: "string", description: "Título interno do post. Obrigatório." },
        legenda: { type: "string", description: "Legenda que vai para a rede social." },
        data_programada: { type: "string", description: "Data no formato YYYY-MM-DD." },
        horario_programado: { type: "string", description: "Horário no formato HH:MM, 24h." },
        roteiro: {
          type: "array",
          items: { type: "string" },
          description: "Textos do post, na ordem. Em carrossel, um item por slide.",
        },
      },
      required: ["cliente_id", "tipo", "titulo"],
      additionalProperties: false,
    },
    executar: (args, config) =>
      chamar(config, {
        metodo: "POST",
        segmentos: ["posts"],
        corpo: apenasDefinidos({
          cliente_id: args.cliente_id,
          tipo: args.tipo,
          titulo: args.titulo,
          legenda: args.legenda,
          data_programada: args.data_programada,
          horario_programado: args.horario_programado,
          roteiro: args.roteiro,
        }),
      }),
  },

  {
    name: "atualizar_post",
    description:
      "ESCRITA. Altera campos de texto de um post existente: título, legenda, roteiro, data e horário. " +
      "Só os campos enviados são alterados; os demais ficam intactos. Não toca em mídia. " +
      "Alterar o roteiro pode reabrir o fluxo de aprovação de texto do cliente — confirme antes.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        post_id: { type: "string", description: UUID_DESC },
        titulo: { type: "string" },
        legenda: { type: "string" },
        data_programada: { type: "string", description: "Data no formato YYYY-MM-DD." },
        horario_programado: { type: "string", description: "Horário no formato HH:MM, 24h." },
        roteiro: {
          type: "array",
          items: { type: "string" },
          description: "Substitui o roteiro inteiro, na ordem enviada.",
        },
      },
      required: ["post_id"],
      additionalProperties: false,
    },
    executar: (args, config) =>
      chamar(config, {
        metodo: "PATCH",
        segmentos: ["posts", args.post_id],
        corpo: apenasDefinidos({
          titulo: args.titulo,
          legenda: args.legenda,
          data_programada: args.data_programada,
          horario_programado: args.horario_programado,
          roteiro: args.roteiro,
        }),
      }),
  },

  {
    name: "consultar_tarefa_clickup",
    description:
      "Somente leitura. Inspeciona uma tarefa do ClickUp: nome, anexos disponíveis e a qual post do " +
      "PostGrowth ela está vinculada. Use SEMPRE esta ferramenta antes de subir_midia_clickup, para " +
      "conferir o vínculo e o cliente sem disparar download nem upload.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        clickup_task_id: { type: "string", description: "ID da tarefa no ClickUp." },
      },
      required: ["clickup_task_id"],
      additionalProperties: false,
    },
    executar: (args, config) =>
      chamar(config, { metodo: "GET", segmentos: ["clickup", "tarefa", args.clickup_task_id] }),
  },

  {
    name: "subir_midia_clickup",
    description:
      "⚠️ AÇÃO REAL E IRREVERSÍVEL — NÃO USE SEM CONFIRMAÇÃO EXPLÍCITA DE UMA PESSOA, NESTA CONVERSA. " +
      "Baixa os anexos da tarefa do ClickUp e faz UPLOAD REAL na biblioteca de mídia do ROI SENSEI da " +
      "subconta do cliente, através do PostGrowth. A arte enviada passa a aparecer na página pública de " +
      "aprovação que o cliente vê. " +
      "Com confirmar_substituicao=true, a mídia que já existe no post é APAGADA e substituída pelo " +
      "conjunto novo — não existe 'acrescentar uma imagem', toda escrita substitui o conjunto inteiro. " +
      "Nada disso pode ser desfeito por este shim. " +
      "REGRAS DE USO: (1) rode consultar_tarefa_clickup antes e mostre o vínculo à pessoa; " +
      "(2) peça confirmação explícita, citando o cliente e o post; " +
      "(3) só passe confirmar_substituicao=true se a pessoa autorizar apagar a arte atual, com essas palavras; " +
      "(4) NUNCA use em lote nem em laço sobre várias tarefas — uma chamada por vez, cada uma com sua confirmação.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        clickup_task_id: {
          type: "string",
          description: "ID da tarefa do ClickUp cujos anexos serão enviados.",
        },
        cliente_id: {
          type: "string",
          description:
            "UUID do cliente dono do post. Obrigatório: o servidor confere contra o banco e recusa se " +
            "divergir da tarefa. É a trava contra subir arte no cliente errado.",
        },
        confirmar_substituicao: {
          type: "boolean",
          default: false,
          description:
            "Só envie true se a pessoa autorizou APAGAR a mídia atual do post. Com false (padrão), um post " +
            "que já tem mídia é recusado sem que nada seja baixado ou enviado.",
        },
      },
      required: ["clickup_task_id", "cliente_id"],
      additionalProperties: false,
    },
    executar: (args, config) =>
      chamar(config, {
        metodo: "POST",
        segmentos: ["midias"],
        corpo: {
          clickup_task_id: args.clickup_task_id,
          cliente_id: args.cliente_id,
          // Só o booleano `true` confirma; o servidor não aceita coerção.
          confirmar_substituicao: args.confirmar_substituicao === true,
        },
      }),
  },
];

export const POR_NOME = new Map(FERRAMENTAS.map((f) => [f.name, f]));

/** Remove chaves ausentes para não enviar `undefined` nem apagar campo sem querer. */
function apenasDefinidos(objeto) {
  return Object.fromEntries(Object.entries(objeto).filter(([, v]) => v !== undefined));
}
