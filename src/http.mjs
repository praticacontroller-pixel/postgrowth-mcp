// Cliente HTTP do shim. Único lugar do projeto que faz `fetch`.
//
// Duas invariantes valem aqui e são cobertas por teste:
//
// 1. O caminho NUNCA vem do modelo. Quem chama passa segmentos que este módulo
//    codifica com encodeURIComponent. Não existe parâmetro "url" nem "path"
//    livre em ferramenta nenhuma — por isso não há como transformar o shim num
//    fetch genérico autenticado com o token do PostGrowth.
// 2. O token nunca sai daqui. Vai no header, não é logado, e toda string que
//    volta para o modelo passa por `redigir`.

/** Troca qualquer ocorrência do token por um marcador. Defesa em profundidade. */
export function redigir(texto, token) {
  const s = String(texto ?? "");
  if (!token) return s;
  return s.split(token).join("[REDIGIDO]");
}

function montarUrl(baseUrl, segmentos, query) {
  const caminho = segmentos.map((s) => encodeURIComponent(String(s))).join("/");
  const url = new URL(`${baseUrl}/${caminho}`);
  for (const [chave, valor] of Object.entries(query ?? {})) {
    if (valor == null || String(valor).trim() === "") continue;
    url.searchParams.set(chave, String(valor));
  }
  return url;
}

/**
 * Faz uma chamada à API MCP do PostGrowth.
 *
 * @param {{token:string, baseUrl:string, timeoutMs:number}} config
 * @param {{metodo:string, segmentos:string[], query?:object, corpo?:object}} pedido
 * @returns {Promise<{ok:boolean, status:number, dados?:any, erro?:string}>}
 */
export async function chamar(config, { metodo, segmentos, query, corpo }, deps = {}) {
  const executar = deps.fetch ?? globalThis.fetch;
  const url = montarUrl(config.baseUrl, segmentos, query);

  const headers = {
    Authorization: `Bearer ${config.token}`,
    Accept: "application/json",
  };
  if (corpo !== undefined) headers["Content-Type"] = "application/json";

  let resposta;
  try {
    resposta = await executar(url, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(config.timeoutMs),
      redirect: "error", // não seguir redirecionamento: o Bearer não pode migrar de host
    });
  } catch (e) {
    const motivo = e?.name === "TimeoutError" ? `tempo esgotado após ${config.timeoutMs}ms` : String(e?.message ?? e);
    return {
      ok: false,
      status: 0,
      erro: redigir(`Falha de rede ao chamar ${url.pathname}: ${motivo}`, config.token),
    };
  }

  const texto = await resposta.text();
  let dados;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = null;
  }

  if (!resposta.ok) {
    const doServidor = dados && typeof dados === "object" && dados.erro ? String(dados.erro) : texto.slice(0, 500);
    const dica =
      resposta.status === 401
        ? " (401: o POSTGROWTH_MCP_TOKEN não confere com o configurado no PostGrowth, ou o servidor está sem a variável)"
        : "";
    return {
      ok: false,
      status: resposta.status,
      erro: redigir(`HTTP ${resposta.status} em ${url.pathname}: ${doServidor || "sem detalhe"}${dica}`, config.token),
      dados: dados ?? undefined,
    };
  }

  return { ok: true, status: resposta.status, dados };
}
