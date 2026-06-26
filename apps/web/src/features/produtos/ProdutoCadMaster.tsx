import { useEffect, useMemo, useState } from 'react';
import { Controller, useFieldArray, type UseFormReturn } from 'react-hook-form';
import { Pencil, Trash2 } from 'lucide-react';
import { DataTable, type DataTableColumnDef } from '@apollosg/design-system';
import {
  produtoSchema,
  ORIGEM_OPCOES,
  eanValido,
  gerarCodigoInternoEan13,
  type CriarProdutoDto,
  type CodAuxiliarDto,
  type PrecoProdutoDto,
} from '@apollo/shared';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { useResourceOptions, type Opcao } from '../../shared/cadmaster/useResourceOptions';
import { CodAuxiliarModal } from './CodAuxiliarModal';
import { precificarProduto } from './precificacaoApi';

/** empresa única do contexto F2 — toda a edição inline de preço acontece em `precos.0`. */
const IDEMPRESA_F2 = 1;

/**
 * Cadastro de PRODUTO (hub do ERP) — Fase 1: NÚCLEO fiel (legado `UCadProduto.pas`),
 * construído sobre o pilar <CadMaster> + o engine agregado (master PRODUTOS + detalhe 1:N
 * de códigos auxiliares numa só gravação).
 *
 * A tela ARMAZENA config (identidade + fiscal + unidade/balança + códigos de barras);
 * NÃO calcula preço/imposto (o motor portado vive em apps/api/src/modules/precificacao,
 * reusado em F2). Seções: Principal, Fiscal e Códigos auxiliares.
 *
 * Erros de negócio do back (obrigatórios, CEST-STB, NCM) sobem como envelope PT e são
 * exibidos pelo <CadMaster> via useMensagem. Validação de formato é do `produtoSchema`.
 */
