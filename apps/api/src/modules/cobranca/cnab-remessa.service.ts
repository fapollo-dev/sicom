import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/** só dígitos (CNPJ/CPF/CEP vêm formatados no cadastro). */
const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');
/** numérico zero-pad à esquerda, truncando pela DIREITA quando estoura (como o legado, que corta o campo). */
const num = (v: unknown, n: number) => dig(v).slice(-n).padStart(n, '0');
/** alfanumérico: MAIÚSCULO, sem acento, brancos à direita, cortado no tamanho do campo. */
const alfa = (v: unknown, n: number) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^\x20-\x7E]/g, ' ')
    .slice(0, n)
    .padEnd(n, ' ');
/**
 * campo numérico de tamanho FIXO que NÃO tolera excesso: zero-pad à esquerda quando falta, ERRO quando sobra.
 * Truncar (o que o `num` faz) é pior que falhar aqui — agência '3034-9' viraria '0349' e o arquivo sairia
 * válido, com a agência ERRADA (fold auditoria).
 */
const numExato = (v: unknown, n: number, campo: string) => {
  const d = dig(v);
  if (!d.length) throw new BusinessRuleError('CNAB_CAMPO_OBRIGATORIO', { campo });
  if (d.length > n) throw new BusinessRuleError('CNAB_CAMPO_LONGO', { campo, valor: d, maximo: n });
  return d.padStart(n, '0');
};
/**
 * "seu número" (111-120): `NumeroDocumento` do legado (uConfBoleto.pas:2717-2721) — a DUPLICATA quando existe
 * (e não é o literal 'BOLETO'), senão o DOCNF, senão o **CODRCB**. No golden 4.802 de 4.989 títulos têm
 * duplicata vazia e o campo sai com o CODRCB; sem isto 97% das linhas saíam em branco. Sem `trim`: o golden
 * preserva o espaço inicial de ' - 001/001'.
 */
const seuNumero = (t: Record<string, unknown>) => {
  const dup = String(t.duplicata ?? '');
  if (dup.trim() && dup.trim().toUpperCase() !== 'BOLETO') return dup;
  const docnf = String(t.docnf ?? '');
  return docnf.trim() ? docnf : String(t.codrcb);
};
/** valor em CENTAVOS, 13 posições (o CNAB não tem separador). */
const cent = (v: unknown, n = 13) => String(Math.round((Number(v) || 0) * 100)).padStart(n, '0');
/** data DDMMAA já formatada pelo PG — garante 6 dígitos mesmo com valor nulo/estranho. */
const ddmmaa6 = (v: unknown) => {
  const s = dig(v);
  return s.length === 6 ? s : '000000';
};

/**
 * CNAB de COBRANÇA — a REMESSA de ENVIO nos layouts **ITAÚ 400** (corte-1) e **BANCO DO BRASIL 400**
 * (corte-2a: registro `7` + complemento `5`), da tela `uConfBoleto` / FRMCONFBOLETO.
 *
 * PROCEDÊNCIA: o legado monta o arquivo pela lib ACBrBoleto, então o layout foi reconstruído **byte a byte
 * contra o golden**: `ARQUIVO_REMESSA_ARECEBER.ARQUIVO` guarda os 306 arquivos reais em Base64 e decodifica no
 * .TXT que foi ao banco (306/306 decodificados; 7.055 linhas de 400 + 124 de 240; 3.787 títulos Itaú). Dossiê
 * com a tabela de posições: `docs/04-screen-dossier/dossiers/retaguarda/uConfBoleto-CNAB.md`.
 *
 * O que o GOLDEN provou (e portanto é constante, não campo de tela): carteira **109** (3.785/3.787; vem de
 * `contas_bancarias.carteira_cobranca`), código da carteira **`I`** (escritural), ocorrência **01** (remessa),
 * banco cobrador **341**, agência cobradora **00000**, espécie **01** (duplicata mercantil), aceite **N**,
 * e o **DAC do nosso número NÃO vai no arquivo** — a posição 71 é `'0'` nos 3.787 títulos (o dígito vive no
 * boleto/código de barras, não na remessa). `nosso_numero` = **CODRCB** (golden: título 65706 → `00065706`),
 * `seu_numero` (111-120) = os 10 primeiros chars da DUPLICATA, nome do arquivo = `CB` + DDMM + seq(2) + `.TXT`.
 *
 * MÁQUINA DE ESTADO fiel (uConfBoleto.pas:2657 e :505): emitir boleto RECUSA título com
 * `registro_arq_remessa` ∈ {'S','C'} ("enviado ao banco ou cancelado"); a remessa de envio só leva
 * `status_boleto = 'E'`; depois de gerar, o título fica `registro_arq_remessa='S'` + nome/data do arquivo.
 *
 * DIVERGÊNCIAS DELIBERADAS (documentadas):
 *  1) o arquivo é guardado em TEXTO PURO (o Base64 do CLOB é artefato do legado; o cutover decodifica).
 *  2) ACENTO: o golden preserva latin-1 (`SÃO JORGE` em 77 das 3.787 linhas); aqui `alfa()` normaliza p/ ASCII
 *     (`SAO JORGE`) — escolha consciente (ASCII é o que todo banco aceita), não descuido.
 *  3) a CONTA é exigida da empresa do tenant; o legado busca só por NROCONTA+CODBCO e no golden usa uma conta
 *     da empresa 1 com a config da empresa 50. O isolamento por empresa é lei do novo.
 *  4) emissão (151-156) com DTVENDA nula usa o VENCIMENTO; o legado emite a data-zero do Delphi ('301299').
 *  5) ordem dos detalhes: o legado ordena por SETOR/CODAUX (nulos no golden ⇒ indefinida); aqui é
 *     CODPARCEIRO, CODRCB — o que o golden de fato mostra em 112 dos 124 arquivos testáveis.
 *  6) a AGÊNCIA sai de CONF_INTEG_BANCARIA; o legado lê BANCOS.AGENCIA (coincidem no golden).
 *  7) o CNAB 240 do Santander (15 arquivos de 240 chars no golden, conf 102) é corte-3.
 *
 * CORTE-3 (declarado): CNAB 240 (a 4ª
 * config) · os outros bancos que a tela atende (237/33/104/756/707, incl. o nome 'OMU' do Daycoval que é o
 * único uso real de SEQUENCIAREMESSA) · remessa de CANCELAMENTO (`status_boleto='C'`) e de ALTERAÇÃO DE
 * VENCIMENTO (`TIPOREMESSA='AV'`, que lê REMESSAS_BOLETOS_CONTAS) · o RETORNO (baixa automática — sem golden
 * no Oracle, exige recon próprio) · o BOLETO em si: PDF/impressão/reimpressão, e-mail, **código de barras e
 * linha digitável** (CODBARRABOLETO/CODIGITACAOBOLETO, :2850), instruções (GerarInstrucao + OBS_BOLETO),
 * DIAS_BAIXA_BOLETO (DataBaixa) e bolecode/PIX (HABILITAR_BOLECODE='S' na conf 21 do golden).
 */
