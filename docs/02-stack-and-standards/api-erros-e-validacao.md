# Erros e Validação da API — Contrato Único (ADR-015)

> Toda resposta de erro da API segue **um envelope só**, em **português**, com o **motivo real** — nunca um 500 genérico "erro no servidor". Validação é **zod** (com validadores BR para campos conhecidos), erros de banco viram status + código de negócio, e o front consome o envelope num **modal de mensagens padrão**. Esta é a fundação que toda tela/recurso herda.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-015** (este contrato), ADR-006 (erro tipado no monólito modular), ADR-012 (paridade com o legado).
- [backend-nestjs-standards.md](backend-nestjs-standards.md) — a hierarquia `AppError`, o `ZodValidationPipe` e o filtro global de exceção.
- [frontend-react-standards.md](frontend-react-standards.md) — `shared/ui` sobre o design system e o `zod` compartilhado back↔front.

---

## ADR-015 em uma frase

Falhou? Vira **`ErroResposta`**: `statusCode` ajustado + `code` estável + `message` em PT com o **motivo real** (+ `campos[]` quando há erro por campo). O operador lê o porquê em português, o erro é acionável, **nada** de stacktrace ou "erro no servidor" cru vazando, e o contrato é **o mesmo** dos dois lados.

---

## O shape do envelope

Contrato único, definido em `@apollo/shared` e consumido pelo back (ao montar a resposta) e pelo front (ao renderizar). Arquivo real: **`packages/shared/src/erro.ts`**.

```ts
// packages/shared/src/erro.ts — contrato ÚNICO back↔front
export interface CampoErro {
  campo: string;     // caminho do campo: 'descricao', 'itens.0.codrcb'
  mensagem: string;  // legível, PT-BR
}

export interface ErroResposta {
  statusCode: number;     // HTTP ajustado: 400/403/404/409/422/500…
  code: string;           // estável, MAIÚSCULAS_SNAKE: VALIDACAO, DUPLICADO, REGRA_NEGOCIO…
  message: string;        // motivo real, em português, legível pelo usuário
  campos?: CampoErro[];   // erros por campo (validação/obrigatórios) — opcional
}

// type-guard que o front usa para decidir se um body é o envelope padrão
export function isErroResposta(x: unknown): x is ErroResposta;
```

Regras do envelope:

- **`statusCode`** é o status real do problema, nunca achatado em 500. Validação → 400, regra de negócio → 422, conflito de dado → 409, etc. (ver tabela).
- **`code`** é **estável** e em `MAIÚSCULAS_SNAKE` — é a chave que o front trata programaticamente (e que não muda quando a mensagem muda). Espelha o `code` dos `AppError` do backend (ver [backend-nestjs-standards.md](backend-nestjs-standards.md)).
- **`message`** é o **motivo real em PT**, escrito para o operador, não para o dev. "CNPJ inválido", "Banco já cadastrado", "Selecione o banco antes de salvar" — não "violation of unique constraint uq_banco_codigo".
- **`campos[]`** só aparece quando há erro **por campo** (validação zod, obrigatório). É o que o form usa para grifar o input certo.

---

## Tabela de mapeamento de status

O filtro global (`all-exceptions.filter.ts`) é o **único** ponto que converte qualquer falha no envelope. Cada origem tem um destino fixo — **sem 500 genérico**, exceto o caso realmente inesperado (raro, logado com `tenantId`).

| Origem do erro | `statusCode` | `code` | `message` (PT, exemplo) | `campos[]` |
|----------------|:------------:|--------|--------------------------|:----------:|
| **zod** (falha de validação) | **400** | `VALIDACAO` | "Há campos inválidos no formulário." | **sim** (um por issue) |
| **FK** Postgres `23503` (foreign_key_violation) | **409** | `REGISTRO_RELACIONADO_INEXISTENTE` | "O registro relacionado não existe (ou está em uso)." | não |
| **unique** Postgres `23505` (unique_violation) | **409** | `DUPLICADO` | "Já existe um registro com esse valor." | quando dá p/ inferir o campo |
| **not-null** Postgres `23502` (not_null_violation) | **400** | `CAMPO_OBRIGATORIO` | "Campo obrigatório não informado." | sim (o campo nulo) |
| **check** Postgres `23514` (check_violation) | **422** | `REGRA_VIOLADA` | "Valor não atende a uma regra do sistema." | quando dá p/ inferir |
| **texto longo** Postgres `22001` (string_data_right_truncation) | **400** | `TEXTO_LONGO` | "Texto acima do tamanho permitido." | quando dá p/ inferir |
| **número inválido** Postgres `22P02` (invalid_text_representation) | **400** | `NUMERO_INVALIDO` | "Valor numérico inválido." | quando dá p/ inferir |
| **regra de negócio** (`BusinessRuleError`) | **422** | o `code` do erro (ex.: `BANCO_OBRIGATORIO`) | a mensagem do erro (PT) | quando relevante |
| **tenant** (`UnauthorizedTenantError`) | **403** | `TENANT_FORBIDDEN` | "Acesso negado ao tenant." | não |
| **não encontrado** | **404** | `NAO_ENCONTRADO` | "Registro não encontrado." | não |
| **desconhecido** (não mapeado) | **500** | `ERRO_INTERNO` | "Erro interno. A equipe foi notificada." | não |

