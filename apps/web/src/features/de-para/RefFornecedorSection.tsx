import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef } from '@apollosg/design-system';
import { X } from 'lucide-react';
import type { DePara } from '@apollo/shared';
import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { useMensagem } from '../../shared/mensagem';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { listarDePara, criarDePara, removerDePara } from './deParaApi';

/** TIPOREF (descritivo): 'E' EAN / 'P' código do produto. */
const TIPOREF_OPCOES = [
  { value: 'E', label: 'EAN (código de barras)' },
  { value: 'P', label: 'Código do produto' },
];

/**
 * Aba "Ref. Fornecedor" / "Cód. ref. fornecedor" (CODREFERENCIA_FOR / DE-PARA) — a MESMA tabela vista de dois lados:
 *  - em PRODUTO (idproduto fixo): grid de fornecedores→código; o adder escolhe o FORNECEDOR.
 *  - em PARCEIROS/fornecedor (codfor fixo): grid de produtos→código; o adder escolhe o PRODUTO.
 * Escrita pelo CRUD canônico `compras/de-para` (único writer). Só disponível com o registro JÁ gravado (precisa do id).
 */
export function RefFornecedorSection({ codfor, idproduto, editavel }: { codfor?: number; idproduto?: number; editavel: boolean }) {
  const mensagem = useMensagem();
  const modoProduto = idproduto != null; // true: tela Produto (escolhe fornecedor); false: tela Fornecedor (escolhe produto)
  const idFixo = modoProduto ? idproduto : codfor;

  const [lista, setLista] = useState<DePara[]>([]);
  const [carregando, setCarregando] = useState(false);
  // os endpoints de-para exigem RBAC FRMCADPRODUTO; num operador sem esse acesso o GET dá 403 — tratamos como
  // "somente-informativo" (grid vazio + nota, sem adder) em vez de estourar um modal de erro a cada abertura.
  const [bloqueado, setBloqueado] = useState(false);
  const [alvo, setAlvo] = useState<number | undefined>(undefined); // produto (modoProduto=false) OU fornecedor (modoProduto=true)
  const [codref, setCodref] = useState('');
  const [tiporef, setTiporef] = useState<string>('E');

  const { data: produtoOptions = [] } = useResourceOptions(
    'cadastro/produtos',
    (p: any) => ({ value: String(p.idproduto ?? p.codigo), label: `${p.idproduto ?? p.codigo} - ${p.descricao ?? ''}` }),
    { campo: 'ativo', operador: 'igual', valor: 'S' },
  );
  const { data: fornecedorOptions = [] } = useResourceOptions(
    'cadastro/parceiros',
    (p: any) => ({ value: String(p.codparceiro), label: `${p.codparceiro} - ${p.razao ?? p.fantasia ?? ''}` }),
    { campo: 'frn', operador: 'igual', valor: 'S' },
  );
  const rotuloProduto = useCallback(
    (id: unknown) => produtoOptions.find((o) => String(o.value) === String(id))?.label ?? String(id ?? ''),
    [produtoOptions],
  );

  const recarregar = useCallback(async () => {
    if (idFixo == null) { setLista([]); return; }
    setCarregando(true);
    try {
      setLista(await listarDePara(modoProduto ? { idproduto: idFixo } : { codfor: idFixo }));
      setBloqueado(false);
    } catch (e) {
      // 403 (sem grant FRMCADPRODUTO) → modo somente-informativo, sem modal a cada abertura; demais erros sobem.
      if ((e as { status?: number })?.status === 403) { setBloqueado(true); setLista([]); } else mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [idFixo, modoProduto, mensagem]);
  useEffect(() => void recarregar(), [recarregar]);

  const adicionar = async () => {
    if (alvo == null) return mensagem.erro(modoProduto ? 'Selecione o fornecedor.' : 'Selecione o produto.');
    if (!codref.trim()) return mensagem.erro('Informe o código do fornecedor.');
    try {
      await criarDePara({
        idproduto: modoProduto ? idproduto! : alvo,
        codfor: modoProduto ? alvo : codfor!,
        codref: codref.trim(),
        tiporef: tiporef === 'P' ? 'P' : 'E',
      });
      mensagem.sucesso('Referência adicionada.');
      setAlvo(undefined); setCodref(''); setTiporef('E');
      await recarregar();
    } catch (e) {
      mensagem.erro(e);
    }
  };

  const remover = async (id?: number) => {
    if (id == null) return;
    try { await removerDePara(id); mensagem.sucesso('Referência removida.'); await recarregar(); } catch (e) { mensagem.erro(e); }
  };

  const colunas = useMemo<DataTableColumnDef<DePara>[]>(() => {
    const cols: DataTableColumnDef<DePara>[] = modoProduto
      ? [{ field: 'razao', headerName: 'Fornecedor', type: 'text', isPrimary: true, valueGetter: (r) => `${r.codfor} - ${r.razao ?? ''}` }]
      : [{ field: 'idproduto', headerName: 'Produto', type: 'text', isPrimary: true, valueGetter: (r) => rotuloProduto(r.idproduto) }];
    cols.push(
      { field: 'codref', headerName: 'Cód. do fornecedor', type: 'text', width: 200 },
      { field: 'tiporef', headerName: 'Tipo', type: 'text', width: 110, valueGetter: (r) => (String(r.tiporef) === 'P' ? 'Código' : 'EAN') },
    );
    if (editavel)
      cols.push({
        field: 'rem', headerName: '', type: 'actions', width: 60,
        getActions: ({ row: r }: { row: DePara }) => [
          { id: 'rem', label: 'Remover', icon: <X size={16} />, destructive: true, onClick: () => void remover(r.codreferencia_for) },
        ],
      });
    return cols;
  }, [modoProduto, editavel, rotuloProduto]);

  if (idFixo == null)
    return <p className="text-body-sm text-fg-muted">Grave o registro primeiro para vincular as referências de fornecedor.</p>;

  return (
    <div className="flex flex-col gap-form-gap">
      {bloqueado && <p className="text-body-sm text-fg-muted">Você não tem acesso às referências de fornecedor (permissão de Produto).</p>}
      {editavel && !bloqueado && (
        <div className="grid grid-cols-1 items-end gap-form-gap sm:grid-cols-6">
          <div className="sm:col-span-2">
            {modoProduto ? (
              <SelectField label="&Fornecedor" options={fornecedorOptions} value={alvo != null ? String(alvo) : undefined} onChange={(v) => setAlvo(v ? Number(v) : undefined)} placeholder="Selecione…" />
            ) : (
              <SelectField label="&Produto" options={produtoOptions} value={alvo != null ? String(alvo) : undefined} onChange={(v) => setAlvo(v ? Number(v) : undefined)} placeholder="Selecione…" />
            )}
          </div>
          <div className="sm:col-span-2"><Field label="&Cód. do fornecedor" value={codref} maxLength={60} onChange={(e) => setCodref(e.target.value)} /></div>
          <div className="sm:col-span-1"><SelectField label="&Tipo" options={TIPOREF_OPCOES} value={tiporef} onChange={(v) => setTiporef(v || 'E')} /></div>
          <div className="flex items-end justify-end sm:col-span-1"><Button label="&Adicionar" variant="soft" onClick={() => void adicionar()} /></div>
        </div>
      )}
      <div className="overflow-x-auto"><DataTable rows={lista} columns={colunas} loading={carregando} getRowId={(r) => String(r.codreferencia_for)} /></div>
    </div>
  );
}
