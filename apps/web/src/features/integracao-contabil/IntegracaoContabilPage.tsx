import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import {
  cartaoPendentes, integrarCartao, estornarCartao, integrarBaixa, estornarBaixa,
  integrarDocumento, estornarDocumento, type Periodo, type Resultado, type TipoDoc,
} from './integracaoApi';

/**
 * INTEGRAÇÃO CONTÁBIL (`FRMTRON`, `uTron.pas`). Dossiê: `uTron-integracao-contabil.md`.
 *
 * A tela do legado é um radio de 15 origens, um período e dois botões: exportar e estornar. Apesar do nome,
 * não gera arquivo nenhum — grava partidas no `DIARIO`. Esta tela é a mesma coisa, com as origens que os
 * cortes 1-3 entregaram (1,63 milhão das 1,75 milhão de linhas do razão do cliente) e dizendo, para as que
 * ficaram de fora, POR QUE ficaram.
 *
 * O agrupamento "Outras movimentações financeiras" é do legado: `ApolloExportarBaixaFinanceiroNovo`
 * (`uTron.pas:318-328`) roda caixa, adiantamento e convênio nessa ordem, numa transação só.
 */

type Executor = (p: Periodo) => Promise<Resultado[]>;

interface Origem {
  id: string;
  label: string;
  /** a origem no `DIARIO` — é como o contador identifica o lançamento. */
  codigos: string;
  nota?: string;
  integrar?: Executor;
  estornar?: Executor;
  /** o que o campo "código" significa nesta origem (o `ParametrosIntegracao.Codigo` do legado). */
  rotuloCodigo?: string;
}

const um = (fn: (p: Periodo) => Promise<Resultado>): Executor => async (p) => [await fn(p)];

const ORIGENS: Origem[] = [
  {
    id: 'cp', label: 'Contas a pagar', codigos: '13',
    rotuloCodigo: 'Conta a pagar',
    integrar: um((p) => integrarDocumento('cp', p)), estornar: um((p) => estornarDocumento('cp', p)),
  },
  {
    id: 'cr', label: 'Contas a receber', codigos: '14',
    rotuloCodigo: 'Conta a receber',
    integrar: um((p) => integrarDocumento('cr', p)), estornar: um((p) => estornarDocumento('cr', p)),
  },
  {
    id: 'bxap', label: 'Baixas de contas a pagar', codigos: '15 · 53 · 54 · 55',
    nota: 'Leva junto os juros, acréscimos e descontos da baixa.',
    rotuloCodigo: 'Lote da baixa',
    integrar: um((p) => integrarBaixa('ap', p)), estornar: um((p) => estornarBaixa('ap', p)),
  },
  {
    id: 'bxar', label: 'Baixas de contas a receber', codigos: '16 · 56 · 57 · 58',
    nota: 'Leva junto os juros, acréscimos e descontos da baixa.',
    rotuloCodigo: 'Lote da baixa',
    integrar: um((p) => integrarBaixa('ar', p)), estornar: um((p) => estornarBaixa('ar', p)),
  },
  {
    id: 'cartao', label: 'Baixas de cartões', codigos: '51 · 61 · 62',
    nota: 'A maior origem do razão: a baixa, a taxa da operadora e as outras despesas.',
    rotuloCodigo: 'Lote da baixa',
    integrar: um(integrarCartao), estornar: um(estornarCartao),
  },
  {
    id: 'financeiro', label: 'Outras movimentações financeiras', codigos: '64 · 63 · 65',
    nota: 'Movimentação do caixa, adiantamento a parceiros e agrupamento de convênio — nesta ordem, como no legado.',
    integrar: async (p) => {
      const r: Resultado[] = [];
      for (const t of ['caixa', 'adto', 'convenio'] as TipoDoc[]) r.push(await integrarDocumento(t, p));
      return r;
    },
    estornar: async (p) => {
      const r: Resultado[] = [];
      for (const t of ['caixa', 'adto', 'convenio'] as TipoDoc[]) r.push(await estornarDocumento(t, p));
      return r;
    },
  },
  {
    id: 'transf', label: 'Transferências em conta corrente', codigos: '19',
    rotuloCodigo: 'Lote da transferência',
    integrar: um((p) => integrarDocumento('transf', p)), estornar: um((p) => estornarDocumento('transf', p)),
  },
  { id: 'nf', label: 'Notas fiscais', codigos: '12', nota: 'Contabilizada pela própria nota, no momento em que ela é processada ou autorizada.' },
  { id: 'caixafech', label: 'Fechamento de caixa', codigos: '17', nota: 'Contabilizado pela tela do caixa.' },
  { id: 'cheque', label: 'Baixas de cheques', codigos: '52', nota: 'Não migrada: o cliente não usa (zero lançamentos no razão).' },
  { id: 'reducaoz', label: 'Vendas — Redução Z', codigos: '18', nota: 'Não migrada: a tabela REDUCAOZ está vazia.' },
  { id: 'nfce', label: 'NFC-e', codigos: '67', nota: 'É do PDV, fora do escopo da retaguarda.' },
  { id: 'importacao', label: 'Importação', codigos: '66', nota: 'Grava no razão sem situação de documento; precisa de análise própria.' },
];

const hojeISO = () => new Date().toISOString().slice(0, 10);
const primeiroDoMes = () => `${new Date().toISOString().slice(0, 7)}-01`;

