import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { montarRelatorioGeral, type OpcoesRelatorioGeral } from '../src/modules/relatorios/relatorio-geral-fr3';

const modelo = (n: string) => readFileSync(resolve(__dirname, 'fixtures', n), 'utf8');
const base: OpcoesRelatorioGeral = {
  titulo: 'CONTAS PAGAS NO MES', paisagem: false, quebraPagina: false, somenteAgrupamento: false,
  colunas: [
    { campo: 'C0', origem: 'FORNECEDOR', titulo: 'Fornecedor', tamanho: 30, tipo: 'texto', totalizar: false },
    { campo: 'C1', origem: 'VENCIMENTO', titulo: 'Vencimento', tamanho: 12, tipo: 'data', totalizar: false },
    { campo: 'C2', origem: 'VALOR', titulo: 'Valor', tamanho: 12, tipo: 'decimal', totalizar: true },
  ],
  grupo: [], tamanhoCampoGrupo: 0, textoWhere: 'Data Pagamento: 01/09/2026 à 30/09/2026', empresa: { fantasia: 'HIPER', logradouro: 'RUA A - CENTRO - UBERLANDIA - MG - 123' }, totalRegistros: 2,
};

describe('MontaRelatorio do construtor (relatorio-geral-fr3)', () => {
  it('sem grupo: título/campo/soma de cada coluna nas bandas do legado, a largura TAMANHO × 6,5 (+20 na totalizada), o where e o título', () => {
    const x = montarRelatorioGeral(modelo('relatoriogeral-semgrupo.fr3'), base);
    expect(x).toMatch(/<TfrxMemoView Name="MemoTitulo0" Left="0" Top="-4" Width="195" Height="16"/);
    expect(x).toContain('Name="MemoCampo2" Left="');
    expect(x).toMatch(/Name="MemoCampo2"[^>]*Width="98"[^>]*DisplayFormat.FormatStr="%2.2n"[^>]*HAlign="haRight"/);
    expect(x).toMatch(/Name="MemoCampo1"[^>]*DisplayFormat.FormatStr="dd\/mm\/yyyy"[^>]*HideZeros="True"/);
    expect(x).toContain('Text="[SUM(&#60;frxDBDatasetDados.&#34;C2&#34;&#62;,MasterDataDados)]"');
    expect(x).toContain('Name="MemoCabecalho_where"');
    expect(x).toContain('Text="CONTAS PAGAS NO MES"');
    expect(x).toContain('Text="Total de Registros: 2"');
    expect(x).toContain('Text="HIPER"');
    expect(x).toMatch(/PaperWidth="210"/);
  });

  it('com grupo: a Condition concatenada, o cabeçalho com os valores e espaço, o rodapé do grupo com "Total:" e o SUM, a coluna do último campo do grupo fora', () => {
    const x = montarRelatorioGeral(modelo('relatoriogeral-comgrupo.fr3'), { ...base, grupo: [{ campo: 'G0', origem: 'FORNECEDOR', tipo: 'texto' }], tamanhoCampoGrupo: 60 });
    expect(x).toContain('Condition="&#60;frxDBDatasetDados.&#34;G0&#34;&#62;"');
    expect(x).toContain('Text="[(&#60;frxDBDatasetDados.&#34;G0&#34;&#62; + chr(32) )]"');
    expect(x).toContain('Name="GrooupFooterTituloTotal"');
    expect(x).toContain('Name="GrooupFooter2"');
    expect(x).not.toContain('Name="MemoTitulo0"');
  });

  it('paisagem acima de 113, e acima de 157 a mensagem do legado', () => {
    const largo = { ...base, colunas: [...base.colunas, { campo: 'C3', origem: 'OBS', titulo: 'Obs', tamanho: 70, tipo: 'texto' as const, totalizar: false }] };
    expect(montarRelatorioGeral(modelo('relatoriogeral-semgrupo.fr3'), largo)).toMatch(/PaperWidth="297"[^>]*PaperHeight="210"/);
    const demais = { ...base, colunas: [...base.colunas, { campo: 'C3', origem: 'OBS', titulo: 'Obs', tamanho: 120, tipo: 'texto' as const, totalizar: false }] };
    expect(() => montarRelatorioGeral(modelo('relatoriogeral-semgrupo.fr3'), demais)).toThrow(/ultrapassam a margem/);
  });
});
