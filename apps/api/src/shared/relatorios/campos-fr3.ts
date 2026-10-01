/**
 * Os campos de um dataset que um .fr3 usa — para saber se o Apollo fornece tudo o que o layout imprime. Lê o `DataField` dos
 * objetos ligados ao dataset, as expressões dos textos/condições e o script SEM os comentários (os layouts do hub de vendas têm
 * blocos inteiros entre `{ }` que referenciam campos que a consulta não tem).
 */
export function camposDoDataset(xml: string, dataset: string): Set<string> {
  const ds = dataset.toLowerCase();
  const desfazer = (s: string) => s.replace(/&#34;/g, '"').replace(/&#60;/g, '<').replace(/&#62;/g, '>').replace(/&#38;/g, '&').replace(/&#13;&#10;/g, '\n')
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const campos = new Set<string>();
  const ler = (texto: string) => {
    for (const m of texto.matchAll(/(\w+)\."(\w+)"/g)) if (m[1].toLowerCase() === ds) campos.add(m[2].toUpperCase());
  };
  for (const tag of xml.matchAll(/<Tfrx\w+ ([^>]*)>/g)) {
    const a = tag[1];
    const dsn = /DataSetName="([^"]*)"/.exec(a)?.[1];
    const df = /DataField="([^"]*)"/.exec(a)?.[1];
    if (dsn && df && dsn.toLowerCase() === ds) campos.add(df.toUpperCase());
    for (const m of a.matchAll(/(?:\bText|Expression|Condition)="([^"]*)"/g)) ler(desfazer(m[1]));
  }
  const script = /ScriptText\.Text="([^"]*)"/.exec(xml)?.[1];
  if (script) ler(desfazer(script).replace(/\{[^}]*\}/g, ' ').replace(/\(\*[\s\S]*?\*\)/g, ' ').replace(/\/\/[^\n]*/g, ' '));
  return campos;
}
