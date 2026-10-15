import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { Undo2 } from 'lucide-react';
import { AJUSTE_OPERACAO_OPCOES, AJUSTE_DESTINO_OPCOES, type AjusteEstoque } from '@apollo/shared';
import { Button } from '../../shared/ui/Button';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { TextArea } from '../../shared/ui/TextArea';
import { useMensagem } from '../../shared/mensagem';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { LookupField } from '../../shared/ui/LookupField';
import { useOpcoesDoForm } from '../../shared/acesso/useOpcoesDoForm';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';
import { listarAjustes, ajustarEstoque, estornarAjuste, consultarAjustes, consultaAjusteQuery, type FiltroConsultaAjuste, saldosAjuste, type SaldosAjuste } from './ajusteEstoqueApi';
import { Field } from '../../shared/ui/Field';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';

const fmtQtd = (n: unknown) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const fmtDataHora = (s?: string) => (s ? new Date(s).toLocaleString('pt-BR') : '');

/**
 * AJUSTE DE ESTOQUE (FRMAJUSTEESTOQUE) — página vertical: escolhe produto + operação (Aumentar/Diminuir/
 * Substituir) + quantidade + motivo, e aplica o ajuste (move o saldo de estoque + grava kardex). Abaixo,
 * o histórico recente com estorno. Fiel ao legado (movimento de estoque; sem contábil).
 */
