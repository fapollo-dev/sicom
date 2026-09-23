import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@apollosg/design-system';
import type { NfItemDto } from '@apollo/shared';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { listarScrapsDisponiveis, previaScrapNf, type PreviaScrapNf, type ScrapDisponivel, type CredenciaisLiberacao } from './nfScrapApi';

/**
 * IMPORTAR SCRAP para a nota de saída — a opção "SCRAP" do importar da NF (`uNF.pas:1880`): a pesquisa `GET_SCRAP`
 * com multisseleção e as cores do legado (verde = importado; azul = NF-e enviada; vermelho = cancelada; fúcsia =
 * denegada), a prévia dos itens (agrupados por produto, a custo) e, se algum já foi importado, a liberação por login
 * (`USUARIOS_LIBERAM_SCRAP_NF`). Como no legado, o vínculo (PEDIDO_NF + IMPORTADO) só acontece no GRAVAR da nota.
 */
const fmtQ = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function corStatus(s: ScrapDisponivel): { texto: string; classe: string } | null {
  const st = s.status_nfe ?? '';
  if (st.startsWith('NFE ENVIADA')) return { texto: `Importado e NF-e emitida · NF ${s.nronf ?? s.codnf}`, classe: 'text-fg-info' };
  if (st.startsWith('NFE CANCELADA')) return { texto: `Importado e NF-e cancelada · NF ${s.nronf ?? s.codnf}`, classe: 'text-fg-danger' };
  if (st.startsWith('NFE DENEGADA')) return { texto: `Importado e NF-e denegada · NF ${s.nronf ?? s.codnf}`, classe: 'text-fg-danger' };
  if (s.importado === 'S') return { texto: s.codnf ? `Importado · NF ${s.nronf ?? s.codnf}` : 'Importado', classe: 'text-fg-success' };
  return null;
}

interface Props {
  onFechar: () => void;
  /** entrega o cabeçalho sugerido, os itens e os scraps (com a liberação, se houve) para o vínculo no gravar */
  onConfirmar: (r: { previa: PreviaScrapNf; credenciais: CredenciaisLiberacao }) => void;
}

export function NfScrapModal({ onFechar, onConfirmar }: Props) {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<ScrapDisponivel[]>([]);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [previa, setPrevia] = useState<PreviaScrapNf | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [pedirLiberacao, setPedirLiberacao] = useState(false);
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');

  useEffect(() => {
    let vivo = true;
    listarScrapsDisponiveis().then((r) => { if (vivo) setLista(r); }).catch((e) => mensagem.erro(e));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const algumImportado = useMemo(() => lista.some((s) => marcados.has(s.codscrap) && s.importado === 'S'), [lista, marcados]);

  const alternar = (cod: number, v: 'S' | 'N') => {
    setPrevia(null);
    setMarcados((s) => { const n = new Set(s); if (v === 'S') n.add(cod); else n.delete(cod); return n; });
  };

  const calcular = async () => {
    if (!marcados.size) { mensagem.erro('Selecione ao menos um scrap.'); return; }
    // o legado pergunta antes ("Existem SCRAP's que já foram importados. Deseja continuar?") e pede o login
    if (algumImportado && (!login || !senha)) { setPedirLiberacao(true); return; }
    setCarregando(true);
    try {
      setPrevia(await previaScrapNf({ codscraps: Array.from(marcados), ...(algumImportado ? { login, senha } : {}) }));
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  };

  const incluir = () => {
    if (!previa) return;
    onConfirmar({ previa, credenciais: previa.reimportados.length ? { login, senha } : {} });
  };

  return (
    <Modal
      open
      onClose={onFechar}
      size="lg"
      title="Importar SCRAP"
      primaryAction={{ label: 'Incluir na nota', onClick: incluir, disabled: !previa || !previa.itens.length }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-form-gap">
        <small className="text-fg-muted">
          A nota de perda é emitida para a própria empresa (CFOP 5927 na UF, 6927 fora). O estoque baixa quando a nota for processada.
        </small>
        {lista.length === 0 ? (
          <small className="text-fg-muted">Nenhum scrap nesta empresa.</small>
        ) : (
          <div className="max-h-72 overflow-y-auto rounded-md border border-border p-gp-xs">
            {lista.map((s) => {
              const st = corStatus(s);
              const bloqueado = s.mov_estoque === 'S';
              return (
                <div key={s.codscrap} className="flex items-center justify-between gap-gp-sm py-0.5">
                  <CheckboxField
                    label={`${s.codscrap} — ${s.dt_cadastro ? new Date(s.dt_cadastro).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : ''} · ${s.descricao ?? s.razao ?? ''} · ${s.itens} item(ns) · ${fmtBRL(Number(s.valor) || 0)}`}
                    value={marcados.has(s.codscrap) ? 'S' : 'N'}
                    onChange={(v) => alternar(s.codscrap, v)}
                    disabled={bloqueado}
                  />
                  {bloqueado ? <small className="text-fg-muted">estoque já baixado no scrap</small> : st && <small className={st.classe}>{st.texto}</small>}
                </div>
              );
            })}
          </div>
        )}

        {(pedirLiberacao || (algumImportado && (login || senha))) && (
          <div className="flex flex-col gap-gp-xs rounded-md border border-border p-gp-sm">
            <small className="text-fg-danger">Existem SCRAP&apos;s que já foram importados. Para continuar, um usuário que libera a reimportação informa o login e a senha.</small>
            <div className="flex flex-wrap gap-gp-sm">
              <div className="w-48"><Field label="&Login" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" /></div>
              <div className="w-48"><Field label="&Senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="off" /></div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-gp-sm">
          <Button label="&Calcular itens" variant="soft" onClick={() => void calcular()} disabled={carregando || !marcados.size} />
        </div>

        {previa && (
          <div className="flex flex-col gap-gp-xs">
            <small>
              CFOP da nota <strong>{previa.cfop}</strong> · {previa.itens.length} item(ns) · scraps {previa.scraps.join(', ')}
              {previa.reimportados.length > 0 && <> · reimportação liberada: {previa.reimportados.join(', ')}</>}
            </small>
            <div className="max-h-56 overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-fg-muted"><th className="px-2 py-1">Produto</th><th className="px-2 py-1 text-right">Qtde</th><th className="px-2 py-1 text-right">Custo</th><th className="px-2 py-1">CFOP</th><th className="px-2 py-1">Alíq.</th></tr></thead>
                <tbody>
                  {previa.itens.map((it: NfItemDto) => (
                    <tr key={`${it.codproduto}-${it.idproduto_filho ?? ''}`} className="border-t border-border">
                      <td className="px-2 py-1">{it.codproduto}{it.idproduto_filho ? ` (filho ${it.idproduto_filho})` : ''} — {it.codprodnota ?? ''}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtQ(Number(it.quantidade) || 0)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtBRL(Number(it.vrcusto) || 0)}</td>
                      <td className="px-2 py-1">{it.cfop}</td>
                      <td className="px-2 py-1">{it.aliquota}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
