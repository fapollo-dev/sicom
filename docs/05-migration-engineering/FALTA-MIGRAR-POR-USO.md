# O que falta migrar — ranking por USO REAL (não por contagem de telas)

O placar de conversão conta telas. Esta lista conta **acessos**: o legado registra o uso de cada formulário em
`MENUEXPRESS.ACESSOS`, e são **3.024.930** acessos acumulados. É a medida honesta do que dói faltar.

> ⚠️ **CORRIGIDO em 15/09/2026 — a leitura honesta são DOIS números, não um.**
>
> | eixo | número | leitura |
> |---|---|---|
> | por **uso** | **98,4%** coberto | 2.996.984 de 3.045.902 acessos |
> | por **formulário** | **91 de 289** (31%) | só as que têm uso registrado |
>
> O primeiro número é verdadeiro e enganoso ao mesmo tempo, porque **o uso é hiperconcentrado**:
> `FRMETIQUETA` sozinha responde por **2.375.302 acessos — 78% de tudo**. Cobrir 98% do volume não quer dizer
> que sobrou pouco: **faltam 194 formulários com uso**, que somam 4.145 acessos (0,1%) e continuam sendo 194
> telas de trabalho. A lista completa está em **`FILA-CONVERSAO.md`**.
>
> A versão anterior desta página dizia "98% do uso real, 46.159 acessos ausentes" e listava ~20 telas — o
> recorte era curto e me levou a afirmar, por duas vezes, que a fila tinha acabado. Não tinha.

E o topo do que falta é escopo já decidido: as três primeiras (sangria, consulta NFC-e e devolução de vendas)
são **PDV**, fora por instrução do usuário, e sozinhas valem 67% do que resta.

### ⚠️ A fila não estava zerada — o recorte é que era curto (15/09/2026)

O ranking original desta página cobria as telas mais usadas. Refeito contra `MENUEXPRESS` inteiro, aparecem
**mais 30 telas com uso** abaixo daquele corte. As que sobram, por uso, fora PDV:

| tela | acessos | op | situação |
|---|---|---|---|
| DIAS DE ESTOQUE (`FRMRELDDE`) | 132 | 5 | ✅ **completa** (mig 220) — e trouxe `MOVIMENTACAO_DIARIA`, **4,03 milhões de linhas** que não estavam na carga |
| INTERSECÇÃO DE PRODUTOS (`FRMRELINTERSECCAOPRODUTOS`) | 117 | 10 | fila |
| DIGITAÇÃO DE PEDIDOS (`FRMDIGITACAOPEDIDOS`) | 116 | 9 | fila |
| TRANSFERÊNCIA DE MERCADORIA (`FRMSAIDADEP`) | 104 | 9 | fila |
| CONTROLE MOBILE (`FRMCONTROLEMOBILE`) | 101 | 5 | fila |
| FLUXO DE CARTÕES (`FRMFLUXOCARTOES`) | 98 | 7 | fila |
| MAPA DE ENTREGAS (`FRMMAPADEENTREGAS`) | 98 | 3 | fila |
| METAS (`FRMCADMETAS`) | 97 | 4 | fila |
| ANÁLISE COMPRA/VENDA (`FRMRELENTSAI`) | 84 | 10 | fila |
| BAIXA DE CHEQUES PRÉ (`FRMBAIXACHEQUE`) | 80 | 11 | fila |

…e mais 20 abaixo de 80 acessos.

### Recursos transversais (não são telas)

| recurso | onde o legado tem | situação |
|---|---|---|
| **Layout da grade por operador** (`[F8]`/`[F9]`) | **16 units** — o legado grava um `.ini` no disco da estação, que some quando a pessoa troca de máquina | ✅ **mig 219**: vai para o banco por operador e empresa, com cópia local no navegador e **visões nomeadas** que o `.ini` nunca deu. Ligado em 8 telas; as demais é uma linha por grade — `grade-layout.md` |
| **Exportar a grade** (`[F10]`) | Conferência NF, Produtos | ✅ CSV com `;` e BOM UTF-8, o que está na tela e já filtrado |

