import { useEffect, useState } from 'react';
import { Controller } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { SelectField } from '../../shared/ui/SelectField';
import { TextArea } from '../../shared/ui/TextArea';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import {
  argsPelosItens,
  contarCoringas,
  historicoContabilSchema,
  isErroResposta,
  itensHistoricoContabilSchema,
  montarDeschist,
  type ErroResposta,
  type HistoricoContabilDto,
} from '@apollo/shared';

/**
 * CADASTRO DE HISTÓRICO CONTÁBIL (`FRMCADHISTORICOCONTABIL`, `uCadHistoricoContabil.pas`).
 *
 * O texto que o razão imprime em cada lançamento. Cada `*` é um buraco que a contabilização preenche **na
 * ordem** — é por isso que a tela mostra, abaixo do campo, como o texto vai sair: trocar a ordem dos `*` troca
 * o que aparece no livro, e o erro só apareceria depois, no razão.
 *
 * A simulação usa a MESMA função que a API usa para escrever (`montarDeschist`, pacote compartilhado): número
 * vira nove dígitos com zeros à esquerda, texto vai cru.
 *
 * Abaixo do texto, os ITENS (mig 294, a grade de `uCadHistoricoContabil.dfm:359`): qual campo preenche cada
 * `*`. É a ordem dos itens que o razão segue — no histórico 62 o CFOP sai no rótulo "CNPJ" —, e a prévia mostra
 * o nome do campo em cada buraco justamente para isso ficar à vista.
 */
const EXEMPLOS = ['90886', 'ALELO ALIMENTACA - CODREDE 5', 130582, 'LETICIA ADM', 'BOLETO', 'BANCO ITAU S/A'];
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type Item = { ordem: number; tabela: string; campo: string; tipo_dados: string | null; status: 'S' | 'N' };

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { ...apiHeaders(), 'Content-Type': 'application/json' } });
  handle401(r);
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
    throw Object.assign(new Error(env.code), { envelope: env });
  }
  return (await r.json()) as T;
}

