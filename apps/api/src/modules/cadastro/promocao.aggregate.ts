import { promocaoSchema, atualizarPromocaoSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';

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
 * Produto-alvo (P/F/V): produto EXISTENTE+ATIVO. Todas: VALOR>0, QUANTIDADE≤0/vazio→1, período do header em cada
 * filho (AtualizaDadosFilho pas:1534). As demais mecânicas entram em cortes seguintes.
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
 */
type MecanicaCfg = {
  operacao: string;
  tipo: string | null; // TIPO fixo da mecânica (ignorado quando tipoCliente=true)
  produto?: boolean; // exige idorigempromocao = produto EXISTENTE+ATIVO
  codigo?: boolean; // exige CODIGO_PROMOCIONAL não-vazio
  tipoCliente?: boolean; // TIPO vem do cliente ($/%), não fixo (Código Promocional: checkbox '%')
};
const MECANICAS: Record<string, MecanicaCfg> = {
  P: { operacao: 'PRECO', tipo: null, produto: true }, // corte-1
  F: { operacao: 'FIXO', tipo: '$', produto: true }, // corte-2
  V: { operacao: 'VARIAVEL', tipo: '%', produto: true }, // corte-2
  R: { operacao: 'CODIGO_PROMOCIONAL', tipo: '$', tipoCliente: true, codigo: true }, // corte-3 (sem produto)
};
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
        return itens.map((it) => {
          const mec = mecOf(it.origem); // ORIGEM já validada em `validar`
          const q = Number(it.quantidade);
          return {
            ...it,
            idempresa: emp, // SEMPRE o tenant (não confia em valor do cliente) — integridade multi-empresa
            loja: it.loja ?? emp, // golden: LOJA=1 (=empresa)
            operacao: mec?.operacao, // OPERACAO por mecânica (server-auth): PRECO/FIXO/VARIAVEL/CODIGO_PROMOCIONAL
            // TIPO: fixo da mecânica (NULL/$/%), OU do cliente ($/%, default '$') quando tipoCliente (Código Promocional).
            tipo: mec?.tipoCliente ? (it.tipo === '%' ? '%' : '$') : mec ? mec.tipo : null,
            // produto só nas mecânicas produto-alvo; nas demais (Código Promocional) força NULL (não confia no cliente).
            idorigempromocao: mec?.produto ? it.idorigempromocao : null,
            destino: it.destino ?? dest, // DESTINO do header copiado em cada filho (SetDadosIniciaisPadrao pas:1265; golden 'T')
            encerrada: it.encerrada ?? 'F', // golden: ENCERRADA='F' (não encerrada)
            quantidade: q > 0 ? q : 1, // golden: QUANTIDADE=1 — coage ≤0/vazio→1 (fiel ao PREÇO FIXO; `?? 1` não pegava 0)
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
    // TIPO do header: do dto; no UPDATE parcial sem tipo, carrega o gravado — senão a guarda origem≠tipo seria
    // burlável por um PUT que troca os itens sem reenviar o tipo (header↔detalhe divergente).
    let tipoHeader = dto.tipo != null ? String(dto.tipo) : undefined;
    if (!tipoHeader && id != null) {
      const atual = (await db.selectFrom('promocao').select('tipo').where('idpromocao', '=', id).executeTakeFirst()) as { tipo?: string } | undefined;
      if (atual?.tipo != null) tipoHeader = String(atual.tipo);
    }
    const codigosVistos = new Set<string>(); // dedup de CODIGO_PROMOCIONAL no mesmo payload (case-insensitive, como a UI)
    for (const it of itens) {
      const origem = String(it.origem);
      const mec = mecOf(origem);
      // (a) só as mecânicas implementadas (P/F/V/R) são aceitas → outra ORIGEM = REJEITADA (fail-closed anti-lixo).
      if (!mec) throw new BusinessRuleError('PROMOCAO_ORIGEM_NAO_SUPORTADA', { origem: it.origem });
      // (b) a ORIGEM do item tem de casar com o TIPO do header (as mecânicas atuais são self-origem: P/F/V/R);
      //     sem isso um payload de API gravaria header 'X' com itens de mecânica 'Y' (header↔detalhe divergente).
      if (tipoHeader && origem !== tipoHeader) throw new BusinessRuleError('PROMOCAO_ORIGEM_DIVERGE_TIPO', { origem: it.origem, tipo: tipoHeader });
      // (c) VALOR>0 (PadraoValidada ';VALOR;'). QUANTIDADE é coagida ≤0→1 no derivarItensTrx (fiel ao PREÇO FIXO).
      if (!(Number(it.valor) > 0)) throw new BusinessRuleError('PROMOCAO_PRECO_INVALIDO', { idproduto: it.idorigempromocao });
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
    }
    // produto EXISTENTE+ATIVO — só para as mecânicas produto-alvo (P/F/V). R (código) não tem produto.
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