**Legenda:** ✅ tudo do legado tem equivalente · 🟢 tudo coberto, com substituições declaradas no dossiê (a grade imprime no lugar do `.fr3`, o log usa o visualizador do Apollo) · 🟡 há função do legado sem equivalente ainda · ⛔ sem fonte para copiar.

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
| SALDO DA EMPRESA (`FRMSALDOEMPRESA`) | 611 | 19 | — | ✅ **corte-1** (mig 205): os 5 ramos do fluxo projetado; faltam contas bancárias e pedidos colocados |
| FRMMANCADCARTAOBOAVISTA (`FRMMANCADCARTAOBOAVISTA`) | 560 | 6 | 2026-05-20 | ⛔ **sem fonte no repositório clonado** — nenhuma unit, nenhuma referência. Sem fonte não há cópia fiel; a tela também parou em maio |
| RELATORIOS DE CAIXAS (`FRMRELCAIXA`) | 505 | 11 | 2026-09-08 | ✅ **corte-1** (mig 206): divergências + caixas abertos; faltam voucher, apuração e pedidos |
| CONSULTORIA APOLLO (`FRMCONSULTORIAATM`) | 440 | 19 | 2026-09-04 | ✅ **corte-1** (mig 207): participação e rentabilidade nos 3 níveis da árvore; faltam o modo com NF, os gráficos e a previsão |
| INTEGRACAO FISCAL - BORBA FISCAL (`FRMVERIFICACAOTRIBUTARIABORBAFISCAL`) | 388 | 9 | 2026-06-15 | ⛔ **sem fonte no repositório clonado** — nenhuma unit, nenhum `.dfm`, nenhuma referência ao nome do form; do mecanismo só resta `EMPRESAS.IDSUPORTEBORBA` (`UCadEmpresa.dfm:703`), trazida na mig 213 para a carga não perder o valor. Sem fonte não há cópia fiel — mesmo caso do Boa Vista |
| TOTAL POR CARTAO (`FRMRELCARTOES`) | 382 | 7 | 2026-09-02 | ✅ **completa** (mig 208) — nada ficou de fora |
| LANCAMENTOS CONTABEIS (`FRMRELLANCAMENTOSCONTABEIS`) | 377 | 19 | 2026-08-18 | ✅ **corte-1** (mig 209): o razão por lançamento + `ORIGEM_CONTABIL` e `DIARIO.DESCHIST`, que a carga descartava |
| RENTABILIDADE POR CATEGORIAS (`FRMRENTABILIDADECATEGORIAS`) | 275 | 19 | — | ✅ **corte-1** (mig 210): a fórmula completa nos 3 níveis; faltam o filtro por fornecedor, o modo SCRAP e o modo com NF |
| PRECIFICACAO NF (`FRMPRECIFICACAONF`) | 236 | 17 | 2026-08-25 | 🟢 **equivalente** (mig 211-212): os 3 tipos de custo com as escadas, markup nas 3 semânticas, rodapé com os 3 lucros, 4 dos 5 atalhos, **produtos filhos**, multi-empresa, **fila de etiquetas** (enfileira e desmarca), **coloração por regra** e o gate do PMZ. Substituições declaradas: a grade imprime no lugar do `.fr3`; falta só layout de grade por operador e o painel de bonificação/verbas — §8.5.1 do dossiê |
| RELATORIOS DE COMPRAS (`FRMRELCOMPRAS`) | 204 | 19 | 2026-08-17 | 🟢 **equivalente** (mig 213): os 3 relatórios do combo, a árvore inteira como filtro, as 3 datas, multi-empresa, rateio de decomposição no analítico e **dois defeitos do legado corrigidos** (desconto nulo que sumia com o item; e o `WHERE` ausente que somava 18,9M de vendas no modo "ambos") |
| PROMOCAO ACUMULATIVA (`FRMCADPROMOCAOACUMULATIVA`) | 199 | 26 | 2026-08-24 | 🟢 **equivalente** (mig 214): cadastro, as 4 validações na ordem do legado, a lista de lojas `;1;2;`, produto ativo, **os dois excluir** (o simples com senha administrativa + log, e o do grupo **escopado à loja da sessão**, preservando histórico — única divergência deliberada, §5.2 do dossiê), a grade do grupo de preço e a pesquisa em 3 modos ('aberta' = término a partir de hoje) |
| CONF. NOTAS FISCAIS X INDEXADOR (`FRMCONFERENCIANFINDEXADOR`) | 165 | 4 | — | 🟢 **equivalente** (mig 215): sistema × XML item a item, divergências marcadas coluna a coluna. Trouxe **20 colunas** que a carga descartava (todas as `*_NOTA` + `nf.dtimportacao`) — o maior achado da família; com elas, 52.065 itens do cliente têm CST divergente. `nf.nfe_xml` (716 MB) fica fora, com procedência |
| PRODUTOS (`FRMPRODUTOSREL`) | 162 | 19 | 2026-09-02 | 🟡 **4 de 15** (mig 216): estoque atual, ruptura, análise e **alterações de preço** (97.977 registros, o último de hoje). ⚠️ o placar importa mais que a contagem: **7 dos 11 restantes estão mortos ou marginais** neste cliente — somados, 144 linhas de dado. Sobram 4 que valem corte quando alguém pedir. Achado: `ESTOQUE_DEP` está zerada e o número vive em `ESTOQUE` (4.121 negativos) — §1 do dossiê |
| MDF-E MANIFESTO ELETRONICO DE DOC. FISCAIS (`FRMCADMDFE`) | 153 | 5 | 2026-07-24 | ⛔ **nunca foi implementada no legado** — não é decisão nossa, é o estado do fonte: `UCadMDFe.pas` tem **47 linhas** herdando o cadastro genérico com o corpo **comentado** (`// SetaDataset`, `// ListaDetalhes.Add`); o `.dfm` tem um `GroupBox1` com o caption padrão do Delphi e **nenhum campo dentro**; `UDMCadMDFe` é um DataModule **vazio** e `UMDFe.pas` tem só a cláusula `uses` do ACBr, sem implementação. E o dado fecha o caso: `MDFE` e `MDFE_DOCUMENTO` têm **0 linhas** na produção (14/09/2026). Os 153 acessos são gente abrindo uma tela em branco. Migrar exigiria **escrever a funcionalidade do zero**, não copiar |
| ENTRADAS E SAIDAS (`FRMRELENTRADASSAIDAS`) | 148 | 20 | 2026-08-25 | 🟡 **os 2 relatórios** (mig 217): listagem e comparativo por produto, com estoque e "a entrar" ao lado. **Dois defeitos do legado corrigidos**: o desconto tratado como valor quando é percentual (**R$ 178.994,93/ano** a mais nas entradas) e a nota não processada contada duas vezes. Faltam os rádios Custo (médio × reposição) e Venda (média × atual) |
| PREENCHER COTACAO (`FRMCADCOTACAOFORN`) | 137 | 19 | — | 🟡 **corte-1** (mig 218): a porta com os dois tipos de gente (operador **ou fornecedor**), abrir/preencher/gravar com a marca de quem digitou, e as travas de um-por-cotação e de prazo. ⛔ a senha do fornecedor **não** vem em texto puro: `senha_hash` com scrypt, a carga hasheia a existente. Faltam a apuração (marcar ganhador), o envio por e-mail e a impressão |

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
