import { useEffect, useMemo } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { useResourceOptions, type Opcao } from '../cadmaster/useResourceOptions';

/**
 * A SITUAÇÃO DO DOCUMENTO de uma tela que não é a NF (UCadSituacaoNF.md C5): o legado abre a consulta de situações
 * só do TIPO DE OPERAÇÃO da tela e do tipo E/S — contas a pagar F04/E (uAPagar.pas:6506), contas a receber F05/S
 * (uCadAReceber.pas:3099), movimento de caixa F06, scrap E02 — com as situações SEM CFOP também (o `LEFT JOIN`).
 * Quando só existe UMA, ela entra sozinha (`case RecordCount of 1`).
 */
export function useSituacoesDaOperacao(tipoOperacao: string, tipo: 'E' | 'S'): Opcao[] {
  const { data = [] } = useResourceOptions('cadastro/situacoes-nf', (s: any) => ({
    value: String(s.idsituacao_nf),
    label: `${s.idsituacao_nf} - ${s.descricao}`,
    tipo_operacao: String(s.tipo_operacao ?? '').toUpperCase(),
    tipo: s.tipo ?? null,
  }));
  return useMemo(
    () => data.filter((o) => o.tipo_operacao === tipoOperacao && (!o.tipo || o.tipo === tipo)).map(({ value, label }) => ({ value, label })),
    [data, tipoOperacao, tipo],
  );
}

/** no documento NOVO, a única situação da operação entra sozinha (o valor já gravado é mantido) */
export function useSituacaoUnica(form: UseFormReturn<any>, opcoes: Opcao[], novo: boolean, campo = 'idsituacao_nf'): void {
  useEffect(() => {
    if (!novo || opcoes.length !== 1 || form.getValues(campo) != null) return;
    form.setValue(campo, Number(opcoes[0].value), { shouldDirty: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novo, opcoes]);
}
