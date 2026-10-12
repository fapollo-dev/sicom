import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Button } from '../../shared/ui/Button';
import { DateField } from '../../shared/ui/DateField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { useMensagem } from '../../shared/mensagem';
import { hojeNaLoja } from '../../shared/tempo';
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
 * login. As opções da tela com o padrão do `.dfm`: a "Finalidade do Arquivo", "Gerar com os registros de" (Entradas/Saidas), o "Codigo
 * Produto" (EAN/PLU), o "C113 / 114" (marcado), "Somar em Outras despesas" (ICMS ST, FCP ST, IPI), as "Outras opções de geração" do bloco
 * C (5929 zerado no C170 e no C190, CST 049, C170 das notas de emissão própria, ICMS ST, IPI e ICMS-ST no total do item) e o Bloco H
 * ("Gerar H001 (Inventário)", a data da FOLHA, o motivo e a correção tributária), o C140/C141 (com "todos modelos") e o C191. Ainda fora (dossiê
 * `Uspedfiscal-blocoC.md`): bloco K, 1700, NF Goiana, as NFC-e com itens/participante e o CST 041 do C490; o E500 não tem apuração.
 */
/** as opções booleanas da tela e o padrão do `.dfm` — o pedido só leva o que o operador mudou */
const PADRAO = {
  entradas: true, saidas: true, somarIcmsStOutras: false, somarFcpStOutras: false, somarIpiOutras: false, zerado5929C170: false,
  zerado5929Documento: false, cst49: false, c170Proprias: false, gerarIcmsSt: false, destacarIpiStItem: false, c140: false, c140TodosModelos: false, c191: false,
};
type OpcaoBool = keyof typeof PADRAO;
export function SpedFiscalPage() {
  const mensagem = useMensagem();
  const [dtini, setDtini] = useState<string | undefined>();
  const [dtfim, setDtfim] = useState<string | undefined>();
  const [preValidador, setPreValidador] = useState<'S' | 'N'>('S');
  const [pendencias, setPendencias] = useState<PendenciaSped[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<ArquivoSped | null>(null);
  // o Bloco H: "Gerar H001 (Inventário)" (desmarcado), a "Data Inventário" (hoje — DefaultToday), o motivo (01) e a correção tributária
  const [gerarH, setGerarH] = useState<'S' | 'N'>('N');
  const [dtInventario, setDtInventario] = useState<string | undefined>(hojeNaLoja());
  const [motivo, setMotivo] = useState(1);
  const [correcao, setCorrecao] = useState<'S' | 'N'>('N');
  // Bloco C: o "C113 / 114" vem marcado (chkGerarC113C114, Uspedfiscal.dfm)
  const [c113, setC113] = useState<'S' | 'N'>('S');
  const [opc, setOpc] = useState(PADRAO);
  const [finalidade, setFinalidade] = useState<0 | 1>(0);
  const [codigoProduto, setCodigoProduto] = useState<'ean' | 'plu'>('plu');
  const caixa = (k: OpcaoBool, rotulo: string) => (
    <CheckboxField label={rotulo} value={opc[k] ? 'S' : 'N'} onChange={(v) => setOpc((o) => ({ ...o, [k]: v === 'S' }))} />
  );

  const gerarArquivo = async () => {
    if (!dtini || !dtfim) return;
    setOcupado(true);
    try {
      const r = await gerarSpedFiscal(dtini, dtfim, {
        ...(gerarH === 'S' && dtInventario ? { inventario: { data: dtInventario, motivo, correcao: correcao === 'S' } } : {}),
        ...(c113 === 'N' ? { c113c114: false } : {}),
        ...(finalidade === 1 ? { finalidade: 1 as const } : {}),
        ...(codigoProduto === 'ean' ? { codigoProduto: 'ean' as const } : {}),
        ...Object.fromEntries((Object.keys(PADRAO) as OpcaoBool[]).filter((k) => opc[k] !== PADRAO[k]).map((k) => [k, opc[k]])),
      });
      baixarArquivoSped(r.nomeArquivo, r.arquivo);
      setResultado(r);
      mensagem.sucesso('Arquivo gerado com sucesso...');
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const gerar = async () => {
    if (!dtini || !dtfim) { mensagem.erro(new Error('Informe a competência (data inicial e final).')); return; }
    if (dtini > dtfim) { mensagem.erro(new Error('A data final não pode ser anterior à inicial.')); return; }
    if (gerarH === 'S' && !dtInventario) { mensagem.erro(new Error('Informe a data do inventário.')); return; }
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
          <legend className="text-body-sm font-semibold text-fg-muted">Bloco C</legend>
          {caixa('c140', 'C140')}
          {caixa('c191', 'C191')}
          <CheckboxField label="C113 / 114" value={c113} onChange={(v) => setC113(v === 'S' ? 'S' : 'N')} />
        </fieldset>
        <div className="grid grid-cols-1 gap-gp-sm md:grid-cols-2">
          <fieldset className="flex flex-wrap items-center gap-gp-sm">
            <legend className="text-body-sm font-semibold text-fg-muted">Finalidade do Arquivo</legend>
            <label className="flex items-center gap-1 text-body-sm"><input type="radio" name="finalidade" checked={finalidade === 0} onChange={() => setFinalidade(0)} /> Original</label>
            <label className="flex items-center gap-1 text-body-sm"><input type="radio" name="finalidade" checked={finalidade === 1} onChange={() => setFinalidade(1)} /> Retificação</label>
          </fieldset>
          <fieldset className="flex flex-wrap items-center gap-gp-sm">
            <legend className="text-body-sm font-semibold text-fg-muted">Gerar com os registros de</legend>
            {caixa('entradas', 'Entradas')}
            {caixa('saidas', 'Saidas')}
          </fieldset>
          <fieldset className="flex flex-wrap items-center gap-gp-sm">
            <legend className="text-body-sm font-semibold text-fg-muted">Codigo Produto</legend>
            <label className="flex items-center gap-1 text-body-sm"><input type="radio" name="codigo-produto" checked={codigoProduto === 'ean'} onChange={() => setCodigoProduto('ean')} /> EAN</label>
            <label className="flex items-center gap-1 text-body-sm"><input type="radio" name="codigo-produto" checked={codigoProduto === 'plu'} onChange={() => setCodigoProduto('plu')} /> PLU</label>
          </fieldset>
          <fieldset className="flex flex-wrap items-center gap-gp-sm">
            <legend className="text-body-sm font-semibold text-fg-muted">Somar em Outras despesas</legend>
            {caixa('somarIcmsStOutras', 'ICMS ST')}
            {caixa('somarFcpStOutras', 'FCP ST')}
            {caixa('somarIpiOutras', 'IPI')}
          </fieldset>
        </div>
        <fieldset className="grid grid-cols-1 gap-gp-xs md:grid-cols-2">
          <legend className="text-body-sm font-semibold text-fg-muted">Outras opções de geração</legend>
          {caixa('zerado5929C170', 'Gerar 5929 Zerado C170')}
          {caixa('zerado5929Documento', 'Gerar 5929 Zerado C190')}
          {caixa('cst49', 'Gerar CST 049')}
          {caixa('c140TodosModelos', 'Gerar todos modelos de nota C140')}
          {caixa('c170Proprias', 'Gerar C170 notas de emissão própria')}
          {caixa('gerarIcmsSt', 'Gerar ICMS ST C100/C170/C190')}
          {caixa('destacarIpiStItem', 'Gerar C170 com IPI e ICMS-ST no total do item')}
        </fieldset>
        <fieldset className="flex flex-wrap items-end gap-gp-sm">
          <legend className="text-body-sm font-semibold text-fg-muted">Bloco H</legend>
          <div title="REGISTRO H001: abertura do bloco H. Obrigatoriamente IND_MOV 0 no período de referência fevereiro de cada ano; quem apresenta o inventário de 31/12 na EFD de dezembro ou janeiro deve repetir a informação na de fevereiro.">
            <CheckboxField label="Gerar H001 (Inventário)" value={gerarH} onChange={(v) => setGerarH(v === 'S' ? 'S' : 'N')} />
          </div>
          <div className="w-44"><DateField label="Data Inventário" value={dtInventario} disabled={gerarH !== 'S'} onChange={setDtInventario} /></div>
          <label className="flex flex-col gap-gp-2xs text-body-sm">
            <span className="text-fg-muted">Mot. inventário - H005:</span>
            <select aria-label="Mot. inventário - H005" disabled={gerarH !== 'S'} value={motivo} onChange={(e) => setMotivo(Number(e.target.value))}
              className="rounded-radius-base border border-border bg-bg-default px-pad-sm py-pad-xs">
              <option value={1}>01  Final do período</option>
              <option value={2}>02  Mudança de forma de tributação da mercadoria(ICMS)</option>
              <option value={3}>03  Solicitação da baixa cadastral, paralisação temp. e outras situações</option>
              <option value={4}>04  Alteração de regime de pagamento - condição do contribuinte</option>
              <option value={5}>05 Determinação dos FISCOS</option>
            </select>
          </label>
          <CheckboxField label="Correção Tributária" value={correcao} disabled={gerarH !== 'S'} onChange={(v) => setCorrecao(v === 'S' ? 'S' : 'N')} />
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
