import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Button } from '../../shared/ui/Button';
import { DateField } from '../../shared/ui/DateField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { LookupField } from '../../shared/ui/LookupField';
import { NumberField } from '../../shared/ui/NumberField';
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
 * (o legado grava ao fechar a tela). As opções da tela com o padrão do `.dfm`: a finalidade (com o recibo da anterior na retificação, que
 * o legado não pedia), a forma de apuração, "Gerar M100/810", "Gerar CFOP 5929", as alíquotas do CST 05 (0,65 / 3,00) e os três
 * indicadores do 0110. Fora: Entradas/Saidas (o legado nunca lê) e C400/C490 (ECF — nenhuma venda de ECF em 2026).
 */
export function SpedContribuicoesPage() {
  const mensagem = useMensagem();
  const [dtini, setDtini] = useState<string | undefined>();
  const [dtfim, setDtfim] = useState<string | undefined>();
  const [preValidador, setPreValidador] = useState<'S' | 'N'>('S');
  // as opções da tela (UspedPisCofins.dfm) — o pedido só leva o que mudou do padrão
  const [finalidade, setFinalidade] = useState<0 | 1>(0);
  const [recibo, setRecibo] = useState('');
  const [forma, setForma] = useState<'analitica' | 'sintetica'>('analitica');
  const [gerarM, setGerarM] = useState<'S' | 'N'>('S');
  const [gera5929, setGera5929] = useState<'S' | 'N'>('N');
  const [aliqPis, setAliqPis] = useState<number | undefined>(0.65);
  const [aliqCofins, setAliqCofins] = useState<number | undefined>(3);
  const [incidencia, setIncidencia] = useState<1 | 2 | 3 | null>(null);
  const [metodo, setMetodo] = useState<1 | 2>(2);
  const [tipoCont, setTipoCont] = useState<1 | 2>(1);
  const opcoesDoPedido = () => ({
    ...(finalidade === 1 ? { finalidade: 1 as const, numReciboAnterior: recibo } : {}),
    ...(forma === 'sintetica' ? { formaApuracao: 'sintetica' as const } : {}),
    ...(gerarM === 'N' ? { gerarM: false } : {}),
    ...(gera5929 === 'S' ? { gera5929: true } : {}),
    ...((aliqPis ?? 0) !== 0.65 ? { aliqPis: aliqPis ?? 0 } : {}),
    ...((aliqCofins ?? 0) !== 3 ? { aliqCofins: aliqCofins ?? 0 } : {}),
    ...(incidencia != null ? { incidencia } : {}),
    ...(metodo !== 2 ? { metodoApropriacao: metodo } : {}),
    ...(tipoCont !== 1 ? { tipoContribuicao: tipoCont } : {}),
  });
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
      const r = await gerarSpedContribuicoes(dtini, dtfim, opcoesDoPedido());
      baixarArquivoSped(r.nomeArquivo, r.arquivo);
      setResultado(r);
      mensagem.sucesso('Arquivo Gerado com Sucesso');
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const gerar = async () => {
    if (!dtini || !dtfim) { mensagem.erro(new Error('Informe a competência (data inicial e final).')); return; }
    if (dtini > dtfim) { mensagem.erro(new Error('A data final não pode ser anterior à inicial.')); return; }
    if (finalidade === 1 && !recibo.trim()) { mensagem.erro(new Error('Na retificação, informe o número do recibo da escrituração anterior.')); return; }
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
        <div className="grid grid-cols-1 gap-gp-sm md:grid-cols-2">
          <fieldset className="flex flex-wrap items-end gap-gp-sm">
            <legend className="text-body-sm font-semibold text-fg-muted">Finalidade do Arquivo</legend>
            <label className="flex items-center gap-1 text-body-sm"><input type="radio" name="finalidade-pc" checked={finalidade === 0} onChange={() => setFinalidade(0)} /> Original</label>
            <label className="flex items-center gap-1 text-body-sm"><input type="radio" name="finalidade-pc" checked={finalidade === 1} onChange={() => setFinalidade(1)} /> Retificação</label>
            {finalidade === 1 && (
              <label className="flex flex-col gap-gp-2xs text-body-sm">
                <span className="text-fg-muted">Recibo da escrituração anterior</span>
                <input aria-label="Recibo da escrituração anterior" className="rounded-radius-base border border-border bg-bg-default px-pad-sm py-pad-xs" value={recibo} onChange={(e) => setRecibo(e.target.value)} />
              </label>
            )}
          </fieldset>
          <fieldset className="flex flex-wrap items-center gap-gp-sm">
            <legend className="text-body-sm font-semibold text-fg-muted">Apurar registros de forma</legend>
            <label className="flex items-center gap-1 text-body-sm"><input type="radio" name="forma-pc" checked={forma === 'analitica'} onChange={() => setForma('analitica')} /> Analítica (Individual)</label>
            <label className="flex items-center gap-1 text-body-sm"><input type="radio" name="forma-pc" checked={forma === 'sintetica'} onChange={() => setForma('sintetica')} /> Sintético (Consolidado)</label>
          </fieldset>
          <fieldset className="flex flex-wrap items-center gap-gp-sm">
            <legend className="text-body-sm font-semibold text-fg-muted">Blocos</legend>
            <CheckboxField label="Gerar M100/810" value={gerarM} onChange={(v) => setGerarM(v === 'S' ? 'S' : 'N')} />
          </fieldset>
          <fieldset className="flex flex-wrap items-end gap-gp-sm">
            <legend className="text-body-sm font-semibold text-fg-muted">Outras opções</legend>
            <CheckboxField label="Gerar CFOP 5929" value={gera5929} onChange={(v) => setGera5929(v === 'S' ? 'S' : 'N')} />
            <div className="w-28"><NumberField label="Alíquota PIS" value={aliqPis} decimais={2} onChange={setAliqPis} /></div>
            <div className="w-28"><NumberField label="Alíquota COFINS" value={aliqCofins} decimais={2} onChange={setAliqCofins} /></div>
          </fieldset>
        </div>
        <fieldset className="grid grid-cols-1 gap-gp-sm md:grid-cols-3">
          <legend className="text-body-sm font-semibold text-fg-muted">Indicadores</legend>
          <label className="flex flex-col gap-gp-2xs text-body-sm">
            <span className="text-fg-muted">Indicador de método de apropriação de créditos</span>
            <select aria-label="Indicador de método de apropriação de créditos" className="rounded-radius-base border border-border bg-bg-default px-pad-sm py-pad-xs" value={metodo} onChange={(e) => setMetodo(Number(e.target.value) === 1 ? 1 : 2)}>
              <option value={1}>1 – Método de Apropriação Direta</option>
              <option value={2}>2 – Método de Rateio Proporcional (Receita Bruta)</option>
            </select>
            {metodo === 2 && <small className="text-fg-muted">O rateio proporcional exige o registro 0111, que o gerador (como o legado) não monta.</small>}
          </label>
          <label className="flex flex-col gap-gp-2xs text-body-sm">
            <span className="text-fg-muted">Indicador do Tipo de Contribuição Apurada no periodo</span>
            <select aria-label="Indicador do Tipo de Contribuição Apurada no periodo" className="rounded-radius-base border border-border bg-bg-default px-pad-sm py-pad-xs" value={tipoCont} onChange={(e) => setTipoCont(Number(e.target.value) === 2 ? 2 : 1)}>
              <option value={1}>1 – Contribuição Exclusivamente a Alíquota Básica</option>
              <option value={2}>2 – Contribuição a Alíquotas Específicas (Diferenciadas e/ou por Unidade de Medida de Produto)</option>
            </select>
          </label>
          <label className="flex flex-col gap-gp-2xs text-body-sm">
            <span className="text-fg-muted">Indicador da incidência tributario no periodo</span>
            <select aria-label="Indicador da incidência tributario no periodo" className="rounded-radius-base border border-border bg-bg-default px-pad-sm py-pad-xs" value={incidencia ?? 1} onChange={(e) => setIncidencia(Number(e.target.value) as 1 | 2 | 3)}>
              <option value={1}>1 – Incidência exclusivamente no regime não-cumulativo</option>
              <option value={2}>2 – Incidência exclusivamente no regime cumulativo</option>
              <option value={3}>3 – Incidência nos regimes não-cumulativo e cumulativo</option>
            </select>
          </label>
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