> O último caso (`500 ERRO_INTERNO`) é **raro e indesejado**: significa que algo escapou do mapeamento. Ele é logado com `tenantId` e o erro cru, **sem** vazar detalhe na resposta. Todo `500` recorrente vira um item para mapear explicitamente — a meta é que ele praticamente não aconteça.

### Onde isto vive (backend)

- **`apps/api/src/shared/errors/all-exceptions.filter.ts`** — o `@Catch()` global. Recebe `AppError` (já tipado), `HttpException` do Nest, e **erros de banco** (lê o `code` do erro do driver Postgres e aplica a tabela acima), montando sempre o `ErroResposta`. É aqui que o mapeamento `23503/23505/23502/23514/22001/22P02 → status+code` mora.
- **`apps/api/src/shared/zod-validation.pipe.ts`** — o `ZodValidationPipe`: roda `schema.safeParse(value)`; no `!success`, lança `ValidationError` carregando o `error` do zod. O filtro transforma os issues do zod em `campos[]` (cada `path` → `campo`, cada `message` → `mensagem`).
- **`apps/api/src/shared/errors/app-error.ts`** — a hierarquia `AppError` (`code` + `httpStatus`): `BusinessRuleError` (422), `ValidationError` (`VALIDACAO`/400), `UnauthorizedTenantError` (403), `ForbiddenActionError`. O `code` do erro é o `code` do envelope.

> O filtro é a **fronteira**: regra de negócio e validação lançam exceções **tipadas** (nunca `throw new Error('...')` solto); o banco lança o erro do driver; o filtro converte tudo num envelope só. Quem chama nunca vê um shape diferente.

---

## Validação com zod + validadores BR

A validação usa **zod** como fonte única (mesmo schema do DTO no backend e do form no React — ver [frontend-react-standards.md](frontend-react-standards.md)). Para os campos brasileiros conhecidos, usamos os **validadores BR** prontos, que **normalizam (removem máscara) e validam dígito/checksum**, com mensagens em PT.

Arquivo real: **`packages/shared/src/validators/br.ts`** (exportado por `@apollo/shared`).

| Validador | Valida | Normaliza | Mensagem PT |
|-----------|--------|-----------|-------------|
| `zCpf` | 11 dígitos + 2 dígitos verificadores (checksum) | → só dígitos (11) | "CPF inválido" |
| `zCnpj` | 14 dígitos + 2 verificadores (checksum) | → só dígitos (14) | "CNPJ inválido" |
| `zCpfCnpj` | CPF **ou** CNPJ (PF ou PJ) | → só dígitos | "CPF/CNPJ inválido" |
| `zCelular` | telefone BR: 10 (fixo) ou 11 (celular) dígitos | → só dígitos | "Telefone/celular inválido (use DDD + número)" |
| `zEmail` | formato de e-mail | `trim` + `lowercase` | "E-mail inválido" |
| `zCep` | 8 dígitos | → só dígitos (8) | "CEP inválido" |
| `zUf` | sigla de 2 letras | `trim` + `uppercase` | "UF inválida (use a sigla de 2 letras)" |

> **Normalizam no parse:** o valor que sai do schema já vem **sem máscara** (`'123.456.789-09'` → `'12345678909'`), então o repository grava o dado limpo e o front pode mandar com ou sem máscara. O checksum é de verdade — `cpfValido`/`cnpjValido` rodam os dígitos verificadores e rejeitam sequências repetidas (ex.: `111.111.111-11`).

