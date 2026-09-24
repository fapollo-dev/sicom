# Auditoria de travas inventadas — G2 CADASTRO/ESTOQUE/PREÇO

Data: 24/09/2026 · Fonte do legado: `/Library/SicomGit/retaguarda-master/fonte` (snapshot mai/2020) · Oracle de PRODUÇÃO só leitura (`q.py`).
Convenção de caminhos: Apollo relativo a `apps/api/src/modules/`; legado relativo a `fonte/`.
Configs lidas na produção (`CONFIGURACOES` + `CONFIGURACOES_ESPECIFICAS`): `PERMITE_PRODUTO_MAIS_UMA_AGENDA=N` · `HABILITA_GERACAO_LOTE_PRODUTO=N` (Empresa 1=S, Empresa 2=S, Modulo Retaguarda=S) · `BAIXAR_ESTOQUE_NO_SCRAP=N` · `PEDE_SENHA_EXCLUIR_ITEM_SCRAP=S` (Usuario 1=N) · `BLOQUEAR_CADASTRAR_PARCEIRO_CPF_EXISTENTE=N` (Modulo Retaguarda=S) · `TIPO_ESTOQUE=A` (Empresa 1=L).
Triggers de produção nas tabelas do grupo: só `VALIDA_SCRAP` (SCRAP_ITEM, "acionar o suporte" via view `VALIDA_SCRAP_ITEM`) e `VALIDA_ESTOQUE` (QTDE nula) dão `RAISE_APPLICATION_ERROR`. Nenhuma trava de estado vem de trigger.

---

### FRMCADPRODUTO (100.148 acessos) — services: `cadastro/produto.aggregate.ts`, `compras/de-para.service.ts` (grade de referências, RBAC FRMCADPRODUTO), schema `packages/shared/src/schema/produto.schema.ts`

