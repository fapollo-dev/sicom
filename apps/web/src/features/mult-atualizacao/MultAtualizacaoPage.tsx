import { useMemo, useState } from 'react';
import { useOpcoesDoForm } from '../../shared/acesso/useOpcoesDoForm';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { CAMPOS_MULT, OPERACOES_MULT, type SimularMultDto } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { useShortcut } from '../../shared/keyboard';
import { multApi, type LinhaSimulada, type ProdutoMult } from './multAtualizacaoApi';
import { Pesquisa } from '../../shared/cadmaster/Pesquisa';
import { LookupField } from '../../shared/ui/LookupField';
import { SelectField } from '../../shared/ui/SelectField';

/**
 * ATUALIZAÇÃO AUTOMÁTICA DE PRODUTOS (`FRMMULTATUALIZACAO`).
 * Dossiê: `uMultAtualizacao.md`.
 *
 * Escolhe produtos, escolhe UM campo, escolhe uma operação, e aplica em todos. A tela mantém os três tempos
 * do legado — buscar, **simular** e gravar —, e a simulação é a mesma conta da gravação: o operador vê o
 * antes e o depois de cada produto antes de escrever em N linhas de uma vez.
 */
const moeda = (v: unknown) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function MultAtualizacaoPage() {
  const { tem: pode } = useOpcoesDoForm('FRMMULTATUALIZACAO'); // permissões de controle (docs/05-migration-engineering/permissoes-de-controle.md)
  const mensagem = useMensagem();
  // o btnBuscaProduto do legado: a Pesquisa da GET_PRODUTOS_ATUALIZACAO da loja; a grade vira os marcados
  const [pesquisando, setPesquisando] = useState(false);
  // o painel PIS/COFINS (PnlPisCofins / BtnAlterarPC): o código, o tipo e a natureza — esta só quando o CST tem alíquota de COFINS zero
  const [pc, setPc] = useState<{ idpiscofins?: number; aliqZero: boolean; tipopis: string; natureza?: number }>({ aliqZero: false, tipopis: '' });
  const [produtos, setProdutos] = useState<ProdutoMult[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [alt, setAlt] = useState<{ campo: string; operacao: string; modo: string; valor: string }>({
    campo: 'VR_VENDA', operacao: 'SOMAR', modo: 'PERCENTUAL', valor: '',
  });
  const [previa, setPrevia] = useState<{ linhas: LinhaSimulada[]; mudam: number } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const metaCampo = CAMPOS_MULT.find((c) => c.campo === alt.campo)!;
  const operacoesValidas = OPERACOES_MULT.filter((o) => o.tipo === 'ambos' || o.tipo === metaCampo.tipo);

  const trazerDaPesquisa = async (linhas: Array<Record<string, unknown>>) => {
    setPesquisando(false);
    const ids = [...new Set(linhas.map((l) => Number(l.idproduto ?? l.codigo)).filter((c) => Number.isInteger(c) && c > 0))];
    if (!ids.length) return;
    setOcupado(true);
    try {
      const r: ProdutoMult[] = [];
      for (let i = 0; i < ids.length; i += 400) r.push(...(await multApi.buscar({ ids: ids.slice(i, i + 400).join(',') })));
      setProdutos(r); setSel(new Set(r.map((p) => p.idproduto))); setPrevia(null);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  // F3 = btnBuscaProdutoClick (FormKeyDown do uMultAtualizacao; lá, fora dos campos PIS/COFINS e Natureza, que têm o F3 próprio)
  useShortcut('f3', () => setPesquisando(true), { when: !ocupado && !pesquisando });

  const corpo = (): SimularMultDto => ({
    idprodutos: [...sel], campo: alt.campo as SimularMultDto['campo'],
    operacao: alt.operacao as SimularMultDto['operacao'],
    modo: alt.modo as SimularMultDto['modo'], valor: alt.valor,
  });

  const simular = async () => {
    setOcupado(true);
    try { setPrevia(await multApi.simular(corpo())); } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const aplicar = async () => {
    setOcupado(true);
    try {
      const r = await multApi.aplicar(corpo());
      mensagem.sucesso(`${r.produtos} produto(s) atualizado(s).`);
      setPrevia(null);
      // a grade recarrega os mesmos produtos, com os valores gravados
      const ids = produtos.map((x) => x.idproduto);
      const r2: ProdutoMult[] = [];
      for (let i = 0; i < ids.length; i += 400) r2.push(...(await multApi.buscar({ ids: ids.slice(i, i + 400).join(',') })));
      setProdutos(r2);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  // BtnAlterarPCClick (uMultAtualizacao.pas:141-225): os selecionados recebem o PIS/COFINS (com a natureza ou nenhuma), o tipo e PIS = 'S'
  const alterarPisCofins = async () => {
    if (!pc.idpiscofins && !pc.tipopis && !pc.natureza) return mensagem.erro('Informe os dados para realizar a alteração.');
    if (pc.idpiscofins && pc.aliqZero && !pc.natureza) return mensagem.erro('A informação da natureza é obrigatória para este CST.');
    if (!window.confirm(`Alterar o PIS/COFINS de ${sel.size} produto(s)?`)) return;
    setOcupado(true);
    try {
      const r = await multApi.pisCofins({ idprodutos: [...sel], idpiscofins: pc.idpiscofins, tipopis: (pc.tipopis || undefined) as 'N' | 'A' | 'I' | 'S' | 'Z' | undefined,
        natureza: pc.aliqZero ? pc.natureza : undefined });
      mensagem.sucesso(`${r.produtos} produto(s) atualizado(s).`);
      setPc({ aliqZero: false, tipopis: '' });
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const alternar = (id: number) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSel(n); setPrevia(null);
  };

  const cols = useMemo<DataTableColumnDef<ProdutoMult>[]>(() => [
    {
      field: 'sel', headerName: '', type: 'text', width: 50, valueGetter: () => '',
      renderCell: ({ row }: { row: ProdutoMult }) => (
        <input type="checkbox" checked={sel.has(row.idproduto)} onChange={() => alternar(row.idproduto)} />
      ),
    },
    { field: 'codbarra', headerName: 'EAN', type: 'text', width: 130, isPrimary: true },
    { field: 'descricao', headerName: 'Descrição', type: 'text' },
    { field: 'unidade', headerName: 'Un', type: 'text', width: 60 },
    { field: 'grupo', headerName: 'Grupo', type: 'text', width: 140 },
    { field: 'subgrupo', headerName: 'Subgrupo', type: 'text', width: 140 },
    { field: 'fornecedor', headerName: 'Fornecedor', type: 'text', width: 160 },
    { field: 'vrcusto', headerName: 'Custo', type: 'text', width: 90, valueGetter: (p: ProdutoMult) => moeda(p.vrcusto) },
    { field: 'vrvenda', headerName: 'Venda', type: 'text', width: 90, valueGetter: (p: ProdutoMult) => moeda(p.vrvenda) },
    { field: 'markup', headerName: 'Markup', type: 'text', width: 90, valueGetter: (p: ProdutoMult) => moeda(p.markup) },
    { field: 'ativo', headerName: 'Ativo', type: 'text', width: 70 },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [sel]);

  const comErro = (previa?.linhas ?? []).filter((l) => l.erro);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Atualização automática de produtos" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          Escolha os produtos, escolha <strong>um campo</strong>, escolha a operação — e veja o resultado
          <strong> antes de gravar</strong>. A simulação usa exatamente a mesma conta da gravação.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <Button label="&Buscar produtos (F3)" disabled={ocupado} onClick={() => setPesquisando(true)} />
          <small className="text-fg-muted">A Pesquisa dos produtos da loja: marque os que entram na atualização e confirme.</small>
        </div>
        {pesquisando && (
          <Pesquisa resourcePath="cadastro/mult-atualizacao-produtos" multisselecao
            onSelecionarVarios={(ls) => void trazerDaPesquisa(ls)} onSelecionar={(l) => void trazerDaPesquisa([l])} onFechar={() => setPesquisando(false)} />
        )}
      </section>

      {produtos.length > 0 && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="flex flex-wrap items-end gap-gp-sm">
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Campo
              <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
                value={alt.campo}
                onChange={(e) => {
                  const novo = CAMPOS_MULT.find((c) => c.campo === e.target.value)!;
                  const ops = OPERACOES_MULT.filter((o) => o.tipo === 'ambos' || o.tipo === novo.tipo);
                  setAlt({ ...alt, campo: e.target.value, operacao: ops[0].value, modo: 'VALOR' });
                  setPrevia(null);
                }}>
                {CAMPOS_MULT.map((c) => <option key={c.campo} value={c.campo}>{c.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Operação
              <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
                value={alt.operacao} onChange={(e) => { setAlt({ ...alt, operacao: e.target.value }); setPrevia(null); }}>
                {operacoesValidas.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            {metaCampo.tipo === 'numero' && (
              <label className="flex flex-col gap-gp-xs text-body-sm">
                Modo
                <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
                  value={alt.modo} onChange={(e) => { setAlt({ ...alt, modo: e.target.value }); setPrevia(null); }}>
                  <option value="VALOR">Valor</option><option value="PERCENTUAL">Percentual</option>
                </select>
              </label>
            )}
            <div className="w-48">
              <Field label="&Valor" value={alt.valor} onChange={(e) => { setAlt({ ...alt, valor: e.target.value }); setPrevia(null); }} />
            </div>
            <Button label="&Simular" disabled={ocupado || !alt.valor || sel.size === 0} onClick={() => void simular()} />
            <Button label="&Gravar" disabled={ocupado || !previa || previa.mudam === 0 || comErro.length > 0 || !pode('BTNPROCESSAR')} onClick={() => void aplicar()} />
          </div>
          <p className="text-body-sm text-fg-muted">
            {sel.size} de {produtos.length} produto(s) selecionado(s).
            {metaCampo.onde === 'multi_preco' && ' Este campo é gravado por empresa (preço).'}
            {metaCampo.campo === 'CODSUBGRUPO' && ' Trocar o subgrupo também acerta grupo, departamento e seção.'}
          </p>
        </section>
      )}

      {produtos.length > 0 && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md" aria-label="PIS/COFINS">
          <strong className="text-sm">PIS/COFINS dos selecionados</strong>
          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-72">
              <LookupField label="Código &PIS COFINS" recurso="lookup/piscofins" campoCodigo="codigo" descricao="descricao" value={pc.idpiscofins}
                onChange={(cod, l) => setPc((x) => ({ ...x, idpiscofins: cod ? Number(cod) : undefined, aliqZero: !!cod && Number(l?.aliq_cofins_sai ?? 0) === 0, natureza: undefined }))} />
            </div>
            <div className="w-80">
              <SelectField label="Tipo" value={pc.tipopis || undefined} onChange={(v) => setPc((x) => ({ ...x, tipopis: v ?? '' }))} placeholder="(não alterar)"
                options={[{ value: 'N', label: 'Não Cumulativo (LEI 10833/2003) - Imp: 9,25%' }, { value: 'A', label: 'Cumulativo (LEI 10833/2003) - Imp: 3,65%' },
                  { value: 'I', label: 'Isento "Retido" (LEI 10147/2001)' }, { value: 'S', label: 'Suspenso (LEI 10925/2004 - ART. 9º)' },
                  { value: 'Z', label: 'Aliquota Zero (LEI 10925/2004)' }]} />
            </div>
            <div className="w-72">
              <LookupField label="&Natureza PIS/COFINS" recurso="lookup/pc-natureza" campoCodigo="idbasecreditoisento" descricao="descricao"
                fixos={pc.idpiscofins ? { idpiscofins: pc.idpiscofins } : undefined} value={pc.natureza} disabled={!pc.aliqZero}
                onChange={(cod) => setPc((x) => ({ ...x, natureza: cod ? Number(cod) : undefined }))} />
            </div>
            <Button label="&Alterar PIS/COFINS" variant="soft" disabled={ocupado || sel.size === 0 || !pode('BTNPROCESSAR')} onClick={() => void alterarPisCofins()} />
          </div>
        </section>
      )}

      {previa && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <h2 className="text-title-sm">Prévia — {previa.mudam} produto(s) mudam</h2>
          {comErro.length > 0 && (
            <div className="rounded-radius-sm border border-border bg-bg-subtle p-pad-sm text-body-sm text-fg-danger">
              <strong>{comErro.length} impedimento(s).</strong> Nada será gravado enquanto existirem:
              <ul className="ml-4 list-disc">
                {comErro.slice(0, 10).map((l) => <li key={l.idproduto}>{l.descricao}: {l.erro}</li>)}
              </ul>
            </div>
          )}
          <div className="max-h-96 overflow-auto">
            <table className="w-full border-collapse text-body-sm">
              <thead>
                <tr className="border-b border-border text-left text-fg-muted">
                  <th className="p-pad-xs">Produto</th><th className="p-pad-xs">Antes</th><th className="p-pad-xs">Depois</th>
                </tr>
              </thead>
              <tbody>
                {previa.linhas.filter((l) => l.mudou || l.erro).map((l) => (
                  <tr key={l.idproduto} className="border-b border-border">
                    <td className="p-pad-xs">{l.descricao}</td>
                    <td className="p-pad-xs text-fg-muted">{l.antes ?? '—'}</td>
                    <td className={`p-pad-xs ${l.erro ? 'text-fg-danger' : 'font-semibold'}`}>{l.erro ? l.erro : l.depois}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {produtos.length > 0 && <DataTable rows={produtos} columns={cols} getRowId={(r: ProdutoMult) => r.idproduto} />}
    </div>
  );
}
