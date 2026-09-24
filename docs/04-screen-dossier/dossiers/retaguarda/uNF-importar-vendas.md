# NF DE CUPOM — importar VENDAS na NF de saída (`btnAddPedidoClick` opção 1, `ImportaVenda`)

| | |
|---|---|
| **Status** | **C1 ENTREGUE** (23/09/2026, smoke 1482/0): `nf-vendas.service.ts` + `NfVendasModal` + disparo pela situação 'VE'. C2/C3 abaixo. |
| **Fonte** | `uNF.pas:1774` (opção 1) → `ImportaVenda` (:13201-13475), `IncluiProd` (:13637-13810), `RealizaAjusteDeValores` (:13066), `SetaPedido` com `VendaNFC='S'` (:15914 — referência da NFC-e), gravação `fListaImportacaoVendas` (:5236-5247) |
| **Disparo** | situação 9 "NOTA FISCAL DE CUPOM" com `IMPORTACAO_AUTO_NF='VE'` (uNF.pas:14396) |
| **Uso** | **170 NFs em 2024, 337 em 2025, 375 em 2026** (CFOP 5929/6929), crescendo. NF_REFERENCIA modelo 65: 458 referências em 375 NFs de 2026. |

## 1. O fluxo (fonte de mai/2020)

1. Pesquisa `GET_VENDAS` (`CANCELADO='N'` da empresa), multisseleção, verde = `IMPORTADO='S'`.
2. `NFCProcessada`: venda NFC-e (`NFC='S'`) só entra se a NFC-e está autorizada (`NFC.STATUSNFE='P'`, casada por
   pedido + série + empresa + dia). Parte não processada → pergunta; todas → recusa.
