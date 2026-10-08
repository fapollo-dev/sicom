import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RegistrosLogModal } from '../../shared/log/RegistrosLogModal';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { Modal } from '../../shared/ui/Modal';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { Button } from '../../shared/ui/Button';
import { SelectField } from '../../shared/ui/SelectField';
import { useMensagem } from '../../shared/mensagem';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { LookupField } from '../../shared/ui/LookupField';
import { Tabs } from '../../shared/ui/Tabs';
import {
  catalogoPermissoes, grantsDoOperador, setGrantOperador, setLotePermissoes, clonarPermissoes,
  auditoriaDoOperador, grantsDoPerfil, setGrantPerfil, auditoriaPermissoes, type AuditoriaPermissao,
} from './perfilApi';

/**
 * CONTROLE DE PERMISSÕES (`FRMCTRLPERMISSOES`) — a tela do administrador, por **USUÁRIO** ou por **PERFIL** (as abas cxTbsUsuario e
 * cxTbsPerfil do legado). O modo da produção é AMBOS (operador ∪ perfis): 55.251 linhas por operador e 2.346 por perfil.
 *
 * O que veio do legado, e de onde (dossiê `uCtrlPermissoes.md`):
 *  · a permissão é por **(tela, opção, operador OU perfil, EMPRESA)** — daí o seletor de empresa (`cbbEmpresaChange`);
 *  · **marcar/desmarcar todos**, por tela e no geral (`btnMarcarTodosOpcoesClick` · `btnMarcarTodosFormClick`);
 *  · **clonar** para o usuário/perfil da aba, inclusive entre empresas (`btnCopiarParaClick` → `SP_REPLICA_PERMISSAO`) — e é
 *    **destrutivo**: o destino é apagado antes, por isso a confirmação;
 *  · a aba Perfil só aceita o perfil de ACESSO ativo (o SegPerfil e a Pesquisa da aba: ATIVO = 'S' AND TIPO = 'ACESSO'); a origem da
 *    cópia é qualquer perfil (a GET_PERFIL sem filtro). O "Registro de log" é só do usuário ("Informe o usuário.");
 *  · aberta pelo F4 da tela de perfis (`AbreTelaComCodigo`/`AbreTelaTipoCodigo = tpPerfil`): `?perfil=N` abre a aba Perfil com ele.
 */
const chave = (form: string, opcao: string) => `${form} ${opcao}`;

type Acao = { form: string; opcao: string; caption?: string | null; form_caption?: string | null };

