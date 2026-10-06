import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { SelectField } from '../../shared/ui/SelectField';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { getSessao } from '../../shared/auth/session';
import {
  definirSenhaAdministrativa,
  listarConfiguracoes,
  setOverrideEmpresa,
  removerOverrideEmpresa,
  type ConfigItem,
} from './configuracoesApi';

const SEM_OVERRIDE = '__PADRAO__'; // sentinela do select = "usar o valor padrão" (remove o override de Empresa)

/**
 * CONFIGURAÇÕES (tela UConfigura) — gestão da camada chave-valor por empresa. Lista o catálogo agrupado
 * por categoria; para cada chave o operador define o OVERRIDE da empresa corrente (ou volta ao padrão).
 * O "valor efetivo" é o que a NF/processos veem (mesmo resolver). Escopos Usuario/Modulo ficam para a
 * tela avançada; aqui edita-se o escopo Empresa (o mais comum).
 * Como no legado, a tela abre com a SENHA ADMINISTRATIVA da empresa (não é permissão de PERMISSOES).
 *
 * As teclas (`FRMCONFIGURA`, um `TForm` — sem as teclas do `TfrmMaster`): Esc = Sair (o `actEsc`) e Enter vira Tab fora da grade (o
 * FormKeyPress) — os mesmos da base no Apollo. LACUNA: F5 mostra a coluna "Tipo Controle" e destrava o nome da configuração na grade
 * do ConfigDB.xml (aqui não há a grade nem se renomeia a chave); o F9/F10 da grade (o filtro do FramePesquisaDataSet) também.
 */
export function ConfiguracoesPage() {
  const mensagem = useMensagem();
  const empresa = getSessao()?.empresa ?? 0;
  const [itens, setItens] = useState<ConfigItem[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [textos, setTextos] = useState<Record<string, string>>({}); // rascunho dos campos de texto livre
  const [liberada, setLiberada] = useState(false);
  const [senha, setSenha] = useState('');
  useEffect(() => () => definirSenhaAdministrativa(null), []); // fechou a tela, a senha vai embora (o legado pede a cada abertura)

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const lista = await listarConfiguracoes();
      setItens(lista);
      setTextos(Object.fromEntries(lista.filter((c) => !c.opcoes).map((c) => [c.codigo, c.overrideEmpresa ?? ''])));
      setLiberada(true);
    } catch (e) {
      const code = (e as { envelope?: { code?: string } }).envelope?.code ?? '';
      if (code.startsWith('SENHA_ADMINISTRATIVA') || code === 'OPERACOES_BASICAS_DESABILITADAS') {
        definirSenhaAdministrativa(null);
        setLiberada(false);
      }
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [mensagem]);

  const entrar = useCallback(async () => {
    if (!senha.trim()) { mensagem.erro(new Error('Favor informar a senha.')); return; }
    definirSenhaAdministrativa(senha);
    setSenha('');
    await carregar();
  }, [senha, carregar, mensagem]);

  const grupos = useMemo(() => {
    const m = new Map<string, ConfigItem[]>();
    for (const c of itens) {
      const g = c.categorias ?? 'Outros';
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(c);
    }
    return [...m.entries()];
  }, [itens]);

  const gravarOverride = useCallback(
    async (c: ConfigItem, valor: string) => {
      if (!empresa) { mensagem.erro(new Error('Sessão sem empresa ativa.')); return; }
      try {
        await setOverrideEmpresa(c.codigo, empresa, valor);
        mensagem.sucesso(`${c.descricaopequena ?? c.codigo}: valor da empresa atualizado.`);
        await carregar();
      } catch (e) {
        mensagem.erro(e);
      }
    },
    [empresa, mensagem, carregar],
  );

  const usarPadrao = useCallback(
    async (c: ConfigItem) => {
      if (!empresa) { mensagem.erro(new Error('Sessão sem empresa ativa.')); return; }
      try {
        await removerOverrideEmpresa(c.codigo, empresa);
        mensagem.sucesso(`${c.descricaopequena ?? c.codigo}: voltou ao padrão.`);
        await carregar();
      } catch (e) {
        mensagem.erro(e);
      }
    },
    [empresa, mensagem, carregar],
  );

  const podeEmpresa = (c: ConfigItem) => c.escoposPermitidos.includes('Empresa');

  if (!liberada) {
    return (
      <div className="flex flex-col gap-form-gap max-w-md">
        <PageHeader title="Configurações" description="Informe a senha administrativa da empresa para abrir as configurações." />
        <form className="flex items-end gap-gp-sm" onSubmit={(e) => { e.preventDefault(); void entrar(); }}>
          <div className="w-56">
            <Field label="&Senha administrativa" type="password" autoFocus value={senha} onChange={(e) => setSenha(e.target.value)} />
          </div>
          <Button label="&Entrar" type="submit" disabled={carregando} />
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-form-gap max-w-4xl">
      <PageHeader
        title="Configurações"
        description="Parâmetros do sistema por empresa. Deixe em “padrão” para herdar o valor global; escolha um valor para sobrescrever nesta empresa."
      />
      {carregando ? (
        <small className="text-fg-muted">Carregando…</small>
      ) : itens.length === 0 ? (
        <small className="text-fg-muted">Nenhuma configuração cadastrada.</small>
      ) : (
        grupos.map(([grupo, lista]) => (
          <section key={grupo} className="flex flex-col gap-gp-sm">
            <h3 className="text-sm font-semibold text-fg-muted">{grupo}</h3>
            <div className="flex flex-col divide-y divide-border rounded-radius-md border border-border bg-bg-surface">
              {lista.map((c) => {
                const override = c.overrideEmpresa != null;
                return (
                  <div key={c.codigo} className="flex flex-wrap items-end justify-between gap-gp-sm p-pad-md">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{c.descricaopequena ?? c.codigo}</div>
                      <div className="text-xs text-fg-muted">
                        {c.codigo} · valor efetivo:{' '}
                        <strong>{c.opcoes?.find((o) => o.valor === c.valorEfetivo)?.label ?? c.valorEfetivo ?? '—'}</strong>
                        {override ? ' (sobrescrito nesta empresa)' : ' (padrão)'}
                      </div>
                    </div>
                    {!podeEmpresa(c) ? (
                      <small className="text-fg-muted">Não editável por empresa</small>
                    ) : c.opcoes ? (
                      <div className="w-56">
                        <SelectField
                          label="Valor"
                          value={c.overrideEmpresa ?? SEM_OVERRIDE}
                          options={[
                            { value: SEM_OVERRIDE, label: `Padrão (${c.opcoes.find((o) => o.valor === c.valor)?.label ?? c.valor ?? '—'})` },
                            ...c.opcoes.map((o) => ({ value: o.valor, label: o.label })),
                          ]}
                          onChange={(v) => (v === SEM_OVERRIDE ? void usarPadrao(c) : void gravarOverride(c, v))}
                        />
                      </div>
                    ) : (
                      <div className="flex items-end gap-gp-sm">
                        <div className="w-56">
                          <Field
                            label="Valor"
                            value={textos[c.codigo] ?? ''}
                            onChange={(e) => setTextos((t) => ({ ...t, [c.codigo]: e.target.value }))}
                          />
                        </div>
                        <Button
                          label="&Salvar"
                          variant="soft"
                          onClick={() => {
                            const v = (textos[c.codigo] ?? '').trim();
                            return v ? void gravarOverride(c, v) : void usarPadrao(c);
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
