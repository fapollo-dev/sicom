import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@apollosg/design-system';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { useShortcut } from '../../shared/keyboard';
import { useOpcoesDoForm } from '../../shared/acesso/useOpcoesDoForm';
import { Pesquisa } from '../../shared/cadmaster/Pesquisa';
import { consultaBaixaCartao, estornarLoteCartao, type ConsultaBaixaCartao } from '../cartao/cartaoApi';

/**
 * CARTÕES BAIXADOS — a consulta do lote da baixa de cartões (`TfrmConsCRTbx`, UConsCRTbx.pas). Não está no menu: abre pelo
 * "Consulta &títulos" da baixa de cartões (btnConsulta, Tag 1) e pelo "Visualizar títulos" do controle de contas.
 *  - "[F3] - Buscar cartões": a Pesquisa da GET_CARTAOBX das lojas escolhidas (só os CONSILIADO = 'S' com o FECHAMENTO_CAIXA da
 *    empresa) devolve o LOTE; a tela mostra os cartões baixados nele e os recursos utilizados (a movimentação bancária do lote).
 *  - "&Reverter baixa": reabre todos os cartões do lote e lança a movimentação contrária (as travas são do servidor).
 *  - Aberta com `?lote=` vem com o lote carregado; com `&consulta=1` (o controle de contas) sem a busca e sem a reversão, como o
 *    VisualizarCartoes do legado (os dois botões ficam invisíveis).
 */
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));

export function ConsCrtBxPage() {
  const mensagem = useMensagem();
  const [params] = useSearchParams();
  const { tem: pode } = useOpcoesDoForm('FRMBAIXACARTAO');
  const somenteConsulta = params.get('consulta') === '1';
  const [det, setDet] = useState<ConsultaBaixaCartao | null>(null);
  const [pesquisando, setPesquisando] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const abrir = async (lote: number) => {
    setOcupado(true);
    try { setDet(await consultaBaixaCartao(lote)); } catch (e) { setDet(null); mensagem.erro(e); } finally { setOcupado(false); }
  };
  // FormShow: com o FIdLote, carrega o lote sem a Pesquisa
  useEffect(() => {
    const lote = Number(params.get('lote') ?? 0);
    if (lote > 0) void abrir(lote);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // FormKeyDown: F3 = btnAddChequeTer.Click
  useShortcut('f3', () => setPesquisando(true), { when: !somenteConsulta && !ocupado && !pesquisando });

  const reverter = async () => {
    // "Não existem documentos a reverter."
    if (!det || !det.cartoes.length) { mensagem.erro(new Error('Não existem documentos a reverter.')); return; }
    if (!window.confirm('Tem certeza que deseja reverter todos os documentos?')) return;
    setOcupado(true);
    try {
      await estornarLoteCartao(det.idlote);
      // o legado fecha os dois datasets depois da reversão
      setDet(null);
      mensagem.sucesso('Reversão realizada com sucesso.');
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Cartões baixados" />

      {!somenteConsulta && (
        <section className="flex flex-wrap items-center gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <Button label="[F3] - Buscar cartões" variant="soft" disabled={ocupado} onClick={() => setPesquisando(true)} />
          {det && <span className="text-body-sm text-fg-muted">Lote <b className="text-fg tabular-nums">{det.idlote}</b></span>}
        </section>
      )}

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <h4 className="p-pad-xs text-body-sm font-semibold">Cartões baixados{det ? ` · lote ${det.idlote}` : ''}</h4>
        <table className="w-full min-w-[960px] border-collapse text-body-sm">
          <thead>
            <tr className="border-b border-border text-left text-fg-muted">
              <th className="p-pad-xs">Documento</th><th className="p-pad-xs">Operadora do cartão</th><th className="p-pad-xs text-right">Valor</th>
              <th className="p-pad-xs text-right">Valor com taxa</th><th className="p-pad-xs">Data venda</th><th className="p-pad-xs">Previsão compensação</th>
              <th className="p-pad-xs">Data baixa</th><th className="p-pad-xs">Operador da baixa</th>
            </tr>
          </thead>
          <tbody>
            {!det?.cartoes.length && <tr><td colSpan={8} className="p-pad-md text-center text-fg-muted">{somenteConsulta ? 'Nenhum cartão neste lote.' : 'Busque o lote com F3.'}</td></tr>}
            {det?.cartoes.map((c, i) => (
              <tr key={`${c.codigo}-${i}`} className="border-b border-border">
                <td className="p-pad-xs">{c.nrocupom ?? ''}</td><td className="p-pad-xs">{c.operadora ?? ''}</td>
                <td className="p-pad-xs text-right tabular-nums">{moeda(c.valor)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(c.valor_com_taxa)}</td>
                <td className="p-pad-xs">{dataBr(c.data)}</td><td className="p-pad-xs">{dataBr(c.previsao_compensacao)}</td>
                <td className="p-pad-xs">{dataBr(c.data_baixa)}</td><td className="p-pad-xs">{c.operador_baixa ?? ''}</td>
              </tr>
            ))}
          </tbody>
          {!!det?.cartoes.length && (
            <tfoot>
              <tr className="font-semibold">
                <td className="p-pad-xs" colSpan={2}>{det.totais.cartoes} cartão(ões)</td>
                <td className="p-pad-xs text-right tabular-nums">{moeda(det.totais.valor)}</td><td className="p-pad-xs text-right tabular-nums">{moeda(det.totais.valor_com_taxa)}</td>
                <td className="p-pad-xs" colSpan={4} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <h4 className="p-pad-xs text-body-sm font-semibold">Recursos utilizados</h4>
        <table className="w-full min-w-[820px] border-collapse text-body-sm">
          <thead>
            <tr className="border-b border-border text-left text-fg-muted">
              <th className="p-pad-xs">Conta corrente</th><th className="p-pad-xs">Titular</th><th className="p-pad-xs">Modalidade</th>
              <th className="p-pad-xs text-right">Valor</th><th className="p-pad-xs">Histórico</th>
            </tr>
          </thead>
          <tbody>
            {!det?.recursos.length && <tr><td colSpan={5} className="p-pad-md text-center text-fg-muted">—</td></tr>}
            {det?.recursos.map((m) => (
              <tr key={m.codmovconta} className="border-b border-border">
                <td className="p-pad-xs">{m.nroconta ?? ''}</td><td className="p-pad-xs">{m.titular ?? ''}</td><td className="p-pad-xs">{m.modalidade ?? ''}</td>
                <td className={`p-pad-xs text-right tabular-nums ${m.valor < 0 ? 'text-fg-danger' : ''}`}>{moeda(m.valor)}</td><td className="p-pad-xs">{m.historico ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!somenteConsulta && (
        <div className="flex flex-wrap gap-gp-sm">
          {/* o btnReverterBaixa não tem Tag: vale quem abriu a tela (BTNCONSULTA) — a rota confere */}
          <Button label="&Reverter baixa" variant="outline" disabled={ocupado || !det || !pode('BTNCONSULTA')} onClick={() => void reverter()} />
        </div>
      )}

      {pesquisando && (
        <Pesquisa resourcePath="financeiro/cartao-consulta-baixa" onFechar={() => setPesquisando(false)}
          onSelecionar={(l) => { setPesquisando(false); const lote = Number(l.lote ?? 0); if (lote > 0) void abrir(lote); }} />
      )}
    </div>
  );
}
