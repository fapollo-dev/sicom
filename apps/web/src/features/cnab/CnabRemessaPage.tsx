import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { LookupField } from '../../shared/ui/LookupField';
import { Pesquisa } from '../../shared/cadmaster/Pesquisa';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
  handle401(res);
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(b) ? b : { statusCode: res.status, code: 'ERRO', message: (b as any)?.message ?? res.statusText };
    throw Object.assign(new Error(env.code ?? res.statusText), { envelope: env, status: res.status, body: b });
  }
  return (await res.json()) as T;
}

const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const brl = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
type Linha = Record<string, unknown>;

/** a conta do boleto como o servidor resolve (edtNroContaExit: SegContas + ConsultaNumeroBanco + ConsultaIntegBancaria) */
interface ContaBoleto {
  conta: { codconta: number; nroconta: string; titular: string; agencia: string; codbco: number; banco?: string } | null;
  febraban: string | null; emiteBoleto: boolean; conf: { codconf: number; layoutremessa?: string | null } | null; geraRemessa: string; aviso: string | null;
}

/** «Imprimir» no título da coluna (dbgDadosTitleClick): inverte a marca de todos, menos os cancelados ('C') */
export function inverterMarcas(linhas: Linha[], sel: Set<number>): Set<number> {
  const n = new Set(sel);
  for (const l of linhas) {
    if (String(l.registro_arq_remessa ?? '') === 'C') continue;
    const id = Number(l.codrcb);
    if (n.has(id)) n.delete(id); else n.add(id);
  }
  return n;
}

/** a marca inicial do "Importar títulos" (:1983-1992): marcado, menos o que já foi para o banco ('S') */
export function marcasIniciais(linhas: Linha[]): Set<number> {
  return new Set(linhas.filter((l) => String(l.registro_arq_remessa ?? '') !== 'S').map((l) => Number(l.codrcb)));
}

/** ValidaEnderecos (:1805): o primeiro título com endereço incompleto trava Boleto/Cancelar/Remessa */
export function enderecoIncompleto(linhas: Linha[]): Linha | undefined {
  return linhas.find((l) => !l.endereco || !l.bairro || !l.cidade || !l.cep || !l.uf);
}

/**
 * BOLETO / REMESSA (FRMCONFBOLETO, uConfBoleto). O fluxo do legado: a CONTA (a CONTA_PADRAO_BOLETO já vem escolhida; o banco dela diz se
 * emite boleto e a configuração de integração sai sozinha) → «Importar títulos» (a Pesquisa da GET_ARECEBER, em multisseleção) → «Boleto»
 * (carimba o nosso número e, com "Impressão", imprime no BoletoFR.fr3; depois o GERA_REMESSA_AUTOMATICAMENTE: S gera a remessa, P pergunta)
 * → «Remessa» (emissão, cancelamento, alteração de vencimento). Sem conta, só a duplicata («Imprimir», dup_Duplicata001_1.fr3).
 */
