# FRMCONGELAESTOQUE — Congelar estoque

**4 acessos · 2 operadores.** `UCongelaEstoque.pas`. Migration **269**.
API `GET cadastro/congela-estoque`, `POST …/congelar`, `POST …/descongelar`. Tela
`/cadastro/congela-estoque`. Smoke §147 (2 checks).

## 1. O que faz

A **foto do estoque** usada pelo balanço/inventário. Congelar (`CongelarEstoque`, linha 137):

```sql
update estoque     set qtde_cong = qtde, qtde_bk = qtde where idempresa = :emp;
update estoque_dep set qtde_cong = qtde, qtde_bk = qtde where idempresa = :emp;
-- e na empresa: FLAGETQCONG='S', USUCONGETQ, DATACONGETQ  (+ GravarLog)
```

Descongelar levanta a marca — **a foto continua gravada**. As duas operações pedem liberação separada
("Usuário não possui permissão para congelar/descongelar estoque") e correm em transação única com
rollback em caso de erro.

## 2. O que o dado diz (produção, 18/09/2026)

| | |
|---|---:|
| empresas congeladas agora | **0** (`FLAGETQCONG='N'` nas 5) |
| `ESTOQUE` com `QTDE_CONG`/`QTDE_BK` preenchidos | **100%** (47.716 na loja 1; idem `ESTOQUE_DEP`) |
| foto divergente do saldo atual | loja 1: **13.960** (29%) · loja 2: 5.748 · 51: 387 · 50: 6 · 52: 0 |
| `USUCONGETQ` / `DATACONGETQ` | **nulos nas 5** — a foto foi tirada sem deixar quem nem quando |

A divergência é o comportamento esperado de uma foto antiga; o que não é esperado é não saber de quando.

## 3. O que o Apollo faz

- Grava **sempre** operador e data, e mantém o histórico em `congelamento_estoque` (o legado chama
  `GravarLog` e não deixa rastro consultável).
- A tela mostra, antes de agir, quantas linhas já divergem da foto e por quanto.
- Congelar com a empresa já congelada é 422 `ESTOQUE_JA_CONGELADO`; descongelar sem estar, 422
  `ESTOQUE_NAO_CONGELADO`. Dois grants distintos (`BTNCONGELAR` / `BTNDESCONGELAR`), como no legado.
- Colunas novas no destino: `estoque.qtde_cong/qtde_bk`, `estoque_dep.qtde_cong/qtde_bk`,
  `empresas.flagetqcong/usucongetq/datacongetq`.
