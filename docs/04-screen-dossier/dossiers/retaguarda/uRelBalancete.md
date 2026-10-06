# FRMRELBALANCETE — Balancete de verificação

**14 acessos · 4 operadores.** `uRelBalancete.pas` (384) + `udmRelBalancete`. Migration **258**.
API `GET contabil/balancete`. Tela `/contabil/balancete`. Smoke §136 (4 checks: §136.1-3 o cálculo, §136.4 a impressão); teste de renderização do 663.

## 1. O que faz

Por conta do plano: **saldo anterior** (Σ débitos − Σ créditos antes do período), **débitos** e **créditos** do
período, **saldo atual**. Faixa de contas pelo código expandido, nível máximo, descrições em degrau, imprimir
analíticas, sintéticas em negrito, contas sem movimento. Fonte: `DIARIO` (1,77 milhão de lançamentos; 131 mil
em 2026) × `PLANO_CONTAS`.

## 2. ~~O roll-up do legado só anda sobre contas com NIVEL~~ — ❌ FALSO (corrigido em 06/10/2026)

O corte 1 afirmou que o laço `for vNivel := vUltimoNivel-1 downto 1` "nunca visita as 10.641 contas sem NIVEL" e que os totais dos pais
ficavam sem a maior parte do movimento — e trocou o roll-up por um **por prefixo**, com o nível derivado do código. **Não é o que o fonte
faz:** o laço visita os **pais** por NIVEL e, para cada um, soma os filhos pelo **`CODPAI`** (`cdsConsulta.Filter := 'CODPAI = ' + ...`),
sem exigir nível do filho. Medido na produção (06/10/2026):

| | |
|---|---:|
| `MAX(NIVEL)` do plano | 5 (o laço anda de 4 a 1) |
| contas com NIVEL 1-4 (todas CLASSE T) | 3 · 10 · 18 · 47 |
| contas com lançamento | 658 = 138 de NIVEL 5 + 520 sem NIVEL |
| **o pai delas** | **NIVEL 4, CLASSE T — todas as 658** |

Todo o movimento sobe. O prefixo dava o mesmo número no plano do cliente, mas não as mesmas regras (abaixo); refeito pelo fonte.

## 2b. ✅ Corte 2 — o `btnImprimirClick` (06/10/2026)

- **o "nível" do combo é o comprimento do código** (`LENGTH(PP.CODIEXPANDIDO) <= n`; itens 1-8, 8, 10, 15, 20, 25, 30, padrão 30), aplicado
  **no SQL, antes de totalizar**: um filho cortado não soma no pai — com o combo abaixo de 15 os totais das sintéticas saem **zerados**, e
  sem "contas sem movimento" o relatório sai vazio (o corte 1 tratava como nível 1-5 e somava tudo);
- `TotalizaContasSinteticas` **substitui** o valor da conta do nível pela soma dos filhos que estão na consulta (o lançamento próprio de
  uma conta T some; a faixa de contas também corta os filhos: a faixa 9.1 → 9.1.01.01.00001 soma em 9.1 só a primeira analítica);
- as lojas do `GetMultiEmpresa` (era só a do login); `DATALAN BETWEEN` (a coluna não tem hora — 417 mil lançamentos desde 2025, nenhum);
- a descrição em degrau (um espaço por posição do código, até 20) e a ordem `CODIEXPANDIDO;DESCRICAO`;
- consulta vazia: "Não há lançamentos no filtro informado informado. Verifique!" (o texto do legado, com a palavra repetida);
- **Imprimir** → `BalanceteVerificacao.fr3` (663): `dbdConsulta`, `dbdEmpresa` (`sqqEmpresa`: as lojas com o CRC e o NOME do
  CONTABILISTA) e as variáveis DtInicial, DtFinal, Empresa (a lista), PaginaInicial (`edtPagina`, padrão 1) e Negrito. O script do layout
  formata os saldos com `FormatFloat('0.00,;"("0.00,")"')` — a vírgula depois dos decimais liga o separador de milhar no Delphi; o motor
  do Apollo só ligava com a vírgula na parte inteira (corrigido no `formato.ts`). Sem opção BTNIMPRIMIR na PERMISSOES: o acesso à tela.

## 3. Folds

- As lojas pedidas recortadas pelas do operador (`empresasDoOperador`); o plano é global.
- A grade da tela é a prévia do relatório (o legado só imprime); o total do rodapé da tela soma as raízes (NIVEL 1).
