import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import {
  CAMPOS_CONCILIADOR, CAMPOS_OBRIGATORIOS_CONCILIADOR, SEPARACOES_CONCILIADOR,
  TIPOS_CAMPO_CONCILIADOR, TIPOS_IMPORTACAO_CONCILIADOR, type ConfigConciliadorDto,
} from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { configConciliadorApi, type ItemLayout, type LayoutResumo } from './configConciliadorApi';

/**
 * CONFIGURADOR DE CONCILIAÇÃO DE CARTÕES (`FRMCADCONFIGCONCILIADOR`).
 * Dossiê: `uCadConfigConciliador.md`.
 *
 * O layout com que se lê a planilha que cada operadora manda: onde os dados começam, que coluna é o quê, e
 * por qual chave casar a linha com a venda de cartão. As regras são as mesmas do servidor (o schema é
 * compartilhado), e a tela as mostra antes de deixar salvar.
 */
const CHAVES = [
  { k: 'buscadataempvlr', rotulo: 'Data + estabelecimento + valor' },
  { k: 'buscadatavlrcartao', rotulo: 'Data + valor + cartão' },
  { k: 'buscansu', rotulo: 'NSU' },
  { k: 'buscaautorizacao', rotulo: 'Autorização' },
] as const;

const vazio = (): ConfigConciliadorDto => ({
  cic_descricao: '', cic_tipo_importacao: 'EXCEL', cic_linha_inicio_importacao: 1,
  cic_tipo_separacao_campos: 'COLUNAS EXCEL',
  buscadataempvlr: 'N', buscadatavlrcartao: 'N', buscansu: 'N', buscaautorizacao: 'S',
  itens: CAMPOS_OBRIGATORIOS_CONCILIADOR.map((campo, i) => ({
    cici_campo_tabela: campo,
    cici_tipo_campo: campo.startsWith('DT') ? 'Data' : 'Texto',
    cici_formato_campo: campo.startsWith('DT') ? 'dd/MM/yyyy' : null,
    cici_posicao: String.fromCharCode(65 + i),
    cici_tamanho: null, cici_casas_decimais: null, cici_valor_fixo: null,
  })),
});

type ItemForm = ItemLayout;

