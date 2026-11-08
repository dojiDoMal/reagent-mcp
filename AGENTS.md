# reagent-mcp

Debugging orientado a agentes para aplicações React, via **Model Context
Protocol (MCP)**. Instalado como `devDependency`, permite que um agente (ex.
Kiro) inspecione o **estado real** de uma aplicação React em execução — Redux,
Web Storage, rota e atividade de rede — em vez de depender só da leitura do
código.

> Status: v1. Alvo: **CRA/Webpack + React 18 + Redux
> clássico**, em loopback por padrão (host configurável para WebView/Cordova de
> desenvolvimento). Ferramentas somente de leitura.

## Como funciona

```
Kiro  --stdio-->  MCP server (Node)  --WS cliente-->  runtime (navegador, WS listener lógico)
                                                         +-- Redux store
                                                         +-- localStorage / sessionStorage
                                                         +-- rota / atividade de rede
```

O estado vive no navegador. Como uma página não
pode abrir um socket de escuta (a WebSocket do navegador é só cliente), na
prática **o MCP server hospeda o listener WS em loopback e o runtime do
navegador conecta como cliente**. Os papéis lógicos se mantêm: o runtime apenas
*responde* consultas e o server apenas *repassa* os pedidos do agente. Se não há
aba aberta, o runtime não conecta e o server responde "aplicação não
conectada".

## Instalação

```bash
npm install -D reagent-mcp
```

## Uso

Inicie o runtime no entry do app, **atrás de um guard de desenvolvimento**. No build, o ramo vira
código morto e o runtime (incluindo o import dinâmico) **não entra no bundle de
produção**. A sintaxe do guard muda conforme o bundler.

Exemplo de `store` Redux clássico usado nas duas integrações abaixo:

```ts
// src/store.ts
import { createStore, combineReducers, type AnyAction } from "redux";

interface AuthState {
  user: { id: number; name: string } | null;
  lastLogin: string | null;
}

const initialAuth: AuthState = { user: null, lastLogin: null };

function authReducer(state: AuthState = initialAuth, action: AnyAction): AuthState {
  switch (action.type) {
    case "auth/login":
      return { user: action.payload, lastLogin: new Date().toISOString() };
    case "auth/logout":
      return initialAuth;
    default:
      return state;
  }
}

const rootReducer = combineReducers({ auth: authReducer });

export type RootState = ReturnType<typeof rootReducer>;
export const store = createStore(rootReducer);
```

### CRA (Create React App / Webpack)

Em CRA, o guard usa `process.env.NODE_ENV`. O Webpack elimina o ramo como
código morto no `build` de produção.

```tsx
// src/index.tsx
import { store } from "./store";

if (process.env.NODE_ENV === "development") {
  import("reagent-mcp/react")
    .then(({ initDebugRuntime }) => {
      initDebugRuntime({
        adapters: {
          redux: { store },
          storage: {
            // Só estas chaves são legíveis pelo agente.
            localStorage: ["feature-flags", "ui-prefs"],
            sessionStorage: [],
          },
        },
      });
    })
    .catch((err) => {});
}
```

CRA sobe em `http://localhost:3000` por padrão. Ajuste o argumento passado para `--allowed-origin` na
config MCP se usar outra porta.

### Vite

No Vite, use `import.meta.env.DEV`:

```tsx
// src/main.tsx
import { store } from "./store";

if (import.meta.env.DEV) {
  import("reagent-mcp/react")
    .then(({ initDebugRuntime }) => {
      initDebugRuntime({
        adapters: {
          redux: { store },
          storage: {
            // Só estas chaves são legíveis pelo agente.
            localStorage: ["feature-flags", "ui-prefs"],
            sessionStorage: [],
          },
        },
      });
    })
    .catch((err) => {});
}
```

Vite sobe em `http://localhost:5173` por padrão. Ajuste o argumento passado para `--allowed-origin` na
config MCP se usar outra porta.

### Opções de conexão do runtime

Por padrão o runtime conecta em `ws://127.0.0.1:7345`. Quando o runtime roda
em outro host relativo ao servidor (ver WebView/Cordova abaixo), configure o
destino:

| Opção | Default | Descrição |
|---|---|---|
| `host` | `"127.0.0.1"` | Host em que o listener WS do servidor é alcançável. |
| `port` | `7345` | Porta do listener. |
| `url` | — | URL WS completa, sobrepondo `host`/`port` (ex. `ws://10.0.2.2:7345`). |

```ts
initDebugRuntime({
  host: "10.0.2.2", // ou url: "ws://10.0.2.2:7345"
  adapters: { redux: { store } },
});
```

### WebView / Cordova (builds de desenvolvimento)

Em um build Cordova/Capacitor de desenvolvimento, o runtime roda dentro do
WebView no dispositivo/emulador, não no browser do host.

**1. Guard de produção.** Um build do app roda com
`NODE_ENV=production`, então o guard `process.env.NODE_ENV === "development"`
elimina o runtime. Use uma env própria, ligada só quando quiser, para que o
guard não dependa do modo de build:

```tsx
if (process.env.REACT_APP__DEBUG_MCP === "true") {
  import("reagent-mcp/react").then(({ initDebugRuntime }) => {
    initDebugRuntime({ host: "10.0.2.2", adapters: { redux: { store } } });
  });
}
```

**2. Endereço do servidor.** Aponte `host`/`url` para onde o device alcança o
servidor:
- Emulador Android: `10.0.2.2` (alias do emulador para o host).
- Dispositivo físico: IP do host na LAN (ex. `192.168.0.10`), com ambos na
  mesma rede.

