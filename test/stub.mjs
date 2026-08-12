// Servidor stub que finge ser a API /api/mcp do PostGrowth.
//
// Existe para que os testes rodem sem tocar em produção: nenhum post é criado,
// nenhuma tarefa nasce no ClickUp, nenhuma mídia sobe para o ROI SENSEI.
//
// Sem efeito colateral no import — este arquivo é varrido pelo `node --test`
// junto com os testes, e não pode subir nada sozinho.

import { createServer } from "node:http";

export const TOKEN_FALSO = "token-de-teste-nao-serve-para-nada";

/**
 * Sobe um stub em 127.0.0.1 numa porta livre.
 * @param {(req:{metodo:string,caminho:string,query:URLSearchParams,corpo:any,headers:object}) => {status?:number, json?:any}} responder
 */
export async function subirStub(responder) {
  const recebidos = [];

  const servidor = createServer((req, res) => {
    const pedacos = [];
    req.on("data", (c) => pedacos.push(c));
    req.on("end", () => {
      const texto = Buffer.concat(pedacos).toString("utf8");
      const url = new URL(req.url, "http://127.0.0.1");
      let corpo = null;
      try {
        corpo = texto ? JSON.parse(texto) : null;
      } catch {
        corpo = texto;
      }

      const pedido = {
        metodo: req.method,
        caminho: url.pathname,
        query: url.searchParams,
        corpo,
        headers: req.headers,
      };
      recebidos.push(pedido);

      const r = responder ? responder(pedido) : { status: 200, json: { ok: true } };
      res.writeHead(r.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(r.json ?? {}));
    });
  });

  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const { port } = servidor.address();

  return {
    recebidos,
    baseUrl: `http://127.0.0.1:${port}/api/mcp`,
    porta: port,
    async fechar() {
      await new Promise((ok) => servidor.close(ok));
    },
  };
}

/** Config pronta apontando para o stub. */
export function configDoStub(baseUrl, extras = {}) {
  return { token: TOKEN_FALSO, baseUrl, timeoutMs: 5000, permiteLocal: true, ...extras };
}
