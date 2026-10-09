import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Button } from '../../shared/ui/Button';
import { DateField } from '../../shared/ui/DateField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { LookupField } from '../../shared/ui/LookupField';
import { useMensagem } from '../../shared/mensagem';
import { PendenciasSpedModal } from './PendenciasSpedModal';
import { baixarArquivoSped } from './SpedFiscalPage';
import {
  analisarPendenciasSped, gerarSpedContribuicoes, gravarContasPc, lerContasPc, type ArquivoSped, type ContasPc, type PendenciaSped,
} from './spedApi';

const REGISTROS = ['m400', 'm410', 'm800', 'm810'] as const;

/**
 * SPED CONTRIBUIÇÕES — EFD PIS/COFINS (`FRMSPEDPISCOFINS`, UspedPisCofins.pas). O `&Gerar` do legado (`btnOkClick`): grava e confere a
 * "Configuração de contas" (`ValidaConfiguracoesSPED` — "Informe o plano contábil para o registro M400." …), o PRÉ-VALIDADOR (marcado
 * por padrão; não bloqueia), exige a apuração do período ("Não existe apuração para o periodo informado!") e gera
 * `SPED_CONTRIBUICOES_<CNPJ>_<ddmmaaaa>.txt` ("Arquivo Gerado com Sucesso"). As contas são da loja do login e ficam gravadas ao trocar
 * (o legado grava ao fechar a tela). As demais opções da tela do legado (finalidade, forma de apuração, entradas/saídas, C400/M100-810/
 * C490, CFOP 5929, alíquotas, indicadores) ainda não chegaram ao gerador do Apollo.
 */
export function SpedContribuicoesPage() {
  const mensagem = useMensagem();
  const [dtini, setDtini] = useState<string | undefined>();
  const [dtfim, setDtfim] = useState<string | undefined>();
  const [preValidador, setPreValidador] = useState<'S' | 'N'>('S');
  const [contas, setContas] = useState<ContasPc | null>(null);
  const [pendencias, setPendencias] = useState<PendenciaSped[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<ArquivoSped | null>(null);

  useEffect(() => { void lerContasPc().then(setContas).catch((e) => mensagem.erro(e)); }, [mensagem]);

  const trocarConta = async (r: (typeof REGISTROS)[number], cod: string | undefined) => {
    try { setContas(await gravarContasPc({ [r]: cod ? Number(cod) : null })); } catch (e) { mensagem.erro(e); }
  };

  const gerarArquivo = async () => {
    if (!dtini || !dtfim) return;
    setOcupado(true);
    try {
      const r = await gerarSpedContribuicoes(dtini, dtfim);
      baixarArquivoSped(r.nomeArquivo, r.arquivo);
      setResultado(r);
      mensagem.sucesso('Arquivo Gerado com Sucesso');
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const gerar = async () => {
    if (!dtini || !dtfim) { mensagem.erro(new Error('Informe a competência (data inicial e final).')); return; }
    if (dtini > dtfim) { mensagem.erro(new Error('A data final não pode ser anterior à inicial.')); return; }
    setResultado(null);
    // ValidaConfiguracoesSPED: as quatro contas, na ordem
    for (const r of REGISTROS) {
      if (!contas?.[r]) { mensagem.erro(new Error(`Informe o plano contábil para o registro ${r.toUpperCase()}.`)); return; }
    }
    if (preValidador === 'S') {
      setOcupado(true);
      try {
        const { pendencias: p } = await analisarPendenciasSped('piscofins', dtini, dtfim);
        if (p.length) { setPendencias(p); return; }
      } catch (e) { mensagem.erro(e); return; } finally { setOcupado(false); }
    }
    await gerarArquivo();
  };

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="SPED Contribuições" description="Geração do EFD PIS/COFINS da loja do login" />
      <section className="flex flex-col gap-form-gap rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <fieldset className="flex flex-wrap items-end gap-gp-sm">
          <legend className="text-body-sm font-semibold text-fg-muted">Parâmetros obrigatórios</legend>
          <div className="w-44"><DateField label="Competência: de" value={dtini} onChange={setDtini} /></div>
          <div className="w-44"><DateField label="até" value={dtfim} onChange={setDtfim} /></div>
        </fieldset>
        <fieldset className="grid grid-cols-1 gap-gp-sm md:grid-cols-2">
          <legend className="text-body-sm font-semibold text-fg-muted">Configuração de contas</legend>
          {REGISTROS.map((r) => (
            <LookupField key={r} label={`Conta contábil ${r.toUpperCase()}`} recurso="lookup/plano-contas" campoDigitado="codireduzido" campoCodigo="codplanocontas"
              descricao="descricao" fixos={{ classe: 'ANALITICA', tipo: 'EMPRESA' }} value={contas?.[r]?.codplanocontas ?? null}
              onChange={(cod) => void trocarConta(r, cod)} />
          ))}
        </fieldset>
        <fieldset className="flex flex-wrap items-center gap-gp-sm">
          <legend className="text-body-sm font-semibold text-fg-muted">Processos de pré-geração</legend>
          <CheckboxField label="Pré-Validador" value={preValidador} onChange={(v) => setPreValidador(v === 'S' ? 'S' : 'N')} />
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
          onReanalisar={async () => (dtini && dtfim ? (await analisarPendenciasSped('piscofins', dtini, dtfim)).pendencias : [])}
          onFechar={() => { setPendencias(null); void gerarArquivo(); }} />
      )}
    </div>
  );
}