| # | Guarda (arquivo:linha — código/condição) | Classe | Âncora no legado | Evidência em produção 2025/2026 | Recomendação |
|---|---|---|---|---|---|
| 1 | `produto.aggregate.ts:199-201` — `PRODUTO_PAI_IGUAL_FILHO` (idproduto_pai = id) | a | `Units/UCadProduto.pas:2843-2847` "O produto pai deve ser diferente do produto filho." | — | manter |
| 2 | `produto.aggregate.ts:202-209` — `PRODUTO_EM_COMPOSICAO`: `dto.ativo === 'N'` e existe `composicao.idproduto_01 = id` | a-parcial / c-escopo | `Units/UCadProduto.pas:4077-4104` (chbATIVOClick): só quando `ATIVO.OldValue = 'S'` (transição S→N) e só contra a composição VIGENTE do kit (`udmCadProduto.pas:3294-3302`, casa `CHAVECOMPOSICAO`). O Apollo testa `ativo='N'` em TODO PUT — e a CadMaster (`web/shared/cadmaster/CadMaster.tsx:135`) manda o registro inteiro — então um produto JÁ inativo que é componente de kit não pode mais ser gravado (nem para corrigir NCM/descrição) | hoje 2 produtos inativos são componentes de kit; LOG 'Cadastro de produtos' Alterou nesses produtos: 2 linhas/1 produto em 2025, 0 em 2026 | reduzir escopo: disparar só quando o valor gravado é 'S' e o novo é 'N' (ler `produtos.ativo` antes) e casar a chave de composição vigente |
| 3 | `produto.aggregate.ts:223` — `FATOR_CONVERSAO_DUPLICADO` (DE,PARA repetido no próprio produto) | a | `Units/UCadProduto.pas:3867-3877` RetornarValores(FATOR_CONVERSAO, CODPRODUTO;DE;PARA) → "Registro já existe com essas configurações!" | — | manter |
| 4 | `produto.aggregate.ts:197` + `:59-116` — `emitirLotesDePreco`: com `HABILITA_GERACAO_LOTE_PRODUTO='S'` o preço/promo NÃO grava no multi_preco (vai para `lote_preco` e o dto é revertido) — trava silenciosa | a (config) | `Units/UCadProduto.pas:3097-3115` + `:6424` (mesma config, mesma reversão) | config ativa na produção (Empresa 1 e 2 = S) | manter. Dúvida lateral (não é trava): o Apollo resolve só Empresa>global e ignora o override `Modulo:Retaguarda=S` — loja ≠ 1/2 cairia em "on-line" no Apollo e em "lote" no legado; conferir |
| 5 | `packages/shared/src/schema/produto.schema.ts:80` — `codbarra` com 13 dígitos precisa de dígito verificador EAN-13 válido (vale também no `atualizarProdutoSchema`, `:383-385`, que é `produtoBase.partial()`) | c | nenhuma. Procurado em `Units/UCadProduto.pas:4895-4975` (edtCODBARRAExit: só obrigatório, sem `*`, não repetido como auxiliar/duplicação/existente) e grep "barra…inv/valid/EAN" em UCadProduto/udmCadProduto: nada. O binário novo também não valida: produtos com EAN-13 inválido continuam nascendo | 334 produtos com EAN-13 de DV inválido (330 ativos) — qualquer gravação deles é recusada. Criados com DV inválido: 13 em 2025, 15 em 2026. LOG 'Cadastro de produtos' tabela PRODUTOS Alterou nesses produtos: 7 linhas/7 produtos (2025), 8/6 (2026); com MULTI_PRECO: +18/16 (2025), +25/18 (2026) | remover (ou rebaixar a aviso não bloqueante) |
| 6 | `compras/de-para.service.ts:82` e `:105` — `DEPARA_DUPLICADO` (índice único `ux_codref_for (codfor, codref)`, `migrations/063_de_para_fornecedor.sql:31`; mantido pela `180_codref_for_nao_unico.sql`) | c-escopo | `Units/UCadProduto.pas:5352-5362` (edtCodRefExit): RetornarValores com chave `IDPRODUTO;CODREF;CODFOR` — só no MESMO produto — e é só `Mensagem` + `SetaFoco`, não impede gravar. Oracle: `CODREFERENCIA_FOR` sem índice único (só IDX1-3 não únicos) | hoje 135 pares (codfor,codref) repetidos. `AUDIT_CODREFERENCIA_FOR` INSERT 2025+ cujo (codfor,codref) também pertence a OUTRO produto: Retaguarda.exe 70 (2025) + 33 (2026); ImportaXMLMassa.exe 19 + 15 | reduzir escopo: unicidade por (idproduto, codfor, codref) ou aviso; o UPSERT de `recebimento.service.ts:544` que depende do índice precisa de outra chave (a mig 180 registra o motivo) |
| 7 | `compras/de-para.service.ts:52` — `DEPARA_FORNECEDOR_INVALIDO` (parceiro precisa ser FRN='S' e da empresa logada) | a / d | SegFornecedor do legado (lookup de fornecedor); o filtro por empresa é o escopo multi-tenant do Apollo (parceiros são `empresaScoped`) | não medido | manter |
| 8 | Exclusão do produto: sem `validarRemocao`; FK do Postgres → 409 `REGISTRO_RELACIONADO_INEXISTENTE` | d | Oracle tem as mesmas FKs `NO ACTION` para PRODUTOS (HISTORICO_PROD, MULTI_PRECO, VENDAS, COMPOSICAO… 40 FKs) — o legado também não exclui produto movimentado; `btnExcluirClick` (`UCadProduto.pas:2536-2575`) só confirma se há NF | LOG 2025/2026: nenhuma exclusão de PRODUTOS (os 19 'Excluiu' são de CODAUXILIAR) | manter |

Omitidas (triviais): 9 (tenant/not-found em de-para `:23/:64`, `DEPARA_CODREF_INVALIDO` `:73/:97`, `DEPARA_PRODUTO_INVALIDO` FK `:83/:106`; refines de entrada `*` no codbarra, `;`/`|` na descrição, NCM 8 dígitos — 1 produto ativo fora — e CEST 7 dígitos — 4 fora; STB exige CEST só no create).

---

