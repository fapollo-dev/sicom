# FRMRELBALANCO — Balanço patrimonial

**8 acessos · 3 operadores.** `uRelBalanco.pas` (239) + `udmRelBalanco`. Migration **265**.
API `GET contabil/balanco` (+ `/impressao`). Tela `/contabil/balanco`. Smoke §143 (3 checks).

## 1. O que faz

O irmão patrimonial do balancete (mig 258): mesmas contas e mesmo diário, mas **só ativo e passivo**
(`PP.CODIEXPANDIDO < '3'`) e numa **data**. Saldo anterior = tudo lançado antes do 1º dia do mês da data;
débito e crédito = o movimento do mês até a data; saldo atual = anterior + débito − crédito. Débito soma
positivo, crédito negativo no saldo anterior (`SUM(D.VALOR)*-1`). Checkboxes: Degrau (indentação por
nível), Analíticas e Sem movimento. Impressão em .fr3 com página inicial configurável.

## 2. O modo "só sintéticas" devolve zero linhas — e é o PADRÃO da tela

Desmarcar "Analíticas" acrescenta `AND PP.CLASSE = 'S'`, e no `uRelBalanco.dfm` o "Imprime Contas Analíticas" vem **desmarcado**. Em
produção (18/09/2026) `PLANO_CONTAS.CLASSE` tem só dois valores:

| classe | contas | nas patrimoniais (< '3') |
|---|---:|---:|
| A | 10.950 | 10.816 |
| T | 78 | 55 |
| **S** | **0** | **0** |

Abrir a tela e imprimir dá "Não há lançamentos no filtro informado informado. Verifique!" — o operador precisa marcar "Analíticas".

## 3. ✅ Corte 2 pelo fonte (06/10/2026)

O corte 1 tinha trocado regras do legado: inventou um filtro de nível (o legado não tem), fez "sintética = tem filha" no lugar do
`CLASSE = 'S'`, pôs o ponto no prefixo e usava só a loja do login. Refeito pelo `btnImprimirClick`:
- o roll-up `Q.CODIEXPANDIDO LIKE PP.CODIEXPANDIDO || '%'`, **sem separador** (o "1.1" pegaria um "1.10"; o plano do cliente tem largura
  fixa por nível — 1, 3, 6, 9, 14-15 posições — e não tem esse caso). A soma por prefixo roda no serviço: o `LIKE` entre as 11 mil contas
  e o movimento custaria segundos, e o resultado é o mesmo para códigos sem `%`/`_`;
- "Analíticas" desmarcado = `CLASSE = 'S'` (vazio no cliente), e desmarcado por padrão;
- "sem movimento" desmarcado filtra as **linhas** do movimento antes de somar: a conta com débito e crédito iguais aparece com saldo 0;
- as lojas do `GetMultiEmpresa`; a descrição em degrau (um espaço por posição do código); sem ORDER BY no legado — aqui pelo código;
- **Imprimir**: o legado não carrega arquivo — imprime o `frxReport1` **desenhado no próprio .dfm**. O XML equivalente é gerado do fonte
  por `tools/relatorios/dfm-para-fr3.py` (módulo `relatorios-embutidos.ts` da API, `modeloEmbutido('frmRelBalanco.frxReport1')`). Datasets
  `dbdConsulta` e `dbdEmpresa` — este com o SQL fixo `WHERE E.CODEMPRESA IN (1)` no `udmRelBalanco.dfm`, nunca reaberto pela tela: sai
  **sempre a loja 1** com o contabilista. Variáveis DtInicial, Empresa (a lista) e PaginaInicial (o rodapé é `<Page>+<PaginaInicial>-1`).
  O título do layout é "CONTABILIDADE PFDRÃO - BALANÇO PATRIMONIAL" (o erro de digitação é do layout). Sem opção de impressão na
  PERMISSOES: o acesso à tela.

## 4. Outros

- a fronteira do saldo anterior (`edtDtIni − dia + 1`) vai na resposta como `competencia`; a tela mostra o saldo das raízes 1 e 2;
- 131.487 lançamentos de 2026 tocam contas patrimoniais (R$ 134,1 mi).
