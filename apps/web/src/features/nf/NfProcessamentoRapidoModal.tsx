import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../../shared/ui/Modal';
import { Button } from '../../shared/ui/Button';
import { useShortcut } from '../../shared/keyboard';
import { useMensagem } from '../../shared/mensagem';
import { NfProcessarModal } from './NfProcessarModal';
import {
  lerProcessamentoRapido, situacoesDoProcessamentoRapido, vincularSituacaoRapido, lancamentosDoProcessamentoRapido, preencherLancamentosRapido,
  type NotaDoProcessamentoRapido, type LancamentosDoProcessamentoRapido,
} from './nfProcessamentoApi';

/**
 * PROCESSAMENTO RÁPIDO DE NOTA FISCAL (`TFrmProcessaNotaFiscal`, uProcessaNotaFiscal.pas) — a janela que o legado abre depois de gerar a
 * nota de transferência ("Deseja processar esta nota fiscal?"), sobre a ENTRADA que nasceu na loja de destino. Os dados da nota, a loja
 * dela, as pendências (R realizada, P pendente) e as teclas:
 *  - F4 a situação de documento (só as de transferência; grava na nota e nos itens);
 *  - F6 os lançamentos contábeis (preenchidos pelos centros de custo da situação, como a tela de lançamentos faz);
 *  - F5 (pedido de compra) e F7–F10 (a análise dos itens) abrem, no legado, as telas da nota — aqui elas se resolvem na nota fiscal da
 *    loja de destino; na produção essas pendências nunca ficam abertas numa transferência (CFOP isenta de indexador e de repasse, sem pedido);
 *  - &Processar: as travas desta janela e a tela de processar (TfrmEstoqueNF), tudo na loja da nota.
 */
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));

