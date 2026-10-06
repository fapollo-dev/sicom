import { useEffect, useMemo, useRef, useState, createContext, useContext } from 'react';
import { Controller, useFieldArray, type UseFormReturn } from 'react-hook-form';
import { Pencil, Trash2 } from 'lucide-react';
import { DataTable, type DataTableColumnDef } from '@apollosg/design-system';
import {
  produtoSchema,
  ORIGEM_OPCOES,
  gerarCodigoInternoEan13,
  type CriarProdutoDto,
  type CodAuxiliarDto,
  type PrecoProdutoDto,
  type EstoqueProdutoDto,
  type ComposicaoItemDto,
  type DecomposicaoItemDto,
  type ReceitaItemDto,
  type FatorConversaoItemDto,
} from '@apollo/shared';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { DateField } from '../../shared/ui/DateField';
import { TextArea } from '../../shared/ui/TextArea';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { useNavigate } from 'react-router-dom';
import { abrirEtiquetasCom } from '../etiqueta/etiquetaApi';
import { useResourceOptions, type Opcao } from '../../shared/cadmaster/useResourceOptions';
import { CodAuxiliarModal } from './CodAuxiliarModal';
import { ComposicaoModal } from './ComposicaoModal';
import { DecomposicaoModal } from './DecomposicaoModal';
import { ReceitaModal } from './ReceitaModal';
import { FatorConversaoModal } from './FatorConversaoModal';
import { getProdutosFilhos, type ProdutoFilho } from './produtoFilhosApi';
import { getPosicaoEstoque, type EstoqueSaldo, type EstoqueMovimento } from './produtoEstoqueApi';
import { HistoricoMovimentacoesSection } from './HistoricoMovimentacoesSection';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import { RefFornecedorSection } from '../de-para/RefFornecedorSection';
import { precificarProduto } from './precificacaoApi';
import { useOpcoesDoForm } from '../../shared/acesso/useOpcoesDoForm';
import { getSessao } from '../../shared/auth/session';
import { useShortcut } from '../../shared/keyboard';

/**
 * a LOJA DA SESSÃO (`dmPrincipal.EmpresaCODEMPRESA` no legado) — a edição inline de preço acontece em `precos.0` e a de
 * estoque em `estoques.0`, sempre a linha da empresa em que o operador entrou. Era fixa na empresa 1: em 2026 as edições
 * de preço do cliente se dividem entre as empresas 1 (1.380), 2 (1.069) e 52 (50) — a 2 e a 52 gravavam na 1. As outras
 * lojas o servidor sincroniza como o legado (produto-lojas.ts).
 */
const empresaF2 = (): number => getSessao()?.empresa ?? 1;

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
/**
 * as PERMISSÕES DE CONTROLE da tela (uMaster.SetStateOfControlsMaster sobre o UCadProduto.dfm): preço, custo, custo de reposição,
 * ativo, precificação e os botões de composição/decomposição só ficam habilitados para quem tem a opção. A gravação confere de novo.
 */
const PodeCtx = createContext<(opcao: string) => boolean>(() => true);

export function ProdutoCadMaster() {
  const acesso = useOpcoesDoForm('FRMCADPRODUTO');
  // ── LOOKUPs do master (data-bound, espelham os combos do legado) ──
  // Unidade: guarda codunidade (FK) E unidade (sigla — o schema exige a sigla).
  const { data: unidadeOptions = [] } = useResourceOptions(
    'cadastro/unidades',
    (r: any) => ({ value: String(r.codunidade), label: `${r.sigla} - ${r.descricao}` }),
  );
  // Fator de conversão: o DE é a SIGLA da unidade (varchar 'KG'/'UN'…), não o código → value = sigla.
  const { data: unidadeSiglaOptions = [] } = useResourceOptions(
    'cadastro/unidades',
    (r: any) => ({ value: String(r.sigla), label: `${r.sigla} - ${r.descricao}` }),
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
  // Produtos (F4 — kit/BOM): lista TODOS os produtos (um componente/ingrediente é qualquer
  // produto). Reusado nas 3 sub-grids (Composição, Decomposição, Receita). A PK ora vem como
  // idproduto, ora como codigo → value; label = "codbarra - descrição".
  const { data: produtoOptions = [] } = useResourceOptions('cadastro/produtos', (r: any) => ({
    value: String(r.idproduto ?? r.codigo),
    label: `${r.codbarra} - ${r.descricao}`,
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
      // o NewRecord do binário novo (o "Inseriu" de 2026): o servidor aplica os mesmos quando a tela não manda
      uso_consumo: 'N',
      visivel_rel: 'S',
      pis: 'S',
      tipopis: 'N',
      tipo_item: 0,
      receitaunidade: 'KG',
      apresentacao_etiqueta: 1,
      codauxiliares: [],
      // F2 — MULTI_PRECO por empresa: a tela edita a linha da empresa única INLINE em
      // `precos.0`; semeada aqui p/ o binding existir num registro NOVO (defaults do legado).
      precos: [{ idempresa: empresaF2(), promocao: 'N', ativo: 'S', ativo_compra: 'S' }],
      // F3 — ESTOQUE por empresa: linha da empresa única INLINE em `estoques.0`; semeada
      // zerada (saldo movido por transação) p/ o binding existir num registro NOVO — espelha
      // o legado, onde a linha de estoque de um produto novo nasce zerada.
      estoques: [{ idempresa: empresaF2(), qtde: 0, minimo: 0, maximo: 0 }],
      // F4 — kit/BOM: 3 sub-grids 1:N na mesma form, começam vazios num registro NOVO.
      composicoes: [],
      decomposicoes: [],
      receitas: [],
      fatoresConversao: [],
    }),
    [],
  );

  return (
    <CadMaster<CriarProdutoDto>
      titulo="Produtos"
      resourcePath="cadastro/produtos"
      pk="idproduto"
      log={{ form: 'FRMCADPRODUTO', chave: 'IDPRODUTO' }}
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
        <PodeCtx.Provider value={acesso.tem}>
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
          {/* Estoque INLINE logo após Preços — saldo (qtde) read-only; só mín/máx/local editáveis. */}
          <EstoqueSection form={form} editavel={editavel} />
          <FiscalSection form={form} editavel={editavel} aliquotaOptions={aliquotaOptions} />
          <CodAuxiliaresSection
            form={form}
            editavel={editavel}
            unidadeOptions={unidadeOptions}
          />
          {/* F4 — kit/BOM: 3 sub-grids na MESMA form, espelhando o padrão dos códigos auxiliares. */}
          <ComposicaoSection form={form} editavel={editavel} produtoOptions={produtoOptions} />
          <DecomposicaoSection form={form} editavel={editavel} produtoOptions={produtoOptions} />
          <ReceitaSection form={form} editavel={editavel} produtoOptions={produtoOptions} />
          {/* Fator de conversão de unidades (tabFatorConversao) — grid na MESMA form; PARA = unidade do produto. */}
          <FatorConversaoSection
            form={form}
            editavel={editavel}
            unidadeSiglaOptions={unidadeSiglaOptions}
          />
          {/* Produtos filhos (aba TsFilhos) — vínculo pai/fator + grid read-only das variações filhas. */}
          <ProdutosFilhosSection form={form} editavel={editavel} produtoOptions={produtoOptions} />
          {/* Posição de estoque (UPosicaoProduto) — saldo/empresa + Ficha de movimentação (Kardex), read-only. */}
          <PosicaoEstoqueSection form={form} />
          {/* Histórico das movimentações (TbsHistoricoMovimentacoes) — as sub-abas de consulta e as impressões no layout do cliente. */}
          <HistoricoMovimentacoesSection idproduto={Number(form.watch('idproduto' as never)) || undefined} />
          {/* F4b — campos-mestre de armazenamento puro (sem cálculo), INLINE na MESMA form. */}
          <NutricionalSection form={form} editavel={editavel} />
          <LogisticaSection form={form} editavel={editavel} />
          <OutrosSection form={form} editavel={editavel} />
          <ComplementosSection form={form} editavel={editavel} />
          {/* mig 314 — Fornecedores desassociados (TbsFornecedoresDesassociados): as importações do pedido pulam o produto. */}
          <FornecedoresDesassociadosSection form={form} editavel={editavel} fornecedorOptions={fornecedorOptions} />
          {/* Referência Fornecedor (CODREFERENCIA_FOR / DE-PARA) — visto por idproduto; só p/ produto gravado. */}
          <fieldset className="rounded-radius-md border border-border p-pad-md">
            <legend className="px-pad-xs text-fg-muted">Referência Fornecedor</legend>
            <RefFornecedorSection idproduto={Number(form.watch('idproduto' as never)) || undefined} editavel={editavel} />
          </fieldset>
        </div>
        </PodeCtx.Provider>
      )}
    />
  );
}

// ───────────────────────── Fornecedores desassociados ─────────────────────────

/**
 * A aba "Fornecedores desassociados" (UCadProduto.pas:679, BtnAdicionar/BtnExcluir :1830): os fornecedores de quem o
 * produto foi tirado — a importação de itens do pedido de compra não o traz para eles. Fornecedor repetido é ignorado.
 */