O servidor também precisa escutar fora do loopback — veja `--host` abaixo.

**3. Origem do WebView e cleartext.** A origem não é `localhost`, mas o esquema
com que o WebView serve o app (ex. `https://meu.aplicativo`, `app://meu.aplicativo`).
Adicione-a ao allowlist de origem do servidor. Além disso, uma página servida em
`https://` não pode abrir uma conexão insegura `ws://` (mixed content); em dev,
sirva o WebView em `http://` e permita cleartext no host (no Cordova Android use
`Scheme=http` + `usesCleartextTraffic="true"`) — apenas em builds de
desenvolvimento, nunca em produção.

## Configuração MCP no Kiro

```json
{
  "mcpServers": {
    "reagent": {
      "command": "npx",
      "args": ["reagent-mcp", "start", "--allowed-origin", "http://localhost:3000"]
    }
  }
}
```

`--allowed-origin` restringe o canal WS à origem do seu app; outras páginas são
recusadas. Aponte-o para a origem em que seu app sobe: `http://localhost:3000`
(CRA por padrão) ou `http://localhost:5173` (Vite por padrão).

### Opções da CLI

```
reagent-mcp start [--port <n>] [--host <h>] [--allowed-origin <origin>]... [--no-takeover]
```

| Flag | Default | Descrição |
|---|---|---|
| `--port` | `7345` | Porta do listener WS. |
| `--host` | `127.0.0.1` | Interface do listener. Use `0.0.0.0` para aceitar conexões vindas de um emulador/dispositivo (ex. Android via `10.0.2.2`). |
| `--allowed-origin` | — | Origem permitida. **Repetível** para aceitar várias (ex. um dev server e os esquemas do WebView). Sem nenhuma, qualquer origem é aceita. |
| `--no-takeover` | — | Falha se a porta estiver ocupada, em vez de assumir o lugar de uma instância anterior. |

Exemplo para um app no emulador Android, aceitando também o dev server local:

```json
{
  "mcpServers": {
    "reagent": {
      "command": "npx",
      "args": [
        "reagent-mcp", "start",
        "--host", "0.0.0.0",
        "--allowed-origin", "http://meu.aplicativo",
        "--allowed-origin", "app://meu.aplicativo",
        "--allowed-origin", "http://localhost:3000"
      ]
    }
  }
}
```

> `--host 0.0.0.0` expõe a porta na sua rede local enquanto o servidor roda.
> Use apenas em ambiente de desenvolvimento confiável, com dados fake.

## Ferramentas MCP (v1)

| Ferramenta | Descrição |
|---|---|
| `get_app_snapshot` | Conexão, origem, sessão e adapters disponíveis. |
| `get_redux_state` | Estado Redux atual; por `path` (ex. `auth.user`). |
| `get_storage` | Chaves allowlistadas de `local`/`session` storage. |
| `get_route` | Rota atual (pathname, search, hash, query). |
| `get_network_activity` | Requisições HTTP (axios) recentes. |

## Playground

O diretório [`../playground`](../playground) contém o ambiente público de
demonstração (Vite + React, deploy na Vercel): aplicação demo com cenários
reproduzíveis, documentação interativa das ferramentas, Storybook e um
assistente de IA **BYOK** que executa as ferramentas reais via `initLocalRuntime`.

## Uso em memória (sem WebSocket)

Quando a aplicação inspecionada e o consumidor vivem na **mesma página** — um
playground embutido, uma demo ou testes — não é preciso subir a bridge WS. Use
`initLocalRuntime`, que roda o **mesmo handler** das ferramentas de forma
in-process e expõe um bridge com a mesma interface (`request()`):

```ts
import { initLocalRuntime } from "reagent-mcp/react";
import { decode } from "reagent-mcp/react";

const { bridge, sessionId } = initLocalRuntime({
  strictMode: true,
  adapters: { redux: { store, allow: ["auth", "cart"] } },
});

const response = await bridge.request({ type: "get_redux_state", path: "cart.items" });
const value = response.ok ? decode(response.result!) : null;
```

As ferramentas são as reais: `initLocalRuntime` e o runtime WS compartilham
`createRequestHandler`, então o resultado é idêntico ao obtido pelo servidor MCP.

### Registro de ferramentas

As definições das ferramentas (nome, descrição, schema e mapeamento para a
request) ficam em `TOOL_DEFINITIONS`, exportado por `reagent-mcp/react` e
`reagent-mcp/server`. O servidor MCP registra a partir dele, então qualquer
consumidor (playground, Storybook, docs) lê a mesma fonte da verdade — nada
fica dessincronizado.

## Decisões e segurança

- Serialização type-preserving (via `jsan`): `Date`/`Map`/`Set` e referências
  circulares são preservados, sem o erro clássico de `JSON.stringify`.
- Limites de profundidade/entradas/tamanho nas respostas.
- `get_storage` opera por allowlist (qualidade do dado e tamanho da resposta).
- WS em loopback por padrão, com validação de `Origin` (uma ou mais origens
  permitidas). O host do listener é configurável (`--host`) para cenários de
  WebView/dispositivo; fora do loopback, restrinja a redes de desenvolvimento
  confiáveis.
- Somente leitura: não há ferramentas de mutação na v1; o runtime não executa
  código arbitrário enviado pelo agente.
- Sanitização/redaction de segredos: **adiada** (ver proposta); a v1 pressupõe
  dados de dev e modelo próprio.