# Processamento rápido de nota fiscal — `TFrmProcessaNotaFiscal` (`uProcessaNotaFiscal.pas`)

> Fonte: `uProcessaNotaFiscal.pas` (1.851 linhas) + `.dfm`; chamada em `TfrmNF.ProcessarNotaPeloCodigo` (uNF.pas:15138), só depois da
> nota de transferência (uNF.pas:7591-7600). Produção (só leitura, 08/10/2026): a LOG "Processamento rápido de nota fiscal" tem **157
> notas** (40 em 2024, 79 em 2025, 38 em 2026) — **todas entradas CFOP 1152**, ou seja, todas as entradas de transferência do período
> (2024: 42 processadas, 2025: 80, 2026: 37). Os 5 operadores que a usaram têm acesso à loja de destino.
> Apollo: `fiscal/nf/:id/processamento-rapido*` (`NfProcessamentoRapidoService`), janela `NfProcessamentoRapidoModal`, smoke §267.3,
> jsdom `nfProcessamentoRapido.spec.tsx`.

## O fluxo

Na loja de origem, "Nota de transferência entre lojas" grava a ENTRADA na loja destinatária e pergunta: *Nota de transferência gerada
para a empresa: "X", Código: N. Deseja processar esta nota fiscal?* O Sim abre esta janela sobre a nota da OUTRA loja, sem trocar de
sessão. Antes, o Apollo dizia "Confira e processe nessa loja" — o operador tinha de entrar na loja de destino.

## A janela

- Os dados da nota (`QryNotaInfo`): código, número, série, emissão, chave, situação, CFOP, parceiro, CNPJ, total; a loja (FANTASIA);
  "PROCESSADA" e o Processar desligado quando já está.
- As 7 pendências (`CarregaPendencias` :1136-1300), R/P: F4 situação de documento; F5 pedido de compra (só com o CONFIGURA "CONFERIR
  PEDIDO COMPRA NA NF DE ENTRADA" = SIM — a produção não tem a linha, o padrão é NÃO: sempre R); F6 lançamentos contábeis (com a
  integração, Σ = total da nota); F7 a CFOP de cada item na situação do item; F8 a da nota na situação da nota; F9 os indexadores (a regra
  da loja 'O', fora das CFOPs isentas 1152/1409/2401); F10 os itens não repassados (fora da devolução e da transferência).
- **F4** (`VincularSituacaoDeDocumento` :1636): só as situações do tipo da nota com alguma CFOP de transferência (CFOP.PROC_TRANSF),
  com a lista das CFOPs; grava na nota e em todos os itens. Sem nenhuma, "Situação de documento não definida!". Na produção as 120
  entradas de 2025-26 usam a 15 "TRANSFERENCIAS - ENTRADAS".
- **F6** (`VincularLancamentoContabil` :1723): a grade dos lançamentos e o preenchimento pelos centros de custo da situação (o
  `InserirCentroDeCustosDefinidos` da tela de lançamentos — o mesmo rateio do gravar da NF). A situação 15 tem um centro de custo e as
  117 entradas processadas têm a linha com o total exato.
- **F5 / F7–F10** abrem, no legado, a análise do pedido e a dos itens da nota; aqui se resolvem na nota fiscal da loja de destino (a
  janela avisa). Numa transferência essas pendências não abrem (sem pedido; CFOP isenta de indexador e de repasse).
- **Processar** (`ProcessarNotaFiscal` :1038): "A nota selecionada já processada!"; as travas próprias da janela — a situação obrigatória
  quando há situação cadastrada (`VerificaSituacaoDeDoc` :166), o pedido NÃO LIBERADO (`VerificaPedidoCompra` :188) e os lançamentos da
  integração (`ValidaLancContabeisSicom` :858: sem lançamento, valor zerado, soma ≠ total, item com situação sem lançamento) — e depois a
  tela de processar (o TfrmEstoqueNF: preço on-line/lote, custo) e o processamento da NF com as demais travas.

## Decisões

- **A loja**: a nota tem de ser de uma loja do operador (`todasAsEmpresasDoOperador`) — o legado não confere, mas na produção todos os
  que a usaram têm o vínculo. O processamento, o rateio e a LOG rodam **na loja da nota** (estoque, preço, configurações de lá); o
  legado lia as configurações da sessão (a origem) — com as lojas configuradas igual, o efeito é o mesmo.
- **A LOG** sai com FORMULARIO "Processamento rápido de nota fiscal", como a produção (o TLog grava o título da janela ativa).
- O portão é o da tela da NF (`FRMNF`): a janela não confere outra permissão.
