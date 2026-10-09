import { lazy, Suspense, useEffect, useState } from 'react';
import { Modal } from '../../shared/ui/Modal';
import { CadMasterEmbutido, cadastroDaPesquisa } from '../../shared/cadmaster/CadMasterEmbutido';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';
import type { PendenciaSped } from './spedApi';

const NfCadMaster = lazy(async () => ({ default: (await import('../nf/NfCadMaster')).NfCadMaster }));

/** o recurso da Pesquisa cujo cadastro o "Corrigir" abre por cima (o `AbreTela` do legado: TfrmCadCFOP, TfrmCadProduto, TfrmCadClientes) */
const RECURSO: Record<string, string> = { cfop: 'lookup/cfops', produto: 'lookup/produtos', parceiro: 'lookup/parceiros' };

/**
 * PENDÊNCIAS SPED (`TFrmPendenciasSPED`, UPendenciasSPED.pas): a grade das pendências ("Descrição da pendência", "Código", "Descrição" e,
 * na verificação de NCM, o "Complemento" com o NCM), o rodapé "Quantidade de registros: N", e:
 *  - Corrigir (ou o duplo clique): abre o cadastro do registro por cima (`AbreTela`) — o CFOP, o produto, a nota, o parceiro; a operadora
 *    de cartão abre a tela dela em outra aba; ao fechar, a análise refaz (`AnalisaPendencias`) e, sem pendência, a janela fecha;
 *  - &Exportar: a grade em planilha (o `ExportGridToXLSX`; aqui o CSV que o Excel abre);
 *  - &Sair.
 */
export function PendenciasSpedModal({ titulo, pendencias, onReanalisar, onFechar }: {
  titulo: string;
  pendencias: PendenciaSped[];
  /** refaz a análise depois do Corrigir; devolve a lista nova */
  onReanalisar: () => Promise<PendenciaSped[]>;
  onFechar: () => void;
}) {
  const [linhas, setLinhas] = useState(pendencias);
  const [sel, setSel] = useState(0);
  const [corrigindo, setCorrigindo] = useState<PendenciaSped | null>(null);
  useEffect(() => setLinhas(pendencias), [pendencias]);
  const comComplemento = linhas.some((l) => l.complemento != null);

  const reanalisar = async () => {
    const nova = await onReanalisar();
    setLinhas(nova);
    setSel((s) => Math.min(s, Math.max(0, nova.length - 1)));
    if (!nova.length) onFechar();
  };
  const corrigir = (i = sel) => {
    const p = linhas[i];
    if (!p) return;
    if (p.abrir.cadastro === 'operadora') {
      window.open(`/cadastro/operadoras?codigo=${p.abrir.id}`, '_blank');
      return;
    }
    setCorrigindo(p);
  };
  const exportar = () => exportarGradeCsv(linhas, [
    { titulo: 'Descrição da pendência', valor: (l) => l.descricao },
    { titulo: 'Código', valor: (l) => l.codigo },
    { titulo: 'Descrição', valor: (l) => l.descricao_registro },
    ...(comComplemento ? [{ titulo: 'Complemento', valor: (l: PendenciaSped) => l.complemento ?? '' }] : []),
  ], 'Pendencias');

  const cadastro = corrigindo && corrigindo.abrir.cadastro !== 'nf' ? cadastroDaPesquisa(RECURSO[corrigindo.abrir.cadastro] ?? '') : null;
  const fecharCadastro = () => { setCorrigindo(null); void reanalisar(); };

  return (
    <>
      {corrigindo && (
        <Modal open onClose={fecharCadastro} size="lg" title={cadastro?.titulo ?? 'Nota fiscal'} className="w-[96vw] max-w-[1400px] max-h-[92vh] overflow-y-auto">
          <CadMasterEmbutido.Provider value={{ inicial: { id: corrigindo.abrir.id }, onGravou: () => undefined, onFechar: fecharCadastro }}>
            {corrigindo.abrir.cadastro === 'nf'
              ? <Suspense fallback={<p className="p-pad-md text-body-sm text-fg-muted">Abrindo a nota…</p>}><NfCadMaster tipo={corrigindo.abrir.tipo_nf ?? 'S'} /></Suspense>
              : cadastro?.render({}) ?? <p className="p-pad-md text-body-sm text-fg-muted">Cadastro indisponível.</p>}
          </CadMasterEmbutido.Provider>
        </Modal>
      )}
      <Modal open={!corrigindo} onClose={onFechar} size="lg" title={titulo} className="w-[96vw] max-w-[1100px]"
        primaryAction={{ label: 'Corrigir', onClick: () => corrigir(), disabled: !linhas.length }}
        tertiaryAction={{ label: '&Exportar', onClick: exportar, disabled: !linhas.length }}
        secondaryAction={{ label: '&Sair', onClick: onFechar }}>
        <div className="max-h-[60vh] overflow-auto rounded-radius-base border border-border">
          <table className="w-full text-body-sm">
            <thead className="sticky top-0 bg-bg-subtle text-left">
              <tr>
                <th className="px-pad-sm py-pad-xs">Descrição da pendência</th>
                <th className="px-pad-sm py-pad-xs">Código</th>
                <th className="px-pad-sm py-pad-xs">Descrição</th>
                {comComplemento && <th className="px-pad-sm py-pad-xs">Complemento</th>}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={`${l.tipo}-${l.codigo}-${i}`} onClick={() => setSel(i)} onDoubleClick={() => { setSel(i); corrigir(i); }}
                  aria-selected={i === sel} className={`cursor-pointer border-t border-border ${i === sel ? 'bg-bg-subtle font-semibold' : ''}`}>
                  <td className="px-pad-sm py-pad-xs">{l.descricao}</td>
                  <td className="px-pad-sm py-pad-xs tabular-nums">{l.codigo}</td>
                  <td className="px-pad-sm py-pad-xs">{l.descricao_registro}</td>
                  {comComplemento && <td className="px-pad-sm py-pad-xs tabular-nums">{l.complemento ?? ''}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-gp-xs text-body-sm text-fg-muted">Quantidade de registros: {linhas.length}</p>
      </Modal>
    </>
  );
}
