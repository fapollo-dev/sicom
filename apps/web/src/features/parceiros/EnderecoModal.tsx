import { useState } from 'react';
import { Modal } from '@apollosg/design-system';
import { UFS, type EnderecoParceiroDto } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { useMensagem } from '../../shared/mensagem';
import { buscarCep } from './parceirosApi';

/**
 * UF do endereço é a SIGLA de 2 letras (o `zUf` do schema valida sigla, não o iduf).
 * Por isso o select usa a sigla como value (≠ `UF_OPCOES`, que usa o iduf numérico).
 */
const UF_SIGLA_OPCOES = UFS.map((u) => ({ value: u.sigla, label: `${u.sigla} — ${u.nome}` }));

/** Tipo de pessoa do master (TIPOFJ) — define a máscara de documento. */
export type TipoFj = 'F' | 'J' | 'R' | 'G' | 'E';

/** F/R = pessoa física → CPF; J/G/E = jurídica → CNPJ. */
const ehFisica = (t?: TipoFj) => t === 'F' || t === 'R';

/** máscara dinâmica de documento conforme o tipofj (display; validação é do schema). */
function mascaraDoc(valor: string, tipo?: TipoFj): string {
  const d = valor.replace(/\D/g, '');
  if (ehFisica(tipo)) {
    // CPF 000.000.000-00
    return d
      .slice(0, 11)
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
  }
  // CNPJ 00.000.000/0000-00
  return d
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, '$1.$2.$3/$4-$5');
}

interface Props {
  /** endereço a EDITAR (vem do field array) ou undefined p/ ADICIONAR um novo. */
  inicial?: EnderecoParceiroDto;
  /** tipofj do master — máscara CPF/CNPJ dinâmica + rótulo do campo de documento. */
  tipofj?: TipoFj;
  /**
   * Parceiro ESTRANGEIRO (master `estrangeiro === 'S'`). Legado: "parceiro estrangeiro →
   * impossível consulta aos Correios" — bloqueia o autofill de CEP (onBlur) e sinaliza
   * com uma dica no campo. O CEP segue digitável manualmente.
   */
  estrangeiro?: boolean;
  onFechar: () => void;
  /** devolve o endereço pronto ao pai (que faz append/update no useFieldArray). */
  onConfirmar: (endereco: EnderecoParceiroDto) => void;
}

/** endereço em branco (defaults do schema: padrão='N', ativado='S'). */
const ENDERECO_VAZIO: EnderecoParceiroDto = {
  endereco_padrao: 'N',
  ativado: 'S',
};

/**
 * Modal de ADICIONAR/EDITAR um endereço do parceiro (PARCEIROS_END). Form LOCAL e
 * controlado — só ao "Salvar" o endereço sobe pro pai (append/update no field array),
 * aparecendo imediatamente no grid. O documento fiscal (CNPJ/CPF) e RG/IE moram aqui
 * (achado da recon). CEP no blur → proxy de CEP → autofill (erro PT via useMensagem).
 * A validação de formato (CPF/CNPJ/CEP/UF/telefone) é do `parceiroSchema` no submit
 * do master; aqui só montamos o registro.
 */
export function EnderecoModal({ inicial, tipofj, estrangeiro, onFechar, onConfirmar }: Props) {
  const mensagem = useMensagem();
  const [end, setEnd] = useState<EnderecoParceiroDto>(inicial ?? ENDERECO_VAZIO);
  const [buscandoCep, setBuscandoCep] = useState(false);

  const set = <K extends keyof EnderecoParceiroDto>(k: K, v: EnderecoParceiroDto[K]) =>
    setEnd((e) => ({ ...e, [k]: v }));

  // CEP no blur → autofill endereco/bairro/cidade/uf/idcidade (proxy do legado).
  // Parceiro estrangeiro: consulta aos Correios é impossível → autofill bloqueado.
  const onBlurCep = async () => {
    if (estrangeiro) return; // estrangeiro → sem consulta de CEP (legado)
    const cep = (end.cep ?? '').replace(/\D/g, '');
    if (cep.length !== 8) return; // valida formato só no submit; aqui só dispara se completo
    setBuscandoCep(true);
    try {
      const r = await buscarCep(cep);
      setEnd((e) => ({
        ...e,
        endereco: r.endereco || e.endereco,
        bairro: r.bairro || e.bairro,
        cidade: r.cidade || e.cidade,
        uf: r.uf || e.uf,
        idcidade: r.idcidade ?? e.idcidade,
      }));
    } catch (erro) {
      mensagem.erro(erro); // CEP inválido/não-encontrado → mensagem PT do proxy
    } finally {
      setBuscandoCep(false);
    }
  };

  const docLabel = ehFisica(tipofj) ? 'CP&F' : 'CN&PJ';

  return (
    <Modal
      open
      onClose={onFechar}
      size="lg"
      title={inicial ? 'Editar endereço' : 'Adicionar endereço'}
      description={
        estrangeiro
          ? 'Parceiro estrangeiro · consulta de CEP indisponível · Esc fecha'
          : 'CEP preenche o endereço automaticamente · Esc fecha'
      }
      primaryAction={{ label: 'Salvar', onClick: () => onConfirmar(end) }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
        <div className="flex flex-col gap-gp-xs">
          <Field
            label="&CEP"
            value={end.cep ?? ''}
            inputMode="numeric"
            disabled={buscandoCep}
            onChange={(e) => set('cep', e.target.value)}
            onBlur={onBlurCep}
          />
          {estrangeiro && (
            <small className="text-fg-muted">
              Parceiro estrangeiro: consulta automática de CEP desabilitada.
            </small>
          )}
        </div>
        <Field
          label="&Logradouro"
          value={end.endereco ?? ''}
          onChange={(e) => set('endereco', e.target.value)}
        />

        <Field
          label="&Número"
          value={end.numero ?? ''}
          onChange={(e) => set('numero', e.target.value)}
        />
        <Field
          label="Comple&mento"
          value={end.complemento ?? ''}
          onChange={(e) => set('complemento', e.target.value)}
        />

        <Field
          label="&Bairro"
          value={end.bairro ?? ''}
          onChange={(e) => set('bairro', e.target.value)}
        />
        <Field
          label="C&idade"
          value={end.cidade ?? ''}
          onChange={(e) => set('cidade', e.target.value)}
        />

        <SelectField
          label="&UF"
          options={UF_SIGLA_OPCOES}
          value={end.uf ?? undefined}
          onChange={(v) => set('uf', v || undefined)}
          placeholder="Selecione…"
        />
        <Field
          label={docLabel}
          value={mascaraDoc(end.cnpj_cpf ?? '', tipofj)}
          inputMode="numeric"
          onChange={(e) => set('cnpj_cpf', e.target.value.replace(/\D/g, ''))}
        />

        <Field
          label="&RG / IE"
          value={end.rg_insc ?? ''}
          onChange={(e) => set('rg_insc', e.target.value)}
        />
        <Field
          label="&Telefone"
          value={end.telefone ?? ''}
          inputMode="tel"
          onChange={(e) => set('telefone', e.target.value)}
        />

        <Field
          label="C&elular"
          value={end.celular ?? ''}
          inputMode="tel"
          onChange={(e) => set('celular', e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-gp-lg sm:col-span-2">
          <CheckboxField
            label="Endereço &padrão"
            value={end.endereco_padrao}
            onChange={(v) => set('endereco_padrao', v)}
          />
          <CheckboxField
            label="&Ativado"
            value={end.ativado}
            onChange={(v) => set('ativado', v)}
          />
        </div>
      </div>
    </Modal>
  );
}
