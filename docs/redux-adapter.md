# Redux Adapter

O adapter do Redux dá ao agente acesso de leitura ao state da aplicação através
da ferramenta `get_redux_state`. Ele retorna o **state vivo** no momento da
chamada.

```ts
import store from "./store";

initDebugRuntime({
  adapters: {
    redux: {
      store,
      allow: ["session.user", "ui.theme"],
      // allowMode: "path", // padrão
    },
  },
});
```

## Configuração

| Campo | Tipo | Padrão | Descrição |
|---|---|---|---|
| `store` | `ReduxStoreLike` | — (obrigatório) | O store da aplicação. Precisa de `getState()` e `subscribe()`; funciona com Redux clássico e Redux Toolkit. |
| `allow` | `string[]` | `[]` | Allowlist que restringe quais partes do state o agente pode ler em modo estrito. |
| `allowMode` | `"path"` \| `"name"` | `"path"` | Como as entradas de `allow` são interpretadas. |

Só o `store` é obrigatório. `allow` e `allowMode` controlam a filtragem sob
modo estrito (veja abaixo).

## Como a allowlist funciona

A `allow` só tem efeito quando o runtime está em **modo estrito**
(`strictMode: true`, que é o padrão). Nesse modo ela é **fail-closed**: se
estiver vazia ou omitida, o agente não enxerga nada do store (`{}`).

Com `strictMode: false` a allowlist é **ignorada** e o store inteiro fica
legível — mas nesse caso o servidor MCP exige confirmação de risco do usuário
antes de executar qualquer ferramenta. Detalhes em
[strict-mode.md](./strict-mode.md).

O match é sempre **case-sensitive** e contra o **nome completo** do segmento /
propriedade (nunca substring).

Para os exemplos a seguir, considere este state:

```js
{
  session: { token, user: { id } },
  ui: { theme, sessionTimeout },
  data: { sessionList },
}
```

### `allowMode: "path"` (padrão, recomendado)

Cada entrada é um **caminho ancorado na raiz** do store. Libera o nó indicado e
toda a sua subárvore, preservando apenas os ramos necessários para chegar até
ele. Irmãos fora da allowlist nunca aparecem.

| `allow` | Resultado exposto |
|---|---|
| `["session"]` | `session` inteiro (inclusive `token`) |
| `["session.user"]` | só `session.user` — `session.token` fica escondido |
| `["ui.theme", "session.user.id"]` | exatamente esses dois ramos |
| `[]` ou omitido | `{}` (nada) |
| `["naoExiste"]` | `{}` (nada) |

É o modo recomendado por ser previsível e auditável: lendo a config você sabe
exatamente o que é exposto, e qualquer coisa fora da lista nunca aparece.

### `allowMode: "name"` (opt-in, exploratório)

Cada entrada é um **nome de propriedade** procurado em **qualquer
profundidade**. Quando o nome bate, o nó e toda a sua subárvore são mantidos;
caso contrário, o nó é preservado só se tiver algum descendente que bata.

| `allow` (mode `"name"`) | Resultado exposto |
|---|---|
| `["session"]` | qualquer propriedade `session`, onde quer que esteja |
| `["sessionTimeout"]` | `ui.sessionTimeout` (preserva o caminho) |
| `["user"]` | `session.user` (achado em profundidade) |

Esse modo é mais permissivo e menos previsível: um nome liberado pode capturar
propriedades homônimas que você não pretendia expor, inclusive em slices que
forem adicionados no futuro. Use apenas para depuração pontual; prefira
`"path"` no dia a dia.

## Interação com o `path` da ferramenta

A ferramenta `get_redux_state` aceita um argumento `path` (ex.: `session.user`). Esse `path` é resolvido **depois**
do filtro da allowlist, que é ancorado na raiz do store. Ou seja: o agente
nunca consegue usar `path` para alcançar algo fora do que a allowlist liberou.

## Exemplo

Trecho de bootstrap em modo estrito, expondo apenas o ramo que o agente precisa
inspecionar:

```js
import axios from "axios";
import store from "./store";
import history from "./history";

if (process.env.NODE_ENV === "development") {
  import("reagent-mcp/react")
    .then(({ initDebugRuntime }) => {
      initDebugRuntime({
        adapters: {
          redux: {
            store,
            allow: ["session.user"], // só este ramo fica legível
          },
          storage: {
            localStorage: ["ifs_platform"],
            sessionStorage: [],
          },
          router: { history },
          network: {
            axios,
            body: { headers: true },
          },
        },
      });
      // eslint-disable-next-line no-console
      console.info("[reagent-mcp] runtime de diagnóstico inicializado");
    })
    .catch((err) => {
      // Diagnóstico nunca deve quebrar a aplicação.
      // eslint-disable-next-line no-console
      console.warn("[reagent-mcp] falha ao inicializar:", err);
    });
}
```
