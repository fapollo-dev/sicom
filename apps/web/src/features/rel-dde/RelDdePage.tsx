import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { gradeLayoutService } from '../../shared/grade/savedViewsService';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type Tipo = 'PADRAO' | 'RUPTURA';
interface Linha {
  idproduto: number; idempresa: number; codbarra: string; descricao: string;
  qtde_estoque: number; qtde_vendida: number; cobertura: number;
  fantasia: string | null; razaosocial: string | null;
  codfor?: number; fornecedor?: string; fatorembal?: number | null; vrcusto?: number | null; vrvenda?: number | null;
}
interface Secundario { idproduto: number; codfor_sec: number; fornecedor_secundario: string | null }
interface Resultado { tipo: Tipo; dias: number; empresas: number[]; linhas: Linha[]; secundarios: Secundario[] }

const SEM_VENDAS = -999999;
const nfmt = (v: unknown, d = 3) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: d });
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/** o `GetDisplayText` da coluna COBERTURA (URelDDEGrid.pas): −999999 é "Sem vendas" */
const cobertura = (v: unknown) => (Number(v) === SEM_VENDAS ? 'Sem vendas' : nfmt(v, 0));

/**
 * DIAS DE ESTOQUE / COBERTURA (`FRMRELDDE`). Dossiê: `uRelDDE.md`.
 *
 * **Com o que tenho na prateleira, quantos dias eu aguento?** Os dois tipos do legado: "Dias de estoque" (todos os produtos das lojas
 * escolhidas; sem o "só vendidos", também os parados — "Sem vendas") e "Dias de estoque (ruptura)" (o que cobre `≥ / = / ≤` N dias,
 * por fornecedor, com os fornecedores secundários).
 */