3. Venda já importada: mostra a NF em que entrou (`qryNumNf`) e pede a **senha ADM** para continuar.
4. Cliente = o `CODCLIENTE` da venda; sem cliente e sem parceiro na nota → pede o cliente.
5. CFOP 5929 (mesma UF) / 6929; zera os totais de ICMS do cabeçalho.
6. Para cada venda: `cdsVenda` (os itens do pedido/cupom), `SetaPedido(CODVENDAS,'V',VENDA_NFC)` — NFC-e → linha
   em NF_REFERENCIA (modelo 65, `CODNF_REF = CODNFC`); cupom ECF → lista na OBS ("Nota Fiscal Referente ao(s)
   Cupom(ns): …"). Cada item vira linha da NF (`IncluiProd`):
   - valor = `VENDAS.VRVENDA` (em VRCUSTO **e** VRVENDA), quantidade, `ARREDONDA` = 'S' se `IAT='A'`;
   - desconto em dinheiro = desc. promoção + desc. departamento + desc./acr. médio e do item quando negativos;
     acréscimos positivos → `DEPSACESS`;
   - alíquota = a da venda ("vem do PDV"); CFOP 5929/6929; NCM/CEST/código do produto;
   - `ZERAR_ICMS_IMPORTACAO_CUPOM` (config) → ICMS 0, base 0, e CST por pessoa física/jurídica (fonte: 41 em MG).
7. `AGRUPA_PRODUTO_IMPORT_VENDA` → agrupa por produto (Locate) e roda `RealizaAjusteDeValores`.
8. Ao GRAVAR: `UPDATE VENDAS SET IMPORTADO='S', CODPARCEIRO=<cliente> WHERE NROPEDIDO=…`; com
   `SUBSTITUI_FINANCEIRO_GERAR_NF` apaga o ARECEBER não quitado do pedido.

## 2. Produção (lida em 23/09/2026)

- Configs (binário novo, em CONFIGURACOES): `ZERAR_ICMS_IMPORTACAO_CUPOM` 'S' (e módulo Retaguarda 'S');
  `AGRUPA_PRODUTO_IMPORT_VENDA` global 'N', **módulo Retaguarda 'S'** (lição 134) → agrupa;
  `SUBSTITUI_FINANCEIRO_GERAR_NF` 'N' → o AR do cupom fica.
- Itens de 2026 (2.662): ICMS 0 e base 0 em 2.645; `ARREDONDA='S'` em 2.661; VRVENDA = VRCUSTO em 2.375.
- ⚠️ **CST não segue o fonte**: a mesma alíquota sai com CSTs diferentes (IST → 40/90/41; STB → 60/41; T03 → 90/41/0).
  O fonte de 2020 força 41 em MG; o binário novo decide por outra regra — **a descobrir no dado** antes de converter.
- NF_REFERENCIA tem `CODNF, CODNF_REF, MODELO, CHAVENFE` (a NFC-e pela chave). A tabela NFC não migra (é do PDV):
  a referência no Apollo tem de ir pela CHAVE (`vendas.chavenfe`, derivada na carga — `extrair.py` CALCULADAS).
- A OBS das NFs traz "Notas Fiscais Ref.: <chaves>" (montada na transmissão a partir da NF_REFERENCIA).

## 3. Respostas do recon (produção, 23/09/2026)

1. **CST com o ICMS zerado** (binário novo; o fonte forçava 41 em MG): pessoa física → **41** (857 de 863);
   CNPJ com a venda em ST (`VENDAS.ICMS_CST='60'`) → **60** (743/743); CNPJ não contribuinte (`CONTRIBUINTE_ICMS='9'`)
   com a venda isenta (40) → **40** (505/527); demais CNPJ → **90** (476/530). ~95% no total; fora de MG, o CST da
   alíquota (o fonte). Os desvios podem ser parceiro que mudou de cadastro depois da nota.
2. `RealizaAjusteDeValores`: no agrupado, o unitário anda de 0,0001 até o total da linha (arredondado/truncado pelo
   IAT) bater com a soma das linhas dos cupons, quando a diferença é de até R$ 0,09 — só acontece com quantidade
   fracionada (VRVENDA tem 2 casas no legado).
3. `GET_VENDAS` agrupa por `CODVENDAS` = o CUPOM (1.085 cupons, 4.741 itens num dia). A carga renomeia o CODVENDAS do
   legado para `codvendas_legado` (o nosso `codvendas` é o id da linha) — é por ele que o Apollo agrupa e liga a
   PEDIDO_NF 'V'.
4. `VENDAS.IMPORTADO='S'` em 431 pedidos de 2026 (375 NFs, 458 referências NFC-e); a NFC-e liga pela referência
   modelo 65, a PEDIDO_NF 'V' só existe para cupom ECF (0 nas NFs de 2026).
5. `IncluiProdDevoucaoVendas` (:13818) é a opção de ENTRADA (devolução de venda, situação 2) — 1 por ano, depois.

## 4. Cortes propostos

- **C1** ✅ — pesquisa dos cupons por período (a VENDAS é grande), prévia (itens com o valor/IAT/descontos/alíquota da
  venda, CFOP 5929/6929 pela UF do cliente do cupom, agrupamento + ajuste, ICMS zerado com o CST medido), NFC-e não
  processada fica de fora, reimportação só com a senha administrativa (a senha de operação 'admin'), NFC-e
  referenciada pela CHAVE (modelo 65), cupom ECF na OBS; vínculo no gravar (`VENDAS.IMPORTADO` + CODPARCEIRO do
  cupom, PEDIDO_NF 'V' do ECF, `SUBSTITUI_FINANCEIRO_GERAR_NF` apaga o AR do cupom); estorno na exclusão e no
  cancelamento (`AtualizaStatusCupomFiscal`); a situação com `IMPORTACAO_AUTO_NF='VE'` abre a importação.
- **C2** — a mensagem "Notas Fiscais Ref.: <chaves>" na OBS (montada na transmissão) e a DEVOLUÇÃO DE VENDA de entrada
  (`IncluiProdDevoucaoVendas`, situação 'DE', 1 por ano).
