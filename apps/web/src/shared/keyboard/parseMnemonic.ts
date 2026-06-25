/**
 * Extrai o mnemônico `&` de um caption (ADR-010), no estilo VCL/Delphi.
 *  - `&X`  → letra mnemônica X (Alt+X)
 *  - `&&`  → literal `&`
 *  - sem `&` → sem mnemônico
 * Espelha o `&` extraído do `.dfm` (delphi-anatomy.md / keyboard-ux-layer.md).
 */
export interface Mnemonic {
  /** texto sem os `&` de controle */
  text: string;
  /** letra do acelerador (minúscula) ou null */
  key: string | null;
  /** índice (em `text`) da letra sublinhada, ou -1 */
  index: number;
}

export function parseMnemonic(label: string): Mnemonic {
  let text = '';
  let key: string | null = null;
  let index = -1;
  for (let i = 0; i < label.length; i++) {
    const ch = label[i];
    if (ch === '&') {
      const next = label[i + 1];
      if (next === '&') {
        text += '&';
        i++;
        continue;
      }
      if (next !== undefined && key === null) {
        index = text.length;
        key = next.toLowerCase();
        text += next;
        i++;
        continue;
      }
    }
    text += ch;
  }
  return { text, key, index };
}
