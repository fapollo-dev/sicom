import { useState } from 'react';
import { Field } from '../ui/Field';
import { Button } from '../ui/Button';
import { Pesquisa } from '../cadmaster/Pesquisa';

/** os códigos de família por nível — o corpo que as variantes do relatório de vendas aceitam */
export interface Familias { departamentos?: number[]; grupos?: number[]; secoes?: number[]; subgrupos?: number[] }
type Nivel = keyof Familias;

const NIVEIS: Array<{ chave: Nivel; rotulo: string; tipo: string }> = [
  { chave: 'departamentos', rotulo: 'Departamento', tipo: 'DEPARTAMENTO' },
  { chave: 'grupos', rotulo: 'Grupo', tipo: 'GRUPO' },
  { chave: 'secoes', rotulo: 'Seção', tipo: 'SECAO' },
  { chave: 'subgrupos', rotulo: 'Subgrupo', tipo: 'SUBGRUPO' },
];

/**
 * OS FILTROS DE FAMÍLIA do relatório de vendas (FRMRELVENDAS — edtDpto/edtGrupo/edtSecao/edtSubgrupo, URelVendas.pas:2462-2492, :3152,
 * :3269, :3309): F3 (ou o "…") abre a Pesquisa da GET_FAMILIAS_PROD com o TIPO do nível em MULTISSELEÇÃO; o campo mostra o nome quando
 * é um só e "*SELECIONADOS" quando são vários (os nomes ficam na dica); qualquer outra tecla limpa a escolha. Vale para todas as
 * variantes do hub (no legado o painel é do formulário).
 */
export function FiltroFamilias({ value, onChange }: { value: Familias; onChange: (f: Familias) => void }) {
  const [nomes, setNomes] = useState<Partial<Record<Nivel, string[]>>>({});
  const [aberto, setAberto] = useState<Nivel | null>(null);
  const nivelAberto = NIVEIS.find((n) => n.chave === aberto);

  const escolher = (chave: Nivel, linhas: Array<Record<string, unknown>>) => {
    setAberto(null);
    const codigos = linhas.map((l) => Number(l.codigo)).filter((c) => Number.isInteger(c));
    setNomes((n) => ({ ...n, [chave]: linhas.map((l) => String(l.nome ?? l.descricao ?? l.codigo)) }));
    onChange({ ...value, [chave]: codigos.length ? codigos : undefined });
  };
  const limpar = (chave: Nivel) => {
    if (!value[chave]?.length) return;
    setNomes((n) => ({ ...n, [chave]: [] }));
    onChange({ ...value, [chave]: undefined });
  };

  return (
    <>
      {NIVEIS.map((n) => {
        const lista = nomes[n.chave] ?? [];
        const texto = !value[n.chave]?.length ? '' : lista.length === 1 ? lista[0] : '*SELECIONADOS';
        return (
          <div key={n.chave} className="flex items-end gap-gp-xs" title={lista.join('\n')}>
            <div className="w-40">
              <Field label={n.rotulo} value={texto} readOnly placeholder="F3 pesquisa"
                onKeyDown={(e) => {
                  if (e.key === 'F3') { e.preventDefault(); setAberto(n.chave); }
                  else if (e.key !== 'Enter' && e.key !== 'Tab' && !e.key.startsWith('Arrow')) limpar(n.chave);
                }} />
            </div>
            <Button label="…" variant="soft" onClick={() => setAberto(n.chave)} />
          </div>
        );
      })}
      {nivelAberto && (
        <Pesquisa resourcePath="lookup/familias" fixos={{ tipo: nivelAberto.tipo }} multisselecao
          onSelecionarVarios={(ls) => escolher(nivelAberto.chave, ls)} onSelecionar={(l) => escolher(nivelAberto.chave, [l])}
          onFechar={() => setAberto(null)} />
      )}
    </>
  );
}
