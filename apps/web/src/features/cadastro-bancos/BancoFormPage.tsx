import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useParams } from 'react-router-dom';
import { bancoSchema, type CriarBancoDto } from '@apollo/shared';
import { FormScope } from '../../shared/keyboard';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useBanco, useCriarBanco, useAtualizarBanco } from './hooks';

/** Form de Banco (placeholder do FormField do DS). Enter-avança + mnemônicos (ADR-010). */
export function BancoFormPage() {
  const navigate = useNavigate();
  const params = useParams();
  const isNew = params.codbco === 'novo';
  const codbco = isNew ? undefined : Number(params.codbco);

  const { data: existente } = useBanco(codbco);
  const criar = useCriarBanco();
  const atualizar = useAtualizarBanco(codbco ?? 0);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CriarBancoDto>({ resolver: zodResolver(bancoSchema) });

  useEffect(() => {
    if (existente) {
      reset({
        banco: existente.banco,
        cidade: existente.cidade,
        agencia: existente.agencia ?? undefined,
        agenciaCedente: existente.agenciaCedente ?? undefined,
        codbcoblt: existente.codbcoblt ?? undefined,
        convenio: existente.convenio ?? undefined,
        carteiraCobranca: existente.carteiraCobranca ?? undefined,
        variacaoCarteira: existente.variacaoCarteira ?? undefined,
      });
    }
  }, [existente, reset]);

  const onSubmit = handleSubmit(async (dto) => {
    if (isNew) await criar.mutateAsync(dto);
    else await atualizar.mutateAsync(dto);
    navigate('/cadastro/bancos');
  });

  const numberReg = (name: keyof CriarBancoDto) =>
    register(name, { setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)) });

  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <h1>{isNew ? 'Novo Banco' : `Banco ${codbco}`}</h1>
      <FormScope onSubmit={onSubmit}>
        <Field label="&Banco" autoFocus error={errors.banco?.message} {...register('banco')} />
        <Field label="&Cidade" error={errors.cidade?.message} {...register('cidade')} />
        <Field label="&Agência" {...register('agencia')} />
        <Field label="Agência Ce&dente" type="number" {...numberReg('agenciaCedente')} />
        <Field label="Cód. Banco (&boletos)" type="number" {...numberReg('codbcoblt')} />
        <Field label="Con&vênio" type="number" {...numberReg('convenio')} />
        <Field label="Carteira Cob&rança" type="number" {...numberReg('carteiraCobranca')} />
        <Field label="Variação Car&teira" type="number" {...numberReg('variacaoCarteira')} />
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="submit" style={{ display: 'none' }} aria-hidden />
          <Button label="&Gravar" onClick={onSubmit} />
          <Button label="&Sair" variant="ghost" onClick={() => navigate('/cadastro/bancos')} />
        </div>
      </FormScope>
    </div>
  );
}
