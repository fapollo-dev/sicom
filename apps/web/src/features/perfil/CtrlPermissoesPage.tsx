import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader, Modal } from '@apollosg/design-system';
import { Button } from '../../shared/ui/Button';
import { SelectField } from '../../shared/ui/SelectField';
import { useMensagem } from '../../shared/mensagem';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import {
  catalogoPermissoes, grantsDoOperador, setGrantOperador, setLotePermissoes, clonarPermissoes,
  auditoriaDoOperador, type AuditoriaPermissao,
} from './perfilApi';

/**
 * CONTROLE DE PERMISSÕES (`FRMCTRLPERMISSOES`) — a tela do administrador, por **OPERADOR**.
 *
 * É o modo que o cliente usa: a config `CONTROLE_PERMISSOES` vale `'Usuario'` em produção, com 55.251 linhas
 * por operador contra 2.438 por perfil (que nesse modo o legado nem consulta). A tela de *Perfis & Permissões*
 * continua existindo para o caminho por perfil; esta é a que resolve acesso no dia a dia.
 *
 * O que veio do legado, e de onde (dossiê `uCtrlPermissoes.md`):
 *  · a permissão é por **(tela, opção, operador, EMPRESA)** — daí o seletor de empresa (`cbbEmpresaChange`);
 *  · **marcar/desmarcar todos**, por tela e no geral (`btnMarcarTodosOpcoesClick` · `btnMarcarTodosFormClick`);
 *  · **clonar** de um operador para outro, inclusive entre empresas (`btnCopiarParaClick` →
 *    `SP_REPLICA_PERMISSAO`) — e é **destrutivo**: o destino é apagado antes, por isso a confirmação.
 */
const chave = (form: string, opcao: string) => `${form} ${opcao}`;

type Acao = { form: string; opcao: string; caption?: string | null; form_caption?: string | null };

