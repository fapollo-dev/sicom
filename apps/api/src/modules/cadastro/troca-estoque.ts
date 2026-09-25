import { sql } from 'kysely';

type AnyDB = any;
const n = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};
const r3 = (v: number) => Math.round((v + Number.EPSILON) * 1000) / 1000;

export interface ItemTroca {
  idproduto: unknown;
  qtde: unknown;
  vrcusto?: unknown;
  estoqueretirada?: unknown;
  fechado?: unknown;
  origem_fechamento?: unknown;
  codscrap?: unknown;
}
export interface ContextoTroca {
  emp: number;
  codtroca: number;
  /** TROCA.DTCADASTRO — a data que o gatilho compara com o inventário rotativo */
  dtcadastro: unknown;
  op: number | null;
}

const lugar = (v: unknown): 'LOJA' | 'DEPOSITO' | null => {
  const s = String(v ?? '').trim().toUpperCase();
  return s === 'LOJA' || s === 'DEPOSITO' ? s : null;
};
const hoje = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

/** o saldo do lugar (ESTOQUE da loja ou ESTOQUE_DEP) muda de `delta` e o QTDETROCA de `dTroca`; devolve o saldo novo */
async function mover(trx: AnyDB, emp: number, idproduto: number, onde: 'LOJA' | 'DEPOSITO', delta: number, dTroca: number): Promise<number> {
  const tabela = onde === 'LOJA' ? 'estoque' : 'estoque_dep';
  const r = (await sql<{ qtde: unknown }>`
    UPDATE ${sql.table(tabela)} SET qtde = coalesce(qtde, 0) + ${delta}, qtdetroca = coalesce(qtdetroca, 0) + ${dTroca}
     WHERE idproduto = ${idproduto} AND idempresa = ${emp} RETURNING qtde`.execute(trx)).rows[0];
  return n(r?.qtde);
}

/** a linha do KARDEX (HISTORICO_PROD do legado, com CODTROCA) — o depósito não tem kardex no Apollo (nenhuma troca de depósito na produção) */
async function kardex(trx: AnyDB, c: ContextoTroca, it: ItemTroca, onde: 'LOJA' | 'DEPOSITO', delta: number, saldoNovo: number, texto: string): Promise<void> {
  if (onde !== 'LOJA' || delta === 0) return;
  await trx.insertInto('historico_prod').values({
    idproduto: Number(it.idproduto), idempresa: c.emp, tipo: delta > 0 ? 'E' : 'S', qtde: Math.abs(delta),
    saldo_anterior: r3(saldoNovo - delta), saldo_novo: saldoNovo, origem: 'TROCA', codnf: null, codtroca: c.codtroca,
    historico: texto.slice(0, 255), data: sql`now()`, codoperador: c.op,
  }).execute();
}

/** há contagem do inventário rotativo do produto, no lugar, desde o dia da troca? (o gatilho devolve o que a troca tirou — a contagem já refletiu) */
async function temRotativo(trx: AnyDB, c: ContextoTroca, idproduto: number, onde: string): Promise<boolean> {
  const r = await sql`SELECT 1 FROM inventario_rotativo WHERE idempresa = ${c.emp} AND idproduto = ${idproduto}
                       AND data::date >= (${c.dtcadastro ?? null}::timestamptz)::date AND destino = ${onde} LIMIT 1`.execute(trx);
  return r.rows.length > 0;
}

const nomeLugar = (onde: 'LOJA' | 'DEPOSITO', loja: string, dep: string) => (onde === 'LOJA' ? loja : dep);

/** a RETIRADA do item para a troca: sai do lugar e entra no QTDETROCA (0 se já fechado), com a correção do rotativo */
async function retirada(trx: AnyDB, c: ContextoTroca, it: ItemTroca): Promise<void> {
  const onde = lugar(it.estoqueretirada);
  if (!onde) return;
  const q = r3(n(it.qtde));
  const dTroca = String(it.fechado ?? 'N') === 'S' ? 0 : q;
  const saldo = await mover(trx, c.emp, Number(it.idproduto), onde, -q, dTroca);
  await kardex(trx, c, it, onde, -q, saldo, `RETIRADA DO ESTOQUE ${nomeLugar(onde, 'LOJA', 'DEPOSITO')} PARA TROCA. CODIGO TROCA: ${c.codtroca}. DATA: ${hoje()}`);
  if (await temRotativo(trx, c, Number(it.idproduto), onde)) {
    const s2 = await mover(trx, c.emp, Number(it.idproduto), onde, q, 0);
    await kardex(trx, c, it, onde, q, s2, `ENTRADA DE ESTOQUE ${nomeLugar(onde, 'LOJA', 'DEP.')} PARA CORRIGIR INVENTARIO ROTATIVO AO INCLUIR A TROCA. CODIGO TROCA: ${c.codtroca}. DATA: ${hoje()}`);
  }
}

