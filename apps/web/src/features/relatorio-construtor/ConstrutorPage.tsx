import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOpcoesDoForm } from '../../shared/acesso/useOpcoesDoForm';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@apollosg/design-system';
import type { DefinicaoRelatorioDto } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import {
  listarFontes, camposDaFonte, obterRelatorio, salvarRelatorio, removerRelatorio, executar,
  type Fonte, type CampoFonte, type Execucao, OPERADORES,
} from './construtorApi';

type Coluna = NonNullable<DefinicaoRelatorioDto['colunas']>[number];
type Condicao = NonNullable<DefinicaoRelatorioDto['condicoes']>[number];

/**
 * CONSTRUTOR DE RELATÓRIOS (`FRMRELATORIO` / `FRMCADASTRORELATORIO`) — corte-2: montar e editar.
 * Dossiê: `uRelatorio-construtor.md`.
 *
 * É a tela que dá autonomia ao cliente, e é a razão de ele ter 95 relatórios próprios. O que ela faz é
 * exatamente o que a do legado faz (`uRelatorio.pas`): escolher a fonte, adicionar campos, **subir e descer**
 * para ordenar (`btnUpClick`/`btnDownClick`), dar um título e uma largura a cada coluna, criar **coluna
 * calculada** (`btnAddCalculadosClick`), pôr **condições** e marcar o que **totaliza** no rodapé.
 *
 * A diferença: trocar de fonte aqui não perde o trabalho em silêncio — o legado avisa e descarta
 * (`cbbTabelaShowCloseUp`, "ao mudar de tabela a configuração efetuada será perdida"); aqui a confirmação diz
 * quantas colunas serão perdidas. E a **prévia roda sem gravar**, que é como se confere antes de salvar.
 */
const FORMATOS = [
  { value: 'texto', label: 'Texto' }, { value: 'numero', label: 'Número' },
  { value: 'moeda', label: 'Moeda' }, { value: 'data', label: 'Data' },
];
const OPERACOES = [{ value: '+', label: '+' }, { value: '-', label: '−' }, { value: '*', label: '×' }, { value: '/', label: '÷' }];

const rotuloColuna = (c: Coluna) =>
  c.calculado ? `${c.calculado.campo1} ${c.calculado.operacao} ${c.calculado.campo2}` : (c.campo ?? '');

