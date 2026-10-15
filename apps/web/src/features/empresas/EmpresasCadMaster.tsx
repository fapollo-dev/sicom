import { Controller, type UseFormReturn } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { UFS, empresaSchema, EMPRESA_CAMPOS_LEGADO, type CriarEmpresaDto } from '@apollo/shared';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { DateField } from '../../shared/ui/DateField';
import { useEffect, useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { LookupField } from '../../shared/ui/LookupField';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { isErroResposta, type ErroResposta } from '@apollo/shared';

const UF_SIGLA_OPCOES = UFS.map((u) => ({ value: u.sigla, label: `${u.sigla} — ${u.nome}` }));
const CLASSFISCAL_OPCOES = [
  { value: 'LR', label: 'Lucro Real' },
  { value: 'SN', label: 'Simples Nacional' },
];
const FIGURAFISCAL_OPCOES = [
  { value: 'D', label: 'D — Distribuidor' },
  { value: 'O', label: 'O — Outros' },
];
const SN_OPCOES = [
  { value: 'S', label: 'Sim' },
  { value: 'N', label: 'Não' },
];
const AMBIENTE_OPCOES = [
  { value: '1', label: 'Produção' },
  { value: '2', label: 'Homologação' },
];

/** ISO do servidor → valor do <input type="datetime-local"> no fuso do navegador */
const paraLocal = (iso: unknown) => {
  if (!iso) return '';
  const d = new Date(String(iso instanceof Date ? iso.toISOString() : iso));
  if (Number.isNaN(d.getTime())) return '';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * os campos de código que o legado escolhe por Pesquisa e mostra com a descrição ao lado (os SearchEngine do UCadEmpresa): o centro de
 * custo (segPLC/segMulta/… — os DESCCODPLC_ e DESCRICAO_), o fornecedor (BtnBuscaFornecedorVoucherClick — os FORNECEDOR_) e a conta corrente
 * (EdtNroContaBaixaRecargaExit — NROCONTA e TITULAR_BAIXA_)
 */
type LkDef = { recurso: string; campoCodigo: string; descricao: string | ((l: Record<string, any>) => string); fixos?: Record<string, string> };
const LK_PLC: LkDef = { recurso: 'lookup/plc', campoCodigo: 'codplc', descricao: (l) => `${l.desccodplc ?? ''} - ${l.descricao ?? ''}` };
const LK_FORN: LkDef = { recurso: 'lookup/parceiros', campoCodigo: 'codparceiro', descricao: 'razao', fixos: { frn: 'S' } };
const LK_CONTA: LkDef = { recurso: 'lookup/contas-bancarias', campoCodigo: 'codigo', descricao: (l) => `${l.nro_conta ?? ''} - ${l.titular ?? ''}` };
export const LOOKUPS_EMPRESA: Record<string, LkDef> = {
  ccacresjuro: LK_PLC, ccacresjuroobtido: LK_PLC, ccdesconto: LK_PLC, ccdescontoobtido: LK_PLC, cctesouraria: LK_PLC,
  codplc_acrescimos_recebidos: LK_PLC, codplc_correspondente: LK_PLC, codplc_juros_recebidos: LK_PLC, codplc_recarga: LK_PLC,
  codplc_taxa_cartao_paga: LK_PLC, codplc_taxas_cartao: LK_PLC, codplc_trocosolidario: LK_PLC, codplc_voucher: LK_PLC, codplcfechamentoconvenio: LK_PLC,
  codfornecedor_correspondente: LK_FORN, codfornecedor_recarga: LK_FORN, codfornecedor_trocosolidario: LK_FORN, codfornecedor_voucher: LK_FORN,
  codconta_baixa_correspondente: LK_CONTA, codconta_baixa_recarga: LK_CONTA, codconta_pagamento: LK_CONTA,
};

/** campo de código com a Pesquisa e a descrição ao lado, ligado ao form */
function LkCampo({ form, name, label, def, editavel }: { form: UseFormReturn<CriarEmpresaDto>; name: string; label: string; def: LkDef; editavel: boolean }) {
  return (
    <Controller control={form.control} name={name as never} render={({ field }: any) => (
      <LookupField label={label} recurso={def.recurso} campoCodigo={def.campoCodigo} descricao={def.descricao} fixos={def.fixos}
        value={field.value != null && field.value !== '' ? String(field.value) : undefined} disabled={!editavel}
        onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)} />
    )} />
  );
}

