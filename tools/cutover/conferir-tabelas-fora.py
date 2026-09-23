#!/usr/bin/env python3
"""
CONFERIDOR DE TABELAS FORA DO PLANO — o irmão do `conferir-colunas-orfas.py`, uma escala acima.

"Tem que ter todos os campos" (usuário, 23/09/2026) vale para a tabela inteira: toda tabela do Oracle COM DADO que não
está no plano de carga precisa de um VEREDITO com a PROVA — senão o dado dela some na virada sem ninguém decidir.
Este script lista as tabelas com linha nenhuma fora do plano e FALHA (exit 1) em qualquer uma sem veredito.

É o que teria pego, sozinho, o que a triagem de 23/09/2026 achou à mão (FILA, Achado 20): a LOG de 2,5 milhões de
linhas que 21 telas mostram, a agenda de promoção multi-loja, a situação×CFOP de 99,5% dos itens de NF… E pega o que
o binário da PRODUÇÃO (mais novo que o fonte de mai/2020) criar depois: tabela nova com dado aparece aqui.

Categorias (a prova curta vai junto; a longa está no Achado 20):
  AUX        — tabela de trabalho que o programa apaga e refaz (o dado não vale depois da operação)
  BACKUP     — cópia avulsa (nome datado / colunas de outra tabela / planilha importada)
  MORTA      — sem quem grave no fonte e sem dado recente, ou substituída
  EQUIVALENTE— o Apollo já guarda o mesmo dado em outra tabela, e ela está no plano
  PDV        — do PDV (fora do escopo por instrução do usuário, 19/08/2026)
  EXTERNA    — de outro sistema (app de gestão, licenciamento do fornecedor, BI, robô de DF-e)
  AUDITORIA  — trilha técnica por trigger (programa + máquina Windows; nenhuma tela lê)

SOMENTE LEITURA no Oracle. Uso:
  ORACLE_HOST=hiperpinheirao.ddns.com.br python3 tools/cutover/conferir-tabelas-fora.py
"""
import json, os, re, sys
import oracledb

BASE = os.path.dirname(os.path.abspath(__file__))

# famílias por NOME — só onde o nome prova (data no nome, prefixo de cópia, prefixo do outro sistema)
FAMILIAS = [
    (r'^BKP_ESTOQUE_SICOM$', 'AUX', 'foto de ESTOQUE 2×/dia pelo job BKP_SICOM_ESTOQUE (28 GB); só a view avulsa GET_CORRECAO_SALDO lê — o histórico de estoque do Apollo é HISTORICO_PROD'),
    (r'^(BKP_|F_BKP|M_[A-Z_]+\d{8}|.*_BKP_?\d*$|CARTAO_BKP_)', 'BACKUP', 'cópia avulsa datada no nome'),
    (r'^[A-Z]{2}_P_\d{8}O?$', 'BACKUP', 'fotos de lista de preço (IDPRODUTO, CODBARRA, DESCRICAO, UNIDADE, VRCUSTOREP, VRVENDA) datadas no nome'),
    (r'^LUHAN\d{8}$', 'BACKUP', 'cópias de CARTAO (74 colunas) de 23/04/2026'),
    (r'^(TMPVENDAS|Z_TEMP)_\d+$', 'AUX', 'tabela de trabalho por operador (udmPrincipal.pas:2861, uVendas.pas:424)'),
    (r'^SYS_EXPORT_', 'AUX', 'tabela de job do Data Pump'),
    (r'^AUDIT_', 'AUDITORIA', 'trigger AFTER EACH ROW de mesmo nome; "quem" = programa + máquina Windows (GSESSION); nenhuma view, procedure ou tela lê'),
    (r'^APOLLOGESTOR_', 'EXTERNA', 'app Apollo Gestor (vendas/API Controller.ApolloGestor.pas:1544); alimentação parou em 05/08/2026'),
    (r'^BI_', 'EXTERNA', 'BI web novo (BI_USUARIO/PAINEL/META) e MVs derivadas de VENDAS por dbms_refresh'),
    (r'^DW_', 'MORTA', 'painéis de DW sem referência em nenhum repositório (0-13 linhas)'),
]

