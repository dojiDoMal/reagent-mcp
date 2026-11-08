# Strict Mode

O `strictMode` controla quanto dado da aplicação o agente de IA pode acessar
através das ferramentas do `reagent-mcp`. É a principal barreira de
segurança do runtime de diagnóstico.

```ts
initDebugRuntime({
  strictMode: false, // padrão: true
  adapters: { /* ... */ },
});
```

## Resumo

| | `strictMode: true` (padrão) | `strictMode: false` |
|---|---|---|
| Acesso ao storage | Apenas chaves das allowlists (`localStorage` / `sessionStorage`) | `localStorage` e `sessionStorage` inteiros, allowlists ignoradas |
| Acesso ao Redux store | Apenas os ramos da allowlist (`redux.allow`); vazia/omitida = nada | Store completo via `get_redux_state` |
| Gate de confirmação no servidor MCP | Não | Sim — exige `acknowledgeRisk: true` antes de qualquer ferramenta |

> O gate de confirmação protege **todas** as ferramentas quando o modo estrito
> está desativado.

## `strictMode: true` (recomendado)

Este é o comportamento padrão quando a opção é omitida (`strictMode ?? true`).

Com o modo estrito ligado, as leituras de storage respeitam as allowlists
configuradas nos adapters. Apenas chaves que estão **ao mesmo tempo** solicitadas
pelo agente e presentes na allowlist são retornadas:

```ts
initDebugRuntime({
  strictMode: true,
  adapters: {
    storage: {
      localStorage: ["ifs_platform"], // somente estas chaves são legíveis
      sessionStorage: [],
    },
  },
});
```

Nesse modo, uma chamada `get_storage` que peça uma chave fora da allowlist
simplesmente não retorna aquele valor. Isso mantém tokens, credenciais e dados
pessoais fora do alcance do agente a menos que você os exponha explicitamente.

### Allowlist do Redux store

Sob modo estrito, o `get_redux_state` também é filtrado por uma allowlist,
configurada no adapter do Redux via `allow`. A allowlist é **fail-closed**:
se estiver vazia ou omitida, o modo estrito não expõe nada do store.

```ts
initDebugRuntime({
  strictMode: true,
  adapters: {
    redux: {
      store,
      allow: ["session.user", "ui.theme"],
      // allowMode: "path", // padrão
    },
  },
});
```

O match é sempre **case-sensitive** e contra o **nome completo** do segmento /
propriedade (não substring). Há dois modos, controlados por `allowMode`:

**`"path"` (padrão, recomendado)** — cada entrada é um caminho ancorado na raiz
do store. Expõe o nó indicado e toda a sua subárvore, preservando só os ramos
necessários para chegar até ele.

**`"name"` (opt-in, exploratório)** — cada entrada é um nome de propriedade
procurado em **qualquer profundidade**. Quando o nome bate, o nó e toda a sua
subárvore são mantidos; caso contrário o nó é preservado apenas se tiver algum
descendente que bata.

> O `path` que a ferramenta `get_redux_state` aceita é resolvido **depois** do
> filtro da allowlist (que é ancorado na raiz do store), então o agente nunca
> consegue alcançar algo fora do que foi liberado.

## `strictMode: false`

Com o modo estrito desativado, as allowlists são **ignoradas**: `get_storage`
passa a ler o `localStorage` e o `sessionStorage` por inteiro (e, se chaves
específicas forem pedidas, qualquer chave, sem restrição).

Como isso expõe potencialmente dados sensíveis ao provedor de LLM, o servidor
MCP aplica um **gate de confirmação de risco**:

1. O estado de `strictMode` é enviado no handshake entre runtime e servidor.
2. Quando o runtime está em modo não-estrito, toda ferramenta
   (`get_app_snapshot`, `get_redux_state`, `get_storage`, `get_route`,
   `get_network_activity`) passa pelo `guardNonStrict`.
3. Se o agente ainda não enviou `acknowledgeRisk: true`, a ferramenta **não é
   executada**. Em vez disso, retorna um aviso instruindo o agente a:
   - explicar o risco ao usuário;
   - perguntar se ele deseja continuar;
   - só então, e apenas se o usuário confirmar, repetir a chamada com
     `acknowledgeRisk: true`.

O texto do aviso alerta que, com o modo estrito desativado, o
agente tem acesso total ao store do Redux e a todo o `localStorage` /
`sessionStorage`, e que dados sensíveis podem trafegar até o provedor de LLM.

> O não envio de `strictMode` no handshake é tratado como
> estrito por segurança (`handshake?.strictMode ?? true`).

## Quando usar cada um

- **Mantenha `true`** no dia a dia. Liste explicitamente apenas as chaves de
  storage e os ramos do Redux (`redux.allow`) que o agente precisa inspecionar,
  usando `allowMode: "path"`.
- **Use `false`** apenas em depuração pontual, quando você precisa que o agente
  enxergue todo o storage e o store e aceita conscientemente o risco.

