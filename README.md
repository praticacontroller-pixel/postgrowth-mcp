# postgrowth-mcp

Shim MCP do PostGrowth. Expõe sete ferramentas MCP que viram chamadas HTTP para
a API protegida do PostGrowth.

```
Claude Desktop / Claude Code  ──stdio──►  postgrowth-mcp  ──https──►  https://postgrowth.vercel.app/api/mcp
```

**O que este repositório NÃO tem, por decisão:** acesso ao Supabase, SQL, chamada
direta ao ROI SENSEI, credencial de qualquer serviço, regra de negócio. Ele só
traduz ferramenta MCP em chamada HTTP. Quem valida, grava e aplica as regras é o
PostGrowth.

---

## Instalação

Não precisa clonar nada. Requer **Node 20+** e **git** instalados.

```bash
npx -y github:praticacontroller-pixel/postgrowth-mcp#v0.1.0
```

O programa não é interativo: ele fala JSON-RPC por stdio e é iniciado pelo seu
cliente MCP. Rodar direto no terminal serve só para conferir que a instalação
funciona — sem token, ele sai com erro, e é isso mesmo que deve acontecer.

Use sempre a **tag** (`#v0.1.0`). Sem tag, o npm pode servir uma versão em cache
e a equipe fica com versões diferentes sem perceber.

---

## Token

`POSTGROWTH_MCP_TOKEN` é **obrigatório e privado**. Sem ele o shim se recusa a
iniciar — de propósito: um servidor que sobe e devolve 401 em toda ferramenta é
pior que um que não sobe.

- É **segredo**, do mesmo nível de uma senha: dá acesso de **escrita** a posts.
- Peça a quem administra o PostGrowth e receba por canal privado.
- **Nunca** coloque o valor em arquivo versionado, print, issue ou chat de grupo.
- O token nunca é escrito em log por este programa, e qualquer eco dele vindo do
  servidor é substituído por `[REDIGIDO]` antes de chegar ao modelo.

Não existe token neste repositório. Ele é público justamente porque não tem
segredo nenhum.

---

## Configuração — Claude Desktop

Edite `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "postgrowth": {
      "command": "npx",
      "args": ["-y", "github:praticacontroller-pixel/postgrowth-mcp#v0.1.0"],
      "env": {
        "POSTGROWTH_MCP_TOKEN": "COLE_AQUI_O_TOKEN_QUE_VOCE_RECEBEU"
      }
    }
  }
}
```

Reinicie o Claude Desktop. As sete ferramentas aparecem na lista de ferramentas
disponíveis.

> Esse arquivo passa a conter o token em texto puro. Trate a máquina de acordo:
> disco cifrado, sem compartilhar a pasta, sem colar o arquivo em lugar nenhum.

## Configuração — Claude Code

```bash
claude mcp add postgrowth \
  --env POSTGROWTH_MCP_TOKEN=COLE_AQUI_O_TOKEN_QUE_VOCE_RECEBEU \
  -- npx -y github:praticacontroller-pixel/postgrowth-mcp#v0.1.0
```

Conferir:

```bash
claude mcp list
```

## Variáveis

| Variável | Obrigatória | Padrão | Para quê |
|---|---|---|---|
| `POSTGROWTH_MCP_TOKEN` | **sim** | — | Autenticação nas rotas `/api/mcp`. Ausente ⇒ o shim não inicia. |
| `POSTGROWTH_MCP_BASE_URL` | não | `https://postgrowth.vercel.app/api/mcp` | Trocar de ambiente. |
| `POSTGROWTH_MCP_ALLOW_LOCAL` | não | — | `true` libera host local/interno. Só desenvolvimento. |
| `POSTGROWTH_MCP_TIMEOUT_MS` | não | `30000` | Tempo limite por chamada. |

Host local, rede interna (`10.x`, `192.168.x`, `172.16–31.x`), endereço de
metadados de nuvem e `http://` remoto são **bloqueados por padrão**. O token
viaja no header `Authorization`; apontar o shim para um host qualquer seria a
forma mais fácil de entregá-lo a quem não deve recebê-lo.

---

## Ferramentas

