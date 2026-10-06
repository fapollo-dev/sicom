import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { DATAS_REL_FINANCEIRO, isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { useShortcut } from '../../shared/keyboard';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';
import { hojeNaLoja } from '../../shared/tempo';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';

/**
 * RELATÓRIO FINANCEIRO (`FRMRELFINANCEIRO`).
 * Dossiê: `uRelFinanceiro.md`.
 *
 * Recebíveis e compromissos no mesmo extrato, cada linha com a baixa ao lado do título.
 *
 * ⚠️ no legado, o filtro por **data de baixa** do lado A Receber não chega a rodar (`ORA-00918`). Aqui ele
 * funciona, e usa a data da BAIXA — não a coluna abandonada do título.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => hojeNaLoja();
const diaUm = () => `${new Date().toISOString().slice(0, 7)}-01`;

interface Linha {
  tipo_doc?: string;
  lado: string; codigo: number; documento: string | null; emissao: string | null;
  vencimento: string | null; baixa: string | null; valor: number; valorpg: number | null;
  acre_desc: number; juros: number; parceiro: string; idlote: number | null;
  quitada: string; obs: string | null;
}
interface LinhaReceber {
  codigo: number; idempresa: number; emissao: string | null; venc: string | null; valor: number; codparceiro: number | null; razao: string | null;
  cnpj_cpf: string | null; nro_doc: string | null; tipo_doc: string | null; quitada: string | null; status: string | null; nropedido: string | null;
}
interface Resultado {
  linhas: Linha[];
  totais: { receber: number; pagar: number; recebido: number; pago: number; saldo: number };
}

export function RelFinanceiroPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    dataIni: diaUm(), dataFim: hoje(), recebiveis: 'S', compromissos: 'S',
    filtroData: 'VENCIMENTO', situacao: 'TODOS', parceiro: '', tipoRecebivel: 'TODOS', tipoCompromisso: 'TODOS', empresas: '',
  });
  // o cmbRelatorio do legado: 0 = Financeiro análise descritiva, 1 = Contas a receber
  const [relatorio, setRelatorio] = useState<'GERAL' | 'RECEBER'>('GERAL');
  const [res, setRes] = useState<Resultado | null>(null);
  const [receber, setReceber] = useState<LinhaReceber[] | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const params = () => {
    const q = new URLSearchParams();
    const chaves = relatorio === 'GERAL' ? Object.keys(f) : ['dataIni', 'dataFim', 'filtroData', 'situacao', 'empresas'];
    Object.entries(f).forEach(([k, v]) => { if (v !== '' && chaves.includes(k)) q.set(k, String(v)); });
    return q;
  };
  const rota = () => (relatorio === 'GERAL' ? 'relatorios/financeiro' : 'relatorios/financeiro/contas-receber');

  const buscar = async () => {
    setOcupado(true);
    try {
      const r = await fetch(`${BASE}/${rota()}?${params()}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      if (relatorio === 'GERAL') { setRes((await r.json()) as Resultado); setReceber(null); } else { setReceber((await r.json()) as LinhaReceber[]); setRes(null); }
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  // F9 = btnPesquisarClick, o "[F9] - Consulta" (FormKeyUp do UrelFinanceiro; o legado chama a consulta duas vezes na mesma tecla)
  useShortcut('f9', () => void buscar(), { when: !ocupado });

  const colsReceber = useMemo<DataTableColumnDef<LinhaReceber>[]>(() => [
    { field: 'codigo', headerName: 'Código', type: 'text', width: 90, isPrimary: true },
    { field: 'idempresa', headerName: 'Loja', type: 'text', width: 70 },
    { field: 'emissao', headerName: 'Emissão', type: 'text', width: 105, valueGetter: (l) => dataBr(l.emissao) },
    { field: 'venc', headerName: 'Vencimento', type: 'text', width: 110, valueGetter: (l) => dataBr(l.venc) },
    { field: 'valor', headerName: 'Valor', type: 'text', width: 120, valueGetter: (l) => moeda(l.valor) },
    { field: 'razao', headerName: 'Parceiro', type: 'text', width: 220 },
    { field: 'cnpj_cpf', headerName: 'CNPJ/CPF', type: 'text', width: 150 },
    { field: 'nro_doc', headerName: 'Documento', type: 'text', width: 110 },
    { field: 'tipo_doc', headerName: 'Tipo', type: 'text', width: 70 },
    { field: 'quitada', headerName: 'Quitada', type: 'text', width: 80 },
    { field: 'status', headerName: 'Status', type: 'text', width: 120 },
    { field: 'nropedido', headerName: 'Pedido', type: 'text', width: 110 },
  ], []);

  const cols = useMemo<DataTableColumnDef<Linha>[]>(() => [
    { field: 'lado', headerName: '', type: 'text', width: 60, isPrimary: true,
      valueGetter: (l: Linha) => (l.lado === 'R' ? 'Receber' : 'Pagar') },
    { field: 'tipo_doc', headerName: 'Tipo', type: 'text', width: 95,
      valueGetter: (l: Linha) => ({ TITULO: 'Título', CHEQUE: 'Cheque', CARTAO: 'Cartão', CHQ_PROPRIO: 'Cheque próprio' } as Record<string, string>)[String(l.tipo_doc ?? 'TITULO')] ?? '' },
    { field: 'codigo', headerName: 'Código', type: 'text', width: 90 },
    { field: 'documento', headerName: 'Documento', type: 'text', width: 110 },
    { field: 'parceiro', headerName: 'Parceiro', type: 'text' },
    { field: 'emissao', headerName: 'Emissão', type: 'text', width: 100, valueGetter: (l: Linha) => dataBr(l.emissao) },
    { field: 'vencimento', headerName: 'Vencimento', type: 'text', width: 105, valueGetter: (l: Linha) => dataBr(l.vencimento) },
    { field: 'baixa', headerName: 'Baixa', type: 'text', width: 100, valueGetter: (l: Linha) => dataBr(l.baixa) },
    { field: 'valor', headerName: 'Valor', type: 'text', width: 120, valueGetter: (l: Linha) => moeda(l.valor) },
    { field: 'valorpg', headerName: 'Pago/Recebido', type: 'text', width: 130, valueGetter: (l: Linha) => moeda(l.valorpg) },
    { field: 'juros', headerName: 'Juros', type: 'text', width: 100, valueGetter: (l: Linha) => moeda(l.juros) },
    { field: 'acre_desc', headerName: 'Acré./Desc.', type: 'text', width: 110, valueGetter: (l: Linha) => moeda(l.acre_desc) },
    { field: 'idlote', headerName: 'Lote', type: 'text', width: 80 },
    { field: 'obs', headerName: 'Observação', type: 'text', width: 200 },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Relatório financeiro" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          Recebíveis e compromissos no mesmo extrato, com a baixa ao lado do título.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Relatório
            <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm" value={relatorio}
              onChange={(e) => { setRelatorio(e.target.value as 'GERAL' | 'RECEBER'); setRes(null); setReceber(null); }}>
              <option value="GERAL">Financeiro análise descritiva</option><option value="RECEBER">Contas a receber</option>
            </select>
          </label>
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Filtrar a data por
            {/* o rgTipoClick: com "todos" o filtro de data fica travado em vencimento */}
            <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm" disabled={f.situacao === 'TODOS'}
              value={f.situacao === 'TODOS' ? 'VENCIMENTO' : f.filtroData} onChange={(e) => setF({ ...f, filtroData: e.target.value })}>
              {DATAS_REL_FINANCEIRO.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Situação
            <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
              value={f.situacao} onChange={(e) => setF({ ...f, situacao: e.target.value, filtroData: e.target.value === 'TODOS' ? 'VENCIMENTO' : 'EMISSAO' })}>
              <option value="TODOS">Todos</option><option value="ABERTO">Em aberto</option><option value="BAIXADO">Baixados</option>
            </select>
          </label>
          <div className="w-36"><Field label="&Empresas (1,2)" value={f.empresas} onChange={(e) => setF({ ...f, empresas: e.target.value.replace(/[^\d,]/g, '') })} placeholder="esta loja" /></div>
          {relatorio === 'GERAL' && <>
          <div className="w-56"><Field label="P&arceiro" value={f.parceiro} onChange={(e) => setF({ ...f, parceiro: e.target.value })} /></div>
          <label className="flex items-center gap-gp-xs text-body-sm">
            <input type="checkbox" checked={f.recebiveis === 'S'} onChange={(e) => setF({ ...f, recebiveis: e.target.checked ? 'S' : 'N' })} />
            Recebíveis
          </label>
          {/* o cmbRecebiveis e o cmbCompromissos do legado */}
          <select aria-label="Tipo de recebível" className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm" disabled={f.recebiveis !== 'S'}
            value={f.tipoRecebivel} onChange={(e) => setF({ ...f, tipoRecebivel: e.target.value })}>
            <option value="TODOS">Todos</option><option value="TITULOS">Títulos</option><option value="CHEQUE">Cheques</option><option value="CARTAO">Cartões</option>
          </select>
          <label className="flex items-center gap-gp-xs text-body-sm">
            <input type="checkbox" checked={f.compromissos === 'S'} onChange={(e) => setF({ ...f, compromissos: e.target.checked ? 'S' : 'N' })} />
            Compromissos
          </label>
          <select aria-label="Tipo de compromisso" className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm" disabled={f.compromissos !== 'S'}
            value={f.tipoCompromisso} onChange={(e) => setF({ ...f, tipoCompromisso: e.target.value })}>
            <option value="TODOS">Todos</option><option value="TITULOS">Títulos</option><option value="CHEQUE">Cheques próprios</option>
          </select>
          </>}
          <Button label="&Consultar" disabled={ocupado} onClick={() => void buscar()} />
          <Button label="&Imprimir" variant="soft" disabled={ocupado} onClick={() => {
            void imprimirRelatorio(`/${rota()}/impressao?${params().toString()}`).catch((e) => mensagem.erro(e));
          }} />
          {res && (
            <Button variant="outline" label="&Exportar" onClick={() => exportarGradeCsv(
              res.linhas,
              [
                { titulo: 'Tipo', valor: (l: Linha) => (l.lado === 'R' ? 'Receber' : 'Pagar') },
                { titulo: 'Código', valor: (l: Linha) => l.codigo },
                { titulo: 'Documento', valor: (l: Linha) => l.documento },
                { titulo: 'Parceiro', valor: (l: Linha) => l.parceiro },
                { titulo: 'Emissão', valor: (l: Linha) => dataBr(l.emissao) },
                { titulo: 'Vencimento', valor: (l: Linha) => dataBr(l.vencimento) },
                { titulo: 'Baixa', valor: (l: Linha) => dataBr(l.baixa) },
                { titulo: 'Valor', valor: (l: Linha) => moeda(l.valor) },
                { titulo: 'Pago/Recebido', valor: (l: Linha) => moeda(l.valorpg) },
                { titulo: 'Juros', valor: (l: Linha) => moeda(l.juros) },
                { titulo: 'Acré./Desc.', valor: (l: Linha) => moeda(l.acre_desc) },
                { titulo: 'Lote', valor: (l: Linha) => l.idlote },
                { titulo: 'Observação', valor: (l: Linha) => l.obs },
              ],
              'relatorio-financeiro',
            )} />
          )}
        </div>
      </section>

      {res && (
        <section className="flex flex-wrap gap-gp-lg rounded-radius-md border border-border bg-bg-surface p-pad-md">
          {[
            ['A receber', res.totais.receber], ['Recebido', res.totais.recebido],
            ['A pagar', res.totais.pagar], ['Pago', res.totais.pago], ['Saldo', res.totais.saldo],
          ].map(([rot, v]) => (
            <div key={String(rot)}>
              <div className="text-body-sm text-fg-muted">{rot}</div>
              <div className={`text-title-sm tabular-nums ${rot === 'Saldo' && Number(v) < 0 ? 'text-fg-danger' : ''}`}>{moeda(v)}</div>
            </div>
          ))}
          <div className="self-end text-body-sm text-fg-muted">
            {res.linhas.length} linha(s) — um título com várias baixas aparece uma vez por baixa, mas o valor
            dele entra no total uma vez só.
          </div>
        </section>
      )}

      {res && <DataTable rows={res.linhas} columns={cols} getRowId={(r: Linha) => `${r.lado}-${r.codigo}-${r.baixa ?? 'x'}-${r.valorpg ?? 0}`} />}
      {receber && <DataTable rows={receber} columns={colsReceber} getRowId={(r: LinhaReceber) => String(r.codigo)} />}
    </div>
  );
}
