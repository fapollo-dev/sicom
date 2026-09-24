# Auditoria de travas inventadas — briefing comum (LEIA INTEIRO)

## Contexto
/Library/Apollo é a reescrita web (API NestJS em apps/api/src/modules, web React em apps/web/src/features) de um ERP
de retaguarda legado Delphi/Oracle. Fonte do legado (snapshot mai/2020; produção roda binário mais novo):
  /Library/SicomGit/retaguarda-master/fonte/Units   (forms .pas/.dfm)
  /Library/SicomGit/retaguarda-master/fonte/DmOld   (data modules: UdmXxx.pas — MUITAS regras moram aqui)
  /Library/SicomGit/retaguarda-master/fonte/Objetos (classes utilitárias)
Mapa form->unit: /private/tmp/claude-501/-Library-Apollo/6bf25248-8079-4341-a66c-543c7c137e42/scratchpad/aud/formunit.txt
Dossiês existentes (pistas, NÃO prova): /Library/Apollo/docs/04-screen-dossier/dossiers/retaguarda/<Unit>.md

REGRA: FIDELIDADE. Toda regra do legado deve existir; o novo NÃO pode bloquear operação que o legado permite.
Lição 140 (acabou de ser descoberta): o Contas a Pagar/Receber do Apollo recusava editar/excluir título de NF, de
origem automática, contabilizado, conciliado — o legado NÃO tinha essas travas (só bloqueava alguns campos por
config BLOQUEIA_CONTAS_PAGAR_ORIGEM_AUTO; contabilizado = estorna e recontabiliza com integração automática;
conciliado = só pede senha ADM na exclusão). O cliente lança desconto justamente em título de NF (466 linhas/2026).
apagar.service.ts e areceber.service.ts JÁ FORAM CORRIGIDOS — NÃO re-auditar esses dois arquivos.

## Tarefa (para cada form do seu grupo)
1. Achar o(s) service(s)/aggregate(s)/crud do Apollo que implementam o form (controllers com
   `@RequerAcesso('FORMNAME'`, e os métodos de service que eles chamam; aggregates/crud usam hooks `validar`,
   `validarRemocao` — ver apps/api/src/shared/crud/crud-config.ts).
2. Listar TODA guarda que REJEITA editar/excluir/executar ação por ESTADO ou REGRA de negócio:
   `throw new BusinessRuleError(...)` / `ForbiddenActionError` / `ConflictError` em caminhos de update/delete/ação
   (ex.: "já processada", "contabilizado", "conciliado", "baixado", "fechado", "outro operador", "período chaveado",
   "tem baixa", "já importada", "saldo insuficiente", "não pode alterar X"...). Extrator auxiliar:
     python3 /private/tmp/claude-501/-Library-Apollo/6bf25248-8079-4341-a66c-543c7c137e42/scratchpad/aud/throws.py <caminho relativo a apps/api/src/modules> ...
   (o [método] mostrado é heurístico — confira lendo o código). Confira também guardas que não usam throw direto
   (ex.: helpers `assertXxx`, `if (...) return {erro}` que recusam, SQL com WHERE que faz a operação silenciosamente
   não acontecer e depois lança "não encontrado/já ...").
   PODE AGRUPAR numa linha só (sem classificar) o que é trivial: TENANT_FORBIDDEN, not-found, validação de entrada
   (campo obrigatório/formato/valor <= 0 de digitação). Foque em guardas de ESTADO/REGRA.
3. Para cada guarda, procurar a âncora no legado: a verificação correspondente na unit Delphi do form E nos data
   modules/objetos que ela usa. Use SEMPRE:
     LC_ALL=C /usr/bin/grep -rn 'PADRAO' /Library/SicomGit/retaguarda-master/fonte | iconv -f latin1 -t utf-8
   (grep comum está com alias e não é confiável; arquivos são ISO-8859-1). Leia o trecho com
     sed -n 'A,Bp' arquivo | iconv -f latin1 -t utf-8
   Idiomas do legado: `ShowMessage`/`MessageDlg`/`Application.MessageBox`/`raise Exception`/`Abort`/`Exit` após
   mensagem; config por `DMPrincipal.Sessao.ValorConfiguracao('X')` ou similares; permissão por
   `dmPrincipal.SenhaAdministrativa('ADM')` / controle de botões (Enabled := ...) / permissões de componente.
   ATENÇÃO: botão DESABILITADO (Enabled := False) conforme estado também é trava ancorada; campo ReadOnly também.
   Também existem regras em TRIGGERS/PROCEDURES do Oracle de produção — consulte (só SELECT):
     SELECT trigger_name, table_name, triggering_event FROM user_triggers WHERE table_name='NF';
     SELECT line, text FROM user_source WHERE name='TRIGGER_X' ORDER BY line;
   Uma trigger que dá RAISE_APPLICATION_ERROR é âncora válida (cite nome e linha).
4. Classificar:
   (a) ANCORADA — cite arquivo:linha e a mensagem do legado;
   (b) DEPENDE DE CONFIG no legado mas incondicional no Apollo (cite a config);
   (c) INVENTADA — nenhuma verificação no legado encontrada (diga onde procurou);
   (d) BLINDAGEM LEGÍTIMA do novo modelo (FK/consistência/concorrência/estado que o novo modelo precisa) — diga por quê
       ela não bloqueia nada que o legado permita (ou, se bloqueia, rebaixe para c).
   Parcial também existe: ex. ancorada mas com mensagem/escopo diferente (legado trava só alguns campos e o Apollo
   trava o registro inteiro) → marque "a-parcial" / "c-escopo" e explique.
