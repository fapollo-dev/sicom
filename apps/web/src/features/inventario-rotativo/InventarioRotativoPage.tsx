import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import {
  listarLotesRotativo, criarLoteRotativo, alterarLoteRotativo, fecharLoteRotativo, zerarEstoqueRotativo,
  type LoteRotativoResumo,
} from './inventarioRotativoApi';

/**
 * INVENTÁRIO ROTATIVO (FRMRELINVENTARIOROTATIVO) — cortes 1 e 2. O estado do lote é DERIVADO: no legado fechar
 * insere uma linha 'FECHADO' ao lado da 'ABERTO', então "aberto" é a ausência do fechamento, não um campo.
 * Fechar tem os dois caminhos do legado: com um lote selecionado copia o cabeçalho; sem lote, cria um número novo
 * e carimba as coletas órfãs da empresa. Zerar estoque exige liberação por login (config 46) e deixa rastro em
 * `ajuste_estoque` além da coleta.
 */
export function InventarioRotativoPage() {
  const mensagem = useMensagem();
  const [lotes, setLotes] = useState<LoteRotativoResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<LoteRotativoResumo | null>(null);
  // novo lote
  const [nomelote, setNomelote] = useState('');
  const [tipo, setTipo] = useState('R');
  const [codgrupo, setCodgrupo] = useState<number | undefined>();
  const [codsecao, setCodsecao] = useState<number | undefined>();
  const [exige, setExige] = useState(false);
  // zerar estoque
  const [prods, setProds] = useState('');
  const [loja, setLoja] = useState(true);
  const [deposito, setDeposito] = useState(false);
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setLotes((await listarLotesRotativo()).itens);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [mensagem]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const abrir = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await criarLoteRotativo({
        nomelote, tipo, codgrupo, codsecao,
        exigeconfirmacao: exige ? 'S' : undefined,
      });
      mensagem.sucesso(`Lote ${r.lote} aberto.`);
      setNomelote('');
      await carregar();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const renomear = async () => {
    if (!sel?.codinv_rotativo_aberto || busy) return;
    const novo = window.prompt('Novo nome do lote:', sel.nomelote ?? '');
    if (novo == null || !novo.trim()) return;
    setBusy(true);
    try {
      await alterarLoteRotativo(sel.codinv_rotativo_aberto, { nomelote: novo.trim() });
      mensagem.sucesso('Lote alterado (o legado altera só o cabeçalho — os departamentos ficam como estavam).');
      await carregar();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const fechar = async (comLote: boolean) => {
    if (busy) return;
    const msg = comLote
      ? `Fechar o lote ${sel?.lote}?`
      : 'Fechar sem lote? Um número novo será criado e TODAS as coletas soltas desta empresa receberão esse lote.';
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const r = await fecharLoteRotativo(comLote && sel?.lote ? { lote: sel.lote } : {});
      mensagem.sucesso(
        r.ja_fechado
          ? `Lote ${r.lote} já tinha fechamento — o legado permite fechar de novo, e um novo registro foi gravado.`
          : `Lote ${r.lote} fechado.${r.coletas_carimbadas ? ` ${r.coletas_carimbadas} coleta(s) sem lote foram carimbadas.` : ''}`,
      );
      setSel(null);
      await carregar();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const zerar = async () => {
    if (busy) return;
    const idprodutos = prods.split(/[\s,;]+/).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
    if (!idprodutos.length) {
      mensagem.erro(new Error('Informe ao menos um produto.'));
      return;
    }
    if (!window.confirm(`Zerar o estoque de ${idprodutos.length} produto(s) em ${[loja && 'loja', deposito && 'depósito'].filter(Boolean).join(' e ')}? A operação gera ajuste de estoque.`)) return;
    setBusy(true);
    try {
      const r = await zerarEstoqueRotativo({ idprodutos, loja, deposito, lote: sel?.lote ?? undefined, login, senha });
      mensagem.sucesso(`${r.zerados} saldo(s) zerado(s), ${r.coletas} coleta(s) e ${r.ajustes} ajuste(s) gravados.`);
      setSenha('');
      await carregar();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setBusy(false);
    }
  };

  const colunas: DataTableColumnDef<LoteRotativoResumo>[] = [
    { field: 'lote', headerName: 'Lote', type: 'text', width: 90, isPrimary: true },
    { field: 'nomelote', headerName: 'Nome', type: 'text' },
    { field: 'tipo', headerName: 'Tipo', type: 'text', width: 80 },
    { field: 'abertura', headerName: 'Abertura', type: 'text', width: 150 },
    { field: 'fechamento', headerName: 'Fechamento', type: 'text', width: 150 },
    { field: 'coletas', headerName: 'Coletas', type: 'number', width: 100 },
    {
      field: 'acoes', headerName: '', type: 'actions', width: 120,
      getActions: () => [{ id: 'sel', label: 'Selecionar', onClick: (row: LoteRotativoResumo) => setSel(row) }],
    },
  ];

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Inventário rotativo" />

      {/* ABRIR LOTE */}
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <Field label="&Nome do lote" value={nomelote} onChange={(e) => setNomelote(e.target.value)} />
        <SelectField label="&Tipo" value={tipo} onChange={(v) => setTipo(v || 'R')} options={[{ value: 'R', label: 'Rotativo' }, { value: 'G', label: 'Geral' }]} />
        <NumberField label="&Grupo" value={codgrupo} onChange={setCodgrupo} />
        <NumberField label="&Seção" value={codsecao} onChange={setCodsecao} />
        <CheckboxField label="&Exige confirmação" value={exige ? 'S' : 'N'} onChange={(v) => setExige(v === 'S')} />
        <Button label="&Abrir lote" variant="soft" disabled={busy || !nomelote.trim()} onClick={() => void abrir()} />
      </div>

      {/* AÇÕES DO LOTE SELECIONADO */}
      <div className="flex flex-wrap items-center gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <span className="text-body-sm">
          {sel ? `Lote ${sel.lote} — ${sel.nomelote ?? 'sem nome'} (${sel.aberto ? 'aberto' : 'fechado'})` : 'Nenhum lote selecionado'}
        </span>
        <Button label="&Renomear" variant="ghost" disabled={busy || !sel?.aberto} onClick={() => void renomear()} />
        <Button label="&Fechar lote" variant="soft" disabled={busy || !sel} onClick={() => void fechar(true)} />
        <Button label="Fechar &sem lote (carimba as coletas soltas)" variant="ghost" disabled={busy} onClick={() => void fechar(false)} />
      </div>

      {/* ZERAR ESTOQUE (grade do rotativo) */}
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <Field label="&Produtos (ids separados por espaço)" value={prods} onChange={(e) => setProds(e.target.value)} />
        <CheckboxField label="&Loja" value={loja ? 'S' : 'N'} onChange={(v) => setLoja(v === 'S')} />
        <CheckboxField label="&Depósito" value={deposito ? 'S' : 'N'} onChange={(v) => setDeposito(v === 'S')} />
        <Field label="Login (liberação)" value={login} onChange={(e) => setLogin(e.target.value)} />
        <Field label="Senha (liberação)" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} />
        <Button label="&Zerar estoque" variant="soft" disabled={busy || !login || !senha || (!loja && !deposito)} onClick={() => void zerar()} />
        <span className="text-xs text-fg-muted">
          Zerar exige autorização de um usuário da lista da configuração “usuários que zeram o estoque no inventário rotativo”; grava a coleta e o ajuste de estoque.
        </span>
      </div>

      <DataTable columns={colunas} rows={lotes} loading={carregando} getRowId={(r: LoteRotativoResumo) => String(r.lote)} />
    </div>
  );
}