export function RelDdePage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    tipo: 'PADRAO' as Tipo, dias: '30', somenteVendidos: false, diasRuptura: '', sinal: '', niveis: '0',
    idproduto: '', coddpto: '', codgrupo: '', codsubgrupo: '', codsecao: '', codfor: '', empresas: '',
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const consulta = () => {
    const q = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v !== '' && v !== false) q.set(k, String(v).replace(/\s/g, '')); });
    // o "só vendidos" é do tipo padrão; a ruptura (sinal, dias, níveis) é do outro — o legado esconde o que não é do tipo
    if (f.tipo === 'RUPTURA') q.delete('somenteVendidos'); else { q.delete('diasRuptura'); q.delete('sinal'); q.delete('niveis'); }
    return q.toString();
  };
  const imprimir = () => { imprimirRelatorio(`/relatorios/dias-estoque/impressao?${consulta()}`).catch((e) => mensagem.erro(e)); };

  const gerar = async () => {
    setOcupado(true);
    try {
      const r = await fetch(`${BASE}/relatorios/dias-estoque?${consulta()}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  // os fornecedores secundários (o nível de detalhe da grade da ruptura), por produto
  const secundarios = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of res?.secundarios ?? []) {
      const t = `${s.codfor_sec}${s.fornecedor_secundario ? ` - ${s.fornecedor_secundario}` : ''}`;
      m.set(s.idproduto, m.has(s.idproduto) ? `${m.get(s.idproduto)}; ${t}` : t);
    }
    return m;
  }, [res]);

  const cols = useMemo<DataTableColumnDef<Linha>[]>(() => {
    const c: DataTableColumnDef<Linha>[] = [];
    if (res?.tipo === 'RUPTURA') {
      c.push({ field: 'fornecedor', headerName: 'Fornecedor', type: 'text', width: 220, valueGetter: (l) => `${l.codfor ?? ''} - ${l.fornecedor ?? ''}` });
    }
    c.push(
      { field: 'idproduto', headerName: 'Idproduto', type: 'text', width: 90, isPrimary: true },
      { field: 'codbarra', headerName: 'Codbarra', type: 'text', width: 140 },
      { field: 'descricao', headerName: 'Descricao', type: 'text' },
      { field: 'idempresa', headerName: 'Idempresa', type: 'text', width: 90 },
      { field: 'qtde_estoque', headerName: 'Qtde estoque', type: 'text', width: 120, valueGetter: (l) => nfmt(l.qtde_estoque) },
      { field: 'qtde_vendida', headerName: 'Qtde vendida', type: 'text', width: 120, valueGetter: (l) => nfmt(l.qtde_vendida) },
      { field: 'cobertura', headerName: 'Cobertura', type: 'text', width: 110, valueGetter: (l) => cobertura(l.cobertura) },
      { field: 'fantasia', headerName: 'Fantasia', type: 'text', width: 160 },
      { field: 'razaosocial', headerName: 'Razao social', type: 'text', width: 200 },
    );
    if (res?.tipo === 'RUPTURA') {
      c.push(
        { field: 'fatorembal', headerName: 'Fator embal.', type: 'text', width: 100, valueGetter: (l) => nfmt(l.fatorembal) },
        { field: 'vrcusto', headerName: 'Vrcusto', type: 'text', width: 110, valueGetter: (l) => moeda(l.vrcusto) },
        { field: 'vrvenda', headerName: 'Vrvenda', type: 'text', width: 110, valueGetter: (l) => moeda(l.vrvenda) },
        { field: 'codfor', headerName: 'Fornecedores secundários', type: 'text', width: 260, valueGetter: (l) => secundarios.get(l.idproduto) ?? '' },
      );
    }
    return c;
  }, [res, secundarios]);

  // o "Gerar cotação" da grade da ruptura (TFrmRelDDEGrid.GerarCotacao, a cotação convencional): "Cotação gerada: N"
  const gerarCotacao = async () => {
    if (!res || res.tipo !== 'RUPTURA') return;
    if (!res.linhas.length) { mensagem.erro(Object.assign(new Error('DDE_GRADE_VAZIA'), { envelope: { statusCode: 422, code: 'DDE_GRADE_VAZIA', message: 'Não existem produtos na grade.' } })); return; }
    if (!window.confirm('Gerar a cotação convencional com os produtos da grade?')) return;
    setOcupado(true);
    try {
      const corpo = Object.fromEntries(new URLSearchParams(consulta()));
      const r = await fetch(`${BASE}/relatorios/dias-estoque/cotacao`, { method: 'POST', headers: { ...apiHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      handle401(r);
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      mensagem.sucesso(`Cotação gerada: ${(b as { codctc: number }).codctc}`);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const exportar = () => {
    if (!res) return;
    // o "Exportar para Excel" da grade (`Dias de estoque.xlsx` / `Dias para ruptura de estoque.xlsx`)
    exportarGradeCsv(res.linhas, [
      ...(res.tipo === 'RUPTURA' ? [{ titulo: 'Codfor', valor: (l: Linha) => l.codfor ?? '' }, { titulo: 'Fornecedor', valor: (l: Linha) => l.fornecedor ?? '' }] : []),
      { titulo: 'Idproduto', valor: (l) => l.idproduto },
      { titulo: 'Codbarra', valor: (l) => l.codbarra },
      { titulo: 'Descricao', valor: (l) => l.descricao },
      { titulo: 'Idempresa', valor: (l) => l.idempresa },
      { titulo: 'Qtde estoque', valor: (l) => l.qtde_estoque },
      { titulo: 'Qtde vendida', valor: (l) => l.qtde_vendida },
      { titulo: 'Cobertura', valor: (l) => cobertura(l.cobertura) },
      { titulo: 'Fantasia', valor: (l) => l.fantasia ?? '' },
      { titulo: 'Razao social', valor: (l) => l.razaosocial ?? '' },
      ...(res.tipo === 'RUPTURA' ? [
        { titulo: 'Fator embal.', valor: (l: Linha) => l.fatorembal ?? '' },
        { titulo: 'Vrcusto', valor: (l: Linha) => l.vrcusto ?? '' },
        { titulo: 'Vrvenda', valor: (l: Linha) => l.vrvenda ?? '' },
      ] : []),
    ], res.tipo === 'RUPTURA' ? 'dias-para-ruptura-de-estoque' : 'dias-de-estoque');
  };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Dias de estoque (cobertura)" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Tipo do relatório
            <select className="rounded border border-border px-1 py-1" value={f.tipo}
              onChange={(e) => { setF({ ...f, tipo: e.target.value as Tipo, somenteVendidos: false, diasRuptura: '', sinal: '', niveis: '0' }); setRes(null); }}>
              <option value="PADRAO">Dias de estoque</option>
              <option value="RUPTURA">Dias de estoque (ruptura)</option>
            </select>
          </label>
          {f.tipo === 'RUPTURA' && (
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Níveis expandidos
              <select className="rounded border border-border px-1 py-1" value={f.niveis} onChange={(e) => setF({ ...f, niveis: e.target.value })}>
                <option value="0"></option>
                <option value="1">1 nível</option>
                <option value="2">2 níveis</option>
              </select>
            </label>
          )}
          <div className="w-52"><Field label="Dias para o cálculo da cobertura" value={f.dias} onChange={(e) => setF({ ...f, dias: e.target.value })} /></div>
          {f.tipo === 'RUPTURA' && (
            <>
              <label className="flex flex-col gap-gp-xs text-body-sm">
                Condição de ruptura
                <select className="rounded border border-border px-1 py-1" value={f.sinal} onChange={(e) => setF({ ...f, sinal: e.target.value })}>
                  <option value=""></option>
                  <option value="MAIOR_IGUAL">Maior ou igual</option>
                  <option value="IGUAL">Igual a</option>
                  <option value="MENOR_IGUAL">Menor ou igual</option>
                </select>
              </label>
              <div className="w-36"><Field label="Dias para a r&uptura" value={f.diasRuptura} onChange={(e) => setF({ ...f, diasRuptura: e.target.value })} /></div>
            </>
          )}
          <div className="w-32"><Field label="&Empresas (1,2)" value={f.empresas} onChange={(e) => setF({ ...f, empresas: e.target.value })} placeholder="esta loja" /></div>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="&Imprimir" variant="soft" disabled={ocupado} onClick={imprimir} />
          <Button label="E&xportar" variant="soft" disabled={!res} onClick={exportar} />
          {res?.tipo === 'RUPTURA' && <Button label="Gerar &cotação" variant="soft" disabled={ocupado} onClick={() => void gerarCotacao()} />}
        </div>
        <div className="mt-form-gap flex flex-wrap items-end gap-gp-sm">
          <div className="w-32"><Field label="Departamento" value={f.coddpto} onChange={(e) => setF({ ...f, coddpto: e.target.value })} /></div>
          <div className="w-32"><Field label="Grupo" value={f.codgrupo} onChange={(e) => setF({ ...f, codgrupo: e.target.value })} /></div>
          <div className="w-32"><Field label="Subgrupo" value={f.codsubgrupo} onChange={(e) => setF({ ...f, codsubgrupo: e.target.value })} /></div>
          <div className="w-32"><Field label="Seção" value={f.codsecao} onChange={(e) => setF({ ...f, codsecao: e.target.value })} /></div>
          <div className="w-32"><Field label="Produto" value={f.idproduto} onChange={(e) => setF({ ...f, idproduto: e.target.value })} /></div>
          <div className="w-32"><Field label="Fornecedor" value={f.codfor} onChange={(e) => setF({ ...f, codfor: e.target.value })} /></div>
        </div>
        {f.tipo === 'PADRAO' && (
          <label className="mt-form-gap flex items-center gap-gp-sm text-body-sm">
            <input type="checkbox" checked={f.somenteVendidos} onChange={(e) => setF({ ...f, somenteVendidos: e.target.checked })} />
            Exibir somente produtos vendidos no período
          </label>
        )}
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-center gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Registros</div><div className="text-body-lg tabular-nums">{res.linhas.length}</div></div>
              <div><div className="text-body-sm text-fg-muted">Sem vendas</div><div className="text-body-lg tabular-nums">{res.linhas.filter((l) => Number(l.cobertura) === SEM_VENDAS).length}</div></div>
              <div><div className="text-body-sm text-fg-muted">Lojas</div><div className="text-body-lg tabular-nums">{res.empresas.join(', ')}</div></div>
            </div>
          </section>
          <DataTable persistId={res.tipo === 'RUPTURA' ? 'rel-dde-ruptura' : 'rel-dde'} savedViewsService={gradeLayoutService}
            rows={res.linhas} columns={cols} getRowId={(l: Linha) => `${l.idempresa}-${l.idproduto}`} />
        </>
      )}
    </div>
  );
}