5. Para (b), (c) e parciais: MEDIR em PRODUÇÃO se o cliente faz a operação bloqueada, com contagens 2025-2026.
   Oracle de PRODUÇÃO, ESTRITAMENTE SÓ LEITURA (SELECT/WITH). Helper:
     cd /private/tmp/claude-501/-Library-Apollo/6bf25248-8079-4341-a66c-543c7c137e42/scratchpad && \
     /Library/Developer/CommandLineTools/usr/bin/python3 q.py <<'EOF'
     SELECT ... ;
     SELECT ...
     EOF
   (separe statements por `;` + quebra de linha; o helper recusa qualquer coisa que não seja SELECT/WITH e recusa
   as palavras UPDATE/DELETE/INSERT fora de aspas — então escreva `tipo = 'UPDATE'` entre aspas, ok). Use FETCH FIRST n ROWS ONLY
   e filtros por data para não varrer tabelas gigantes sem necessidade (call_timeout 300s).
   Fontes de evidência que EXISTEM em produção:
   - LOG (IDLOG, ACAO in 'Alterou'/'Inseriu'/'Excluiu', FORMULARIO = caption da tela ex. 'Notas fiscais de entrada',
     'Contas a pagar', 'Pedido de Compra', 'SCRAP - PERDAS', 'Conciliação bancária', 'Lançamento de Cartões',
     'Movimentação de caixa', 'Agenda de Promoção', 'Cadastro de produtos', 'CONFERENCIA NF', 'Devolução de Compras'...;
     TABELA; CHAVE = nome da coluna-chave; VALOR = valor da chave; HISTORICO = texto 'ALTEROU: dd/mm/aaaa ...
     CAMPO: X VALOR ANTERIOR: a VALOR ATUAL: b'; DATAHORA; IDEMPRESA). 2025+: 479k Alterou, 265k Inseriu, 2,7k Excluiu.
     Ex.: SELECT formulario, tabela, acao, count(*) FROM log WHERE datahora >= DATE '2025-01-01' GROUP BY formulario, tabela, acao
   - HISTORICO (TABELA, HISTORICO = 'ALTERACAO DO CAMPO X DE: a PARA: b', CODDOC, DATA, CODOPERADOR, CODEMPRESA);
     2025+ tabelas: CARTAO, CAIXA, MOV_CONTAS_BANCARIAS, APAGAR, 'PEDIDO DE COMPRA', QUEBRA_CAIXA, ARECEBER, ...
   - AUDIT_<TABELA> (trigger de auditoria; colunas PROGRAMA ex. 'Retaguarda.exe', TIPO in 'INSERT'/'UPDATE'/'DELETE',
     DATA, e pares COL / COL_ANTERIOR). Existem: AUDIT_NF, AUDIT_NFC, AUDIT_APAGAR(_BX), AUDIT_ARECEBER(_BX), AUDIT_CARTAO,
     AUDIT_CX_VENDAS, AUDIT_CX_APAGAR, AUDIT_MOV_CONTAS_BANCARIAS, AUDIT_PEDIDOCOMPRA_I, AUDIT_PEDIDO_COMPRA_QTDE,
     AUDIT_SCRAP, AUDIT_SCRAP_ITEM, AUDIT_PRODUTOS, AUDIT_MULTI_PRECO, AUDIT_ESTOQUE, AUDIT_EMPRESAS, AUDIT_OPERADORES,
     AUDIT_PERMISSOES, AUDIT_AGENDAPROMOCAOITENS, AUDIT_ADIANTAMENTO_FORN, AUDIT_CFOP, AUDIT_COTACAO_FORN_ITENS, ...
     (veja colunas: SELECT column_name FROM user_tab_columns WHERE table_name='AUDIT_X').
   - HISTORICO_PROCESSAMENTO_NF, HIST_SANGRIA_SUPRIMENTO, LOG_LIBERACOES, HISTORICO_ENVIO_NFE...
   - Estado das linhas que PROVA a edição (ex.: título com IDNF>0 e desconto>0; NF processada com DTULTIMALTERACAO
     posterior ao processamento; registro contabilizado alterado depois...).
   Dê contagens separadas 2025 e 2026 (até hoje, 24/09/2026) quando fizer sentido.
6. NÃO modifique NADA em /Library/Apollo. Rascunho só em
   /private/tmp/claude-501/-Library-Apollo/6bf25248-8079-4341-a66c-543c7c137e42/scratchpad/aud/<seu-grupo>/

## Saída (em português do Brasil), devolvida pelo SubagentHandback
Para cada form do grupo (com acessos entre parênteses):
  ### FRMXXX (N acessos) — services: arquivo1, arquivo2
  | # | Guarda (arquivo:linha — código/condição) | Classe | Âncora no legado | Evidência em produção 2025/2026 | Recomendação |
  Recomendação ∈ manter / tornar dependente de config (qual) / remover / trocar mensagem / reduzir escopo (explicar).
  Linha final "Omitidas (triviais): N (tenant/not-found/validação de entrada)".
Forms cujo service não tem guarda de estado: uma linha "sem guardas de estado".
No fim: "Achados do grupo por impacto" — lista ordenada (uso da tela × frequência da operação bloqueada em produção),
com 1 linha de justificativa cada. Seja concreto (arquivo:linha, nomes de config, números). Não invente âncora:
se não achou, diga "nenhuma" e onde procurou. Se houver dúvida, diga a dúvida.