export function CtrlPermissoesPage({ perfil }: { perfil?: number } = {}) {
  const mensagem = useMensagem();
  const [params] = useSearchParams();
  // o F4 da tela de perfis abre por cima com o perfil (prop); pela URL, `?perfil=`. Sem código, abre como sempre (SetCodigoAbrirTela :282)
  const perfilInicial = perfil || Number(params.get('perfil') ?? 0) || undefined;
  // a aba (TbsUsuarioEnter): trocar limpa o código e a empresa da outra
  const [tipo, setTipo] = useState<'USUARIO' | 'PERFIL'>(perfilInicial ? 'PERFIL' : 'USUARIO');
  const [catalogo, setCatalogo] = useState<Acao[]>([]);
  const [operador, setOperador] = useState<number | undefined>(perfilInicial);
  const [empresa, setEmpresa] = useState<number | undefined>();
  const [concedidos, setConcedidos] = useState<Set<string>>(new Set());
  const [filtroForm, setFiltroForm] = useState<string>('');
  const [trilha, setTrilha] = useState<AuditoriaPermissao[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [clonando, setClonando] = useState(false);
  const [logAberto, setLogAberto] = useState(false);
  const [clone, setClone] = useState<{ de?: number; de_empresa?: number; para?: number; para_empresa?: number }>({});

  // o operador (spdBuscaUsuarioClick, uCtrlPermissoes.pas:1464 e btnCloneClick, :380-384): GET_OPERADORES, CODIGO/NOME, com
  // CODIGO_EMPRESA = a empresa da sessão — a get_operadores do destino não tem CODIGO_EMPRESA (o legado junta RELACAO_OPERADOR_EMPRESA),
  // então o recorte por loja ainda não vai no lookup.
  const descOperador = (o: Record<string, any>) => String(o.nome ?? o.login ?? '');
  const { data: empresaOptions = [] } = useResourceOptions('cadastro/empresas', (e: any) => ({
    value: String(e.idempresa ?? e.codempresa), label: `${e.idempresa ?? e.codempresa} - ${e.razao_social ?? e.fantasia ?? ''}`,
  }));

  useEffect(() => void catalogoPermissoes().then(setCatalogo).catch(() => setCatalogo([])), []);

  const porPerfil = tipo === 'PERFIL';
  const recarregar = useCallback(async (cod: number, emp?: number) => {
    try {
      const g = porPerfil ? await grantsDoPerfil(cod, emp) : await grantsDoOperador(cod, emp);
      setConcedidos(new Set(g.grants.map((x) => chave(x.form, x.opcao))));
      void (porPerfil ? auditoriaPermissoes(cod) : auditoriaDoOperador(cod)).then(setTrilha).catch(() => setTrilha([]));
    } catch (e) {
      // "Informe um perfil válido." — o código não fica
      setConcedidos(new Set());
      setTrilha([]);
      mensagem.erro(e);
    }
  }, [mensagem, porPerfil]);

  useEffect(() => { if (operador != null) void recarregar(operador, empresa); }, [operador, empresa, recarregar]);
  const trocarAba = (t: string) => {
    if (t === tipo) return;
    setTipo(t as 'USUARIO' | 'PERFIL');
    setOperador(undefined); setEmpresa(undefined); setConcedidos(new Set()); setTrilha([]); setClonando(false);
  };
  const quem = porPerfil ? 'perfil' : 'operador';

  const toggle = async (a: Acao) => {
    if (operador == null) { mensagem.erro(`Selecione o ${quem}.`); return; }
    const k = chave(a.form, a.opcao);
    const concedido = !concedidos.has(k);
    setConcedidos((s) => { const n = new Set(s); if (concedido) n.add(k); else n.delete(k); return n; }); // otimista
    try {
      if (porPerfil) await setGrantPerfil(operador, a.form, a.opcao, concedido, empresa);
      else await setGrantOperador({ codoperador: operador, form: a.form, opcao: a.opcao, concedido, codempresa: empresa });
      void recarregar(operador, empresa);
    } catch (e) {
      mensagem.erro(e);
      void recarregar(operador, empresa); // volta ao estado do servidor
    }
  };

  const lote = async (concedido: boolean, form?: string) => {
    if (operador == null) { mensagem.erro(`Selecione o ${quem}.`); return; }
    if (!form && concedido && !window.confirm(`Conceder TODAS as ações do catálogo a este ${quem}?`)) return;
    setOcupado(true);
    try {
      const r = await setLotePermissoes({ ...(porPerfil ? { codperfil: operador } : { codoperador: operador }), form, concedido, codempresa: empresa });
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
    if (!window.confirm(`As permissões atuais do ${quem} de DESTINO serão APAGADAS e substituídas pelas da origem. Confirma?`)) return;
    setOcupado(true);
    try {
      const r = await clonarPermissoes({ tipo, de, de_empresa, para, para_empresa });
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
        // ⚠️ a coluna de ações do DataTable só desenha o botão quando há `icon` — sem ele a linha fica vazia
        // e a tela vira somente-leitura sem avisar. Foi o que aconteceu aqui até 08/09.
        concedidos.has(chave(r.form, r.opcao))
          ? { id: 't', label: 'Revogar', icon: <ShieldOff size={16} />, destructive: true, onClick: () => void toggle(r) }
          : { id: 't', label: 'Conceder', icon: <ShieldCheck size={16} />, onClick: () => void toggle(r) },
      ],
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [concedidos, operador, empresa, tipo]);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Controle de permissões" />
      <Tabs active={tipo} onChange={trocarAba} tabs={[{ id: 'USUARIO', label: 'Usuário' }, { id: 'PERFIL', label: 'Perfil' }]} />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
          {porPerfil ? (
            // spdBuscaPerfilClick (:1447): a GET_PERFIL com ATIVO = 'S' AND TIPO = 'ACESSO'; o código de outro tipo o servidor recusa
            <LookupField key="perfil" label="&Perfil" recurso="lookup/perfis" campoCodigo="codigo" descricao="perfil" fixos={{ ativo: 'S', tipo: 'ACESSO' }}
              statusTela={{ pai: 'frmCtrlPermissoes', retorno: 'EdtCodPerfil' }}
              value={operador} onChange={(cod) => setOperador(cod ? Number(cod) : undefined)} />
          ) : (
            // os operadores da loja do login (CODIGO_EMPRESA = empresa — uCtrlPermissoes.pas:1464-1466; o "Copiar de" idem, :380-384)
            <LookupField key="usuario" label="&Operador" recurso="lookup/operadores-da-loja" campoCodigo="codoperador" descricao={descOperador}
              value={operador} onChange={(cod) => setOperador(cod ? Number(cod) : undefined)} />
          )}
          <SelectField label="Empresa" options={empresaOptions} value={empresa != null ? String(empresa) : undefined}
            onChange={(v) => setEmpresa(v ? Number(v) : undefined)} placeholder="Empresa da sessão" />
          <SelectField label="&Tela" options={[{ value: '', label: 'Todas as telas' }, ...forms.map((f) => ({ value: f, label: f }))]}
            value={filtroForm} onChange={(v) => setFiltroForm(v ?? '')} />
        </div>
        <div className="mt-form-gap flex flex-wrap gap-gp-sm">
          <Button label={filtroForm ? 'Marcar tudo desta tela' : 'Marcar &tudo'} variant="soft" disabled={ocupado || operador == null} onClick={() => void lote(true, filtroForm || undefined)} />
          <Button label={filtroForm ? 'Desmarcar tudo desta tela' : '&Desmarcar tudo'} variant="soft" disabled={ocupado || operador == null} onClick={() => void lote(false, filtroForm || undefined)} />
          <Button label={porPerfil ? '&Copiar de outro perfil…' : '&Copiar de outro operador…'} variant="soft" disabled={ocupado || (porPerfil && operador == null)}
            onClick={() => { setClone({ para: operador, de_empresa: empresa, para_empresa: empresa }); setClonando(true); }} />
          {/* BtnLogClick (uCtrlPermissoes.pas:460): exige o usuário; mostra a coluna Empresa — quem liberou/removeu o quê */}
          {!porPerfil && <Button label="Registro de &log" variant="soft" disabled={operador == null} onClick={() => setLogAberto(true)} />}
        </div>
        {operador == null && <p className="mt-form-gap text-body-sm text-fg-muted">Selecione um {quem} para ver e editar as permissões. Sem permissão registrada, a ação é negada — é assim no legado também.</p>}
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
        <Modal open onClose={() => setClonando(false)} size="md" title={porPerfil ? 'Copiar permissões de outro perfil' : 'Copiar permissões de outro operador'}
          primaryAction={{ label: 'Copiar', onClick: () => void confirmarClone() }}
          secondaryAction={{ label: 'Cancelar', onClick: () => setClonando(false) }}>
          <div className="flex flex-col gap-form-gap">
            <p className="text-body-sm text-fg-danger">
              Atenção: as permissões atuais do {quem} de destino são <strong>apagadas</strong> e substituídas
              pelas da origem. É cópia, não soma — mesmo comportamento do sistema antigo.
            </p>
            <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
              {porPerfil ? (
                // btnCloneClick (:382): a GET_PERFIL sem filtro
                <LookupField label="Copiar &de" recurso="lookup/perfis" campoCodigo="codigo" descricao="perfil"
                  value={clone.de} onChange={(cod) => setClone((c) => ({ ...c, de: cod ? Number(cod) : undefined }))} />
              ) : (
                <LookupField label="Copiar &de" recurso="lookup/operadores-da-loja" campoCodigo="codoperador" descricao={descOperador}
                  value={clone.de} onChange={(cod) => setClone((c) => ({ ...c, de: cod ? Number(cod) : undefined }))} />
              )}
              <SelectField label="Empresa de origem" options={empresaOptions} value={clone.de_empresa != null ? String(clone.de_empresa) : undefined}
                onChange={(v) => setClone((c) => ({ ...c, de_empresa: v ? Number(v) : undefined }))} />
              {porPerfil ? (
                // o destino é o perfil da aba (FEditCodigo)
                <LookupField label="Para" recurso="lookup/perfis" campoCodigo="codigo" descricao="perfil" fixos={{ ativo: 'S', tipo: 'ACESSO' }} disabled
                  value={clone.para} onChange={() => undefined} />
              ) : (
                <LookupField label="Para" recurso="lookup/operadores-da-loja" campoCodigo="codoperador" descricao={descOperador}
                  value={clone.para} onChange={(cod) => setClone((c) => ({ ...c, para: cod ? Number(cod) : undefined }))} />
              )}
              <SelectField label="Empresa de destino" options={empresaOptions} value={clone.para_empresa != null ? String(clone.para_empresa) : undefined}
                onChange={(v) => setClone((c) => ({ ...c, para_empresa: v ? Number(v) : undefined }))} />
            </div>
          </div>
        </Modal>
      )}
    {logAberto && operador != null && !porPerfil && (
        <RegistrosLogModal log={{ form: 'FRMCTRLPERMISSOES', chave: 'CODOPERADOR', exibirEmpresa: true }} valor={operador} onFechar={() => setLogAberto(false)} />
      )}
    </div>
  );
}
