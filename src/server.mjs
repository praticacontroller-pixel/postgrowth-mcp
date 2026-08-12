// Montagem do servidor MCP. Transporte stdio.
//
// Usa a API de baixo nível do SDK (`Server` + setRequestHandler) de propósito:
// assim o `inputSchema` é JSON Schema cru, escrito à mão em tools.mjs, e o
// repositório não precisa de zod nem de build step.
//
// stdout é do protocolo. Qualquer diagnóstico vai para stderr — uma linha solta
// no stdout corrompe o JSON-RPC e derruba a sessão.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { FERRAMENTAS, POR_NOME } from "./tools.mjs";
import { redigir } from "./http.mjs";

export const VERSAO = "0.1.0";

export function criarServidor(config) {
  const servidor = new Server(
    { name: "postgrowth-mcp", version: VERSAO },
    { capabilities: { tools: {} } }
  );

  servidor.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: FERRAMENTAS.map(({ name, description, inputSchema, annotations }) => ({
      name,
      description,
      inputSchema,
      ...(annotations ? { annotations } : {}),
    })),
  }));

  servidor.setRequestHandler(CallToolRequestSchema, async (pedido) => {
    const { name, arguments: args } = pedido.params;
    const ferramenta = POR_NOME.get(name);

    if (!ferramenta) {
      return erro(`Ferramenta desconhecida: ${name}.`);
    }

    const faltando = (ferramenta.inputSchema.required ?? []).filter(
      (c) => args?.[c] == null || String(args[c]).trim() === ""
    );
    if (faltando.length) {
      return erro(`Argumentos obrigatórios ausentes em ${name}: ${faltando.join(", ")}.`);
    }

    let resultado;
    try {
      resultado = await ferramenta.executar(args ?? {}, config);
    } catch (e) {
      // Rede, JSON, qualquer coisa inesperada: vira erro de ferramenta, não
      // exceção de protocolo, e passa por `redigir` antes de chegar ao modelo.
      return erro(redigir(`Falha ao executar ${name}: ${e?.message ?? e}`, config.token));
    }

    if (!resultado.ok) return erro(resultado.erro);

    return {
      content: [{ type: "text", text: JSON.stringify(resultado.dados ?? {}, null, 2) }],
    };
  });

  return servidor;
}

function erro(mensagem) {
  return { isError: true, content: [{ type: "text", text: String(mensagem) }] };
}

export async function iniciar(config) {
  const servidor = criarServidor(config);
  await servidor.connect(new StdioServerTransport());
  return servidor;
}