@Injectable()
export class CnabRemessaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** os títulos da empresa com o estado do boleto — a grade da tela (a seleção no legado é manual). */
  async titulos(f: { codparceiro?: number; status?: string; de?: string; ate?: string }) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    let q = db.selectFrom('areceber as r')
      .leftJoin('parceiros as p', 'p.codparceiro', 'r.codparceiro')
      .select([
        'r.codrcb', 'r.duplicata', 'r.valor', 'r.dtvenc', 'r.dtvenda', 'r.codparceiro',
        sql`p.razao`.as('razao'), 'r.status_boleto', 'r.registro_arq_remessa',
        'r.nosso_numero_boleto', 'r.nome_arq_remessa', 'r.data_arq_remessa',
      ])
      .where('r.codempresa', '=', emp)
      .where(sql`coalesce(r.quitada,'N')`, '<>', 'S')
      .where(sql`coalesce(r.agrupado,'N')`, '=', 'N'); // agrupado não entra na cobrança bancária (:856)
    if (f.codparceiro != null) q = q.where('r.codparceiro', '=', Number(f.codparceiro));
    if (f.status) q = q.where('r.status_boleto', '=', f.status);
    if (f.de) q = q.where(sql`r.dtvenc`, '>=', sql`${f.de}::date`);
    if (f.ate) q = q.where(sql`r.dtvenc`, '<', sql`(${f.ate}::date + 1)`);
    const linhas = (await q.orderBy('r.dtvenc').orderBy('r.codrcb').limit(1000).execute()) as Record<string, unknown>[];
    return { linhas, totais: { linhas: linhas.length, valor: linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0) } };
  }

  /**
   * EMITE o boleto dos títulos (o `btnBoleto` do legado, sem o PDF): carimba `status_boleto='E'` e o
   * NOSSO NÚMERO = CODRCB (golden). Recusa título já enviado ao banco ou cancelado — a guarda de :505.
   */
  async emitir(codrcbs: number[]) {
    const emp = this.emp();
    if (!codrcbs.length) throw new BusinessRuleError('SEM_TITULOS');
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      const ts = (await trx.selectFrom('areceber')
        .select(['codrcb', 'registro_arq_remessa', 'quitada', 'valor'])
        .where('codempresa', '=', emp).where('codrcb', 'in', codrcbs).forUpdate().execute()) as Array<Record<string, unknown>>;
      if (ts.length !== codrcbs.length) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO');
      // o legado bloqueia só o ENVIADO: com 'C' (cancelado no banco) ele PERMITE reemitir (:2612)
      const enviados = ts.filter((t) => String(t.registro_arq_remessa ?? '') === 'S');
      if (enviados.length) throw new BusinessRuleError('BOLETO_JA_ENVIADO', { codrcb: enviados.map((t) => t.codrcb) });
      const quitados = ts.filter((t) => String(t.quitada ?? 'N') === 'S');
      if (quitados.length) throw new BusinessRuleError('TITULO_QUITADO', { codrcb: quitados.map((t) => t.codrcb) });
      await trx.updateTable('areceber')
        .set({ status_boleto: 'E', nosso_numero_boleto: sql`codrcb` })
        .where('codempresa', '=', emp).where('codrcb', 'in', codrcbs).execute();
      return { ok: true, emitidos: codrcbs.length };
    });
  }

  /**
   * GERA a remessa de ENVIO (Itaú 400) dos títulos `status_boleto='E'` informados: monta header/detalhes/
   * trailer, grava `arquivo_remessa_areceber` + `ref_remessa_areceber` + `remessas_boletos`, carimba os
   * títulos e INCREMENTA `conf_integ_bancaria.sequenciaremessa` (estado, sob lock).
   */
  async gerar(dto: { codconf: number; codconta: number; codrcbs: number[] }) {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    if (!dto.codrcbs.length) throw new BusinessRuleError('SEM_TITULOS');
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      // 1) config da integração (lock: o sequencial do arquivo é estado compartilhado)
      const conf = (await trx.selectFrom('conf_integ_bancaria')
        .selectAll().where('codconf', '=', dto.codconf).where('codempresa', '=', emp).forUpdate()
        .executeTakeFirst()) as Record<string, unknown> | undefined;
      if (!conf) throw new BusinessRuleError('CONF_BANCARIA_NAO_ENCONTRADA', { codconf: dto.codconf });
      if (String(conf.layoutremessa ?? '') !== 'C400') {
        throw new BusinessRuleError('LAYOUT_NAO_SUPORTADO', { layout: conf.layoutremessa });
      }
      // o BANCO do layout vem de BANCOS.CODBCOBLT (o número FEBRABAN), como no legado (`cdsReceberCODBCOBLT`,
      // :2420). **CODFORNBCO não é o banco** — é o código do CEDENTE (a conf Santander do golden tem '0542455').
      // Fallback p/ o CODFORNBCO quando o cadastro do banco não tem CODBCOBLT (dado legado incompleto).
      const bancoRow = (await trx.selectFrom('bancos').select(['codbcoblt'])
        .where('codbco', '=', Number(conf.codbco)).executeTakeFirst()) as { codbcoblt?: number | null } | undefined;
      // CODBCOBLT é NUMBER no Oracle (1 = BB, 341 = Itaú, 33 = Santander) → normaliza p/ 3 dígitos
      const febraban = (dig(bancoRow?.codbcoblt ?? '') || dig(conf.codfornbco)).padStart(3, '0');
      if (!['341', '001'].includes(febraban)) throw new BusinessRuleError('BANCO_NAO_SUPORTADO', { banco: febraban || conf.codfornbco });
      const bb = febraban === '001';

      // 2) conta bancária (carteira/variação) + empresa (nome do cedente)
      const conta = (await trx.selectFrom('contas_bancarias')
        .select(['codconta', 'nroconta', 'codbco', 'carteira_cobranca', 'variacao_carteira', 'convenio'])
        .where('codconta', '=', dto.codconta).where('idempresa', '=', emp)
        .executeTakeFirst()) as Record<string, unknown> | undefined;
      if (!conta) throw new BusinessRuleError('CONTA_BANCARIA_NAO_ENCONTRADA', { codconta: dto.codconta });
      // a conta TEM de ser do banco da configuração — sem isto sai um arquivo Itaú com agência da conf e
      // conta/carteira de outro banco: estruturalmente válido e rejeitado (ou pior, aceito) pelo banco.
      if (Number(conta.codbco) !== Number(conf.codbco)) {
        throw new BusinessRuleError('CONTA_DE_OUTRO_BANCO', { conta_banco: conta.codbco, conf_banco: conf.codbco });
      }
      // o CEDENTE é a empresa da config (CODEMPRESA_ARQUIVO) quando informada, não a do tenant (:2128-2137):
      // no golden 233 dos 236 arquivos Itaú trazem a razão/CNPJ da empresa 50 configurada.
      const empCedente = Number(conf.codempresa_arquivo) > 0 ? Number(conf.codempresa_arquivo) : emp;
      const empresa = (await trx.selectFrom('empresas')
        .select([sql`razao_social`.as('razao'), 'cnpj']).where('idempresa', '=', empCedente)
        .executeTakeFirst()) as { razao?: string; cnpj?: string } | undefined;
      if (!empresa) throw new BusinessRuleError('EMPRESA_CEDENTE_NAO_ENCONTRADA', { idempresa: empCedente });

      // 3) títulos: lock ANTES (FOR UPDATE não pode conviver com LEFT JOIN no PG — lado nullable), depois
      //    a leitura com os joins do sacado. Só os do escopo, com boleto EMITIDO e ainda não enviados
      //    (o filtro do taGerarRemessa: STATUS_BOLETO='E').
      await trx.selectFrom('areceber').select('codrcb')
        .where('codempresa', '=', emp).where('codrcb', 'in', dto.codrcbs).forUpdate().execute();
      const titulos = (await trx.selectFrom('areceber as r')
        .leftJoin('parceiros as p', 'p.codparceiro', 'r.codparceiro')
        // o legado casa o endereço por CODEND **OU** por CODPARCEIRO (uConfBoleto.pas:820-821): 3.879 parceiros
        // do golden têm CODEND nulo e 3.800 deles têm endereço achável pelo parceiro. Sem o fallback o sacado
        // sairia sem CNPJ e a remessa inteira morreria no numExato.
        .leftJoin('parceiros_end as e', (j) => j.on(sql<boolean>`e.codend = p.codend or (p.codend is null and e.codparceiro = p.codparceiro)`))
        .select([
          'r.codrcb', 'r.duplicata', sql`r.docnf`.as('docnf'), 'r.codparceiro', 'r.valor', 'r.nosso_numero_boleto',
          'r.status_boleto', 'r.registro_arq_remessa',
          // as datas saem FORMATADAS do PG (DDMMAA) no fuso do negócio: o driver devolve timestamptz como
          // objeto Date, e formatar no JS já custou uma linha de tamanho errado (o CNAB é posicional).
          sql`to_char(r.dtvenc at time zone 'America/Sao_Paulo','DDMMYY')`.as('venc_fmt'),
          sql`to_char(coalesce(r.dtvenda, r.dtvenc) at time zone 'America/Sao_Paulo','DDMMYY')`.as('emissao_fmt'),
          sql`p.razao`.as('razao'), sql`p.tipofj`.as('tipofj'),
          sql`e.cnpj_cpf`.as('cnpj_cpf'), sql`e.endereco`.as('endereco'), sql`e.numero`.as('numero'),
          sql`e.complemento`.as('complemento'),
          sql`e.bairro`.as('bairro'), sql`e.cep`.as('cep'), sql`e.cidade`.as('cidade'), sql`e.uf`.as('uf'),
        ])
        .where('r.codempresa', '=', emp).where('r.codrcb', 'in', dto.codrcbs)
        .where(sql`coalesce(r.agrupado,'N')`, '=', 'N') // título agrupado NÃO vai ao banco (uConfBoleto.dfm:856)
        .orderBy('r.codparceiro').orderBy('r.codrcb').execute()) as Array<Record<string, unknown>>; // golden: por CODPARCEIRO
      if (titulos.length !== dto.codrcbs.length) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO');
      const naoEmitidos = titulos.filter((t) => String(t.status_boleto ?? '') !== 'E');
      if (naoEmitidos.length) throw new BusinessRuleError('BOLETO_NAO_EMITIDO', { codrcb: naoEmitidos.map((t) => t.codrcb) });
      const jaEnviados = titulos.filter((t) => String(t.registro_arq_remessa ?? '') === 'S');
      if (jaEnviados.length) throw new BusinessRuleError('BOLETO_JA_ENVIADO', { codrcb: jaEnviados.map((t) => t.codrcb) });
      // valor e vencimento são o miolo da cobrança: valor ≤ 0 sairia como cobrança POSITIVA (o campo do CNAB
      // não tem sinal) e vencimento nulo sairia '000000' — os dois passam o validador e o BANCO rejeita.
      const semValor = titulos.filter((t) => !(Number(t.valor) > 0));
      if (semValor.length) throw new BusinessRuleError('REMESSA_VALOR_INVALIDO', { codrcb: semValor.map((t) => t.codrcb) });
      const semVenc = titulos.filter((t) => dig(t.venc_fmt).length !== 6);
      if (semVenc.length) throw new BusinessRuleError('TITULO_SEM_VENCIMENTO', { codrcb: semVenc.map((t) => t.codrcb) });

      // 4) nome do arquivo — regra REAL do legado (GetNomeArqRemessa, uConfBoleto.pas:1432-1461):
      //    'CB' FIXO + DDMM + contador de 2 dígitos que começa em 1 TODO DIA e sobe até achar nome livre,
      //    testado contra REMESSAS_BOLETOS por **NOMEBANCO + ano corrente** (:1385-1402). Provas no golden:
      //    23/02/2022 → CB230201..04; 24/02/2022 → CB240201 (REINICIA); 27/07/2023 → CB270701.TXT (Itaú) e
      //    CB270701.REM (BB) no mesmo dia — contadores independentes por banco.
      //    Extensão (:1409-1425): '.TST' se ARQTESTE<>'N' · '.TXT' p/ 341/707 · '.REM' p/ os demais.
      //    ⚠ SEQUENCIAREMESSA da config NÃO é o sequencial do arquivo: no fonte inteiro ela só serve ao nome
      //    'OMU' do Daycoval (getSequenciaDaycoval :429-479). Por isso não a incrementamos mais aqui.
      const hoje = (await sql<{ d: string }>`select to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM-DD') as d`
        .execute(trx)).rows[0].d;
      const [aa, mm, dd] = hoje.split('-');
      // nome do banco (o contador do dia é por NOMEBANCO + ano) e extensão: '.TST' em teste, '.TXT' p/ 341/707
      // e '.REM' p/ os demais (:1409-1425). O golden confirma: 236 .TXT do Itaú e 70 .REM.
      const nomeBanco = bb ? 'Banco do Brasil' : 'BANCO ITAU SA';
      const ext = String(conf.arqteste ?? 'N') !== 'N' ? 'TST' : (bb ? 'REM' : 'TXT');

      // sequencial GLOBAL da remessa por banco (o GetID('NRSEQREMESSAITAU') do legado). O BB o imprime no
      // header (101-107): o golden CB010302.REM traz '0000704' e o log tem codremessabanco=704.
      const seqBanco = (await (bb
        ? sql<{ n: number }>`select nextval('seq_remessa_banco_bb')::int as n`
        : sql<{ n: number }>`select nextval('seq_remessa_banco_itau')::int as n`).execute(trx)).rows[0].n;
      const usados = new Set(((await trx.selectFrom('remessas_boletos').select('nomearquivoremessa')
        .where('nomebanco', '=', nomeBanco)
        .where(sql`extract(year from dtgeracao at time zone 'America/Sao_Paulo')`, '=', Number(aa))
        .execute()) as Array<{ nomearquivoremessa: string | null }>).map((r) => String(r.nomearquivoremessa ?? '')));
      // o contador do legado é por banco, mas o NOME não carrega o banco: em modo teste ('.TST') dois bancos
      // colidiriam no unique da tabela — então os nomes já gravados na empresa também entram no conjunto.
      for (const r of (await trx.selectFrom('arquivo_remessa_areceber').select('nomearquivo')
        .where('codempresa', '=', emp).execute()) as Array<{ nomearquivo: string }>) usados.add(r.nomearquivo);
      let nomearquivo = '';
      for (let cont = 1; cont <= 99 && !nomearquivo; cont++) {
        const cand = `CB${dd}${mm}${String(cont).padStart(2, '0')}.${ext}`;
        if (!usados.has(cand)) nomearquivo = cand;
      }
      if (!nomearquivo) throw new BusinessRuleError('REMESSAS_DO_DIA_ESGOTADAS', { dia: `${dd}/${mm}` });

      // mensagem do boleto (352-391 no BB): o VALOR bate 563/563 com OBS_BOLETO[0..40] da config, mas o
      // OBS_BOLETO não aparece em nenhum fonte legado (o texto do legado sai de GerarInstrucao por título) —
      // procedência por VALOR, não por regra. Os placeholders `$(Multa)`/`$(Juros)` NÃO são expandidos pelo
      // legado, então são removidos aqui: sem isso o literal '$(MULTA)' poderia ir ao banco.
      const mensagemBoleto = String(conf.obs_boleto ?? '').replace(/\$\([^)]*\)/g, '').replace(/[\r\n]+/g, ' ').trim();

      // 5) o arquivo. Itaú 400: agência 4 dígitos, conta 5 + DAC 1 — validado, NUNCA truncado (o legado tem a
      //    mesma recusa: "Nro. de Conta / Dígito Verificador inválido para o banco Itaú", uConfBoleto.pas:1851).
      // agência e conta saem por RECORTE, como o legado: `copy(AGENCIA,1,4)` e `copy(NROCONTA,1,len-2)` + o
      // último char como DAC (:2544/:2549). O cadastro real traz máscara ('2591-7', '0204.001'), então recortar
      // é o que reproduz o golden — validando depois que o recorte é numérico (nunca truncar em silêncio).
      const agRaw = String(conf.agencia ?? '').slice(0, 4);
      if (!/^\d{4}$/.test(agRaw)) throw new BusinessRuleError('AGENCIA_INVALIDA', { agencia: conf.agencia });
      const ag = agRaw;
      const ctaRaw = String(conta.nroconta ?? '');
      const ctaNumRaw = ctaRaw.slice(0, Math.max(0, ctaRaw.length - 2));
      const ctaDvRaw = ctaRaw.slice(-1);
      const maxCta = bb ? 8 : 5; // o campo da conta tem 8 posições no BB e 5 no Itaú
      if (!new RegExp(`^\\d{1,${maxCta}}$`).test(ctaNumRaw) || !/^\d$/.test(ctaDvRaw)) {
        throw new BusinessRuleError('CONTA_INVALIDA', { nroconta: conta.nroconta, esperado: `até ${maxCta} dígitos + dígito verificador` });
      }
      const ctaNum = ctaNumRaw.padStart(maxCta, '0'); // Itaú: 5 · BB: 8 (golden '00059052')
      const ctaDv = ctaDvRaw;
      // o BB leva o DV da AGÊNCIA no arquivo (5º dígito do cadastro: '2591-7' → ag '2591' + DV '7')
      const agDv = dig(conf.agencia).slice(4, 5) || '0';
      // carteira: no Itaú o golden é 109 em 3.785/3.787 (default seguro); no BB é '17' e um default silencioso
      // sairia como '09' — então lá é obrigatória, como a variação (fold auditoria [MÉDIA]).
      const carteira = bb
        ? numExato(conta.carteira_cobranca, 3, 'carteira de cobrança da conta (obrigatória no BB)')
        : numExato(conta.carteira_cobranca ?? 109, 3, 'carteira de cobrança da conta');
      const linhas: string[] = [];
      // HEADER (tipo 0) — posições confirmadas no golden de cada banco
      const dataGer = `${dd}${mm}${aa.slice(2)}`;
      linhas.push(bb
        // BB: ag(4)+DV+conta(8)+DV+'000000'+cedente(30)+'001'+nome(15)+data+**sequencial de 7 dígitos**(101-107)
        ? '0' + '1' + 'REMESSA' + '01' + alfa('COBRANCA', 15) +
          ag + agDv + ctaNum + ctaDv + '000000' +
          alfa(empresa?.razao, 30) + '001' + alfa('BANCO DO BRASIL', 15) + dataGer +
          String(seqBanco).padStart(7, '0') +          // 101-107 sequencial da remessa (= CODREMESSABANCO)
          ' '.repeat(22) +                             // 108-129
          numExato(conta.convenio, 7, 'convênio da conta bancária') + // 130-136 (const nos 55 headers do golden)
          ' '.repeat(258) + '000001'
        : '0' + '1' + 'REMESSA' + '01' + alfa('COBRANCA', 15) +
          ag + '00' + ctaNum + ctaDv + ' '.repeat(8) +
          alfa(empresa?.razao, 30) + '341' + alfa('BANCO ITAU SA', 15) + dataGer +
          ' '.repeat(294) + '000001',
      );
      // DETALHES (tipo 1)
      titulos.forEach((t) => {
        const docSac = dig(t.cnpj_cpf);
        const tipoSac = docSac.length > 11 ? '02' : '01';
        const docEmp = dig(empresa?.cnpj);
        if (![11, 14].includes(docEmp.length)) throw new BusinessRuleError('CNPJ_CEDENTE_INVALIDO', { cnpj: empresa?.cnpj });
        // fiel a uConfBoleto.pas:2796-2800: logradouro + número (0/null → '') + complemento, SEM trim —
        // o golden preserva o espaço duplo ('AV CAXAMBU  QUADRA51 LOTE 18'). Diferia em 86% das linhas.
        const nro = Number(t.numero) ? String(t.numero) : (String(t.numero ?? '').trim() && String(t.numero) !== '0' ? String(t.numero) : '');
        const endereco = `${String(t.endereco ?? '')} ${nro} ${String(t.complemento ?? '')}`;
        // o BB monta o endereço com VÍRGULA e com trim do logradouro (563/563 do golden; a junção é do ACBr e
        // é por banco — o Itaú usa espaço). O cadastro real tem logradouro com espaço à esquerda.
        const enderecoBb = `${String(t.endereco ?? '').trim()}, ${nro}, ${String(t.complemento ?? '')}`;
        if (bb) {
          // BANCO DO BRASIL 400 — registro 7 (título) + registro 5 (complemento, CONSTANTE no golden).
          // LIMITE DECLARADO: convênio de 7 dígitos + nosso número de 10 (o layout BB casa os dois tamanhos).
          // 100% do golden é convênio 3500121; convênio de 4/6 dígitos exige outro par e é corte-3.
          const conv = numExato(conta.convenio, 7, 'convênio da conta bancária');
          const variacao = numExato(conta.variacao_carteira, 3, 'variação da carteira (obrigatória no BB)');
          const nn10 = numExato(t.nosso_numero_boleto ?? t.codrcb, 10, `nosso número do título ${t.codrcb}`);
          linhas.push(
            '7' + (docEmp.length > 11 ? '02' : '01') + docEmp.padStart(14, '0') +
            ag + agDv + ctaNum + ctaDv +               // 18-21 ag · 22 DV · 23-30 conta · 31 DV
            conv +                                     // 32-38 convênio
            alfa(seuNumero(t), 25) +                   // 39-63 = SEU NÚMERO completo (:2723; o 111-120 é ele truncado em 10)
            conv + nn10 +                              // 64-80 nosso número = convênio + 10 dígitos
            '0000' + ' '.repeat(7) +                   // 81-84 · 85-91
            variacao + '0'.repeat(7) + ' '.repeat(5) + // 92-94 variação · 95-101 · 102-106
            carteira.slice(-2) +                       // 107-108 carteira ('17')
            '01' +                                     // 109-110 ocorrência: remessa
            alfa(seuNumero(t), 10) +                   // 111-120 seu número
            ddmmaa6(t.venc_fmt) + cent(t.valor) +      // 121-126 · 127-139
            '001' + '0000' + ' ' +                     // 140-142 banco · 143-146 · 147
            '01' + 'N' + ddmmaa6(t.emissao_fmt) +      // 148-149 espécie · 150 aceite · 151-156 emissão
            '0'.repeat(62) +                           // 157-218 (instruções/mora/desconto/IOF/abatimento)
            tipoSac + numExato(docSac, 14, `CNPJ/CPF do sacado do título ${t.codrcb}`) +
            alfa(`${t.codparceiro} - ${String(t.razao ?? '')}`, 37) + ' '.repeat(3) + // 235-271 nome (37) + 272-274 brancos
            alfa(enderecoBb, 40) + alfa(t.bairro, 12) + num(t.cep, 8) + // CEP ausente vira zeros, como no legado
            alfa(t.cidade, 15) + alfa(t.uf, 2) +
            alfa(mensagemBoleto, 40) +                 // 352-391 mensagem
            ' '.repeat(3) + String(linhas.length + 1).padStart(6, '0'),
          );
          // registro 5: constante em 1.343/1.343 do golden ('5' + '999' + 18 zeros + brancos)
          linhas.push('5' + '999' + '0'.repeat(18) + ' '.repeat(372) + String(linhas.length + 1).padStart(6, '0'));
          return;
        }
        linhas.push(
          '1' + (docEmp.length > 11 ? '02' : '01') + docEmp.padStart(14, '0') +
          ag + '00' + ctaNum + ctaDv + ' '.repeat(4) +
          '0000' +                                  // 34-37 instrução de alegação
          ' '.repeat(25) +                          // 38-62 uso da empresa
          numExato(t.nosso_numero_boleto ?? t.codrcb, 8, `nosso número do título ${t.codrcb}`) + // 63-70 = CODRCB
          '0'.repeat(13) +                          // 71-83 (DAC não vai no arquivo: '0' nos 3.787 do golden)
          carteira +                                // 84-86
          ' '.repeat(21) +                          // 87-107 uso do banco
          'I' +                                     // 108 carteira escritural
          '01' +                                    // 109-110 ocorrência: remessa
          alfa(seuNumero(t), 10) +                  // 111-120 seu número (duplicata ou CODRCB)
          ddmmaa6(t.venc_fmt) + cent(t.valor) +     // 121-126 / 127-139
          '341' + '00000' +                         // 140-142 / 143-147
          '01' + 'N' + ddmmaa6(t.emissao_fmt) +     // 148-149 espécie / 150 aceite / 151-156 emissão
          '00' + '00' +                             // 157-160 instruções
          '0'.repeat(13) + '000000' + '0'.repeat(13) + // 161-173 mora / 174-179 dt desc / 180-192 vlr desc
          '0'.repeat(13) + '0'.repeat(13) +         // 193-205 IOF / 206-218 abatimento
          tipoSac + numExato(docSac, 14, `CNPJ/CPF do sacado do título ${t.codrcb}`) +
          alfa(`${t.codparceiro} - ${String(t.razao ?? '')}`, 30) + ' '.repeat(10) + // 235-264: CODPARCEIRO - RAZÃO (:2794)
          alfa(endereco, 40) + alfa(t.bairro, 12) + num(t.cep, 8) + alfa(t.cidade, 15) + alfa(t.uf, 2) +
          ' '.repeat(30) + ' '.repeat(4) + '00' + '0'.repeat(6) + ' ' +
          String(linhas.length + 1).padStart(6, '0'),
        );
      });
      // TRAILER (tipo 9): sequencial = total de registros
      linhas.push('9' + ' '.repeat(393) + String(linhas.length + 1).padStart(6, '0'));
      const arquivo = linhas.join('\r\n') + '\r\n';

      const erros = validarCnab400(arquivo);
      if (erros.length) throw new BusinessRuleError('CNAB_INVALIDO', { erros });

      // 6) persistência + carimbos
      const arq = (await trx.insertInto('arquivo_remessa_areceber')
        .values({ arquivo, nomearquivo, codempresa: emp, codcontacorrente: Number(conta.codconta), usucadastro: op })
        .returning('cod_remessa_areceber').executeTakeFirstOrThrow()) as { cod_remessa_areceber: number };
      const codRem = Number(arq.cod_remessa_areceber);
      await trx.insertInto('ref_remessa_areceber')
        .values(titulos.map((t) => ({ cod_remessa_areceber: codRem, codrcb: Number(t.codrcb) }))).execute();
      // o log da remessa (pai) + 1 linha por título (filho) — é de REMESSAS_BOLETOS_CONTAS que o legado lê a
      // consulta e o cancelamento (corte-2). CODREMESSABANCO é o sequencial GLOBAL do banco (GetID no legado).
      const log = (await trx.insertInto('remessas_boletos').values({
        nomearquivoremessa: nomearquivo, tiporemessa: 'E', codbanco: Number(febraban), nomebanco: nomeBanco,
        nroconta: String(conta.nroconta ?? ''), agencia: String(conf.agencia ?? ''), codremessabanco: seqBanco,
      }).returning('codremessa').executeTakeFirstOrThrow()) as { codremessa: number };
      await trx.insertInto('remessas_boletos_contas')
        .values(titulos.map((t) => ({ codremessa: Number(log.codremessa), codrcb: Number(t.codrcb) }))).execute();
      await trx.updateTable('areceber')
        .set({
          registro_arq_remessa: 'S', nome_arq_remessa: nomearquivo, data_arq_remessa: sql`now()`, status_boleto: null,
          // LOGIN (texto), como no Oracle — o legado grava OperadorLOGIN.AsString
          login_arq_remessa: sql`(select o.login from operadores o where o.codoperador = ${op})`,
        })
        .where('codempresa', '=', emp).where('codrcb', 'in', dto.codrcbs).execute();

      return {
        cod_remessa_areceber: codRem, nomearquivo, titulos: titulos.length,
        registros: linhas.length, sequencia_banco: seqBanco, codremessa: Number(log.codremessa),
        valor_total: titulos.reduce((s, t) => s + (Number(t.valor) || 0), 0),
      };
    });
  }

  /** as remessas geradas (a grade de consulta) e o conteúdo de uma delas (o "baixar arquivo"). */
  async remessas(f: { de?: string; ate?: string }) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    let q = db.selectFrom('arquivo_remessa_areceber as a')
      .leftJoin('contas_bancarias as c', 'c.codconta', 'a.codcontacorrente')
      .select([
        'a.cod_remessa_areceber', 'a.nomearquivo', 'a.dtcadastro', 'a.codcontacorrente',
        sql`c.nroconta`.as('nroconta'),
        sql`(select count(*) from ref_remessa_areceber r where r.cod_remessa_areceber = a.cod_remessa_areceber)`.as('titulos'),
        sql`length(a.arquivo)`.as('bytes'),
      ])
      // escopo pela COLUNA da remessa (não pelo join da conta: conta apagada tornava a remessa órfã visível
      // a todas as empresas e invisível ao dono — fold auditoria [ALTA])
      .where('a.codempresa', '=', emp);
    if (f.de) q = q.where(sql`a.dtcadastro`, '>=', sql`${f.de}::date`);
    if (f.ate) q = q.where(sql`a.dtcadastro`, '<', sql`(${f.ate}::date + 1)`);
    const linhas = (await q.orderBy('a.cod_remessa_areceber', 'desc').limit(500).execute()) as Record<string, unknown>[];
    return { linhas };
  }

  async arquivo(cod: number) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const r = (await db.selectFrom('arquivo_remessa_areceber as a')
      .select(['a.cod_remessa_areceber', 'a.nomearquivo', 'a.arquivo'])
      .where('a.cod_remessa_areceber', '=', cod)
      .where('a.codempresa', '=', emp) // escopo ESTRITO pela coluna (fold auditoria [ALTA]: IDOR entre empresas)
      .executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!r) throw new BusinessRuleError('REMESSA_NAO_ENCONTRADA', { cod });
    return { cod_remessa_areceber: r.cod_remessa_areceber, nomearquivo: r.nomearquivo, arquivo: r.arquivo, validacao: { erros: validarCnab400(String(r.arquivo)) } };
  }
}

