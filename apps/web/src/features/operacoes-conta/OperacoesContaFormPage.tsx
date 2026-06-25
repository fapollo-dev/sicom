import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useParams } from 'react-router-dom';
import {
  operacaoContaSchema,
  TIPO_OPERACAO_CONTA,
  type CriarOperacaoContaDto,
} from '@apollo/shared';
import { FormScope } from '../../shared/keyboard';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useOperacaoConta, useCriarOperacaoConta, useAtualizarOperacaoConta } from './hooks';

export function OperacoesContaFormPage() {
  const navigate = useNavigate();
  const params = useParams();
  const isNew = params.cod === 'novo';
  const cod = isNew ? undefined : Number(params.cod);

  const { data: existente } = useOperacaoConta(cod);
  const criar = useCriarOperacaoConta();
  const atualizar = useAtualizarOperacaoConta(cod ?? 0);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<CriarOperacaoContaDto>({ resolver: zodResolver(operacaoContaSchema) });

  useEffect(() => {
    if (existente) reset({ descricao: existente.descricao, tipo: existente.tipo });
  }, [existente, reset]);

  const onSubmit = handleSubmit(async (dto) => {
    if (isNew) await criar.mutateAsync(dto);
    else await atualizar.mutateAsync(dto);
    navigate('/cadastro/operacoes-conta');
  });

  return (
    <div style={{ padding: 24, maxWidth: 480 }}>
      <h1>{isNew ? 'Nova Operação de Conta' : `Operação ${cod}`}</h1>
      <FormScope onSubmit={onSubmit}>
        <Field label="&Descrição" autoFocus error={errors.descricao?.message} {...register('descricao')} />
        <Controller
          control={control}
          name="tipo"
          render={({ field }) => (
            <SelectField
              label="&Tipo"
              options={TIPO_OPERACAO_CONTA}
              value={field.value}
              onChange={field.onChange}
              placeholder="Selecione…"
              error={errors.tipo?.message}
            />
          )}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="submit" style={{ display: 'none' }} aria-hidden />
          <Button label="&Gravar" onClick={onSubmit} />
          <Button label="&Sair" variant="ghost" onClick={() => navigate('/cadastro/operacoes-conta')} />
        </div>
      </FormScope>
    </div>
  );
}
