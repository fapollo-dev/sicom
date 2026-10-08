import { useState } from 'react';
import { Field } from '../ui/Field';
import { Button } from '../ui/Button';
import { Pesquisa } from '../cadmaster/Pesquisa';

/**
 * O CAMPO DE CÓDIGOS COM A PESQUISA EM MULTISSELEÇÃO — o "códigos separados por vírgula" das telas de filtro, com o que o legado tem no
 * lugar dele: o F3 (ou o "…") abre a Pesquisa da view em multisseleção e os marcados SUBSTITUEM a lista (o `fLista.Clear` + os marcados
 * do legado). Digitar continua valendo (a lista é a mesma). `campo` = a coluna da view que vira o código (o CODIGO, o CFOP…).
 */
export function CodigosComPesquisa({ label, value, onChange, recurso, fixos, parametros, campo = 'codigo', placeholder, largura = 'w-56' }: {
  label: string;
  value: string;
  onChange: (lista: string) => void;
  recurso: string;
  fixos?: Record<string, string | number>;
  parametros?: Record<string, string | number | null | undefined>;
  campo?: string;
  placeholder?: string;
  largura?: string;
}) {
  const [aberta, setAberta] = useState(false);
  const escolher = (linhas: Array<Record<string, unknown>>) => {
    setAberta(false);
    const codigos = [...new Set(linhas.map((l) => String(l[campo] ?? '').trim()).filter((c) => c !== ''))];
    if (codigos.length) onChange(codigos.join(','));
  };
  return (
    <div className="flex items-end gap-gp-xs">
      <div className={largura}>
        <Field label={label} value={value} placeholder={placeholder ?? 'F3 pesquisa · ou códigos com vírgula'}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'F3') { e.preventDefault(); setAberta(true); } }} />
      </div>
      <Button label="…" variant="soft" onClick={() => setAberta(true)} />
      {aberta && (
        <Pesquisa resourcePath={recurso} fixos={fixos} parametros={parametros} multisselecao
          onSelecionarVarios={escolher} onSelecionar={(l) => escolher([l])} onFechar={() => setAberta(false)} />
      )}
    </div>
  );
}
