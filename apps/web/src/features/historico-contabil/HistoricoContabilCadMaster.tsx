import { Controller } from 'react-hook-form';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { SelectField } from '../../shared/ui/SelectField';
import { TextArea } from '../../shared/ui/TextArea';
import { contarCoringas, historicoContabilSchema, montarDeschist, type HistoricoContabilDto } from '@apollo/shared';

/**
 * CADASTRO DE HISTÓRICO CONTÁBIL (`FRMCADHISTORICOCONTABIL`, `uCadHistoricoContabil.pas`).
 *
 * O texto que o razão imprime em cada lançamento. Cada `*` é um buraco que a contabilização preenche **na
 * ordem** — é por isso que a tela mostra, abaixo do campo, como o texto vai sair: trocar a ordem dos `*` troca
 * o que aparece no livro, e o erro só apareceria depois, no razão.
 *
 * A simulação usa a MESMA função que a API usa para escrever (`montarDeschist`, pacote compartilhado): número
 * vira nove dígitos com zeros à esquerda, texto vai cru.
 */
const EXEMPLOS = ['90886', 'ALELO ALIMENTACA - CODREDE 5', 130582, 'LETICIA ADM', 'BOLETO', 'BANCO ITAU S/A'];

export function HistoricoContabilCadMaster() {
  return (
    <CadMaster<HistoricoContabilDto>
      titulo="Histórico contábil"
      resourcePath="cadastro/historico-contabil"
      pk="codhistcontabil"
      pkGerada
      colunasPesquisa={[
        { campo: 'codhistcontabil', label: 'Código', tipo: 'text', largura: 100 },
        { campo: 'deschist', label: 'Histórico', tipo: 'text' },
        { campo: 'coringas', label: 'Buracos', tipo: 'text', largura: 90 },
        { campo: 'status', label: 'Ativo', tipo: 'text', largura: 80 },
      ]}
      schema={historicoContabilSchema}
      defaultValues={{ deschist: '', status: 'S' }}
      campos={({ form, editavel }) => {
        const texto = form.watch('deschist') ?? '';
        const n = contarCoringas(texto);
        return (
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
            <div className="sm:col-span-2">
              <TextArea
                label="&Histórico"
                disabled={!editavel}
                error={form.formState.errors.deschist?.message as string | undefined}
                {...form.register('deschist')}
              />
              <p className="mt-gp-xs text-body-sm text-fg-muted">
                Cada <code>*</code> é preenchido pela contabilização, na ordem. Este histórico tem{' '}
                <strong>{n}</strong> {n === 1 ? 'buraco' : 'buracos'}.
              </p>
              {n > 0 && (
                <p className="mt-gp-xs text-body-sm">
                  <span className="text-fg-muted">Sairia assim: </span>
                  <span className="font-mono">{montarDeschist(texto, EXEMPLOS.slice(0, n))}</span>
                </p>
              )}
            </div>
            <Controller
              control={form.control}
              name="status"
              render={({ field }) => (
                <SelectField
                  label="&Ativo"
                  options={[{ value: 'S', label: 'Sim' }, { value: 'N', label: 'Não' }]}
                  value={field.value ?? 'S'}
                  onChange={field.onChange}
                  error={form.formState.errors.status?.message as string | undefined}
                />
              )}
            />
          </div>
        );
      }}
    />
  );
}
