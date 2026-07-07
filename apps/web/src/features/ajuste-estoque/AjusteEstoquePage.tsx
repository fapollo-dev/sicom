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
import { listarAjustes, ajustarEstoque, estornarAjuste } from './ajusteEstoqueApi';

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
  const [destino, setDestino] = useState<string>('LOJA');
  const [qtde, setQtde] = useState<number | undefined>(undefined);
  const [codmotivo, setCodmotivo] = useState<number | undefined>(undefined);
  const [obs, setObs] = useState('');

  const { data: produtoOptions = [] } = useResourceOptions(
    'cadastro/produtos',
    (p: any) => ({ value: String(p.idproduto ?? p.codigo), label: `${p.idproduto ?? p.codigo} - ${p.descricao ?? ''}` }),
  );
  const { data: motivoOptions = [] } = useResourceOptions(
    'cadastro/motivos-operacao',
    (m: any) => ({ value: String(m.codmotivoop ?? m.codigo), label: m.descricao ?? '' }),
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

  const ajustar = async () => {
    if (executando) return;
    if (idproduto == null) return mensagem.erro('Selecione o produto.');
    if (codmotivo == null) return mensagem.erro('Selecione o motivo.');
    if (qtde == null || qtde <= 0) return mensagem.erro('Informe a quantidade (maior que zero).');
    setExecutando(true);
    try {
      const r = await ajustarEstoque({ idproduto, operacao: operacao as any, destino: destino as any, qtde, codmotivo, obs: obs || undefined });
      mensagem.sucesso(`Ajuste aplicado: saldo ${fmtQtd(r.qtdeanterior)} → ${fmtQtd(r.qtdeatual)}.`);
      setQtde(undefined); setObs('');
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
    { field: 'dtcadastro', headerName: 'Data', type: 'text', width: 160, valueGetter: (r) => fmtDataHora(r.dtcadastro) },
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
          <div className="w-80">
            <SelectField label="&Produto" options={produtoOptions} value={idproduto != null ? String(idproduto) : undefined} onChange={(v) => setIdproduto(v ? Number(v) : undefined)} placeholder="Selecione o produto…" />
          </div>
          <div className="w-52">
            <SelectField label="&Operação" options={AJUSTE_OPERACAO_OPCOES.map((o) => ({ value: o.value, label: o.label }))} value={operacao} onChange={setOperacao} />
          </div>
          <div className="w-36">
            <NumberField label="&Quantidade" value={qtde} onChange={setQtde} decimais={3} min={0} />
          </div>
          <div className="w-44">
            <SelectField label="&Motivo" options={motivoOptions} value={codmotivo != null ? String(codmotivo) : undefined} onChange={(v) => setCodmotivo(v ? Number(v) : undefined)} placeholder="Motivo…" />
          </div>
          <div className="w-40">
            <SelectField label="&Destino" options={AJUSTE_DESTINO_OPCOES.map((o) => ({ value: o.value, label: o.label }))} value={destino} onChange={setDestino} />
          </div>
          <div className="w-72">
            <TextArea label="&Observação" value={obs} onChange={(e) => setObs(e.target.value)} rows={1} />
          </div>
          <Button label="&Aplicar ajuste" variant="soft" onClick={() => void ajustar()} />
        </div>
        <small className="mt-form-gap block text-fg-muted">O ajuste move o saldo de estoque e grava no kardex. Substituir define o saldo absoluto.</small>
      </fieldset>

      <section>
        <h2 className="mb-form-gap text-body-sm font-semibold text-fg-default">Ajustes recentes</h2>
        <DataTable columns={colunas} rows={ajustes} loading={carregando} />
      </section>
    </div>
  );
}
