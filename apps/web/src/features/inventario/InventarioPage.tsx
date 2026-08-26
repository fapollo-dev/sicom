import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { DateField } from '../../shared/ui/DateField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import {
  listarInventarios, obterInventario, criarInventario, atualizarInventario,
  importarProdutosInventario, diferencasInventario, aplicarInventario,
  listarBalancos, gerarBalanco, importarBalanco, importarBalancoSincronizar, sincronizarInventario,
  relatorioDiferencaBalanco, zerarQtdeInventario, type DiferencaBalancoLinha,
  type InventarioLivro, type InventarioDetalhe, type BalancoLinha,
} from './inventarioApi';

const q3 = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/**
 * INVENTÁRIO (contagem física) — corte-2 front. Fluxo fiel ao legado (planilha): cria o livro → IMPORTA a folha
 * (contado nasce = saldo de sistema) → o operador AJUSTA o contado das linhas recontadas → SALVA → confere as
 * DIFERENÇAS → APLICA ao estoque (sobrescreve = contado, exige a senha de operação ADM da empresa). Sem máquina
 * de estado (rerodável), como o legado.
 */
export function InventarioPage() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<InventarioLivro[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [sel, setSel] = useState<InventarioDetalhe | null>(null);
  const [contagem, setContagem] = useState<Record<number, number>>({});
  const [difs, setDifs] = useState<Record<number, { sistema: number; diferenca: number }> | null>(null);
  const [apenasAtivos, setApenasAtivos] = useState(true);
  const [apenasComSaldo, setApenasComSaldo] = useState(false);
  const [senha, setSenha] = useState('');
  const [novaDesc, setNovaDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [balancos, setBalancos] = useState<BalancoLinha[]>([]);
  const [balancoSel, setBalancoSel] = useState('');
  const [dtSinc, setDtSinc] = useState('');
  const [soNegativas, setSoNegativas] = useState(false);
  const [relDif, setRelDif] = useState<{ itens: DiferencaBalancoLinha[]; total: number; aviso?: string } | null>(null);

  const carregarLista = useCallback(async () => {
    setCarregando(true);
    try {
      setLista(await listarInventarios());
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [mensagem]);
  useEffect(() => {
    void carregarLista();
  }, [carregarLista]);

  const abrir = async (id: number) => {
    try {
      const d = await obterInventario(id);
      setSel(d);
      setContagem(Object.fromEntries((d.itens ?? []).map((i) => [i.idproduto, Number(i.qtde)])));
      setDifs(null);
      // as fotos de estoque da empresa (o lookup GET_BALANCO) — alimentam o "Importar balanço"
      setBalancos((await listarBalancos().catch(() => ({ itens: [] as BalancoLinha[] }))).itens ?? []);
    } catch (e) {
      mensagem.erro(e);
    }
  };

  const criar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await criarInventario({ descricao: novaDesc || undefined });
      setNovaDesc('');
      await carregarLista();
      mensagem.sucesso(`Inventário ${d.codinvent} criado. Importe a folha de contagem.`);
      await abrir(d.codinvent);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const importar = async () => {
    if (!sel || busy) return;
    setBusy(true);
    try {
      const r = await importarProdutosInventario(sel.codinvent, { apenasAtivos, apenasComSaldo });
      mensagem.sucesso(`${r.itens} produto(s) importado(s) — o contado nasce = saldo de sistema; ajuste as linhas recontadas.`);
      await abrir(sel.codinvent);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const salvar = async () => {
    if (!sel || busy) return;
    setBusy(true);
    try {
      const itens = (sel.itens ?? []).map((i) => ({ idproduto: i.idproduto, qtde: contagem[i.idproduto] ?? Number(i.qtde) }));
      await atualizarInventario(sel.codinvent, { descricao: sel.descricao ?? undefined, itens });
      mensagem.sucesso('Contagem salva.');
      setDifs(null);
      await abrir(sel.codinvent);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const verDiferencas = async () => {
    if (!sel) return;
    try {
      const r = await diferencasInventario(sel.codinvent);
      setDifs(Object.fromEntries(r.itens.map((x) => [x.idproduto, { sistema: x.sistema, diferenca: x.diferenca }])));
    } catch (e) {
      mensagem.erro(e);
    }
  };

  const aplicar = async () => {
    if (!sel || busy) return;
    if (!window.confirm('Aplicar ao estoque? O saldo de cada produto passa a ser a quantidade CONTADA (sobrescreve).')) return;
    setBusy(true);
    try {
      const r = await aplicarInventario(sel.codinvent, senha || undefined);
      mensagem.sucesso(`${r.aplicados} item(ns) aplicado(s) ao estoque.`);
      setSenha('');
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  /**
   * GERAR BALANÇO (a contagem vira foto na data do livro). Fiel: com foto já lançada na data, o backend recusa
   * (BALANCO_EXISTE_NA_DATA) e aqui perguntamos o "substituir" — avisando que ele é PARCIAL, como no legado
   * (produto que não está na foto não é inserido).
   */
  const gerarFoto = async (substituir = false) => {
    if (!sel || busy) return;
    setBusy(true);
    try {
      const r = await gerarBalanco(sel.codinvent, substituir ? { substituir: true } : {});
      mensagem.sucesso(
        r.modo === 'criado'
          ? `Balanço ${r.codbalanco} gerado com ${r.itens} item(ns).`
          : `${r.itens} quantidade(s) atualizada(s) em ${r.balancos} balanço(s) da data. Produto que não estava na foto não foi inserido.`,
      );
      setBalancos((await listarBalancos().catch(() => ({ itens: [] as BalancoLinha[] }))).itens ?? []);
    } catch (e) {
      if ((e as any)?.envelope?.code === 'BALANCO_EXISTE_NA_DATA') {
        const qtd = Number((e as any)?.body?.detalhes?.balancos ?? (e as any)?.envelope?.detalhes?.balancos ?? 0);
        setBusy(false);
        if (window.confirm(`Existe balanço lançado nessa data${qtd ? ` (${qtd})` : ''}. Substituir?\n\nAtenção: o substituir é PARCIAL — só atualiza a quantidade dos produtos que já estão na foto.`)) {
          await gerarFoto(true);
        }
        return;
      }
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  /**
   * IMPORTAR BALANÇO — a foto escolhida entra como LISTA DE PRODUTOS e a quantidade vem do ESTOQUE DE HOJE
   * (estoque + depósito), não da foto. A folha atual é apagada (a confirmação do legado).
   */
  const importarDaFoto = async () => {
    if (!sel || busy || !balancoSel) return;
    const temItens = (sel.itens ?? []).length > 0;
    if (temItens && !window.confirm('O inventário atual será excluído. Deseja continuar?')) return;
    setBusy(true);
    try {
      const r = await importarBalanco(sel.codinvent, { codbalanco: Number(balancoSel), confirmar: temItens || undefined });
      mensagem.sucesso(`${r.itens} produto(s) importado(s) do balanço ${r.codbalanco} — a quantidade é o SALDO ATUAL (estoque + depósito), não a do balanço.`);
      await abrir(sel.codinvent);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  /**
   * "Importar Balanço e Atualizar Estoque": refaz a folha somando o movimento do intervalo à foto. O sentido é
   * decidido pelo backend (datas do livro × da foto) e datas iguais devolvem folha vazia — o aviso vem de lá.
   */
  const importarSincronizando = async () => {
    if (!sel || busy || !balancoSel) return;
    const temItens = (sel.itens ?? []).length > 0;
    if (temItens && !window.confirm('O inventário atual será excluído. Deseja continuar?')) return;
    setBusy(true);
    try {
      const r = await importarBalancoSincronizar(sel.codinvent, { codbalanco: Number(balancoSel), confirmar: temItens || undefined });
      const rumo = r.sentido === 'frente' ? 'para frente' : r.sentido === 'tras' ? 'para trás (rebobinando o movimento)' : 'nenhum';
      mensagem.sucesso(r.aviso ?? `${r.itens} produto(s) — saldo reconstruído ${rumo}${r.dtini && r.dtfim ? ` no intervalo ${r.dtini} → ${r.dtfim}` : ''}.`);
      await abrir(sel.codinvent);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  /** "Sincronizar Inventário (Entradas − Saídas)": recalcula as linhas que já estão na folha (não cria linha). */
  const sincronizar = async () => {
    if (!sel || busy) return;
    const temItens = (sel.itens ?? []).length > 0;
    // a rotina reescreve a contagem inteira e zera as linhas sem movimento — sem volta (fold da auditoria).
    if (temItens && !window.confirm('Sincronizar substitui a QUANTIDADE de todas as linhas da folha (as sem movimento no período vão a zero) e não tem desfazer. Continuar?')) return;
    setBusy(true);
    try {
      const r = await sincronizarInventario(sel.codinvent, { ...(dtSinc ? { dtinicial: dtSinc } : {}), ...(temItens ? { confirmar: true } : {}) });
      mensagem.sucesso(`${r.atualizados} linha(s) recalculada(s) e ${r.zerados} zerada(s) — janela ${r.dtinicial} → ${r.dtfinal}.${r.aviso ? ' ' + r.aviso : ''}`);
      await abrir(sel.codinvent);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  /**
   * RELATÓRIO DE DIFERENÇA (read-only). Manda como `alteradas` as linhas cuja contagem foi editada na tela — é o
   * equivalente ao 'T' que o Enter da grade do legado põe em memória (e que o Gravar sobrescreve, razão pela qual
   * no golden ALTERADO nunca é 'T'). Sem nenhuma edição, sai tudo zerado, como no legado.
   */
  const verRelatorioDiferenca = async () => {
    if (!sel || busy) return;
    const tocadas = (sel.itens ?? [])
      .filter((i) => (contagem[i.idproduto] ?? Number(i.qtde)) !== Number(i.qtde))
      .map((i) => ({ idproduto: i.idproduto, qtde: contagem[i.idproduto] ?? Number(i.qtde) }));
    setBusy(true);
    try {
      const r = await relatorioDiferencaBalanco(sel.codinvent, tocadas.length ? { alteradas: tocadas } : {});
      setRelDif({ itens: r.itens, total: r.total_diferenca, aviso: r.aviso });
      if (r.aviso) mensagem.sucesso(r.aviso);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  /** ZERAR QTDE NA GRADE — com o filtro de negativas, é o check "filtra negativos" do legado. */
  const zerarQtdes = async () => {
    if (!sel || busy) return;
    if (!window.confirm(soNegativas ? 'Zerar a quantidade das linhas NEGATIVAS?' : 'Zerar a quantidade de TODAS as linhas da folha?')) return;
    setBusy(true);
    try {
      const r = await zerarQtdeInventario(sel.codinvent, soNegativas ? { somenteNegativos: true } : {});
      mensagem.sucesso(`${r.zerados} linha(s) zerada(s).`);
      await abrir(sel.codinvent);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  // ─────────────────────────── DETALHE (livro aberto) ───────────────────────────
  if (sel) {
    const itens = sel.itens ?? [];
    return (
      <div className="flex flex-col gap-gp-md p-pad-md">
        <PageHeader title={`Inventário nº ${sel.codinvent}${sel.descricao ? ' — ' + sel.descricao : ''}`} />
        <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <CheckboxField label="Apenas &ativos" value={apenasAtivos ? 'S' : 'N'} onChange={(v) => setApenasAtivos(v === 'S')} />
          <CheckboxField label="Apenas com &saldo" value={apenasComSaldo ? 'S' : 'N'} onChange={(v) => setApenasComSaldo(v === 'S')} />
          <Button label="&Importar produtos" variant="soft" disabled={busy} onClick={() => void importar()} />
          <Button label="&Salvar contagem" variant="soft" disabled={busy || !itens.length} onClick={() => void salvar()} />
          <Button label="Ver &diferenças" variant="ghost" disabled={!itens.length} onClick={() => void verDiferencas()} />
          <div className="w-40">
            <Field label="Senha de &operação (ADM)" type="password" autoComplete="off" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="senha ADM" />
          </div>
          <Button label="&Aplicar ao estoque" variant="soft" disabled={busy || !itens.length || !senha} onClick={() => void aplicar()} />
          <CheckboxField label="Só n&egativas (zerar)" value={soNegativas ? 'S' : 'N'} onChange={(v) => setSoNegativas(v === 'S')} />
          <Button label="&Zerar qtdes" variant="ghost" disabled={busy || !itens.length} onClick={() => void zerarQtdes()} />
          <Button label="&Relatório de diferença" variant="ghost" disabled={busy || !itens.length} onClick={() => void verRelatorioDiferenca()} />
          <Button label="&Voltar" variant="ghost" onClick={() => { setSel(null); void carregarLista(); }} />
        </div>
        {/* BALANÇO (a foto de estoque) — os dois comandos do popup do legado que giram nela */}
        <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <SelectField
            label="&Balanço (foto de estoque)"
            value={balancoSel}
            onChange={setBalancoSel}
            placeholder="Selecione…"
            options={balancos.map((b2) => ({
              value: String(b2.codbalanco),
              label: `${b2.codbalanco} — ${b2.data.split('-').reverse().join('/')}${b2.descricao ? ' · ' + b2.descricao : ''} (${b2.itens} itens)`,
            }))}
          />
          <Button label="Importar &balanço" variant="soft" disabled={busy || !balancoSel} onClick={() => void importarDaFoto()} />
          <Button label="&Gerar balanço da contagem" variant="soft" disabled={busy || !itens.length} onClick={() => void gerarFoto()} />
          <Button label="Importar balanço e atualizar es&toque" variant="soft" disabled={busy || !balancoSel} onClick={() => void importarSincronizando()} />
          <DateField label="Data i&nicial (sincronismo)" value={dtSinc} onChange={(v) => setDtSinc(v ?? '')} />
          <Button label="Sincroni&zar (entradas − saídas)" variant="soft" disabled={busy || !itens.length} onClick={() => void sincronizar()} />
          <span className="text-xs text-fg-muted">
            Importar traz apenas a LISTA de produtos da foto — a quantidade é o saldo atual (estoque + depósito). Gerar cria a foto na data do livro.
            “Importar e atualizar estoque” refaz a folha somando o movimento do intervalo à foto (para frente ou para trás, conforme as datas);
            “Sincronizar” só recalcula as linhas que já estão na folha, e movimento negativo vira zero.
          </span>
          <small className="w-full text-fg-muted">Contado nasce = saldo de sistema; ajuste só as linhas recontadas. Aplicar SOBRESCREVE o estoque (exige senha ADM da empresa).</small>
        </div>

        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="p-pad-xs">Produto</th>
                <th className="p-pad-xs">Descrição</th>
                <th className="p-pad-xs text-right">Contado</th>
                {difs && <th className="p-pad-xs text-right">Sistema</th>}
                {difs && <th className="p-pad-xs text-right">Diferença</th>}
              </tr>
            </thead>
            <tbody>
              {itens.map((it) => {
                const d = difs?.[it.idproduto];
                return (
                  <tr key={it.idproduto} className="border-t border-border">
                    <td className="p-pad-xs tabular-nums">{it.idproduto}</td>
                    <td className="p-pad-xs">{it.descricao ?? '—'}</td>
                    <td className="p-pad-xs w-32">
                      <NumberField label="" value={contagem[it.idproduto]} decimais={3} min={0} onChange={(v) => setContagem((c) => ({ ...c, [it.idproduto]: v ?? 0 }))} />
                    </td>
                    {difs && <td className="p-pad-xs text-right tabular-nums">{d ? q3(d.sistema) : '—'}</td>}
                    {difs && <td className={`p-pad-xs text-right tabular-nums font-semibold ${d && d.diferenca !== 0 ? (d.diferenca > 0 ? 'text-danger' : 'text-warning') : 'text-fg-muted'}`}>{d ? q3(d.diferenca) : '—'}</td>}
                  </tr>
                );
              })}
              {!itens.length && (
                <tr><td colSpan={difs ? 5 : 3} className="p-pad-md text-fg-muted">Sem itens. Use «Importar produtos» para popular a folha.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {relDif && (
          /* RELATÓRIO DIFERENÇA DO BALANÇO PARA ESTOQUE — read-only: o legado imprime do dataset em memória e
             restaura a quantidade depois. A fórmula é a cascata por sinal, diferente da diferença do grid. */
          <div className="flex flex-col gap-gp-xs rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex items-baseline justify-between">
              <strong className="text-body-sm">Relatório: diferença do balanço para o estoque</strong>
              <span className="text-body-sm">Total: {q3(relDif.total)}</span>
            </div>
            {relDif.aviso && <span className="text-xs text-fg-muted">{relDif.aviso}</span>}
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-body-sm">
                <thead className="sticky top-0 bg-bg-surface">
                  <tr className="border-b border-border text-left">
                    <th className="p-pad-xs">Produto</th>
                    <th className="p-pad-xs">Descrição</th>
                    <th className="p-pad-xs text-right">Sistema</th>
                    <th className="p-pad-xs text-right">Contado</th>
                    <th className="p-pad-xs text-right">Impresso</th>
                    <th className="p-pad-xs text-right">Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  {relDif.itens.map((l) => (
                    <tr key={l.idproduto} className={`border-b border-border-subtle${l.alterado ? '' : ' text-fg-muted'}`}>
                      <td className="p-pad-xs">{l.idproduto}</td>
                      <td className="p-pad-xs">{l.descricao ?? ''}</td>
                      <td className="p-pad-xs text-right">{q3(l.sistema)}</td>
                      <td className="p-pad-xs text-right">{q3(l.contado)}</td>
                      <td className="p-pad-xs text-right">{q3(l.qtde_impressa)}</td>
                      <td className="p-pad-xs text-right">{q3(l.diferenca)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─────────────────────────── LISTA ───────────────────────────
  const colunas: DataTableColumnDef<InventarioLivro>[] = [
    { field: 'codinvent', headerName: 'Nº', type: 'text', width: 90, isPrimary: true },
    { field: 'descricao', headerName: 'Descrição', type: 'text' },
    { field: 'dtinventario', headerName: 'Data', type: 'text', width: 140 },
    { field: 'qtde_itens', headerName: 'Itens', type: 'number', width: 100 },
    {
      field: 'acoes', headerName: '', type: 'actions', width: 120,
      getActions: () => [{ id: 'abrir', label: 'Abrir', onClick: (row: InventarioLivro) => void abrir(Number(row.codinvent)) }],
    },
  ];
  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Inventário (contagem física)" />
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-72"><Field label="&Descrição do inventário" value={novaDesc} onChange={(e) => setNovaDesc(e.target.value)} placeholder="ex.: Inventário geral jul/2026" /></div>
        <Button label="&Novo inventário" variant="soft" disabled={busy} onClick={() => void criar()} />
      </div>
      <DataTable columns={colunas} rows={lista} loading={carregando} />
    </div>
  );
}