export function ConfigConciliadorPage() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<LayoutResumo[]>([]);
  const [editando, setEditando] = useState<number | null>(null);
  const [form, setForm] = useState<ConfigConciliadorDto | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try { setLista(await configConciliadorApi.listar()); } catch (e) { mensagem.erro(e); }
  }, [mensagem]);

  useEffect(() => { void carregar(); }, [carregar]);

  const abrir = async (id: number | null) => {
    if (id == null) { setEditando(null); setForm(vazio()); return; }
    try {
      const d = await configConciliadorApi.obter(id);
      setEditando(id);
      setForm({
        cic_descricao: d.cic_descricao,
        cic_tipo_importacao: d.cic_tipo_importacao as ConfigConciliadorDto['cic_tipo_importacao'],
        cic_linha_inicio_importacao: Number(d.cic_linha_inicio_importacao),
        cic_tipo_separacao_campos: d.cic_tipo_separacao_campos as ConfigConciliadorDto['cic_tipo_separacao_campos'],
        buscadataempvlr: d.buscadataempvlr as 'S' | 'N', buscadatavlrcartao: d.buscadatavlrcartao as 'S' | 'N',
        buscansu: d.buscansu as 'S' | 'N', buscaautorizacao: d.buscaautorizacao as 'S' | 'N',
        itens: d.itens as ConfigConciliadorDto['itens'],
      });
    } catch (e) { mensagem.erro(e); }
  };

  const salvar = async () => {
    if (!form) return;
    setOcupado(true);
    try {
      if (editando == null) await configConciliadorApi.criar(form);
      else await configConciliadorApi.atualizar(editando, form);
      mensagem.sucesso(editando == null ? 'Layout criado.' : 'Layout atualizado.');
      setForm(null); setEditando(null);
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const excluir = async (id: number) => {
    setOcupado(true);
    try {
      await configConciliadorApi.excluir(id);
      mensagem.sucesso('Layout excluído.');
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const mudarItem = (idx: number, patch: Partial<ItemForm>) => {
    if (!form) return;
    const itens = form.itens.map((it, i) => {
      if (i !== idx) return it;
      const novo = { ...it, ...patch } as ItemForm;
      // as mesmas regras do servidor, aplicadas enquanto o operador digita
      if (novo.cici_tipo_campo === 'Fixo') { novo.cici_posicao = null; novo.cici_formato_campo = null; }
      else { novo.cici_valor_fixo = null; }
      if (novo.cici_tipo_campo === 'Data') novo.cici_formato_campo = novo.cici_formato_campo || 'dd/MM/yyyy';
      else if (novo.cici_tipo_campo !== 'Fixo') novo.cici_formato_campo = null;
      return novo;
    });
    setForm({ ...form, itens: itens as ConfigConciliadorDto['itens'] });
  };

  const semChave = !!form && !CHAVES.some((c) => form[c.k] === 'S');
  const faltando = useMemo(() => {
    if (!form) return [] as string[];
    const tem = form.itens.map((i) => i.cici_campo_tabela);
    return CAMPOS_OBRIGATORIOS_CONCILIADOR.filter((c) => !tem.includes(c));
  }, [form]);

  const cols = useMemo<DataTableColumnDef<LayoutResumo>[]>(() => [
    { field: 'cic_descricao', headerName: 'Layout', type: 'text', isPrimary: true },
    { field: 'cic_tipo_importacao', headerName: 'Arquivo', type: 'text', width: 100 },
    { field: 'cic_linha_inicio_importacao', headerName: 'Linha inicial', type: 'text', width: 110 },
    { field: 'itens', headerName: 'Colunas', type: 'text', width: 90 },
    {
      field: 'chaves', headerName: 'Casa por', type: 'text', valueGetter: (l: LayoutResumo) =>
        CHAVES.filter((c) => (l as unknown as Record<string, string>)[c.k] === 'S').map((c) => c.rotulo).join(' · ') || '—',
    },
    {
      field: 'acoes', headerName: '', type: 'text', width: 150, valueGetter: () => '',
      renderCell: ({ row }: { row: LayoutResumo }) => (
        <span className="flex gap-gp-xs">
          <Button variant="outline" label="Editar" onClick={() => void abrir(row.cic_id)} />
          <Button variant="outline" label="Excluir" disabled={ocupado} onClick={() => void excluir(row.cic_id)} />
        </span>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [ocupado]);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Configurador de conciliação de cartões" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          Cada operadora manda a planilha do seu jeito. O layout diz <strong>em que linha os dados começam</strong>,
          <strong> que coluna é o quê</strong> e <strong>por qual chave casar</strong> a linha com a venda de cartão.
        </p>
        <Button label="&Novo layout" onClick={() => void abrir(null)} />
      </section>

      <DataTable rows={lista} columns={cols} getRowId={(r: LayoutResumo) => r.cic_id} />

      {form && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <h2 className="text-title-sm">{editando == null ? 'Novo layout' : `Layout ${form.cic_descricao}`}</h2>

          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-64">
              <Field label="&Descrição" value={form.cic_descricao}
                onChange={(e) => setForm({ ...form, cic_descricao: e.target.value })} />
            </div>
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Tipo de arquivo
              <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
                value={form.cic_tipo_importacao}
                onChange={(e) => setForm({ ...form, cic_tipo_importacao: e.target.value as ConfigConciliadorDto['cic_tipo_importacao'] })}>
                {TIPOS_IMPORTACAO_CONCILIADOR.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Separação
              <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
                value={form.cic_tipo_separacao_campos}
                onChange={(e) => setForm({ ...form, cic_tipo_separacao_campos: e.target.value as ConfigConciliadorDto['cic_tipo_separacao_campos'] })}>
                {SEPARACOES_CONCILIADOR.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <div className="w-32">
              <Field label="&Linha inicial" type="number" value={String(form.cic_linha_inicio_importacao)}
                onChange={(e) => setForm({ ...form, cic_linha_inicio_importacao: Number(e.target.value || 1) })} />
            </div>
          </div>

          <fieldset className="flex flex-wrap gap-gp-md rounded-radius-sm border border-border p-pad-sm">
            <legend className="px-pad-xs text-body-sm text-fg-muted">Casar a linha com a venda por</legend>
            {CHAVES.map((c) => (
              <label key={c.k} className="flex items-center gap-gp-xs text-body-sm">
                <input type="checkbox" checked={form[c.k] === 'S'}
                  onChange={(e) => setForm({ ...form, [c.k]: e.target.checked ? 'S' : 'N' })} />
                {c.rotulo}
              </label>
            ))}
            {semChave && <span className="text-body-sm text-fg-danger">Escolha ao menos uma: sem chave, nada concilia.</span>}
          </fieldset>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-body-sm">
              <thead>
                <tr className="border-b border-border text-left text-fg-muted">
                  <th className="p-pad-xs">Campo</th><th className="p-pad-xs">Tipo</th>
                  <th className="p-pad-xs">Coluna</th><th className="p-pad-xs">Formato</th>
                  <th className="p-pad-xs">Tamanho</th><th className="p-pad-xs">Valor fixo</th><th />
                </tr>
              </thead>
              <tbody>
                {form.itens.map((it, idx) => (
                  <tr key={`${it.cici_campo_tabela}-${idx}`} className="border-b border-border">
                    <td className="p-pad-xs">
                      <select className="h-8 w-full rounded-radius-sm border border-border bg-bg-base px-pad-xs"
                        value={it.cici_campo_tabela}
                        onChange={(e) => mudarItem(idx, { cici_campo_tabela: e.target.value })}>
                        {CAMPOS_CONCILIADOR.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="p-pad-xs">
                      <select className="h-8 rounded-radius-sm border border-border bg-bg-base px-pad-xs"
                        value={it.cici_tipo_campo}
                        onChange={(e) => mudarItem(idx, { cici_tipo_campo: e.target.value })}>
                        {TIPOS_CAMPO_CONCILIADOR.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="p-pad-xs">
                      <input className="h-8 w-16 rounded-radius-sm border border-border bg-bg-base px-pad-xs uppercase"
                        disabled={it.cici_tipo_campo === 'Fixo'} value={it.cici_posicao ?? ''}
                        onChange={(e) => mudarItem(idx, { cici_posicao: e.target.value.toUpperCase() || null })} />
                    </td>
                    <td className="p-pad-xs">
                      <input className="h-8 w-28 rounded-radius-sm border border-border bg-bg-base px-pad-xs"
                        disabled={it.cici_tipo_campo !== 'Data'} value={it.cici_formato_campo ?? ''}
                        onChange={(e) => mudarItem(idx, { cici_formato_campo: e.target.value || null })} />
                    </td>
                    <td className="p-pad-xs">
                      <input className="h-8 w-20 rounded-radius-sm border border-border bg-bg-base px-pad-xs" type="number"
                        value={it.cici_tamanho ?? ''}
                        onChange={(e) => mudarItem(idx, { cici_tamanho: e.target.value ? Number(e.target.value) : null })} />
                    </td>
                    <td className="p-pad-xs">
                      <input className="h-8 w-full rounded-radius-sm border border-border bg-bg-base px-pad-xs"
                        disabled={it.cici_tipo_campo !== 'Fixo'} value={it.cici_valor_fixo ?? ''}
                        onChange={(e) => mudarItem(idx, { cici_valor_fixo: e.target.value || null })} />
                    </td>
                    <td className="p-pad-xs">
                      <Button variant="outline" label="Remover"
                        onClick={() => setForm({ ...form, itens: form.itens.filter((_, i) => i !== idx) as ConfigConciliadorDto['itens'] })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {faltando.length > 0 && (
            <p className="text-body-sm text-fg-danger">
              Faltam campos que todo layout precisa ter: <strong>{faltando.join(', ')}</strong>.
            </p>
          )}

          <div className="flex gap-gp-sm">
            <Button variant="outline" label="&Adicionar coluna" onClick={() => setForm({
              ...form,
              itens: [...form.itens, {
                cici_campo_tabela: 'NSU', cici_tipo_campo: 'Texto', cici_formato_campo: null,
                cici_posicao: 'A', cici_tamanho: null, cici_casas_decimais: null, cici_valor_fixo: null,
              }] as ConfigConciliadorDto['itens'],
            })} />
            <Button label="&Salvar" disabled={ocupado || semChave || faltando.length > 0} onClick={() => void salvar()} />
            <Button variant="outline" label="&Cancelar" onClick={() => { setForm(null); setEditando(null); }} />
          </div>
        </section>
      )}
    </div>
  );
}