export function ProdutoCadMaster() {
  // ── LOOKUPs do master (data-bound, espelham os combos do legado) ──
  // Unidade: guarda codunidade (FK) E unidade (sigla — o schema exige a sigla).
  const { data: unidadeOptions = [] } = useResourceOptions(
    'cadastro/unidades',
    (r: any) => ({ value: String(r.codunidade), label: `${r.sigla} - ${r.descricao}` }),
  );
  // Fornecedor: parceiro FRN='S' → "cod - razão".
  const { data: fornecedorOptions = [] } = useResourceOptions(
    'cadastro/parceiros',
    (p: any) => ({ value: String(p.codparceiro), label: `${p.codparceiro} - ${p.razao}` }),
    { campo: 'frn', operador: 'igual', valor: 'S' },
  );
  // Marca: o view expõe a PK ora como idmarca, ora como codigo.
  const { data: marcaOptions = [] } = useResourceOptions('cadastro/marcas', (m: any) => ({
    value: String(m.idmarca ?? m.codigo),
    label: `${m.idmarca ?? m.codigo} - ${m.descricao}`,
  }));
  // Famílias (catálogo único, discriminado por TIPO): G=grupo, D=departamento, O=seção.
  const { data: grupoOptions = [] } = useResourceOptions(
    'cadastro/familias',
    (f: any) => ({ value: String(f.codfamilia), label: f.descricao }),
    { campo: 'tipo', operador: 'igual', valor: 'G' },
  );
  const { data: dptoOptions = [] } = useResourceOptions(
    'cadastro/familias',
    (f: any) => ({ value: String(f.codfamilia), label: f.descricao }),
    { campo: 'tipo', operador: 'igual', valor: 'D' },
  );
  const { data: secaoOptions = [] } = useResourceOptions(
    'cadastro/familias',
    (f: any) => ({ value: String(f.codfamilia), label: f.descricao }),
    { campo: 'tipo', operador: 'igual', valor: 'O' },
  );
  // Alíquota (código fiscal, chave natural CODIGO) → "codigo - descrição".
  const { data: aliquotaOptions = [] } = useResourceOptions('cadastro/aliquotas', (a: any) => ({
    value: String(a.codigo),
    label: `${a.codigo} - ${a.descricao}`,
  }));

  // OnNewRecord do legado: ativo/ativo_compra='S', balanca='N', controle de validade='S',
  // fatorcx=1, e o detalhe 1:N começa vazio.
  const defaultValues = useMemo<Partial<CriarProdutoDto>>(
    () => ({
      codbarra: '',
      descricao: '',
      descricao_resumida: '',
      descricao_web: '',
      descricao_balanca: '',
      unidade: '',
      codunidade: undefined,
      codfor: undefined,
      idmarca: undefined,
      codgrupo: undefined,
      coddpto: undefined,
      codsecao: undefined,
      ncmsh: '',
      cest: '',
      cest_obrigatorio: 'N',
      aliquota: '',
      origemprod: undefined,
      idpiscofins: undefined,
      codfigurafiscal: undefined,
      codfcp: undefined,
      mva: undefined,
      ativo: 'S',
      ativo_compra: 'S',
      balanca: 'N',
      codbalanca: undefined,
      fatorkg: undefined,
      peso: undefined,
      fatorcx: 1,
      controle_validade: 'S',
      codauxiliares: [],
      // F2 — MULTI_PRECO por empresa: a tela edita a linha da empresa única INLINE em
      // `precos.0`; semeada aqui p/ o binding existir num registro NOVO (defaults do legado).
      precos: [{ idempresa: IDEMPRESA_F2, promocao: 'N', ativo: 'S', ativo_compra: 'S' }],
    }),
    [],
  );

  return (
    <CadMaster<CriarProdutoDto>
      titulo="Produtos"
      resourcePath="cadastro/produtos"
      pk="idproduto"
      schema={produtoSchema}
      defaultValues={defaultValues}
      colunasPesquisa={[
        { campo: 'idproduto', label: 'Código', tipo: 'text', largura: 110 },
        { campo: 'codbarra', label: 'Cód. barras', tipo: 'text', largura: 150 },
        { campo: 'descricao', label: 'Descrição', tipo: 'text' },
        { campo: 'ncmsh', label: 'NCM', tipo: 'text', largura: 120 },
        { campo: 'marca', label: 'Marca', tipo: 'text', largura: 160 },
        { campo: 'aliquota', label: 'Alíquota', tipo: 'text', largura: 110 },
        { campo: 'ativo', label: 'Ativo', tipo: 'status', largura: 100 },
      ]}
      campos={({ form, editavel }) => (
        <div className="flex flex-col gap-form-gap">
          <PrincipalSection
            form={form}
            editavel={editavel}
            unidadeOptions={unidadeOptions}
            fornecedorOptions={fornecedorOptions}
            marcaOptions={marcaOptions}
            grupoOptions={grupoOptions}
            dptoOptions={dptoOptions}
            secaoOptions={secaoOptions}
          />
          {/* Preços INLINE logo após a Principal — espelha o legado (preço/custo na aba Principal). */}
          <PrecosSection form={form} editavel={editavel} aliquotaOptions={aliquotaOptions} />
          <FiscalSection form={form} editavel={editavel} aliquotaOptions={aliquotaOptions} />
          <CodAuxiliaresSection
            form={form}
            editavel={editavel}
            unidadeOptions={unidadeOptions}
          />
        </div>
      )}
    />
  );
}

// ───────────────────────────── Principal ─────────────────────────────

/**
 * Seção PRINCIPAL: identidade do produto. CODBARRA com atalho "gerar EAN interno" (F8 do
 * legado, `MontaCodigoBarra`) + dica visual de EAN válido; descrições; unidade (guarda
 * codunidade E a sigla); fornecedor/marca/grupo/depto/seção (lookups); flags e métricas.
 */
