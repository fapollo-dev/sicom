import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef } from '@apollosg/design-system';
import { X } from 'lucide-react';
import { Button } from '../../shared/ui/Button';
import { Pesquisa } from '../../shared/cadmaster/Pesquisa';

type Item = Record<string, unknown>;

/**
 * uma aba de lista do cadastro de usuários (perfis, perfis de compra, supervisionados): a grade, o Adicionar — a Pesquisa em
 * multisseleção — e o Excluir da linha. O que já está na lista não entra de novo: o legado avisa nos perfis (`aoRepetir`) e pula
 * calado nos supervisionados (Locate, uCadUsuarios.pas:288).
 */
export function ListaPesquisada({
  itens, onChange, chave, colunas, recurso, fixos, deLinha, editavel, aoRepetir, confirmarExclusao, rotulo,
}: {
  itens: Item[];
  onChange: (itens: Item[]) => void;
  /** o campo que identifica o item (codperfil, codoperador) */
  chave: string;
  colunas: Array<{ campo: string; rotulo: string; largura?: number }>;
  recurso: string;
  fixos?: Record<string, string>;
  /** o item a partir da linha da Pesquisa */
  deLinha: (linha: Item) => Item;
  editavel: boolean;
  aoRepetir?: (repetidos: Item[]) => void;
  /** o "Deseja excluir o registro selecionado?" dos perfis (uCadUsuarios.pas:386) */
  confirmarExclusao?: boolean;
  rotulo: string;
}) {
  const [pesquisando, setPesquisando] = useState(false);

  const adicionar = (linhas: Item[]) => {
    setPesquisando(false);
    const lista = [...itens];
    const repetidos: Item[] = [];
    for (const l of linhas) {
      const item = deLinha(l);
      if (lista.some((i) => Number(i[chave]) === Number(item[chave]))) {
        // a mesma linha da Pesquisa pode vir uma vez por loja (GET_OPERADORES): só avisa o que JÁ estava antes deste lote
        if (itens.some((i) => Number(i[chave]) === Number(item[chave]))) repetidos.push(item);
        continue;
      }
      lista.push(item);
    }
    if (lista.length !== itens.length) onChange(lista);
    if (repetidos.length) aoRepetir?.(repetidos);
  };

  const cols = useMemo<DataTableColumnDef<Item>[]>(() => {
    const c: DataTableColumnDef<Item>[] = colunas.map((col, i) => ({
      field: col.campo, headerName: col.rotulo, type: 'text', width: col.largura, isPrimary: i === 1,
    }));
    if (editavel)
      c.push({
        field: 'excluir', headerName: '', type: 'actions', width: 60,
        getActions: ({ row }: { row: Item }) => [{
          id: 'excluir', label: 'Excluir', icon: <X size={16} />, destructive: true,
          onClick: () => {
            if (confirmarExclusao && !window.confirm('Deseja excluir o registro selecionado?')) return;
            onChange(itens.filter((i) => Number(i[chave]) !== Number(row[chave])));
          },
        }],
      });
    return c;
  }, [colunas, editavel, confirmarExclusao, itens, chave, onChange]);

  return (
    <div className="flex flex-col gap-form-gap" aria-label={rotulo}>
      {editavel && (
        <div className="flex justify-end">
          <Button label="Adicionar" variant="soft" onClick={() => setPesquisando(true)} />
        </div>
      )}
      <div className="overflow-x-auto">
        <DataTable rows={itens} columns={cols} getRowId={(r: Item) => String(r[chave])} />
      </div>
      {pesquisando && (
        <Pesquisa resourcePath={recurso} fixos={fixos} multisselecao
          onSelecionarVarios={adicionar} onSelecionar={(l) => adicionar([l])} onFechar={() => setPesquisando(false)} />
      )}
    </div>
  );
}
