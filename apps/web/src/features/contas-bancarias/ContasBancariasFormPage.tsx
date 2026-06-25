import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useParams } from 'react-router-dom';
import { contaBancariaSchema, type CriarContaBancariaDto } from '@apollo/shared';
import { FormScope } from '../../shared/keyboard';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import {
  useContaBancaria,
  useBancoOptions,
  useCriarContaBancaria,
  useAtualizarContaBancaria,
} from './hooks';

const ATIVO_OPCOES = [
  { value: 'S', label: 'Sim' },
  { value: 'N', label: 'Não' },
];

export function ContasBancariasFormPage() {
  const navigate = useNavigate();
  const params = useParams();
  const isNew = params.cod === 'novo';
  const cod = isNew ? undefined : Number(params.cod);

  const { data: existente } = useContaBancaria(cod);
  const { data: bancoOptions = [] } = useBancoOptions(); // LOOKUP de outra entidade
  const criar = useCriarContaBancaria();
  const atualizar = useAtualizarContaBancaria(cod ?? 0);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<CriarContaBancariaDto>({ resolver: zodResolver(contaBancariaSchema) });

  useEffect(() => {
    if (existente)
      reset({
        codbco: existente.codbco,
        titular: existente.titular ?? undefined,
        nroconta: existente.nroconta ?? undefined,
        ativo: existente.ativo ?? 'S',
      });
  }, [existente, reset]);

  const onSubmit = handleSubmit(async (dto) => {
    if (isNew) await criar.mutateAsync(dto);
    else await atualizar.mutateAsync(dto);
    navigate('/cadastro/contas-bancarias');
  });

  return (
    <div style={{ padding: 24, maxWidth: 480 }}>
      <h1>{isNew ? 'Nova Conta Bancária' : `Conta ${cod}`}</h1>
      <FormScope onSubmit={onSubmit}>
        {/* LOOKUP: opções vêm da API de Bancos (outra tabela) */}
        <Controller
          control={control}
          name="codbco"
          render={({ field }) => (
            <SelectField
              label="&Banco"
              options={bancoOptions}
              value={field.value != null ? String(field.value) : undefined}
              onChange={(v) => field.onChange(Number(v))}
              placeholder="Selecione o banco…"
              error={errors.codbco?.message}
            />
          )}
        />
        <Field label="&Titular" autoFocus error={errors.titular?.message} {...register('titular')} />
        <Field label="Nº &Conta" error={errors.nroconta?.message} {...register('nroconta')} />
        <Controller
          control={control}
          name="ativo"
          render={({ field }) => (
            <SelectField
              label="&Ativo"
              options={ATIVO_OPCOES}
              value={field.value ?? 'S'}
              onChange={field.onChange}
            />
          )}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="submit" style={{ display: 'none' }} aria-hidden />
          <Button label="&Gravar" onClick={onSubmit} />
          <Button label="&Sair" variant="ghost" onClick={() => navigate('/cadastro/contas-bancarias')} />
        </div>
      </FormScope>
    </div>
  );
}
