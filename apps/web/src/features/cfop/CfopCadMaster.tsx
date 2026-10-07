import { Controller } from 'react-hook-form';
import { useOpcoesDoForm } from '../../shared/acesso/useOpcoesDoForm';
import { cfopSchema, type CriarCfopDto } from '@apollo/shared';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { LookupField } from '../../shared/ui/LookupField';

/**
 * Cadastro de CFOP (UCadCFOP) — a tela inteira: as 45 colunas da tabela do legado (mig 346). As regras moram no gravar
 * (cfop.crud.ts): o TIPO limpa o lado oposto da "Situação do documento", sem PROCESSA FINANCEIRO não há financeiro automático, o
 * CFOP de devolução é um CFOP de devolução do mesmo destino e a alíquota é uma da UF da empresa. Aqui a tela só espelha o que o
 * legado habilita: o lado da situação que o TIPO permite e o financeiro automático só com o financeiro processado.
 */
const TIPOS = [{ value: 'E', label: 'Entrada' }, { value: 'S', label: 'Saída' }];
const DESTINOS = [{ value: 'DENTRO', label: 'Dentro do estado' }, { value: 'FORA', label: 'Fora do estado' }];
// EFD-Contribuições, tabela 4.3.7 — a base de cálculo do crédito
const BASES_CREDITO = [
  'Aquisição de bens para revenda', 'Aquisição de bens utilizados como insumo', 'Aquisição de serviços utilizados como insumo',
  'Energia elétrica e térmica, inclusive sob a forma de vapor', 'Aluguéis de prédios', 'Aluguéis de máquinas e equipamentos',
  'Armazenagem de mercadoria e frete na operação de venda', 'Contraprestações de arrendamento mercantil',
  'Bens do ativo imobilizado (encargos de depreciação)', 'Bens do ativo imobilizado (valor de aquisição)',
  'Amortização e depreciação de edificações e benfeitorias', 'Devolução de vendas sujeitas à incidência não cumulativa',
  'Outras operações com direito a crédito', 'Transporte de cargas — subcontratação', 'Atividade imobiliária — custo incorrido',
  'Atividade imobiliária — custo orçado', 'Serviços de limpeza, conservação e manutenção', 'Estoque de abertura de bens',
].map((d, i) => ({ value: String(i + 1), label: `${String(i + 1).padStart(2, '0')} - ${d}` }));

type Flag = keyof CriarCfopDto;
const PROCESSAMENTO: Array<[Flag, string]> = [
  ['proc_qtde', 'Processa &quantidade'], ['proc_financeiro', 'Processa &financeiro'], ['gera_financeiro_auto', 'Gerar financeiro automaticamente'],
  ['proc_transf', 'Processa &transferência'], ['proc_cupom', 'Zerar ICMS Cupom/Sintegra/Sped'], ['devolucao', 'CFOP de devolução'],
  ['sintegra', 'Gera Sintegra'], ['preco_custo', 'Carregar valor custo'],
];
const AO_PROCESSAR: Array<[Flag, string]> = [['altera_custo_nf', 'Altera valor de custo do produto'], ['atualiza_venda_nf', 'Atualiza preço de venda do produto'], ['nao_atualiza_forn_prod', 'Não atualiza o fornecedor do produto'], ['filtro_prec_nf', 'Entra no filtro da precificação da NF']];
const FISCAL: Array<[Flag, string]> = [
  ['nao_gera_sped', 'Não compõe SPED'], ['nao_gera_sped_contribuicao', 'Não compõe SPED Contribuições'], ['nao_gera_apuracao_icms', 'Não compõe apuração ICMS'],
  ['naoalimentadre', 'Não alimenta a DRE'], ['calcula_pauta_st', 'Calcula pauta de ST'], ['abater_cfop', 'Abater CFOP'], ['informaiest', 'Informa IE do substituto'],
];
const CLASSIFICACAO: Array<[Flag, string]> = [
  ['compra', 'Compra'], ['venda', 'Venda'], ['transferencia', 'Transferência'], ['dispensado_coleta', 'Dispensado da coleta'], ['dispensado_pedido_compra', 'Dispensado do pedido de compra'],
];

