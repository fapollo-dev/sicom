# O que falta migrar — ranking por USO REAL (não por contagem de telas)

O placar de conversão conta telas. Esta lista conta **acessos**: o legado registra o uso de cada formulário em
`MENUEXPRESS.ACESSOS`, e são **3.024.930** acessos acumulados. É a medida honesta do que dói faltar.

> **O Apollo cobre 98% do uso real.** As telas ausentes somam 46.159 acessos — 2% do total.

E o topo do que falta é escopo já decidido: as três primeiras (sangria, consulta NFC-e e devolução de vendas)
são **PDV**, fora por instrução do usuário, e sozinhas valem 67% do que resta.

| tela | acessos | operadores | último acesso | situação |
|---|---|---|---|---|
| FECHAMENTO DE SANGRIA (`FRMFECHAMENTOSANGRIA`) | 13,976 | 43 | 2026-09-05 | PDV — fora de escopo |
| CONSULTA NFC-E (`FRMNFCE`) | 13,048 | 22 | 2026-09-05 | PDV — fora de escopo |
| DEVOLUCAO DE VENDAS (`FRMDEVOLUCAOVENDAS`) | 4,050 | 45 | 2026-09-05 | PDV — fora de escopo |
| RELATORIO GERAL (`FRMRELATORIO`) | 1,759 | 20 | 2026-09-03 | ✅ **migrada** (construtor, mig 202-203) — o catálogo era o `COMMENT` da view |
| CONTROLE DE ACESSO (`FRMCTRLPERMISSOES`) | 968 | 15 | 2026-09-02 | era nossa: grant errado, corrigido (mig 196) |
| GERADOR SPED FISCAL (`FRMSPEDFISCAL`) | 896 | 25 | 2026-09-04 | era nossa: grant errado, corrigido (mig 196) |
| INTEGRACAO CONTABIL (`FRMTRON`) | 781 | 19 | 2026-08-31 | ✅ **migrada** (3 cortes, mig 199-201) |
| FECHAMENTO DIARIO (`FRMFECHAMENTODIARIO`) | 740 | 25 | 2026-09-01 | ✅ **migrada** (mig 198 + tela) |
| ANALISE DE NOTAS FISCAIS (`FRMNFANALISE`) | 704 | 19 | 2026-09-04 | ✅ **corte-1** (mig 204): tributária + conferência; faltam 7 das 9 análises |
| SALDO DA EMPRESA (`FRMSALDOEMPRESA`) | 611 | 19 | — | fila |
| FRMMANCADCARTAOBOAVISTA (`FRMMANCADCARTAOBOAVISTA`) | 560 | 0 | 2026-05-20 | fila |
| RELATORIOS DE CAIXAS (`FRMRELCAIXA`) | 504 | 22 | 2026-09-05 | fila |
| CONSULTORIA APOLLO (`FRMCONSULTORIAATM`) | 440 | 19 | 2026-09-04 | fila |
| INTEGRACAO FISCAL - BORBA FISCAL (`FRMVERIFICACAOTRIBUTARIABORBAFISCAL`) | 388 | 9 | 2026-06-15 | fila |
| TOTAL POR CARTAO (`FRMRELCARTOES`) | 383 | 19 | 2026-09-02 | fila |
| LANCAMENTOS CONTABEIS (`FRMRELLANCAMENTOSCONTABEIS`) | 377 | 19 | 2026-08-18 | fila |
| RENTABILIDADE POR CATEGORIAS (`FRMRENTABILIDADECATEGORIAS`) | 275 | 19 | — | fila |
| PRECIFICACAO NF (`FRMPRECIFICACAONF`) | 236 | 17 | 2026-08-25 | fila |
| RELATORIOS DE COMPRAS (`FRMRELCOMPRAS`) | 204 | 19 | 2026-08-17 | fila |
| PROMOCAO ACUMULATIVA (`FRMCADPROMOCAOACUMULATIVA`) | 199 | 26 | 2026-08-24 | fila |
| CONF. NOTAS FISCAIS X INDEXADOR (`FRMCONFERENCIANFINDEXADOR`) | 165 | 4 | — | fila |
| PRODUTOS (`FRMPRODUTOSREL`) | 162 | 19 | 2026-09-02 | fila |
| MDF-E MANIFESTO ELETRONICO DE DOC. FISCAIS (`FRMCADMDFE`) | 153 | 5 | 2026-07-24 | fila |
| ENTRADAS E SAIDAS (`FRMRELENTRADASSAIDAS`) | 148 | 20 | 2026-08-25 | fila |
| PREENCHER COTACAO (`FRMCADCOTACAOFORN`) | 137 | 19 | — | fila |