### FRMCADSCRAP (53.962 acessos) — services: `cadastro/scrap.aggregate.ts`, `cadastro/scrap.service.ts`, `shared/situacao-restricoes.ts`

| # | Guarda (arquivo:linha — código/condição) | Classe | Âncora no legado | Evidência em produção 2025/2026 | Recomendação |
|---|---|---|---|---|---|
| 1 | `scrap.aggregate.ts:89` (editar) e `:120` (excluir) — `SCRAP_JA_FATURADO` (`scrap.importado='S'`) | a | `Units/uCadSCRAP.pas:481-485` (btnEditar), `:518-521` (btnExcluir), `:539-542` (excluir item), `:609-612` (btnGravar), `:796-799` (limpar itens) → `ExibeMensagemAlertaImportado` `:1411-1415` "Este SCRAP já foi importado. Não será possível alterá-lo." `Importado` = existe `PEDIDO_NF` tipo 'S' (`:1595-1598`, `:1690-1721`) | Prova de equivalência do marcador: 3.502 scraps `IMPORTADO='S'`, todos com PEDIDO_NF 'S'; nenhum 'S' sem vínculo. 10 scraps com vínculo e IMPORTADO≠'S' (NF cancelada: `AtualizaStatusScrap` zera o flag mas a PEDIDO_NF fica) — o Apollo deixa editar, o legado não (Apollo mais permissivo) | manter |
| 2 | `scrap.aggregate.ts:88` e `:119` — `SCRAP_ESTOQUE_APLICADO` (`mov_estoque='S'`) | d | não existe no fonte 2020 (baixa no scrap é do binário novo, config `BAIXAR_ESTOQUE_NO_SCRAP`) | 0 scraps com `MOV_ESTOQUE='S'`; config = N → a guarda nunca dispara hoje | manter (consistência: editar/excluir com baixa aplicada dessincroniza o estorno) |
| 3 | `scrap.service.ts:45` — `SCRAP_BAIXA_PELA_NF` (aplicar/estornar só com `BAIXAR_ESTOQUE_NO_SCRAP='S'`) | a (config) / d | config do binário novo (valor N na produção); sem ela a baixa é da NF de perda | — | manter |
| 4 | `scrap.service.ts:59-60`, `:82-83` — aplicar já aplicado / estornar não aplicado / faturado | d | ações novas do Apollo (idempotência) | — | manter |
| 5 | `scrap.aggregate.ts:96` → `situacao-restricoes.ts:32-39` — `SITUACAO_CC_NAO_PERMITIDO` | a | `Units/uCadSCRAP.pas:1295-1320` (edtCodPLCExit) "O centro de custo informado não é permitido para a situação do documento selecionada." | — | manter |
| 6 | `scrap.service.ts:108` — `SCRAP_ESTOQUE_CONCORRENTE` (23505) | d | concorrência | — | manter |

Omitidas (triviais): 4 (tenant `:32/:38`, `SCRAP_NAO_ENCONTRADO`, `PRODUTO_NAO_ENCONTRADO`/`MOTIVO_NAO_ENCONTRADO` `scrap.aggregate.ts:106/:114`).
Nota (regra do legado ausente, não é trava): `PEDE_SENHA_EXCLUIR_ITEM_SCRAP='S'` na produção (`uCadSCRAP.pas:1749-1770`) pede liberação por login para excluir scrap/item — o Apollo não pede.

---

### FRMCADAGENDAPROMOCAO (37.659 acessos) — services: `cadastro/agenda-promocao.aggregate.ts`, `cadastro/agenda-promocao.service.ts`

