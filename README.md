# react-debug-mcp

Debugging orientado a agentes para aplicações React, via **Model Context
Protocol (MCP)**. Instalado como `devDependency`, permite que um agente (ex.
Kiro) inspecione o **estado real** de uma aplicação React em execução — Redux,
Web Storage e erros de runtime — em vez de depender só da leitura do código.

> Status: v1 (prova de conceito). Alvo: **CRA/Webpack + React 18 + Redux
> clássico**, servido em loopback. Ferramentas somente de leitura.

## Como funciona

```
Kiro  --stdio-->  MCP server (Node)  --WS cliente-->  runtime (navegador, WS listener lógico)
                                                         +-- Redux store
                                                         +-- localStorage / sessionStorage
                                                         +-- erros de runtime
```

O estado vive no navegador, então ele é a fonte da verdade. Como uma página não
pode abrir um socket de escuta (a WebSocket do navegador é só cliente), na
prática **o MCP server hospeda o listener WS em loopback e o runtime do
navegador conecta como cliente**. Os papéis lógicos se mantêm: o runtime apenas
*responde* consultas; o server apenas *repassa* os pedidos do agente. Se não há
aba aberta, não há runtime conectado e o server responde "aplicação não
conectada".

## Instalação

```bash
npm install -D react-debug-mcp
```

## Uso (CRA)

Inicie o runtime no entry do app, atrás de um guard de desenvolvimento:

```tsx
// src/index.tsx
import { store } from "./store";

if (process.env.NODE_ENV === "development") {
  import("react-debug-mcp/react").then(({ initDebugRuntime }) => {
    initDebugRuntime({
      adapters: {
        redux: { store },
        storage: { localStorage: ["feature-flags"], sessionStorage: [] },
      },
    });
  });
}
```

Em CRA, esse ramo vira código morto no `build`, então o runtime **não entra no
bundle de produção**. Esse guard é o mecanismo primário de exclusão de produção.

## Configuração MCP no Kiro

```json
{
  "mcpServers": {
    "react-debug": {
      "command": "npx",
      "args": ["react-debug-mcp", "start", "--allowed-origin", "http://localhost:3000"]
    }
  }
}
```

`--allowed-origin` restringe o canal WS à origem do seu app; outras páginas são
recusadas.

## Ferramentas MCP (v1)

| Ferramenta | Descrição |
|---|---|
| `get_app_snapshot` | Conexão, origem, sessão e adapters disponíveis. |
| `get_redux_state` | Estado Redux atual; prefira um `path` (ex. `auth.user`). |
| `get_storage` | Chaves allowlistadas de `local`/`session` storage. |
| `get_runtime_errors` | Erros e rejeições recentes capturados no navegador. |

## Decisões e segurança

- Serialização type-preserving (via `jsan`): `Date`/`Map`/`Set` e referências
  circulares são preservados, sem o erro clássico de `JSON.stringify`.
- Limites de profundidade/entradas/tamanho nas respostas.
- `get_storage` opera por allowlist (qualidade do dado e tamanho da resposta).
- WS em loopback com validação de `Origin`.
- Somente leitura: não há ferramentas de mutação na v1; o runtime não executa
  código arbitrário enviado pelo agente.
- Sanitização/redaction de segredos: **adiada** (ver proposta); a v1 pressupõe
  dados de dev e modelo próprio.

## Desenvolvimento

```bash
npm install --registry https://registry.npmjs.org/
npm run build
npm run typecheck
```