VEREDITOS = {
    # ── sistema, acesso, log técnico ────────────────────────────────────────────────────────────────────────────
    'ATALHOS': ('AUX', 'lista de atalhos da UI; CONFIGURACAO_MENU.ATALHO_ID é fixo 1..6 (uConfiguracaoMenu.pas:246-321)'),
    'CONFIGURACAO_MENU': ('AUX', 'menu rápido de cada usuário (uConfiguracaoMenu.pas:150) — preferência de UI'),
    'MENUEXPRESS': ('AUX', 'contador de acessos por tela (uMenuSuperior.pas:728) — telemetria; usada offline p/ a FILA'),
    'CONFIG_STATUS_TELA': ('AUX', 'filtros salvos das telas de pesquisa (JSON) — preferência de UI'),
    'CONFIG_GRID': ('AUX', 'layout de grade DevExpress por operador (binário novo) — preferência de UI'),
    'MODULOS': ('MORTA', 'nenhum SQL no fonte; ACESSO nulo nas 199 linhas'),
    'TABELA_CADASTRO': ('AUX', 'par view→form registrado sozinho pelo uCadMaster.pas:1051 — roteamento do legado'),
    'APP_PERMISSOES': ('EXTERNA', 'permissões do app GestaoMobile (auth.ts:39-45); adiado com prova em uCadPerfilOperador.md'),
    'LICENCIAMENTO': ('EXTERNA', 'servidor central de licenças do fornecedor: 297 CNPJs, nenhum das lojas do cliente'),
    'LICENCIAMENTO_LOG': ('EXTERNA', 'idem LICENCIAMENTO'),
    'INFORMES': ('EXTERNA', 'telemetria do fornecedor (Controller.Licenciamento.pas:613)'),
    'INFORMES_LOG': ('EXTERNA', 'telemetria do fornecedor: 266 CNPJs em 30 dias'),
    'REGISTER': ('AUX', 'chave de licença do legado'),
    'VERSAO': ('AUX', 'versão dos binários do legado'),
    'SUPORTE': ('MORTA', '1 linha de 11/11/2024'),
    'ATUALIZACAO_SCRIPT': ('AUX', 'scripts de schema aplicados no legado (uLogin.pas:626) — o Apollo tem migrations/'),
    'PROCESSOS': ('AUX', 'trava de processo; job DELETAPROCESSOSVERSAO apaga a cada 5 s'),
    'TERMINAIS': ('PDV', 'cadastro de terminais PDV (UCadTerminais)'),
    'REMESSA_SERVER': ('AUX', 'fila de réplica p/ os PDVs (34 triggers REM_*; job apaga > 2 dias) — o Apollo tem o outbox'),
    'CENTRALIZADOR_GERAL_PDV': ('PDV', 'configuração de PDV (uCentralizadorConfigPDV)'),
    'MSN': ('AUX', 'marcador do trigger ATUALIZA_MSN (insert em PEDIDO_NF)'),
    'LOG_SISTEMA': ('AUX', 'log técnico (uLog.pas:71); 30 dias = só eventos SHOWPESQUISA'),
    'LOG_PESQUISA': ('AUX', 'SQL de cada pesquisa (binário novo); ninguém lê'),
    'MD_SERVICE_LOG_EVENTO': ('AUX', 'log do robô de DF-e; o Apollo guarda o próprio histórico de eventos (mig 148)'),
    'HIST_STARTUP_DB': ('AUX', 'trigger TRG_REGISTRA_STARTUP: cada partida do banco Oracle'),
    'EMPRESA_REMESSA': ('AUX', 'encanamento de réplica (triggers REM_EMPRESAS/REPLICA_REMESSA), irmã da REMESSA_LOTE excluída'),
    'CONTROLE_LOTE_REMESSA': ('MORTA', 'log de réplica de 18/08/2020 a 19/01/2022, irmã da REMESSA_LOTE excluída'),
    'CORRUPTED_ROWS': ('MORTA', 'saída de uma rodada de reparo'),
    'FATO_VENDAS_DIA': ('AUX', 'MERGE diário de VENDAS+GET_NF pelo PKG_DASHBOARD (job 03:30) — derivada'),
    'VENDAS_DASHBOARD': ('EXTERNA', 'cópia de VENDAS feita uma vez em 05/08/2026 para 26 views GET_APOLLOGESTOR_*'),
    'PAINEL1': ('MORTA', 'painel de notificação do PDV, última em 31/05/2023'),
    # ── caixa, financeiro, cartão ───────────────────────────────────────────────────────────────────────────────
    'HIST_TROCO_SOLIDARIO': ('PDV', 'gravada pelo PDV (vendas Uvenda.pas:5678); o resultado financeiro é o APAGAR origem T'),
    'TICKET': ('PDV', 'sem INSERT no retaguarda; CONSILIADO nulo em 49/49'),
    'HIST_VALE_TROCO': ('PDV', 'PDV Uvenda.pas:5686 + API ValeTroco; HIST_VALE_TROCO_BX tem 0 linhas'),
    'HIST_COMANDA': ('PDV', 'log do PDV (Udm.pas:5265), STATUS=CONSULTADA em 23/23'),
    'CONS_REG10': ('AUX', 'TRUNCATE em UbaixaCartao.pas:1618 e DELETE por conciliadora antes de refazer'),
    'CARTAO_SELECAO': ('AUX', 'seleção da tela de baixa (114 S × 340 mil N, um usuário por vez); o resultado fica em CARTAO'),
    'RETORNO_BOAVISTA': ('MORTA', 'substituída por RETORNO_PAG_BOAVISTA (última 10/02/2025)'),
    'BANDEIRAS_INTEGRACAO': ('MORTA', 'CODIGO_DEPARA preenchido 0/153; CARTAO.REMESSA_INTEGRACAO nulo nos 805 mil cartões desde 2025'),
    'OPERADORAS_INTEGRACAO': ('MORTA', 'CODIGO_DEPARA preenchido 0/53'),
    'RETORNO_PAGAMENTO_ELGIN': ('MORTA', 'teste de um dia (500 linhas de 02/05/2025, todas BAIXADO=N)'),
    'BANCOS_FEBRABAN': ('MORTA', 'lista pública sem leitor no fonte nem no Oracle; BANCOS está no plano'),
    'GERATITULOS': ('MORTA', 'planilha do próprio fornecedor (reajuste de mensalidade, parceiro APOLLO GESTAO)'),
    'GERATITULOS2021': ('MORTA', 'idem GERATITULOS'),
    'GERATITULOS2022': ('MORTA', 'idem GERATITULOS'),
    'GERATITULOS2023': ('MORTA', 'idem GERATITULOS'),
    'HISTORICO_MENSALIDADES_APOLLO': ('MORTA', 'cobrança do fornecedor (colunas "2018"/"2019"/"2020")'),
    'NFE_FINANCEIRO_MANIFESTO': ('EQUIVALENTE', 'as parcelas digitadas viram APAGAR: 264/264 chaves lançadas como NF, 233/269 parcelas batem'),
    'ARECEBER_BKP_FLAVIA': ('BACKUP', 'cópia de ARECEBER (93 colunas)'),
    'CARTOES_FLAVIA': ('BACKUP', 'planilha de adquirente (DATA_DA_VENDA, NÚMERO_DE_PARCELAS)'),
    'PIX_FLAVIA': ('BACKUP', 'planilha de adquirente'),
    'POS1609': ('BACKUP', 'planilha de adquirente'),
    'PIS1609': ('BACKUP', 'planilha de adquirente'),
    'CARTOES14A31': ('BACKUP', 'planilha de adquirente'),
    'POS_KAMALEOA': ('BACKUP', 'planilha de adquirente'),
    'CARTOESCANAA14A19': ('BACKUP', 'planilha de adquirente'),
    'CARTOESMARTINS032024': ('BACKUP', 'planilha de adquirente'),
    'NFC11112021': ('BACKUP', 'cópia de NFC (78 colunas)'),
    # ── fiscal, NF, SPED ────────────────────────────────────────────────────────────────────────────────────────
    'ICME_PROD_APURACAO': ('EQUIVALENTE', 'uma linha por loja×fornecedor×produto; as 4.640 de 2026 = nf_prod.icme (carregado)'),
    'REF_MENSAGENS_NF': ('EQUIVALENTE', 'o texto aplicado está em NF.OBS e no XML (548/580 de 2026 achados em NF.OBS)'),
    'NF_CUPONS_REFERENCIA': ('EQUIVALENTE', 'nf.cupons_ref_devolucao; as 5 linhas são VENDA_NFC=S, ramo que a view não usa'),
    'PRODUTOS_IMPORTACAO_NFE': ('AUX', 'produtos não casados do XML importado (uNF.pas:12290); o Apollo tem a própria importação'),
    'NF_CARTA_CORRECAO': ('MORTA', 'substituída por NFE_EVENTOS tipo 110110 (117 CC-e); 3 linhas de 2023'),
    'AMBIENTE_CONTINGENCIA': ('MORTA', 'as linhas ativas dizem ambiente 1, que é o padrão sem linha (udmNF.pas:9469)'),
    'DIFERENCANFPEDIDO': ('MORTA', 'FILA item 58; 9 linhas até 2021'),
    'ANALISE_NF_INUTILIZACAO': ('MORTA', 'uma rodada, só NFC-e modelo 65; tela com 0 acessos'),
    'INTERVALOS_ANALISADOS_NF': ('MORTA', 'idem ANALISE_NF_INUTILIZACAO'),
    'NFE': ('MORTA', 'número de série de certificado no repositório do Windows — não migra'),
    'ECF': ('MORTA', 'a única linha tem TERMINAL e IDEMPRESA nulos'),
    'MENSAGENS_NF': ('MORTA', 'lida só via PEDIDOSPRODUCAO, que tem 0 linhas'),
    'TEMP_PC_TIPOCREDITOISENTO': ('AUX', 'importação intermediária (texto corrompido); pc_tipocreditoisento está no plano'),
    'CREDITOS_DEBITOS_SPED': ('MORTA', 'códigos de Goiás; as lojas são MG; OPERACOES_ICMS tem 0 linhas'),
    'OBRIGACAO_RECOLHER': ('MORTA', 'APURACAO_ICMS_ST tem 0 linhas (FILA item 93)'),
    'CODIGO_AJUS_INFO_ADIC': ('MORTA', 'CODIGO_AJUSTE 0 linhas; EMPRESAS.COD_AJUS_* nulo nas 5 lojas'),
    'NFAUXSPED': ('AUX', 'foto de NF recriada a cada geração do SPED (horário bate com o FRMSPEDFISCAL)'),
    'NF_PRODAUXSPED': ('AUX', 'idem NFAUXSPED'),
    'VENDASAUXSPED': ('AUX', 'idem NFAUXSPED (FRMRELREGISTROS_ES)'),
    'DRE_CONTABIL_PLC_AUX': ('AUX', 'apagada e refeita a cada rodada do DRE (UFrmRelDREContabil.pas:550)'),
    'TRON_INTEGRACAO_CONTABIL': ('EQUIVALENTE', 'as 16 origens fixas de uTron.dfm:284 — IntegracaoContabilPage ORIGENS'),
    'UF': ('EQUIVALENTE', 'packages/shared/src/ufs.ts (mesmos códigos IBGE)'),
    'PAIS': ('EQUIVALENTE', 'o SPED usa 1058 fixo; 19.018/19.030 endereços são BRASIL, 0 estrangeiros'),
    'NCM_LISTA': ('MORTA', 'carga única de 10/03/2026 sem leitor; ncm (no plano) tem 11.344'),
    'NCMXCCLASS': ('AUX', 'usada uma vez para preencher produtos.codclass_trib (44.493/44.502 batem)'),
    'CEST_ANTIGA': ('BACKUP', 'cópia de CEST de 31/03/2026, 0 diferenças'),
    'NFC': ('PDV', 'NFC-e modelo 65 do PDV; 3 colunas derivadas em vendas (mig 299)'),
    'NFC_ARQUIVO': ('PDV', 'XML das NFC-e do PDV (guarda legal de 5 anos — decisão de quem guarda, não do Apollo)'),
    'NF_CANCELAMENTO': ('PDV', 'só modelo 65 em todos os anos de 2020 a 2026'),
    'FCP': ('MORTA', 'nenhum produto aponta codfcp; o FCP vem da alíquota e do XML (Achado 14)'),
    'COD_BENEFICIO_FISCAL': ('MORTA', '1 produto em 47.741 preenche cBenef; nenhuma loja tem HAB_COD_BENEFICIO_FIS (Achado 14)'),
    # ── compras, produto, estoque, produção, promoção ───────────────────────────────────────────────────────────
    'BONIFICACAO': ('EQUIVALENTE', 'grade de bonificação copiada p/ PEDIDOCOMPRA_I com BONIFICACAO=100 (uPedidoCompra.pas:7017); nenhum pedido bonificado desde 2023'),
    'BONIFICACAO_QTDE': ('EQUIVALENTE', 'idem BONIFICACAO'),
    'NFAUXCOMP': ('AUX', 'TRUNCATE + SP_PROCESSA_DADOS_AUX_COMP a cada abertura (uPedidoCompra.pas:791)'),
    'NF_PRODAUXCOMP': ('AUX', 'idem NFAUXCOMP'),
    'SELECT_PEDIDOS': ('AUX', 'refeita inteira pela proc POE_PEDIDOS'),
    'MOVIMENTOS_VENDAS': ('AUX', 'janela de 7 dias refeita pela proc POE_MOVIMENTOS_VENDAS'),
    'VENDAS_DIARIO': ('AUX', 'idem MOVIMENTOS_VENDAS'),
    'PRODUTOS_ANP': ('MORTA', '0 de 47.742 produtos têm CODIGO_ANP'),
    'MULTI_PRECO_ATACAREJO': ('MORTA', '3 linhas sem DML; os 2 produtos não venderam em 2026'),
    'ESTOQUE_PROD': ('MORTA', 'os 163.890 itens de NF desde 2025 têm ORIGEM_ESTOQUE=E; 8 saldos residuais'),
    'HISTORICO_PROD_PRODUCAO': ('MORTA', 'termina em 07/11/2023 com o módulo de produção parado'),
    'ITENS_TROCA_QTDE': ('EQUIVALENTE', 'cópia 1:1 de itens_troca (qtde 309/309, STATUS F = FECHADO 179/179)'),
    'TIPOCONFERENCIA': ('EXTERNA', 'gravada pela API do GestaoMobile (Controller.GestaoMobile.pas:4650); o retaguarda não lê'),
    'LOTE_CONFERENCIA_NF': ('MORTA', 'nada depois de 2022'),
    'LOTE_CONFERENCIA_NF_REL': ('MORTA', 'idem LOTE_CONFERENCIA_NF'),
    'CORRECAO_ESTOQUE': ('BACKUP', 'rascunho avulso de correção (23/01/2026), sem fonte nem PL/SQL'),
    'PESOS': ('BACKUP', 'planilha importada (colunas com acento)'),
    'PRODUCAO_HIST': ('MORTA', 'trigger de auditoria; produção: 5 em 2023, 1 em 2024, nenhuma depois; OPTANTE_BLOCOK=N'),
    'ITENS_PRODUCAO_HIST': ('MORTA', 'idem PRODUCAO_HIST'),
    'ITENS_PRODUCAO_RECEITA_HIST': ('MORTA', 'idem PRODUCAO_HIST'),
    'ITENS_PRODUCAO_TRANSFERENCIA': ('MORTA', 'termina em 07/11/2023'),
    'HISTORICO_PROD_DEP': ('MORTA', 'ESTOQUE_DEP é todo zero; última de 15/07/2023'),
    'COTACAO_LISTAF': ('MORTA', 'FILA #114 ("TESTE COTACAO", 02/01/2023)'),
    'COTACAO_LISTAF_ITENS': ('MORTA', 'idem COTACAO_LISTAF'),
    'COTACAO_FECHAMENTO_APURACAO': ('EQUIVALENTE', 'todo pedido dela está em COTACAO.PEDIDOS (carregado)'),
    'LOTEPRECOATACAREJO': ('MORTA', '1 linha de 22/07/2021'),
    'PRODUTOS_IMAGENS': ('MORTA', '3 linhas de 2024 (trigger/view do PDV)'),
    'SERVICOS': ('MORTA', 'catálogo LC 116; 0 produtos apontam'),
    'PARCEIROS_VENDEDORES_PRODUTOS': ('MORTA', 'sem quem grave nem quem leia; sem DML'),
    'PRODUTOS_FRACIONAMENTO': ('MORTA', '1 linha vazia'),
    'ANALISE_COMP_DIA_PROD': ('AUX', 'lote externo "Giros" refeito todo dia; o Apollo recalcula de vendas (mig 250/251)'),
    'ANALISE_COMPORTAMENTO_DIARIO': ('AUX', 'idem ANALISE_COMP_DIA_PROD'),
    'REL_ANALISE_COPORTAMENTO': ('AUX', 'idem ANALISE_COMP_DIA_PROD'),
    'REL_ANALISE_COMPORTAMENTO_GRID': ('AUX', 'buffer de impressão apagado e refeito (uAnaliseComportamento.pas:3195)'),
    'MOVIMENTACAO_MENSAL': ('AUX', 'cache externo refeito todo dia; a curva ABC do Apollo sai de vendas'),
    'SAIDADEP': ('MORTA', 'FILA #4; última 04/02/2021'),
    'DOCA': ('MORTA', 'FILA #138; 1 linha de 2020'),
    'AGENDA_DESCARREGAMENTO': ('MORTA', 'FILA #64; 3 linhas de 2020'),
    'LOTE_PRODUTO_VALIDADE': ('MORTA', 'FILA #107; 1 linha de 2021'),
    'W2_MULTI_PRECO': ('BACKUP', 'cópia de MULTI_PRECO (as 95 colunas existem lá)'),
    'PRODUTOS_ANTIGA': ('BACKUP', 'cópia de PRODUTOS de 31/03/2026'),
    'PRECOSFERREIRA': ('BACKUP', 'planilha importada'),
    'PRECOSMAXI': ('BACKUP', 'planilha importada (20/01/2026)'),
    'PRODUTOSMAXI': ('BACKUP', 'planilha importada (20/01/2026)'),
    'ABASTECIMENTO': ('MORTA', 'FILA: 4 registros; não é operação da casa'),
    'VEICULOS': ('MORTA', 'idem ABASTECIMENTO (2 linhas)'),
    'DEVOLUCAO': ('MORTA', '1 linha de 20/09/2022; a devolução viva é PEDIDO_DEVOLUCAO_COMPRA (convertida)'),
    'I_DEVOLUCAO': ('MORTA', 'idem DEVOLUCAO (2 itens)'),
    'ANEXOS': ('MORTA', '4 linhas; publicidade com anexos sem substrato (PUBLICIDADE* com 0 linhas)'),
    'AGENDA_DEPARTAMENTO_COMERCIAL': ('MORTA', '5 linhas; nenhuma unit com o form no repositório; 7 acessos'),
    'FGF_API': ('EXTERNA', 'catálogo estático do provedor FGF, que parou em 13/05/2025'),
    'HISTORICO_DINAMICO_FGF': ('EXTERNA', 'alterações do provedor FGF; última 13/05/2025'),
    'CODBARRA_CONS_PROD': ('MORTA', 'consultas de preço até 20/08/2020'),
    'CONFERENCIA_TEMP': ('AUX', 'coleta temporária de conferência (11 linhas de out/2024)'),
    'TEMPCOLETA': ('AUX', 'só IDPRODUTO — lista temporária de coleta'),
    'LOGATUALIZACOESEXCEL': ('MORTA', '1 linha de teste (TESTE.xlsx, 06/11/2025)'),
    'PLANILHASINTEGRADAS': ('MORTA', 'idem LOGATUALIZACOESEXCEL'),
    'REPOSICAO': ('MORTA', '1 linha de 23/12/2021'),
    'VENDASRELVENDAS': ('BACKUP', 'cópia de VENDAS criada em 23/09/2026 (fora de qualquer fonte)'),
    'HISTORICO_PDVRELVENDAS': ('BACKUP', 'criada em 23/09/2026 junto de VENDASRELVENDAS'),
    'MIDIA_DEPARTAMENTO': ('PDV', 'mídia dos painéis das lojas (views GET_PAINEIS/GET_MIDIA_DEPARTAMENTO); última 2023'),
    'ITENS_MIDIA_DEPARTAMENTO': ('PDV', 'idem MIDIA_DEPARTAMENTO'),
    'MIDIA_DEPARTAMENTO_EMPRESA': ('PDV', 'idem MIDIA_DEPARTAMENTO'),
    'PUBLICIDADE_PRE': ('PDV', 'view WPDV_PUBLICIDADE_PRE + trigger REM_PUBLICIDADE_PRE — conteúdo do PDV'),
    'REL_PRECOS_ALTERADOS_01': ('AUX', 'saída da procedure POE_REL_PRECOS_ALTERADOS'),
    'VENDAS_INTER': ('AUX', 'DELETE FROM VENDAS_INTER sem filtro antes de cada rodada (uRelInterseccaoProdutos)'),
}