| # | Guarda (arquivo:linha — código/condição) | Classe | Âncora no legado | Evidência em produção 2025/2026 | Recomendação |
|---|---|---|---|---|---|
| 1 | `agenda-promocao.aggregate.ts:181-201` — `PROMOCAO_PRODUTO_SOBREPOSTO` (com `PERMITE_PRODUTO_MAIS_UMA_AGENDA='N'`): em TODO save valida todos os itens ativos (os do dto ou os persistidos) contra outra agenda N/E da mesma loja com período sobreposto, e recusa o save inteiro | a-parcial / c-escopo | `Units/uCadAgendaPromocao.pas:925-947` (CarregarItens) e `:1421-1436` (marcar item ativo) — só ao INCLUIR/ATIVAR item; com 'N' dá `Mensagem(Msg)` e PULA aquele item (`Next; Continue`), não bloqueia a agenda. O `btnGravar` (`:630-700`) não revalida; mudar o período ou salvar a agenda depois não passa pela checagem | config = N na produção. Pares de itens ativos do mesmo produto, mesma loja, períodos sobrepostos entre agendas não excluídas (agenda com início em): **2025: 62 pares em 39 agendas; 2026: 25 pares em 15 agendas** (ex.: agenda 26646 × 17147, 30205 × 21946). Caveat: não dá para saber o status da outra agenda no instante — parte pode ter sido 'J'. LOG 'Agenda de Promoção' Alterou: 2.200 (2025), 1.505 (2026) | reduzir escopo: checar só produto incluído/reativado no save (diff contra o gravado) e, para esses, pular/avisar como o legado; não revalidar o que já estava gravado nem a troca de período |
| 2 | `agenda-promocao.aggregate.ts:151` — `PROMOCAO_PRODUTO_DUPLICADO` (mesmo idproduto 2× na agenda recusa o save) | c-escopo | `Units/uCadAgendaPromocao.pas:950` — dedup silencioso por `CODBARRA` (Locate) ao incluir; mesmo produto por outro código de barras entra | agendas com o mesmo produto 2×: 2025: 7 grupos em 6 agendas; 2026: 13 grupos em 7 agendas (5 e 13 com ambos ativos) — essas agendas não gravam no Apollo | reduzir escopo: deduplicar em silêncio (manter a 1ª linha) em vez de recusar; conferir a chaveNatural `idproduto` do detalhe |
| 3 | `agenda-promocao.aggregate.ts:160-172` — `PROMOCAO_PRODUTO_INATIVO`: todo save revalida TODOS os itens ativos (incl. os já gravados) contra `produtos.ativo='N'` | c-escopo | `Units/uCadAgendaPromocao.pas:437-446` (pesquisa `ATIVO='S'`) e `uCadAgendaPromocao.dfm:1672` (lookup `ATIVO='S'`) — filtro só na SELEÇÃO do produto; nada no gravar. (Com `GET_CONFIG_MULTIPRECO='S'` o legado usa `M.ATIVO` por loja, `:1735-1736`) | agendas iniciadas 2025/2026 com item ativo de produto hoje inativo: 21 agendas/24 itens (2025), 17/20 (2026) — todas 'J'. Produto desativado durante uma agenda aberta trava a agenda inteira no Apollo | reduzir escopo: validar só item novo/reativado |
| 4 | `agenda-promocao.aggregate.ts:112` (editar) e `:212` (excluir) — `PROMOCAO_ENCERRADA` (`dtencerramento` não nulo) | c | nenhuma no fonte (grep `DTENCERRAMENTO`/`CODOPERADORENC` em todo `fonte/`: 0 ocorrências; a coluna é do binário novo). O dado vivo prova o contrário: agendas encerradas foram alteradas depois — 8941 (encerr. 29/07/2023, alterada 31/07), 10288 (04/11 → 08/11), 10948 (14/12 → 16/12); LOG após DTENCERRAMENTO: 11 Alterou AGENDA_PROMOCAO + 14 Alterou + 13 Inseriu de itens (2023) | 16 agendas com DTENCERRAMENTO no total; 1 em 2025 (17966), 0 em 2026 — recurso quase sem uso | remover (ou trocar mensagem apontando "reabrir"; o Apollo tem `reabrir`, então a trava é contornável) |
| 5 | `agenda-promocao.aggregate.ts:116-123` — `PROMOCAO_STATUS_INVALIDO` (ABERTA não muda status à mão; E→J e J→E proibidos) | a | `Units/uCadAgendaPromocao.pas:518` (`cbbStatus.Enabled := FLAG <> 'N'`), `:1094-1111` "Não é possível mudar o Status da Agenda de Executando para Fechada/de Fechada para Executando." | — | manter |
| 6 | `agenda-promocao.service.ts:104-105` — aplicar recusa agenda encerrada/`FECHADA` ('J') | d | aplicar é ação nova do Apollo (no legado quem liga é serviço fora do fonte, que só pega N/E) | — | manter |
| 7 | `agenda-promocao.service.ts:62/:69/:80/:87` — encerrar já encerrada / reabrir não encerrada (CAS) | d | idempotência de ação nova | — | manter |