/** o resultado vem com campos diferentes por origem; a tela conta só o que veio. */
function resumir(rs: Resultado[]): string {
  const soma = (k: keyof Resultado) => rs.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const partes: string[] = [];
  const push = (n: number, um_: string, muitos: string) => { if (n > 0) partes.push(`${n} ${n === 1 ? um_ : muitos}`); };
  push(soma('lotes'), 'lote', 'lotes');
  push(soma('documentos'), 'documento', 'documentos');
  push(soma('cartoes') + soma('baixas'), 'item', 'itens');
  push(soma('lancamentos'), 'lançamento', 'lançamentos');
  push(soma('linhas'), 'linha apagada', 'linhas apagadas');
  const total = soma('total');
  if (total > 0) partes.push(`total ${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
  return partes.length ? partes.join(' · ') : 'nada a fazer no período';
}

export function IntegracaoContabilPage() {
  const mensagem = useMensagem();
  const [origem, setOrigem] = useState<string>('cartao');
  const [dataIni, setDataIni] = useState(primeiroDoMes());
  const [dataFim, setDataFim] = useState(hojeISO());
  const [codigo, setCodigo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const sel = ORIGENS.find((o) => o.id === origem) as Origem;
  const periodo = (): Periodo => {
    const c = codigo.trim() ? Number(codigo.trim()) : null;
    return { dataIni, dataFim, codigo: c, idlote: c };
  };
  const registrar = (linha: string) => setLog((l) => [`${new Date().toLocaleTimeString('pt-BR')} — ${linha}`, ...l].slice(0, 40));

  const rodar = async (acao: 'integrar' | 'estornar') => {
    const fn = sel[acao];
    if (!fn) return;
    if (acao === 'estornar' && !window.confirm(`Estornar os lançamentos de "${sel.label}" no período? As linhas do razão são apagadas e os documentos voltam a não contabilizados.`)) return;
    setOcupado(true);
    try {
      const rs = await fn(periodo());
      const resumo = resumir(rs);
      registrar(`${sel.label}: ${acao === 'integrar' ? 'integrado' : 'estornado'} — ${resumo}`);
      mensagem.sucesso(`${sel.label} — ${resumo}.`);
    } catch (e) {
      registrar(`${sel.label}: FALHOU — ${(e as { envelope?: { code?: string } })?.envelope?.code ?? 'erro'}`);
      mensagem.erro(e);
    } finally {
      setOcupado(false);
    }
  };

  /** prévia: hoje só a baixa de cartões tem uma, e ela mostra o que a rodada vai pegar. */
  const prever = async () => {
    setOcupado(true);
    try {
      const lotes = await cartaoPendentes(periodo());
      const total = lotes.reduce((s, l) => s + Number(l.total_liquido ?? 0), 0);
      registrar(`Prévia de baixas de cartões: ${lotes.length} lote(s), ${lotes.reduce((s, l) => s + l.cartoes, 0)} cartão(ões), total ${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Integração contábil" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          Informe as origens a contabilizar. Cada rodada grava as partidas no razão; o estorno apaga as do
          período e devolve os documentos para não contabilizados.
        </p>
        <div className="grid grid-cols-1 gap-gp-sm sm:grid-cols-2">
          {ORIGENS.map((o) => {
            const disponivel = !!o.integrar;
            return (
              <label key={o.id} className={`flex cursor-pointer items-start gap-gp-sm rounded-radius-md border p-pad-sm ${origem === o.id ? 'border-fg-accent bg-bg-subtle' : 'border-border'} ${disponivel ? '' : 'opacity-60'}`}>
                <input type="radio" name="origem" className="mt-1" checked={origem === o.id} disabled={!disponivel}
                  onChange={() => setOrigem(o.id)} />
                <span>
                  <span className="block text-body-md">{o.label} <span className="text-fg-muted">· origem {o.codigos}</span></span>
                  {o.nota && <span className="block text-body-sm text-fg-muted">{o.nota}</span>}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="Período &de" type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} /></div>
          <div className="w-40"><Field label="&até" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} /></div>
          {sel.rotuloCodigo && (
            <div className="w-52">
              <Field label={`${sel.rotuloCodigo} (opcional)`} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} placeholder="todo o período" />
            </div>
          )}
          <Button label="&Exportar" disabled={ocupado || !sel.integrar} onClick={() => void rodar('integrar')} />
          <Button label="E&stornar" variant="soft" disabled={ocupado || !sel.estornar} onClick={() => void rodar('estornar')} />
          {sel.id === 'cartao' && <Button label="&Prévia" variant="soft" disabled={ocupado} onClick={() => void prever()} />}
        </div>
        {!sel.integrar && <p className="mt-form-gap text-body-sm text-fg-muted">{sel.nota}</p>}
        {sel.rotuloCodigo && <p className="mt-form-gap text-body-sm text-fg-muted">Com o código preenchido a rodada ignora o período e trata só aquele registro.</p>}
      </section>

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <h2 className="mb-form-gap text-body-md">Logs da exportação</h2>
        {log.length === 0
          ? <p className="text-body-sm text-fg-muted">Nada ainda.</p>
          : <ul className="flex flex-col gap-1 font-mono text-body-sm">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      </section>
    </div>
  );
}
