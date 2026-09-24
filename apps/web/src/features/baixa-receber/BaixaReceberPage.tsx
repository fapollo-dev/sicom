import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { DateField } from '../../shared/ui/DateField';
import { SelectField } from '../../shared/ui/SelectField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import {
  contasBaixaReceber, gravarBaixaReceber, iniciarBaixaReceber, manutencaoBaixaReceber, padroesBaixaReceber, titulosBaixaReceber,
  type ContaReceber, type FiltroReceber, type FormaCartao, type PadroesReceber, type TituloReceber,
} from './baixaReceberApi';

/**
 * BAIXA DE CONTAS A RECEBER (`FRMBAIXAARECEBER`, `UBaixaAreceber.pas`; `uBaixaAreceber-spec.md`). "Iniciar baixa" aloca o lote;
 * a pesquisa traz os títulos abertos (vencidos em vermelho). Na grade, % e R$ de acréscimo/desconto por documento (o desconto
 * do cliente por prazo já entra); o acréscimo/desconto global é rateado pelo valor e pede a senha de desconto. Os recursos saem
 * de contas correntes: DINHEIRO (caixa ou banco), DOC, TRANSFERÊNCIA, DÉBITO, ANTECIPAÇÃO e CARTAO (a forma escolhida). O
 * excesso do recurso vira acréscimo. Desconto no lote pede o login de um liberador quando a config exige.
 */
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');
const r2 = (n: number) => Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;
const num = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(/\./g, '').replace(',', '.')));
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

interface DocGrade extends TituloReceber { percentual: number; acreDescValor: number }
interface Recurso { tipo: number; codconta: number; valor: number; historico: string; idpgto?: number }

