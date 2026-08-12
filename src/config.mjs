// Configuração do shim. Puro: sem rede, sem stdio, sem process.exit.
//
// Este arquivo é a única porta de entrada de variáveis de ambiente. Ele falha
// cedo e falha alto: um shim que sobe sem token viraria um servidor MCP que
// oferece sete ferramentas e devolve 401 em todas — pior que não subir, porque
// o erro só apareceria no meio de uma conversa.

export const BASE_URL_PADRAO = "https://postgrowth.vercel.app/api/mcp";
export const TIMEOUT_PADRAO_MS = 30_000;

export class ErroConfig extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = "ErroConfig";
  }
}

// Hosts que não são o PostGrowth em produção. Bloqueados por padrão porque o
// token do MCP tem poder de escrita: apontar o shim para um host local ou de
// rede interna é o caminho mais curto para entregar o Bearer a quem não devia
// recebê-lo. `POSTGROWTH_MCP_ALLOW_LOCAL=true` libera, e existe para
// desenvolvimento e para os testes deste repositório.
function ehHostLocalOuInterno(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "0.0.0.0" || h === "::") return true;
  if (h === "169.254.169.254") return true; // metadados de nuvem

  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 127 || a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }

  return false;
}

/**
 * Lê e valida o ambiente.
 * @throws {ErroConfig} com mensagem acionável — e NUNCA com o valor do token.
 */
export function carregarConfig(env = process.env) {
  const token = String(env.POSTGROWTH_MCP_TOKEN ?? "").trim();
  if (!token) {
    throw new ErroConfig(
      "POSTGROWTH_MCP_TOKEN ausente ou vazio. Defina a variável no bloco `env` da " +
        "configuração do seu cliente MCP (Claude Desktop ou Claude Code). " +
        "Peça o token a quem administra o PostGrowth — ele não fica neste repositório."
    );
  }

  const permiteLocal = String(env.POSTGROWTH_MCP_ALLOW_LOCAL ?? "") === "true";

  const bruta = String(env.POSTGROWTH_MCP_BASE_URL ?? "").trim() || BASE_URL_PADRAO;
  let url;
  try {
    url = new URL(bruta);
  } catch {
    throw new ErroConfig(
      `POSTGROWTH_MCP_BASE_URL não é uma URL válida. Padrão: ${BASE_URL_PADRAO}`
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ErroConfig("POSTGROWTH_MCP_BASE_URL deve usar https.");
  }
  // O host vem antes do protocolo de propósito: para `http://localhost:3000`,
  // os dois avisos caberiam, e o acionável é o do host — é o caso de
  // desenvolvimento, e a saída diz qual variável destrava.
  if (ehHostLocalOuInterno(url.hostname) && !permiteLocal) {
    throw new ErroConfig(
      `Host local ou de rede interna bloqueado: ${url.hostname}. ` +
        "Para desenvolvimento, defina POSTGROWTH_MCP_ALLOW_LOCAL=true de forma explícita."
    );
  }
  if (url.protocol === "http:" && !permiteLocal) {
    throw new ErroConfig(
      "POSTGROWTH_MCP_BASE_URL deve usar https. O token viaja no header " +
        "Authorization e não pode trafegar em claro."
    );
  }

  let timeoutMs = TIMEOUT_PADRAO_MS;
  if (env.POSTGROWTH_MCP_TIMEOUT_MS != null && String(env.POSTGROWTH_MCP_TIMEOUT_MS).trim() !== "") {
    const n = Number(env.POSTGROWTH_MCP_TIMEOUT_MS);
    if (!Number.isFinite(n) || n <= 0) {
      throw new ErroConfig("POSTGROWTH_MCP_TIMEOUT_MS deve ser um número de milissegundos maior que zero.");
    }
    timeoutMs = n;
  }

  // Sem barra final: as rotas são concatenadas como "/clientes", "/posts/…".
  const baseUrl = (url.origin + url.pathname).replace(/\/+$/, "");

  return Object.freeze({ token, baseUrl, permiteLocal, timeoutMs });
}
