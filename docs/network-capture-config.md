# Configuração do network adapter

Como configurar a captura de requisições axios no `initDebugRuntime`.

## Como funciona

O network adapter trabalha com **profiles** (presets) mais **overrides** pontuais:

1. Escolha um `profile`:
   - `"minimal"` (padrão): grava só metadados (método, URL, status, duração, fase).
   - `"detailed"`: também captura bodies de req/resp e headers.
2. Opcionalmente, ajuste campos pontuais com `body` — eles têm **precedência** sobre o profile.

Você **não** precisa reescrever o preset `minimal`/`detailed` campo a campo; apenas seleciona
o profile e sobrescreve o que precisar via `body`.

## Campos de `body`

| Campo | O que faz | Default (`minimal`) |
|---|---|---|
| `responseBody` | captura o corpo da resposta (`response.data`) | `false` |
| `requestBody` | captura o corpo da requisição (`config.data`) | `false` |
| `headers` | captura headers de requisição e resposta | `false` |
| `maxBodyLength` | corta strings serializadas nesse tamanho (chars) | `10000` |
| `raw` | ignora o corte e mantém o payload inteiro | `false` |

## Outros campos do network adapter

| Campo | O que faz | Default |
|---|---|---|
| `axios` | instância axios observada (obrigatório) | — |
| `max` | máximo de requisições no buffer | `25` |
| `urlFilter` | string ou lista de strings; só captura URLs que contenham ao menos um termo (substring, case-insensitive). Omita para capturar tudo | — |

## Exemplos

### Só metadados (padrão)

```js
network: { axios },
// equivale a profile: "minimal"
```

### Ligar tudo (bodies + headers)

```js
network: { axios, profile: "detailed" },
```

### Meio-termo — só o corpo da resposta, resto fica minimal

```js
network: {
  axios,
  body: { responseBody: true },
},
```

### Detailed, aumentando o limite de tamanho

```js
network: {
  axios,
  profile: "detailed",
  body: { maxBodyLength: 50000 },
},
```

### Payload inteiro, sem corte (ex.: pegar um token completo)

```js
network: {
  axios,
  profile: "detailed",
  body: { raw: true },
},
```

### Focar num serviço específico com `urlFilter`

```js
network: {
  axios,
  profile: "detailed",
  urlFilter: "usuarioservices",
},
```

`urlFilter` também aceita lista — casa qualquer um dos termos:

```js
network: {
  axios,
  urlFilter: ["usuarioservices", "/info"],
},
```