Omitidas (triviais): 5 (tenant `aggregate:50`/`service:27`, not-found `aggregate:111`/`service:43`, `PROMOCAO_LOJA_INVALIDA` `:135`, `PROMOCAO_PRODUTO_INVALIDO` `:171`; refines de entrada preço>0 e fim>início — âncoras `:670`, `:431`).
Nota (regra do legado ausente, não é trava): `uCadAgendaPromocao.pas:1212` desabilita EXCLUIR quando a agenda está EXECUTANDO — o Apollo deixa excluir.

---

### FRMCADCLIENTES (17.387 acessos) — services: `cadastro/parceiro.aggregate.ts`, schema `packages/shared/src/schema/parceiro.schema.ts`, índice `migrations/178_parceiros_end_doc_parcial.sql`

| # | Guarda (arquivo:linha — código/condição) | Classe | Âncora no legado | Evidência em produção 2025/2026 | Recomendação |
|---|---|---|---|---|---|
| 1 | `migrations/178_parceiros_end_doc_parcial.sql:9-11` + `shared/errors/all-exceptions.filter.ts:94` — índice único `ux_parceiros_end_doc_novo` (CNPJ/CPF entre endereços nascidos no Apollo) → 409 "Já existe um cadastro com este CNPJ/CPF." | b | `Units/uCadClientes.pas:2947-3027` (edtCNPJ_CPFExit): com `BLOQUEAR_CADASTRAR_PARCEIRO_CPF_EXISTENTE='S'` bloqueia ("Não é permitido cadastrar parceiro com CPF/CNPJ existente em outro cadastro"); sem ela, confirma e exige `SenhaAdministrativa('ADM')` e deixa gravar | config: global N, `Modulo:Retaguarda=S` → hoje o legado bloqueia no Retaguarda. Parceiros criados em 2025 (272) e 2026 (248): 0 com CNPJ repetido em outro parceiro (os 1.042 grupos repetidos são de 2017-2024) | tornar dependente de config (`BLOQUEAR_CADASTRAR_PARCEIRO_CPF_EXISTENTE`; com 'N' = confirmar + senha ADM). Impacto hoje: nenhum |
| 2 | `parceiro.schema.ts:289-296` — ao menos um papel | a | btnGravarClick do legado (mensagem idêntica "Preenchimento do tipo de parceiro é obrigatório…") | — | manter |
| 3 | `parceiro.schema.ts:297-308` — IE inválida para a UF | a | edtIERGExit (dossiê `uCadClientes.md`); validação de entrada | — | manter |

Sem guardas de estado no service (não há `validar` bloqueante nem `validarRemocao`; exclusão só barra por FK, como no Oracle).
Omitidas (triviais): 0 além das acima.
Nota (regra do legado ausente, não é trava): `uCadClientes.pas:1340-1352` — `CNPJLiberadoParaEdicao` proíbe mudar CNPJ/UF do endereço quando há NF/Indexador para o CNPJ; o Apollo não tem.

---

### FRMAJUSTEPRECOS (5.275 acessos) — services: `cadastro/ajuste-precos.service.ts`

| # | Guarda (arquivo:linha — código/condição) | Classe | Âncora no legado | Evidência em produção 2025/2026 | Recomendação |
|---|---|---|---|---|---|
| 1 | `ajuste-precos.service.ts:83-84` (processar) e `:159-160` (editar promo) — `LOTE_JA_PROCESSADO` / `LOTE_EXCLUIDO` | a | `Units/udmAjustePrecos.dfm:595-596` e `:638-639` — a grade só carrega `L.PROCESSADO = 'N' AND COALESCE(L.INDR,'I') <> 'E'`; lote processado/excluído não é alcançável na tela | — | manter |
| 2 | `ajuste-precos.service.ts:148` — excluir só pendentes (`WHERE processado='N'`, silencioso) | a | idem (a grade só tem pendentes); `Units/uAjustePrecos.pas:405-445` | — | manter |