def main():
    plano = json.load(open(os.path.join(BASE, 'plano-tabelas.json')))
    no_plano = set()
    for v in plano['fases'].values():
        no_plano |= {t.upper() for t in v}
    for k, v in plano['tabela_origem'].items():
        no_plano |= {str(v).upper(), k.upper()}
    no_plano |= {k.upper() for k in plano['excluidas']}

    host = os.environ.get('ORACLE_HOST', '192.168.1.240')
    con = oracledb.connect(user='pinheirao', password='apollo', dsn=oracledb.makedsn(host, 1521, sid='apollo'))
    cur = con.cursor()
    cur.execute('SET TRANSACTION READ ONLY')
    cur.execute('select table_name, num_rows from user_tables order by table_name')
    todas = cur.fetchall()

    sem, com = [], {}
    for t, n in todas:
        if t in no_plano:
            continue
        if n is not None and n > 20_000_000:
            cnt = int(n)
        else:
            try:
                cur.execute(f'select count(*) from (select 1 from "{t}" where rownum <= 1)')
                cnt = int(cur.fetchone()[0])
            except Exception:
                cnt = -1
        if cnt == 0:
            continue
        v = VEREDITOS.get(t)
        if not v:
            for rx, cat, prova in FAMILIAS:
                if re.match(rx, t):
                    v = (cat, prova)
                    break
        if v:
            com.setdefault(v[0], []).append(t)
        else:
            sem.append(t)
    con.rollback()

    print(f'tabelas com dado fora do plano: {sum(len(x) for x in com.values()) + len(sem)}')
    for cat in sorted(com):
        print(f'  {cat:12s} {len(com[cat]):4d}')
    orfas = [t for t in VEREDITOS if t in no_plano]
    if orfas:
        print(f'\n(veredito sobrando — a tabela entrou no plano, pode sair daqui: {", ".join(orfas)})')
    if sem:
        print(f'\n⛔ SEM VEREDITO: {len(sem)} — o dado delas some na virada sem ninguém ter decidido:')
        for t in sem:
            print(f'   {t}')
        print('\n   Cada uma precisa de destino (uma migration com todas as colunas — o plano a pega sozinho) ou de uma')
        print('   linha em VEREDITOS com a categoria e a prova.')
        sys.exit(1)
    print('\ntoda tabela com dado fora do plano tem veredito.')


if __name__ == '__main__':
    main()
