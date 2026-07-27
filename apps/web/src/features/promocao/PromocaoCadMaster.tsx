import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { Trash2, X } from 'lucide-react';
import type { Promocao, PromocaoItemDto } from '@apollo/shared';
import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { NumberField } from '../../shared/ui/NumberField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { useMensagem } from '../../shared/mensagem';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { listarPromocoes, criarPromocao, removerPromocao } from './promocaoApi';

const n = (v: unknown) => Number(v) || 0;
const fmtMoeda = (v: unknown) => n(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (v: unknown) => `${n(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const fmtValorPorTipo = (v: unknown, tipo: unknown) => (String(tipo) === '%' ? fmtPct(v) : fmtMoeda(v));
const fmtDt = (v: unknown) => (v ? new Date(String(v)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

/**
 * MECÂNICA (PROMOCAO.TIPO) → aba do PageControl do legado (UCadPromocao.dfm: Tbs*). O seletor "Tipo" escolhe a
 * aba; cada aba tem os campos daquela mecânica. Prontas: Preço Fixo (c1), Desconto Fixo/Variável (c2), Código
 * Promocional (c3). As demais avisam "próximo corte" sem travar o cadastro do header.
 */
const TIPOS = [
  { value: 'C', label: 'Categoria' },
  { value: 'O', label: 'Combo' },
  { value: 'A', label: 'Atacarejo' },
  { value: 'B', label: 'Bonificação' },
  { value: 'F', label: 'Desconto Fixo' },
  { value: 'V', label: 'Desconto Variável' },
  { value: 'D', label: 'Desconto Adicional' },
  { value: 'P', label: 'Preço Fixo' },
  { value: 'G', label: 'Produto Grátis' },
  { value: 'L', label: 'Leve Pague' },
  { value: 'R', label: 'Código Promocional' },
];
const TIPO_LABEL: Record<string, string> = Object.fromEntries(TIPOS.map((t) => [t.value, t.label]));
/** Destino (público) — UCadPromocao "Destino". */
const DESTINOS = [
  { value: 'T', label: 'Todos' },
  { value: 'C', label: 'Clientes' },
  { value: 'U', label: 'Clube' },
  { value: 'F', label: 'Funcionários' },
  { value: 'P', label: 'Perfil' },
  { value: 'I', label: 'Izio' },
];

/** item TIPO $/% (Combo / — combobox 'Valor'/'Porcentagem'). */
const TIPO_ITEM_OPCOES = [
  { value: '$', label: 'Valor (R$)' },
  { value: '%', label: 'Porcentagem (%)' },
];
/** TIPOCOMBO do header (CmbTipoCombo): 'C' a cada / 'M' maior que. */
const TIPOCOMBO_OPCOES = [
  { value: 'C', label: 'A cada' },
  { value: 'M', label: 'Maior que' },
];
/** SUBTIPO da Categoria (CbbCategoria) → dimensão do alvo. O/D/G/S = família (FAMILIAS_PROD.tipo), P/F/M = produto/fornecedor/marca. */
const SUBTIPO_OPCOES = [
  { value: 'O', label: 'Seção' },
  { value: 'D', label: 'Departamento' },
  { value: 'G', label: 'Grupo' },
  { value: 'S', label: 'Subgrupo' },
  { value: 'P', label: 'Produto' },
  { value: 'F', label: 'Fornecedor' },
  { value: 'M', label: 'Marca' },
];
const SUBTIPO_LABEL: Record<string, string> = Object.fromEntries(SUBTIPO_OPCOES.map((s) => [s.value, s.label]));
const SUBTIPO_FAMILIA = new Set(['O', 'D', 'G', 'S']);

/**
 * UI de cada mecânica já implementada. `shape` decide o adder:
 *  - 'produto' (P/F/V): produto + VALOR (moeda ou %). rótulo com mnemônico em 'S' (De&sconto) p/ não colidir com &Descrição.
 *  - 'codigo' (R): SEM produto — Código + Vr. Desconto ($ ou % via checkbox) + Quantidade.
 *  - 'combo' (O): produto + Quantidade + Vr. Promoção + TIPO ($/%); o header carrega Valor/Tipo do combo.
 *  - 'levepague' (L): produto + Qtde. Leve + Qtde. Pague (SEM valor — desconto derivado de leve/pague).
 *  - 'categoria' (C): SUBTIPO (dimensão) + alvo (família/produto/fornecedor/marca por SUBTIPO) + Promoção (%).
 *  - 'atacarejo' (A): produto + Qtde. (tier) + Vr. Atacarejo + Cálculo ($/%); N tiers por produto (dedup produto+qtde).
 *  - 'bonificacao' (B): produto + Quantidade + Quantidade bonificada (SEM valor).
 *  - 'doisgrids' (G/D): 2 GRIDS pai+filho — Grupo A "leve" (origem=tipo) + Grupo B "ganhe" (origem=tipo+'F').
 *    Produto Grátis (G): ambos produto+qtde. Desconto Adicional (D): Grupo B tem % adicional (filhoValor).
 * Fora deste mapa: aviso "próximo corte".
 */
const MECANICA_UI: Record<string, { shape: 'produto' | 'codigo' | 'combo' | 'levepague' | 'categoria' | 'atacarejo' | 'bonificacao' | 'doisgrids'; rotulo?: string; unidade?: 'moeda' | 'percent'; grupoA?: string; grupoB?: string; filhoValor?: boolean }> = {
  P: { shape: 'produto', rotulo: 'Preço &Fixo', unidade: 'moeda' },
  F: { shape: 'produto', rotulo: 'De&sconto (R$)', unidade: 'moeda' },
  V: { shape: 'produto', rotulo: 'De&sconto (%)', unidade: 'percent' },
  R: { shape: 'codigo' },
  O: { shape: 'combo' },
  L: { shape: 'levepague' },
  C: { shape: 'categoria' },
  A: { shape: 'atacarejo' },
  B: { shape: 'bonificacao' },
  G: { shape: 'doisgrids', grupoA: 'Grupo A — leve', grupoB: 'Grupo B — ganhe grátis' },
  D: { shape: 'doisgrids', grupoA: 'Grupo A — leve', grupoB: 'Grupo B — desconto adicional', filhoValor: true },
};

export function PromocaoCadMaster() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<Promocao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // cabeçalho
  const [descricao, setDescricao] = useState('');
  const [tipo, setTipo] = useState<string>('P'); // aba ativa (default Preço Fixo)
  const [destino, setDestino] = useState<string | undefined>('T');
  const [empresas, setEmpresas] = useState('');
  const [dtini, setDtini] = useState('');
  const [dtfim, setDtfim] = useState('');
  const [itens, setItens] = useState<PromocaoItemDto[]>([]);

  // adder produto-alvo (P/F/V)
  const [idproduto, setIdproduto] = useState<number | undefined>(undefined);
  const [valorItem, setValorItem] = useState<number | undefined>(undefined);
  // adder Código Promocional (R)
  const [codigoR, setCodigoR] = useState('');
  const [valorR, setValorR] = useState<number | undefined>(undefined);
  const [percR, setPercR] = useState<'S' | 'N'>('N'); // checkbox '%' → tipo '%' quando 'S'
  const [qtdeR, setQtdeR] = useState<number | undefined>(undefined);
  // Combo (O): header VALORCOMBO/TIPOCOMBO + item produto/qtde/valor/tipo
  const [valorComboHdr, setValorComboHdr] = useState<number | undefined>(undefined);
  const [tipoComboHdr, setTipoComboHdr] = useState<string>('C');
  const [qtdeCombo, setQtdeCombo] = useState<number | undefined>(undefined);
  const [tipoItemCombo, setTipoItemCombo] = useState<string>('$');
  // Leve Pague (L): produto + qtde leve + qtde pague (sem valor)
  const [qtdeLeve, setQtdeLeve] = useState<number | undefined>(undefined);
  const [qtdePague, setQtdePague] = useState<number | undefined>(undefined);
  // Categoria (C): SUBTIPO (dimensão) + alvo (por SUBTIPO) + Promoção (%)
  const [subtipoCat, setSubtipoCat] = useState<string>('P');
  const [alvoCat, setAlvoCat] = useState<number | undefined>(undefined);
  const [valorCat, setValorCat] = useState<number | undefined>(undefined);
  // Atacarejo (A): produto + Qtde. (tier) + Vr. Atacarejo + Cálculo ($/%)
  const [qtdeAtac, setQtdeAtac] = useState<number | undefined>(undefined);
  const [tipoAtac, setTipoAtac] = useState<string>('$');
  // Bonificação (B): produto + Quantidade (compre) + Quantidade bonificada (ganhe)
  const [qtdeCompraB, setQtdeCompraB] = useState<number | undefined>(undefined);
  const [qtdeBonifB, setQtdeBonifB] = useState<number | undefined>(undefined);
  // 2 grids (G/D): Grupo A (leve) = produto + qtde; Grupo B (ganhe) = produto + qtde (+ % adicional no Desconto Adicional)
  const [idProdA, setIdProdA] = useState<number | undefined>(undefined);
  const [qtdeGA, setQtdeGA] = useState<number | undefined>(undefined);
  const [idProdB, setIdProdB] = useState<number | undefined>(undefined);
  const [qtdeGB, setQtdeGB] = useState<number | undefined>(undefined);
  const [valorGB, setValorGB] = useState<number | undefined>(undefined);

  const mec = MECANICA_UI[tipo]; // config da aba ativa (undefined = aba não-pronta)

  const { data: produtoOptions = [] } = useResourceOptions(
    'cadastro/produtos',
    (p: any) => ({ value: String(p.idproduto ?? p.codigo), label: `${p.idproduto ?? p.codigo} - ${p.descricao ?? ''}` }),
    { campo: 'ativo', operador: 'igual', valor: 'S' },
  );
  const rotuloProduto = useCallback(
    (id: unknown) => produtoOptions.find((o) => String(o.value) === String(id))?.label ?? String(id ?? ''),
    [produtoOptions],
  );
  // recursos do alvo da Categoria (por SUBTIPO): famílias (O/D/G/S), fornecedores (F), marcas (M); produtos (P) reusa acima.
  const { data: familiaOptions = [] } = useResourceOptions('cadastro/familias', (f: any) => ({ value: String(f.codfamilia), label: `${f.codfamilia} - ${f.descricao ?? ''}`, tipo: String(f.tipo ?? '') }));
  const { data: fornecedorOptions = [] } = useResourceOptions('cadastro/parceiros', (p: any) => ({ value: String(p.codparceiro), label: `${p.codparceiro} - ${p.razao ?? p.fantasia ?? ''}` }), { campo: 'frn', operador: 'igual', valor: 'S' });
  // get_marcas expõe a PK ora como idmarca, ora como codigo (igual ao ProdutoCadMaster) → fallback obrigatório.
  const { data: marcaOptions = [] } = useResourceOptions('cadastro/marcas', (m: any) => ({ value: String(m.idmarca ?? m.codigo), label: `${m.idmarca ?? m.codigo} - ${m.descricao ?? ''}` }));
  // opções do alvo conforme o SUBTIPO ativo (O/D/G/S filtram famílias por tipo).
  const alvoOptions = useMemo(() => {
    if (SUBTIPO_FAMILIA.has(subtipoCat)) return (familiaOptions as any[]).filter((o) => o.tipo === subtipoCat);
    if (subtipoCat === 'P') return produtoOptions;
    if (subtipoCat === 'F') return fornecedorOptions;
    if (subtipoCat === 'M') return marcaOptions;
    return [];
  }, [subtipoCat, familiaOptions, produtoOptions, fornecedorOptions, marcaOptions]);
  const rotuloAlvo = useCallback(
    (subtipo: unknown, id: unknown) => {
      const st = String(subtipo ?? '');
      const src = SUBTIPO_FAMILIA.has(st) ? (familiaOptions as any[]) : st === 'P' ? produtoOptions : st === 'F' ? fornecedorOptions : st === 'M' ? marcaOptions : [];
      return (src as any[]).find((o) => String(o.value) === String(id))?.label ?? String(id ?? '');
    },
    [familiaOptions, produtoOptions, fornecedorOptions, marcaOptions],
  );

  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      setLista(await listarPromocoes({ orderBy: 'idpromocao', orderDir: 'desc' }));
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [mensagem]);
  useEffect(() => void recarregar(), [recarregar]);

  const limparAdder = () => {
    setIdproduto(undefined); setValorItem(undefined);
    setCodigoR(''); setValorR(undefined); setPercR('N'); setQtdeR(undefined);
    setQtdeCombo(undefined); setTipoItemCombo('$');
    setQtdeLeve(undefined); setQtdePague(undefined);
    setAlvoCat(undefined); setValorCat(undefined);
    setQtdeAtac(undefined); setTipoAtac('$');
    setQtdeCompraB(undefined); setQtdeBonifB(undefined);
    setIdProdA(undefined); setQtdeGA(undefined); setIdProdB(undefined); setQtdeGB(undefined); setValorGB(undefined);
  };

  // P/F/V: produto + valor
  const adicionarProduto = () => {
    if (!mec || mec.shape !== 'produto') return;
    if (idproduto == null) return mensagem.erro('Selecione o produto.');
    if (!(n(valorItem) > 0)) return mensagem.erro(mec.unidade === 'percent' ? 'Informe o desconto (%) (> 0).' : 'Informe o valor (> 0).');
    if (itens.some((it) => it.origem === tipo && Number(it.idorigempromocao) === idproduto))
      return mensagem.erro('Produto já está na lista.');
    // ORIGEM = a letra do TIPO (P/F/V). OPERACAO/TIPO são carimbados no servidor por mecânica.
    setItens((xs) => [...xs, { origem: tipo, idorigempromocao: idproduto, valor: n(valorItem), ativo: 'S' } as PromocaoItemDto]);
    limparAdder();
  };

  // R: código + Vr. Desconto ($/%) + quantidade (SEM produto)
  const adicionarCodigo = () => {
    if (!codigoR.trim()) return mensagem.erro('Informe o código promocional.');
    if (!(n(valorR) > 0)) return mensagem.erro('Informe o valor do desconto (> 0).');
    if (itens.some((it) => it.origem === 'R' && String(it.codigo_promocional).toUpperCase() === codigoR.trim().toUpperCase()))
      return mensagem.erro('Este código já está na lista.');
    setItens((xs) => [...xs, {
      origem: 'R', codigo_promocional: codigoR.trim(), valor: n(valorR),
      tipo: percR === 'S' ? '%' : '$', quantidade: qtdeR, ativo: 'S',
    } as PromocaoItemDto]);
    limparAdder();
  };

  // O (Combo): produto + quantidade + valor (promoção) + tipo ($/%). VALORCOMBO/TIPOCOMBO ficam no header.
  const adicionarCombo = () => {
    if (idproduto == null) return mensagem.erro('Selecione o produto.');
    if (!(n(qtdeCombo) > 0)) return mensagem.erro('Informe a quantidade (> 0).');
    if (!(n(valorItem) > 0)) return mensagem.erro('Informe o valor da promoção (> 0).');
    if (itens.some((it) => it.origem === 'O' && Number(it.idorigempromocao) === idproduto))
      return mensagem.erro('Produto já está na lista.');
    setItens((xs) => [...xs, {
      origem: 'O', idorigempromocao: idproduto, quantidade: n(qtdeCombo), valor: n(valorItem),
      tipo: tipoItemCombo === '%' ? '%' : '$', ativo: 'S',
    } as PromocaoItemDto]);
    limparAdder();
  };

  // L (Leve Pague): produto + Qtde. Leve (quantidade) + Qtde. Pague (quantidade_paga). SEM valor (desconto derivado).
  const adicionarLevePague = () => {
    if (idproduto == null) return mensagem.erro('Selecione o produto.');
    if (!(n(qtdeLeve) > 0)) return mensagem.erro('Informe a Qtde. Leve (> 0).');
    if (!(n(qtdePague) > 0)) return mensagem.erro('Informe a Qtde. Pague (> 0).');
    // (sem exigir pague<leve: o legado só valida ambas>0 — LevePagueValidada; golden tem linhas pague≥leve.)
    if (itens.some((it) => it.origem === 'L' && Number(it.idorigempromocao) === idproduto))
      return mensagem.erro('Produto já está na lista.');
    setItens((xs) => [...xs, {
      origem: 'L', idorigempromocao: idproduto, quantidade: n(qtdeLeve), quantidade_paga: n(qtdePague), ativo: 'S',
    } as PromocaoItemDto]);
    limparAdder();
  };

  // C (Categoria): SUBTIPO (dimensão) + alvo (por SUBTIPO) + Promoção (%). idorigempromocao = o alvo.
  const adicionarCategoria = () => {
    if (alvoCat == null) return mensagem.erro(`Selecione ${SUBTIPO_LABEL[subtipoCat]?.toLowerCase() ?? 'o alvo'}.`);
    if (!(n(valorCat) > 0)) return mensagem.erro('Informe a promoção (%) (> 0).');
    if (itens.some((it) => it.origem === 'C' && String(it.subtipo) === subtipoCat && Number(it.idorigempromocao) === alvoCat))
      return mensagem.erro('Este alvo já está na lista.');
    setItens((xs) => [...xs, {
      origem: 'C', subtipo: subtipoCat, idorigempromocao: alvoCat, valor: n(valorCat), ativo: 'S',
    } as PromocaoItemDto]);
    limparAdder();
  };

  // A (Atacarejo): produto + Qtde. (tier mín.) + Vr. Atacarejo (preço) + Cálculo ($/%). N tiers por produto (dedup produto+qtde).
  const adicionarAtacarejo = () => {
    if (idproduto == null) return mensagem.erro('Selecione o produto.');
    if (!(n(qtdeAtac) > 0)) return mensagem.erro('Informe a quantidade (> 0).');
    if (!(n(valorItem) > 0)) return mensagem.erro('Informe o valor do atacarejo (> 0).');
    if (itens.some((it) => it.origem === 'A' && Number(it.idorigempromocao) === idproduto && Number(it.quantidade) === n(qtdeAtac)))
      return mensagem.erro('Já existe um tier deste produto com essa quantidade.');
    setItens((xs) => [...xs, {
      origem: 'A', idorigempromocao: idproduto, quantidade: n(qtdeAtac), valor: n(valorItem),
      tipo: tipoAtac === '%' ? '%' : '$', ativo: 'S',
    } as PromocaoItemDto]);
    limparAdder();
  };

  // B (Bonificação): produto + Quantidade (compre) + Quantidade bonificada (ganhe). SEM valor.
  const adicionarBonificacao = () => {
    if (idproduto == null) return mensagem.erro('Selecione o produto.');
    if (!(n(qtdeCompraB) > 0)) return mensagem.erro('Informe a quantidade (> 0).');
    if (!(n(qtdeBonifB) > 0)) return mensagem.erro('Informe a quantidade bonificada (> 0).');
    if (itens.some((it) => it.origem === 'B' && Number(it.idorigempromocao) === idproduto))
      return mensagem.erro('Produto já está na lista.');
    setItens((xs) => [...xs, {
      origem: 'B', idorigempromocao: idproduto, quantidade: n(qtdeCompraB), quantidade_paga: n(qtdeBonifB), ativo: 'S',
    } as PromocaoItemDto]);
    limparAdder();
  };

  // G/D 2 grids — Grupo A (leve): origem = TIPO; produto + quantidade.
  const adicionarGrupoA = () => {
    if (idProdA == null) return mensagem.erro('Selecione o produto do Grupo A.');
    if (!(n(qtdeGA) > 0)) return mensagem.erro('Informe a quantidade do Grupo A (> 0).');
    if (itens.some((it) => it.origem === tipo && Number(it.idorigempromocao) === idProdA))
      return mensagem.erro('Produto já está no Grupo A.');
    setItens((xs) => [...xs, { origem: tipo, idorigempromocao: idProdA, quantidade: n(qtdeGA), ativo: 'S' } as PromocaoItemDto]);
    setIdProdA(undefined); setQtdeGA(undefined);
  };
  // G/D 2 grids — Grupo B (ganhe): origem = TIPO+'F' (GF/DF); produto + quantidade (+ % adicional se filhoValor).
  const adicionarGrupoB = () => {
    if (!mec || mec.shape !== 'doisgrids') return;
    const origemB = `${tipo}F`;
    if (idProdB == null) return mensagem.erro('Selecione o produto do Grupo B.');
    if (!(n(qtdeGB) > 0)) return mensagem.erro('Informe a quantidade do Grupo B (> 0).');
    if (mec.filhoValor && !(n(valorGB) > 0)) return mensagem.erro('Informe o desconto adicional (%) (> 0).');
    if (itens.some((it) => it.origem === origemB && Number(it.idorigempromocao) === idProdB))
      return mensagem.erro('Produto já está no Grupo B.');
    setItens((xs) => [...xs, {
      origem: origemB, idorigempromocao: idProdB, quantidade: n(qtdeGB),
      ...(mec.filhoValor ? { valor: n(valorGB) } : {}), ativo: 'S',
    } as PromocaoItemDto]);
    setIdProdB(undefined); setQtdeGB(undefined); setValorGB(undefined);
  };

  const removerItem = (i: number) => setItens((xs) => xs.filter((_, idx) => idx !== i));

  // trocar a mecânica (aba) LIMPA os itens — senão itens de uma aba ficariam pendurados e seriam gravados
  // numa promoção de outro TIPO (header/detalhe divergentes). Fiel ao PageControl do legado (cada aba, seus dados).
  const trocarTipo = (v: string) => {
    setTipo(v || 'P');
    setItens([]);
    limparAdder();
    setValorComboHdr(undefined); setTipoComboHdr('C'); // header do combo: limpa na troca de aba (não a cada Adicionar)
  };

  const gravar = async () => {
    if (!descricao.trim()) return mensagem.erro('Informe a descrição da promoção.');
    if (mec && !itens.length) return mensagem.erro('Adicione ao menos um item.');
    if (mec?.shape === 'combo' && !(n(valorComboHdr) > 0)) return mensagem.erro('Informe o valor do combo (> 0).');
    setSalvando(true);
    try {
      // datetime-local é wall-clock sem fuso → ISO com o offset do navegador (fold de timezone da Agenda).
      const iso = (s: string) => (s ? new Date(s).toISOString() : undefined);
      await criarPromocao({
        descricao: descricao.trim(),
        tipo: tipo as any,
        datainicio: iso(dtini),
        datafim: iso(dtfim),
        destino: destino as any,
        empresas: empresas.trim() || undefined,
        // Combo: VALORCOMBO/TIPOCOMBO no header (server copia em cada item).
        ...(mec?.shape === 'combo' ? { valorcombo: n(valorComboHdr), tipocombo: tipoComboHdr } : {}),
        // só envia itens da aba PRONTA — abas não-convertidas gravam apenas o cabeçalho (nunca itens órfãos).
        itens: mec ? itens : [],
      } as any);
      mensagem.sucesso('Promoção gravada.');
      setDescricao(''); setDestino('T'); setEmpresas(''); setDtini(''); setDtfim(''); setItens([]);
      setValorComboHdr(undefined); setTipoComboHdr('C');
      await recarregar();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setSalvando(false);
    }
  };

  const acao = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); mensagem.sucesso(ok); await recarregar(); } catch (e) { mensagem.erro(e); }
  };

  const colunas = useMemo<DataTableColumnDef<Promocao>[]>(() => [
    { field: 'idpromocao', headerName: 'Cód.', type: 'number', width: 80, isPrimary: true },
    { field: 'descricao', headerName: 'Descrição', type: 'text' },
    { field: 'tipo', headerName: 'Mecânica', type: 'text', width: 150, valueGetter: (r) => TIPO_LABEL[String(r.tipo)] ?? String(r.tipo ?? '') },
    { field: 'datainicio', headerName: 'Início', type: 'text', width: 150, valueGetter: (r) => fmtDt(r.datainicio) },
    { field: 'datafim', headerName: 'Fim', type: 'text', width: 150, valueGetter: (r) => fmtDt(r.datafim) },
    { field: 'qtde_itens', headerName: 'Itens', type: 'number', width: 80 },
    {
      field: 'acoes', headerName: '', type: 'actions', width: 90,
      getActions: ({ row: r }: { row: Promocao }) => [
        { id: 'excluir', label: 'Excluir', icon: <Trash2 size={16} />, destructive: true, onClick: () => void acao(() => removerPromocao(Number(r.idpromocao)), 'Promoção excluída.') },
      ],
    },
  ], []);

  // colunas do grid de itens por shape
  const valorHeaderProd = mec?.unidade === 'percent' ? 'Desconto (%)' : mec?.rotulo?.replace('&', '') ?? 'Valor';
  const fmtValorProd = mec?.unidade === 'percent' ? fmtPct : fmtMoeda;
  const itensColsProduto = useMemo<DataTableColumnDef<PromocaoItemDto & { _i: number }>[]>(() => [
    { field: 'idorigempromocao', headerName: 'Produto', type: 'text', isPrimary: true, valueGetter: (r) => rotuloProduto(r.idorigempromocao) },
    { field: 'valor', headerName: valorHeaderProd, type: 'text', width: 150, valueGetter: (r) => fmtValorProd(r.valor) },
    {
      field: 'rem', headerName: '', type: 'actions', width: 60,
      getActions: ({ row: r }: { row: PromocaoItemDto & { _i: number } }) => [
        { id: 'rem', label: 'Remover', icon: <X size={16} />, destructive: true, onClick: () => removerItem(r._i) },
      ],
    },
  ], [rotuloProduto, valorHeaderProd, fmtValorProd]);
  const itensColsCodigo = useMemo<DataTableColumnDef<PromocaoItemDto & { _i: number }>[]>(() => [
    { field: 'codigo_promocional', headerName: 'Código', type: 'text', isPrimary: true, valueGetter: (r) => String(r.codigo_promocional ?? '') },
    { field: 'valor', headerName: 'Vr. Desconto', type: 'text', width: 140, valueGetter: (r) => fmtValorPorTipo(r.valor, r.tipo) },
    { field: 'quantidade', headerName: 'Qtde.', type: 'number', width: 90, valueGetter: (r) => (n(r.quantidade) > 0 ? n(r.quantidade) : 1) },
    {
      field: 'rem', headerName: '', type: 'actions', width: 60,
      getActions: ({ row: r }: { row: PromocaoItemDto & { _i: number } }) => [
        { id: 'rem', label: 'Remover', icon: <X size={16} />, destructive: true, onClick: () => removerItem(r._i) },
      ],
    },
  ], []);
  const itensColsCombo = useMemo<DataTableColumnDef<PromocaoItemDto & { _i: number }>[]>(() => [
    { field: 'idorigempromocao', headerName: 'Produto', type: 'text', isPrimary: true, valueGetter: (r) => rotuloProduto(r.idorigempromocao) },
    { field: 'quantidade', headerName: 'Qtde.', type: 'number', width: 90, valueGetter: (r) => n(r.quantidade) },
    { field: 'valor', headerName: 'Vr. Promoção', type: 'text', width: 140, valueGetter: (r) => fmtValorPorTipo(r.valor, r.tipo) },
    {
      field: 'rem', headerName: '', type: 'actions', width: 60,
      getActions: ({ row: r }: { row: PromocaoItemDto & { _i: number } }) => [
        { id: 'rem', label: 'Remover', icon: <X size={16} />, destructive: true, onClick: () => removerItem(r._i) },
      ],
    },
  ], [rotuloProduto]);
  const itensColsLevePague = useMemo<DataTableColumnDef<PromocaoItemDto & { _i: number }>[]>(() => [
    { field: 'idorigempromocao', headerName: 'Produto', type: 'text', isPrimary: true, valueGetter: (r) => rotuloProduto(r.idorigempromocao) },
    { field: 'quantidade', headerName: 'Qtde. Leve', type: 'number', width: 110, valueGetter: (r) => n(r.quantidade) },
    { field: 'quantidade_paga', headerName: 'Qtde. Pague', type: 'number', width: 110, valueGetter: (r) => n(r.quantidade_paga) },
    {
      field: 'rem', headerName: '', type: 'actions', width: 60,
      getActions: ({ row: r }: { row: PromocaoItemDto & { _i: number } }) => [
        { id: 'rem', label: 'Remover', icon: <X size={16} />, destructive: true, onClick: () => removerItem(r._i) },
      ],
    },
  ], [rotuloProduto]);
  const itensColsCategoria = useMemo<DataTableColumnDef<PromocaoItemDto & { _i: number }>[]>(() => [
    { field: 'subtipo', headerName: 'Categoria', type: 'text', width: 130, valueGetter: (r) => SUBTIPO_LABEL[String(r.subtipo)] ?? String(r.subtipo ?? '') },
    { field: 'idorigempromocao', headerName: 'Alvo', type: 'text', isPrimary: true, valueGetter: (r) => rotuloAlvo(r.subtipo, r.idorigempromocao) },
    { field: 'valor', headerName: 'Promoção (%)', type: 'text', width: 130, valueGetter: (r) => fmtPct(r.valor) },
    {
      field: 'rem', headerName: '', type: 'actions', width: 60,
      getActions: ({ row: r }: { row: PromocaoItemDto & { _i: number } }) => [
        { id: 'rem', label: 'Remover', icon: <X size={16} />, destructive: true, onClick: () => removerItem(r._i) },
      ],
    },
  ], [rotuloAlvo]);
  const itensColsAtacarejo = useMemo<DataTableColumnDef<PromocaoItemDto & { _i: number }>[]>(() => [
    { field: 'idorigempromocao', headerName: 'Produto', type: 'text', isPrimary: true, valueGetter: (r) => rotuloProduto(r.idorigempromocao) },
    { field: 'quantidade', headerName: 'A partir de (qtde.)', type: 'number', width: 150, valueGetter: (r) => n(r.quantidade) },
    { field: 'valor', headerName: 'Vr. Atacarejo', type: 'text', width: 140, valueGetter: (r) => fmtValorPorTipo(r.valor, r.tipo) },
    {
      field: 'rem', headerName: '', type: 'actions', width: 60,
      getActions: ({ row: r }: { row: PromocaoItemDto & { _i: number } }) => [
        { id: 'rem', label: 'Remover', icon: <X size={16} />, destructive: true, onClick: () => removerItem(r._i) },
      ],
    },
  ], [rotuloProduto]);
  const itensColsBonificacao = useMemo<DataTableColumnDef<PromocaoItemDto & { _i: number }>[]>(() => [
    { field: 'idorigempromocao', headerName: 'Produto', type: 'text', isPrimary: true, valueGetter: (r) => rotuloProduto(r.idorigempromocao) },
    { field: 'quantidade', headerName: 'Quantidade', type: 'number', width: 120, valueGetter: (r) => n(r.quantidade) },
    { field: 'quantidade_paga', headerName: 'Qtde. bonificada', type: 'number', width: 140, valueGetter: (r) => n(r.quantidade_paga) },
    {
      field: 'rem', headerName: '', type: 'actions', width: 60,
      getActions: ({ row: r }: { row: PromocaoItemDto & { _i: number } }) => [
        { id: 'rem', label: 'Remover', icon: <X size={16} />, destructive: true, onClick: () => removerItem(r._i) },
      ],
    },
  ], [rotuloProduto]);
  const remCol: DataTableColumnDef<PromocaoItemDto & { _i: number }> = {
    field: 'rem', headerName: '', type: 'actions', width: 60,
    getActions: ({ row: r }: { row: PromocaoItemDto & { _i: number } }) => [
      { id: 'rem', label: 'Remover', icon: <X size={16} />, destructive: true, onClick: () => removerItem(r._i) },
    ],
  };
  const itensColsGrupoA = useMemo<DataTableColumnDef<PromocaoItemDto & { _i: number }>[]>(() => [
    { field: 'idorigempromocao', headerName: 'Produto', type: 'text', isPrimary: true, valueGetter: (r) => rotuloProduto(r.idorigempromocao) },
    { field: 'quantidade', headerName: 'Quantidade', type: 'number', width: 120, valueGetter: (r) => n(r.quantidade) },
    remCol,
  ], [rotuloProduto]);
  const itensColsGrupoB = useMemo<DataTableColumnDef<PromocaoItemDto & { _i: number }>[]>(() => [
    { field: 'idorigempromocao', headerName: 'Produto', type: 'text', isPrimary: true, valueGetter: (r) => rotuloProduto(r.idorigempromocao) },
    { field: 'quantidade', headerName: 'Quantidade', type: 'number', width: 120, valueGetter: (r) => n(r.quantidade) },
    ...(mec?.filhoValor ? [{ field: 'valor', headerName: 'Desconto (%)', type: 'text' as const, width: 120, valueGetter: (r: any) => fmtPct(r.valor) }] : []),
    remCol,
  ], [rotuloProduto, mec?.filhoValor]);

  const itensComIdx = itens.map((it, _i) => ({ ...it, _i }));
  const itensDaAba = itensComIdx.filter((it) => it.origem === tipo); // Grupo A (nas de 2 grids) / única aba nas demais
  const itensGrupoB = itensComIdx.filter((it) => it.origem === `${tipo}F`); // Grupo B (GF/DF), só nas de 2 grids

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Gestão de Promoções" />

      {/* Cabeçalho da promoção */}
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-6">
          <div className="sm:col-span-3"><Field label="&Descrição" value={descricao} maxLength={150} onChange={(e) => setDescricao(e.target.value)} /></div>
          <div className="sm:col-span-2"><SelectField label="&Tipo" options={TIPOS} value={tipo} onChange={trocarTipo} /></div>
          <div className="sm:col-span-1"><SelectField label="D&estino" options={DESTINOS} value={destino} onChange={(v) => setDestino(v || undefined)} placeholder="—" /></div>
          <label className="flex flex-col gap-gp-2xs text-body-sm sm:col-span-2">
            <span className="text-fg-muted">Início (data e hora)</span>
            <input type="datetime-local" className="rounded-radius-base border border-border bg-bg-default px-pad-sm py-pad-xs" value={dtini} onChange={(e) => setDtini(e.target.value)} />
          </label>
          <label className="flex flex-col gap-gp-2xs text-body-sm sm:col-span-2">
            <span className="text-fg-muted">Fim (data e hora)</span>
            <input type="datetime-local" className="rounded-radius-base border border-border bg-bg-default px-pad-sm py-pad-xs" value={dtfim} onChange={(e) => setDtfim(e.target.value)} />
          </label>
          <div className="sm:col-span-2"><Field label="E&mpresas (CSV)" value={empresas} maxLength={50} placeholder="ex.: 1,50" onChange={(e) => setEmpresas(e.target.value)} /></div>
          {/* Operação do Combo (GpbOperacao do legado): VALORCOMBO + TIPOCOMBO no header, copiados em cada item */}
          {mec?.shape === 'combo' && (
            <>
              <div className="sm:col-span-2"><CurrencyField label="Valor do &combo" value={valorComboHdr} onChange={setValorComboHdr} /></div>
              <div className="sm:col-span-2"><SelectField label="Tipo do com&bo" options={TIPOCOMBO_OPCOES} value={tipoComboHdr} onChange={(v) => setTipoComboHdr(v || 'C')} /></div>
            </>
          )}
        </div>

        {/* Aba da mecânica (PageControl do legado) — P/F/V/R/O funcionais; demais avisam */}
        <div className="mt-form-gap rounded-radius-base border border-border-subtle bg-bg-subtle p-pad-sm">
          <div className="mb-form-gap text-body-sm font-semibold text-fg-default">Aba: {TIPO_LABEL[tipo]}</div>

          {mec?.shape === 'produto' && (
            <>
              <div className="grid grid-cols-1 items-end gap-form-gap sm:grid-cols-6">
                <div className="sm:col-span-3"><SelectField label="&Produto" options={produtoOptions} value={idproduto != null ? String(idproduto) : undefined} onChange={(v) => setIdproduto(v ? Number(v) : undefined)} placeholder="Selecione…" /></div>
                <div className="sm:col-span-2">
                  {mec.unidade === 'percent'
                    ? <NumberField label={mec.rotulo!} value={valorItem} onChange={setValorItem} decimais={2} min={0} max={100} />
                    : <CurrencyField label={mec.rotulo!} value={valorItem} onChange={setValorItem} />}
                </div>
                <div className="flex items-end justify-end sm:col-span-1"><Button label="&Adicionar" variant="soft" onClick={adicionarProduto} /></div>
              </div>
              {itensDaAba.length > 0 && (
                <div className="mt-form-gap overflow-x-auto">
                  <DataTable rows={itensDaAba} columns={itensColsProduto} getRowId={(r) => String(r._i)} />
                </div>
              )}
            </>
          )}

          {mec?.shape === 'codigo' && (
            <>
              <div className="grid grid-cols-1 items-end gap-form-gap sm:grid-cols-6">
                <div className="sm:col-span-2"><Field label="&Código promocional" value={codigoR} maxLength={30} onChange={(e) => setCodigoR(e.target.value)} /></div>
                <div className="sm:col-span-2">
                  {percR === 'S'
                    ? <NumberField label="Vr. &Desconto (%)" value={valorR} onChange={setValorR} decimais={2} min={0} max={100} />
                    : <CurrencyField label="Vr. &Desconto (R$)" value={valorR} onChange={setValorR} />}
                </div>
                <NumberField label="&Quantidade" value={qtdeR} onChange={setQtdeR} decimais={0} min={0} />
                <div className="flex items-center gap-gp-md sm:col-span-1">
                  <CheckboxField label="&%" value={percR} onChange={setPercR} />
                  <Button label="A&dicionar" variant="soft" onClick={adicionarCodigo} />
                </div>
              </div>
              {itensDaAba.length > 0 && (
                <div className="mt-form-gap overflow-x-auto">
                  <DataTable rows={itensDaAba} columns={itensColsCodigo} getRowId={(r) => String(r._i)} />
                </div>
              )}
            </>
          )}

          {mec?.shape === 'combo' && (
            <>
              <div className="grid grid-cols-1 items-end gap-form-gap sm:grid-cols-6">
                <div className="sm:col-span-2"><SelectField label="&Produto" options={produtoOptions} value={idproduto != null ? String(idproduto) : undefined} onChange={(v) => setIdproduto(v ? Number(v) : undefined)} placeholder="Selecione…" /></div>
                <NumberField label="&Quantidade" value={qtdeCombo} onChange={setQtdeCombo} decimais={0} min={0} />
                <CurrencyField label="V&r. Promoção" value={valorItem} onChange={setValorItem} />
                <div className="sm:col-span-1"><SelectField label="Cá&lculo" options={TIPO_ITEM_OPCOES} value={tipoItemCombo} onChange={(v) => setTipoItemCombo(v || '$')} /></div>
                <div className="flex items-end justify-end sm:col-span-1"><Button label="A&dicionar" variant="soft" onClick={adicionarCombo} /></div>
              </div>
              {itensDaAba.length > 0 && (
                <div className="mt-form-gap overflow-x-auto">
                  <DataTable rows={itensDaAba} columns={itensColsCombo} getRowId={(r) => String(r._i)} />
                </div>
              )}
            </>
          )}

          {mec?.shape === 'levepague' && (
            <>
              <div className="grid grid-cols-1 items-end gap-form-gap sm:grid-cols-6">
                <div className="sm:col-span-3"><SelectField label="&Produto" options={produtoOptions} value={idproduto != null ? String(idproduto) : undefined} onChange={(v) => setIdproduto(v ? Number(v) : undefined)} placeholder="Selecione…" /></div>
                <NumberField label="Qtde. &Leve" value={qtdeLeve} onChange={setQtdeLeve} decimais={3} min={0} />
                <NumberField label="Qtde. &Pague" value={qtdePague} onChange={setQtdePague} decimais={2} min={0} />
                <div className="flex items-end justify-end sm:col-span-1"><Button label="A&dicionar" variant="soft" onClick={adicionarLevePague} /></div>
              </div>
              {itensDaAba.length > 0 && (
                <div className="mt-form-gap overflow-x-auto">
                  <DataTable rows={itensDaAba} columns={itensColsLevePague} getRowId={(r) => String(r._i)} />
                </div>
              )}
            </>
          )}

          {mec?.shape === 'categoria' && (
            <>
              <div className="grid grid-cols-1 items-end gap-form-gap sm:grid-cols-6">
                <div className="sm:col-span-2"><SelectField label="&Categoria" options={SUBTIPO_OPCOES} value={subtipoCat} onChange={(v) => { setSubtipoCat(v || 'P'); setAlvoCat(undefined); }} /></div>
                <div className="sm:col-span-2"><SelectField label={`&${SUBTIPO_LABEL[subtipoCat] ?? 'Alvo'}`} options={alvoOptions} value={alvoCat != null ? String(alvoCat) : undefined} onChange={(v) => setAlvoCat(v ? Number(v) : undefined)} placeholder="Selecione…" /></div>
                <NumberField label="&Promoção (%)" value={valorCat} onChange={setValorCat} decimais={2} min={0} max={100} />
                <div className="flex items-end justify-end sm:col-span-1"><Button label="A&dicionar" variant="soft" onClick={adicionarCategoria} /></div>
              </div>
              {itensDaAba.length > 0 && (
                <div className="mt-form-gap overflow-x-auto">
                  <DataTable rows={itensDaAba} columns={itensColsCategoria} getRowId={(r) => String(r._i)} />
                </div>
              )}
            </>
          )}

          {mec?.shape === 'atacarejo' && (
            <>
              <div className="grid grid-cols-1 items-end gap-form-gap sm:grid-cols-6">
                <div className="sm:col-span-2"><SelectField label="&Produto" options={produtoOptions} value={idproduto != null ? String(idproduto) : undefined} onChange={(v) => setIdproduto(v ? Number(v) : undefined)} placeholder="Selecione…" /></div>
                <NumberField label="A partir de (&qtde.)" value={qtdeAtac} onChange={setQtdeAtac} decimais={2} min={0} />
                <CurrencyField label="V&r. Atacarejo" value={valorItem} onChange={setValorItem} />
                <div className="sm:col-span-1"><SelectField label="Cá&lculo" options={TIPO_ITEM_OPCOES} value={tipoAtac} onChange={(v) => setTipoAtac(v || '$')} /></div>
                <div className="flex items-end justify-end sm:col-span-1"><Button label="A&dicionar" variant="soft" onClick={adicionarAtacarejo} /></div>
              </div>
              {itensDaAba.length > 0 && (
                <div className="mt-form-gap overflow-x-auto">
                  <DataTable rows={itensDaAba} columns={itensColsAtacarejo} getRowId={(r) => String(r._i)} />
                </div>
              )}
            </>
          )}

          {mec?.shape === 'bonificacao' && (
            <>
              <div className="grid grid-cols-1 items-end gap-form-gap sm:grid-cols-6">
                <div className="sm:col-span-3"><SelectField label="&Produto" options={produtoOptions} value={idproduto != null ? String(idproduto) : undefined} onChange={(v) => setIdproduto(v ? Number(v) : undefined)} placeholder="Selecione…" /></div>
                <NumberField label="&Quantidade" value={qtdeCompraB} onChange={setQtdeCompraB} decimais={2} min={0} />
                <NumberField label="Qtde. &bonificada" value={qtdeBonifB} onChange={setQtdeBonifB} decimais={2} min={0} />
                <div className="flex items-end justify-end sm:col-span-1"><Button label="A&dicionar" variant="soft" onClick={adicionarBonificacao} /></div>
              </div>
              {itensDaAba.length > 0 && (
                <div className="mt-form-gap overflow-x-auto">
                  <DataTable rows={itensDaAba} columns={itensColsBonificacao} getRowId={(r) => String(r._i)} />
                </div>
              )}
            </>
          )}

          {mec?.shape === 'doisgrids' && (
            <div className="flex flex-col gap-form-gap">
              {/* Grupo A — leve (origem = TIPO) */}
              <div>
                <div className="mb-gp-2xs text-body-sm font-semibold text-fg-default">{mec.grupoA}</div>
                <div className="grid grid-cols-1 items-end gap-form-gap sm:grid-cols-6">
                  <div className="sm:col-span-3"><SelectField label="Produto (&A)" options={produtoOptions} value={idProdA != null ? String(idProdA) : undefined} onChange={(v) => setIdProdA(v ? Number(v) : undefined)} placeholder="Selecione…" /></div>
                  <NumberField label="&Quantidade" value={qtdeGA} onChange={setQtdeGA} decimais={0} min={0} />
                  <div className="flex items-end justify-end sm:col-span-2"><Button label="Adicionar ao Grupo &A" variant="ghost" onClick={adicionarGrupoA} /></div>
                </div>
                {itensDaAba.length > 0 && (
                  <div className="mt-gp-2xs overflow-x-auto"><DataTable rows={itensDaAba} columns={itensColsGrupoA} getRowId={(r) => String(r._i)} /></div>
                )}
              </div>
              {/* Grupo B — ganhe (origem = TIPO+'F') */}
              <div className="border-t border-border-subtle pt-form-gap">
                <div className="mb-gp-2xs text-body-sm font-semibold text-fg-default">{mec.grupoB}</div>
                <div className="grid grid-cols-1 items-end gap-form-gap sm:grid-cols-6">
                  <div className="sm:col-span-3"><SelectField label="Produto (&B)" options={produtoOptions} value={idProdB != null ? String(idProdB) : undefined} onChange={(v) => setIdProdB(v ? Number(v) : undefined)} placeholder="Selecione…" /></div>
                  <NumberField label="Q&uantidade" value={qtdeGB} onChange={setQtdeGB} decimais={0} min={0} />
                  {/* % adicional SEM teto (golden DF vai até 279%; servidor uncapped, fiel) */}
                  {mec.filhoValor && <NumberField label="&Desconto (%)" value={valorGB} onChange={setValorGB} decimais={2} min={0} />}
                  <div className={`flex items-end justify-end ${mec.filhoValor ? 'sm:col-span-1' : 'sm:col-span-2'}`}><Button label="Adicionar ao Grupo &B" variant="ghost" onClick={adicionarGrupoB} /></div>
                </div>
                {itensGrupoB.length > 0 && (
                  <div className="mt-gp-2xs overflow-x-auto"><DataTable rows={itensGrupoB} columns={itensColsGrupoB} getRowId={(r) => String(r._i)} /></div>
                )}
              </div>
            </div>
          )}

          {!mec && (
            <p className="text-body-sm text-fg-muted">
              A mecânica <strong>{TIPO_LABEL[tipo]}</strong> entra em um próximo corte. O cabeçalho da promoção já pode ser
              gravado; os itens desta aba serão habilitados quando ela for convertida.
            </p>
          )}
        </div>

        <div className="mt-form-gap flex justify-end">
          <Button label={salvando ? 'Gravando…' : 'Gravar promoção'} disabled={salvando} onClick={() => void gravar()} />
        </div>
      </section>

      {/* Lista de promoções */}
      <DataTable rows={lista} columns={colunas} loading={carregando} getRowId={(r) => String(r.idpromocao)} />
    </div>
  );
}