export function NfProcessamentoRapidoModal({ codnf, onFechar }: { codnf: number; onFechar: () => void }) {
  const mensagem = useMensagem();
  const [dados, setDados] = useState<NotaDoProcessamentoRapido | null>(null);
  const [janela, setJanela] = useState<'situacao' | 'lancamentos' | 'processar' | null>(null);
  const [situacoes, setSituacoes] = useState<Array<{ idsituacao_nf: number; descricao: string | null; cfops: string }>>([]);
  const [escolhida, setEscolhida] = useState<number | null>(null);
  const [lanc, setLanc] = useState<LancamentosDoProcessamentoRapido | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // CarregarNotaFiscal + CarregaPendencias
  const carregar = useCallback(async () => {
    try { setDados(await lerProcessamentoRapido(codnf)); } catch (e) { mensagem.erro(e); }
  }, [codnf, mensagem]);
  useEffect(() => { void carregar(); }, [carregar]);
  const processada = dados?.nota.proc === 'S';
  const livre = janela == null && !ocupado;

  // F4 — VincularSituacaoDeDocumento: sem situação de transferência, "Situação de documento não definida!"
  const abrirSituacao = async () => {
    try {
      const s = await situacoesDoProcessamentoRapido(codnf);
      if (!s.length) { mensagem.erro(new Error('Situação de documento não definida!')); return; }
      setSituacoes(s);
      setEscolhida(dados?.nota.idsituacao_nf && s.some((x) => x.idsituacao_nf === dados.nota.idsituacao_nf) ? dados.nota.idsituacao_nf : s[0].idsituacao_nf);
      setJanela('situacao');
    } catch (e) { mensagem.erro(e); }
  };
  const gravarSituacao = async () => {
    if (escolhida == null) return;
    setOcupado(true);
    try { await vincularSituacaoRapido(codnf, escolhida); setJanela(null); await carregar(); } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  // F6 — VincularLancamentoContabil
  const abrirLancamentos = async () => {
    try { setLanc(await lancamentosDoProcessamentoRapido(codnf)); setJanela('lancamentos'); } catch (e) { mensagem.erro(e); }
  };
  const preencher = async () => {
    setOcupado(true);
    try { setLanc(await preencherLancamentosRapido(codnf)); } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const naNota = (o: string) => mensagem.erro(new Error(`${o} se resolve na nota fiscal ${codnf}, na loja ${dados?.nota.idempresa ?? ''}.`));

  useShortcut('f4', () => { if (!processada) void abrirSituacao(); }, { when: livre });
  useShortcut('f5', () => naNota('O pedido de compra'), { when: livre });
  useShortcut('f6', () => { if (!processada) void abrirLancamentos(); }, { when: livre });
  useShortcut('f7', () => naNota('A análise dos itens'), { when: livre });
  useShortcut('f8', () => naNota('A análise dos itens'), { when: livre });
  useShortcut('f9', () => naNota('A análise dos itens'), { when: livre });
  useShortcut('f10', () => naNota('A análise dos itens'), { when: livre });

  const n = dados?.nota;
  const campo = (rotulo: string, valor: unknown) => (
    <div className="flex flex-col"><span className="text-caption text-fg-muted">{rotulo}</span><span className="text-body-sm tabular-nums">{valor == null || valor === '' ? '—' : String(valor)}</span></div>
  );

  return (
    <Modal open onClose={onFechar} size="lg" title="Processamento rápido de nota fiscal"
      primaryAction={processada ? undefined : { label: '&Processar', onClick: () => { if (dados) setJanela('processar'); } }}
      secondaryAction={{ label: processada ? '&Sair' : '&Cancelar', onClick: onFechar }}>
      {!n ? <small className="text-fg-muted">Carregando…</small> : (
        <div className="flex flex-col gap-form-gap">
          <div className="flex flex-wrap items-baseline justify-between gap-gp-sm">
            <span className="text-body-md font-semibold">{n.fantasia ?? `Empresa ${n.idempresa}`}</span>
            {processada && <span className="rounded-radius-sm border border-border px-pad-sm py-pad-xs text-body-sm font-semibold text-fg-danger">PROCESSADA</span>}
          </div>
          <div className="grid grid-cols-2 gap-gp-sm sm:grid-cols-4">
            {campo('Código', n.codnf)}{campo('Número', n.nronf)}{campo('Série', n.serie)}{campo('Data emissão', dataBr(n.dtemissao))}
            <div className="col-span-2 sm:col-span-4">{campo('Chave', n.chavenfe)}</div>
            <div className="col-span-2">{campo('Situação', n.desc_situacao)}</div>{campo('CFOP', n.cfop)}{campo('Valor total nf', moeda(n.totalnf))}
            <div className="col-span-2">{campo('Parceiro', n.razao)}</div><div className="col-span-2">{campo('Cnpj parceiro', n.cnpj_cpf)}</div>
          </div>
          <div className="overflow-x-auto">
            <h4 className="mb-gp-xs text-body-sm font-semibold">Pendências</h4>
            <table className="w-full text-body-sm">
              <thead><tr className="text-left text-fg-muted"><th className="py-pad-xs pr-pad-sm">Atalho</th><th className="pr-pad-sm">Descrição</th><th>Realizado</th></tr></thead>
              <tbody>
                {dados.pendencias.map((p) => (
                  <tr key={p.ordem} className="border-t border-border">
                    <td className="py-pad-xs pr-pad-sm font-semibold text-fg-accent">{p.atalho}</td>
                    <td className="pr-pad-sm">{p.descricao}</td>
                    <td className={p.realizado === 'R' ? 'text-fg-success' : 'font-semibold text-fg-danger'}>{p.realizado === 'R' ? '✓ R' : '✗ P'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!processada && (
            <div className="flex flex-wrap gap-gp-sm">
              <Button label="[F4] Situação de documento" variant="ghost" onClick={() => void abrirSituacao()} />
              <Button label="[F6] Lançamentos contábeis" variant="ghost" onClick={() => void abrirLancamentos()} />
            </div>
          )}
        </div>
      )}

      {janela === 'situacao' && (
        <Modal open onClose={() => setJanela(null)} size="md" title="Situação de documento"
          primaryAction={{ label: 'OK [F10]', onClick: () => void gravarSituacao() }} secondaryAction={{ label: 'Cancelar', onClick: () => setJanela(null) }}>
          <div role="radiogroup" aria-label="Situação de documento" className="flex flex-col gap-gp-xs">
            {situacoes.map((s) => (
              <label key={s.idsituacao_nf} className="flex items-center gap-gp-xs text-body-sm">
                <input type="radio" name="situacao-rapido" checked={escolhida === s.idsituacao_nf} onChange={() => setEscolhida(s.idsituacao_nf)} />
                <span className="tabular-nums">{s.idsituacao_nf}</span> — {s.descricao ?? ''} <small className="text-fg-muted">CFOP {s.cfops}</small>
              </label>
            ))}
          </div>
        </Modal>
      )}

      {janela === 'lancamentos' && lanc && (
        <Modal open onClose={() => { setJanela(null); void carregar(); }} size="lg" title="Lançamentos contábeis"
          primaryAction={{ label: 'OK', onClick: () => { setJanela(null); void carregar(); } }}>
          <div className="flex flex-col gap-form-gap">
            <table className="w-full text-body-sm">
              <thead><tr className="text-left text-fg-muted"><th className="py-pad-xs pr-pad-sm">Situação</th><th className="pr-pad-sm">Centro de custo</th><th className="text-right">Valor</th></tr></thead>
              <tbody>
                {!lanc.linhas.length && <tr><td colSpan={3} className="py-pad-sm text-center text-fg-muted">Nenhum lançamento.</td></tr>}
                {lanc.linhas.map((l) => (
                  <tr key={l.codcontabilnf} className="border-t border-border">
                    <td className="py-pad-xs pr-pad-sm">{l.idsituacao_nf} - {l.situacao ?? ''}</td>
                    <td className="pr-pad-sm">{l.codigo_extenso ?? l.codcc} - {l.centro_custo ?? ''}</td>
                    <td className="text-right tabular-nums">{moeda(l.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={`text-body-sm ${lanc.total === lanc.totalnf ? 'text-fg-muted' : 'text-fg-danger'}`}>Total dos lançamentos {moeda(lanc.total)} · total da nota {moeda(lanc.totalnf)}</p>
            <div><Button label="Inserir os centros de custo da situação" variant="soft" disabled={ocupado} onClick={() => void preencher()} /></div>
          </div>
        </Modal>
      )}

      {janela === 'processar' && (
        <NfProcessarModal codnf={codnf} rapido onFechar={() => setJanela(null)} onProcessado={() => { setJanela(null); void carregar(); }} />
      )}
    </Modal>
  );
}