## Como ler

- **acessos** é uso acumulado, não frequência recente; a coluna do último acesso separa o vivo do histórico.
- **operadores** é quantos têm permissão hoje — uma tela com muitos acessos e poucos operadores costuma ser
  rotina de uma pessoa só (o que a torna frágil, não irrelevante).
- uma tela com acessos e **sem** último acesso recente é candidata a estar morta: vale confirmar antes de
  investir. `FRMFECHAMENTODIARIO` é o caso oposto e vale como aviso — 740 acessos e último em 01/09, mas o
  DADO de fechamento parou em fev/2024: abrem a tela, ela cria os dias do mês, ninguém fecha.

## `FRMRELATORIO` (1.759 acessos) — CORREÇÃO: é um construtor de relatórios do CLIENTE, e usa FastReport

⚠️ **Meu primeiro veredicto estava errado.** Escrevi que "o Apollo não usa FastReport" e por isso a tela não
migraria. O usuário corrigiu — e o próprio código já dizia: `rel-curva-abc.service.ts` porta a regra do
**PascalScript de dentro do `.fr3`** (`MasterData1OnBeforePrint`, quem atribui a letra da curva) e
`rel-ticket-medio.service.ts:40` registra "ADIADO: impressão frx". O layout não é decoração: é especificação de
regra, e a impressão é dívida aberta.

O que a tela é, segundo o usuário e confirmado no dado: um **construtor de relatórios self-service** — o próprio
cliente monta o relatório dele. "Solução simples e prática", nas palavras dele.

### Consequência imediata: os layouts estavam fora da carga

Sem as tabelas no destino, a virada descartaria em silêncio **659 layouts, 624 personalizados pelo cliente**
(54,5 MB; o maior arquivo tem 6 MB) e 109 XMLs de dataset. Criadas na mig **197**, o universo derivado as pegou
sozinho (145 → 147 tabelas) e a carga confirmou: `relatorios` **1.227/1.227 em 3,5 s**, `relatorios_customizados`
**109/109** — CLOB inteiro, sem perda.

### Como o cliente usa de fato (medido nos 109 relatórios dele)

| | |
|---|---|
| fontes | `GET_APAGAR` 25 · `GET_RCB` 13 · `GET_NF` 10 · `GET_PRODUTOS` 8 · `GET_CARTAO` 6 — **quase tudo financeiro** |
| recursos avançados | campo calculado **3** · totalizador **3** · fórmula **3**, em 1.141 linhas de definição |
| ritmo | 95 títulos distintos, de jun/2025 a jul/2026 — mas só **2 em 2026** |
| pistas | vários nomes repetidos e "TESTE": montar dá trabalho e se faz por tentativa e erro |

O uso real é **simples**: escolher uma view, escolher colunas, filtrar, agrupar e exportar. O poder de fórmula
quase não é exercido.

### Proposta (apresentada ao usuário, aguardando decisão)

Construtor de relatórios **no navegador**, com o mesmo modelo mental (as fontes são as views `get_*` que já
migramos — o cliente já nomeia os arquivos dele de `GET_APAGAR_...`): colunas com título e ordem, filtros,
agrupamento com subtotal, totalizadores, modelo salvo em JSON com permissão por operador e trilha, exportação
CSV/Excel/PDF e **pré-visualização** — que é o que cortaria o ciclo de "TESTE".

**Fora da proposta, de propósito:** os layouts FIXOS (DANFE, cupom, boleto, etiqueta) precisam de fidelidade
milimétrica e regra fiscal; esses continuam no FastReport ou viram layout dedicado, com calma.

Corte-1 sugerido: fonte + colunas + filtros + CSV, sobre as views financeiras — que sozinhas cobrem 43 dos 109
relatórios do cliente.

## Cauda longa

Além destas, outras 197 telas com uso somam 4,295 acessos
(média de 22 por tela) — a cauda é longa e rasa.