export function ConstrutorPage() {
  const { tem: pode } = useOpcoesDoForm('FRMRELATORIO'); // permissões de controle (docs/05-migration-engineering/permissoes-de-controle.md)
  const { cod } = useParams();
  const navigate = useNavigate();
  const mensagem = useMensagem();
  const codNum = cod ? Number(cod) : null;

  const [fontes, setFontes] = useState<Fonte[]>([]);
  const [nome, setNome] = useState('');
  const [fonte, setFonte] = useState('');
  const [titulo, setTitulo] = useState('');
  const [paisagem, setPaisagem] = useState(false);
  const [colunas, setColunas] = useState<Coluna[]>([]);
  const [condicoes, setCondicoes] = useState<Condicao[]>([]);
  // a ordenação e o agrupamento do legado (cdsOrdenacao / cdsAgrupar) e as duas opções do grupo (MOSTRA_SOMENTE_AGRUPAMENTO /
  // SALTAR_PG_GRUPO) — carregadas e gravadas com o relatório (antes o editor as descartava ao gravar)
  const [ordem, setOrdem] = useState<string[]>([]);
  const [agrupar, setAgrupar] = useState<string[]>([]);
  const [somenteAgrupamento, setSomenteAgrupamento] = useState(false);
  const [quebraPagina, setQuebraPagina] = useState(false);
  const [aOrdenar, setAOrdenar] = useState('');
  const [aAgrupar, setAAgrupar] = useState('');
  const [campos, setCampos] = useState<CampoFonte[]>([]);
  const [aAdicionar, setAAdicionar] = useState<string>('');
  const [calc, setCalc] = useState<{ campo1: string; operacao: string; campo2: string; titulo: string }>({ campo1: '', operacao: '+', campo2: '', titulo: '' });
  const [previa, setPrevia] = useState<Execucao | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => { void listarFontes().then(setFontes).catch((e) => mensagem.erro(e)); }, [mensagem]);

  useEffect(() => {
    if (codNum == null) return;
    void obterRelatorio(codNum).then((r) => {
      setNome(r.nome); setFonte(r.fonte);
      setTitulo(r.definicao.titulo ?? r.nome);
      setPaisagem(!!r.definicao.paisagem);
      setColunas([...(r.definicao.colunas ?? [])].sort((a, b) => (a.posicao ?? 0) - (b.posicao ?? 0)));
      setCondicoes(r.definicao.condicoes ?? []);
      setOrdem((r.definicao.ordem ?? []).map((o) => o.campo));
      setAgrupar(r.definicao.agrupar?.length ? r.definicao.agrupar : r.definicao.agruparPor ? [r.definicao.agruparPor] : []);
      setSomenteAgrupamento(!!r.definicao.somenteAgrupamento);
      setQuebraPagina(!!r.definicao.quebraPagina);
    }).catch((e) => mensagem.erro(e));
  }, [codNum, mensagem]);

  useEffect(() => {
    if (!fonte) { setCampos([]); return; }
    void camposDaFonte(fonte).then((cs) => { setCampos(cs); setAAdicionar(cs[0]?.campo ?? ''); }).catch(() => setCampos([]));
  }, [fonte]);

  /** o legado avisa que muda de tabela e descarta a configuração; aqui a confirmação diz o tamanho do prejuízo. */
  const trocarFonte = (nova: string | undefined) => {
    if (!nova || nova === fonte) return;
    if (colunas.length && !window.confirm(`Ao mudar de fonte as ${colunas.length} coluna(s) montadas são perdidas. Confirma?`)) return;
    setFonte(nova); setColunas([]); setCondicoes([]); setOrdem([]); setAgrupar([]); setPrevia(null);
  };

  const addCampo = () => {
    const c = campos.find((x) => x.campo === aAdicionar);
    if (!c) return;
    setColunas((cs) => [...cs, { campo: c.campo, titulo: c.campo, largura: 14, formato: c.formato as Coluna['formato'], posicao: cs.length + 1 }]);
  };
  const addCalculada = () => {
    if (!calc.campo1 || !calc.campo2) { mensagem.erro('Escolha os dois campos da conta.'); return; }
    setColunas((cs) => [...cs, {
      calculado: { campo1: calc.campo1, operacao: calc.operacao as 'x' extends never ? never : '+' | '-' | '*' | '/', campo2: calc.campo2 },
      titulo: calc.titulo || `${calc.campo1} ${calc.operacao} ${calc.campo2}`,
      largura: 14, formato: 'numero', posicao: cs.length + 1, totalizar: true,
    }]);
    setCalc({ campo1: '', operacao: '+', campo2: '', titulo: '' });
  };
  const patchColuna = (i: number, p: Partial<Coluna>) => setColunas((cs) => cs.map((c, k) => (k === i ? { ...c, ...p } : c)));
  const mover = (i: number, d: -1 | 1) => setColunas((cs) => {
    const j = i + d;
    if (j < 0 || j >= cs.length) return cs;
    const n = [...cs]; [n[i], n[j]] = [n[j], n[i]];
    return n.map((c, k) => ({ ...c, posicao: k + 1 }));
  });
  const remover = (i: number) => setColunas((cs) => cs.filter((_, k) => k !== i).map((c, k) => ({ ...c, posicao: k + 1 })));

  const definicao = useMemo<DefinicaoRelatorioDto>(() => ({
    titulo: titulo || nome,
    paisagem,
    colunas: colunas.map((c, i) => ({ ...c, posicao: i + 1 })),
    condicoes: condicoes.filter((c) => c.campo),
    ordem: ordem.map((campo) => ({ campo, direcao: 'asc' as const })),
    agrupar,
    somenteAgrupamento: agrupar.length ? somenteAgrupamento : false,
    quebraPagina: agrupar.length ? quebraPagina : false,
  }), [titulo, nome, paisagem, colunas, condicoes, ordem, agrupar, somenteAgrupamento, quebraPagina]);

  const verPrevia = useCallback(async () => {
    if (!fonte || !colunas.length) { mensagem.erro('Escolha a fonte e ao menos uma coluna.'); return; }
    if (agrupar.length && !ordem.length) { mensagem.erro('Para realizar o agrupamento do relatório é necessário que preencha a ordenação.'); return; }
    setOcupado(true);
    try { setPrevia(await executar({ fonte, definicao, filtros: [] })); }
    catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  }, [fonte, colunas.length, agrupar.length, ordem.length, definicao, mensagem]);

  const gravar = async () => {
    if (!nome.trim()) { mensagem.erro('Informe o nome do relatório.'); return; }
    if (agrupar.length && !ordem.length) { mensagem.erro('Para realizar o agrupamento do relatório é necessário que preencha a ordenação.'); return; }
    setOcupado(true);
    try {
      const r = await salvarRelatorio({ codrelatoriodef: codNum, nome: nome.trim(), fonte, definicao });
      mensagem.sucesso('Relatório gravado.');
      if (codNum == null) navigate(`/relatorios/construtor/${r.codrelatoriodef}/editar`, { replace: true });
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const excluir = async () => {
    if (codNum == null) return;
    if (!window.confirm(`Excluir o relatório "${nome}"? Quem o usa deixa de encontrá-lo.`)) return;
    setOcupado(true);
    try { await removerRelatorio(codNum); mensagem.sucesso('Relatório excluído.'); navigate('/relatorios/construtor'); }
    catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const opcoesCampo = campos.map((c) => ({ value: c.campo, label: `${c.campo} · ${c.tipo}` }));
  const numericos = campos.filter((c) => c.tipo === 'numero').map((c) => ({ value: c.campo, label: c.campo }));

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title={codNum == null ? 'Novo relatório' : `Editar “${nome}”`} />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
          <Field label="&Nome do relatório" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Como aparece na lista" />
          <SelectField label="&Fonte dos dados" options={fontes.map((f) => ({ value: f.fonte, label: f.rotulo }))}
            value={fonte || undefined} onChange={trocarFonte} placeholder="Selecione a fonte…" />
          <Field label="&Título impresso" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="igual ao nome" />
        </div>
        <label className="mt-form-gap flex items-center gap-gp-sm text-body-sm">
          <input type="checkbox" checked={paisagem} onChange={(e) => setPaisagem(e.target.checked)} />
          Imprimir em paisagem
        </label>
      </section>

      {fonte && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <h2 className="mb-form-gap text-body-md">Colunas</h2>
          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-72"><SelectField label="&Campo" options={opcoesCampo} value={aAdicionar} onChange={(v) => setAAdicionar(v ?? '')} /></div>
            <Button label="&Adicionar" variant="soft" onClick={addCampo} />
          </div>

          <div className="mt-form-gap flex flex-wrap items-end gap-gp-sm border-t border-border pt-form-gap">
            <div className="w-48"><SelectField label="Coluna &calculada" options={numericos} value={calc.campo1} onChange={(v) => setCalc({ ...calc, campo1: v ?? '' })} placeholder="campo…" /></div>
            <div className="w-20"><SelectField label="" options={OPERACOES} value={calc.operacao} onChange={(v) => setCalc({ ...calc, operacao: v ?? '+' })} /></div>
            <div className="w-48"><SelectField label="" options={numericos} value={calc.campo2} onChange={(v) => setCalc({ ...calc, campo2: v ?? '' })} placeholder="campo…" /></div>
            <div className="w-48"><Field label="Título" value={calc.titulo} onChange={(e) => setCalc({ ...calc, titulo: e.target.value })} /></div>
            <Button label="Adicionar &conta" variant="soft" onClick={addCalculada} />
          </div>

          {colunas.length === 0
            ? <p className="mt-form-gap text-body-sm text-fg-muted">Nenhuma coluna ainda. Escolha um campo e adicione — a ordem aqui é a ordem impressa.</p>
            : (
              <div className="mt-form-gap flex flex-col gap-gp-sm">
                {colunas.map((c, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-gp-sm border-b border-border-subtle pb-gp-sm">
                    <span className="w-56 font-mono text-body-sm text-fg-muted">{i + 1}. {rotuloColuna(c)}</span>
                    <div className="w-48"><Field label={i === 0 ? 'Título' : ''} value={c.titulo ?? ''} onChange={(e) => patchColuna(i, { titulo: e.target.value })} /></div>
                    <div className="w-24"><Field label={i === 0 ? 'Largura' : ''} value={String(c.largura ?? '')} onChange={(e) => patchColuna(i, { largura: Number(e.target.value.replace(/\D/g, '')) || undefined })} /></div>
                    <div className="w-32"><SelectField label={i === 0 ? 'Formato' : ''} options={FORMATOS} value={c.formato ?? 'texto'} onChange={(v) => patchColuna(i, { formato: (v ?? 'texto') as Coluna['formato'] })} /></div>
                    <label className="flex items-center gap-1 pb-2 text-body-sm">
                      <input type="checkbox" checked={!!c.totalizar} onChange={(e) => patchColuna(i, { totalizar: e.target.checked })} /> totaliza
                    </label>
                    <Button label="↑" variant="soft" onClick={() => mover(i, -1)} />
                    <Button label="↓" variant="soft" onClick={() => mover(i, 1)} />
                    <Button label="Remover" variant="soft" onClick={() => remover(i)} />
                  </div>
                ))}
              </div>
            )}
        </section>
      )}

      {fonte && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <h2 className="mb-form-gap text-body-md">Ordenação e agrupamento</h2>
          <p className="mb-form-gap text-body-sm text-fg-muted">O grupo abre a cada troca de valor, na ordem das linhas — por isso o legado exige a ordenação para agrupar, e o normal é o primeiro campo da ordenação ser o do grupo.</p>
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
            <div>
              <div className="flex items-end gap-gp-sm">
                <div className="w-64"><SelectField label="&Ordenar por" options={opcoesCampo} value={aOrdenar || undefined} onChange={(v) => setAOrdenar(v ?? '')} placeholder="campo…" /></div>
                <Button label="Adicionar" variant="soft" disabled={!aOrdenar} onClick={() => { if (aOrdenar && !ordem.includes(aOrdenar)) setOrdem((o) => [...o, aOrdenar]); }} />
              </div>
              {ordem.map((o, i) => (
                <div key={o} className="mt-gp-sm flex items-center gap-gp-sm text-body-sm">
                  <span className="w-56 font-mono">{i + 1}. {o}</span>
                  <Button label="↑" variant="soft" onClick={() => setOrdem((os) => { if (i === 0) return os; const n = [...os]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })} />
                  <Button label="Remover" variant="soft" onClick={() => setOrdem((os) => os.filter((x) => x !== o))} />
                </div>
              ))}
            </div>
            <div>
              <div className="flex items-end gap-gp-sm">
                <div className="w-64"><SelectField label="A&grupar por" options={opcoesCampo} value={aAgrupar || undefined} onChange={(v) => setAAgrupar(v ?? '')} placeholder="campo…" /></div>
                <Button label="Adicionar" variant="soft" disabled={!aAgrupar} onClick={() => { if (aAgrupar && !agrupar.includes(aAgrupar)) setAgrupar((g) => [...g, aAgrupar]); }} />
              </div>
              {agrupar.map((g, i) => (
                <div key={g} className="mt-gp-sm flex items-center gap-gp-sm text-body-sm">
                  <span className="w-56 font-mono">{i + 1}. {g}</span>
                  <Button label="Remover" variant="soft" onClick={() => setAgrupar((gs) => gs.filter((x) => x !== g))} />
                </div>
              ))}
              {agrupar.length > 0 && (
                <div className="mt-form-gap flex flex-col gap-gp-sm text-body-sm">
                  <label className="flex items-center gap-gp-sm"><input type="checkbox" checked={somenteAgrupamento} onChange={(e) => setSomenteAgrupamento(e.target.checked)} /> Mostrar somente o agrupamento (uma linha por grupo, com os totais)</label>
                  <label className="flex items-center gap-gp-sm"><input type="checkbox" checked={quebraPagina} onChange={(e) => setQuebraPagina(e.target.checked)} /> Saltar página a cada grupo (na impressão)</label>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {fonte && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <h2 className="mb-form-gap text-body-md">Condições</h2>
          <p className="mb-form-gap text-body-sm text-fg-muted">Valem sempre que o relatório roda. O usuário ainda pode somar filtros na hora de gerar.</p>
          {condicoes.map((c, i) => (
            <div key={i} className="mb-gp-sm flex flex-wrap items-end gap-gp-sm">
              <div className="w-56"><SelectField label={i === 0 ? 'Campo' : ''} options={opcoesCampo} value={c.campo} onChange={(v) => setCondicoes((cs) => cs.map((x, k) => (k === i ? { ...x, campo: v ?? '' } : x)))} /></div>
              <div className="w-44"><SelectField label={i === 0 ? 'Condição' : ''} options={OPERADORES} value={c.operador} onChange={(v) => setCondicoes((cs) => cs.map((x, k) => (k === i ? { ...x, operador: (v ?? '=') as Condicao['operador'], valor: v === 'entre' ? ['', ''] : '' } : x)))} /></div>
              {c.operador === 'entre' ? (
                <>
                  {[0, 1].map((k) => (
                    <div key={k} className="w-40"><Field label={i === 0 ? (k === 0 ? 'De' : 'Até') : ''} value={String((Array.isArray(c.valor) ? c.valor : [])[k] ?? '')}
                      onChange={(e) => setCondicoes((cs) => cs.map((x, j) => { if (j !== i) return x; const v = Array.isArray(x.valor) ? [...x.valor] : ['', '']; v[k] = e.target.value; return { ...x, valor: v }; }))} /></div>
                  ))}
                </>
              ) : !['vazio', 'preenchido'].includes(String(c.operador)) && (
                <div className="w-48"><Field label={i === 0 ? 'Valor' : ''} value={String(c.valor ?? '')} onChange={(e) => setCondicoes((cs) => cs.map((x, k) => (k === i ? { ...x, valor: e.target.value } : x)))} /></div>
              )}
              <Button label="Remover" variant="soft" onClick={() => setCondicoes((cs) => cs.filter((_, k) => k !== i))} />
            </div>
          ))}
          <Button label="+ Con&dição" variant="soft" disabled={!campos.length}
            onClick={() => setCondicoes((cs) => [...cs, { campo: campos[0]?.campo ?? '', operador: '=', valor: '' }])} />
        </section>
      )}

      <div className="flex flex-wrap gap-gp-sm">
        <Button label="&Prévia" variant="soft" disabled={ocupado || !colunas.length} onClick={() => void verPrevia()} />
        <Button label="&Gravar" disabled={ocupado || !nome.trim() || !colunas.length} onClick={() => void gravar()} />
        {codNum != null && <Button label="E&xcluir" variant="soft" disabled={ocupado || !pode('BTNEXCLUIMODELO')} onClick={() => void excluir()} />}
        <Button label="Voltar" variant="soft" onClick={() => navigate('/relatorios/construtor')} />
      </div>

      {previa && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <h2 className="mb-form-gap text-body-md">Prévia — {previa.linhas.length.toLocaleString('pt-BR')} linha(s){previa.truncado && ' (parcial)'}</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body-sm">
              <thead>
                <tr>{previa.colunas.map((c) => <th key={c.chave} className="border-b border-border px-2 py-1 text-left">{c.titulo}</th>)}</tr>
              </thead>
              <tbody>
                {previa.linhas.slice(0, 20).map((l, i) => (
                  <tr key={i}>{previa.colunas.map((c) => <td key={c.chave} className="border-b border-border-subtle px-2 py-1">{String(l[c.chave] ?? '')}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {previa.linhas.length > 20 && <p className="mt-form-gap text-body-sm text-fg-muted">Mostrando as 20 primeiras. Grave e gere o relatório para ver tudo.</p>}
        </section>
      )}
    </div>
  );
}
