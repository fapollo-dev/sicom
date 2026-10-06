# VENDAS E FINALIZADORAS (`FRMRELFINALIZADORAS`) — completa (impressão em 06/10/2026)

`UrelFinalizadoras.pas` (1.035) + `.dfm`. **7.920 acessos, 9 operadores** (MENUEXPRESS). API `relatorios/finalizadoras`
(`consultar`, `impressao`), tela `/relatorios/finalizadoras`. RBAC: o BTNCONSULTA da tela (é a opção que o legado permissiona).

## 1. A consulta (`btnConsultaClick`)

Uma linha por **dia com movimento** (o dia sem nada é apagado do `cdsTemp`): TOTAL_VENDA (venda líquida: bruto com IAT 'A'
arredondado e os demais truncados, − descontos de promoção/departamento/acréscimo negativo, + acréscimos positivos), DESCONTO,
ACRESCIMO, CANCELAMENTO (o mesmo líquido das vendas CANCELADAS) e uma coluna por forma de pagamento cadastrada (`GetForma`: espaço e
hífen viram `_`) com Σ `CX_VENDAS.VALOR − TROCO` das linhas de VALOR > 0. Depois, a linha dos **totais** e a da **participação** (cada
forma ÷ total de venda × 100; 0 se o total é 0). As lojas são as do `GetMultiEmpresa` — **o Apollo usava só a do login**; agora as
marcadas, recortadas às do operador.

## 2. A impressão (`btnImprimirClick`, `RgpOrientacaoFP`)

- **Horizontal** — `Rel_Finalizadoras.fr3` (PERSONALIZADO 972) tem só DATA e as quatro medidas; o legado **cria um memo por forma de
  pagamento** no PageHeader1 (o título = a MODALIDADE) e no MasterData1 (`[formatFloat(',0.00',<FrxFinalizadoras."FORMA">)]`), a partir
  de Left 398, de 90 em 90, largura = tamanho da MODALIDADE (30) × 3, Courier New 8, à direita, Top = altura da banda − 23 / − 19. O
  servidor monta esses memos no XML do layout. O dataset é o `cdsTemp` inteiro (os dias + a linha dos totais + a da participação).
- **Vertical** — `Rel_Finalizadoras_Vertical.fr3` (973): cada campo do dia vira uma linha (DATA, FORMA_PGTO, VALOR) e a linha dos totais
  vai no `FrxDBTotais`; V_TOTAL_VENDA = o total de venda (o "% do total" da 2ª página). O nome da forma é `CorrigePalavra(DisplayLabel)`,
  e o DisplayLabel é o título que o `Corrigegrid` deu à coluna da grade (a grade não tem colunas fixas, então o título grava no campo):
  primeira letra maiúscula, resto minúsculo, `_` → espaço — "Total venda", "Descontos", "Acréscimos", "Cancelamentos", "Pix pos". O
  script do layout reconhece as quatro medidas pelo nome, tira da lista e as usa no rodapé de cada dia.
- **`CorrigePalavra`** está no `FuncoesApollo` (ausente). O dado prova o comportamento: o fechamento de caixa grava
  `' em ' + CorrigePalavra(AnsiLowerCase(OPERACAO))` no histórico da MOV_CONTAS_BANCARIAS e a produção (2026) tem "convênio", "devolução",
  e "cartoes", "pos", "pix", "pix pos", "dinheiro" sem mudança: devolve o acento das palavras que conhece, mantendo a caixa
  (`corrigePalavra` em rel-finalizadoras.service.ts, com as duas palavras provadas).
- PERIODO "Periodo: dd/mm/aaaa até dd/mm/aaaa".

## 3. O motor de impressão (06/10/2026)

O script do vertical chama `VerificaFP(MasterData1, <FORMA_PGTO>, <VALOR>)` — o interpretador **pulava a lista de parâmetros** dos
procedimentos do script, e o corpo rodava sem eles. Agora os argumentos são ligados (o objeto passado vai por referência), o que também
fez funcionar o Compras1.fr3 (Add/SetTotal: os totais nos cabeçalhos dos grupos) — com o `TStringList.IndexOf`, que faltava.

## 4. Cobertura

Smoke §47q (o "Imprimir" nos dois layouts: os memos por forma no XML, o cdsTemp com totais e participação, os rótulos do vertical,
V_TOTAL_VENDA, sem dados → 422); testes de renderização dos dois layouts (972/973).