/**
 * Validador ESTRUTURAL do CNAB 400 (o mesmo padrão do validador do SPED, que já pegou reject de PVA):
 * toda linha com 400 chars, header `0` primeiro, trailer `9` último, tipos conhecidos, sequencial contínuo
 * 1..N e o trailer igual à CONTAGEM de registros. Erros vazios ⇒ estruturalmente válido.
 */
export function validarCnab400(arquivo: string): string[] {
  const erros: string[] = [];
  const linhas = arquivo.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
  if (!linhas.length) return ['arquivo vazio'];
  linhas.forEach((l, i) => {
    if (l.length !== 400) erros.push(`linha ${i + 1}: ${l.length} chars (o CNAB 400 exige 400)`);
    if (!['0', '1', '5', '7', '9'].includes(l[0])) erros.push(`linha ${i + 1}: tipo de registro '${l[0]}' desconhecido (0/1/5/7/9)`);
    const seq = l.slice(394, 400);
    if (!/^\d{6}$/.test(seq)) erros.push(`linha ${i + 1}: sequencial '${seq}' não numérico`);
    else if (Number(seq) !== i + 1) erros.push(`linha ${i + 1}: sequencial ${Number(seq)} fora de ordem (esperado ${i + 1})`);
  });
  if (linhas[0][0] !== '0') erros.push('o primeiro registro deve ser o header (tipo 0)');
  if (linhas[linhas.length - 1][0] !== '9') erros.push('o último registro deve ser o trailer (tipo 9)');
  else if (Number(linhas[linhas.length - 1].slice(394, 400)) !== linhas.length) {
    erros.push(`trailer: sequencial ${Number(linhas[linhas.length - 1].slice(394, 400))} ≠ total de registros ${linhas.length}`);
  }
  for (const [i, l] of linhas.entries()) {
    // os campos de negócio conferidos ficam nas MESMAS posições nos dois layouts (Itaú detalhe '1', BB '7')
    if (l[0] !== '1' && l[0] !== '7') continue;
    const venc = l.slice(120, 126);
    const dia = Number(venc.slice(0, 2)); const mes = Number(venc.slice(2, 4));
    if (!/^\d{6}$/.test(venc) || dia < 1 || dia > 31 || mes < 1 || mes > 12) {
      erros.push(`linha ${i + 1}: vencimento '${venc}' inválido (DDMMAA)`);
    }
    if (!/^\d{13}$/.test(l.slice(126, 139))) erros.push(`linha ${i + 1}: valor '${l.slice(126, 139)}' não numérico`);
    if (Number(l.slice(126, 139)) <= 0) erros.push(`linha ${i + 1}: valor do título zerado`);
    // nosso número: 8 dígitos no Itaú (63-70) e 17 no BB (convênio + 10) — nos dois casos tudo numérico
    const nnCampo = l[0] === '7' ? l.slice(63, 80) : l.slice(62, 70);
    if (!/^\d+$/.test(nnCampo)) erros.push(`linha ${i + 1}: nosso número '${nnCampo}' inválido`);
    if (dig(l.slice(220, 234)).replace(/^0+/, '') === '') erros.push(`linha ${i + 1}: sacado sem CNPJ/CPF`);
  }
  return erros;
}