export function BaixaReceberPage() {
  const mensagem = useMensagem();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [padroes, setPadroes] = useState<PadroesReceber | null>(null);
  const [contas, setContas] = useState<ContaReceber[]>([]);
  const [formasCartao, setFormasCartao] = useState<FormaCartao[]>([]);
  const [lote, setLote] = useState<number | null>(null);
  const [loteManutencao, setLoteManutencao] = useState<number | null>(null);
  const [filtro, setFiltro] = useState<FiltroReceber>({});
  const [pesquisa, setPesquisa] = useState<TituloReceber[] | null>(null);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [docs, setDocs] = useState<DocGrade[]>([]);
  const [dtpgto, setDtpgto] = useState(hoje());
  const [global, setGlobal] = useState({ valor: '', senha: '' });
  const [cc, setCc] = useState({ juros: '', acrescimo: '', desconto: '' });
  const [recursos, setRecursos] = useState<Recurso[]>([]);
  const [novo, setNovo] = useState<{ tipo: string; codconta: string; valor: string; historico: string; idpgto: string } | null>(null);
  const [dtvencSaldo, setDtvencSaldo] = useState(hoje());
  const [liberacao, setLiberacao] = useState<{ login: string; senha: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const executar = async (fn: () => Promise<void>) => {
    setOcupado(true);
    try { await fn(); } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  useEffect(() => {
    void executar(async () => {
      const [p, c] = await Promise.all([padroesBaixaReceber(), contasBaixaReceber()]);
      setPadroes(p);
      setContas(c.contas);
      setFormasCartao(c.formasCartao);
      setCc({ juros: p.ccJuros ? String(p.ccJuros) : '', acrescimo: p.ccAcrescimo ? String(p.ccAcrescimo) : '', desconto: p.ccDesconto ? String(p.ccDesconto) : '' });
      const m = Number(params.get('manutencao') ?? 0);
      if (m > 0) {
        const r = await manutencaoBaixaReceber(m);
        setLoteManutencao(r.loteAntigo);
        setDtpgto(r.dtpgto || hoje());
        setDocs(r.documentos.map((d) => ({ ...d, desconto_cliente: 0, percentual: 0, acreDescValor: d.acre_desc ?? 0 })));
        setLote((await iniciarBaixaReceber()).idlote);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // `dbGridDadosColExit` (:2340-2436): % × valor + R$ − desconto do cliente + o rateio do global (resíduo no último)
  const globalN = r2(num(global.valor) ?? 0);
  const totalValor = r2(docs.reduce((s, d) => s + d.valor, 0));
  const acreDoc = useMemo(() => {
    let rateado = 0;
    return docs.map((d, i) => {
      const parte = globalN === 0 ? 0 : i === docs.length - 1 ? r2(globalN - rateado) : r2((globalN * d.valor) / (totalValor || 1));
      rateado = r2(rateado + parte);
      return r2((d.percentual * d.valor) / 100 + d.acreDescValor - d.desconto_cliente + parte);
    });
  }, [docs, globalN, totalValor]);
  const totalDocs = r2(docs.reduce((s, d, i) => s + d.valor + acreDoc[i], 0));
  const totalRecursos = r2(recursos.reduce((s, r) => s + r.valor, 0));
  const restante = r2(totalDocs - totalRecursos);

  const iniciar = () => executar(async () => {
    setLote((await iniciarBaixaReceber()).idlote);
    setLoteManutencao(null);
    setDocs([]);
    setRecursos([]);
    setNovo(null);
    setGlobal({ valor: '', senha: '' });
    setLiberacao(null);
    setDtpgto(hoje());
    setPesquisa(await titulosBaixaReceber({ ...filtro, dtpgto: hoje() }));
    setMarcados(new Set());
  });
  const pesquisar = () => executar(async () => {
    setPesquisa(await titulosBaixaReceber({ ...filtro, dtpgto }));
    setMarcados(new Set());
  });
  const alternar = (id: number) => setMarcados((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const adicionar = () => {
    if (recursos.length) { mensagem.erro(new Error('Exclua os recursos antes de adicionar um documento.')); return; }
    const ja = new Set(docs.map((d) => d.codrcb));
    setDocs([...docs, ...(pesquisa ?? []).filter((t) => marcados.has(t.codrcb) && !ja.has(t.codrcb)).map((t) => ({ ...t, percentual: 0, acreDescValor: 0 }))]);
    setMarcados(new Set());
  };
  const excluirDoc = (codrcb: number) => {
    if (recursos.length) { mensagem.erro(new Error('Exclua os recursos antes de excluir um documento.')); return; }
    if (!window.confirm('Deseja realmente excluir este documento?')) return;
    setDocs(docs.filter((d) => d.codrcb !== codrcb));
  };
  const mudarDoc = (codrcb: number, p: Partial<DocGrade>) => setDocs(docs.map((d) => (d.codrcb === codrcb ? { ...d, ...p } : d)));

  const abrirRecurso = () => {
    if (!docs.length) { mensagem.erro(new Error('Nenhum documento foi selecionado ainda.')); return; }
    if (restante <= 0) { mensagem.erro(new Error('Total de recursos ja informado!')); return; }
    setNovo({ tipo: '0', codconta: '', valor: String(restante).replace('.', ','), historico: `BAIXA DO LOTE ${lote ?? ''}`, idpgto: '' });
  };
  const salvarRecurso = () => {
    if (!novo) return;
    let valor = num(novo.valor) ?? 0;
    const tipo = Number(novo.tipo);
    const conta = contas.find((c) => c.codconta === Number(novo.codconta));
    const t = padroes?.recursos.find((x) => x.tipo === tipo);
    if (!(valor > 0)) { mensagem.erro(new Error('Valor deve ser maior que zero!')); return; }
    if (!conta) { mensagem.erro(new Error('É obrigatório informar a conta corrente.')); return; }
    if (!novo.historico.trim()) { mensagem.erro(new Error('É obrigatório informar o histórico da baixa.')); return; }
    if (conta.caixa && t && !t.caixa) { mensagem.erro(new Error('Esta conta corrente é conta caixa, não permite operações bancárias!')); return; }
    if (conta.cbo_baixa_cr !== 'S') { mensagem.erro(new Error('O operador não possui permissão para baixar contas a receber nesta conta corrente.')); return; }
    if (valor > restante) {
      // `edtVlrBaixaExit` (:804-837): sem troco, o excesso vira acréscimo global — que pede a senha de desconto
      const excesso = r2(valor - restante);
      if (!window.confirm(`O valor passa do restante em ${moeda(excesso)}. O excesso vira acréscimo (pede a senha de desconto). Continuar?`)) return;
      setGlobal({ ...global, valor: String(r2(globalN + excesso)).replace('.', ',') });
      valor = r2(valor);
    }
    setRecursos([...recursos, { tipo, codconta: conta.codconta, valor: r2(valor), historico: novo.historico, idpgto: tipo === 7 && novo.idpgto ? Number(novo.idpgto) : undefined }]);
    setNovo(null);
  };

  const gravar = () => executar(async () => {
    if (!lote) return;
    if (!docs.length) { mensagem.erro(new Error('Nenhum documento foi selecionado para realizar a baixa.')); return; }
    if (novo) { mensagem.erro(new Error('Salve ou cancele o recurso antes de gravar a baixa.')); return; }
    if (!recursos.length) { mensagem.erro(new Error('Não foi informado nenhum recurso, não é possivel continuar!')); return; }
    if (globalN !== 0 && !global.senha) { mensagem.erro(new Error('Informe a senha de desconto para o acréscimo/desconto geral.')); return; }
    let parcial: { dtvenc: string } | undefined;
    if (restante > 0) {
      if (!window.confirm('Total de recursos não confere com o total dos documentos. Deseja gerar uma baixa parcial?')) return;
      if (new Set(docs.map((d) => d.codparceiro)).size > 1) {
        mensagem.erro(new Error('A baixa parcial de documentos só pode ser gerada para duplicatas do mesmo cliente!'));
        return;
      }
      parcial = { dtvenc: dtvencSaldo };
    }
    try {
      const r = await gravarBaixaReceber({
        idlote: lote, dtpgto,
        documentos: docs.map((d) => ({ codrcb: d.codrcb, percentual: d.percentual || undefined, acreDescValor: d.acreDescValor || undefined })),
        recursos: recursos.map((x) => ({ tipo: x.tipo, codconta: x.codconta, valor: x.valor, historico: x.historico, idpgto: x.idpgto })),
        acreDescGlobal: globalN || undefined, senhaDesconto: global.senha || undefined,
        liberacaoDesconto: liberacao && liberacao.login ? liberacao : undefined,
        ccJuros: num(cc.juros), ccAcrescimo: num(cc.acrescimo), ccDesconto: num(cc.desconto),
        parcial, loteManutencao: loteManutencao ?? undefined,
      });
      mensagem.sucesso(`Documentos baixados com sucesso. Lote ${r.idlote}${r.codrcbSaldo ? ` — saldo no título ${r.codrcbSaldo}` : ''}.`);
      setLote(null);
      setLoteManutencao(null);
      setDocs([]);
      setRecursos([]);
      setPesquisa(null);
      setGlobal({ valor: '', senha: '' });
      setLiberacao(null);
      if (params.get('manutencao')) navigate('/cobranca/baixa-receber', { replace: true });
    } catch (e) {
      // "Informe o login e senha de um usuário com permissão para liberar o desconto." — abre os campos do liberador
      const code = (e as { envelope?: { code?: string } }).envelope?.code;
      if (code === 'BAIXA_DESCONTO_LIBERACAO_REQUERIDA' && !liberacao) setLiberacao({ login: '', senha: '' });
      throw e;
    }
  });
  const cancelar = () => {
    setLote(null);
    setLoteManutencao(null);
    setDocs([]);
    setRecursos([]);
    setNovo(null);
    setPesquisa(null);
    setLiberacao(null);
  };

  const nomeConta = (c: ContaReceber) => `${c.nroconta ?? c.codconta} · ${c.titular ?? ''}${c.caixa ? ' (caixa)' : ''}`;
  const tipoSel = padroes?.recursos.find((x) => x.tipo === Number(novo?.tipo ?? 0));
  const contasDoTipo = contas.filter((c) => (c.caixa ? tipoSel?.caixa : tipoSel?.banco));

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Baixa de contas a receber" />

      <section className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        {!lote && <Button label="&Iniciar baixa" onClick={() => void iniciar()} disabled={ocupado} />}
        {lote && (
          <>
            <strong className="text-sm">Lote {lote}{loteManutencao ? ` · manutenção do lote ${loteManutencao}` : ''}</strong>
            <div className="w-44"><DateField label="&Data da baixa" value={dtpgto} onChange={(v) => setDtpgto(v ?? hoje())} /></div>
            <div className="flex-1" />
            <Button label="Cancelar" variant="ghost" onClick={cancelar} disabled={ocupado} />
            <Button label="&Gravar baixa" onClick={() => void gravar()} disabled={ocupado || !docs.length || !recursos.length} />
          </>
        )}
      </section>

      {lote && !loteManutencao && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <strong className="text-sm">Documentos a receber em aberto</strong>
          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-56"><Field label="Documento ou cliente" value={filtro.busca ?? ''} onChange={(e) => setFiltro({ ...filtro, busca: e.target.value })} /></div>
            <div className="w-36"><Field label="Cliente (código)" inputMode="numeric" value={filtro.codparceiro ?? ''} onChange={(e) => setFiltro({ ...filtro, codparceiro: e.target.value })} /></div>
            <div className="w-40"><DateField label="Vencimento de" value={filtro.vencDe ?? ''} onChange={(v) => setFiltro({ ...filtro, vencDe: v ?? '' })} /></div>
            <div className="w-40"><DateField label="até" value={filtro.vencAte ?? ''} onChange={(v) => setFiltro({ ...filtro, vencAte: v ?? '' })} /></div>
            {padroes && padroes.empresas.length > 1 && (
              <div className="w-44"><Field label="Empresas (códigos)" value={(filtro.empresas ?? []).join(',')} onChange={(e) => setFiltro({ ...filtro, empresas: e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => x > 0) })} /></div>
            )}
            <Button label="&Pesquisar" variant="soft" onClick={() => void pesquisar()} disabled={ocupado} />
            <Button label="&Adicionar marcados" variant="ghost" onClick={adicionar} disabled={ocupado || marcados.size === 0} />
          </div>
          {pesquisa && (pesquisa.length === 0
            ? <small className="text-fg-muted">Nenhum documento em aberto com esses filtros.</small>
            : (
              <div className="max-h-72 overflow-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-fg-muted">
                      <th className="px-2 py-1" /><th className="px-2 py-1">Documento</th><th className="px-2 py-1">Cliente</th><th className="px-2 py-1">Empresa</th>
                      <th className="px-2 py-1">Vencimento</th><th className="px-2 py-1 text-right">Valor</th><th className="px-2 py-1 text-right">Desconto do cliente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pesquisa.map((t) => (
                      <tr key={t.codrcb} className={`border-t border-border ${t.vencido ? 'text-danger' : ''}`}>
                        <td className="px-2 py-1"><CheckboxField label="Selecionar" value={marcados.has(t.codrcb) ? 'S' : 'N'} onChange={() => alternar(t.codrcb)} /></td>
                        <td className="px-2 py-1">{t.duplicata ?? ''}</td>
                        <td className="px-2 py-1">{t.codparceiro} · {t.cliente ?? ''}</td>
                        <td className="px-2 py-1 tabular-nums">{t.codempresa}</td>
                        <td className="px-2 py-1 tabular-nums">{dataBr(t.vencimento)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{moeda(t.valor)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{t.desconto_cliente ? moeda(t.desconto_cliente) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </section>
      )}

      {lote && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <strong className="text-sm">Documentos da baixa</strong>
          {docs.length === 0 ? <small className="text-fg-muted">Marque documentos na pesquisa e adicione.</small> : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-fg-muted">
                    <th className="px-2 py-1">Documento</th><th className="px-2 py-1">Cliente</th><th className="px-2 py-1 text-right">Valor</th>
                    <th className="px-2 py-1 text-right">% Acrés/Desc</th><th className="px-2 py-1 text-right">R$ Acrés/Desc</th><th className="px-2 py-1 text-right">Desc. cliente</th>
                    <th className="px-2 py-1 text-right">Total Acre/Desc</th><th className="px-2 py-1 text-right">Total a baixar</th>
                    <th className="px-2 py-1">Emissão</th><th className="px-2 py-1">Vencimento</th><th className="px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d, i) => (
                    <tr key={d.codrcb} className="border-t border-border">
                      <td className="px-2 py-1">{d.duplicata ?? ''}</td>
                      <td className="px-2 py-1">{d.cliente ?? ''}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{moeda(d.valor)}</td>
                      <td className="w-24 px-2 py-1">
                        <input aria-label={`Percentual de acréscimo ou desconto do documento ${d.duplicata ?? d.codrcb}`} className="w-full rounded border border-border bg-bg-surface px-1 text-right tabular-nums"
                          inputMode="decimal" disabled={recursos.length > 0} defaultValue={d.percentual ? String(d.percentual).replace('.', ',') : ''}
                          onBlur={(e) => mudarDoc(d.codrcb, { percentual: num(e.target.value) ?? 0 })} />
                      </td>
                      <td className="w-28 px-2 py-1">
                        <input aria-label={`Valor de acréscimo ou desconto do documento ${d.duplicata ?? d.codrcb}`} className="w-full rounded border border-border bg-bg-surface px-1 text-right tabular-nums"
                          inputMode="decimal" disabled={recursos.length > 0} defaultValue={d.acreDescValor ? String(d.acreDescValor).replace('.', ',') : ''}
                          onBlur={(e) => mudarDoc(d.codrcb, { acreDescValor: r2(num(e.target.value) ?? 0) })} />
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{d.desconto_cliente ? moeda(d.desconto_cliente) : ''}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{moeda(acreDoc[i])}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{moeda(d.valor + acreDoc[i])}</td>
                      <td className="px-2 py-1 tabular-nums">{dataBr(d.emissao)}</td>
                      <td className="px-2 py-1 tabular-nums">{dataBr(d.vencimento)}</td>
                      <td className="px-2 py-1">{!loteManutencao && <Button label="Excluir" variant="ghost" onClick={() => excluirDoc(d.codrcb)} disabled={ocupado} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-gp-sm">
            <span className="text-sm">Total a baixar <strong className="tabular-nums">{moeda(totalDocs)}</strong></span>
            <div className="flex-1" />
            <div className="w-40"><Field label="Acréscimo/desconto geral" inputMode="decimal" value={global.valor} disabled={recursos.length > 0} onChange={(e) => setGlobal({ ...global, valor: e.target.value })} /></div>
            {globalN !== 0 && <div className="w-40"><Field label="Senha de desconto" type="password" value={global.senha} onChange={(e) => setGlobal({ ...global, senha: e.target.value })} /></div>}
          </div>
          <div className="grid grid-cols-1 gap-gp-sm sm:grid-cols-3">
            <Field label="CC de juros" inputMode="numeric" value={cc.juros} onChange={(e) => setCc({ ...cc, juros: e.target.value })} />
            <Field label="CC de acréscimos" inputMode="numeric" value={cc.acrescimo} onChange={(e) => setCc({ ...cc, acrescimo: e.target.value })} />
            <Field label="CC de descontos concedidos" inputMode="numeric" value={cc.desconto} onChange={(e) => setCc({ ...cc, desconto: e.target.value })} />
          </div>
          {liberacao && (
            <div className="flex flex-wrap items-end gap-gp-sm rounded-md border border-border p-3">
              <small className="w-full text-fg-muted">Informe o login e senha de um usuário com permissão para liberar o desconto.</small>
              <div className="w-40"><Field label="Login do liberador" value={liberacao.login} onChange={(e) => setLiberacao({ ...liberacao, login: e.target.value })} /></div>
              <div className="w-40"><Field label="Senha do liberador" type="password" value={liberacao.senha} onChange={(e) => setLiberacao({ ...liberacao, senha: e.target.value })} /></div>
            </div>
          )}
        </section>
      )}

      {lote && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="flex flex-wrap items-center gap-gp-sm">
            <strong className="text-sm">Recursos</strong>
            <span className="text-sm">Restante <strong className="tabular-nums">{moeda(Math.max(restante, 0))}</strong></span>
            <div className="flex-1" />
            {!novo && <Button label="Adicionar &recurso" variant="soft" onClick={abrirRecurso} disabled={ocupado} />}
          </div>
          {novo && (
            <div className="grid grid-cols-1 gap-gp-sm rounded-md border border-border p-3 sm:grid-cols-2 lg:grid-cols-4">
              <SelectField label="Tipo" value={novo.tipo} onChange={(v) => setNovo({ ...novo, tipo: v, codconta: '' })}
                options={(padroes?.recursos ?? []).map((t) => ({ value: String(t.tipo), label: t.rotulo }))} />
              <SelectField label="Conta corrente" value={novo.codconta} onChange={(v) => setNovo({ ...novo, codconta: v })} placeholder="(escolha a conta)"
                options={contasDoTipo.map((c) => ({ value: String(c.codconta), label: nomeConta(c) }))} />
              {novo.tipo === '7' && (
                <SelectField label="Forma do cartão" value={novo.idpgto} onChange={(v) => setNovo({ ...novo, idpgto: v })} placeholder="(a padrão de cartão)"
                  options={formasCartao.map((f) => ({ value: String(f.idpgto), label: f.modalidade }))} />
              )}
              <Field label="Valor" inputMode="decimal" value={novo.valor} onChange={(e) => setNovo({ ...novo, valor: e.target.value })} />
              <div className="sm:col-span-2 lg:col-span-4"><Field label="Histórico" value={novo.historico} onChange={(e) => setNovo({ ...novo, historico: e.target.value })} /></div>
              <div className="flex justify-end gap-gp-sm sm:col-span-2 lg:col-span-4">
                <Button label="Cancelar" variant="ghost" onClick={() => setNovo(null)} />
                <Button label="&Salvar recurso" onClick={salvarRecurso} />
              </div>
            </div>
          )}
          {recursos.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-fg-muted"><th className="px-2 py-1">Tipo</th><th className="px-2 py-1">Conta</th><th className="px-2 py-1">Histórico</th><th className="px-2 py-1 text-right">Valor</th><th className="px-2 py-1" /></tr></thead>
                <tbody>
                  {recursos.map((r, i) => {
                    const c = contas.find((x) => x.codconta === r.codconta);
                    return (
                      <tr key={i} className="border-t border-border">
                        <td className="px-2 py-1">{padroes?.recursos.find((t) => t.tipo === r.tipo)?.rotulo}{r.idpgto ? ` · ${formasCartao.find((f) => f.idpgto === r.idpgto)?.modalidade ?? ''}` : ''}</td>
                        <td className="px-2 py-1">{c ? nomeConta(c) : r.codconta}</td>
                        <td className="px-2 py-1">{r.historico}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{moeda(r.valor)}</td>
                        <td className="px-2 py-1"><Button label="Excluir" variant="ghost" onClick={() => setRecursos(recursos.filter((_, k) => k !== i))} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {restante > 0 && recursos.length > 0 && (
            <div className="flex flex-wrap items-end gap-gp-sm">
              <small className="text-fg-muted">Faltam {moeda(restante)}: ao gravar, a baixa parcial gera um título com o saldo.</small>
              <div className="w-44"><DateField label="Vencimento do saldo" value={dtvencSaldo} onChange={(v) => setDtvencSaldo(v ?? hoje())} /></div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