function PrincipalSection({
  form,
  editavel,
  unidadeOptions,
  fornecedorOptions,
  marcaOptions,
  grupoOptions,
  dptoOptions,
  secaoOptions,
}: {
  form: UseFormReturn<CriarProdutoDto>;
  editavel: boolean;
  unidadeOptions: Opcao[];
  fornecedorOptions: Opcao[];
  marcaOptions: Opcao[];
  grupoOptions: Opcao[];
  dptoOptions: Opcao[];
  secaoOptions: Opcao[];
}) {
  const codbarraAtual = (form.watch('codbarra') ?? '').trim();
  // dica visual: só sinaliza inválido quando há conteúdo (a obrigatoriedade é do schema).
  const codbarraInvalido = codbarraAtual !== '' && !eanValido(codbarraAtual);
  const ehBalanca = form.watch('balanca') === 'S';

  // F8 — gera um EAN-13 interno a partir de um sequencial (prefixo '7'); seta o campo.
  const gerarEan = () => {
    const ean = gerarCodigoInternoEan13(Date.now() % 1e11);
    form.setValue('codbarra', ean, { shouldValidate: true, shouldDirty: true });
  };

  return (
    <fieldset className="rounded-radius-md border border-border p-pad-md">
      <legend className="px-pad-xs text-fg-muted">Principal</legend>
      <div className="flex flex-col gap-form-gap">
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          {/* CODBARRA + atalho gerar EAN interno */}
          <div className="flex items-end gap-gp-sm sm:col-span-2">
            <div className="flex-1">
              <Field
                label="Código de &barras"
                inputMode="numeric"
                disabled={!editavel}
                error={
                  (form.formState.errors.codbarra?.message as string | undefined) ??
                  (codbarraInvalido ? 'Código de barras (EAN-13) inválido.' : undefined)
                }
                {...form.register('codbarra')}
              />
            </div>
            <Button label="&Gerar EAN interno" variant="soft" onClick={gerarEan} />
          </div>

          <div className="sm:col-span-2">
            <Field
              label="&Descrição"
              disabled={!editavel}
              error={form.formState.errors.descricao?.message as string | undefined}
              {...form.register('descricao')}
            />
          </div>
          <Field
            label="Descrição &resumida"
            disabled={!editavel}
            error={form.formState.errors.descricao_resumida?.message as string | undefined}
            {...form.register('descricao_resumida')}
          />
          <Field
            label="Descrição &web"
            disabled={!editavel}
            error={form.formState.errors.descricao_web?.message as string | undefined}
            {...form.register('descricao_web')}
          />
          <Field
            label="Descrição balança"
            disabled={!editavel}
            error={form.formState.errors.descricao_balanca?.message as string | undefined}
            {...form.register('descricao_balanca')}
          />

          {/* Unidade — guarda codunidade (FK) E unidade (sigla, exigida pelo schema). */}
          <Controller
            control={form.control}
            name="codunidade"
            render={({ field }) => (
              <SelectField
                label="&Unidade"
                options={unidadeOptions}
                value={field.value != null ? String(field.value) : undefined}
                onChange={(v) => {
                  field.onChange(v ? Number(v) : undefined);
                  // espelha a SIGLA no campo `unidade` (label = "SIGLA - descrição")
                  const opt = unidadeOptions.find((o) => o.value === v);
                  const sigla = opt ? opt.label.split(' - ')[0] : '';
                  form.setValue('unidade', sigla, { shouldValidate: true });
                }}
                placeholder="Selecione…"
                error={
                  (form.formState.errors.unidade?.message as string | undefined) ??
                  (form.formState.errors.codunidade?.message as string | undefined)
                }
              />
            )}
          />
          <Controller
            control={form.control}
            name="codfor"
            render={({ field }) => (
              <SelectField
                label="&Fornecedor"
                options={fornecedorOptions}
                value={field.value != null ? String(field.value) : undefined}
                onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                placeholder="Selecione o fornecedor…"
                error={form.formState.errors.codfor?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="idmarca"
            render={({ field }) => (
              <SelectField
                label="&Marca"
                options={marcaOptions}
                value={field.value != null ? String(field.value) : undefined}
                onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                placeholder="Selecione a marca…"
                error={form.formState.errors.idmarca?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="codgrupo"
            render={({ field }) => (
              <SelectField
                label="&Grupo"
                options={grupoOptions}
                value={field.value != null ? String(field.value) : undefined}
                onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                placeholder="Selecione o grupo…"
                error={form.formState.errors.codgrupo?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="coddpto"
            render={({ field }) => (
              <SelectField
                label="&Departamento"
                options={dptoOptions}
                value={field.value != null ? String(field.value) : undefined}
                onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                placeholder="Selecione o departamento…"
                error={form.formState.errors.coddpto?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="codsecao"
            render={({ field }) => (
              <SelectField
                label="&Seção"
                options={secaoOptions}
                value={field.value != null ? String(field.value) : undefined}
                onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                placeholder="Selecione a seção…"
                error={form.formState.errors.codsecao?.message as string | undefined}
              />
            )}
          />
        </div>

        {/* Flags de controle */}
        <div className="flex flex-wrap items-center gap-gp-lg">
          <Controller
            control={form.control}
            name="ativo"
            render={({ field }) => (
              <CheckboxField
                label="&Ativo"
                value={field.value}
                onChange={field.onChange}
                disabled={!editavel}
              />
            )}
          />
          <Controller
            control={form.control}
            name="ativo_compra"
            render={({ field }) => (
              <CheckboxField
                label="Ativo p/ &compra"
                value={field.value}
                onChange={field.onChange}
                disabled={!editavel}
              />
            )}
          />
          <Controller
            control={form.control}
            name="balanca"
            render={({ field }) => (
              <CheckboxField
                label="Produto de &balança"
                value={field.value}
                onChange={field.onChange}
                disabled={!editavel}
              />
            )}
          />
        </div>

        {/* Métricas de unidade/balança */}
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          <Controller
            control={form.control}
            name="codbalanca"
            render={({ field }) => (
              <NumberField
                label="Cód. balan&ça"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={0}
                min={0}
                disabled={!editavel || !ehBalanca}
                error={form.formState.errors.codbalanca?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="fatorkg"
            render={({ field }) => (
              <NumberField
                label="Fator &KG"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={3}
                min={0}
                disabled={!editavel || !ehBalanca}
                error={form.formState.errors.fatorkg?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="peso"
            render={({ field }) => (
              <NumberField
                label="&Peso"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={3}
                min={0}
                disabled={!editavel}
                error={form.formState.errors.peso?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="fatorcx"
            render={({ field }) => (
              <NumberField
                label="Fator cai&xa"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={0}
                min={0}
                disabled={!editavel}
                error={form.formState.errors.fatorcx?.message as string | undefined}
              />
            )}
          />
        </div>
      </div>
    </fieldset>
  );
}

// ───────────────────────────── Fiscal ─────────────────────────────

/**
 * Seção FISCAL (config armazenada; o cálculo vive em precificacao a jusante). NCM (8 díg),
 * CEST (7 díg — obrigatório quando alíquota='STB', regra do schema), alíquota (lookup),
 * origem (ORIGEM_OPCOES) e os códigos de figuras fiscais (lookups deferidos → NumberField).
 */
function FiscalSection({
  form,
  editavel,
  aliquotaOptions,
}: {
  form: UseFormReturn<CriarProdutoDto>;
  editavel: boolean;
  aliquotaOptions: Opcao[];
}) {
  return (
    <fieldset className="rounded-radius-md border border-border p-pad-md">
      <legend className="px-pad-xs text-fg-muted">Fiscal</legend>
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
        <Field
          label="&NCM"
          inputMode="numeric"
          maxLength={8}
          disabled={!editavel}
          error={form.formState.errors.ncmsh?.message as string | undefined}
          {...form.register('ncmsh')}
        />
        <Field
          label="&CEST"
          inputMode="numeric"
          maxLength={7}
          disabled={!editavel}
          error={form.formState.errors.cest?.message as string | undefined}
          {...form.register('cest')}
        />
        <Controller
          control={form.control}
          name="aliquota"
          render={({ field }) => (
            <SelectField
              label="&Alíquota"
              options={aliquotaOptions}
              value={field.value ?? undefined}
              onChange={(v) => field.onChange(v ?? '')}
              placeholder="Selecione a alíquota…"
              error={form.formState.errors.aliquota?.message as string | undefined}
            />
          )}
        />
        <Controller
          control={form.control}
          name="origemprod"
          render={({ field }) => (
            <SelectField
              label="&Origem"
              options={ORIGEM_OPCOES}
              value={field.value ?? undefined}
              onChange={(v) => field.onChange(v || undefined)}
              placeholder="Selecione a origem…"
              error={form.formState.errors.origemprod?.message as string | undefined}
            />
          )}
        />
        <Controller
          control={form.control}
          name="idpiscofins"
          render={({ field }) => (
            <NumberField
              label="&PIS/COFINS (id)"
              value={field.value as number | undefined}
              onChange={field.onChange}
              decimais={0}
              min={0}
              disabled={!editavel}
              error={form.formState.errors.idpiscofins?.message as string | undefined}
            />
          )}
        />
        <Controller
          control={form.control}
          name="codfigurafiscal"
          render={({ field }) => (
            <NumberField
              label="&Figura fiscal (cód.)"
              value={field.value as number | undefined}
              onChange={field.onChange}
              decimais={0}
              min={0}
              disabled={!editavel}
              error={form.formState.errors.codfigurafiscal?.message as string | undefined}
            />
          )}
        />
        <Controller
          control={form.control}
          name="codfcp"
          render={({ field }) => (
            <NumberField
              label="FC&P (cód.)"
              value={field.value as number | undefined}
              onChange={field.onChange}
              decimais={0}
              min={0}
              disabled={!editavel}
              error={form.formState.errors.codfcp?.message as string | undefined}
            />
          )}
        />
        <Controller
          control={form.control}
          name="mva"
          render={({ field }) => (
            <NumberField
              label="&MVA (%)"
              value={field.value as number | undefined}
              onChange={field.onChange}
              decimais={2}
              min={0}
              endAddon="%"
              disabled={!editavel}
              error={form.formState.errors.mva?.message as string | undefined}
            />
          )}
        />
      </div>
    </fieldset>
  );
}

// ───────────────────────────── Preços ─────────────────────────────

/**
 * PREÇOS da empresa única (F2) — INLINE e editável, espelhando o legado (`frmCadProduto`),
 * onde Custo/Custo Rep./Markup/Valor Venda/VL.Promo + flags ficam na própria aba Principal,
 * com um botão "Precificação". Substitui o antigo grid+modal (`PrecoModal`), que o operador
 * achava ruim de ver/editar. NÃO é mais um sub-grid: os campos são `Controller`/register
 * direto em `precos.0.*` (MULTI_PRECO continua sendo o modelo; em F2 há 1 empresa, idempresa=1).
 *
 * O VRVENDA continua sendo RESULTADO do motor REUSADO (POST /precificacao/produto), agora via
 * um botão "Calcular venda" inline. A gravação cascateia no engine agregado (master + preços
 * numa só transação).
 *
 * Robustez na edição: o pilar faz `form.reset(registroCarregado)`, trocando `precos` pelo
 * array carregado — a linha da empresa única pode não estar no índice 0 (ou `precos` pode vir
 * vazio em produtos antigos). O efeito de normalização garante que `precos.0` SEMPRE é a linha
 * da empresa F2 (com `idempresa` preservado), para o binding inline e o `idempresa` exigido
 * pelo schema funcionarem na gravação.
 */
function PrecosSection({
  form,
  editavel,
  aliquotaOptions,
}: {
  form: UseFormReturn<CriarProdutoDto>;
  editavel: boolean;
  aliquotaOptions: Opcao[];
}) {
  const mensagem = useMensagem();
  // alíquota do produto: default da alíquota de saída e do cálculo de venda (como no legado).
  const produtoAliquota = form.watch('aliquota');
  // UF do cálculo: MULTI_PRECO é por empresa, mas EMPRESAS ainda não foi migrada.
  // TODO: a UF virá da EMPRESA (idempresa) quando o cadastro for migrado. Default 'SP'.
  const [uf, setUf] = useState('SP');
  const [calculando, setCalculando] = useState(false);

  // ── Normalização edit-load: garante que `precos.0` é SEMPRE a linha da empresa F2 ──
  // O `form.reset` do pilar substitui `precos` pelo array carregado (idempresa=1 pode não
  // estar no índice 0; produtos antigos podem vir sem linha). Reordena/inicializa uma única
  // vez por carga, sem sujar o form (shouldDirty:false), preservando `idempresa`.
  const precos = form.watch('precos');
  useEffect(() => {
    const lista = (precos ?? []) as PrecoProdutoDto[];
    const atual0 = lista[0];
    // já normalizado: linha 0 existe e é a empresa F2 → nada a fazer (evita loop).
    if (atual0 && Number(atual0.idempresa) === IDEMPRESA_F2) return;

    const daEmpresa = lista.find((p) => Number(p.idempresa) === IDEMPRESA_F2);
    const restante = lista.filter((p) => Number(p.idempresa) !== IDEMPRESA_F2);
    const linha0: PrecoProdutoDto = daEmpresa
      ? { ...daEmpresa, idempresa: IDEMPRESA_F2 }
      : { idempresa: IDEMPRESA_F2, promocao: 'N', ativo: 'S', ativo_compra: 'S' };
    form.setValue('precos', [linha0, ...restante], { shouldDirty: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [precos]);

  // alíquota de saída efetiva p/ o cálculo: a do preço, senão a do produto (default).
  const aliquotaCalc =
    (form.watch('precos.0.aliquotasaida') ?? '').trim() || (produtoAliquota ?? '').trim();

  /** REUSO do motor: POST /precificacao/produto → seta `precos.0.vrvenda` (e mostra o CST). */
  const calcularVenda = async () => {
    if (calculando) return; // guarda de reentrância (o Button do app não tem `disabled`)
    setCalculando(true);
    try {
      const r = await precificarProduto({
        custo: form.getValues('precos.0.vrcusto') ?? 0,
        margem: form.getValues('precos.0.markup') ?? 0,
        aliquota: aliquotaCalc,
        uf: uf.trim().toUpperCase(),
        pis: 0,
        cofins: 0,
        regime: 'atual',
      });
      form.setValue('precos.0.vrvenda', r.valorVenda, { shouldDirty: true });
      mensagem.sucesso(`Preço de venda calculado: R$ ${r.valorVenda.toFixed(2)} (CST ${r.cst}).`);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCalculando(false);
    }
  };

  return (
    <fieldset disabled={!editavel} className="rounded-radius-md border border-border p-pad-md">
      <legend className="px-pad-xs text-fg-muted">Preços</legend>
      {/* idempresa fixo da empresa F2 — mantido no form (exigido pelo schema) sem campo visível. */}
      <input type="hidden" {...form.register('precos.0.idempresa', { valueAsNumber: true })} />
      <div className="flex flex-col gap-form-gap">
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          <Controller
            control={form.control}
            name="precos.0.vrcusto"
            render={({ field }) => (
              <CurrencyField
                label="&Custo"
                value={field.value as number | undefined}
                onChange={field.onChange}
                error={form.formState.errors.precos?.[0]?.vrcusto?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="precos.0.vrcustorep"
            render={({ field }) => (
              <CurrencyField
                label="Custo &reposição"
                value={field.value as number | undefined}
                onChange={field.onChange}
                error={
                  form.formState.errors.precos?.[0]?.vrcustorep?.message as string | undefined
                }
              />
            )}
          />
          <Controller
            control={form.control}
            name="precos.0.markup"
            render={({ field }) => (
              <NumberField
                label="&Markup"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={4}
                min={0}
                endAddon="%"
                error={form.formState.errors.precos?.[0]?.markup?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="precos.0.margeml"
            render={({ field }) => (
              <NumberField
                label="Margem (&ML)"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={4}
                min={0}
                endAddon="%"
                error={form.formState.errors.precos?.[0]?.margeml?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="precos.0.vrvenda"
            render={({ field }) => (
              <CurrencyField
                label="Valor &venda"
                value={field.value as number | undefined}
                onChange={field.onChange}
                error={form.formState.errors.precos?.[0]?.vrvenda?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="precos.0.vrpromo"
            render={({ field }) => (
              <CurrencyField
                label="VL.&promo"
                value={field.value as number | undefined}
                onChange={field.onChange}
                error={form.formState.errors.precos?.[0]?.vrpromo?.message as string | undefined}
              />
            )}
          />
          {/* alíquota de saída — default da alíquota fiscal do produto (form.watch('aliquota')). */}
          <Controller
            control={form.control}
            name="precos.0.aliquotasaida"
            render={({ field }) => (
              <SelectField
                label="A&líquota saída"
                options={aliquotaOptions}
                value={field.value ?? undefined}
                onChange={(v) => field.onChange(v || undefined)}
                placeholder={produtoAliquota ? `Padrão: ${produtoAliquota}` : 'Selecione a alíquota…'}
                error={
                  form.formState.errors.precos?.[0]?.aliquotasaida?.message as string | undefined
                }
              />
            )}
          />
        </div>

        {/* "Precificação" do legado → REUSO do motor (POST /precificacao/produto). UF temporária. */}
        <div className="flex items-end gap-gp-sm">
          <div className="w-32">
            <Field
              label="&UF (cálculo)"
              value={uf}
              maxLength={2}
              onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))}
            />
          </div>
          <Button label="&Calcular venda" variant="soft" onClick={() => void calcularVenda()} />
        </div>

        {/* Flags de controle (char 'S'/'N') — espelham Ativo p/Compra, Ativo p/Venda, Promoção. */}
        <div className="flex flex-wrap items-center gap-gp-lg">
          <Controller
            control={form.control}
            name="precos.0.ativo"
            render={({ field }) => (
              <CheckboxField
                label="Ativo p/ &venda"
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={form.control}
            name="precos.0.ativo_compra"
            render={({ field }) => (
              <CheckboxField
                label="Ativo p/ &compra"
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={form.control}
            name="precos.0.promocao"
            render={({ field }) => (
              <CheckboxField label="&Promoção" value={field.value} onChange={field.onChange} />
            )}
          />
        </div>
      </div>
    </fieldset>
  );
}

// ───────────────────────── Códigos auxiliares ─────────────────────────

/**
 * célula utilitária: resolve o label de uma opção a partir do value. Aceita value numérico
 * (lookups numéricos, ex.: unidade) OU string (lookups de chave natural, ex.: alíquota).
 */
function rotuloOpcao(
  options: Opcao[],
  value: number | undefined,
  valueStr?: string,
): string {
  const v = valueStr != null ? valueStr : value != null ? String(value) : undefined;
  if (v == null || v === '') return '';
  const o = options.find((op) => op.value === v);
  return o ? o.label : v;
}

/**
 * Detalhe 1:N (códigos auxiliares — CODAUXILIAR) — GRID + botões adicionar/editar/remover
 * via `useFieldArray('codauxiliares')`. Espelha as seções de Endereços/Bancos de Parceiros:
 * itens recém-adicionados (do modal) e os carregados (read do master) compartilham o shape
 * `CodAuxiliarDto`, exibidos de forma idêntica — antes mesmo de gravar. A gravação cascateia
 * no engine agregado (uma só chamada de save com o master + codauxiliares).
 */
function CodAuxiliaresSection({
  form,
  editavel,
  unidadeOptions,
}: {
  form: UseFormReturn<CriarProdutoDto>;
  editavel: boolean;
  unidadeOptions: Opcao[];
}) {
  const { fields, append, update, remove } = useFieldArray<
    CriarProdutoDto,
    'codauxiliares',
    'fieldId'
  >({
    control: form.control,
    name: 'codauxiliares',
    keyName: 'fieldId',
  });
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const onConfirmar = (item: CodAuxiliarDto) => {
    if (editIdx == null) return;
    if (editIdx < 0) append(item);
    else update(editIdx, item);
    setEditIdx(null);
  };

  const columns = useMemo<DataTableColumnDef<CodAuxiliarDto & { fieldId: string }>[]>(
    () => [
      { field: 'codauxiliar', headerName: 'Código auxiliar', type: 'text', isPrimary: true },
      { field: 'codbarra', headerName: 'Cód. barras', type: 'text', width: 160 },
      { field: 'fatoremb', headerName: 'Fator emb.', type: 'text', width: 120 },
      {
        field: 'codunidade',
        headerName: 'Unidade',
        type: 'text',
        width: 160,
        valueGetter: (row) => rotuloOpcao(unidadeOptions, row.codunidade),
      },
      {
        field: 'acoes',
        headerName: '',
        type: 'actions',
        width: 110,
        getActions: () => [
          {
            id: 'editar',
            label: 'Editar',
            icon: <Pencil className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            onClick: (r: CodAuxiliarDto & { fieldId: string }) => {
              const idx = fields.findIndex((f) => f.fieldId === r.fieldId);
              if (idx >= 0) setEditIdx(idx);
            },
          },
          {
            id: 'remover',
            label: 'Remover',
            icon: <Trash2 className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            destructive: true,
            onClick: (r: CodAuxiliarDto & { fieldId: string }) => {
              const idx = fields.findIndex((f) => f.fieldId === r.fieldId);
              if (idx >= 0) remove(idx);
            },
          },
        ],
      },
    ],
    [fields, remove, unidadeOptions],
  );

  return (
    <fieldset disabled={!editavel} className="rounded-radius-base border border-border p-pad-md">
      <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">
        Códigos auxiliares
      </legend>
      <div className="flex flex-col gap-gp-sm">
        <div>
          <Button
            label="Adicionar código au&xiliar"
            variant="soft"
            onClick={() => setEditIdx(-1)}
          />
        </div>

        {fields.length === 0 ? (
          <small className="text-fg-muted">Sem códigos auxiliares.</small>
        ) : (
          <DataTable
            rows={fields as Array<CodAuxiliarDto & { fieldId: string }>}
            columns={columns}
            getRowId={(r) => r.fieldId}
            toolbar={{ enableSearch: false, enableFilters: false }}
            paginationConfig={{ enabled: true, initialPageSize: 10 }}
            cardBreakpoint={false}
          />
        )}
      </div>

      {editIdx != null && (
        <CodAuxiliarModal
          inicial={editIdx >= 0 ? (fields[editIdx] as CodAuxiliarDto) : undefined}
          unidadeOptions={unidadeOptions}
          onFechar={() => setEditIdx(null)}
          onConfirmar={onConfirmar}
        />
      )}
    </fieldset>
  );
}