function ItensDoHistorico({ cod, texto, editavel }: { cod: number | null; texto: string; editavel: boolean }) {
  const mensagem = useMensagem();
  const [itens, setItens] = useState<Item[]>([]);
  const [sujo, setSujo] = useState(false);

  useEffect(() => {
    setSujo(false);
    if (cod == null) { setItens([]); return; }
    pedir<{ itens: Array<Item & { ordem: number | null }> }>(`${BASE}/cadastro/historico-contabil/${cod}/itens`)
      .then((r) => setItens(r.itens.map((i, n) => ({ ...i, ordem: i.ordem ?? n + 1 }))))
      .catch((e) => mensagem.erro(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cod]);

  if (cod == null) {
    return <p className="text-body-sm text-fg-muted">Grave o histórico para cadastrar os itens.</p>;
  }

  const mudar = (i: number, campo: keyof Item, valor: string) => {
    setItens((l) => l.map((x, n) => (n === i ? { ...x, [campo]: campo === 'ordem' ? Number(valor) || 0 : valor } : x)));
    setSujo(true);
  };
  const incluir = () => {
    const prox = itens.reduce((m, x) => Math.max(m, x.ordem), 0) + 1;
    setItens((l) => [...l, { ordem: prox, tabela: '', campo: '', tipo_dados: 'VARCHAR', status: 'S' }]);
    setSujo(true);
  };
  const remover = (i: number) => { setItens((l) => l.filter((_x, n) => n !== i)); setSujo(true); };
  const gravar = async () => {
    const dto = itensHistoricoContabilSchema.safeParse({ itens });
    if (!dto.success) { mensagem.erro(new Error(dto.error.issues[0]?.message ?? 'itens inválidos')); return; }
    try {
      const r = await pedir<{ itens: Item[] }>(`${BASE}/cadastro/historico-contabil/${cod}/itens`, {
        method: 'PUT', body: JSON.stringify(dto.data),
      });
      setItens(r.itens);
      setSujo(false);
      mensagem.sucesso('Itens gravados.');
    } catch (e) { mensagem.erro(e); }
  };

  const n = contarCoringas(texto);
  // a prévia põe o NOME do campo em cada buraco: é aí que se vê o CFOP caindo no rótulo "CNPJ"
  const previa = n > 0 && itens.length > 0
    ? montarDeschist(texto, argsPelosItens(itens, (_t, c) => `[${c}]`))
    : null;
  const inp = 'w-full rounded-radius-sm border border-border bg-bg-surface px-pad-xs py-0.5 text-body-sm disabled:opacity-60';

  return (
    <div className="flex flex-col gap-gp-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-gp-sm">
        <h4 className="text-body-sm font-semibold">Itens — o campo que preenche cada buraco, na ordem</h4>
        {itens.length > n && n > 0 && (
          <span className="text-body-sm text-fg-muted">
            {itens.length} itens para {n} {n === 1 ? 'buraco' : 'buracos'}: os que sobram são ignorados.
          </span>
        )}
      </div>
      {previa && (
        <p className="text-body-sm">
          <span className="text-fg-muted">Pelos itens, sairia: </span>
          <span className="font-mono">{previa}</span>
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-body-sm">
          <thead><tr className="border-b border-border text-left text-fg-muted">
            <th className="w-16 p-pad-xs">Ordem</th><th className="p-pad-xs">Tabela</th>
            <th className="p-pad-xs">Campo</th><th className="w-28 p-pad-xs">Tipo</th>
            <th className="w-20 p-pad-xs">Ativo</th><th className="w-10 p-pad-xs" />
          </tr></thead>
          <tbody>{itens.map((it, i) => (
            <tr key={i} className="border-b border-border">
              <td className="p-pad-xs"><input className={`${inp} tabular-nums`} disabled={!editavel} value={it.ordem} inputMode="numeric"
                onChange={(e) => mudar(i, 'ordem', e.target.value.replace(/\D/g, ''))} aria-label="Ordem" /></td>
              <td className="p-pad-xs"><input className={inp} disabled={!editavel} value={it.tabela}
                onChange={(e) => mudar(i, 'tabela', e.target.value.toUpperCase())} aria-label="Tabela" /></td>
              <td className="p-pad-xs"><input className={inp} disabled={!editavel} value={it.campo}
                onChange={(e) => mudar(i, 'campo', e.target.value.toUpperCase())} aria-label="Campo" /></td>
              <td className="p-pad-xs">
                <select className={inp} disabled={!editavel} value={it.tipo_dados ?? ''} onChange={(e) => mudar(i, 'tipo_dados', e.target.value)} aria-label="Tipo">
                  <option value="VARCHAR">texto</option><option value="NUMERIC">número</option>
                </select>
              </td>
              <td className="p-pad-xs">
                <select className={inp} disabled={!editavel} value={it.status} onChange={(e) => mudar(i, 'status', e.target.value)} aria-label="Ativo">
                  <option value="S">Sim</option><option value="N">Não</option>
                </select>
              </td>
              <td className="p-pad-xs text-right">
                {editavel && <button type="button" className="text-fg-danger" onClick={() => remover(i)} aria-label="Remover item">×</button>}
              </td>
            </tr>))}</tbody>
        </table>
      </div>
      {editavel && (
        <div className="flex flex-wrap gap-gp-sm">
          <Button label="&Incluir item" onClick={incluir} />
          <Button label="Gravar i&tens" onClick={() => void gravar()} disabled={!sujo} />
        </div>
      )}
    </div>
  );
}

export function HistoricoContabilCadMaster() {
  return (
    <CadMaster<HistoricoContabilDto>
      titulo="Histórico contábil"
      resourcePath="cadastro/historico-contabil"
      pk="codhistcontabil"
      pkGerada
      largura="5xl"
      colunasPesquisa={[
        { campo: 'codhistcontabil', label: 'Código', tipo: 'text', largura: 100 },
        { campo: 'deschist', label: 'Histórico', tipo: 'text' },
        { campo: 'coringas', label: 'Buracos', tipo: 'text', largura: 90 },
        { campo: 'status', label: 'Ativo', tipo: 'text', largura: 80 },
      ]}
      schema={historicoContabilSchema}
      defaultValues={{ deschist: '', status: 'S' }}
      campos={({ form, editavel }) => {
        const texto = form.watch('deschist') ?? '';
        const n = contarCoringas(texto);
        const cod = (form.watch('codhistcontabil' as any) ?? (form.getValues() as Record<string, unknown>).codhistcontabil) as unknown as number | null | undefined;
        return (
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
            <div className="sm:col-span-2">
              <TextArea
                label="&Histórico"
                disabled={!editavel}
                error={form.formState.errors.deschist?.message as string | undefined}
                {...form.register('deschist')}
              />
              <p className="mt-gp-xs text-body-sm text-fg-muted">
                Cada <code>*</code> é preenchido pela contabilização, na ordem. Este histórico tem{' '}
                <strong>{n}</strong> {n === 1 ? 'buraco' : 'buracos'}.
              </p>
              {n > 0 && (
                <p className="mt-gp-xs text-body-sm">
                  <span className="text-fg-muted">Sairia assim: </span>
                  <span className="font-mono">{montarDeschist(texto, EXEMPLOS.slice(0, n))}</span>
                </p>
              )}
            </div>
            <Controller
              control={form.control}
              name="status"
              render={({ field }) => (
                <SelectField
                  label="&Ativo"
                  options={[{ value: 'S', label: 'Sim' }, { value: 'N', label: 'Não' }]}
                  value={field.value ?? 'S'}
                  onChange={field.onChange}
                  error={form.formState.errors.status?.message as string | undefined}
                />
              )}
            />
            <div className="sm:col-span-2">
              <ItensDoHistorico cod={cod == null ? null : Number(cod)} texto={texto} editavel={editavel} />
            </div>
          </div>
        );
      }}
    />
  );
}
