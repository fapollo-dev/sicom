# FRMDEVOLUCAOVENDAS — Devolução de vendas

**3.958 acessos · 36 operadores** (último em 17/09/2026). `uDevolucaoVendas.pas` (1.019) +
`udmDevolucaoVendas`. Migration **275**. API `relatorios/devolucao-vendas` (buscar venda, motivos,
registrar, reverter, consultar). Tela `/relatorios/devolucao-vendas`. Smoke §152 (4 checks).

## 1. ⚠️ Esta tela não estava na fila — nem no Apollo

A `FILA-CONVERSAO.md` (194 telas) foi gerada cruzando o `MENUEXPRESS` com os `FRM*` presentes em
`apps/api`. Uma varredura em 18/09/2026 mostrou **8 formulários com uso que ficaram fora dos dois lados**,
somando **43.071 acessos**:

| tela | acessos | op. | último acesso | o que é |
|---|---:|---:|---|---|
| `FRMFECHAMENTOSANGRIA` | 36.522 | 38 | 18/09/2026 | PDV (fora de escopo por instrução) |
| **`FRMDEVOLUCAOVENDAS`** | **3.958** | **36** | 17/09/2026 | **esta — retaguarda** |
| `FRMNFCE` | 1.444 | 13 | 17/09/2026 | PDV |
| `FRMMANCADCARTAOBOAVISTA` | 560 | 6 | 20/05/2026 | cartão Boa Vista (sem unit no repositório) |
| `FRMVERIFICACAOTRIBUTARIABORBAFISCAL` | 388 | 3 | 15/06/2026 | integração Borba Fiscal (já conhecida) |
| `FRMCADPDV` | 93 | 8 | 01/06/2026 | PDV |
| `FRMCADDEVOLUCAO` | 91 | 16 | 19/08/2026 | devolução ao fornecedor (`I_DEVOLUCAO`) |
| `FRMCADBALANCO` | 15 | 4 | — | `BALANCO` (8 linhas) |

## 2. O que a tela faz

O cliente volta à loja com mercadoria comprada. O operador acha o cupom (PDV + número, ou por período),
marca os itens e a quantidade devolvida, escolhe um **motivo** (`motivos_operacao` com
`TIPO_OPERACAO='DEVOLUCAO'`) e registra. Também reverte um registro feito por engano.

## 3. ⚠️ A regra mais importante está num comentário do fonte: o estoque NÃO volta

`btnEstornarClick` (`uDevolucaoVendas.pas:400-403`) tem o `UPDATE ESTOQUE ... QTDE + devolvido`
**comentado**, com a razão em caixa alta:

```pascal
//ESTOQUE NÃO DEVE SER ALTERADO SEM PROCESSO FISCAL
//dmPrincipal.FDConexao.ExecSQL('UPDATE ESTOQUE SET QTDE = QTDE + ...
```

A devolução de venda **registra e marca**; quem devolve mercadoria ao estoque é a **NF de devolução**.
Copiado exatamente assim — a resposta da API diz `estoqueAlterado: false`, e o smoke prova que o saldo
não se move. É o tipo de regra que, "melhorada" por conta própria, criaria estoque do nada.

## 4. As outras regras, do fonte e do dado

- a marca na venda é `DEVOLUCAO='D'` + `QTDE_DEVOLVIDO` + `TOTAL_ITEM_DEVOLVIDO`;
- **a reversão grava o literal `' '` (espaço), não NULL** — e o dado confirma: 6 itens com espaço em 2026;
- o registro é único por (venda, produto, empresa, item): o legado consulta antes de inserir
  (`RetornarValores`), aqui é índice único;
- **`GeraSaldoCliente`** (crédito ao cliente, gated pela config `GERA_SALDO_CLIENTE_DEVOLUCAO_VENDA`)
  fica **fora do corte, com prova**: `CODAPG_DEVOLUCAO_SALDO` tem **0 de 3.658** — nunca foi usada.

## 5. O que o dado diz (produção, 18/09/2026)

| | |
|---|---:|
| `DEVOLUCAO_VENDAS` | **3.658 linhas** |
| por ano | 2020: 173 · 2021: 813 · 2022: 846 · 2023: 347 · 2024: 541 · 2025: 688 · **2026: 250** |
| valor devolvido em 2026 | R$ 4.466,96 |
| com motivo | 3.583 de 3.658 |
| empresas | 2 |
| `VENDAS.DEVOLUCAO='D'` em 2026 | 243 itens (e 6 com `' '`, o valor que a reversão grava) |

## 6. O que o Apollo faz a mais

Tenant-scoped em toda perna (item de venda de outra loja é 422); venda **cancelada** não entra; recusa
devolver mais do que foi vendido (`QTDE_DEVOLVIDA_EXCEDE`) e devolver duas vezes o mesmo item
(`ITEM_JA_DEVOLVIDO`); grava o **código** do operador além do nome (o legado só guarda o nome); tudo numa
transação com `FOR UPDATE` no item; grants separados para registrar e reverter.