```ts
// uso em um schema de cadastro — o validador BR entra como campo do objeto
import { z } from 'zod';
import { zCpfCnpj, zCelular, zEmail, zCep, zUf } from '@apollo/shared';

export const clienteSchema = z.object({
  nome: z.string().min(1, 'Informe o nome'),
  cpfCnpj: zCpfCnpj,                 // valida checksum + normaliza p/ só dígitos
  celular: zCelular,
  email: zEmail,
  cep: zCep,
  uf: zUf,
});
export type ClienteForm = z.infer<typeof clienteSchema>;
```

Quando esse schema falha no `ZodValidationPipe`, cada issue vira uma linha em `campos[]`:

```jsonc
// resposta — ErroResposta para um CPF e um celular inválidos
{
  "statusCode": 400,
  "code": "VALIDACAO",
  "message": "Há campos inválidos no formulário.",
  "campos": [
    { "campo": "cpfCnpj", "mensagem": "CPF/CNPJ inválido" },
    { "campo": "celular", "mensagem": "Telefone/celular inválido (use DDD + número)" }
  ]
}
```

---

## O padrão do front: modal de mensagens

O front **consome o envelope** e exibe num **modal de mensagens padrão** — não com `alert()`, não com toast solto por tela, não com texto inline improvisado. Há **um** componente tratado para isso, exposto por um provider/hook.

Local-alvo: **`apps/web/src/shared/mensagem/`** (transversal, como `shared/keyboard` e `shared/ui`).

- **`MensagemProvider`** — Context no topo da árvore (junto dos demais providers em `apps/web/src/app/providers.tsx`). Mantém a fila/estado da mensagem ativa e renderiza o **Modal/AlertModal do design system**.
- **`useMensagem()`** — hook que qualquer feature usa para disparar uma mensagem: `mostrarErro(erro)`, `confirmar(...)`, `info(...)`. O `mostrarErro` recebe o body da API, roda `isErroResposta`, e renderiza `message` + (se houver) a lista de `campos[]`.
- **Modal / AlertModal** — vêm do **design system** (ADR-013/ADR-014), não são `<div>` cru. O modal de erro é o `AlertModal` (variante de alerta).

```tsx
// apps/web/src/app/providers.tsx — o provider entra com os demais
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <MensagemProvider>          {/* fila + Modal/AlertModal do DS */}
        <ShortcutProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </ShortcutProvider>
      </MensagemProvider>
    </QueryClientProvider>
  );
}
```

```tsx
// consumo numa mutation — o erro da API cai direto no modal padrão
import { useMensagem } from '@/shared/mensagem';

function useSalvarCliente() {
  const { mostrarErro } = useMensagem();
  return useMutation({
    mutationFn: clientesApi.salvar,
    onError: (e) => mostrarErro(e),   // isErroResposta + message(PT) + campos[] no AlertModal
  });
}
```

> Divisão de responsabilidade no front: erros **por campo** (`campos[]`) grifam o input no `react-hook-form` (mapeando `campo` → `setError`); a **mensagem geral** (`message`) e/ou a lista consolidada de campos aparecem no **modal padrão**. O front nunca inventa texto de erro — ele **exibe** o `message` em PT que o backend já mandou.

---

## Checklist (toda rota nova)

- [ ] DTO/validação via **zod**; campos BR usam os validadores de `@apollo/shared` (`zCpf`/`zCnpj`/`zCpfCnpj`/`zCelular`/`zEmail`/`zCep`/`zUf`).
- [ ] Regra de negócio lança **`AppError` tipado** (`code` estável), nunca `throw new Error('...')`.
- [ ] **Nenhum** `try/catch` que devolva 500 cru ou vaze stacktrace — deixa o filtro global mapear.
- [ ] No front, erro tratado com **`useMensagem().mostrarErro(e)`** (modal padrão), e `campos[]` mapeado para os inputs do form.
- [ ] Mensagem em **PT**, com o motivo real, escrita para o operador.

---

## Ver também

- [backend-nestjs-standards.md](backend-nestjs-standards.md) — hierarquia `AppError`, `ZodValidationPipe`, filtro global.
- [frontend-react-standards.md](frontend-react-standards.md) — `zod` compartilhado, forms react-hook-form, `shared/ui` sobre o DS.
- [../09-design-system-and-ai/](../09-design-system-and-ai/) — Modal/AlertModal do design system (ADR-013/ADR-014).
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-015** e correlatos (ADR-006, ADR-012).
- Código real: `packages/shared/src/erro.ts`, `packages/shared/src/validators/br.ts`, `apps/api/src/shared/errors/all-exceptions.filter.ts`, `apps/api/src/shared/zod-validation.pipe.ts`, `apps/web/src/shared/mensagem/`.
