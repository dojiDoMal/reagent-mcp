<p align="center">
  <img src="docs/assets/logo-reagent.png" alt="reagent-mcp" width="200" />
</p>

# reagent-mcp

Uma ferramenta que deixa um agente de IA (como o Kiro) "enxergar" o que está acontecendo dentro da sua aplicação React enquanto ela roda. Em vez de só ler o código, o agente consegue olhar os dados reais do app: o estado do Redux, o que está salvo no storage do navegador, a rota atual e as chamadas de rede.

Você instala como dependência de desenvolvimento.

> **Versão:** v1
> **Funciona com:** CRA/Webpack + React 18 + Redux clássico
> **Segurança:** roda só na sua máquina por padrão e **só lê** dados, nunca altera nada.

## Como funciona

Os dados do seu app vivem no navegador. O agente conversa com um servidor, e o seu app (no navegador) se conecta a esse servidor para responder às perguntas.

```
Kiro  →  servidor MCP (Node)  →  seu app no navegador
                                    ├── estado do Redux
                                    ├── localStorage / sessionStorage
                                    └── rota / chamadas de rede
```

Resumindo o fluxo:
- O agente pergunta algo (ex: "qual o estado do Redux?").
- O servidor repassa a pergunta para o app.
- O app responde com os dados reais.
- Se nenhuma aba do app estiver aberta, você recebe a mensagem "aplicação não conectada".

## Instalação

```bash
npm install -D reagent-mcp
```

## Como usar

Você liga a ferramenta no arquivo principal do seu app, mas **só em ambiente de desenvolvimento**. Assim, quando você gerar o build de produção, essa parte é removida automaticamente e **não vai parar no app final dos usuários**.

O jeito de escrever essa "trava de desenvolvimento" muda um pouco dependendo da ferramenta de build (CRA ou Vite).

Exemplo de uma `store` Redux usada nos exemplos abaixo:

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

No CRA, a trava usa `process.env.NODE_ENV`. No build de produção, o Webpack remove esse trecho sozinho.

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
            // O agente só consegue ler estas chaves.
            localStorage: ["feature-flags", "ui-prefs"],
            sessionStorage: [],
          },
        },
      });
    })
    .catch((err) => {});
}
```

O CRA normalmente roda em `http://localhost:3000`. Se você usar outra porta, ajuste o valor de `--allowed-origin` na configuração do MCP.

### Vite

No Vite, a trava usa `import.meta.env.DEV`:

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
            // O agente só consegue ler estas chaves.
            localStorage: ["feature-flags", "ui-prefs"],
            sessionStorage: [],
          },
        },
      });
    })
    .catch((err) => {});
}
```

O Vite normalmente roda em `http://localhost:5173`. Se usar outra porta, ajuste o `--allowed-origin` na configuração do MCP.

### Opções de conexão

Por padrão, o app se conecta em `ws://127.0.0.1:7345`. Se o app estiver rodando em outro lugar (ver a parte de WebView/Cordova mais abaixo), você pode mudar o destino:

| Opção | Padrão | O que faz |
|---|---|---|
| `host` | `"127.0.0.1"` | Onde o servidor pode ser encontrado. |
| `port` | `7345` | A porta usada. |
| `url` | — | URL completa, que substitui `host`/`port` (ex. `ws://10.0.2.2:7345`). |

```ts
initDebugRuntime({
  host: "10.0.2.2", // ou url: "ws://10.0.2.2:7345"
  adapters: { redux: { store } },
});
```

### WebView / Cordova (builds de desenvolvimento)

Em um app Cordova/Capacitor, o seu app roda dentro de um WebView no celular ou no emulador, e não no navegador do seu computador. Isso muda três coisas:

**1. A trava de desenvolvimento.** Um build do app roda com `NODE_ENV=production`, então a trava `process.env.NODE_ENV === "development"` acabaria removendo a ferramenta. Para resolver, use uma variável só sua, que você pode ligar quando quiser:

```tsx
if (process.env.REACT_APP__DEBUG_MCP === "true") {
  import("reagent-mcp/react").then(({ initDebugRuntime }) => {
    initDebugRuntime({ host: "10.0.2.2", adapters: { redux: { store } } });
  });
}
```

**2. O endereço do servidor.** Aponte `host`/`url` para onde o aparelho consegue achar o servidor:
- Emulador Android: `10.0.2.2` (é o apelido que o emulador usa para o seu computador).
- Celular físico: o IP do seu computador na rede (ex. `192.168.0.10`), com os dois na mesma rede.

Nesse caso, o servidor também precisa aceitar conexões de fora da própria máquina — veja a flag `--host` mais abaixo.

**3. Origem e conexão insegura.** A origem do app no WebView não é `localhost`, e sim o esquema usado para servir o app (ex. `https://meu.aplicativo` ou `app://meu.aplicativo`). Você precisa adicionar essa origem à lista de origens permitidas do servidor. Além disso, uma página em `https://` não consegue abrir uma conexão insegura `ws://`. Em desenvolvimento, sirva o WebView em `http://` e permita tráfego "cleartext" (no Cordova Android: `Scheme=http` + `usesCleartextTraffic="true"`) — **apenas em desenvolvimento, nunca em produção.**

## Configuração do MCP no Kiro

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

O `--allowed-origin` serve para liberar só a origem do seu app; qualquer outra página é recusada. Aponte para a origem onde seu app roda: `http://localhost:3000` (padrão do CRA) ou `http://localhost:5173` (padrão do Vite).

### Opções da linha de comando

```
reagent-mcp start [--port <n>] [--host <h>] [--allowed-origin <origin>]... [--no-takeover]
```

| Flag | Padrão | O que faz |
|---|---|---|
| `--port` | `7345` | A porta do servidor. |
| `--host` | `127.0.0.1` | A interface do servidor. Use `0.0.0.0` para aceitar conexões vindas de um emulador ou celular (ex. Android via `10.0.2.2`). |
| `--allowed-origin` | — | Origem permitida. **Pode repetir** para liberar várias (ex. o servidor de dev e os esquemas do WebView). Se você não passar nenhuma, qualquer origem é aceita. |
| `--no-takeover` | — | Se a porta estiver ocupada, falha em vez de tomar o lugar de uma instância anterior. |

Exemplo para um app no emulador Android, aceitando também o servidor de dev local:

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

> Atenção: `--host 0.0.0.0` deixa a porta acessível na sua rede local enquanto o servidor roda. Use só em ambiente de desenvolvimento confiável e com dados fake.

## Ferramentas disponíveis (v1)

| Ferramenta | O que mostra |
|---|---|
| `get_app_snapshot` | Conexão, origem, sessão e adapters disponíveis. |
| `get_redux_state` | O estado atual do Redux; dá para filtrar por caminho (ex. `auth.user`). |
| `get_storage` | As chaves liberadas do `local`/`session` storage. |
| `get_route` | A rota atual (pathname, search, hash, query). |
| `get_network_activity` | As chamadas HTTP (axios) recentes. |
