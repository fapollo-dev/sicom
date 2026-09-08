import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { imprimirPagina } from '../../shared/print/imprimirPagina';
import {
  listarRelatorios, camposDaFonte, executar, baixarCsv,
  type RelatorioSalvo, type CampoFonte, type Execucao, type Condicao,
} from './construtorApi';

/**
 * RELATÓRIOS (`FRMRELATORIO`, `uRelatorio.pas`) — corte-1: escolher um relatório, filtrar e rodar.
 * Dossiê: `uRelatorio-construtor.md`.
 *
 * É a segunda tela de relatório mais usada do cliente (1.251 acessos) e ele montou 95 relatórios com ela.
 * O corte-1 executa; o construtor (montar e editar) é o corte-2.
 *
 * O que a tela mostra vem inteiro da definição salva: o título de cada coluna é o que o cliente escreveu, a
 * ordem é a que ele arrastou, o formato (moeda, data) é o que ele escolheu e o rodapé soma as colunas que ele
 * marcou para totalizar. Nada disso está no código — está no dado.
 */
const OPERADORES = [
  { value: '=', label: 'igual a' },
  { value: '<>', label: 'diferente de' },
  { value: 'contem', label: 'contém' },
  { value: 'comeca', label: 'começa com' },
  { value: '>=', label: 'a partir de' },
  { value: '<=', label: 'até' },
  { value: 'entre', label: 'entre' },
  { value: 'vazio', label: 'em branco' },
  { value: 'preenchido', label: 'preenchido' },
];