Omitidas (triviais): 3 (tenant `:32`, `LOTE_NAO_ENCONTRADO` `:82/:158`).

---

### FRMPRIFICACAOCUSTO (3.346 acessos) — services: `precificacao/precificacao-custo.service.ts`

| # | Guarda (arquivo:linha — código/condição) | Classe | Âncora no legado | Evidência em produção 2025/2026 | Recomendação |
|---|---|---|---|---|---|
| 1 | `precificacao-custo.service.ts:252` + `:259` — trava silenciosa: se `multi_preco.promocao='S'` o preço de venda informado é DESCARTADO (grava o antigo) | c-escopo | a âncora citada no código (`Units/UPrificacaoCusto.pas:603`, `:843-845`, `:898`, `:943`) é `PromocaoAcumulativa(...)` — produto em **promoção ACUMULATIVA** (tabela `PROMOCAO_ACUMULATIVA`; label `lblPromocaoAc` "Produto em promoção acumulativa", `UPrificacaoCusto.dfm:604-609`), não o flag de promoção comum do multi_preco. (A função em si não está no fonte — `FuncoesApollo` ausente.) | `HISTORICO_DINAMICO` 'Precificação do Custo' campo VRVENDA casado com `AUDIT_MULTI_PRECO` (±2 min, preço mudou com `PROMOCAOANTERIOR='S'` e `PROMOCAOATUAL='S'`): **38 (2025), 19 (2026)** alterações de preço de produto em promoção que o Apollo teria descartado em silêncio (+1/+1 em 'Precificação de Mercadorias'). Hoje 112 linhas de multi_preco com promoção | trocar a condição: congelar só produto em promoção acumulativa vigente (tabela `promocao_acumulativa`), não `promocao='S'` |
| 2 | `precificacao-custo.service.ts:259` (`!podePreco`) — sem o grant `EDTVRVENDA` o preço não muda (silencioso) | a | `Units/UPrificacaoCusto.pas:1362-1365` (`VerificaAcessoVrVenda`) + `:2136` (`PossuiAcessoForm(…, 'EDTVRVENDA')`) | — | manter (idealmente avisar em vez de descartar calado) |
| 3 | `precificacao-custo.service.ts:77` e `:247` — `SEM_PERMISSAO_EMPRESA` | a | `Units/udmCadProduto.dfm:5268-5271` (sqqEmpresa: `INNER JOIN PERMISSOES … WHERE P.CODOPERADOR = :CODOPERADOR AND FORM LIKE :FORMULARIO`) | — | manter |
| 4 | `precificacao-custo.service.ts:259` (`modoLote`) — preço vai para lote e não grava | a | `Units/UPrificacaoCusto.pas:943-967` (modo lote) | — | manter |

Omitidas (triviais): 5 (tenant `:64`, `EMPRESA_NAO_ENCONTRADA` `:93`, `PRODUTO_NAO_ENCONTRADO` `:98/:210`, `PRECO_NAO_ENCONTRADO` `:212`).

---

### FRMAJUSTEESTOQUE (754 acessos) — services: `cadastro/ajuste-estoque.service.ts`

| # | Guarda (arquivo:linha — código/condição) | Classe | Âncora no legado | Evidência em produção 2025/2026 | Recomendação |
|---|---|---|---|---|---|
| 1 | `ajuste-estoque.service.ts:99` e `:135` — `AJUSTE_JA_ESTORNADO` | d | o legado não tem estorno de ajuste (grep "estorn" em `Units/UajusteEstoque.pas`: 0) — ação nova, a guarda é idempotência | — | manter |
| 2 | `ajuste-estoque.service.ts:120` — `AJUSTE_ESTORNO_SALDO_MUDOU` (só estorna se o saldo ainda é o que o ajuste deixou) | d | ação nova; não bloqueia nada que o legado permita (no legado o caminho é lançar outro ajuste, que continua livre no Apollo) | — | manter |
| 3 | `ajuste-estoque.service.ts:72` — `AJUSTE_CONCORRENTE` (23505) | d | concorrência | — | manter |

