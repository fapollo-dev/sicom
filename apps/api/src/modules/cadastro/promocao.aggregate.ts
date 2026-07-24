import { sql } from 'kysely';
import { promocaoSchema, atualizarPromocaoSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';

/**
 * GESTÃO DE PROMOÇÕES (UCadPromocao) — agregado mestre-detalhe: `promocao` (header, empresaScoped, soft-delete)
 * + `clube_desconto` (motor de detalhe discriminado por ORIGEM). O TIPO do header escolhe a mecânica/aba.
 *
 * Mecânicas implementadas (ORIGEM = a letra do TIPO; OPERACAO carimbada server-side, fiel ao WHERE C.ORIGEM='x'
 * das queries do datamodule + ao golden do Oracle):
 *   - corte-1 P Preço Fixo        (OPERACAO='PRECO',    TIPO NULL, produto)  — VALOR = preço fixo.
 *   - corte-2 F Desconto Fixo     (OPERACAO='FIXO',     TIPO='$',  produto)  — VALOR = desconto em R$.
 *   - corte-2 V Desconto Variável (OPERACAO='VARIAVEL', TIPO='%',  produto)  — VALOR = percentual de desconto.
 *   - corte-3 R Código Promocional(OPERACAO='CODIGO_PROMOCIONAL', TIPO $/% do cliente, SEM produto, CÓDIGO obrig.)
 *              — VALOR = Vr. Desconto ($ ou %); CODIGO_PROMOCIONAL é a chave que o cliente digita no PDV.
 *   - corte-4 O Combo (OPERACAO='COMBO', TIPO $/% do cliente, produto) — VALOR = valor da promoção do produto;
 *              o header carrega VALORCOMBO + TIPOCOMBO ('C' a cada / 'M' maior que), COPIADOS em cada item
 *              (AtualizaDadosFilho pas:1517); item exige produto + TIPO + QUANTIDADE + VALOR (ProdutoComboValidado).
 *   - corte-5 L Leve Pague (OPERACAO='LEVE_PAGUE', TIPO NULL, produto) — QUANTIDADE (leve) + QUANTIDADE_PAGA (pague),
 *              ambas >0 (LevePagueValidada ';QUANTIDADE;QUANTIDADE_PAGA;'); o desconto é DERIVADO na leitura
 *              ((leve−pague)×VRVENDA/leve, QryLevePague). NÃO usa VALOR, mas o golden grava VALOR=0 (34/34) → default 0.
 *   - corte-6 C Categoria (OPERACAO='CATEGORIA', TIPO NULL) — alvo POLIMÓRFICO por SUBTIPO (CbbCategoria): O=Seção /
 *              D=Departamento / G=Grupo / S=Subgrupo (FAMILIAS_PROD.tipo) · P=Produto (ATIVO) · F=Fornecedor (FRN='S',
 *              escopo empresa) · M=Marca (não-excluída). VALOR = Promoção (%); exige SUBTIPO + alvo + VALOR>0 + alvo
 *              EXISTENTE + único por (SUBTIPO+alvo). Fornecedor e Marca são MUTUAMENTE EXCLUSIVOS na mesma promoção
 *              (CategoriaValidada pas:1728). ADIADO: ValidacaoOutraPromocao (sobreposição cross-promoção temporal,
 *              pas:1738) — módulo-wide, nenhuma mecânica a implementa. UI sugere Promoção max=100 (sem teto no servidor).
 *   - corte-7 A Atacarejo (OPERACAO='ATACAREJO', TIPO $/% do cliente [golden 100% '$'], produto) — tiers "compre
 *              QUANTIDADE+ → preço VALOR"; N tiers por produto → dedup por (produto+QUANTIDADE) (AtacarejoValidado
 *              pas:724 + RegistroDuplicadoMesmaPromocao CampoAuxiliar='QUANTIDADE'); exige produto+QUANTIDADE>0+VALOR>0.
 * Produto-alvo (P/F/V/O/L): produto EXISTENTE+ATIVO. VALOR>0 nas que o usam (Leve Pague não). Período+DESTINO do
 * header em cada filho (pas:1265/1534). QUANTIDADE: ≤0/vazio→1 (default), EXCETO Combo/Leve Pague que a EXIGEM (>0).
 *
 * - derivarItensTrx: carimba idempresa/LOJA (tenant), OPERACAO por ORIGEM + TIPO (fixo por mecânica, OU do cliente
 *   $/% quando tipoCliente=Código Promocional), período do header, ENCERRADA='F', QUANTIDADE (≤0/vazio→1), ATIVO='S'.
 * - validar: dtfim>dtini (schema); REJEITA ORIGEM fora das mecânicas (fail-closed anti-lixo), ORIGEM≠TIPO-do-header
 *   (self-origem), VALOR≤0, PRECO_GRUPO='S' (não suportado); produto EXISTENTE+ATIVO (P/F/V); CODIGO obrig. (R).
 *
 * DIVERGÊNCIAS CONSCIENTES / ADIADO (fiéis ao golden, documentadas p/ próximos cortes):
 * - grupo de preço (PRECO_GRUPO='S' + CODGRUPOPRECO + GrupoPrecoValidada cross-item, pas:2669) NÃO implementado —
 *   rejeitado por ora (feature "promoção por grupo de preço", corte futuro). Já era omitido no corte-1.
 * - Desconto Fixo multi-quantidade (VALOR = QTDE×desconto-unitário) não é lançável pela UI (qty fixa em 1); fiel a
 *   148/152 linhas do golden (qty=1). VR_COM_DESCONTO/DESCONTO_UNITARIO NÃO são colunas — o legado as DERIVA na
 *   leitura (QryFixo/QryVariavel) a partir de VALOR/QUANTIDADE + MULTI_PRECO.VRVENDA; gravar só VALOR não perde dado.
 * - % do Desconto Variável SEM teto de 100 no servidor (fiel: golden 0 linhas >100%, o legado não clampa); a UI
 *   sugere max=100 só como conveniência.
 * - CÓDIGO PROMOCIONAL opcional nas OUTRAS abas (setCodigoPromocional em P/F/D/G, pas:3050) NÃO exposto — 0 linhas
 *   do golden usam código fora do R; entra num corte futuro se necessário.
 * - Aba Código Promocional: limites MINIMO/MAXIMO/MAXIMO_ESTOQUE (Vr.Mínimo/Lim.Venda/Lim.Promoção) adiados na UI
 *   (golden NULL; backend já aceita as colunas). ATIVO é fixo 'S' server-side (como P/F/V).
 * - Combo: VALORCOMBO>0 + TIPOCOMBO∈{C,M} no header é FIEL (Validado pas:3577/3585, disparado sempre que TIPO='O').
 *   QUANTIDADE do combo é INTEIRA no legado (CedQuantidadeProdutoCombo DecimalPlaces=0/AsInteger); a UI usa decimais=0
 *   (o backend aceita fracionário, mas a UI não produz — golden 100% inteiras). Item TIPO default '$' quando omitido
 *   (o legado exige escolha explícita; assumimos '$', fiel ao golden 100% '$').
 * - ValidacaoOutraPromocao (pas:3178): sobreposição cross-promoção (mesmo produto+origem+destino, período sobreposto,
 *   mesma quantidade, em OUTRA promoção ativa) — bloqueio NÃO-gated do Combo — NÃO implementada (golden 0 sobreposições).
 *   Adiada (feature de overlap cross-promoção; nenhuma mecânica atual a implementa). RegistroDuplicadoMesmaPromocao
 *   (produto único NA MESMA promoção) É implementada no `validar` (PROMOCAO_PRODUTO_DUPLICADO).
 */
type MecanicaCfg = {
  operacao: string;
  tipo: string | null; // TIPO fixo da mecânica (ignorado quando tipoCliente=true)
  produto?: boolean; // exige idorigempromocao = produto EXISTENTE+ATIVO
  codigo?: boolean; // exige CODIGO_PROMOCIONAL não-vazio
  tipoCliente?: boolean; // TIPO vem do cliente ($/%), não fixo (Código Promocional / Combo)
  valor?: boolean; // exige VALOR>0 (a maioria; Leve Pague NÃO usa VALOR → force NULL)
  quantidade?: boolean; // exige QUANTIDADE>0 (não coage; Combo/Leve Pague/Atacarejo)
  quantidadePaga?: boolean; // exige QUANTIDADE_PAGA>0 (Leve Pague)
  combo?: boolean; // header carrega VALORCOMBO+TIPOCOMBO, copiados em cada item (Combo)
  categoria?: boolean; // alvo POLIMÓRFICO por SUBTIPO (Categoria: família/produto/fornecedor/marca) em idorigempromocao
  dedupPorQtde?: boolean; // dedup por (produto+QUANTIDADE) em vez de só produto (Atacarejo: N tiers por produto)
};
const MECANICAS: Record<string, MecanicaCfg> = {
  P: { operacao: 'PRECO', tipo: null, produto: true, valor: true }, // corte-1
  F: { operacao: 'FIXO', tipo: '$', produto: true, valor: true }, // corte-2
  V: { operacao: 'VARIAVEL', tipo: '%', produto: true, valor: true }, // corte-2
  R: { operacao: 'CODIGO_PROMOCIONAL', tipo: '$', tipoCliente: true, codigo: true, valor: true }, // corte-3 (sem produto)
  O: { operacao: 'COMBO', tipo: '$', produto: true, tipoCliente: true, quantidade: true, combo: true, valor: true }, // corte-4
  L: { operacao: 'LEVE_PAGUE', tipo: null, produto: true, quantidade: true, quantidadePaga: true }, // corte-5 (SEM valor: leve X pague Y)
  C: { operacao: 'CATEGORIA', tipo: null, valor: true, categoria: true }, // corte-6 (alvo por SUBTIPO; VALOR = Promoção %)
  A: { operacao: 'ATACAREJO', tipo: '$', produto: true, tipoCliente: true, valor: true, quantidade: true, dedupPorQtde: true }, // corte-7 (N tiers qtde→preço)
};
const TIPOCOMBO_VALIDOS = new Set(['C', 'M']); // 'C' a cada / 'M' maior que (CmbTipoCombo)
// Categoria (CbbCategoria): SUBTIPO → dimensão do alvo. O/D/G/S=família (FAMILIAS_PROD.tipo), P=produto, F=fornecedor, M=marca.
const SUBTIPO_VALIDOS = new Set(['O', 'D', 'G', 'S', 'P', 'F', 'M']);
const SUBTIPO_FAMILIA = new Set(['O', 'D', 'G', 'S']);
// existência do alvo da Categoria por SUBTIPO (fail-closed; o legado confia no picker, mas a API pode mandar lixo).
// Espelha os pickers do legado (pas:1228-1234): família por TIPO, produto ATIVO, fornecedor FRN='S' + empresa, marca não-excluída.
async function alvoCategoriaExiste(db: any, emp: number | null, subtipo: string, id: number): Promise<boolean> {
  if (SUBTIPO_FAMILIA.has(subtipo)) // O/D/G/S → família global (FAMILIAS_PROD.tipo)
    return !!(await db.selectFrom('familias_prod').select('codfamilia').where('codfamilia', '=', id).where('tipo', '=', subtipo).executeTakeFirst());
  if (subtipo === 'P') // produto GLOBAL, ATIVO='S' (mesmo filtro do GET_PRODUTOS que P/F/V exigem)
    return !!(await db.selectFrom('produtos').select('idproduto').where('idproduto', '=', id).where('ativo', '=', 'S').executeTakeFirst());
  if (subtipo === 'F') // fornecedor: FRN='S' + escopo de EMPRESA (parceiros é multi-empresa; convenção uniforme do repo)
    return !!(await db.selectFrom('parceiros').select('codparceiro').where('codparceiro', '=', id).where('frn', '=', 'S').where('idempresa', '=', emp).executeTakeFirst());
  if (subtipo === 'M') // marca GLOBAL, não soft-deletada (INDR<>'E')
    return !!(await db.selectFrom('marcas').select('idmarca').where('idmarca', '=', id).where(sql<boolean>`coalesce(indr,'I') <> 'E'`).executeTakeFirst());
  return false;
}
// lookup por chave PRÓPRIA (Object.hasOwn) — nunca casa '__proto__'/'constructor' (fail-closed defensivo).
const mecOf = (origem: unknown): MecanicaCfg | undefined => {
  const k = String(origem);
  return Object.hasOwn(MECANICAS, k) ? MECANICAS[k] : undefined;
};
export const promocaoAggregateConfig: AggregateConfig = {
  tabela: 'promocao',
  pk: 'idpromocao',
  view: 'get_promocao',
  rbacForm: 'FRMCADPROMOCAO',
  empresaScoped: true,
  softDelete: true,
  colunas: ['descricao', 'datainicio', 'datafim', 'empresas', 'opcao', 'tipo', 'destino', 'valorcombo', 'tipocombo', 'valor_minimo_compra'],
  colunasPesquisa: ['idpromocao', 'descricao', 'tipo', 'datainicio', 'datafim'],
  detalhes: [
    {
      tabela: 'clube_desconto',
      pk: 'idclubedesconto',
      fk: 'idpromocao',
      chave: 'itens',
      colunas: [
        'origem', 'operacao', 'idorigempromocao', 'tipo', 'subtipo', 'destino', 'valor', 'valorcombo', 'tipocombo',
        'quantidade', 'quantidade_paga', 'minimo', 'maximo', 'maximo_estoque', 'preco_grupo', 'grupo',
        'codigo_promocional', 'codperfil_parceiro', 'codparceiro', 'valor_minimo_compra', 'id_formas_pgto',
        'data_inicio', 'data_fim', 'encerrada', 'loja', 'ativo', 'idempresa',
      ],
      derivarItensTrx: async (itens, _trx, emp, header) => {
        // espelha SetDadosIniciaisPadrao/AtualizaDadosFilho (pas:1265/1534): copia período+DESTINO do header + defaults golden.
        const dtini = (header?.datainicio as string | undefined) ?? undefined;
        const dtfim = (header?.datafim as string | undefined) ?? undefined;
        const dest = (header?.destino as string | undefined) ?? undefined;
        const vcombo = header?.valorcombo; // VALORCOMBO/TIPOCOMBO do header (Combo) → copiados em cada item
        const tcombo = header?.tipocombo;
        return itens.map((it) => {
          const mec = mecOf(it.origem); // ORIGEM já validada em `validar`
          const q = Number(it.quantidade);
          return {
            ...it,
            idempresa: emp, // SEMPRE o tenant (não confia em valor do cliente) — integridade multi-empresa
            loja: it.loja ?? emp, // golden: LOJA=1 (=empresa)
            operacao: mec?.operacao, // OPERACAO por mecânica (server-auth): PRECO/FIXO/VARIAVEL/CODIGO_PROMOCIONAL/COMBO
            // TIPO: fixo da mecânica (NULL/$/%), OU do cliente ($/%, default '$') quando tipoCliente (Código Promocional/Combo).
            tipo: mec?.tipoCliente ? (it.tipo === '%' ? '%' : '$') : mec ? mec.tipo : null,
            // idorigempromocao = ALVO: produto (P/F/V/O) OU categoria/família/fornecedor/marca (C). Sem alvo → NULL.
            idorigempromocao: mec?.produto || mec?.categoria ? it.idorigempromocao : null,
            // SUBTIPO só na Categoria (dimensão do alvo); nas demais força NULL (não confia no cliente).
            subtipo: mec?.categoria ? it.subtipo : null,
            // VALOR só nas mecânicas que o usam; Leve Pague NÃO usa (desconto derivado de QTDE/QTDE_PAGA), mas o
            // golden grava VALOR=0 (34/34, nunca NULL — SetDadosIniciaisPadrao/import zeram) → default 0, não null.
            valor: mec?.valor ? it.valor : 0,
            destino: it.destino ?? dest, // DESTINO do header copiado em cada filho (SetDadosIniciaisPadrao pas:1265; golden 'T')
            // Combo: VALORCOMBO/TIPOCOMBO do header copiados em cada item (AtualizaDadosFilho pas:1517).
            // Nas demais mecânicas força NULL (não confia no cliente; igual ao idorigempromocao do R) — só o Combo os usa.
            valorcombo: mec?.combo ? vcombo : null,
            tipocombo: mec?.combo ? tcombo : null,
            encerrada: it.encerrada ?? 'F', // golden: ENCERRADA='F' (não encerrada)
            quantidade: q > 0 ? q : 1, // golden: QUANTIDADE=1 — coage ≤0/vazio→1 (Combo exige >0 em `validar`)
            data_inicio: it.data_inicio ?? dtini, // período do header em cada filho
            data_fim: it.data_fim ?? dtfim,
            ativo: it.ativo === 'N' ? 'N' : 'S',
          };
        });
      },
    },
  ],
  validar: async ({ dto, id, db }) => {
    const itens = (dto.itens ?? []) as Array<Record<string, unknown>>;
    // No UPDATE o dto é PARCIAL (base.partial). Como os itens COPIAM campos do header (tipo/destino/período/
    // valorcombo/tipocombo), backfillamos no dto os campos de header AUSENTES a partir da linha gravada — o engine
    // passa ESTE MESMO objeto dto tanto ao validar quanto ao derivarItensTrx (header). Sem isso, um PUT que só troca
    // itens gravaria esses campos como NULL nos filhos e a checagem de combo daria falso-positivo. (Create: id nulo → sem backfill.)
    if (id != null) {
      const atual = (await db
        .selectFrom('promocao')
        .select(['tipo', 'destino', 'datainicio', 'datafim', 'valorcombo', 'tipocombo'])
        .where('idpromocao', '=', id)
        .executeTakeFirst()) as Record<string, unknown> | undefined;
      if (atual) for (const k of ['tipo', 'destino', 'datainicio', 'datafim', 'valorcombo', 'tipocombo'] as const) {
        if (dto[k] === undefined && atual[k] != null) dto[k] = atual[k];
      }
    }
    const tipoHeader = dto.tipo != null ? String(dto.tipo) : undefined;
    // header do Combo: VALORCOMBO>0 + TIPOCOMBO ∈ {C,M} — FIEL ao `Validado` do legado (pas:3577 "Informe o tipo da
    // operação" + pas:3585 "Informe o valor da operação", disparados sempre que GpbOperacao.Visible ⇔ TIPO='O').
    const mecHeader = tipoHeader ? mecOf(tipoHeader) : undefined;
    if (mecHeader?.combo) {
      if (!(Number(dto.valorcombo) > 0) || !TIPOCOMBO_VALIDOS.has(String(dto.tipocombo)))
        throw new BusinessRuleError('PROMOCAO_COMBO_INVALIDO', { valorcombo: dto.valorcombo, tipocombo: dto.tipocombo });
    }
    const codigosVistos = new Set<string>(); // dedup de CODIGO_PROMOCIONAL no mesmo payload (case-insensitive, como a UI)
    const produtosVistos = new Set<string>(); // dedup de produto (ou produto+QUANTIDADE p/ Atacarejo) por promoção
    const categoriasVistas = new Set<string>(); // dedup Categoria por (SUBTIPO+alvo) (RegistroDuplicadoMesmaPromocao(True))
    const alvosCategoria: Array<{ subtipo: string; id: number }> = []; // alvos p/ checar existência após o loop
    for (const it of itens) {
      const origem = String(it.origem);
      const mec = mecOf(origem);
      // (a) só as mecânicas implementadas (P/F/V/R/O/L/C/A) são aceitas → outra ORIGEM = REJEITADA (fail-closed anti-lixo).
      if (!mec) throw new BusinessRuleError('PROMOCAO_ORIGEM_NAO_SUPORTADA', { origem: it.origem });
      // (b) a ORIGEM do item tem de casar com o TIPO do header (as mecânicas atuais são self-origem: P/F/V/R);
      //     sem isso um payload de API gravaria header 'X' com itens de mecânica 'Y' (header↔detalhe divergente).
      if (tipoHeader && origem !== tipoHeader) throw new BusinessRuleError('PROMOCAO_ORIGEM_DIVERGE_TIPO', { origem: it.origem, tipo: tipoHeader });
      // (c) VALOR>0 (PadraoValidada ';VALOR;') — só nas mecânicas que usam VALOR (Leve Pague NÃO usa). QUANTIDADE é
      //     coagida ≤0→1 no derivarItensTrx (fiel ao PREÇO FIXO), EXCETO Combo/Leve Pague que a EXIGEM (>0).
      if (mec.valor && !(Number(it.valor) > 0)) throw new BusinessRuleError('PROMOCAO_PRECO_INVALIDO', { idproduto: it.idorigempromocao });
      if (mec.quantidade && !(Number(it.quantidade) > 0)) throw new BusinessRuleError('PROMOCAO_QUANTIDADE_INVALIDA', { idproduto: it.idorigempromocao });
      // Leve Pague (LevePagueValidada ';QUANTIDADE;QUANTIDADE_PAGA;'): Qtde. Pague obrigatória (>0).
      if (mec.quantidadePaga && !(Number(it.quantidade_paga) > 0)) throw new BusinessRuleError('PROMOCAO_QUANTIDADE_PAGA_INVALIDA', { idproduto: it.idorigempromocao });
      // produto OBRIGATÓRIO nas mecânicas produto-alvo (P/F/V/O/L/A) — o legado exige ("Informe o produto"); sem isso
      // um payload de API gravaria idorigempromocao NULL = linha órfã (invisível ao JOIN PRODUTOS). Depois, produto ÚNICO
      // por promoção (RegistroDuplicadoMesmaPromocao pas:3170); Atacarejo permite N tiers → dedup por (produto+QUANTIDADE).
      if (mec.produto) {
        const pid = Number(it.idorigempromocao);
        if (!(Number.isFinite(pid) && pid > 0)) throw new BusinessRuleError('PROMOCAO_PRODUTO_OBRIGATORIO');
        const chave = mec.dedupPorQtde ? `${pid}|${Number(it.quantidade)}` : String(pid);
        if (produtosVistos.has(chave)) throw new BusinessRuleError('PROMOCAO_PRODUTO_DUPLICADO', { idproduto: pid });
        produtosVistos.add(chave);
      }
      // (d) grupo de preço (PRECO_GRUPO='S') exige o GrupoPrecoValidada cross-item do legado (pas:2669), ainda NÃO
      //     implementado (feature "promoção por grupo de preço", adiada) → rejeita p/ não gravar grupo meio-configurado.
      if (String(it.preco_grupo) === 'S') throw new BusinessRuleError('PROMOCAO_GRUPO_PRECO_NAO_SUPORTADO', { idproduto: it.idorigempromocao });
      // (e) Código Promocional (R): CODIGO obrigatório (CodigoPromocionalValidada ';VALOR;CODIGO_PROMOCIONAL;') + único no payload
      //     (dois itens com o mesmo código tornariam a busca por código no PDV ambígua; espelha o dedup da UI).
      if (mec.codigo) {
        const cod = String(it.codigo_promocional ?? '').trim();
        if (cod === '') throw new BusinessRuleError('PROMOCAO_CODIGO_OBRIGATORIO');
        const chave = cod.toUpperCase();
        if (codigosVistos.has(chave)) throw new BusinessRuleError('PROMOCAO_CODIGO_DUPLICADO', { codigo: cod });
        codigosVistos.add(chave);
      }
      // (f) Categoria (CategoriaValidada pas:2xxx): SUBTIPO válido + alvo (idorigempromocao) informado + único por (SUBTIPO+alvo).
      if (mec.categoria) {
        const subtipo = String(it.subtipo ?? '');
        if (!SUBTIPO_VALIDOS.has(subtipo)) throw new BusinessRuleError('PROMOCAO_CATEGORIA_SUBTIPO_INVALIDO', { subtipo: it.subtipo });
        const aid = Number(it.idorigempromocao);
        if (!(Number.isFinite(aid) && aid > 0)) throw new BusinessRuleError('PROMOCAO_CATEGORIA_ALVO_OBRIGATORIO', { subtipo });
        const chave = `${subtipo}|${aid}`;
        if (categoriasVistas.has(chave)) throw new BusinessRuleError('PROMOCAO_CATEGORIA_DUPLICADA', { subtipo, id: aid });
        categoriasVistas.add(chave);
        alvosCategoria.push({ subtipo, id: aid });
      }
    }
    // Fornecedor(F) e Marca(M) são MUTUAMENTE EXCLUSIVOS na mesma promoção (CategoriaValidada pas:1728: "apenas um do
    // tipo Fornecedor OU Marca por promoção" — vários F ou vários M ok, mas não F+M juntos).
    if (alvosCategoria.some((a) => a.subtipo === 'F') && alvosCategoria.some((a) => a.subtipo === 'M'))
      throw new BusinessRuleError('PROMOCAO_CATEGORIA_FORN_MARCA_EXCLUSIVOS');
    // alvo da Categoria EXISTE (por SUBTIPO: família O/D/G/S / produto P / fornecedor F / marca M) — fail-closed.
    const emp = currentTenant().empresaId ?? null;
    for (const a of alvosCategoria) {
      if (!(await alvoCategoriaExiste(db, emp, a.subtipo, a.id)))
        throw new BusinessRuleError('PROMOCAO_CATEGORIA_ALVO_INEXISTENTE', { subtipo: a.subtipo, id: a.id });
    }
    // produto EXISTENTE+ATIVO — só para as mecânicas produto-alvo (P/F/V/O/L/A). R (código) e C (categoria) não usam produto aqui.
    const ids = [
      ...new Set(
        itens
          .filter((it) => mecOf(it.origem)?.produto)
          .map((it) => Number(it.idorigempromocao))
          .filter((n) => Number.isFinite(n) && n > 0),
      ),
    ];
    if (ids.length) {
      // produto deve EXISTIR e estar ATIVO (fiel ao filtro GET_PRODUTOS ativo='S' + PROMOCAO_PRODUTO_INATIVO da Agenda).
      const prods = (await db.selectFrom('produtos').select(['idproduto', 'ativo']).where('idproduto', 'in', ids).execute()) as Array<{ idproduto: number; ativo: string }>;
      const porId = new Map(prods.map((p) => [Number(p.idproduto), p]));
      for (const id of ids) {
        const p = porId.get(id);
        if (!p) throw new BusinessRuleError('PROMOCAO_PRODUTO_INEXISTENTE', { idproduto: id });
        if (p.ativo !== 'S') throw new BusinessRuleError('PROMOCAO_PRODUTO_INATIVO', { idproduto: id });
      }
    }
  },
};

export const PromocaoAggregateController = createAggregateController({
  path: 'cadastro/promocao',
  config: promocaoAggregateConfig,
  schema: promocaoSchema,
  updateSchema: atualizarPromocaoSchema,
});