| Ferramenta | Efeito | Rota |
|---|---|---|
| `listar_clientes` | leitura | `GET /clientes` |
| `listar_posts_cliente` | leitura | `GET /clientes/{id}/posts` |
| `consultar_post` | leitura | `GET /posts/{id}` |
| `criar_post` | **escrita** | `POST /posts` |
| `atualizar_post` | **escrita** | `PATCH /posts/{id}` |
| `consultar_tarefa_clickup` | leitura | `GET /clickup/tarefa/{taskId}` |
| `subir_midia_clickup` | **escrita destrutiva** | `POST /midias` |

Cada ferramenta chama **uma** rota fixa. Não existe ferramenta genérica de
`fetch`, de URL, de método HTTP nem de SQL — e há teste automatizado que falha
se alguém tentar acrescentar uma.

Campos derivados (`status`, `status_texto`, `aprovado_em`, `design_enviado_em`…)
não aparecem em schema nenhum. São calculados pelas regras do PostGrowth e o
servidor recusa quem tentar enviá-los.

### ⚠️ `subir_midia_clickup` — leia antes de usar

Esta ferramenta **faz upload real** dos anexos da tarefa do ClickUp para a
biblioteca de mídia do **ROI SENSEI da subconta do cliente**, através do
PostGrowth. A arte enviada passa a aparecer na **página pública de aprovação que
o cliente vê**.

- Com `confirmar_substituicao: true`, a mídia atual do post é **apagada** e
  substituída. Não existe "acrescentar uma imagem": toda escrita substitui o
  conjunto inteiro.
- **Nada disso é desfeito pelo shim.**
- Use `consultar_tarefa_clickup` **antes**, confira o vínculo e o cliente, e só
  então autorize.
- **Nunca em lote.** Uma chamada por vez, cada uma com confirmação humana
  explícita.

O servidor ainda aplica as próprias travas: recusa vínculo ambíguo, recusa
cliente divergente e recusa substituição não confirmada **antes** de baixar ou
enviar qualquer arquivo.

---

## Exemplos de uso

```
"Lista os clientes do PostGrowth."

"Mostra os posts da Zone Ti que estão aguardando aprovação de texto."

"Cadastra um carrossel para a Zone Ti no dia 01/09 às 18:30, com esse roteiro: …"

"Muda a legenda do post <id> e reprograma para dia 05 às 19h."

"Consulta a tarefa ABC123 do ClickUp e me diz a que post ela está vinculada."
```

---

## Revogar acesso

O token é **único e compartilhado**: revogar derruba todo mundo de uma vez, e é
assim que se corta o acesso de alguém que saiu da equipe ou de uma máquina
perdida.

1. Gere um valor novo (ex.: `openssl rand -hex 32`).
2. Troque `POSTGROWTH_MCP_TOKEN` no projeto do PostGrowth na Vercel e faça
   redeploy. A partir daí, todo token antigo recebe 401.
3. Distribua o novo por canal privado a quem deve continuar com acesso.
4. Cada pessoa atualiza o `env` da própria configuração e reinicia o cliente MCP.

Não há revogação individual — é a limitação de um token compartilhado, e está
registrada de propósito.

---

## Desenvolvimento

```bash
npm install
npm test        # node --test, contra servidor stub local; não toca em produção
```

Os testes nunca chamam produção: sobem um stub HTTP em `127.0.0.1` e conferem
método, rota, corpo e headers. Nenhum post é criado, nenhuma tarefa nasce no
ClickUp, nenhuma mídia sobe para o ROI SENSEI.

Estrutura:

```
bin/postgrowth-mcp.mjs   entrypoint: valida ambiente e conecta o stdio
src/config.mjs           variáveis de ambiente e bloqueio de host
src/http.mjs             único fetch do projeto; Bearer, timeout, redação do token
src/tools.mjs            as sete ferramentas, cada uma amarrada a uma rota
src/server.mjs           servidor MCP (SDK oficial, API de baixo nível)
```

JS puro (ESM), sem TypeScript e sem build step — `npx github:` roda o código como
está. Dependência de runtime: uma, `@modelcontextprotocol/sdk`.

## Licença

MIT.
