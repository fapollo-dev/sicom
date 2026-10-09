import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Button } from '../../shared/ui/Button';
import { DateField } from '../../shared/ui/DateField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { useMensagem } from '../../shared/mensagem';
import { PendenciasSpedModal } from './PendenciasSpedModal';
import { analisarPendenciasSped, gerarSpedFiscal, type ArquivoSped, type PendenciaSped } from './spedApi';

/** o arquivo do SPED vai em ISO-8859-1, como o ACBr grava (o PVA lê o texto em latin-1); o que não cabe vira '?' */
export function baixarArquivoSped(nome: string, texto: string): void {
  const bytes = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    bytes[i] = c <= 0xff ? c : 0x3f;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/plain;charset=iso-8859-1' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * GERADOR SPED FISCAL — EFD ICMS/IPI (`FRMSPEDFISCAL`, Uspedfiscal.pas — "SPED ICMS/IPI"; 896 acessos, 25 operadores). O `&Gerar` do
 * legado (`btnOkClick`): o pré-processamento, o PRÉ-VALIDADOR (marcado por padrão — as pendências aparecem e, ao sair delas, a geração
 * segue: não bloqueia), a geração dos blocos e o arquivo `SPED_<CNPJ>_<ddmmaaaa>.txt` ("Arquivo gerado com sucesso..."). A loja é a do
 * login. As opções de geração da tela do legado (entradas/saídas, código do produto, C140/C113/C176/C191, E200/E500, bloco K, inventário
 * com data, as somas em outras despesas, CST 049/041, 5929 zerado, ICMS ST…) ainda não chegaram ao gerador do Apollo — dossiê
 * `Uspedfiscal-blocoC.md`; o gerador usa o padrão do `.dfm`.
 */
export function SpedFiscalPage() {
  const mensagem = useMensagem();
  const [dtini, setDtini] = useState<string | undefined>();
  const [dtfim, setDtfim] = useState<string | undefined>();
  const [preValidador, setPreValidador] = useState<'S' | 'N'>('S');
  const [pendencias, setPendencias] = useState<PendenciaSped[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<ArquivoSped | null>(null);

  const gerarArquivo = async () => {
    if (!dtini || !dtfim) return;
    setOcupado(true);
    try {
      const r = await gerarSpedFiscal(dtini, dtfim);
      baixarArquivoSped(r.nomeArquivo, r.arquivo);
      setResultado(r);
      mensagem.sucesso('Arquivo gerado com sucesso...');
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const gerar = async () => {
    if (!dtini || !dtfim) { mensagem.erro(new Error('Informe a competência (data inicial e final).')); return; }
    if (dtini > dtfim) { mensagem.erro(new Error('A data final não pode ser anterior à inicial.')); return; }
    setResultado(null);
    if (preValidador === 'S') {
      setOcupado(true);
      try {
        const { pendencias: p } = await analisarPendenciasSped('fiscal', dtini, dtfim);
        if (p.length) { setPendencias(p); return; }
      } catch (e) { mensagem.erro(e); return; } finally { setOcupado(false); }
    }
    await gerarArquivo();
  };

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="SPED ICMS/IPI" description="Geração do EFD ICMS/IPI da loja do login" />
      <section className="flex flex-col gap-form-gap rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <fieldset className="flex flex-wrap items-end gap-gp-sm">
          <legend className="text-body-sm font-semibold text-fg-muted">Parâmetros obrigatórios de geração</legend>
          <div className="w-44"><DateField label="Competência: de" value={dtini} onChange={setDtini} /></div>
          <div className="w-44"><DateField label="até" value={dtfim} onChange={setDtfim} /></div>
        </fieldset>
        <fieldset className="flex flex-wrap items-center gap-gp-sm">
          <legend className="text-body-sm font-semibold text-fg-muted">Processos pré-geração</legend>
          <CheckboxField label="Pré-validador" value={preValidador} onChange={(v) => setPreValidador(v === 'S' ? 'S' : 'N')} />
        </fieldset>
        <div className="flex gap-gp-sm">
          <Button label={ocupado ? 'Gerando…' : '&Gerar'} disabled={ocupado} onClick={() => void gerar()} />
        </div>
      </section>

      {resultado && (
        <section className="flex flex-col gap-gp-xs rounded-radius-md border border-border bg-bg-surface p-pad-md text-body-sm">
          <p><b>{resultado.nomeArquivo}</b> — {resultado.linhas.toLocaleString('pt-BR')} linhas, {resultado.documentos.toLocaleString('pt-BR')} documentos.</p>
          {resultado.parcial && <p className="text-fg-muted">{resultado.aviso}</p>}
          {!resultado.validacao.ok && (
            <div>
              <p className="font-semibold text-fg-danger">O validador estrutural apontou {resultado.validacao.erros.length} problema(s):</p>
              <ul className="list-disc pl-pad-md">{resultado.validacao.erros.slice(0, 50).map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      {pendencias && (
        <PendenciasSpedModal titulo="Pendências SPED" pendencias={pendencias}
          onReanalisar={async () => (dtini && dtfim ? (await analisarPendenciasSped('fiscal', dtini, dtfim)).pendencias : [])}
          // o ShowModal do PreValidador volta e a geração segue (Uspedfiscal.pas:4380 → ConfigGeracaoArquivoSPED)
          onFechar={() => { setPendencias(null); void gerarArquivo(); }} />
      )}
    </div>
  );
}