Saldo negativo é permitido (fiel). Omitidas (triviais): 4 (tenant `:26/:33`, `PRODUTO_NAO_ENCONTRADO` `:46`, `MOTIVO_NAO_ENCONTRADO` `:48`; qtde>0 exceto SUBSTITUIR).
Nota (regras do legado ausentes, não são travas): `UajusteEstoque.pas:488-490` bloqueia ajuste no depósito com `TIPO_ESTOQUE='L'` (Empresa 1 = L na produção); `:584` só permite ajuste no produto pai; `:331` recusa ajuste que não muda o saldo.

---

## Achados do grupo por impacto

1. **FRMCADAGENDAPROMOCAO (37.659) × `PROMOCAO_PRODUTO_SOBREPOSTO` revalidado em todo save** (`agenda-promocao.aggregate.ts:181-201`) — o legado só checa ao incluir/ativar item e pula o item; na produção há 62 pares (2025) e 25 (2026) de sobreposição que o legado deixou gravar, numa tela com ~3,7 mil alterações/ano.
2. **FRMCADPRODUTO (100.148) × EAN-13 obrigatório** (`produto.schema.ts:80`) — sem âncora; 334 produtos com DV inválido (330 ativos) ficam impossíveis de gravar; o legado segue criando esses códigos (13 em 2025, 15 em 2026) e alterando (7/7 e 8/6 produtos).
3. **FRMCADPRODUTO (100.148) × de-para único (codfor, codref)** (`de-para.service.ts:82/:105`, índice `ux_codref_for`) — o legado só avisa, e só dentro do mesmo produto; 103 inserções pelo Retaguarda.exe em 2025-26 repetiram a referência de outro produto (+34 pelo ImportaXMLMassa).
4. **FRMPRIFICACAOCUSTO (3.346) × preço congelado quando `promocao='S'`** (`precificacao-custo.service.ts:252/259`) — o legado congela só em promoção ACUMULATIVA; 38 (2025) e 19 (2026) mudanças de preço em produto em promoção seriam descartadas sem aviso.
5. **FRMCADAGENDAPROMOCAO (37.659) × `PROMOCAO_PRODUTO_DUPLICADO`** (`:151`) — o legado deduplica em silêncio por código de barras; 6 agendas (2025) e 7 (2026) já têm o mesmo produto 2× e não gravariam.
6. **FRMCADAGENDAPROMOCAO (37.659) × `PROMOCAO_PRODUTO_INATIVO` revalidado em todo save** (`:160-172`) — o legado só filtra na seleção; 38 agendas de 2025-26 carregam item ativo de produto hoje inativo.
7. **FRMCADAGENDAPROMOCAO × `PROMOCAO_ENCERRADA`** (`:112/:212`) — sem âncora no fonte e o dado vivo mostra agenda encerrada alterada (2023); uso de 2025-26 quase nulo (1 agenda) e contornável por "reabrir".
8. **FRMCADPRODUTO × `PRODUTO_EM_COMPOSICAO` sem checar a transição S→N** (`produto.aggregate.ts:202-209`) — escopo maior que o legado; hoje só 2 produtos (2 edições em 2025).
9. **FRMCADCLIENTES × CNPJ único incondicional** (mig 178) — o legado depende de `BLOQUEAR_CADASTRAR_PARCEIRO_CPF_EXISTENTE` (hoje S no Retaguarda); impacto zero em 2025-26.

Sem travas inventadas: FRMAJUSTEPRECOS (todas ancoradas no filtro da grade) e FRMAJUSTEESTOQUE (as guardas são só da ação nova de estorno). FRMCADSCRAP: o "já importado" é fiel (IMPORTADO='S' ⇔ PEDIDO_NF em 3.502/3.502).
