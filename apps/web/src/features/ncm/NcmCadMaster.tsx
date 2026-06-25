import { Controller } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { DateField } from '../../shared/ui/DateField';
import { TextArea } from '../../shared/ui/TextArea';
import { ncmSchema, UN_TRIBUTADA, type CriarNcmDto } from '@apollo/shared';

/** hoje em ISO 'YYYY-MM-DD' (OnNewRecord: VIGENCIA_INICIO := today). */
const hojeISO = () => new Date().toISOString().slice(0, 10);

/**
 * Cadastro de NCM via o pilar <CadMaster> — CHAVE NATURAL (o código NCM é digitado,
 * pkGerada={false}) + palette de data (vigências), combo (unidade tributada) e memo
 * (descrição/categoria/observação).
 *
 * Divergências fiéis ao legado (uCadNCM.pas/.dfm) vs. a versão anterior:
 *  - NCMSH é DERIVADO (ConcatenaLeft(CODIGO,8,'0')) → read-only, mostrado a partir do código.
 *  - DESCRICAO obrigatória (btnGravarClick: 'Informe a descrição do NCM!').
 *  - CATEGORIA (dbmmoCategoria) e UN_TRIBUTADA (cbbUnidadeTributada) — campos do .dfm.
 *  - SEM controle de IPI (não existe no .dfm; a coluna fica só para data load).
 *  - OnNewRecord: VIGENCIA_INICIO := hoje, VIGENCIA_FIM := nulo.
 */
export function NcmCadMaster() {
  return (
    <CadMaster<CriarNcmDto>
      titulo="NCM"
      resourcePath="cadastro/ncm"
      pk="codigo"
      pkGerada={false} // chave natural: usuário digita o código NCM
      colunasPesquisa={[
        { campo: 'codigo', label: 'Código', tipo: 'text', largura: 120 },
        { campo: 'ncmsh', label: 'NCM', tipo: 'text', largura: 120 },
        { campo: 'descricao', label: 'Descrição', tipo: 'text' },
      ]}
      schema={ncmSchema}
      defaultValues={{
        descricao: '',
        categoria: '',
        observacao: '',
        vigencia_inicio: hojeISO(), // OnNewRecord: VIGENCIA_INICIO := today
        vigencia_fim: '', // OnNewRecord: VIGENCIA_FIM := null
      }}
      campos={({ form, editavel }) => {
        // NCMSH derivado p/ exibição: ConcatenaLeft(CODIGO,8,'0') (read-only, server sobrepõe).
        const codigo = form.watch('codigo');
        const ncmshDerivado =
          codigo != null && codigo !== ('' as unknown) ? String(codigo).padStart(8, '0') : '';
        return (
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
            <Field
              label="&NCM SH"
              value={ncmshDerivado}
              readOnly
              disabled
              error={form.formState.errors.ncmsh?.message as string | undefined}
            />
            <Controller
              control={form.control}
              name="un_tributada"
              render={({ field }) => (
                <SelectField
                  label="&Unidade tributada"
                  options={UN_TRIBUTADA}
                  value={field.value ?? undefined}
                  onChange={field.onChange}
                  placeholder="Selecione a unidade…"
                  error={form.formState.errors.un_tributada?.message as string | undefined}
                />
              )}
            />
            <div className="sm:col-span-2">
              <TextArea
                label="&Descrição"
                disabled={!editavel}
                error={form.formState.errors.descricao?.message as string | undefined}
                {...form.register('descricao')}
              />
            </div>
            <div className="sm:col-span-2">
              <TextArea
                label="&Categoria"
                disabled={!editavel}
                error={form.formState.errors.categoria?.message as string | undefined}
                {...form.register('categoria')}
              />
            </div>
            <Controller
              control={form.control}
              name="vigencia_inicio"
              render={({ field }) => (
                <DateField
                  label="Vigência &Início"
                  value={field.value as string | undefined}
                  onChange={field.onChange}
                  disabled={!editavel}
                />
              )}
            />
            <Controller
              control={form.control}
              name="vigencia_fim"
              render={({ field }) => (
                <DateField
                  label="Vigência &Fim"
                  value={field.value as string | undefined}
                  onChange={field.onChange}
                  disabled={!editavel}
                  error={form.formState.errors.vigencia_fim?.message as string | undefined}
                />
              )}
            />
            <div className="sm:col-span-2">
              <TextArea
                label="&Observação"
                disabled={!editavel}
                error={form.formState.errors.observacao?.message as string | undefined}
                {...form.register('observacao')}
              />
            </div>
          </div>
        );
      }}
    />
  );
}