/** o ESTORNO do item: volta ao lugar e sai do QTDETROCA (0 se já fechado), com a correção do rotativo */
async function estorno(trx: AnyDB, c: ContextoTroca, it: ItemTroca): Promise<void> {
  const onde = lugar(it.estoqueretirada);
  if (!onde) return;
  const q = r3(n(it.qtde));
  const dTroca = String(it.fechado ?? 'N') === 'S' ? 0 : -q;
  const saldo = await mover(trx, c.emp, Number(it.idproduto), onde, q, dTroca);
  await kardex(trx, c, it, onde, q, saldo, `ESTORNO DA TROCA PARA O ESTOQUE ${nomeLugar(onde, 'LOJA', 'DEPOSITO')}. CODIGO TROCA: ${c.codtroca}. DATA: ${hoje()}`);
  if (await temRotativo(trx, c, Number(it.idproduto), onde)) {
    const s2 = await mover(trx, c.emp, Number(it.idproduto), onde, -q, 0);
    await kardex(trx, c, it, onde, -q, s2, `SAÍDA DE ESTOQUE ${nomeLugar(onde, 'LOJA', 'DEP.')} PARA CORRIGIR INVENTARIO ROTATIVO AO INCLUIR A TROCA. CODIGO TROCA: ${c.codtroca}. DATA: ${hoje()}`);
  }
}

/**
 * O gatilho `ESTOQUE_TROCA` (BEFORE INSERT/UPDATE/DELETE em ITENS_TROCA, lido da produção): a mercadoria SAI do estoque quando o item
 * entra na troca — não quando a troca fecha — e fica reservada em QTDETROCA até o fechamento. Os ramos, na ordem do gatilho:
 *  - inclusão: retirada; exclusão: estorno;
 *  - o lugar passou de vazio a LOJA/DEPOSITO: retirada; de preenchido a vazio: estorno;
 *  - trocou de lugar: LOJA→DEPOSITO = estorno da loja e retirada no depósito; DEPOSITO→LOJA = retirada na loja e estorno do depósito;
 *  - mesma quantidade e lugar, e o FECHADO mudou: fechar (N→S) só tira do QTDETROCA — devolve o saldo apenas com ORIGEM_FECHAMENTO
 *    TROCA ou SCRAP ("ENTRADA DE ESTOQUE LOJA PARA INCLUIR A TROCA…", + " SCRAP: n"; na produção a origem é sempre nula); reabrir (S→N)
 *    devolve ao QTDETROCA;
 *  - mesma lugar e a quantidade mudou: estorno da antiga e retirada da nova.
 * A retirada e o estorno corrigem o inventário rotativo contado desde o dia da troca (a contagem já tinha refletido a saída).
 */
export async function movimentoDaTroca(trx: AnyDB, c: ContextoTroca, antes: ItemTroca | null, depois: ItemTroca | null): Promise<void> {
  if (!antes && depois) return retirada(trx, c, depois);
  if (antes && !depois) return estorno(trx, c, antes);
  if (!antes || !depois) return;
  const la = lugar(antes.estoqueretirada);
  const ld = lugar(depois.estoqueretirada);
  if (ld && !la) return retirada(trx, c, depois);
  if (!ld && la) return estorno(trx, c, antes);
  if (!ld || !la) return;
  if (la !== ld) {
    if (la === 'LOJA') {
      await estorno(trx, c, antes);
      await retirada(trx, c, depois);
    } else {
      await retirada(trx, c, depois);
      await estorno(trx, c, antes);
    }
    return;
  }
  if (r3(n(depois.qtde)) !== r3(n(antes.qtde))) {
    await estorno(trx, c, antes);
    await retirada(trx, c, depois);
    return;
  }
  const fa = String(antes.fechado ?? 'N') === 'S';
  const fd = String(depois.fechado ?? 'N') === 'S';
  if (fa === fd) return;
  const q = r3(n(depois.qtde));
  if (!fa && fd) {
    const origem = String(depois.origem_fechamento ?? '').toUpperCase();
    if (origem === 'TROCA' || origem === 'SCRAP') {
      const saldo = await mover(trx, c.emp, Number(depois.idproduto), ld, q, -q);
      const scrap = n(depois.codscrap) > 0 ? ` SCRAP: ${n(depois.codscrap)}` : '';
      await kardex(trx, c, depois, ld, q, saldo, `ENTRADA DE ESTOQUE ${nomeLugar(ld, 'LOJA', 'DEPOSITO')} PARA INCLUIR A TROCA. CODIGO TROCA: ${c.codtroca}. DATA: ${hoje()}${scrap}`);
    } else {
      await mover(trx, c.emp, Number(depois.idproduto), ld, 0, -q);
    }
  } else {
    await mover(trx, c.emp, Number(antes.idproduto), la, 0, r3(n(antes.qtde)));
  }
}
