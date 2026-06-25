import { useEffect } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useParams } from 'react-router-dom';
import { loteCobrancaSchema, type CriarLoteCobrancaDto } from '@apollo/shared';
import { FormScope } from '../../shared/keyboard';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useLote, useCriarLote, useAtualizarLote } from './hooks';

/** Form MESTRE-DETALHE: header do lote + lista editável de itens (useFieldArray). */
export function LotesCobrancaFormPage() {
  const navigate = useNavigate();
  const params = useParams();
  const isNew = params.cod === 'novo';
  const cod = isNew ? undefined : Number(params.cod);

  const { data: existente } = useLote(cod);
  const criar = useCriarLote();
  const atualizar = useAtualizarLote(cod ?? 0);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<CriarLoteCobrancaDto>({
    resolver: zodResolver(loteCobrancaSchema),
    defaultValues: { codparceiro: undefined as unknown as number, data: '', itens: [{ codrcb: 0 }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'itens' });

  useEffect(() => {
    if (existente)
      reset({
        codparceiro: existente.codparceiro,
        data: String(existente.data).slice(0, 10),
        itens: existente.itens.map((i) => ({ codrcb: i.codrcb })),
      });
  }, [existente, reset]);

  const onSubmit = handleSubmit(async (dto) => {
    if (isNew) await criar.mutateAsync(dto);
    else await atualizar.mutateAsync(dto);
    navigate('/cobranca/lotes');
  });

  const num = (name: any) =>
    register(name, { setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)) });

  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <h1>{isNew ? 'Novo Lote de Cobrança' : `Lote ${cod}`}</h1>
      <FormScope onSubmit={onSubmit}>
        <Field label="&Parceiro" type="number" autoFocus error={errors.codparceiro?.message} {...num('codparceiro')} />
        <Field label="&Data" type="date" error={errors.data?.message} {...register('data')} />

        <fieldset style={{ marginTop: 16, border: '1px solid #ddd', borderRadius: 6, padding: 12 }}>
          <legend>Itens (contas a receber)</legend>
          {errors.itens?.message && <p style={{ color: '#c00' }}>{errors.itens.message}</p>}
          {fields.map((f, idx) => (
            <div key={f.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <Field label={`&Conta receber #${idx + 1}`} type="number" {...num(`itens.${idx}.codrcb`)} />
              <Button label="&Remover" variant="ghost" onClick={() => remove(idx)} />
            </div>
          ))}
          <Button label="&Adicionar item" variant="soft" onClick={() => append({ codrcb: 0 })} />
        </fieldset>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="submit" style={{ display: 'none' }} aria-hidden />
          <Button label="&Gravar" onClick={onSubmit} />
          <Button label="&Sair" variant="ghost" onClick={() => navigate('/cobranca/lotes')} />
        </div>
      </FormScope>
    </div>
  );
}