export function CnabRemessaPage() {
  const mensagem = useMensagem();
  const [conta, setConta] = useState<ContaBoleto | null>(null);
  const [codconta, setCodconta] = useState<string | undefined>();
  const codconf = conta?.conf?.codconf != null ? String(conta.conf.codconf) : '';
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [remessas, setRemessas] = useState<Linha[]>([]);
  const [boletos, setBoletos] = useState<Linha[] | null>(null);
  const [impresso, setImpresso] = useState(true); // o chkImpresso do legado (marcado por padrão)
  const [instrucoes, setInstrucoes] = useState<Record<number, string[]>>({});
  const [importando, setImportando] = useState(false);
  const [opcoes, setOpcoes] = useState(false);
  const [menuRemessa, setMenuRemessa] = useState(false);
  const [retorno, setRetorno] = useState<{ banco: number; data_baixa: string | null; totais: Record<string, number>; propostas: Linha[] } | null>(null);
  const [busy, setBusy] = useState(false);

  // a conta: ao abrir, a CONTA_PADRAO_BOLETO (FormCreate :893); ao trocar, a do campo (edtNroContaExit)
  const carregarConta = useCallback(async (cod?: string) => {
    try {
      const c = await post<ContaBoleto>('/cobranca/cnab/conta', cod ? { codconta: Number(cod) } : {});
      setConta(c);
      if (!cod && c.conta) setCodconta(String(c.conta.codconta));
      if (c.aviso) mensagem.erro(new Error(c.aviso));
    } catch (e) { setConta(null); mensagem.erro(e); }
  }, [mensagem]);
  useEffect(() => { void carregarConta(); }, [carregarConta]);
  const trocarConta = (cod?: string) => {
    setCodconta(cod);
    if (cod) void carregarConta(cod);
    else setConta((c) => (c ? { ...c, conta: null, febraban: null, emiteBoleto: false, conf: null, aviso: null } : c));
  };
  const temConta = !!conta?.conta;
  const emiteBoleto = temConta && !!conta?.emiteBoleto;

  /** os marcados na Pesquisa vão para a grade (FiltrarRegistros) com a marca inicial e a checagem dos endereços */
  const importar = async (ls: Linha[]) => {
    setImportando(false);
    const codrcbs = ls.map((l) => Number(l.codigo)).filter((n) => n > 0);
    if (!codrcbs.length) return;
    try {
      const r = await post<{ linhas: Linha[] }>('/cobranca/cnab/titulos', { codrcbs });
      setLinhas(r.linhas); setSel(marcasIniciais(r.linhas)); setInstrucoes({});
      const inc = enderecoIncompleto(r.linhas);
      if (inc) mensagem.erro(new Error(`Endereço da conta "${String(inc.codrcb)}" está incompleto. Verifique o cadastro do cliente: ${String(inc.codparceiro)}`));
    } catch (e) { mensagem.erro(e); }
  };
  const travadoPorEndereco = !!enderecoIncompleto(linhas);

  const marcar = (codrcb: number) => {
    const s = new Set(sel);
    if (s.has(codrcb)) s.delete(codrcb); else s.add(codrcb);
    setSel(s);
  };

  const corpoBoleto = (codrcbs: number[]) => ({ codconf: Number(codconf), codconta: Number(codconta), codrcbs });
  const semImportar = () => { if (!linhas.length) { mensagem.erro(new Error('Por favor, importe os títulos antes de realizar alguma ação.')); return true; } return false; };

  /** «Boleto» (btnBoletoClick :3143): emite; depois, o GERA_REMESSA_AUTOMATICAMENTE (S gera, P pergunta, N não) */
  const emitir = async () => {
    if (semImportar()) return;
    if (!impresso) return mensagem.erro(new Error('Obrigatório selecionar tipo de geração do boleto: IMPRESSO, E-MAIL ou PDF. Verifique por favor!'));
    // o filtro do taEmitirBoleto (:2610): marcado, sem arquivo de remessa (ou cancelado) e do banco da conta
    const codrcbs = linhas.filter((l) => sel.has(Number(l.codrcb)) && (!l.nome_arq_remessa || String(l.registro_arq_remessa ?? '') === 'C')
      && Number(l.codbco) === Number(conta?.conta?.codbco)).map((l) => Number(l.codrcb));
    if (!codrcbs.length) return mensagem.erro(new Error('Boletos selecionados já gravados em arquivo de remessa ou não estão selecionados. Verifique!'));
    if (!codconf) return mensagem.erro(new Error('Configuração de integração bancária não encontrada nesta empresa.'));
    const emite = async () => {
      await post('/cobranca/cnab/emitir', { codrcbs });
      await recarregar();
    };
    try {
      await imprimirRelatorio('/cobranca/cnab/boleto/impressao', corpoBoleto(codrcbs), emite);
      const g = conta?.geraRemessa ?? 'N';
      if (g === 'S' || (g === 'P' && window.confirm('Deseja gerar o arquivo remessa?'))) await gerar('E', codrcbs);
      else mensagem.sucesso(`Boleto emitido para ${codrcbs.length} título(s).`);
    } catch (e) { mensagem.erro(e); }
  };

  /** relê os títulos da grade (o legado chama o FEditCodigo.OnExit / a Pesquisa de novo) */
  const recarregar = async () => {
    if (!linhas.length) return;
    const r = await post<{ linhas: Linha[] }>('/cobranca/cnab/titulos', { codrcbs: linhas.map((l) => Number(l.codrcb)) });
    setLinhas(r.linhas);
  };

  /** «Cancelar boleto» (btnCancelarBoletoClick → taCancelarBoleto, :2621): pergunta e marca STATUS_BOLETO = 'C' */
  const cancelarBoleto = async () => {
    if (semImportar()) return;
    if (!window.confirm('Deseja realmente efetuar o cancelamento deste(s) boleto(s)?')) return;
    try {
      const r = await post<{ cancelados: number }>('/cobranca/cnab/cancelar-boleto', { codconta: Number(codconta), codrcbs: Array.from(sel) });
      mensagem.sucesso(`${r.cancelados} boleto(s) cancelado(s) — gere a remessa de cancelamento para avisar o banco.`);
      await recarregar();
    } catch (e) { mensagem.erro(e); }
  };

  /** «Gerar instruções» (Opções → GerarInstrucao): as instruções de cada título marcado, como o boleto vai imprimir */
  const gerarInstrucoes = async () => {
    setOpcoes(false);
    if (semImportar()) return;
    if (!codconf || !codconta) return mensagem.erro(new Error('É preciso informar uma conta para prosseguir.'));
    try {
      const r = await post<{ boletos: Linha[] }>('/cobranca/cnab/boleto', corpoBoleto(Array.from(sel)));
      setInstrucoes(Object.fromEntries(r.boletos.map((b) => [Number(b.codrcb), (b.instrucoes as string[]) ?? []])));
    } catch (e) { mensagem.erro(e); }
  };

  /** REIMPRIMIR (btnReimprimir → taReimprimirBoleto): só os boletos já enviados ao banco (REGISTRO_ARQ_REMESSA = 'S') */
  const reimprimir = async () => {
    const enviados = linhas.filter((l) => sel.has(Number(l.codrcb)) && String(l.registro_arq_remessa ?? '') === 'S').map((l) => Number(l.codrcb));
    if (!enviados.length) return mensagem.erro(new Error('Não existem boletos a serem reimpressos. Verifique!'));
    if (!codconf || !codconta) return mensagem.erro(new Error('É preciso informar uma conta para prosseguir.'));
    try { await imprimirRelatorio('/cobranca/cnab/boleto/impressao', corpoBoleto(enviados)); } catch (e) { mensagem.erro(e); }
  };

  /** IMPRIMIR (btnImprimirClick): a duplicata dos títulos marcados — recusa o já enviado ou cancelado */
  const imprimirDuplicata = async () => {
    if (!linhas.length || !sel.size) return mensagem.erro(new Error('Não existe nenhum título na grade para ser impresso. Verifique!'));
    try { await imprimirRelatorio('/cobranca/cnab/duplicata/impressao', { codrcbs: Array.from(sel) }); } catch (e) { mensagem.erro(e); }
  };

  /** «Remessa» (ppmRemessa): de emissão (STATUS_BOLETO 'E'), de cancelamento ('C') e de alteração de vencimento (enviado, sem status) */
  const gerar = async (tipo: 'E' | 'C' | 'AV' = 'E', codrcbs: number[] = Array.from(sel)) => {
    setMenuRemessa(false);
    if (semImportar()) return;
    if (!codrcbs.length) return mensagem.erro(new Error('Não existem boletos para gerar remessa. Verifique!'));
    if (!codconf) return mensagem.erro(new Error('Configuração de integração bancária não encontrada nesta empresa.'));
    setBusy(true);
    try {
      const r = await post<{ nomearquivo: string; titulos: number; registros: number; tipo: string }>('/cobranca/cnab/gerar', {
        codconf: Number(codconf), codconta: Number(codconta), codrcbs, tipo,
      });
      const rotulo = tipo === 'C' ? 'de cancelamento' : tipo === 'AV' ? 'de alteração de vencimento' : '';
      mensagem.sucesso(`Remessa ${rotulo} ${r.nomearquivo} gerada: ${r.titulos} título(s), ${r.registros} registros.`.replace('  ', ' '));
      void recarregar(); void listarRemessas();
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const listarRemessas = async () => {
    try { setRemessas((await post<{ linhas: Linha[] }>('/cobranca/cnab/remessas', {})).linhas); }
    catch (e) { mensagem.erro(e); }
  };

  /** baixa o .TXT como o legado gravava na pasta Remessa — aqui é download do conteúdo guardado. */
  const baixar = async (l: Linha) => {
    try {
      const r = await post<{ nomearquivo: string; arquivo: string }>('/cobranca/cnab/arquivo', { cod_remessa_areceber: l.cod_remessa_areceber });
      const blob = new Blob([r.arquivo], { type: 'text/plain;charset=iso-8859-1' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = r.nomearquivo;
      a.click();
    } catch (e) { mensagem.erro(e); }
  };

  /** BOLETO: nosso número com DV, código de barras e linha digitável (para conferir/copiar). */
  const verBoleto = async () => {
    if (!sel.size) return mensagem.erro(new Error('Selecione ao menos um título.'));
    if (!codconf || !codconta) return mensagem.erro(new Error('Informe a configuração e a conta bancária.'));
    try {
      const r = await post<{ banco: string; cabecalho: Record<string, unknown>; boletos: Linha[] }>('/cobranca/cnab/boleto', {
        codconf: Number(codconf), codconta: Number(codconta), codrcbs: Array.from(sel),
      });
      setBoletos(r.boletos);
    } catch (e) { mensagem.erro(e); }
  };

  /** RETORNO: lê o arquivo do banco e mostra a PROPOSTA de baixa (como no legado, quem grava é o operador). */
  const importarRetorno = async (file: File) => {
    try {
      const texto = await file.text();
      const r = await post<{ banco: number; data_baixa: string | null; totais: Record<string, number>; propostas: Linha[] }>(
        '/cobranca/cnab/retorno', { arquivo: texto },
      );
      setRetorno(r);
      mensagem.sucesso(`Retorno lido: ${r.totais.casados} título(s) casado(s) de ${r.totais.boletos_pagos} pago(s).`);
    } catch (e) { mensagem.erro(e); }
  };

  const total = linhas.filter((l) => sel.has(Number(l.codrcb))).reduce((s, l) => s + Number(l.valor ?? 0), 0);

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Cobrança bancária — boleto e remessa (CNAB)" />

      <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          {/* edtNroConta + F3 (GET_CONTAS_BANCARIAS: NRO_CONTA e TITULAR); a agência e o layout da remessa vêm da conta */}
          <div className="w-96"><LookupField label="&Nro.Conta" recurso="lookup/contas-bancarias" campoCodigo="codigo" campoDigitado="nro_conta" descricao="titular"
            value={codconta} onChange={(cod) => trocarConta(cod)} /></div>
          <div className="w-28"><Field label="Agência" value={String(conta?.conta?.agencia ?? '')} disabled onChange={() => undefined} /></div>
          <div className="w-44"><Field label="Layout Arquivo Remessa" value={temConta ? (String(conta?.conf?.layoutremessa ?? '') === 'C240' ? 'CNAB 240' : conta?.conf ? 'CNAB 400' : '—') : ''} disabled onChange={() => undefined} /></div>
          <Button label="&Importar títulos" variant="soft" disabled={busy} onClick={() => setImportando(true)} />
        </div>
        <div className="flex flex-wrap items-center gap-gp-sm">
          <div className="relative">
            <Button label="&Opções ▾" variant="ghost" onClick={() => setOpcoes((v) => !v)} />
            {opcoes && (
              <div className="absolute z-10 mt-1 flex min-w-56 flex-col rounded-radius-md border border-border bg-bg-surface p-1 shadow">
                <button className="rounded px-2 py-1 text-left text-body-sm hover:bg-bg-subtle" onClick={() => void gerarInstrucoes()}>Gerar instruções</button>
              </div>
            )}
          </div>
          {/* btnBoleto / btnCancelarBoleto / btnGerarRemessa: só com conta de banco que emite boleto (ConsultaNumeroBanco :2172) e endereço completo */}
          {emiteBoleto && <Button label="&Boleto" variant="soft" disabled={busy || travadoPorEndereco} onClick={() => void emitir()} />}
          {emiteBoleto && <Button label="&Cancelar boleto" variant="ghost" disabled={busy || travadoPorEndereco} onClick={() => void cancelarBoleto()} />}
          {emiteBoleto && linhas.some((l) => String(l.registro_arq_remessa ?? '') === 'S') && <Button label="&Reimprimir" variant="ghost" disabled={busy} onClick={() => void reimprimir()} />}
          {emiteBoleto && (
            <div className="relative">
              <Button label="&Remessa ▾" variant="soft" disabled={busy || travadoPorEndereco} onClick={() => setMenuRemessa((v) => !v)} />
              {menuRemessa && (
                <div className="absolute z-10 mt-1 flex min-w-72 flex-col rounded-radius-md border border-border bg-bg-surface p-1 shadow">
                  <button className="rounded px-2 py-1 text-left text-body-sm hover:bg-bg-subtle" onClick={() => void gerar('E')}>Gerar Remessa de Emissão</button>
                  <button className="rounded px-2 py-1 text-left text-body-sm hover:bg-bg-subtle" onClick={() => void gerar('C')}>Gerar Remessa de Cancelamento</button>
                  <button className="rounded px-2 py-1 text-left text-body-sm hover:bg-bg-subtle" onClick={() => void gerar('AV')}>Gerar Remessa de alteração de vencimento</button>
                </div>
              )}
            </div>
          )}
          {/* btnImprimir: a duplicata, só sem conta (:2005) */}
          {!temConta && <Button label="Im&primir" variant="ghost" disabled={busy} onClick={() => void imprimirDuplicata()} />}
          <label className="flex items-center gap-1 text-body-sm"><input type="checkbox" checked={impresso} onChange={(e) => setImpresso(e.target.checked)} /> Impressão</label>
          {emiteBoleto && <Button label="&Ver boleto" variant="ghost" disabled={busy || !sel.size} onClick={() => void verBoleto()} />}
          <Button label="Remessas geradas" variant="ghost" disabled={busy} onClick={() => void listarRemessas()} />
          <label className="cursor-pointer text-body-sm underline">
            Importar retorno…
            <input type="file" accept=".ret,.txt,.crt,.rem" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importarRetorno(f); e.target.value = ''; }} />
          </label>
        </div>
        <small className="text-fg-muted">( * ) As alterações feitas no boleto não serão salvas no banco.{sel.size > 0 && ` Marcados: ${sel.size} · ${brl(total)}.`}</small>
      </div>

      {importando && (
        <Pesquisa resourcePath="cobranca/boleto-titulos" multisselecao parametros={{ codbco: conta?.conta?.codbco }}
          onSelecionarVarios={(ls) => void importar(ls)} onSelecionar={(l) => void importar([l])} onFechar={() => setImportando(false)} />
      )}

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead><tr className="text-left text-fg-muted">
            {/* clicar no título "Imprimir" inverte as marcas (menos os cancelados) — dbgDadosTitleClick */}
            <th className="p-pad-xs"><button className="underline" onClick={() => setSel(inverterMarcas(linhas, sel))}>Imprimir</button></th>
            <th className="p-pad-xs">Nº do documento</th><th className="p-pad-xs">Vencimento</th><th className="p-pad-xs text-right">Juros/Mora (%)</th>
            <th className="p-pad-xs text-right">Valor $</th><th className="p-pad-xs">Cliente</th><th className="p-pad-xs">Endereço</th>
            <th className="p-pad-xs">Bairro</th><th className="p-pad-xs">Cidade</th><th className="p-pad-xs">UF</th><th className="p-pad-xs">CEP</th>
            <th className="p-pad-xs">OBS</th><th className="p-pad-xs">CODEND</th><th className="p-pad-xs">ARQ.REMESSA</th><th className="p-pad-xs">NOME ARQUIVO</th>
            <th className="p-pad-xs">LOGIN ARQUIVO</th><th className="p-pad-xs">Data Arquivo</th><th className="p-pad-xs">Cód.Banco</th>
          </tr></thead>
          <tbody>
            {linhas.map((l) => {
              const reg = String(l.registro_arq_remessa ?? '');
              // dbgDadosDrawColumnCell: enviado ao banco em verde negrito, cancelado em vermelho negrito
              const cor = reg === 'S' ? 'font-semibold text-success' : reg === 'C' ? 'font-semibold text-danger' : '';
              const inst = instrucoes[Number(l.codrcb)];
              return (
                <tr key={String(l.codrcb)} className={`border-t border-border ${cor}`}>
                  <td className="p-pad-xs"><input type="checkbox" aria-label={`Marcar ${String(l.codrcb)}`} checked={sel.has(Number(l.codrcb))} onChange={() => marcar(Number(l.codrcb))} /></td>
                  <td className="p-pad-xs tabular-nums">{String(l.duplicata ?? '') || String(l.codrcb)}</td>
                  <td className="p-pad-xs tabular-nums">{dia(l.dtvenc)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{Number(l.txjuros ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(l.valor)}</td>
                  <td className="p-pad-xs">{String(l.razao ?? '—')}</td>
                  <td className="p-pad-xs">{String(l.endereco ?? '')}</td>
                  <td className="p-pad-xs">{String(l.bairro ?? '')}</td>
                  <td className="p-pad-xs">{String(l.cidade ?? '')}</td>
                  <td className="p-pad-xs">{String(l.uf ?? '')}</td>
                  <td className="p-pad-xs tabular-nums">{String(l.cep ?? '')}</td>
                  <td className="p-pad-xs whitespace-pre-line text-fg-muted">{inst ? inst.join('\n') : String(l.obs ?? '')}</td>
                  <td className="p-pad-xs tabular-nums">{String(l.codend ?? '')}</td>
                  <td className="p-pad-xs">{reg}</td>
                  <td className="p-pad-xs">{String(l.nome_arq_remessa ?? '')}</td>
                  <td className="p-pad-xs">{String(l.login_arq_remessa ?? '')}</td>
                  <td className="p-pad-xs tabular-nums">{l.data_arq_remessa ? dia(l.data_arq_remessa) : ''}</td>
                  <td className="p-pad-xs tabular-nums">{String(l.codbco ?? '')}</td>
                </tr>
              );
            })}
            {!linhas.length && <tr><td colSpan={18} className="p-pad-md text-fg-muted">Escolha a conta e use «Importar títulos».</td></tr>}
          </tbody>
        </table>
      </div>

      {boletos && (
        <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="flex items-center justify-between">
            <div className="text-title-sm font-semibold">Boleto — linha digitável e código de barras</div>
            <button className="underline text-body-sm" onClick={() => setBoletos(null)}>fechar</button>
          </div>
          {boletos.map((b) => (
            <div key={String(b.codrcb)} className="flex flex-col gap-1 border-t border-border pt-pad-xs">
              <div className="text-body-sm">
                Título {String(b.codrcb)} · {String(b.razao ?? '')} · venc. {dia(b.vencimento)} · {brl(b.valor)}
                <span className="ml-2 text-fg-muted">nosso nº {String(b.nosso_numero)}{b.nosso_numero_dv != null ? `-${String(b.nosso_numero_dv)}` : ''}</span>
              </div>
              <div className="font-mono text-body-sm tabular-nums select-all">{String(b.linha_digitavel)}</div>
              <div className="font-mono text-body-xs text-fg-muted tabular-nums select-all">{String(b.codigo_barras)}</div>
              {Array.isArray(b.instrucoes) && (b.instrucoes as string[]).length > 0 && (
                <ul className="text-body-xs text-fg-muted">
                  {(b.instrucoes as string[]).map((i, k) => <li key={k}>{i}</li>)}
                </ul>
              )}
            </div>
          ))}
          <small className="text-fg-muted">
            As instruções (mora, multa, desconto, nota fiscal) são as que o boleto imprime — calculadas do título,
            como no sistema atual. Confira a linha digitável antes de enviar a remessa.
          </small>
        </div>
      )}

      {retorno && (
        <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="flex items-center justify-between">
            <div className="text-title-sm font-semibold">
              Retorno do banco {retorno.banco} — baixa proposta para {dia(retorno.data_baixa)}
              <span className="ml-2 text-body-sm text-fg-muted">
                {retorno.totais.casados} de {retorno.totais.boletos_pagos} pago(s) casado(s) · {brl(retorno.totais.valor_recebido)}
                {retorno.totais.nao_encontrados > 0 && ` · ${retorno.totais.nao_encontrados} não encontrado(s)`}
              </span>
            </div>
            <button className="underline text-body-sm" onClick={() => setRetorno(null)}>fechar</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead><tr className="text-left text-fg-muted">
                <th className="p-pad-xs">Título</th><th className="p-pad-xs">Sacado</th><th className="p-pad-xs">Duplicata</th>
                <th className="p-pad-xs text-right">Documento</th><th className="p-pad-xs text-right">Recebido</th>
                <th className="p-pad-xs text-right">Acré./Desc.</th><th className="p-pad-xs">Ocorrência</th>
              </tr></thead>
              <tbody>
                {retorno.propostas.map((p, i) => (
                  <tr key={i} className={`border-t border-border ${p.encontrado ? '' : 'text-fg-muted'}`}>
                    <td className="p-pad-xs tabular-nums">{String(p.codrcb)}{p.encontrado ? '' : ' (não encontrado)'}</td>
                    <td className="p-pad-xs">{String(p.razao ?? '—')}</td>
                    <td className="p-pad-xs">{String(p.duplicata ?? '—')}</td>
                    <td className="p-pad-xs text-right tabular-nums">{brl(p.valor_documento)}</td>
                    <td className="p-pad-xs text-right tabular-nums font-semibold">{brl(p.valor_recebido)}</td>
                    <td className={`p-pad-xs text-right tabular-nums ${Number(p.acredesc) < 0 ? 'text-danger' : ''}`}>{brl(p.acredesc)}</td>
                    <td className="p-pad-xs text-fg-muted">{String(p.ocorrencia ?? '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small className="text-fg-muted">A baixa em si é gravada na tela de baixa de contas a receber — aqui é a conferência, como no sistema atual.</small>
        </div>
      )}

      {remessas.length > 0 && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full text-body-sm">
            <thead><tr className="text-left text-fg-muted">
              <th className="p-pad-xs">Arquivo</th><th className="p-pad-xs">Gerado em</th>
              <th className="p-pad-xs">Conta</th><th className="p-pad-xs text-right">Títulos</th>
              <th className="p-pad-xs text-right">Bytes</th><th className="p-pad-xs">Ações</th>
            </tr></thead>
            <tbody>
              {remessas.map((r) => (
                <tr key={String(r.cod_remessa_areceber)} className="border-t border-border">
                  <td className="p-pad-xs">{String(r.nomearquivo)}</td>
                  <td className="p-pad-xs tabular-nums">{dia(r.dtcadastro)}</td>
                  <td className="p-pad-xs">{String(r.nroconta ?? '—')}</td>
                  <td className="p-pad-xs text-right tabular-nums">{String(r.titulos)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{String(r.bytes)}</td>
                  <td className="p-pad-xs"><button className="underline" onClick={() => void baixar(r)}>baixar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
