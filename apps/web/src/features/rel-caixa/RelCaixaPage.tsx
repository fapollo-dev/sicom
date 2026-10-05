import { useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import { hojeNaLoja } from '../../shared/tempo';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type Modelo = 'DIVERGENCIAS' | 'VOUCHER' | 'APURACAO' | 'ABERTOS' | 'PEDIDOS';
interface Resultado { modelo: Modelo; relatorio: Array<Record<string, unknown>>; auxiliar: Array<Record<string, unknown>>; resumoApuracao: Array<Record<string, unknown>>; resumoCC: Array<Record<string, unknown>> }
interface Opcoes { recursos: string[]; modelos: Record<Modelo, { indice: number; niveis: number; niveisPadrao: number }> }

/**
 * RELATÓRIOS DE CAIXA (`FRMRELCAIXA`, URelCaixa.pas). Dossiê: `uRelCaixa.md`. Os cinco modelos do combo do legado, com os filtros do
 * `MontaFiltroSQL` (operador, PDV, recurso — só nas divergências e na apuração —, lojas e período), os "níveis expandidos" do layout e,
 * na apuração, o resumo das contas correntes. "Gerar" mostra a grade (o "Exibe grade" do legado); "Imprimir" sai no layout do cliente
 * (Caixa1 … Caixa4, Relatorio_Pedidos).
 */
const MODELOS: Array<{ id: Modelo; label: string }> = [
  { id: 'DIVERGENCIAS', label: 'Divergências de caixa' },
  { id: 'VOUCHER', label: 'Voucher' },
  { id: 'APURACAO', label: 'Apuração do caixa' },
  { id: 'ABERTOS', label: 'Caixas abertos' },
  { id: 'PEDIDOS', label: 'Pedidos' },
];
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const data = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hora = (v: unknown) => (v == null ? '' : String(v).slice(11, 16));
const inicioMes = () => `${hojeNaLoja().slice(0, 7)}-01`;

const COLS: Record<Modelo, DataTableColumnDef<Record<string, unknown>>[]> = {
  DIVERGENCIAS: [
    { field: 'fantasia', headerName: 'Loja', type: 'text', width: 140, isPrimary: true },
    { field: 'nome', headerName: 'Operador', type: 'text' },
    { field: 'data', headerName: 'Dia', type: 'text', width: 110, valueGetter: (l) => data(l.data) },
    { field: 'codpdv', headerName: 'PDV', type: 'text', width: 70 },
    { field: 'tiporecurso', headerName: 'Recurso', type: 'text', width: 130 },
    { field: 'valor_cx_vendas', headerName: 'Vendas (PDV)', type: 'text', width: 140, valueGetter: (l) => moeda(l.valor_cx_vendas) },
    { field: 'valor_caixa', headerName: 'Caixa', type: 'text', width: 140, valueGetter: (l) => moeda(l.valor_caixa) },
    { field: 'divergencia', headerName: 'Divergência', type: 'text', width: 140, valueGetter: (l) => moeda(l.divergencia) },
  ],
  VOUCHER: [
    { field: 'dtvenda', headerName: 'Data', type: 'text', width: 140, isPrimary: true, valueGetter: (l) => `${data(l.dtvenda)} ${hora(l.dtvenda)}` },
    { field: 'operacao', headerName: 'Operação', type: 'text', width: 130 },
    { field: 'nome', headerName: 'Operador', type: 'text' },
    { field: 'operadora', headerName: 'Operadora', type: 'text' },
    { field: 'nomeprodutositef', headerName: 'Produto', type: 'text' },
    { field: 'valor', headerName: 'Valor', type: 'text', width: 120, valueGetter: (l) => moeda(l.valor) },
  ],
  APURACAO: [
    { field: 'fantasia', headerName: 'Loja', type: 'text', width: 140, isPrimary: true },
    { field: 'nome', headerName: 'Operador', type: 'text' },
    { field: 'codpdv', headerName: 'PDV', type: 'text', width: 70 },
    { field: 'chave', headerName: 'Chave', type: 'text', width: 140 },
    { field: 'data', headerName: 'Dia', type: 'text', width: 110, valueGetter: (l) => data(l.data) },
    { field: 'tiporecurso', headerName: 'Recurso', type: 'text', width: 130 },
    { field: 'valor_caixa', headerName: 'Caixa', type: 'text', width: 140, valueGetter: (l) => moeda(l.valor_caixa) },
    { field: 'valor_cx_vendas', headerName: 'Vendas (PDV)', type: 'text', width: 140, valueGetter: (l) => moeda(l.valor_cx_vendas) },
  ],
  ABERTOS: [
    { field: 'data', headerName: 'Dia', type: 'text', width: 110, isPrimary: true, valueGetter: (l) => data(l.data) },
    { field: 'idempresa', headerName: 'Loja', type: 'text', width: 70 },
    { field: 'nropdv', headerName: 'PDV', type: 'text', width: 70 },
    { field: 'nome', headerName: 'Operador', type: 'text' },
    { field: 'chave', headerName: 'Chave', type: 'text', width: 140 },
    { field: 'horaentrada', headerName: 'Entrada', type: 'text', width: 90, valueGetter: (l) => hora(l.horaentrada) },
    { field: 'horasaida', headerName: 'Saída', type: 'text', width: 90, valueGetter: (l) => hora(l.horasaida) },
  ],
  PEDIDOS: [
    { field: 'nropedido', headerName: 'Pedido', type: 'text', width: 160, isPrimary: true },
    { field: 'nropdv', headerName: 'PDV', type: 'text', width: 70 },
    { field: 'data', headerName: 'Data', type: 'text', width: 140, valueGetter: (l) => `${data(l.data)} ${hora(l.data)}` },
    { field: 'nome', headerName: 'Operador', type: 'text' },
    { field: 'fantasia', headerName: 'Cliente', type: 'text' },
    { field: 'valor', headerName: 'Valor', type: 'text', width: 120, valueGetter: (l) => moeda(l.valor) },
  ],
};

export function RelCaixaPage() {
  const mensagem = useMensagem();
  const [modelo, setModelo] = useState<Modelo>('DIVERGENCIAS');
  const [dataIni, setDataIni] = useState(inicioMes());
  const [dataFim, setDataFim] = useState(hojeNaLoja());
  const [empresas, setEmpresas] = useState('');
  const [codoperador, setCodoperador] = useState('');
  const [codpdv, setCodpdv] = useState('');
  const [recurso, setRecurso] = useState('');
  const [niveis, setNiveis] = useState<number>(2);
  const [resumoCC, setResumoCC] = useState(false);
  const [somenteMov, setSomenteMov] = useState(false);
  const [opcoes, setOpcoes] = useState<Opcoes | null>(null);
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/cobranca/rel-caixa/opcoes`, { headers: apiHeaders() }).then(async (r) => { handle401(r); if (r.ok) setOpcoes((await r.json()) as Opcoes); }).catch(() => undefined);
  }, []);
  // o `CmbTipoRelatorioChange`: o recurso só nas divergências e na apuração; os níveis do modelo, no padrão dele
  const comRecurso = modelo === 'DIVERGENCIAS' || modelo === 'APURACAO';
  const niveisDoModelo = opcoes?.modelos[modelo]?.niveis ?? 0;
  useEffect(() => {
    if (!comRecurso) setRecurso('');
    setNiveis(opcoes?.modelos[modelo]?.niveisPadrao ?? 0);
    if (modelo !== 'APURACAO') { setResumoCC(false); setSomenteMov(false); }
    setRes(null);
  }, [modelo, opcoes, comRecurso]);

  const consulta = () => {
    const q = new URLSearchParams({ modelo, dataIni, dataFim, niveis: String(niveis) });
    if (empresas.trim()) q.set('empresas', empresas.replace(/\s/g, ''));
    if (codoperador.trim()) q.set('codoperador', codoperador.trim());
    if (codpdv.trim()) q.set('codpdv', codpdv.trim());
    if (recurso) q.set('recurso', recurso);
    if (resumoCC) { q.set('resumoCC', '1'); if (somenteMov) q.set('somenteCCMovimentadas', '1'); }
    return q.toString();
  };

  const gerar = async () => {
    setOcupado(true);
    try {
      const r = await fetch(`${BASE}/cobranca/rel-caixa?${consulta()}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const imprimir = () => { imprimirRelatorio(`/cobranca/rel-caixa/impressao?${consulta()}`).catch((e) => mensagem.erro(e)); };

  const cols = useMemo(() => COLS[modelo], [modelo]);
  const recursos = opcoes?.recursos ?? [];

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Relatórios de caixa" />

      <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-56"><SelectField label="&Tipo de relatório" options={MODELOS.map((m) => ({ value: m.id, label: m.label }))} value={modelo} onChange={(v) => setModelo((v as Modelo) ?? 'DIVERGENCIAS')} /></div>
          <div className="w-40"><Field label="Data &inicial" type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} /></div>
          <div className="w-40"><Field label="Data &final" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} /></div>
          <div className="w-36"><Field label="&Empresas (1,2)" value={empresas} onChange={(e) => setEmpresas(e.target.value)} placeholder="esta loja" /></div>
          <div className="w-28"><Field label="&Operador" value={codoperador} onChange={(e) => setCodoperador(e.target.value.replace(/\D/g, ''))} /></div>
          <div className="w-20"><Field label="&PDV" value={codpdv} onChange={(e) => setCodpdv(e.target.value.replace(/\D/g, ''))} /></div>
          {comRecurso && (
            <div className="w-44"><SelectField label="&Recurso" options={[{ value: '', label: '' }, ...recursos.map((r) => ({ value: r, label: r }))]} value={recurso} onChange={(v) => setRecurso(v ?? '')} /></div>
          )}
          {niveisDoModelo > 0 && (
            <div className="w-36"><SelectField label="Níveis e&xpandidos" options={[{ value: '0', label: '' }, ...Array.from({ length: niveisDoModelo }, (_, i) => ({ value: String(i + 1), label: i === 0 ? '1 nível' : `${i + 1} níveis` }))]}
              value={String(niveis)} onChange={(v) => setNiveis(Number(v ?? 0))} /></div>
          )}
        </div>
        {modelo === 'APURACAO' && (
          <div className="flex flex-wrap gap-gp-md text-body-sm">
            <label className="flex items-center gap-gp-xs"><input type="checkbox" checked={resumoCC} onChange={(e) => { setResumoCC(e.target.checked); setSomenteMov(e.target.checked); }} /> Imprime resumo das contas correntes</label>
            <label className="flex items-center gap-gp-xs"><input type="checkbox" checked={somenteMov} disabled={!resumoCC} onChange={(e) => setSomenteMov(e.target.checked)} /> Somente contas movimentadas no período</label>
          </div>
        )}
        <div className="flex gap-gp-sm">
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="Im&primir" variant="soft" disabled={ocupado} onClick={imprimir} />
        </div>
      </section>

      {res && (
        <div className="flex flex-col gap-gp-md">
          <DataTable rows={res.relatorio} columns={cols} getRowId={(_l: Record<string, unknown>, i?: number) => String(i)} />
          {modelo === 'APURACAO' && res.resumoApuracao.length > 0 && (
            <section className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface p-pad-md">
              <h3 className="mb-pad-xs text-body-sm font-semibold">Resumo da apuração</h3>
              <table className="w-full text-body-sm">
                <thead><tr className="text-left text-fg-muted"><th className="p-pad-xs">Tipo</th><th className="p-pad-xs">Modalidade</th><th className="p-pad-xs text-right">Valor</th></tr></thead>
                <tbody>{res.resumoApuracao.map((l, i) => (
                  <tr key={i} className="border-t border-border"><td className="p-pad-xs">{String(l.tipo)}</td><td className="p-pad-xs">{String(l.modalidade)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(l.valor)}</td></tr>
                ))}</tbody>
              </table>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