/** as abas do legado com os campos que a tela não tinha (`empresa-legado.ts`), na ordem das abas do UCadEmpresa */
const ABAS_LEGADO = Array.from(new Set(EMPRESA_CAMPOS_LEGADO.map((c) => c.aba)));

/** os campos do UCadEmpresa (e do binário novo) por aba — recolhidos; segredos não voltam na leitura (digite para trocar) */
function CamposLegado({ form, editavel }: { form: UseFormReturn<CriarEmpresaDto>; editavel: boolean }) {
  return (
    <div className="flex flex-col gap-form-gap">
      {ABAS_LEGADO.map((aba) => (
        <details key={aba} className="rounded-radius-md border border-border p-pad-md">
          <summary className="cursor-pointer text-fg-muted">{aba}</summary>
          <div className="mt-pad-sm grid grid-cols-1 gap-form-gap sm:grid-cols-3">
            {EMPRESA_CAMPOS_LEGADO.filter((c) => c.aba === aba).map((c) => (
              <Controller
                key={c.coluna}
                control={form.control}
                name={c.coluna as never}
                render={({ field }: any) => {
                  const lk = LOOKUPS_EMPRESA[c.coluna];
                  if (lk) {
                    return <LookupField label={c.rotulo} recurso={lk.recurso} campoCodigo={lk.campoCodigo} descricao={lk.descricao} fixos={lk.fixos} disabled={!editavel}
                      value={field.value != null && field.value !== '' ? String(field.value) : undefined} onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)} />;
                  }
                  if (c.tipo === 'sn') return <CheckboxField label={c.rotulo} value={(field.value as string | undefined) ?? 'N'} onChange={field.onChange} disabled={!editavel} />;
                  if (c.tipo === 'inteiro' || c.tipo === 'numero') {
                    return <NumberField label={c.rotulo} value={field.value != null && field.value !== '' ? Number(field.value) : undefined} onChange={field.onChange} decimais={c.tipo === 'inteiro' ? 0 : 4} disabled={!editavel} />;
                  }
                  if (c.tipo === 'opcao') {
                    return <SelectField label={c.rotulo} options={(c.opcoes ?? []).map(([value, label]) => ({ value, label }))} value={field.value != null && field.value !== '' ? String(field.value) : undefined} onChange={(v) => field.onChange(v || undefined)} placeholder="—" disabled={!editavel} />;
                  }
                  if (c.tipo === 'data') return <DateField label={c.rotulo} value={field.value ? String(field.value).slice(0, 10) : undefined} onChange={field.onChange} disabled={!editavel} />;
                  if (c.tipo === 'datahora') {
                    // datetime-local é hora de parede sem fuso: mostra no fuso do navegador e grava ISO com offset
                    return (
                      <label className="flex flex-col gap-gp-2xs text-body-sm">
                        <span className="text-fg-muted">{c.rotulo}</span>
                        <input type="datetime-local" disabled={!editavel} value={paraLocal(field.value)}
                          className="rounded-radius-base border border-border bg-bg-default px-pad-sm py-pad-xs"
                          onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value).toISOString() : undefined)} />
                      </label>
                    );
                  }
                  return (
                    <Field label={c.rotulo} disabled={!editavel} maxLength={c.max} type={c.segredo ? 'password' : undefined}
                      placeholder={c.segredo ? 'não exibida — digite para trocar' : undefined} value={(field.value as string | undefined) ?? ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? undefined : e.target.value)} />
                  );
                }}
              />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

/** campo numérico (percentual/valor) ligado ao form via Controller. */
function NumCampo({ form, name, label, decimais = 2 }: { form: UseFormReturn<CriarEmpresaDto>; name: keyof CriarEmpresaDto; label: string; decimais?: number }) {
  return (
    <Controller
      control={form.control}
      name={name as never}
      render={({ field }) => (
        <NumberField
          label={label}
          value={field.value as number | undefined}
          onChange={(v) => field.onChange(v)}
          decimais={decimais}
          error={(form.formState.errors as Record<string, { message?: string }>)[name as string]?.message}
        />
      )}
    />
  );
}

/** campo select ligado ao form via Controller. */
function SelCampo({ form, name, label, options, placeholder }: { form: UseFormReturn<CriarEmpresaDto>; name: keyof CriarEmpresaDto; label: string; options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <Controller
      control={form.control}
      name={name as never}
      render={({ field }) => (
        <SelectField
          label={label}
          options={options}
          value={field.value != null ? String(field.value) : undefined}
          onChange={(v) => field.onChange(v || undefined)}
          placeholder={placeholder}
          error={(form.formState.errors as Record<string, { message?: string }>)[name as string]?.message}
        />
      )}
    />
  );
}

/**
 * Cadastro de EMPRESAS via <CadMaster> (corte 1). A empresa É o tenant: `idempresa` (= CODEMPRESA)
 * é DIGITADO (chave natural). Seções: Identificação/Endereço, Fiscal (regime/figura/IE/série),
 * Precificação/Financeiro. Adiado (dossiê): certificado/NFC-e/CTe/integrações/e-mail/contábil.
 */
export function EmpresasCadMaster() {
  return (
    <CadMaster<CriarEmpresaDto>
      titulo="Empresas"
      resourcePath="cadastro/empresas"
      pk="idempresa"
      log={{ form: 'FRMCADEMPRESA', chave: 'CODEMPRESA' }}
      pkGerada={false}
      colunasPesquisa={[
        { campo: 'codigo', label: 'Código', tipo: 'text', largura: 100 },
        { campo: 'razao', label: 'Razão social', tipo: 'text' },
        { campo: 'cnpj', label: 'CNPJ', tipo: 'text', largura: 160 },
        { campo: 'uf', label: 'UF', tipo: 'text', largura: 80 },
        { campo: 'classfiscal', label: 'Regime', tipo: 'text', largura: 100 },
      ]}
      schema={empresaSchema}
      defaultValues={{ classfiscal: 'LR', razao_social: '', cnpj: '' } as Partial<CriarEmpresaDto>}
      campos={({ form, editavel }) => {
        const err = (n: string) => (form.formState.errors as Record<string, { message?: string }>)[n]?.message;
        return (
          <div className="flex flex-col gap-form-gap">
            {/* Identificação */}
            <fieldset className="rounded-radius-md border border-border p-pad-md">
              <legend className="px-pad-xs text-fg-muted">Identificação</legend>
              <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
                <NumCampo form={form} name="idempresa" label="Código" decimais={0} />
                <div className="sm:col-span-2">
                  <Field label="&Razão social" disabled={!editavel} error={err('razao_social')} {...form.register('razao_social')} />
                </div>
                <Field label="Fantasia" disabled={!editavel} error={err('fantasia')} {...form.register('fantasia')} />
                <Field label="CNPJ" disabled={!editavel} error={err('cnpj')} {...form.register('cnpj')} />
                <Field label="&IE (Inscrição Estadual)" disabled={!editavel} error={err('insc')} {...form.register('insc')} />
                <Field label="Inscrição &Municipal" disabled={!editavel} error={err('im')} {...form.register('im')} />
                <Field label="&Telefone" disabled={!editavel} error={err('fone1')} {...form.register('fone1')} />
              </div>
            </fieldset>

            {/* Endereço */}
            <fieldset className="rounded-radius-md border border-border p-pad-md">
              <legend className="px-pad-xs text-fg-muted">Endereço</legend>
              <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <Field label="Endereço" disabled={!editavel} error={err('endereco')} {...form.register('endereco')} />
                </div>
                <Field label="Número" disabled={!editavel} error={err('numero')} {...form.register('numero')} />
                <Field label="Complemento" disabled={!editavel} error={err('complemento')} {...form.register('complemento')} />
                <Field label="Bairro" disabled={!editavel} error={err('bairro')} {...form.register('bairro')} />
                <Field label="Cidade" disabled={!editavel} error={err('cidade')} {...form.register('cidade')} />
                <SelCampo form={form} name="uf" label="UF" options={UF_SIGLA_OPCOES} placeholder="Selecione…" />
                <Field label="CEP" disabled={!editavel} error={err('cep')} {...form.register('cep')} />
                <NumCampo form={form} name="idcidade" label="Código IBGE (cM&un)" decimais={0} />
              </div>
            </fieldset>

            {/* Fiscal */}
            <fieldset className="rounded-radius-md border border-border p-pad-md">
              <legend className="px-pad-xs text-fg-muted">Fiscal</legend>
              <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
                <SelCampo form={form} name="classfiscal" label="&Regime" options={CLASSFISCAL_OPCOES} placeholder="Selecione…" />
                <SelCampo form={form} name="figurafiscal" label="Figura &fiscal" options={FIGURAFISCAL_OPCOES} placeholder="—" />
                <SelCampo form={form} name="contribuinte_icms" label="Contribuinte ICMS" options={SN_OPCOES} placeholder="—" />
                <NumCampo form={form} name="alqsimplesnac" label="Alíq. Simples &Nac. (%)" />
                <Field label="&Série NF-e" disabled={!editavel} error={err('serie_nfe')} {...form.register('serie_nfe')} />
                <SelCampo form={form} name="ambiente" label="Ambiente" options={AMBIENTE_OPCOES} placeholder="—" />
                <NumCampo form={form} name="aliquota_estado" label="Alíq. estadual (%)" />
              </div>
            </fieldset>

            {/* Precificação / financeiro */}
            <fieldset className="rounded-radius-md border border-border p-pad-md">
              <legend className="px-pad-xs text-fg-muted">Precificação / financeiro</legend>
              <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
                <NumCampo form={form} name="despoperacional" label="Desp. &operacional (%)" />
                <NumCampo form={form} name="margem_venda" label="Margem de &venda (%)" />
                <NumCampo form={form} name="margem_contribuicao" label="Margem de contribuição (%)" />
                <NumCampo form={form} name="txjuropadrao" label="&Taxa de juro padrão (%)" />
                <NumCampo form={form} name="tx_juro_apagar" label="Taxa juro a pagar (%)" />
                <NumCampo form={form} name="descmax" label="&Desconto máx. (%)" />
                <NumCampo form={form} name="limite_descmax" label="&Limite desc. máx. (%)" />
              </div>
            </fieldset>

            {/* Parâmetros que a operação altera (centros de custo das baixas, curva ABC, área, TEF, PDV) */}
            <fieldset className="rounded-radius-md border border-border p-pad-md">
              <legend className="px-pad-xs text-fg-muted">Parâmetros</legend>
              <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
                <LkCampo form={form} name="ccmultajuros" label="CC multas, juros e taxas" def={LK_PLC} editavel={editavel} />
                <LkCampo form={form} name="codplc_juros_pagos" label="CC juros pagos" def={LK_PLC} editavel={editavel} />
                <LkCampo form={form} name="codplc_acrescimos_pagos" label="CC acréscimos pagos" def={LK_PLC} editavel={editavel} />
                <LkCampo form={form} name="codplc_descontos_recebidos" label="CC descontos recebidos" def={LK_PLC} editavel={editavel} />
                <LkCampo form={form} name="codplc_descontos_concedidos" label="CC descontos concedidos" def={LK_PLC} editavel={editavel} />
                <LkCampo form={form} name="codparceiro" label="Parceiro da empresa" def={{ recurso: 'lookup/parceiros', campoCodigo: 'codparceiro', descricao: 'razao' }} editavel={editavel} />
                <SelCampo form={form} name="sincroniza_preco_nf" label="Sincroniza preço nas lojas" options={SN_OPCOES} placeholder="—" />
                <NumCampo form={form} name="pc_curva_abc_a" label="Curva ABC venda — A (%)" />
                <NumCampo form={form} name="pc_curva_abc_b" label="Curva ABC venda — B (%)" />
                <NumCampo form={form} name="pc_curva_abc_c" label="Curva ABC venda — C (%)" />
                <NumCampo form={form} name="pc_curva_abc_d" label="Curva ABC venda — D (%)" />
                <NumCampo form={form} name="pc_curva_abc_e" label="Curva ABC venda — E (%)" />
                <NumCampo form={form} name="pc_curva_comp_a" label="Curva ABC compra — A (%)" />
                <NumCampo form={form} name="pc_curva_comp_b" label="Curva ABC compra — B (%)" />
                <NumCampo form={form} name="pc_curva_comp_c" label="Curva ABC compra — C (%)" />
                <NumCampo form={form} name="aream2" label="Área (m²)" />
                <NumCampo form={form} name="aream2_venda" label="Área de venda (m²)" />
                <Field label="Junta comercial" disabled={!editavel} error={err('junta_comercial')} {...form.register('junta_comercial')} />
                <Field label="TEF — loja" disabled={!editavel} error={err('tef_loja')} {...form.register('tef_loja')} />
                <Field label="TEF — servidor" disabled={!editavel} error={err('tef_servidor')} {...form.register('tef_servidor')} />
                <LkCampo form={form} name="codplc_nf_pdv" label="CC da NF do PDV" def={LK_PLC} editavel={editavel} />
                <NumCampo form={form} name="idsituacao_nf_pdv" label="Situação da NF do PDV" decimais={0} />
              </div>
            </fieldset>
            <CamposLegado form={form} editavel={editavel} />
            <ContabilistaSection idempresa={form.watch('idempresa') as number | undefined} editavel={editavel} />
            <RedesEstabelecimentoSection idempresa={form.watch('idempresa') as number | undefined} editavel={editavel} />
          </div>
        );
      }}
    />
  );
}

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const CAMPOS_CONTABILISTA: Array<{ nome: string; rotulo: string; max: number }> = [
  { nome: 'nome', rotulo: 'Nome', max: 150 }, { nome: 'cpf', rotulo: 'CPF', max: 20 }, { nome: 'crc', rotulo: 'CRC', max: 20 },
  { nome: 'cnpj', rotulo: 'CNPJ (escritório)', max: 20 }, { nome: 'cep', rotulo: 'CEP', max: 10 }, { nome: 'endereco', rotulo: 'Endereço', max: 150 },
  { nome: 'num', rotulo: 'Número', max: 10 }, { nome: 'complemento', rotulo: 'Complemento', max: 60 }, { nome: 'bairro', rotulo: 'Bairro', max: 60 },
  { nome: 'fone', rotulo: 'Telefone', max: 30 }, { nome: 'fax', rotulo: 'Fax', max: 30 }, { nome: 'email', rotulo: 'E-mail', max: 120 },
  { nome: 'cod_mun', rotulo: 'Código IBGE do município', max: 7 },
];

/**
 * A aba "Contabilista" do UCadEmpresa: o contabilista da empresa (CONTABILISTA por CODEMPRESA) — o registro 0100 das duas
 * escriturações do SPED e o cabeçalho do Diário. Grava à parte do cadastro da empresa (o dataset aninhado do legado).
 */
function ContabilistaSection({ idempresa, editavel }: { idempresa?: number; editavel: boolean }) {
  const mensagem = useMensagem();
  const [v, setV] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const id = Number(idempresa);
  const valido = Number.isInteger(id) && id > 0;
  useEffect(() => {
    if (!valido) { setV({}); return; }
    let vivo = true;
    void fetch(`${BASE}/cadastro/empresas/${id}/contabilista`, { headers: apiHeaders() }).then(async (r) => {
      handle401(r);
      const j = r.ok ? await r.json().catch(() => null) : null;
      if (vivo) setV(Object.fromEntries(CAMPOS_CONTABILISTA.map((c) => [c.nome, j?.[c.nome] == null ? '' : String(j[c.nome])])));
    });
    return () => { vivo = false; };
  }, [id, valido]);
  const gravar = async () => {
    if (!valido || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`${BASE}/cadastro/empresas/${id}/contabilista`, { method: 'PUT', headers: apiHeaders(), body: JSON.stringify(v) });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      mensagem.sucesso('Contabilista gravado.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };
  if (!valido) return null;
  return (
    <fieldset className="rounded-radius-md border border-border p-pad-md">
      <legend className="px-pad-xs text-fg-muted">Contabilista (registro 0100 do SPED)</legend>
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
        {CAMPOS_CONTABILISTA.map((c) => (
          <Field key={c.nome} label={c.rotulo} maxLength={c.max} disabled={!editavel || busy} value={v[c.nome] ?? ''} onChange={(e) => setV((x) => ({ ...x, [c.nome]: e.target.value }))} />
        ))}
      </div>
      <div className="mt-gp-sm"><Button label="Gravar contabilista" variant="soft" disabled={!editavel || busy} onClick={() => void gravar()} /></div>
    </fieldset>
  );
}

/** o combo da rede no fonte (CmbRede): Cielo 125, Rede 5, Concil -1 — outras redes da produção aparecem pelo código */
const REDES: Array<{ value: string; label: string }> = [{ value: '125', label: 'Cielo' }, { value: '5', label: 'Rede' }, { value: '-1', label: 'Concil' }];
const nomeRede = (r: unknown) => REDES.find((x) => x.value === String(r))?.label ?? `Rede ${String(r)}`;

/**
 * A grade "rede × número do estabelecimento" da aba "Configurações financeiras" do UCadEmpresa (EMPRESA_REDE_ESTABELECIMENTO) — o que os
 * conciliadores de arquivo da baixa de cartões usam para achar a loja. Adicionar/Salvar (BtnSalvarRedeClick: "Informe a rede." / "Informe o
 * número do estabelecimento.") e Excluir.
 */
export function RedesEstabelecimentoSection({ idempresa, editavel }: { idempresa?: number; editavel: boolean }) {
  const mensagem = useMensagem();
  const [linhas, setLinhas] = useState<Array<{ ere_rede: number; ere_numero_estabelecimento: string }>>([]);
  const [rede, setRede] = useState('');
  const [numero, setNumero] = useState('');
  const id = Number(idempresa);
  const valido = Number.isInteger(id) && id > 0;
  const recarregar = async () => {
    const r = await fetch(`${BASE}/cadastro/empresas/${id}/redes-estabelecimento`, { headers: apiHeaders() });
    handle401(r);
    setLinhas(r.ok ? await r.json().catch(() => []) : []);
  };
  useEffect(() => { if (valido) void recarregar(); else setLinhas([]); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, valido]);
  const enviar = async (metodo: 'POST' | 'DELETE', url: string, body?: unknown) => {
    const r = await fetch(url, { method: metodo, headers: apiHeaders(), body: body ? JSON.stringify(body) : undefined });
    handle401(r);
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
      throw Object.assign(new Error(env.code), { envelope: env });
    }
  };
  const salvar = async () => {
    if (!rede) return mensagem.erro('Informe a rede.');
    if (!numero.trim()) return mensagem.erro('Informe o número do estabelecimento.');
    try { await enviar('POST', `${BASE}/cadastro/empresas/${id}/redes-estabelecimento`, { ere_rede: Number(rede), ere_numero_estabelecimento: numero.trim() }); setNumero(''); await recarregar(); }
    catch (e) { mensagem.erro(e); }
  };
  const excluir = async (l: { ere_rede: number; ere_numero_estabelecimento: string }) => {
    try { await enviar('DELETE', `${BASE}/cadastro/empresas/${id}/redes-estabelecimento?rede=${l.ere_rede}&numero=${encodeURIComponent(l.ere_numero_estabelecimento)}`); await recarregar(); }
    catch (e) { mensagem.erro(e); }
  };
  if (!valido) return null;
  return (
    <fieldset className="rounded-radius-md border border-border p-pad-md">
      <legend className="px-pad-xs text-fg-muted">Rede × número do estabelecimento</legend>
      <table className="w-full text-body-sm">
        <thead><tr className="text-left text-fg-muted"><th className="p-pad-xs">Rede</th><th className="p-pad-xs">Número do estabelecimento</th><th className="p-pad-xs" /></tr></thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={`${l.ere_rede}-${l.ere_numero_estabelecimento}`} className="border-t border-border">
              <td className="p-pad-xs">{nomeRede(l.ere_rede)}</td>
              <td className="p-pad-xs tabular-nums">{l.ere_numero_estabelecimento}</td>
              <td className="p-pad-xs">{editavel && <Button label="Excluir" variant="ghost" onClick={() => void excluir(l)} />}</td>
            </tr>
          ))}
          {!linhas.length && <tr><td colSpan={3} className="p-pad-xs text-fg-muted">Nenhum estabelecimento cadastrado.</td></tr>}
        </tbody>
      </table>
      {editavel && (
        <div className="mt-gp-sm flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><SelectField label="Rede" options={REDES} value={rede || undefined} onChange={(v) => setRede(v ?? '')} placeholder="(rede)" /></div>
          <div className="w-60"><Field label="Número do estabelecimento" maxLength={30} value={numero} onChange={(e) => setNumero(e.target.value)} /></div>
          <Button label="Adicionar" variant="soft" onClick={() => void salvar()} />
        </div>
      )}
    </fieldset>
  );
}