const fmtMoeda = (v: unknown) => (v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const fmtData = (v: unknown) => (v == null || v === '' ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const fmtNum = (v: unknown) => (v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR'));
const formatar = (v: unknown, f: string) => (f === 'moeda' ? fmtMoeda(v) : f === 'data' ? fmtData(v) : f === 'numero' ? fmtNum(v) : v == null ? '' : String(v));

export function RelatoriosPage() {
  const mensagem = useMensagem();
  const navigate = useNavigate();
  const [salvos, setSalvos] = useState<RelatorioSalvo[]>([]);
  const [sel, setSel] = useState<number | undefined>();
  const [campos, setCampos] = useState<CampoFonte[]>([]);
  const [filtros, setFiltros] = useState<Condicao[]>([]);
  const [res, setRes] = useState<Execucao | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    void listarRelatorios().then((r) => { setSalvos(r); if (r.length && sel == null) setSel(r[0].codrelatoriodef); })
      .catch((e) => mensagem.erro(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const atual = salvos.find((r) => r.codrelatoriodef === sel);

  useEffect(() => {
    setRes(null); setFiltros([]);
    if (!atual) { setCampos([]); return; }
    void camposDaFonte(atual.fonte).then(setCampos).catch(() => setCampos([]));
  }, [atual?.fonte, atual?.codrelatoriodef]); // eslint-disable-line react-hooks/exhaustive-deps

  const rodar = useCallback(async () => {
    if (sel == null) return;
    setOcupado(true);
    try {
      const r = await executar({ codrelatoriodef: sel, filtros: filtros.filter((f) => f.campo) });
      setRes(r);
      if (r.truncado) mensagem.sucesso(`Relatório gerado. Só as primeiras ${r.linhas.length.toLocaleString('pt-BR')} linhas foram trazidas — refine os filtros para ver o resto.`);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  }, [sel, filtros, mensagem]);

  const exportar = async () => {
    if (sel == null || !atual) return;
    setOcupado(true);
    try { await baixarCsv({ codrelatoriodef: sel, filtros: filtros.filter((f) => f.campo) }, atual.nome); }
    catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  /**
   * IMPRIMIR / PDF — o substituto do FastReport: manda para o diálogo nativo o que a tela já mostra, e o
   * operador escolhe impressora ou "Salvar como PDF". A orientação vem do relatório (`IMPRIMIR_EM_PAISAGEM`).
   * ⚠️ a janela abre SÍNCRONA no clique, senão o bloqueador de pop-up a engole (lição das etiquetas).
   */
  const imprimir = () => {
    if (!res) return;
    const win = window.open('', '_blank', 'width=1024,height=768');
    if (!win) { mensagem.erro('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.'); return; }
    const raiz = document.getElementById('rel-impressao');
    if (!raiz) { win.close(); return; }
    imprimirPagina(win, raiz, res.titulo, undefined, res.paisagem);
  };

  const setFiltro = (i: number, patch: Partial<Condicao>) =>
    setFiltros((fs) => fs.map((f, k) => (k === i ? { ...f, ...patch } : f)));

  const cols = useMemo<DataTableColumnDef<Record<string, unknown>>[]>(() => {
    if (!res) return [];
    return res.colunas.map((c, i) => ({
      field: c.chave,
      headerName: c.titulo,
      type: 'text' as const,
      isPrimary: i === 0,
      width: c.largura ? Math.max(90, c.largura * 9) : undefined,
      valueGetter: (l: Record<string, unknown>) => formatar(l[c.chave], c.formato),
    }));
  }, [res]);

  const semFiltro = !filtros.length;

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Relatórios" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
          <SelectField label="&Relatório" options={salvos.map((r) => ({ value: String(r.codrelatoriodef), label: r.nome }))}
            value={sel != null ? String(sel) : undefined} onChange={(v) => setSel(v ? Number(v) : undefined)}
            placeholder="Selecione o relatório…" />
          <div className="flex items-end text-body-sm text-fg-muted">
            {atual && <>Fonte: <strong className="ml-1">{atual.rotulo ?? atual.fonte}</strong>{atual.origem === 'LEGADO' && ' · importado do sistema antigo'}</>}
          </div>
        </div>

        {atual && (
          <div className="mt-form-gap flex flex-col gap-gp-sm">
            {filtros.map((f, i) => (
              <div key={i} className="flex flex-wrap items-end gap-gp-sm">
                <div className="w-56">
                  <SelectField label={i === 0 ? '&Filtrar por' : ''} options={campos.map((c) => ({ value: c.campo, label: c.campo }))}
                    value={f.campo} onChange={(v) => setFiltro(i, { campo: v ?? '' })} placeholder="Campo…" />
                </div>
                <div className="w-44">
                  <SelectField label={i === 0 ? 'Condição' : ''} options={OPERADORES} value={f.operador}
                    onChange={(v) => setFiltro(i, { operador: v ?? '=' })} />
                </div>
                {!['vazio', 'preenchido'].includes(String(f.operador)) && (
                  <div className="w-52">
                    <Field label={i === 0 ? 'Valor' : ''} value={String(f.valor ?? '')}
                      type={campos.find((c) => c.campo === f.campo)?.formato === 'data' ? 'date' : 'text'}
                      onChange={(e) => setFiltro(i, { valor: e.target.value })} />
                  </div>
                )}
                <Button label="Remover" variant="soft" onClick={() => setFiltros((fs) => fs.filter((_, k) => k !== i))} />
              </div>
            ))}
            <div className="flex flex-wrap gap-gp-sm">
              <Button label="+ &Filtro" variant="soft" disabled={!campos.length}
                onClick={() => setFiltros((fs) => [...fs, { campo: campos[0]?.campo ?? '', operador: '=', valor: '' }])} />
              <Button label="&Gerar" disabled={ocupado || sel == null} onClick={() => void rodar()} />
              <Button label="&Exportar CSV" variant="soft" disabled={ocupado || sel == null} onClick={() => void exportar()} />
              <Button label="&Imprimir / PDF" variant="soft" disabled={!res} onClick={imprimir} />
              <Button label="Ed&itar" variant="soft" disabled={sel == null} onClick={() => navigate(`/relatorios/construtor/${sel}/editar`)} />
              <Button label="&Novo relatório" variant="soft" onClick={() => navigate('/relatorios/construtor/novo')} />
            </div>
            {semFiltro && <p className="text-body-sm text-fg-muted">Sem filtro, o relatório traz tudo o que a definição dele permite — as condições que o próprio relatório já tem continuam valendo.</p>}
          </div>
        )}
      </section>

      {res && (
        <div id="rel-impressao" className="flex flex-col gap-gp-md">
          <div className="flex flex-wrap items-baseline justify-between gap-gp-sm">
            <h2 className="text-body-lg">{res.titulo}</h2>
            <span className="text-body-sm text-fg-muted">
              {res.linhas.length.toLocaleString('pt-BR')} linha(s){res.truncado && ' (parcial)'}
            </span>
          </div>
          <DataTable rows={res.linhas} columns={cols} getRowId={(_l: Record<string, unknown>, i?: number) => String(i)} />
          {Object.keys(res.totais).length > 0 && (
            <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
              <div className="flex flex-wrap gap-gp-lg">
                {res.colunas.filter((c) => res.totais[c.chave] != null).map((c) => (
                  <div key={c.chave}>
                    <div className="text-body-sm text-fg-muted">Total · {c.titulo}</div>
                    <div className="text-body-lg tabular-nums">{formatar(res.totais[c.chave], c.formato === 'texto' ? 'numero' : c.formato)}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