export function CtrlPermissoesPage() {
  const mensagem = useMensagem();
  const [catalogo, setCatalogo] = useState<Acao[]>([]);
  const [operador, setOperador] = useState<number | undefined>();
  const [empresa, setEmpresa] = useState<number | undefined>();
  const [concedidos, setConcedidos] = useState<Set<string>>(new Set());
  const [filtroForm, setFiltroForm] = useState<string>('');
  const [trilha, setTrilha] = useState<AuditoriaPermissao[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [clonando, setClonando] = useState(false);
  const [clone, setClone] = useState<{ de?: number; de_empresa?: number; para?: number; para_empresa?: number }>({});

  const { data: operadorOptions = [] } = useResourceOptions('cadastro/operadores', (o: any) => ({
    value: String(o.codoperador), label: `${o.codoperador} - ${o.nome ?? o.login}`,
  }));
  const { data: empresaOptions = [] } = useResourceOptions('cadastro/empresas', (e: any) => ({
    value: String(e.idempresa ?? e.codempresa), label: `${e.idempresa ?? e.codempresa} - ${e.razao_social ?? e.fantasia ?? ''}`,
  }));

  useEffect(() => void catalogoPermissoes().then(setCatalogo).catch(() => setCatalogo([])), []);

  const recarregar = useCallback(async (cod: number, emp?: number) => {
    try {
      const g = await grantsDoOperador(cod, emp);
      setConcedidos(new Set(g.grants.map((x) => chave(x.form, x.opcao))));
      void auditoriaDoOperador(cod).then(setTrilha).catch(() => setTrilha([]));
    } catch (e) {
      mensagem.erro(e);
    }
  }, [mensagem]);

  useEffect(() => { if (operador != null) void recarregar(operador, empresa); }, [operador, empresa, recarregar]);

  const toggle = async (a: Acao) => {
    if (operador == null) { mensagem.erro('Selecione o operador.'); return; }
    const k = chave(a.form, a.opcao);
    const concedido = !concedidos.has(k);
    setConcedidos((s) => { const n = new Set(s); if (concedido) n.add(k); else n.delete(k); return n; }); // otimista
    try {
      await setGrantOperador({ codoperador: operador, form: a.form, opcao: a.opcao, concedido, codempresa: empresa });
      void recarregar(operador, empresa);
    } catch (e) {
      mensagem.erro(e);
      void recarregar(operador, empresa); // volta ao estado do servidor
    }
  };

  const lote = async (concedido: boolean, form?: string) => {
    if (operador == null) { mensagem.erro('Selecione o operador.'); return; }
    if (!form && concedido && !window.confirm('Conceder TODAS as ações do catálogo a este operador?')) return;
    setOcupado(true);
    try {
      const r = await setLotePermissoes({ codoperador: operador, form, concedido, codempresa: empresa });
      // o legado não concede as telas de INDÚSTRIA a empresa que não é industrial (uCtrlPermissoes.pas:478)
      mensagem.sucesso(`${r.alterados} alteração(ões).${r.ignorados_industria ? ` ${r.ignorados_industria} tela(s) de indústria fora (a empresa não é industrial).` : ''}`);
      await recarregar(operador, empresa);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setOcupado(false);
    }
  };

  const confirmarClone = async () => {
    const { de, de_empresa, para, para_empresa } = clone;
    if (de == null || para == null || de_empresa == null || para_empresa == null) { mensagem.erro('Informe origem, destino e as empresas.'); return; }
    if (!window.confirm('As permissões atuais do operador de DESTINO serão APAGADAS e substituídas pelas da origem. Confirma?')) return;
    setOcupado(true);
    try {
      const r = await clonarPermissoes({ tipo: 'USUARIO', de, de_empresa, para, para_empresa });
      mensagem.sucesso(`${r.copiados} permissão(ões) copiada(s); ${r.apagados} do destino foram apagadas.`);
      setClonando(false);
      if (operador === para) await recarregar(operador, empresa);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setOcupado(false);
    }
  };

  const forms = useMemo(() => Array.from(new Set(catalogo.map((c) => c.form))).sort(), [catalogo]);
  const linhas = useMemo(() => (filtroForm ? catalogo.filter((c) => c.form === filtroForm) : catalogo), [catalogo, filtroForm]);

  const cols = useMemo<DataTableColumnDef<Acao>[]>(() => [
    { field: 'form', headerName: 'Tela', type: 'text', isPrimary: true, valueGetter: (r) => (r.form_caption ? `${r.form_caption}` : r.form) },
    { field: 'opcao', headerName: 'Ação', type: 'text', width: 240, valueGetter: (r) => r.caption || r.opcao },
    { field: 'tecnico', headerName: 'Identificador', type: 'text', width: 260, valueGetter: (r) => `${r.form} · ${r.opcao}` },
    {
      field: 'concedido', headerName: 'Concedido', type: 'text', width: 120,
      valueGetter: (r) => (concedidos.has(chave(r.form, r.opcao)) ? '✓ Sim' : '—'),
    },
    {
      field: 'acoes', headerName: '', type: 'actions', width: 130,
      getActions: ({ row: r }: { row: Acao }) => [
        { id: 't', label: concedidos.has(chave(r.form, r.opcao)) ? 'Revogar' : 'Conceder', onClick: () => void toggle(r) },
      ],
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [concedidos, operador, empresa]);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Controle de permissões" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
          <SelectField label="&Operador" options={operadorOptions} value={operador != null ? String(operador) : undefined}
            onChange={(v) => setOperador(v ? Number(v) : undefined)} placeholder="Selecione o operador…" />
          <SelectField label="&Empresa" options={empresaOptions} value={empresa != null ? String(empresa) : undefined}
            onChange={(v) => setEmpresa(v ? Number(v) : undefined)} placeholder="Empresa da sessão" />
          <SelectField label="&Tela" options={[{ value: '', label: 'Todas as telas' }, ...forms.map((f) => ({ value: f, label: f }))]}
            value={filtroForm} onChange={(v) => setFiltroForm(v ?? '')} />
        </div>
        <div className="mt-form-gap flex flex-wrap gap-gp-sm">
          <Button label={filtroForm ? 'Marcar tudo desta tela' : 'Marcar &tudo'} variant="soft" disabled={ocupado || operador == null} onClick={() => void lote(true, filtroForm || undefined)} />
          <Button label={filtroForm ? 'Desmarcar tudo desta tela' : '&Desmarcar tudo'} variant="soft" disabled={ocupado || operador == null} onClick={() => void lote(false, filtroForm || undefined)} />
          <Button label="&Copiar de outro operador…" variant="soft" disabled={ocupado} onClick={() => { setClone({ para: operador, de_empresa: empresa, para_empresa: empresa }); setClonando(true); }} />
        </div>
        {operador == null && <p className="mt-form-gap text-body-sm text-fg-muted">Selecione um operador para ver e editar as permissões. Sem permissão registrada, a ação é negada — é assim no legado também.</p>}
      </section>

      {operador != null && (
        <>
          <DataTable rows={linhas} columns={cols} getRowId={(r) => chave(r.form, r.opcao)} />
          <p className="text-body-sm text-fg-muted">
            {concedidos.size} ação(ões) concedida(s) de {catalogo.length} no catálogo.
          </p>
        </>
      )}

      {trilha.length > 0 && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <h4 className="mb-form-gap text-body-sm font-semibold text-fg-default">Últimas mudanças</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-fg-muted"><th className="py-1 pr-3 font-medium">Quando</th><th className="py-1 pr-3 font-medium">Ação</th><th className="py-1 pr-3 font-medium">Tela / Opção</th><th className="py-1 font-medium">Por</th></tr></thead>
              <tbody>
                {trilha.slice(0, 20).map((a) => (
                  <tr key={a.codaudit} className="border-t border-border">
                    <td className="py-1 pr-3 whitespace-nowrap">{a.data}</td>
                    <td className="py-1 pr-3">{a.tipo === 'INSERT' ? 'Concedido' : 'Revogado'}</td>
                    <td className="py-1 pr-3">{a.form} · {a.opcao}</td>
                    <td className="py-1">{a.ator_nome ?? (a.codoperador_acao != null ? `#${a.codoperador_acao}` : '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {clonando && (
        <Modal open onClose={() => setClonando(false)} size="md" title="Copiar permissões de outro operador"
          primaryAction={{ label: 'Copiar', onClick: () => void confirmarClone() }}
          secondaryAction={{ label: 'Cancelar', onClick: () => setClonando(false) }}>
          <div className="flex flex-col gap-form-gap">
            <p className="text-body-sm text-fg-danger">
              Atenção: as permissões atuais do operador de destino são <strong>apagadas</strong> e substituídas
              pelas da origem. É cópia, não soma — mesmo comportamento do sistema antigo.
            </p>
            <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
              <SelectField label="Copiar &de" options={operadorOptions} value={clone.de != null ? String(clone.de) : undefined}
                onChange={(v) => setClone((c) => ({ ...c, de: v ? Number(v) : undefined }))} placeholder="Operador de origem…" />
              <SelectField label="Empresa de origem" options={empresaOptions} value={clone.de_empresa != null ? String(clone.de_empresa) : undefined}
                onChange={(v) => setClone((c) => ({ ...c, de_empresa: v ? Number(v) : undefined }))} />
              <SelectField label="&Para" options={operadorOptions} value={clone.para != null ? String(clone.para) : undefined}
                onChange={(v) => setClone((c) => ({ ...c, para: v ? Number(v) : undefined }))} placeholder="Operador de destino…" />
              <SelectField label="Empresa de destino" options={empresaOptions} value={clone.para_empresa != null ? String(clone.para_empresa) : undefined}
                onChange={(v) => setClone((c) => ({ ...c, para_empresa: v ? Number(v) : undefined }))} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
