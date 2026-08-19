import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { svgCodigoBarras } from './codigoBarrasItf';

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

/**
 * CNAB DE COBRANÇA (FRMCONFBOLETO) — emite o boleto dos títulos a receber e gera o arquivo de REMESSA
 * para o banco (Itaú 400 neste corte). O fluxo é o do legado: escolher os títulos → "Emitir boleto"
 * (carimba o nosso número) → "Gerar remessa" (produz o arquivo e marca os títulos como enviados) → baixar.
 */
export function CnabRemessaPage() {
  const mensagem = useMensagem();
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [status, setStatus] = useState('');
  const [codconf, setCodconf] = useState('');
  const [codconta, setCodconta] = useState('');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [remessas, setRemessas] = useState<Linha[]>([]);
  const [boletos, setBoletos] = useState<Linha[] | null>(null);
  const [cabecalho, setCabecalho] = useState<Record<string, unknown> | null>(null);
  const [ficha, setFicha] = useState(false); // ficha de compensação (para imprimir) × lista de conferência
  const [retorno, setRetorno] = useState<{ banco: number; data_baixa: string | null; totais: Record<string, number>; propostas: Linha[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const consultar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await post<{ linhas: Linha[] }>('/cobranca/cnab/titulos', {
        de: de || undefined, ate: ate || undefined, status: status || undefined,
      });
      setLinhas(r.linhas); setSel(new Set());
      if (!r.linhas.length) mensagem.sucesso('Nenhum título em aberto no filtro.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const marcar = (codrcb: number) => {
    const s = new Set(sel);
    if (s.has(codrcb)) s.delete(codrcb); else s.add(codrcb);
    setSel(s);
  };

  const emitir = async () => {
    if (!sel.size) return mensagem.erro(new Error('Selecione ao menos um título.'));
    try {
      await post('/cobranca/cnab/emitir', { codrcbs: Array.from(sel) });
      mensagem.sucesso(`Boleto emitido para ${sel.size} título(s).`);
      void consultar();
    } catch (e) { mensagem.erro(e); }
  };

  const gerar = async (tipo: 'E' | 'C' | 'AV' = 'E') => {
    if (!sel.size) return mensagem.erro(new Error('Selecione ao menos um título.'));
    if (!codconf) return mensagem.erro(new Error('Informe a configuração bancária da remessa.'));
    if (!codconta) return mensagem.erro(new Error('Informe a conta bancária da cobrança.'));
    try {
      const r = await post<{ nomearquivo: string; titulos: number; registros: number; tipo: string }>('/cobranca/cnab/gerar', {
        codconf: Number(codconf), codconta: Number(codconta), codrcbs: Array.from(sel), tipo,
      });
      const rotulo = tipo === 'C' ? 'de cancelamento' : tipo === 'AV' ? 'de alteração de vencimento' : '';
      mensagem.sucesso(`Remessa ${rotulo} ${r.nomearquivo} gerada: ${r.titulos} título(s), ${r.registros} registros.`.replace('  ', ' '));
      void consultar(); void listarRemessas();
    } catch (e) { mensagem.erro(e); }
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
      setBoletos(r.boletos); setCabecalho(r.cabecalho);
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

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-40"><Field label="Vencimento &de" type="date" value={de} onChange={(e) => setDe(e.target.value)} /></div>
        <div className="w-40"><Field label="&até" type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></div>
        <div className="w-48"><SelectField label="&Estado do boleto" value={status} onChange={setStatus} placeholder="(todos)" options={[
          { value: 'E', label: 'Emitido (vai na remessa)' },
        ]} /></div>
        <div className="w-36"><Field label="Con&fig. bancária" value={codconf} onChange={(e) => setCodconf(e.target.value)} /></div>
        <div className="w-36"><Field label="Conta &bancária" value={codconta} onChange={(e) => setCodconta(e.target.value)} placeholder="cód." /></div>
        <Button label="&Consultar" variant="soft" disabled={busy} onClick={() => void consultar()} />
        <Button label="&Emitir boleto" variant="soft" disabled={busy || !sel.size} onClick={() => void emitir()} />
        <Button label="&Gerar remessa" variant="soft" disabled={busy || !sel.size} onClick={() => void gerar('E')} />
        <Button label="&Ver boleto" variant="ghost" disabled={busy || !sel.size} onClick={() => void verBoleto()} />
        <Button label="Alterar &vencimento" variant="ghost" disabled={busy || !sel.size} onClick={() => void gerar('AV')} />
        <Button label="&Cancelar no banco" variant="ghost" disabled={busy || !sel.size} onClick={() => void gerar('C')} />
        <Button label="&Remessas geradas" variant="ghost" disabled={busy} onClick={() => void listarRemessas()} />
        <label className="cursor-pointer text-body-sm underline">
          Importar retorno…
          <input type="file" accept=".ret,.txt,.crt,.rem" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void importarRetorno(f); e.target.value = ''; }} />
        </label>
        <small className="w-full text-fg-muted">
          Selecione os títulos, emita o boleto e gere a remessa — o arquivo fica guardado e pode ser baixado depois.
          Para título já enviado ao banco: <em>Alterar vencimento</em> avisa o novo vencimento; <em>Cancelar no banco</em> pede a baixa.
          {sel.size > 0 && ` Selecionados: ${sel.size} · ${brl(total)}.`}
        </small>
      </div>

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead><tr className="text-left text-fg-muted">
            <th className="p-pad-xs"> </th><th className="p-pad-xs">Título</th><th className="p-pad-xs">Sacado</th>
            <th className="p-pad-xs">Duplicata</th><th className="p-pad-xs">Vencimento</th>
            <th className="p-pad-xs text-right">Valor</th><th className="p-pad-xs">Boleto</th>
            <th className="p-pad-xs">Nosso nº</th><th className="p-pad-xs">Remessa</th>
          </tr></thead>
          <tbody>
            {linhas.map((l) => {
              const enviado = String(l.registro_arq_remessa ?? '') === 'S';
              return (
                <tr key={String(l.codrcb)} className="border-t border-border">
                  <td className="p-pad-xs">
                    <input type="checkbox" checked={sel.has(Number(l.codrcb))} onChange={() => marcar(Number(l.codrcb))} disabled={enviado} />
                  </td>
                  <td className="p-pad-xs tabular-nums">{String(l.codrcb)}</td>
                  <td className="p-pad-xs">{String(l.razao ?? '—')}</td>
                  <td className="p-pad-xs">{String(l.duplicata ?? '')}</td>
                  <td className="p-pad-xs tabular-nums">{dia(l.dtvenc)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(l.valor)}</td>
                  <td className="p-pad-xs">{l.status_boleto === 'E' ? 'emitido' : '—'}</td>
                  <td className="p-pad-xs tabular-nums text-fg-muted">{String(l.nosso_numero_boleto ?? '—')}</td>
                  <td className={`p-pad-xs ${enviado ? 'font-semibold' : 'text-fg-muted'}`}>
                    {enviado ? `${String(l.nome_arq_remessa ?? 'enviada')} · ${dia(l.data_arq_remessa)}` : '—'}
                  </td>
                </tr>
              );
            })}
            {!linhas.length && <tr><td colSpan={9} className="p-pad-md text-fg-muted">Consulte para carregar os títulos em aberto.</td></tr>}
          </tbody>
        </table>
      </div>

      {boletos && (
        <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="flex items-center justify-between print:hidden">
            <div className="text-title-sm font-semibold">
              Boleto — {ficha ? 'ficha de compensação (pronta para imprimir)' : 'linha digitável e código de barras'}
            </div>
            <div className="flex gap-gp-sm">
              <button className="underline text-body-sm" onClick={() => setFicha(!ficha)}>
                {ficha ? 'ver conferência' : 'ver ficha para imprimir'}
              </button>
              <button className="underline text-body-sm" onClick={() => { setBoletos(null); setFicha(false); }}>fechar</button>
            </div>
          </div>
          {ficha && boletos.map((b) => {
            const sac = (b.sacado ?? {}) as Record<string, unknown>;
            return (
              <div key={`f${b.codrcb}`} className="flex flex-col gap-1 border border-fg-default p-pad-sm text-body-xs break-inside-avoid">
                <div className="flex items-end justify-between border-b-2 border-fg-default pb-1">
                  <span className="text-title-sm font-bold">{String(cabecalho?.banco ?? '')}</span>
                  <span className="text-body-xs">{String(cabecalho?.nome_banco ?? '')}</span>
                  <span className="font-mono text-body-sm font-semibold tabular-nums">{String(b.linha_digitavel)}</span>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  <div className="col-span-2"><span className="text-fg-muted">Cedente</span><br />{String(cabecalho?.cedente ?? '')} · {String(cabecalho?.cedente_cnpj ?? '')}</div>
                  <div><span className="text-fg-muted">Agência/Conta</span><br />{String(cabecalho?.agencia ?? '')} / {String(cabecalho?.conta ?? '')}</div>
                  <div><span className="text-fg-muted">Vencimento</span><br /><strong>{dia(b.vencimento)}</strong></div>
                  <div><span className="text-fg-muted">Nosso número</span><br />{String(b.nosso_numero)}{b.nosso_numero_dv != null ? `-${String(b.nosso_numero_dv)}` : ''}</div>
                  <div><span className="text-fg-muted">Carteira</span><br />{String(cabecalho?.carteira ?? '')}</div>
                  <div><span className="text-fg-muted">Nº documento</span><br />{String(b.duplicata ?? '')}</div>
                  <div><span className="text-fg-muted">Valor do documento</span><br /><strong>{brl(b.valor)}</strong></div>
                </div>
                <div>
                  <span className="text-fg-muted">Instruções</span>
                  <ul>{(Array.isArray(b.instrucoes) ? (b.instrucoes as string[]) : []).map((i, k) => <li key={k}>{i}</li>)}</ul>
                </div>
                <div className="border-t border-border pt-1">
                  <span className="text-fg-muted">Sacado</span><br />
                  {String(sac.nome ?? '')} · {String(sac.documento ?? '')}<br />
                  {String(sac.endereco ?? '')} {sac.bairro ? `· ${String(sac.bairro)}` : ''} {sac.cidade ? `· ${String(sac.cidade)}/${String(sac.uf ?? '')}` : ''} {sac.cep ? `· CEP ${String(sac.cep)}` : ''}
                </div>
                {/* código de barras no padrão FEBRABAN (ITF 2 de 5), desenhado em SVG — sem dependência externa */}
                <div className="pt-1" dangerouslySetInnerHTML={{ __html: svgCodigoBarras(String(b.codigo_barras), 45) }} />
              </div>
            );
          })}

          {!ficha && boletos.map((b) => (
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
          <small className="text-fg-muted print:hidden">
            As instruções (mora, multa, desconto, nota fiscal) são as que o boleto imprime — calculadas do título,
            como no sistema atual. Confira a linha digitável antes de enviar a remessa; na ficha, use o botão de
            imprimir da tela (o diálogo permite salvar em PDF).
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
