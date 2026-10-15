// Leitura dos arquivos locais que a ferramenta subir_midia_arquivos envia.
//
// Só lê. Não faz rede (isso é de http.mjs) e não decide regra de negócio
// (quantidade por tipo, dono do post, substituição — isso é do PostGrowth).
//
// O que ela garante, ANTES de qualquer envio:
//   - todo item é um arquivo comum que existe (não pasta, não link quebrado);
//   - a extensão é de mídia (jpg, jpeg, png, webp, mp4) — o shim nunca vira
//     um jeito de mandar outro tipo de arquivo da máquina para fora;
//   - cada arquivo cabe numa requisição da Vercel (4,5 MB de corpo).
// Se UM item falhar, nada é enviado: um carrossel pela metade deixaria arquivo
// órfão na biblioteca do cliente.

import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** A Vercel corta o corpo em 4,5 MB; sobra margem para o envelope multipart. */
export const LIMITE_BYTES = 4_400_000;
export const MAX_ARQUIVOS = 20;

const TIPOS = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
};

function expandir(caminho) {
  const s = String(caminho ?? "").trim();
  if (s === "~") return homedir();
  if (s.startsWith("~/")) return path.join(homedir(), s.slice(2));
  return s;
}

function mb(bytes) {
  return (bytes / 1_000_000).toFixed(1).replace(".", ",") + " MB";
}

/**
 * Confere e lê todos os arquivos. Tudo ou nada.
 * @param {string[]} caminhos
 * @returns {Promise<{ok:true, arquivos:{nome:string, tipo:string, bytes:Buffer}[]} | {ok:false, erro:string}>}
 */
export async function lerArquivosDeMidia(caminhos) {
  if (!Array.isArray(caminhos) || caminhos.length === 0) {
    return { ok: false, erro: "Informe pelo menos um arquivo em `arquivos`." };
  }
  if (caminhos.length > MAX_ARQUIVOS) {
    return { ok: false, erro: `No máximo ${MAX_ARQUIVOS} arquivos por post.` };
  }

  const problemas = [];
  const conferidos = [];

  for (const bruto of caminhos) {
    const abs = expandir(bruto);
    if (!path.isAbsolute(abs)) {
      problemas.push(`"${bruto}": use o caminho completo do arquivo (ex.: /Users/voce/Downloads/slide-1.png).`);
      continue;
    }
    const ext = path.extname(abs).toLowerCase();
    const tipo = TIPOS[ext];
    if (!tipo) {
      problemas.push(`"${path.basename(abs)}": extensão não aceita. Use jpg, png, webp ou mp4.`);
      continue;
    }
    let info;
    try {
      info = await stat(abs);
    } catch {
      problemas.push(`"${abs}": arquivo não encontrado.`);
      continue;
    }
    if (!info.isFile()) {
      problemas.push(`"${abs}": não é um arquivo.`);
      continue;
    }
    if (info.size === 0) {
      problemas.push(`"${path.basename(abs)}": arquivo vazio.`);
      continue;
    }
    if (info.size > LIMITE_BYTES) {
      problemas.push(
        `"${path.basename(abs)}" tem ${mb(info.size)}; o limite por arquivo é ${mb(LIMITE_BYTES)}. ` +
          "Exporte menor (PNG comprimido ou JPG) e tente de novo."
      );
      continue;
    }
    conferidos.push({ abs, tipo });
  }

  if (problemas.length) {
    return { ok: false, erro: "Nada foi enviado. Corrija estes arquivos:\n- " + problemas.join("\n- ") };
  }

  const arquivos = [];
  for (const { abs, tipo } of conferidos) {
    arquivos.push({ nome: path.basename(abs), tipo, bytes: await readFile(abs) });
  }
  return { ok: true, arquivos };
}
