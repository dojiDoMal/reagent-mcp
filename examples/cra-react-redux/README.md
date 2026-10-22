# Exemplo: CRA + React 18 + Redux clássico

Exemplo alvo da v1. Mostra como integrar o `react-debug-mcp` em uma aplicação
Create React App usando **inicialização explícita** com guard de ambiente.

Este diretório contém apenas os trechos relevantes de integração (store e o
ponto de init). Em um app CRA real, eles vivem junto do restante do código.

## Integração

O runtime é iniciado apenas em desenvolvimento, dentro de um guard que o CRA
elimina como código morto no `build` de produção:

```tsx
// src/index.tsx
import { store } from "./store";

if (process.env.NODE_ENV === "development") {
  import("react-debug-mcp/react").then(({ initDebugRuntime }) => {
    initDebugRuntime({
      adapters: {
        redux: { store },
        storage: {
          localStorage: ["feature-flags", "ui-prefs"],
          sessionStorage: [],
        },
      },
    });
  });
}
```

Ver `src/store.ts` e `src/debug.ts`.

## Configuração MCP no Kiro

```json
{
  "mcpServers": {
    "react-debug": {
      "command": "npx",
      "args": [
        "react-debug-mcp",
        "start",
        "--allowed-origin",
        "http://localhost:3000"
      ]
    }
  }
}
```

Ajuste `--allowed-origin` para a origem em que seu app CRA sobe (CRA usa
`http://localhost:3000` por padrão; ajuste se você usa outra porta).

## Verificação de exclusão de produção

O `build` de produção não deve conter o runtime. Como o init está atrás de
`process.env.NODE_ENV === "development"`, o CRA remove o ramo e o import
dinâmico do bundle. Para checar, após `npm run build`, procure por um marcador
do runtime (por exemplo o nome `initDebugRuntime`) nos arquivos de `build/` —
ele não deve aparecer.