function FornecedoresDesassociadosSection({
  form,
  editavel,
  fornecedorOptions,
}: {
  form: UseFormReturn<CriarProdutoDto>;
  editavel: boolean;
  fornecedorOptions: Opcao[];
}) {
  const { fields, append, remove } = useFieldArray<CriarProdutoDto, 'fornecedores_desassociados', 'fieldId'>({
    control: form.control,
    name: 'fornecedores_desassociados',
    keyName: 'fieldId',
  });
  const [escolhido, setEscolhido] = useState<string | undefined>(undefined);
  const adicionar = () => {
    const c = Number(escolhido);
    if (!c) return;
    if (!fields.some((f) => Number(f.codparceiro) === c)) append({ codparceiro: c });
    setEscolhido(undefined);
  };
  return (
    <fieldset disabled={!editavel} className="rounded-radius-base border border-border p-pad-md">
      <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">Fornecedores desassociados</legend>
      <div className="flex flex-col gap-gp-sm">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="min-w-64">
            <SelectField label="Fornecedor" options={fornecedorOptions} value={escolhido} onChange={(v) => setEscolhido(v || undefined)} placeholder="Selecione…" />
          </div>
          <Button label="Desassociar fornecedor" variant="soft" onClick={adicionar} />
        </div>
        {fields.length === 0 ? (
          <p className="text-body-sm text-fg-muted">Nenhum fornecedor desassociado.</p>
        ) : (
          <ul className="flex flex-col gap-gp-2xs">
            {fields.map((f, i) => (
              <li key={f.fieldId} className="flex items-center justify-between rounded-radius-base border border-border-subtle px-pad-sm py-pad-xs text-body-sm">
                <span>{rotuloOpcao(fornecedorOptions, Number(f.codparceiro))}</span>
                <Button label="Remover" variant="ghost" onClick={() => remove(i)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </fieldset>
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
  const pode = useContext(PodeCtx);
  // dica visual: só sinaliza inválido quando há conteúdo (a obrigatoriedade é do schema).
  const ehBalanca = form.watch('balanca') === 'S';
  const fatorCxRef = useRef<HTMLDivElement>(null);
  // F5 = SetaFoco(edtFATORCX) com a aba principal ativa (FormKeyDown do UCadProduto); com uma janela aberta por cima, a tecla é dela
  useShortcut('f5', () => {
    if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return false;
    fatorCxRef.current?.querySelector<HTMLInputElement>('input')?.focus();
  });

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
                error={form.formState.errors.codbarra?.message as string | undefined}
                {...form.register('codbarra')}
              />
            </div>
            <Button label="&Gerar EAN interno" variant="soft" onClick={gerarEan} />
          </div>

          <div className="sm:col-span-2">
            <Field
              label="Descrição"
              disabled={!editavel}
              error={form.formState.errors.descricao?.message as string | undefined}
              {...form.register('descricao')}
            />
          </div>
          <Field
            label="Descrição resumida"
            disabled={!editavel}
            error={form.formState.errors.descricao_resumida?.message as string | undefined}
            {...form.register('descricao_resumida')}
          />
          <Field
            label="Descrição web"
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
                label="Unidade"
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
                label="Fornecedor"
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
                label="Marca"
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
                label="Grupo"
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
                label="Departamento"
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
                label="Seção"
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
                disabled={!editavel || !pode('CHBATIVO')}
              />
            )}
          />
          <Controller
            control={form.control}
            name="ativo_compra"
            render={({ field }) => (
              <CheckboxField
                label="Ativo p/ compra"
                value={field.value}
                onChange={field.onChange}
                disabled={!editavel || !pode('CHBATIVOCOMPRA')}
              />
            )}
          />
          <Controller
            control={form.control}
            name="uso_consumo"
            render={({ field }) => (
              <CheckboxField label="Uso e consumo" value={(field.value as string | undefined) ?? 'N'} onChange={field.onChange} disabled={!editavel} />
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
                label="Fator KG"
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
                label="Peso"
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
              <div ref={fatorCxRef}>
                <NumberField
                  label="Fator cai&xa"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={0}
                  min={0}
                  disabled={!editavel}
                  error={form.formState.errors.fatorcx?.message as string | undefined}
                />
              </div>
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
  const pode = useContext(PodeCtx);
  return (
    <fieldset className="rounded-radius-md border border-border p-pad-md">
      <legend className="px-pad-xs text-fg-muted">Fiscal</legend>
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
        <Field
          label="&NCM"
          inputMode="numeric"
          maxLength={8}
          disabled={!editavel || !pode('EDTNCMSH')}
          error={form.formState.errors.ncmsh?.message as string | undefined}
          {...form.register('ncmsh')}
        />
        <Field
          label="CEST"
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
              disabled={!editavel || !pode('EDTCODFIGFISCAL')}
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
              label="MVA (%)"
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
 * direto em `precos.0.*` (MULTI_PRECO continua sendo o modelo; a linha editada é a da loja da sessão).
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
  const pode = useContext(PodeCtx);
  const mensagem = useMensagem();
  const navigate = useNavigate();
  const idprodutoGravado = (form.getValues() as { idproduto?: number }).idproduto;
  // "Imprime etiqueta" (ImprimeEtiqueta1Click, UCadProduto.pas:6800): o produto da tela com o preço da loja, a quantidade do cadastro
  const imprimirEtiqueta = () => {
    if (idprodutoGravado == null) return;
    abrirEtiquetasCom({ fonte: 'cadastro', itens: [{ idproduto: Number(idprodutoGravado) }] }, navigate);
  };
  // alíquota do produto: default da alíquota de saída e do cálculo de venda (como no legado).
  const produtoAliquota = form.watch('aliquota');
  // UF do cálculo: MULTI_PRECO é por empresa, mas EMPRESAS ainda não foi migrada.
  // TODO: a UF virá da EMPRESA (idempresa) quando o cadastro for migrado. Default 'SP'.
  const [uf, setUf] = useState('SP');
  const [calculando, setCalculando] = useState(false);
  // motor completo (corte precificação): resultado da análise (custo líquido / PMZ / margem líquida / lucro).
  const [analise, setAnalise] = useState<{ custoLiquido: number; pmz: number; margemLiquida: number; lucroBruto: number; lucroLiquido: number } | null>(null);
  // limpa a análise ao trocar de produto (senão o painel fica "grudado" com o cálculo do registro anterior).
  const idprodAtual = form.watch('idproduto' as never);
  useEffect(() => { setAnalise(null); }, [idprodAtual]);

  // ── Normalização edit-load: garante que `precos.0` é SEMPRE a linha da empresa F2 ──
  // O `form.reset` do pilar substitui `precos` pelo array carregado (a linha da sessão pode não
  // estar no índice 0; produtos antigos podem vir sem linha). Reordena/inicializa uma única
  // vez por carga, sem sujar o form (shouldDirty:false), preservando `idempresa`.
  const precos = form.watch('precos');
  useEffect(() => {
    const lista = (precos ?? []) as PrecoProdutoDto[];
    const atual0 = lista[0];
    // já normalizado: linha 0 existe e é a empresa F2 → nada a fazer (evita loop).
    if (atual0 && Number(atual0.idempresa) === empresaF2()) return;

    const daEmpresa = lista.find((p) => Number(p.idempresa) === empresaF2());
    const restante = lista.filter((p) => Number(p.idempresa) !== empresaF2());
    const linha0: PrecoProdutoDto = daEmpresa
      ? { ...daEmpresa, idempresa: empresaF2() }
      : { idempresa: empresaF2(), promocao: 'N', ativo: 'S', ativo_compra: 'S' };
    form.setValue('precos', [linha0, ...restante], { shouldDirty: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [precos]);

  // a alíquota do cálculo é a do produto: no legado o combo "Alíquota" do cadastro é a própria ALIQUOTASAIDA da linha da loja (a API a
  // espelha ao gravar e a espalha para as lojas da UF)
  const aliquotaCalc =
    (produtoAliquota ?? '').trim() || (form.watch('precos.0.aliquotasaida') ?? '').trim();

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
      form.setValue('precos.0.margeml', r.margemLiquida, { shouldDirty: true }); // margem líquida calculada
      setAnalise({ custoLiquido: r.custoLiquido, pmz: r.pmz, margemLiquida: r.margemLiquida, lucroBruto: r.lucroBruto, lucroLiquido: r.lucroLiquido });
      mensagem.sucesso(`Preço de venda calculado: R$ ${r.valorVenda.toFixed(2)} (CST ${r.cst}) · PMZ R$ ${r.pmz.toFixed(2)} · margem líq. ${r.margemLiquida.toFixed(2)}%.`);
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
                label="Custo"
                value={field.value as number | undefined}
                onChange={field.onChange}
                disabled={!pode('EDTCUSTO')}
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
                disabled={!pode('EDTCUSTOREP')}
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
                label="Markup"
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
                disabled={!pode('EDTVRVENDA')}
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
          <Button label="&Calcular venda" variant="soft" disabled={!pode('BTNPRECIFICACAO')} onClick={() => void calcularVenda()} />
          <Button label="Imprimir e&tiqueta" variant="ghost" disabled={idprodutoGravado == null} onClick={imprimirEtiqueta} />
        </div>

        {/* Motor completo (corte precificação): custo líquido / PMZ / margem líquida / lucro. */}
        {analise && (
          <div className="grid grid-cols-2 gap-gp-sm rounded-radius-base border border-border bg-bg-subtle p-pad-sm text-body-sm sm:grid-cols-4">
            <div><span className="text-fg-muted">Custo líquido</span><br /><span className="font-semibold tabular-nums">R$ {analise.custoLiquido.toFixed(2)}</span></div>
            <div><span className="text-fg-muted">PMZ (ponto de zero)</span><br /><span className="font-semibold tabular-nums">R$ {analise.pmz.toFixed(2)}</span></div>
            <div><span className="text-fg-muted">Margem líquida</span><br /><span className="font-semibold tabular-nums">{analise.margemLiquida.toFixed(2)}%</span></div>
            <div><span className="text-fg-muted">Lucro líquido</span><br /><span className="font-semibold tabular-nums">R$ {analise.lucroLiquido.toFixed(2)}</span></div>
          </div>
        )}

        {/* Flags de controle (char 'S'/'N') — espelham Ativo p/Compra, Ativo p/Venda, Promoção. */}
        <div className="flex flex-wrap items-center gap-gp-lg">
          <Controller
            control={form.control}
            name="precos.0.ativo"
            render={({ field }) => (
              <CheckboxField
                label="Ativo p/ venda"
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
                label="Ativo p/ compra"
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={form.control}
            name="precos.0.promocao"
            render={({ field }) => (
              <CheckboxField label="Promoção" value={field.value} onChange={field.onChange} />
            )}
          />
        </div>
      </div>
    </fieldset>
  );
}

// ───────────────────────────── Estoque ─────────────────────────────

/**
 * ESTOQUE da empresa única (F3) — INLINE na MESMA form do produto, espelhando a seção de
 * Preços (`PrecosSection`). NÃO é grid/modal: os campos são `Controller`/register direto em
 * `estoques.0.*` (ESTOQUE por empresa continua sendo o modelo; a linha editada é a da loja da sessão).
 *
 * REGRA DE NEGÓCIO: o SALDO (`qtde`) é MOVIDO POR TRANSAÇÃO (NF/vendas/ajuste) — no cadastro
 * é READ-ONLY (no legado os 3 campos de saldo são Enabled=False). Aqui exibimos só o saldo,
 * desabilitado; o usuário edita apenas MÍNIMO, MÁXIMO e LOCAL. `qtde` ronda no payload (input
 * hidden) só p/ preservar o saldo no substitute do agregado — nunca é alterado pelo usuário.
 *
 * Robustez na edição: o pilar faz `form.reset(registroCarregado)`, trocando `estoques` pelo
 * array carregado — a linha da empresa única pode não estar no índice 0 (ou `estoques` pode vir
 * vazio em produtos antigos). O efeito de normalização garante que `estoques.0` SEMPRE é a linha
 * da empresa F3 (com `idempresa`/`qtde` preservados), para o binding inline e o `idempresa`
 * exigido pelo schema funcionarem na gravação.
 */
function EstoqueSection({
  form,
  editavel,
}: {
  form: UseFormReturn<CriarProdutoDto>;
  editavel: boolean;
}) {
  // ── Normalização edit-load: garante que `estoques.0` é SEMPRE a linha da empresa F3 ──
  // O `form.reset` do pilar substitui `estoques` pelo array carregado (a linha da sessão pode não
  // estar no índice 0; produtos antigos podem vir sem linha). Reordena/inicializa uma única
  // vez por carga, sem sujar o form (shouldDirty:false), preservando `idempresa` e `qtde`.
  const estoques = form.watch('estoques');
  useEffect(() => {
    const lista = (estoques ?? []) as EstoqueProdutoDto[];
    const atual0 = lista[0];
    // já normalizado: linha 0 existe e é a empresa F3 → nada a fazer (evita loop).
    if (atual0 && Number(atual0.idempresa) === empresaF2()) return;

    const daEmpresa = lista.find((e) => Number(e.idempresa) === empresaF2());
    const restante = lista.filter((e) => Number(e.idempresa) !== empresaF2());
    const linha0: EstoqueProdutoDto = daEmpresa
      ? { ...daEmpresa, idempresa: empresaF2() }
      : { idempresa: empresaF2(), qtde: 0, minimo: 0, maximo: 0 };
    form.setValue('estoques', [linha0, ...restante], { shouldDirty: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estoques]);

  // saldo carregado (read-only) — apenas exibido; o valor real ronda via o input hidden de qtde.
  const saldo = form.watch('estoques.0.qtde');

  return (
    <fieldset disabled={!editavel} className="rounded-radius-md border border-border p-pad-md">
      <legend className="px-pad-xs text-fg-muted">Estoque</legend>
      {/* idempresa fixo da empresa F3 — mantido no form (exigido pelo schema) sem campo visível. */}
      <input type="hidden" {...form.register('estoques.0.idempresa', { valueAsNumber: true })} />
      {/* qtde (saldo) movido por transação — ronda no payload p/ o substitute do agregado preservar o saldo. */}
      <input type="hidden" {...form.register('estoques.0.qtde', { valueAsNumber: true })} />
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
        {/* SALDO — READ-ONLY: movido por transação (NF/vendas/ajuste); nunca editável no cadastro. */}
        <NumberField
          label="&Saldo (movido por transação)"
          value={saldo as number | undefined}
          decimais={3}
          disabled
        />
        <Controller
          control={form.control}
          name="estoques.0.minimo"
          render={({ field }) => (
            <NumberField
              label="Mínimo"
              value={field.value as number | undefined}
              onChange={field.onChange}
              decimais={3}
              min={0}
              error={form.formState.errors.estoques?.[0]?.minimo?.message as string | undefined}
            />
          )}
        />
        <Controller
          control={form.control}
          name="estoques.0.maximo"
          render={({ field }) => (
            <NumberField
              label="Máximo"
              value={field.value as number | undefined}
              onChange={field.onChange}
              decimais={3}
              min={0}
              error={form.formState.errors.estoques?.[0]?.maximo?.message as string | undefined}
            />
          )}
        />
        {/* LOCAL (edtLOCAL do legado) — uppercase, máx. 50. */}
        <Controller
          control={form.control}
          name="estoques.0.local"
          render={({ field }) => (
            <Field
              label="Local"
              maxLength={50}
              value={field.value ?? ''}
              onChange={(e) => field.onChange(e.target.value.toUpperCase())}
              error={form.formState.errors.estoques?.[0]?.local?.message as string | undefined}
            />
          )}
        />
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

// ───────────────────────── F4 — kit/BOM (helpers) ─────────────────────────

/** formata número → "1.234,56" (pt-BR, 2 casas) — display dos totais (read-only). */
const fmtBRL = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ───────────────────────── Composição (kit) ─────────────────────────

/**
 * Detalhe 1:N de COMPOSIÇÃO (kit — PRODUTO_COMPOSICAO) — GRID + adicionar/editar/remover via
 * `useFieldArray('composicoes')`. Espelha EXATAMENTE o padrão dos códigos auxiliares (DataTable
 * + modal + getRowId por fieldId). Cada item referencia OUTRO produto (idproduto_01 = componente,
 * via lookup `produtoOptions`). A flag `composicao` do master é DERIVADA server-side da presença
 * de itens — sem checkbox de UI. A gravação cascateia no engine agregado.
 *
 * Total do kit = Σ(qtde×valor) — exibido READ-ONLY abaixo do grid (computado; não grava).
 */
function ComposicaoSection({
  form,
  editavel,
  produtoOptions,
}: {
  form: UseFormReturn<CriarProdutoDto>;
  editavel: boolean;
  produtoOptions: Opcao[];
}) {
  const pode = useContext(PodeCtx);
  const mensagem = useMensagem();
  // a impressão lê a composição GRAVADA (o servidor monta o dataset do sqqComposicao)
  const idproduto = Number(form.watch('idproduto' as never)) || undefined;
  const { fields, append, update, remove } = useFieldArray<
    CriarProdutoDto,
    'composicoes',
    'fieldId'
  >({
    control: form.control,
    name: 'composicoes',
    keyName: 'fieldId',
  });
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const onConfirmar = (item: ComposicaoItemDto) => {
    if (editIdx == null) return;
    if (editIdx < 0) append(item);
    else update(editIdx, item);
    setEditIdx(null);
  };

  // Total do kit = Σ(qtde × valor) — recomputa a cada render (fields reflete o array atual).
  const totalKit = (fields as Array<ComposicaoItemDto & { fieldId: string }>).reduce(
    (s, it) => s + (Number(it.qtde) || 0) * (Number(it.valor) || 0),
    0,
  );

  const columns = useMemo<DataTableColumnDef<ComposicaoItemDto & { fieldId: string }>[]>(
    () => [
      {
        field: 'idproduto_01',
        headerName: 'Produto',
        type: 'text',
        isPrimary: true,
        valueGetter: (row) => rotuloOpcao(produtoOptions, row.idproduto_01),
      },
      { field: 'qtde', headerName: 'Qtde', type: 'number', width: 120 },
      {
        field: 'valor',
        headerName: 'Valor (R$)',
        type: 'text',
        width: 140,
        valueGetter: (row) => fmtBRL(Number(row.valor) || 0),
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
            onClick: (r: ComposicaoItemDto & { fieldId: string }) => {
              const idx = fields.findIndex((f) => f.fieldId === r.fieldId);
              if (idx >= 0) setEditIdx(idx);
            },
          },
          ...(pode('BTNDELITEM') ? [{
            id: 'remover',
            label: 'Remover',
            icon: <Trash2 className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            destructive: true,
            onClick: (r: ComposicaoItemDto & { fieldId: string }) => {
              const idx = fields.findIndex((f) => f.fieldId === r.fieldId);
              if (idx >= 0) remove(idx);
            },
          }] : []),
        ],
      },
    ],
    [fields, remove, produtoOptions, pode],
  );

  return (
    <fieldset disabled={!editavel} className="rounded-radius-base border border-border p-pad-md">
      {/* o "Imprimir" (Tag 3: fora do liga/desliga da edição) fica na legenda — a 1ª legenda não herda o disabled do fieldset */}
      <legend className="flex items-center gap-gp-sm px-pad-xs text-body-sm font-semibold text-fg-default">
        Composição (kit)
        {idproduto != null && (
          <Button label="&Imprimir" variant="ghost" onClick={() => imprimirRelatorio(`/cadastro/produtos/${idproduto}/composicao/impressao`).catch((e) => mensagem.erro(e))} />
        )}
      </legend>
      <div className="flex flex-col gap-gp-sm">
        <div>
          <Button
            label="Adicionar &componente"
            variant="soft"
            disabled={!pode('BTNADDITEM')}
            onClick={() => setEditIdx(-1)}
          />
        </div>

        {fields.length === 0 ? (
          <small className="text-fg-muted">Sem componentes.</small>
        ) : (
          <>
            <DataTable
              rows={fields as Array<ComposicaoItemDto & { fieldId: string }>}
              columns={columns}
              getRowId={(r) => r.fieldId}
              toolbar={{ enableSearch: false, enableFilters: false }}
              paginationConfig={{ enabled: true, initialPageSize: 10 }}
              cardBreakpoint={false}
            />
            <small className="text-fg-muted">Total do kit: R$ {fmtBRL(totalKit)}</small>
          </>
        )}
      </div>

      {editIdx != null && (
        <ComposicaoModal
          inicial={editIdx >= 0 ? (fields[editIdx] as ComposicaoItemDto) : undefined}
          produtoOptions={produtoOptions}
          onFechar={() => setEditIdx(null)}
          onConfirmar={onConfirmar}
        />
      )}
    </fieldset>
  );
}

// ───────────────────────── Decomposição ─────────────────────────

/**
 * Detalhe 1:N de DECOMPOSIÇÃO (1 produto → vários — PRODUTO_DECOMPOSICAO) — GRID +
 * adicionar/editar/remover via `useFieldArray('decomposicoes')`. Espelha o padrão dos códigos
 * auxiliares. Cada item referencia OUTRO produto (idproduto_01 = resultante, via lookup). A flag
 * `decomposicao` é DERIVADA server-side. A REGRA "deve somar 100%" é enforced pelo back no save
 * (envelope VALIDACAO PT exibido pelo CadMaster/useMensagem); aqui exibimos o Total % corrente
 * com dica visual quando ≠ 100, p/ ajudar o usuário antes de gravar.
 */
function DecomposicaoSection({
  form,
  editavel,
  produtoOptions,
}: {
  form: UseFormReturn<CriarProdutoDto>;
  editavel: boolean;
  produtoOptions: Opcao[];
}) {
  const pode = useContext(PodeCtx);
  const { fields, append, update, remove } = useFieldArray<
    CriarProdutoDto,
    'decomposicoes',
    'fieldId'
  >({
    control: form.control,
    name: 'decomposicoes',
    keyName: 'fieldId',
  });
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const onConfirmar = (item: DecomposicaoItemDto) => {
    if (editIdx == null) return;
    if (editIdx < 0) append(item);
    else update(editIdx, item);
    setEditIdx(null);
  };

  // Total % = Σ(percentual) — a regra do back exige 100% (2 casas); dica visual quando ≠ 100.
  const totalPct = (fields as Array<DecomposicaoItemDto & { fieldId: string }>).reduce(
    (s, it) => s + (Number(it.percentual) || 0),
    0,
  );
  const cem = totalPct.toFixed(2) === (100).toFixed(2);

  const columns = useMemo<DataTableColumnDef<DecomposicaoItemDto & { fieldId: string }>[]>(
    () => [
      {
        field: 'idproduto_01',
        headerName: 'Produto',
        type: 'text',
        isPrimary: true,
        valueGetter: (row) => rotuloOpcao(produtoOptions, row.idproduto_01),
      },
      {
        field: 'percentual',
        headerName: 'Percentual (%)',
        type: 'number',
        width: 160,
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
            onClick: (r: DecomposicaoItemDto & { fieldId: string }) => {
              const idx = fields.findIndex((f) => f.fieldId === r.fieldId);
              if (idx >= 0) setEditIdx(idx);
            },
          },
          ...(pode('BTNEXCLUIDECOMP') ? [{
            id: 'remover',
            label: 'Remover',
            icon: <Trash2 className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            destructive: true,
            onClick: (r: DecomposicaoItemDto & { fieldId: string }) => {
              const idx = fields.findIndex((f) => f.fieldId === r.fieldId);
              if (idx >= 0) remove(idx);
            },
          }] : []),
        ],
      },
    ],
    [fields, remove, produtoOptions, pode],
  );

  return (
    <fieldset disabled={!editavel} className="rounded-radius-base border border-border p-pad-md">
      <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">
        Decomposição
      </legend>
      <div className="flex flex-col gap-gp-sm">
        <div>
          <Button
            label="Adicionar &resultante"
            variant="soft"
            disabled={!pode('BTNADDDESCOMP')}
            onClick={() => setEditIdx(-1)}
          />
        </div>

        {fields.length === 0 ? (
          <small className="text-fg-muted">Sem itens de decomposição.</small>
        ) : (
          <>
            <DataTable
              rows={fields as Array<DecomposicaoItemDto & { fieldId: string }>}
              columns={columns}
              getRowId={(r) => r.fieldId}
              toolbar={{ enableSearch: false, enableFilters: false }}
              paginationConfig={{ enabled: true, initialPageSize: 10 }}
              cardBreakpoint={false}
            />
            <small className={cem ? 'text-fg-muted' : 'text-fg-danger'}>
              Total %: {totalPct.toFixed(2)}%{cem ? '' : ' — deve somar 100%'}
            </small>
          </>
        )}
        {/* o rodapé da aba no legado (UCadProduto.dfm:8237-8276): a entrada decomposta na NF, o custo dela e a multi-preço */}
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          <div className="flex flex-col gap-gp-sm">
            <Controller control={form.control} name="entrada_decomposta" render={({ field }) => (
              <CheckboxField label="Entrada deste produto na nota fiscal será decomposta" value={(field.value as string | undefined) ?? 'N'} onChange={field.onChange} disabled={!editavel} />
            )} />
            <Controller control={form.control} name="atualiza_multipreco_decomp" render={({ field }) => (
              <CheckboxField label="Atualiza valor de custo dos itens de decomposição na multi-preço" value={(field.value as string | undefined) ?? 'N'} onChange={field.onChange} disabled={!editavel} />
            )} />
          </div>
          <Controller control={form.control} name="calculo_valor_custo_decomp" render={({ field }) => (
            <SelectField label="Valor de custo na entrada de nota fiscal" value={field.value ? String(field.value) : undefined}
              options={[{ value: 'CV', label: 'Calcula valor de custo pelo valor de venda' }, { value: 'CR', label: 'Calcula valor de custo rateado' }]}
              onChange={(v) => field.onChange(v ? v : undefined)} placeholder="Selecione…" disabled={!editavel} />
          )} />
        </div>
      </div>

      {editIdx != null && (
        <DecomposicaoModal
          inicial={editIdx >= 0 ? (fields[editIdx] as DecomposicaoItemDto) : undefined}
          produtoOptions={produtoOptions}
          onFechar={() => setEditIdx(null)}
          onConfirmar={onConfirmar}
        />
      )}
    </fieldset>
  );
}

// ───────────────────────── Receita (ficha técnica) ─────────────────────────

/**
 * Detalhe 1:N de RECEITA (ficha técnica — PRODUTO_RECEITA) — GRID + adicionar/editar/remover via
 * `useFieldArray('receitas')`. Espelha o padrão dos códigos auxiliares. Cada item referencia OUTRO
 * produto (idproduto_receita = ingrediente, via lookup). A flag `receita` é DERIVADA server-side
 * da presença de itens. A gravação cascateia no engine agregado.
 */
function ReceitaSection({
  form,
  editavel,
  produtoOptions,
}: {
  form: UseFormReturn<CriarProdutoDto>;
  editavel: boolean;
  produtoOptions: Opcao[];
}) {
  const { fields, append, update, remove } = useFieldArray<
    CriarProdutoDto,
    'receitas',
    'fieldId'
  >({
    control: form.control,
    name: 'receitas',
    keyName: 'fieldId',
  });
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const onConfirmar = (item: ReceitaItemDto) => {
    if (editIdx == null) return;
    if (editIdx < 0) append(item);
    else update(editIdx, item);
    setEditIdx(null);
  };

  const columns = useMemo<DataTableColumnDef<ReceitaItemDto & { fieldId: string }>[]>(
    () => [
      {
        field: 'idproduto_receita',
        headerName: 'Ingrediente',
        type: 'text',
        isPrimary: true,
        valueGetter: (row) => rotuloOpcao(produtoOptions, row.idproduto_receita),
      },
      { field: 'qtde', headerName: 'Qtde', type: 'number', width: 120 },
      { field: 'unidade', headerName: 'Unidade', type: 'text', width: 110 },
      {
        field: 'valor',
        headerName: 'Valor (R$)',
        type: 'text',
        width: 140,
        valueGetter: (row) => fmtBRL(Number(row.valor) || 0),
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
            onClick: (r: ReceitaItemDto & { fieldId: string }) => {
              const idx = fields.findIndex((f) => f.fieldId === r.fieldId);
              if (idx >= 0) setEditIdx(idx);
            },
          },
          {
            id: 'remover',
            label: 'Remover',
            icon: <Trash2 className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            destructive: true,
            onClick: (r: ReceitaItemDto & { fieldId: string }) => {
              const idx = fields.findIndex((f) => f.fieldId === r.fieldId);
              if (idx >= 0) remove(idx);
            },
          },
        ],
      },
    ],
    [fields, remove, produtoOptions],
  );

  return (
    <fieldset disabled={!editavel} className="rounded-radius-base border border-border p-pad-md">
      <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">
        Receita (ficha técnica)
      </legend>
      <div className="flex flex-col gap-gp-sm">
        <div>
          <Button
            label="Adicionar ingrediente"
            variant="soft"
            onClick={() => setEditIdx(-1)}
          />
        </div>

        {fields.length === 0 ? (
          <small className="text-fg-muted">Sem ingredientes.</small>
        ) : (
          <DataTable
            rows={fields as Array<ReceitaItemDto & { fieldId: string }>}
            columns={columns}
            getRowId={(r) => r.fieldId}
            toolbar={{ enableSearch: false, enableFilters: false }}
            paginationConfig={{ enabled: true, initialPageSize: 10 }}
            cardBreakpoint={false}
          />
        )}
      </div>

      {editIdx != null && (
        <ReceitaModal
          inicial={editIdx >= 0 ? (fields[editIdx] as ReceitaItemDto) : undefined}
          produtoOptions={produtoOptions}
          onFechar={() => setEditIdx(null)}
          onConfirmar={onConfirmar}
        />
      )}
    </fieldset>
  );
}

// ───────────────────────── Fator de conversão de unidades ─────────────────────────

/**
 * Detalhe 1:N de FATOR DE CONVERSÃO (tabFatorConversao) — GRID + adicionar/editar/remover via
 * `useFieldArray('fatoresConversao')`. Espelha o padrão dos códigos auxiliares. Leitura por linha:
 * "1 <PARA=unidade do produto> contém <FATOR> <DE>". PARA é a unidade do produto (read-only, mostrada
 * na coluna) — derivada no servidor no save. O usuário informa só DE (unidade convertida) e FATOR.
 * A unicidade (DE,PARA) é validada no back (envelope PT via CadMaster/useMensagem); as guardas DE≠unidade
 * e FATOR>0 são de ENTRADA no modal (fiéis a edtUnDeExit/btnSaveFatorConv).
 */
function FatorConversaoSection({
  form,
  editavel,
  unidadeSiglaOptions,
}: {
  form: UseFormReturn<CriarProdutoDto>;
  editavel: boolean;
  unidadeSiglaOptions: Opcao[];
}) {
  const { fields, append, update, remove } = useFieldArray<
    CriarProdutoDto,
    'fatoresConversao',
    'fieldId'
  >({ control: form.control, name: 'fatoresConversao', keyName: 'fieldId' });
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const unidadeProduto = (form.watch('unidade') ?? '').trim().toUpperCase();

  const onConfirmar = (item: FatorConversaoItemDto) => {
    if (editIdx == null) return;
    if (editIdx < 0) append(item);
    else update(editIdx, item);
    setEditIdx(null);
  };

  const columns = useMemo<DataTableColumnDef<FatorConversaoItemDto & { fieldId: string }>[]>(
    () => [
      {
        field: 'para',
        headerName: 'Un. produto',
        type: 'text',
        width: 130,
        isPrimary: true,
        // PARA = unidade ATUAL do produto (o servidor re-deriva no save); a unidade viva ganha do `para` gravado.
        valueGetter: (row) => unidadeProduto || row.para || '—',
      },
      { field: 'fator', headerName: 'Fator (contém)', type: 'number', width: 160 },
      { field: 'de', headerName: 'Un. convertida', type: 'text', width: 150 },
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
            onClick: (r: FatorConversaoItemDto & { fieldId: string }) => {
              const idx = fields.findIndex((f) => f.fieldId === r.fieldId);
              if (idx >= 0) setEditIdx(idx);
            },
          },
          {
            id: 'remover',
            label: 'Remover',
            icon: <Trash2 className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            destructive: true,
            onClick: (r: FatorConversaoItemDto & { fieldId: string }) => {
              const idx = fields.findIndex((f) => f.fieldId === r.fieldId);
              if (idx >= 0) remove(idx);
            },
          },
        ],
      },
    ],
    [fields, remove, unidadeProduto],
  );

  return (
    <fieldset disabled={!editavel} className="rounded-radius-base border border-border p-pad-md">
      <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">
        Fator de conversão de unidades
      </legend>
      <div className="flex flex-col gap-gp-sm">
        <div>
          <Button
            label="Adicionar &conversão"
            variant="soft"
            disabled={!unidadeProduto}
            onClick={() => setEditIdx(-1)}
          />
          {!unidadeProduto && (
            <small className="ml-gp-sm text-fg-muted">Informe a unidade do produto primeiro.</small>
          )}
        </div>

        {fields.length === 0 ? (
          <small className="text-fg-muted">Sem fatores de conversão.</small>
        ) : (
          <DataTable
            rows={fields as Array<FatorConversaoItemDto & { fieldId: string }>}
            columns={columns}
            getRowId={(r) => r.fieldId}
            toolbar={{ enableSearch: false, enableFilters: false }}
            paginationConfig={{ enabled: true, initialPageSize: 10 }}
            cardBreakpoint={false}
          />
        )}
      </div>

      {editIdx != null && (
        <FatorConversaoModal
          inicial={editIdx >= 0 ? (fields[editIdx] as FatorConversaoItemDto) : undefined}
          unidadeProduto={unidadeProduto}
          unidadeOptions={unidadeSiglaOptions}
          // DEs já usados (exceto a linha em edição) → o modal barra o duplicado no add-time (fiel ao
          // "Registro já existe com essas configurações!"), antes do 422 do servidor no save do agregado.
          desUsados={fields
            .filter((_, i) => i !== editIdx)
            .map((f) => (f.de ?? '').trim().toUpperCase())}
          onFechar={() => setEditIdx(null)}
          onConfirmar={onConfirmar}
        />
      )}
    </fieldset>
  );
}

// ───────────────────────── Produtos filhos (variação pai/filho) ─────────────────────────

/**
 * Aba "Produtos Filhos" (TsFilhos do UCadProduto) — sub-corte (a): VÍNCULO pai/filho + grid READ-ONLY das
 * variações filhas. O "Produto Pai" (idproduto_pai) e o "Fator do filho" (fator_filho) são colunas do master;
 * o grid lista os produtos cujo idproduto_pai = este produto (QryProdutosFilhos), buscado por HTTP.
 * ADIADO (sub-corte b, com procedência): motor de propagação de preço (DIF_PRECO/TPDIF + AtualizaPrecoFilho
 * sobre multi_preco/historico_dinamico — golden vazio p/ a config de propagação), copy-on-link (PreencheDadosPai)
 * e lock de campos (DesabilitaControlesProdutoFilho). Regra pai≠filho é validada no servidor.
 */
function ProdutosFilhosSection({
  form,
  editavel,
  produtoOptions,
}: {
  form: UseFormReturn<CriarProdutoDto>;
  editavel: boolean;
  produtoOptions: Opcao[];
}) {
  const idproduto = Number(form.watch('idproduto' as never)) || undefined;
  const [filhos, setFilhos] = useState<ProdutoFilho[]>([]);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (idproduto == null) {
      setFilhos([]);
      return;
    }
    let vivo = true;
    setCarregando(true);
    getProdutosFilhos(idproduto)
      .then((r) => vivo && setFilhos(r))
      .catch(() => vivo && setFilhos([]))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [idproduto]);

  // O pai não pode ser o próprio produto (validado no servidor) — filtra o self do picker.
  const paiOptions = useMemo(
    () => produtoOptions.filter((o) => o.value !== String(idproduto ?? '')),
    [produtoOptions, idproduto],
  );

  const columns = useMemo<DataTableColumnDef<ProdutoFilho & { _id: number }>[]>(
    () => [
      { field: 'idproduto', headerName: 'Código', type: 'text', width: 100, isPrimary: true },
      { field: 'codbarra', headerName: 'Cód. barras', type: 'text', width: 150 },
      { field: 'descricao', headerName: 'Descrição', type: 'text', width: 280 },
      { field: 'unidade', headerName: 'Un.', type: 'text', width: 80 },
      { field: 'fator_filho', headerName: 'Fator', type: 'text', width: 110, valueGetter: (r) => (r.fator_filho != null ? String(r.fator_filho) : '') },
      { field: 'ativo', headerName: 'Ativo', type: 'text', width: 80 },
    ],
    [],
  );
  const rows = useMemo(() => filhos.map((f, i) => ({ ...f, _id: i })), [filhos]);

  return (
    <fieldset disabled={!editavel} className="rounded-radius-base border border-border p-pad-md">
      <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">
        Produtos filhos (variação pai/filho)
      </legend>
      <div className="flex flex-col gap-gp-md">
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          <Controller
            control={form.control}
            name="idproduto_pai"
            render={({ field }) => (
              <SelectField
                label="Produto pai"
                options={paiOptions}
                value={field.value != null ? String(field.value) : undefined}
                onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                placeholder="Selecione o produto pai…"
              />
            )}
          />
          <Controller
            control={form.control}
            name="fator_filho"
            render={({ field }) => (
              <NumberField
                label="&Fator do filho"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={4}
                min={0}
                disabled={!editavel}
                error={form.formState.errors.fator_filho?.message as string | undefined}
              />
            )}
          />
        </div>

        {/* Grid read-only das variações filhas (QryProdutosFilhos). Só p/ produto gravado. */}
        {idproduto == null ? (
          <small className="text-fg-muted">Grave o produto para ver as variações filhas.</small>
        ) : carregando ? (
          <small className="text-fg-muted">Carregando…</small>
        ) : rows.length === 0 ? (
          <small className="text-fg-muted">Este produto não tem filhos.</small>
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            getRowId={(r) => r._id}
            toolbar={{ enableSearch: false, enableFilters: false }}
            paginationConfig={{ enabled: true, initialPageSize: 10 }}
            cardBreakpoint={false}
          />
        )}
      </div>
    </fieldset>
  );
}

// ───────────────────────── Posição de estoque (UPosicaoProduto) ─────────────────────────

/**
 * Consulta READ-ONLY da posição de estoque (UPosicaoProduto): SALDO por empresa (total consolidado) +
 * FICHA DE MOVIMENTAÇÃO (Kardex — `historico_prod`, que os movers NF/ajuste/inventário já gravam), com o
 * saldo corrente (anterior→novo) por linha. Só p/ produto gravado. Não edita — o saldo é movido por transação.
 */
const fmtQtde = (n: number | string | null | undefined) =>
  Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fmtDataHora = (iso: string | null) => {
  if (!iso) return '';
  const [d, h] = iso.split('T');
  const [y, m, dia] = (d ?? '').split('-');
  return dia && m && y ? `${dia}/${m}/${y}${h ? ' ' + h.slice(0, 5) : ''}` : iso;
};

function PosicaoEstoqueSection({ form }: { form: UseFormReturn<CriarProdutoDto> }) {
  const idproduto = Number(form.watch('idproduto' as never)) || undefined;
  const [saldos, setSaldos] = useState<EstoqueSaldo[]>([]);
  const [total, setTotal] = useState(0);
  const [movs, setMovs] = useState<EstoqueMovimento[]>([]);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (idproduto == null) {
      setSaldos([]);
      setMovs([]);
      setTotal(0);
      return;
    }
    let vivo = true;
    setCarregando(true);
    getPosicaoEstoque(idproduto)
      .then((r) => {
        if (!vivo) return;
        setSaldos(r.saldos);
        setTotal(r.total);
        setMovs(r.movimentos);
      })
      .catch(() => {
        if (!vivo) return;
        setSaldos([]);
        setMovs([]);
        setTotal(0);
      })
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [idproduto]);

  const colsSaldo = useMemo<DataTableColumnDef<EstoqueSaldo & { _id: number }>[]>(
    () => [
      { field: 'idempresa', headerName: 'Empresa', type: 'text', width: 110, isPrimary: true },
      { field: 'qtde', headerName: 'Saldo', type: 'text', width: 130, valueGetter: (r) => fmtQtde(r.qtde) },
      { field: 'minimo', headerName: 'Mínimo', type: 'text', width: 120, valueGetter: (r) => fmtQtde(r.minimo) },
      { field: 'maximo', headerName: 'Máximo', type: 'text', width: 120, valueGetter: (r) => fmtQtde(r.maximo) },
      { field: 'local', headerName: 'Local', type: 'text', width: 160 },
    ],
    [],
  );
  const colsMov = useMemo<DataTableColumnDef<EstoqueMovimento & { _id: string }>[]>(
    () => [
      { field: 'data', headerName: 'Data', type: 'text', width: 150, isPrimary: true, valueGetter: (r) => fmtDataHora(r.data) },
      // Empresa explícita: o Kardex consolida as empresas do tenant e o saldo corrente é POR empresa — sem a
      // coluna, o "saldo ant.→novo" pareceria não-monotônico ao intercalar lojas (fold auditoria MÉDIA).
      { field: 'idempresa', headerName: 'Empresa', type: 'text', width: 90 },
      { field: 'tipo', headerName: 'E/S', type: 'text', width: 70 },
      { field: 'origem', headerName: 'Origem', type: 'text', width: 110 },
      { field: 'codnf', headerName: 'Doc.', type: 'text', width: 90, valueGetter: (r) => (r.codnf != null ? String(r.codnf) : '') },
      { field: 'qtde', headerName: 'Qtde', type: 'text', width: 120, valueGetter: (r) => fmtQtde(r.qtde) },
      { field: 'saldo_anterior', headerName: 'Saldo ant.', type: 'text', width: 120, valueGetter: (r) => fmtQtde(r.saldo_anterior) },
      { field: 'saldo_novo', headerName: 'Saldo novo', type: 'text', width: 120, valueGetter: (r) => fmtQtde(r.saldo_novo) },
      { field: 'historico', headerName: 'Histórico', type: 'text', width: 240 },
    ],
    [],
  );
  const rowsSaldo = useMemo(() => saldos.map((s, i) => ({ ...s, _id: i })), [saldos]);
  const rowsMov = useMemo(() => movs.map((m) => ({ ...m, _id: String(m.codmov) })), [movs]);

  return (
    <fieldset className="rounded-radius-base border border-border p-pad-md">
      <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">Posição de estoque</legend>
      {idproduto == null ? (
        <small className="text-fg-muted">Grave o produto para ver a posição de estoque.</small>
      ) : carregando ? (
        <small className="text-fg-muted">Carregando…</small>
      ) : (
        <div className="flex flex-col gap-gp-md">
          <div className="flex items-baseline gap-gp-sm">
            <span className="text-body-sm text-fg-muted">Saldo total (todas as empresas):</span>
            <span className="text-body-md font-semibold tabular-nums">{fmtQtde(total)}</span>
          </div>
          {rowsSaldo.length > 0 && (
            <DataTable
              rows={rowsSaldo}
              columns={colsSaldo}
              getRowId={(r) => r._id}
              toolbar={{ enableSearch: false, enableFilters: false }}
              paginationConfig={{ enabled: false }}
              cardBreakpoint={false}
            />
          )}
          <div>
            <div className="mb-gp-xs text-body-sm font-semibold text-fg-default">Ficha de movimentação</div>
            {rowsMov.length === 0 ? (
              <small className="text-fg-muted">Sem movimentações registradas.</small>
            ) : (
              <>
                <DataTable
                  rows={rowsMov}
                  columns={colsMov}
                  getRowId={(r) => r._id}
                  toolbar={{ enableSearch: false, enableFilters: false }}
                  paginationConfig={{ enabled: true, initialPageSize: 15 }}
                  cardBreakpoint={false}
                />
                {rowsMov.length >= 500 && (
                  <small className="text-fg-muted">Mostrando os 500 movimentos mais recentes.</small>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
}

// ───────────────────────── Informação nutricional (F4b) ─────────────────────────

/**
 * NUTRICIONAL (F4b) — campos-mestre de ROTULAGEM, INLINE na MESMA form (não é detalhe 1:N).
 * ARMAZENAMENTO PURO: a tela só guarda os valores; NÃO calcula (no legado o único enforcement
 * é o formato de gordura-trans, já no schema). Os **VD%** são DIGITADOS (não computados), por
 * isso cada macro vem com seu par valor + VD% lado a lado. Campos são `Controller`/NumberField
 * direto no MASTER (`form`), espelhando FiscalSection/EstoqueSection (grid 2-col, tokens do DS).
 *
 * Layout: Porção (unporcao/qtde_porcao/desc_porcao) → macros (valor + VD%) → rotulagem (flags S/N).
 */
function NutricionalSection({
  form,
  editavel,
}: {
  form: UseFormReturn<CriarProdutoDto>;
  editavel: boolean;
}) {
  const err = form.formState.errors;
  return (
    <fieldset disabled={!editavel} className="rounded-radius-md border border-border p-pad-md">
      <legend className="px-pad-xs text-fg-muted">Informação nutricional</legend>
      <div className="flex flex-col gap-form-gap">
        {/* ── Porção (unidades/qtde + medida caseira) ── */}
        <fieldset className="rounded-radius-base border border-border p-pad-sm">
          <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">Porção</legend>
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
            <Controller
              control={form.control}
              name="unporcao"
              render={({ field }) => (
                <NumberField
                  label="&Unidades por porção"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={0}
                  min={0}
                  error={err.unporcao?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="qtde_porcao"
              render={({ field }) => (
                <NumberField
                  label="&Qtde da porção"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={2}
                  min={0}
                  error={err.qtde_porcao?.message as string | undefined}
                />
              )}
            />
            <div className="sm:col-span-2">
              <Field
                label="&Medida caseira"
                maxLength={35}
                error={err.desc_porcao?.message as string | undefined}
                {...form.register('desc_porcao')}
              />
            </div>
          </div>
        </fieldset>

        {/* ── Macros: cada linha = valor + VD% (ambos NumberField 2 dec; VD% com addon "%") ── */}
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          <Controller
            control={form.control}
            name="valorenergetico"
            render={({ field }) => (
              <NumberField
                label="Valor energético"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={2}
                min={0}
                error={err.valorenergetico?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="vd_valorenergetico"
            render={({ field }) => (
              <NumberField
                label="VD% valor &energético"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={2}
                min={0}
                endAddon="%"
                error={err.vd_valorenergetico?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="carboidrato"
            render={({ field }) => (
              <NumberField
                label="&Carboidrato"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={2}
                min={0}
                error={err.carboidrato?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="vd_carboidrato"
            render={({ field }) => (
              <NumberField
                label="VD% carboi&drato"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={2}
                min={0}
                endAddon="%"
                error={err.vd_carboidrato?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="proteina"
            render={({ field }) => (
              <NumberField
                label="Proteína"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={2}
                min={0}
                error={err.proteina?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="vd_proteina"
            render={({ field }) => (
              <NumberField
                label="VD% prot&eína"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={2}
                min={0}
                endAddon="%"
                error={err.vd_proteina?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="gorduratotal"
            render={({ field }) => (
              <NumberField
                label="&Gordura total"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={2}
                min={0}
                error={err.gorduratotal?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="vd_gorduratotal"
            render={({ field }) => (
              <NumberField
                label="VD% gordura &total"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={2}
                min={0}
                endAddon="%"
                error={err.vd_gorduratotal?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="gordurasaturada"
            render={({ field }) => (
              <NumberField
                label="Gordura &saturada"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={2}
                min={0}
                error={err.gordurasaturada?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="vd_gordurasaturada"
            render={({ field }) => (
              <NumberField
                label="VD% gordura sat&urada"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={2}
                min={0}
                endAddon="%"
                error={err.vd_gordurasaturada?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="gorduratrans"
            render={({ field }) => (
              <NumberField
                label="Gordura t&rans"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={2}
                min={0}
                error={err.gorduratrans?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="vd_gorduratrans"
            render={({ field }) => (
              <NumberField
                label="VD% gordura tra&ns"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={2}
                min={0}
                endAddon="%"
                error={err.vd_gorduratrans?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="fibra"
            render={({ field }) => (
              <NumberField
                label="Fibra alimentar"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={2}
                min={0}
                error={err.fibra?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="vd_fibra"
            render={({ field }) => (
              <NumberField
                label="VD% fibra"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={2}
                min={0}
                endAddon="%"
                error={err.vd_fibra?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="sodio"
            render={({ field }) => (
              <NumberField
                label="Sódio"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={2}
                min={0}
                error={err.sodio?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="vd_sodio"
            render={({ field }) => (
              <NumberField
                label="VD% &sódio"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={2}
                min={0}
                endAddon="%"
                error={err.vd_sodio?.message as string | undefined}
              />
            )}
          />
          {/* açúcares — sem par VD% no modelo (não há vd_acucares_*) */}
          <Controller
            control={form.control}
            name="acucares_totais"
            render={({ field }) => (
              <NumberField
                label="Açúcares totai&s"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={2}
                min={0}
                error={err.acucares_totais?.message as string | undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="acucares_adicionados"
            render={({ field }) => (
              <NumberField
                label="&Açúcares adicionados"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={2}
                min={0}
                error={err.acucares_adicionados?.message as string | undefined}
              />
            )}
          />
          {/* código da informação nutricional (referência externa de rótulo) */}
          <Controller
            control={form.control}
            name="codinfanutri"
            render={({ field }) => (
              <NumberField
                label="Cód. info nutricio&nal"
                value={field.value as number | undefined}
                onChange={field.onChange}
                decimais={0}
                min={0}
                error={err.codinfanutri?.message as string | undefined}
              />
            )}
          />
        </div>

        {/* ── Rotulagem (flags S/N) ── */}
        <div className="flex flex-wrap items-center gap-gp-lg">
          <Controller
            control={form.control}
            name="acucar_adcionado"
            render={({ field }) => (
              <CheckboxField
                label="Contém açúcar adicio&nado"
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={form.control}
            name="gordura_saturada"
            render={({ field }) => (
              <CheckboxField
                label="Alto em gordura satura&da"
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={form.control}
            name="altoem_sodio"
            render={({ field }) => (
              <CheckboxField
                label="Alto em sódi&o"
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={form.control}
            name="expdadosnutricionais"
            render={({ field }) => (
              <CheckboxField
                label="E&xportar dados nutricionais"
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </div>
      </div>
    </fieldset>
  );
}

// ───────────────────────── Logística / embalagem (F4b) ─────────────────────────

/**
 * LOGÍSTICA / EMBALAGEM (F4b) — campos-mestre de ARMAZENAMENTO PURO, INLINE na MESMA form.
 * NÃO calcula nada: guarda dimensões/pesos do Produto/Caixa/Pallet e os parâmetros de
 * paletização. Campos são `Controller`/NumberField direto no MASTER (`form`), espelhando
 * FiscalSection (grid 2-col, tokens do DS).
 *
 * Layout: sub-grid de DIMENSÕES (Comprimento/Largura/Altura × Produto/Caixa/Pallet) →
 * PESOS (Peso líq./Peso bruto × Produto/Caixa/Pallet) → PALETIZAÇÃO (inteiros) + fator caixa.
 */
/**
 * Aba "Outros" (tshOutros do UCadProduto) — 14 flags S/N de comportamento do produto (consumidos por PDV/site/
 * cotação/balança). Armazenamento puro na master (todas da mig 113 — `servico` é produto-nível, distinto de
 * receita_prod.servico da mig 023; snFlag tolera o '0' sujo do golden). ADIADO: FCP_SAIDA/DESC_FCP (lookup FCP
 * inexistente; CODFCP já vive na aba Fiscal), Tara (lookup de balança inexistente), IPPT (sem coluna no golden).
 */
// Rótulos fiéis ao tshOutros do UCadProduto (acceleradores Delphi `&` removidos — sem convenção web).
const OUTROS_FLAGS: { name: keyof CriarProdutoDto; label: string }[] = [
  { name: 'servico', label: 'Item de serviço' },
  { name: 'atacado', label: 'Atacado' },
  { name: 'realizatroca', label: 'Troca' },
  { name: 'retirapromo', label: 'Ignorar na promoção' },
  { name: 'imobilizado', label: 'Imobilizado' },
  { name: 'vende_site', label: 'Vende no site' },
  { name: 'altera_descricao_cotacao', label: 'Altera descrição na cotação' },
  { name: 'servicoatende', label: 'Serviço Integração Atende' },
  { name: 'item_cozinha', label: 'Item produzido na cozinha' },
  { name: 'impressora_terminal', label: 'Imprime próximo do terminal' },
  { name: 'exibesicomanda', label: 'Exibe no SICOMANDA' },
  { name: 'prod_sem_gtin', label: 'Não possui GTIN' },
  { name: 'vasilhame', label: 'Vasilhame' },
  { name: 'cotacao', label: 'Cotação' },
  // o que o binário novo acrescentou (corte P1 do produto, 25/09/2026) — gravado no "Inseriu" de todo produto novo
  { name: 'visivel_rel', label: 'Visível no relatório de vendas' },
  { name: 'imprimircomp', label: 'Imprime composição' },
  { name: 'gerar_m220_m620', label: 'Gera M220/M620 (SPED Contribuições)' },
  { name: 'nao_atu_produtos_entrada', label: 'Não atualiza o produto na entrada de NF' },
  { name: 'imprime_voucher', label: 'Imprime voucher' },
  { name: 'produto_voucher', label: 'Produto voucher' },
  { name: 'saida_expedicao', label: 'Saída pela expedição' },
  { name: 'gluten', label: 'Contém glúten' },
  { name: 'produto_notavel', label: 'Produto notável' },
  { name: 'produto_ancora', label: 'Produto âncora' },
  { name: 'decomposicao_livre', label: 'Decomposição livre' },
  { name: 'nao_decompor_saida', label: 'Não decompor na saída' },
  { name: 'decomposicao_un', label: 'Decomposição por unidade' },
];

// SPED 0200 — TIPO_ITEM (tabela do leiaute)
const TIPOS_ITEM = [
  ['0', 'Mercadoria para revenda'], ['1', 'Matéria-prima'], ['2', 'Embalagem'], ['3', 'Produto em processo'], ['4', 'Produto acabado'],
  ['5', 'Subproduto'], ['6', 'Produto intermediário'], ['7', 'Material de uso e consumo'], ['8', 'Ativo imobilizado'], ['9', 'Serviços'],
  ['10', 'Outros insumos'], ['99', 'Outras'],
].map(([v, l]) => ({ value: v, label: `${v.padStart(2, '0')} - ${l}` }));
// o combo cmbTIPOPIS (os três primeiros com legenda no .dfm) + os códigos que a produção tem sem legenda
const TIPOS_PIS = [
  { value: 'N', label: 'N - Cumulativo (Lei 10.833/2003) — 3,65%' }, { value: 'A', label: 'A - Isento "retido" (Lei 10.147/2001)' },
  { value: 'I', label: 'I - Alíquota zero (Lei 10.925/2004)' }, ...['S', 'z', 'Z', '3', 'C'].map((v) => ({ value: v, label: v })),
];
const PARTES_DEC = ['0', '1/4', '1/3', '1/2', '2/3', '3/4'].map((l, i) => ({ value: String(i), label: `[${i}] ${l}` }));
const MEDIDAS_USADAS = [
  [0, 'Colher(es) de sopa'], [5, 'Unidade(s)'], [6, 'Pacote(s)'], [7, 'Fatia(s)'], [8, 'Fatia(s) fina(s)'], [10, 'Folha(s)'], [12, 'Biscoito(s)'],
  [13, 'Bisnaguinha(s)'], [14, 'Disco(s)'], [15, 'Copo(s)'], [17, 'Tablete(s)'], [20, 'Bife(s)'], [22, 'Concha(s)'], [23, 'Bala(s)'],
  [24, 'Prato(s) fundo(s)'], [25, 'Pitada(s)'], [26, 'Lata(s)'],
].map(([v, l]) => ({ value: String(v), label: `[${String(v).padStart(2, '0')}] ${l}` }));

/** os campos do legado que não cabiam nas outras abas: SPED, PIS, validade, comissão, o desconto do preço 2 e as medidas */
function ComplementosSection({ form, editavel }: { form: UseFormReturn<CriarProdutoDto>; editavel: boolean }) {
  const num = (name: keyof CriarProdutoDto, label: string, decimais = 0) => (
    <Controller control={form.control} name={name} render={({ field }) => (
      <NumberField label={label} value={field.value != null && field.value !== '' ? Number(field.value) : undefined} onChange={field.onChange} decimais={decimais} min={0} disabled={!editavel} />
    )} />
  );
  const sel = (name: keyof CriarProdutoDto, label: string, options: Array<{ value: string; label: string }>, numero = false) => (
    <Controller control={form.control} name={name} render={({ field }) => (
      <SelectField label={label} options={options} value={field.value != null && field.value !== '' ? String(field.value) : undefined}
        onChange={(v) => field.onChange(v === '' || v == null ? undefined : numero ? Number(v) : v)} placeholder="Selecione…" disabled={!editavel} />
    )} />
  );
  return (
    <fieldset disabled={!editavel} className="rounded-radius-md border border-border p-pad-md">
      <legend className="px-pad-xs text-fg-muted">Complementos</legend>
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
        {sel('tipo_item', 'Tipo do item (SPED)', TIPOS_ITEM, true)}
        <Controller control={form.control} name="pis" render={({ field }) => (
          <CheckboxField label="Pis / Cofins" value={(field.value as string | undefined) ?? 'N'} onChange={field.onChange} disabled={!editavel} />
        )} />
        {sel('tipopis', 'Tipo de PIS', TIPOS_PIS)}
        {num('dias_validade_minimo', 'Mínimo de dias de validade')}
        {num('fator_pedidocompra', 'Fator no pedido de compra', 3)}
        {sel('receitaunidade', 'Unidade da receita', [{ value: 'KG', label: 'KG' }, { value: 'UN', label: 'UN' }])}
        {num('descmax', 'Desconto máximo', 2)}
        {num('comissao', 'Comissão (%)', 2)}
        {num('taraembalagem', 'Tara da embalagem', 2)}
        {num('apresentacao_etiqueta', 'Apresentação na etiqueta')}
        {num('conteudo_embalagem', 'Conteúdo da embalagem', 4)}
        {/* "% Perdas" (edtPERCENTUAL_PERDAS): só o produto em KG edita (UCadProduto.pas:2442-2445); entre 0 e 100 (:5928-5945).
            É a perda do corte na entrada decomposta rateada (100 = item de perda total) */}
        <Controller control={form.control} name="percentual_perdas" render={({ field }) => (
          <NumberField label="% Perdas" value={field.value != null ? Number(field.value) : undefined} onChange={field.onChange}
            decimais={3} min={0} max={100} disabled={!editavel || String(form.watch('unidade') ?? '').toUpperCase() !== 'KG'} />
        )} />
        {sel('unidade_apresentacao', 'Unidade de apresentação', [{ value: 'KG', label: 'KG' }, { value: 'LT', label: 'LT' }, { value: 'UN', label: 'UN' }])}
        {sel('tpdescpreco2', 'Desconto do preço 2 — tipo', [{ value: 'P', label: 'P' }, { value: 'F', label: 'F' }, { value: 'D', label: 'D' }])}
        {num('vrdescpreco2', 'Desconto do preço 2 — valor', 2)}
        <div />
        <Controller control={form.control} name="preco2dtini" render={({ field }) => (
          <DateField label="Preço 2 — início" value={field.value ? String(field.value).slice(0, 10) : undefined} onChange={field.onChange} disabled={!editavel} />
        )} />
        <Controller control={form.control} name="preco2dtfim" render={({ field }) => (
          <DateField label="Preço 2 — fim" value={field.value ? String(field.value).slice(0, 10) : undefined} onChange={field.onChange} disabled={!editavel} />
        )} />
        <div />
        {num('inteiramedida', 'Medida caseira — parte inteira')}
        {sel('partedec', 'Medida caseira — fração', PARTES_DEC, true)}
        {sel('usadamedida', 'Medida caseira — medida usada', MEDIDAS_USADAS, true)}
        <div className="sm:col-span-3">
          <TextArea label="Especificação" disabled={!editavel} {...form.register('especificacao')} />
        </div>
      </div>
    </fieldset>
  );
}
function OutrosSection({ form, editavel }: { form: UseFormReturn<CriarProdutoDto>; editavel: boolean }) {
  return (
    <fieldset disabled={!editavel} className="rounded-radius-md border border-border p-pad-md">
      <legend className="px-pad-xs text-fg-muted">Outros</legend>
      <div className="flex flex-wrap items-center gap-gp-lg">
        {OUTROS_FLAGS.map((f) => (
          <Controller
            key={f.name}
            control={form.control}
            name={f.name}
            render={({ field }) => (
              <CheckboxField label={f.label} value={(field.value as string | undefined) ?? 'N'} onChange={field.onChange} disabled={!editavel} />
            )}
          />
        ))}
      </div>
    </fieldset>
  );
}

function LogisticaSection({
  form,
  editavel,
}: {
  form: UseFormReturn<CriarProdutoDto>;
  editavel: boolean;
}) {
  const err = form.formState.errors;
  return (
    <fieldset disabled={!editavel} className="rounded-radius-md border border-border p-pad-md">
      <legend className="px-pad-xs text-fg-muted">Logística / embalagem</legend>
      <div className="flex flex-col gap-form-gap">
        {/* ── Dimensões: 3 linhas (Comprimento/Largura/Altura) × 3 colunas (Produto/Caixa/Pallet) ── */}
        <fieldset className="rounded-radius-base border border-border p-pad-sm">
          <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">
            Dimensões (Produto / Caixa / Pallet)
          </legend>
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
            <Controller
              control={form.control}
              name="comprimento_produto"
              render={({ field }) => (
                <NumberField
                  label="&Comprimento (produto)"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={2}
                  min={0}
                  error={err.comprimento_produto?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="comprimento_caixa"
              render={({ field }) => (
                <NumberField
                  label="Comprimento (caixa)"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={2}
                  min={0}
                  error={err.comprimento_caixa?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="comprimento_pallet"
              render={({ field }) => (
                <NumberField
                  label="Comprimento (pallet)"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={2}
                  min={0}
                  error={err.comprimento_pallet?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="largura_produto"
              render={({ field }) => (
                <NumberField
                  label="&Largura (produto)"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={2}
                  min={0}
                  error={err.largura_produto?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="largura_caixa"
              render={({ field }) => (
                <NumberField
                  label="Largura (caixa)"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={2}
                  min={0}
                  error={err.largura_caixa?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="largura_pallet"
              render={({ field }) => (
                <NumberField
                  label="Largura (pallet)"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={2}
                  min={0}
                  error={err.largura_pallet?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="altura_produto"
              render={({ field }) => (
                <NumberField
                  label="&Altura (produto)"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={2}
                  min={0}
                  error={err.altura_produto?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="altura_caixa"
              render={({ field }) => (
                <NumberField
                  label="Altura (caixa)"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={2}
                  min={0}
                  error={err.altura_caixa?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="altura_pallet"
              render={({ field }) => (
                <NumberField
                  label="Altura (pallet)"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={2}
                  min={0}
                  error={err.altura_pallet?.message as string | undefined}
                />
              )}
            />
          </div>
        </fieldset>

        {/* ── Pesos: 2 linhas (Peso líq./Peso bruto) × 3 colunas (Produto/Caixa/Pallet) ── */}
        <fieldset className="rounded-radius-base border border-border p-pad-sm">
          <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">
            Pesos (Produto / Caixa / Pallet)
          </legend>
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
            <Controller
              control={form.control}
              name="pesoliq_produto"
              render={({ field }) => (
                <NumberField
                  label="Peso líq. (produto)"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={3}
                  min={0}
                  error={err.pesoliq_produto?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="pesoliq_caixa"
              render={({ field }) => (
                <NumberField
                  label="Peso líq. (caixa)"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={3}
                  min={0}
                  error={err.pesoliq_caixa?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="pesoliq_pallet"
              render={({ field }) => (
                <NumberField
                  label="Peso líq. (pallet)"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={3}
                  min={0}
                  error={err.pesoliq_pallet?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="pesobruto_produto"
              render={({ field }) => (
                <NumberField
                  label="Peso &bruto (produto)"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={3}
                  min={0}
                  error={err.pesobruto_produto?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="pesobruto_caixa"
              render={({ field }) => (
                <NumberField
                  label="Peso bruto (caixa)"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={3}
                  min={0}
                  error={err.pesobruto_caixa?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="pesobruto_pallet"
              render={({ field }) => (
                <NumberField
                  label="Peso bruto (pallet)"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={3}
                  min={0}
                  error={err.pesobruto_pallet?.message as string | undefined}
                />
              )}
            />
          </div>
        </fieldset>

        {/* ── Paletização (inteiros) + fator de caixa ── */}
        <fieldset className="rounded-radius-base border border-border p-pad-sm">
          <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">
            Paletização
          </legend>
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
            <Controller
              control={form.control}
              name="pallet_caixas_por_camada"
              render={({ field }) => (
                <NumberField
                  label="Caixas por camada"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={0}
                  min={0}
                  error={err.pallet_caixas_por_camada?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="pallet_camadas_por_pallet"
              render={({ field }) => (
                <NumberField
                  label="Camadas por pallet"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={0}
                  min={0}
                  error={err.pallet_camadas_por_pallet?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="pallet_caixas_por_pallet"
              render={({ field }) => (
                <NumberField
                  label="Caixas por pallet"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={0}
                  min={0}
                  error={err.pallet_caixas_por_pallet?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="pallet_empilhamento"
              render={({ field }) => (
                <NumberField
                  label="Empilhamento"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={0}
                  min={0}
                  error={err.pallet_empilhamento?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="pallet_produtos_por_caixa"
              render={({ field }) => (
                <NumberField
                  label="Produtos por caixa"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={0}
                  min={0}
                  error={err.pallet_produtos_por_caixa?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="pallet_produtos_por_pallet"
              render={({ field }) => (
                <NumberField
                  label="Produtos por pallet"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={0}
                  min={0}
                  error={err.pallet_produtos_por_pallet?.message as string | undefined}
                />
              )}
            />
            <Controller
              control={form.control}
              name="fatorcx_prod"
              render={({ field }) => (
                <NumberField
                  label="&Fator caixa/produto"
                  value={field.value as number | undefined}
                  onChange={field.onChange}
                  decimais={2}
                  min={0}
                  error={err.fatorcx_prod?.message as string | undefined}
                />
              )}
            />
          </div>
        </fieldset>
      </div>
    </fieldset>
  );
}