export function AjusteEstoquePage() {
  const mensagem = useMensagem();
  const [ajustes, setAjustes] = useState<AjusteEstoque[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [executando, setExecutando] = useState(false);

  const [idproduto, setIdproduto] = useState<number | undefined>(undefined);
  const [operacao, setOperacao] = useState<string>('AUMENTAR');
  const { tem: pode } = useOpcoesDoForm('FRMAJUSTEESTOQUE'); // o "Ajustar" tem Tag 1 (BTNOK)
  const [destino, setDestino] = useState<string>('E');
  const [qtde, setQtde] = useState<number | undefined>(undefined);
  const [codmotivo, setCodmotivo] = useState<number | undefined>(undefined);
  const [obs, setObs] = useState('');
  // o mínimo e o máximo da tela (vazio = mantém os atuais do saldo)
  const [minimo, setMinimo] = useState<number | undefined>(undefined);
  const [maximo, setMaximo] = useState<number | undefined>(undefined);

  const { data: motivoOptions = [] } = useResourceOptions(
    'cadastro/motivos',
    (m: any) => ({ value: String(m.codmotivo), label: m.descricao ?? '' }),
  );

  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      setAjustes(await listarAjustes());
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [mensagem]);
  useEffect(() => { void recarregar(); }, [recarregar]);

  // edtCodProdExit / AbreSegs: os saldos da loja e do depósito; o produto FILHO vira o pai ("ajuste permitido apenas no pai")
  const [saldos, setSaldos] = useState<SaldosAjuste | null>(null);
  const escolherProduto = async (cod?: string) => {
    const id = cod ? Number(cod) : undefined;
    setIdproduto(id); setSaldos(null);
    if (!id) return;
    try {
      const s = await saldosAjuste(id);
      if (s.pai) { mensagem.erro('Atenção este produto é filho, ajuste permitido apenas no pai'); setIdproduto(s.pai.idproduto); }
      setSaldos(s);
      aplicarMinMax(s, destino);
    } catch (e) { mensagem.erro(e); }
  };
  // CBdestinoExit: o mínimo e o máximo do destino abrem nos campos; com TIPO_ESTOQUE = 'L' o depósito é bloqueado
  const aplicarMinMax = (s: SaldosAjuste | null, d: string) => {
    if (!s) return;
    const b = d === 'D' ? s.deposito : s.loja;
    setMinimo(b.minimo); setMaximo(b.maximo);
  };
  const trocarDestino = (d: string) => {
    if (d === 'D' && saldos?.tipoEstoque === 'L') { mensagem.erro('Ajuste de estoque no depósito, bloqueado!'); return; }
    setDestino(d); aplicarMinMax(saldos, d);
  };

  const ajustar = async () => {
    if (executando) return;
    if (idproduto == null) return mensagem.erro('Selecione o produto.');
    if (!destino) return mensagem.erro('Obrigatório informar destino.');
    if (codmotivo == null) return mensagem.erro('Informe o motivo do ajuste!');
    if (qtde == null || qtde < 0) return mensagem.erro('Informe a quantidade.');
    setExecutando(true);
    try {
      const r = await ajustarEstoque({ idproduto, operacao: operacao as any, destino: destino as any, qtde, codmotivo, obs: obs || undefined, minimo, maximo });
      mensagem.sucesso(`Ajuste realizado com sucesso!\nEstoque atual: ${fmtQtd(r.qtdeatual)}`);
      // o legado limpa a tela e volta a operação para a última escolhida (UltimaAlteracao)
      setQtde(undefined); setObs(''); setIdproduto(undefined); setSaldos(null); setCodmotivo(undefined); setMinimo(undefined); setMaximo(undefined);
      await recarregar();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };
  const estornar = async (codajuste: number) => {
    if (executando) return;
    if (!window.confirm('Estornar este ajuste? O saldo do produto volta ao valor anterior.')) return;
    setExecutando(true);
    try {
      await estornarAjuste(codajuste);
      mensagem.sucesso('Ajuste estornado: saldo revertido.');
      await recarregar();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  const colunas: DataTableColumnDef<AjusteEstoque>[] = [
    { field: 'codajuste', headerName: 'Cód.', type: 'text', width: 80, isPrimary: true },
    { field: 'produto', headerName: 'Produto', type: 'text' },
    { field: 'operacao', headerName: 'Operação', type: 'text', width: 120 },
    { field: 'qtde', headerName: 'Qtde', type: 'number', width: 100, valueGetter: (r) => fmtQtd(r.qtde) },
    { field: 'saldo', headerName: 'Saldo', type: 'text', width: 150, valueGetter: (r) => `${fmtQtd(r.qtdeanterior)} → ${fmtQtd(r.qtdeatual)}` },
    { field: 'motivo', headerName: 'Motivo', type: 'text' },
    { field: 'data', headerName: 'Data', type: 'text', width: 160, valueGetter: (r) => fmtDataHora((r as { data?: string }).data ?? r.dtcadastro) },
    {
      field: 'acoes', headerName: '', type: 'actions', width: 120,
      getActions: ({ row: r }: { row: AjusteEstoque }) =>
        r.estornado === 'S'
          ? []
          : [{ id: 'estornar', label: 'Estornar', icon: <Undo2 size={16} />, destructive: true, onClick: (row: AjusteEstoque) => void estornar(row.codajuste) }],
    },
  ];

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Ajuste de Estoque" />
      <fieldset className="rounded-radius-md border border-border bg-bg-surface p-pad-md" disabled={executando}>
        <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">Novo ajuste</legend>
        <div className="flex flex-wrap items-end gap-gp-sm">
          {/* UajusteEstoque.pas:165 — GET_PRODUTOS sem filtro (o legado devolve o CODBARRA ao edit; aqui o campo grava o idproduto) */}
          <div className="w-96">
            <LookupField label="Produto" recurso="lookup/produtos" campoCodigo="idproduto" descricao="descricao" value={idproduto}
              onChange={(cod) => void escolherProduto(cod)} />
          </div>
          {/* os saldos do produto na loja do login (lblEstLoja/lblEstMinLoja/lblEstMaxLoja e os do depósito) */}
          {saldos && (
            <div className="flex gap-gp-md text-body-sm tabular-nums" aria-label="Saldos">
              <span><b>Loja</b> {fmtQtd(saldos.loja.qtde)} · mín {fmtQtd(saldos.loja.minimo)} · máx {fmtQtd(saldos.loja.maximo)}</span>
              <span><b>Depósito</b> {fmtQtd(saldos.deposito.qtde)} · mín {fmtQtd(saldos.deposito.minimo)} · máx {fmtQtd(saldos.deposito.maximo)}</span>
            </div>
          )}
          <div className="w-52">
            <SelectField label="Operação" options={AJUSTE_OPERACAO_OPCOES.map((o) => ({ value: o.value, label: o.label }))} value={operacao} onChange={setOperacao} />
          </div>
          <div className="w-36">
            <NumberField label="Quantidade" value={qtde} onChange={setQtde} decimais={3} min={0} />
          </div>
          <div className="w-32">
            <NumberField label="M&ínimo" value={minimo} onChange={setMinimo} decimais={3} min={0} />
          </div>
          <div className="w-32">
            <NumberField label="Má&ximo" value={maximo} onChange={setMaximo} decimais={3} min={0} />
          </div>
          <div className="w-44">
            <SelectField label="Motivo" options={motivoOptions} value={codmotivo != null ? String(codmotivo) : undefined} onChange={(v) => setCodmotivo(v ? Number(v) : undefined)} placeholder="Motivo…" />
          </div>
          <div className="w-40">
            <SelectField label="Destino" options={AJUSTE_DESTINO_OPCOES.map((o) => ({ value: o.value, label: o.label }))} value={destino} onChange={trocarDestino} />
          </div>
          <div className="w-72">
            <TextArea label="Observação" value={obs} onChange={(e) => setObs(e.target.value)} rows={1} />
          </div>
          <Button label="&Ajustar" variant="soft" disabled={!pode('BTNOK')} onClick={() => void ajustar()} />
        </div>
        <small className="mt-form-gap block text-fg-muted">O ajuste move o saldo de estoque e grava no kardex. Substituir informa o saldo final: grava-se Aumentar ou Diminuir pela diferença (igual ao saldo, só o mínimo e o máximo mudam).</small>
      </fieldset>

      <section>
        <h2 className="mb-form-gap text-body-sm font-semibold text-fg-default">Ajustes recentes</h2>
        <DataTable columns={colunas} rows={ajustes} loading={carregando} />
      </section>

      <ConsultaAjustes />
    </div>
  );
}

const fmtNum2 = (v: unknown) => (v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const diaHora = (v: unknown) => (v ? `${String(v).slice(0, 10).split('-').reverse().join('/')} ${String(v).slice(11, 19)}` : '');

/**
 * A aba "Histórico" do legado (`TbsConsulta`: Produto, Data inicial/final, Filtrar e Imprimir no AjusteEstoque.fr3 do cliente). Aberta
 * pelo "Detalhar" do kardex do produto com `?idproduto=&data=`: as duas datas no dia do movimento e o produto, já filtrada.
 */
function ConsultaAjustes() {
  const mensagem = useMensagem();
  const [f, setF] = useState<FiltroConsultaAjuste>({});
  const [linhas, setLinhas] = useState<Array<Record<string, unknown>> | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const filtrar = async (filtro: FiltroConsultaAjuste = f) => {
    setOcupado(true);
    try { setLinhas(await consultarAjustes(filtro)); } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const idproduto = Number(q.get('idproduto'));
    const data = q.get('data') ?? '';
    if (idproduto > 0 || /^\d{4}-\d{2}-\d{2}$/.test(data)) {
      const inicial: FiltroConsultaAjuste = { idproduto: idproduto > 0 ? idproduto : undefined, dtini: data || undefined, dtfim: data || undefined };
      setF(inicial);
      void filtrar(inicial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const imprimir = () => imprimirRelatorio(`/cadastro/ajuste-estoque/consulta/impressao?${consultaAjusteQuery(f)}`).catch((e) => mensagem.erro(e));

  const cols: Array<{ t: string; k: string; fmt?: (v: unknown) => string; n?: boolean }> = [
    { t: 'Data', k: 'data', fmt: diaHora }, { t: 'Produto', k: 'produto' }, { t: 'Operação', k: 'operacao' }, { t: 'Destino', k: 'destino' },
    { t: 'Quantidade', k: 'qtde', fmt: fmtNum2, n: true }, { t: 'Est. mínimo', k: 'minimo', fmt: fmtNum2, n: true }, { t: 'Est. máximo', k: 'maximo', fmt: fmtNum2, n: true },
    { t: 'Qtde anterior', k: 'qtdeanterior', fmt: fmtNum2, n: true }, { t: 'Qtde atual', k: 'qtdeatual', fmt: fmtNum2, n: true },
    { t: 'Motivo', k: 'motivo' }, { t: 'Operador', k: 'operador' }, { t: 'Cód. produto', k: 'idproduto' }, { t: 'Observação', k: 'obs' },
  ];
  return (
    <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
      <h2 className="text-body-sm font-semibold text-fg-default">Histórico</h2>
      <div className="flex flex-wrap items-end gap-gp-sm">
        {/* UajusteEstoque.pas:190 — GET_PRODUTOS → IDPRODUTO, sem filtro; vazio = todos */}
        <div className="w-96">
          <LookupField label="Produto" recurso="lookup/produtos" campoCodigo="idproduto" descricao="descricao" value={f.idproduto}
            onChange={(cod) => setF((x) => ({ ...x, idproduto: cod ? Number(cod) : undefined }))} />
        </div>
        <div className="w-40"><Field label="Data inicial" type="date" value={f.dtini ?? ''} onChange={(e) => setF({ ...f, dtini: e.target.value || undefined })} /></div>
        <div className="w-40"><Field label="Data final" type="date" value={f.dtfim ?? ''} onChange={(e) => setF({ ...f, dtfim: e.target.value || undefined })} /></div>
        <Button label={ocupado ? 'Filtrando…' : 'Filtrar'} variant="soft" disabled={ocupado} onClick={() => void filtrar()} />
        <Button label="&Imprimir" variant="ghost" disabled={ocupado} onClick={imprimir} />
        {/* BtnExportarExcelClick: a grade do Histórico como está (o legado grava AjusteEstoque.xlsx) */}
        <Button label="&Exportar" variant="ghost" disabled={ocupado || !linhas?.length}
          onClick={() => exportarGradeCsv(linhas ?? [], cols.map((c) => ({ titulo: c.t, valor: (l: Record<string, unknown>) => (c.fmt ? c.fmt(l[c.k]) : l[c.k]) })), 'AjusteEstoque')} />
      </div>
      {linhas && (linhas.length === 0 ? <small className="text-fg-muted">Nenhum ajuste foi encontrado</small> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left">{cols.map((c) => <th key={c.k} className={`p-pad-xs ${c.n ? 'text-right' : ''}`}>{c.t}</th>)}</tr></thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={i} className="border-b border-border/50">
                  {cols.map((c) => <td key={c.k} className={`p-pad-xs ${c.n ? 'text-right tabular-nums' : ''}`}>{c.fmt ? c.fmt(l[c.k]) : String(l[c.k] ?? '')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