export function CfopCadMaster() {
  // permissões de controle da tela — docs/05-migration-engineering/permissoes-de-controle.md
  const { tem: pode } = useOpcoesDoForm('FRMCADCFOP');
  const { data: situacoes = [] } = useResourceOptions(
    'cadastro/situacoes-nf',
    (s: any) => ({ value: String(s.idsituacao_nf), label: `${s.idsituacao_nf} - ${s.descricao}` }),
  );
  const { data: aliquotas = [] } = useResourceOptions('cadastro/aliquotas', (a: any) => ({ value: String(a.codigo), label: `${a.codigo} - ${a.descricao}` }));

  const codigo = (name: Flag, label: string, form: any, options: Array<{ value: string; label: string }>, disabled = false) => (
    <Controller
      control={form.control}
      name={name as never}
      render={({ field }: any) => (
        <SelectField
          label={label}
          options={options}
          disabled={disabled}
          value={field.value != null && field.value !== '' ? String(field.value) : undefined}
          onChange={(v) => field.onChange(v ? Number(v) : '')}
          placeholder="Selecione…"
        />
      )}
    />
  );
  const flags = (lista: Array<[Flag, string]>, form: any, editavel: boolean) => (
    <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
      {lista.map(([name, label]) => (
        <Controller
          key={name}
          control={form.control}
          name={name as never}
          render={({ field }: any) => (
            <CheckboxField
              label={label}
              value={(field.value as string | undefined) ?? 'N'}
              onChange={field.onChange}
              // btnGravarClick: sem processar o financeiro, o automático não vale
              disabled={!editavel || (name === 'gera_financeiro_auto' && form.watch('proc_financeiro') !== 'S')}
            />
          )}
        />
      ))}
    </div>
  );
  const grupo = (titulo: string, editavel: boolean, filhos: React.ReactNode) => (
    <fieldset disabled={!editavel} className="rounded-radius-md border border-border p-pad-md">
      <legend className="px-pad-xs text-fg-muted">{titulo}</legend>
      {filhos}
    </fieldset>
  );

  return (
    <CadMaster<CriarCfopDto>
      titulo="CFOP"
      resourcePath="cadastro/cfops"
      pk="codcfop"
      log={{ form: 'FRMCADCFOP', chave: 'CODCFOP' }}
      pkGerada={false} // chave natural: o usuário digita o CFOP (4 dígitos)
      colunasPesquisa={[
        { campo: 'cfop', label: 'CFOP', tipo: 'text', largura: 110 },
        { campo: 'descricao', label: 'Descrição', tipo: 'text' },
        { campo: 'tipo', label: 'Tipo', tipo: 'text', largura: 80 },
        { campo: 'estado', label: 'Destino', tipo: 'text', largura: 110 },
      ]}
      schema={cfopSchema}
      defaultValues={{ descricao: '' }}
      campos={({ form, editavel }) => {
        const tipo = form.watch('tipo');
        const destino = form.watch('tipoestado');
        // o CFOP de devolução: a Pesquisa do legado é GET_CFOP com TIPO = 'S' AND ESTADO = <destino> (btnCFOPDevolucaoClick,
        // UCadCFOP.pas:208) e o código digitado só vale com DEVOLUCAO = 'S' e o mesmo TIPOESTADO (segCFOP, UCadCFOP.dfm:1670)
        const fixosDevolucao: Record<string, string> = { tipo: 'S', devolucao: 'S', ...(destino ? { estado: String(destino) } : {}) };
        return (
          <div className="flex flex-col gap-form-gap">
            {grupo('CFOP', editavel, (
              <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label="Descrição" disabled={!editavel} error={form.formState.errors.descricao?.message as string | undefined} {...form.register('descricao')} />
                </div>
                <Controller control={form.control} name="tipo" render={({ field }) => (
                  <SelectField label="Tipo" options={TIPOS} value={field.value ?? undefined} onChange={(v) => field.onChange(v || undefined)} placeholder="Pelo 1º dígito" />
                )} />
                <Controller control={form.control} name="tipoestado" render={({ field }) => (
                  <SelectField label="Destino" options={DESTINOS} value={field.value ?? undefined} onChange={(v) => field.onChange(v || undefined)} placeholder="Selecione…" />
                )} />
                <Controller control={form.control} name="cfop_devolucao" render={({ field }) => (
                  <LookupField label="CFOP para devolução de compra" recurso="lookup/cfops" campoCodigo="codcfop" descricao="descricao"
                    fixos={fixosDevolucao} value={field.value || undefined} onChange={(cod) => field.onChange(cod?.trim() ?? '')} disabled={!editavel} />
                )} />
                <Controller control={form.control} name="aliquota" render={({ field }) => (
                  <SelectField label="&Alíquota de saída" options={aliquotas} value={field.value || undefined} onChange={(v) => field.onChange(v ?? '')} placeholder="Nenhuma" disabled={!pode('CMBALIQUOTA')} />
                )} />
                <Controller control={form.control} name="codplanocontas" render={({ field }) => (
                  <NumberField label="Conta &contábil (código no plano)" value={typeof field.value === 'number' ? field.value : undefined} onChange={(v) => field.onChange(v ?? '')} decimais={0} min={0} disabled={!editavel} />
                )} />
                <Field label="Código contábil" disabled value={String((form.getValues() as Record<string, unknown>).codcontabil ?? '')} readOnly />
                {codigo('cod_bc_credito', 'Base de crédito PIS/COFINS', form, BASES_CREDITO)}
                <Controller control={form.control} name="tipo_cfop" render={({ field }) => (
                  <NumberField label="Tipo de CFOP" value={typeof field.value === 'number' ? field.value : undefined} onChange={(v) => field.onChange(v ?? '')} decimais={0} min={0} disabled={!editavel} />
                )} />
                <Controller control={form.control} name="idpiscofins" render={({ field }) => (
                  <NumberField label="Tabela de PIS/COFINS" value={typeof field.value === 'number' ? field.value : undefined} onChange={(v) => field.onChange(v ?? '')} decimais={0} min={0} disabled={!editavel} />
                )} />
                <Controller control={form.control} name="codclass_trib" render={({ field }) => (
                  <NumberField label="Classificação tributária IBS/CBS" value={typeof field.value === 'number' ? field.value : undefined} onChange={(v) => field.onChange(v ?? '')} decimais={0} min={0} disabled={!editavel} />
                )} />
              </div>
            ))}
            {grupo('Processamento', editavel, flags(PROCESSAMENTO, form, editavel))}
            {grupo('Ao processar a NF', editavel, flags(AO_PROCESSAR, form, editavel))}
            {grupo('Fiscal', editavel, flags(FISCAL, form, editavel))}
            {grupo('Classificação', editavel, flags(CLASSIFICACAO, form, editavel))}
            {/* a aba "Situação do documento": o TIPO habilita um lado (SetTipoCFOP) — o outro sai limpo no gravar */}
            {grupo('Situação do documento', editavel, (
              <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
                {codigo('situacao_icms_entradas_nf', 'ICMS em notas fiscais de entrada', form, situacoes, tipo === 'S')}
                {codigo('situacao_icms_saidas_nf', 'ICMS em notas fiscais de saída', form, situacoes, tipo === 'E')}
                {codigo('situacao_pis_entradas_nf', 'PIS em notas fiscais de entrada', form, situacoes, tipo === 'S')}
                {codigo('situacao_pis_saidas_nf', 'PIS em notas fiscais de saída', form, situacoes, tipo === 'E')}
                {codigo('situacao_cofins_entradas_nf', 'COFINS em notas fiscais de entrada', form, situacoes, tipo === 'S')}
                {codigo('situacao_cofins_saidas_nf', 'COFINS em notas fiscais de saída', form, situacoes, tipo === 'E')}
                {codigo('idsituacao_nf_saida', 'Situação padrão (saída)', form, situacoes)}
              </div>
            ))}
          </div>
        );
      }}
    />
  );
}
