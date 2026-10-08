import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { paginasDoModelo } from '../src/shared/fr3/render';

/** os layouts PERSONALIZADOS da produção (RELATORIOS 854 e 874) do menu Imprimir da tela de perfis (uCadPerfilOperador.pas) */
const modelo = (arq: string) => readFileSync(resolve(__dirname, 'fixtures/relatorios', arq), 'utf8');
const agora = new Date(2026, 9, 8, 10, 0, 0);
const texto = (paginas: Array<{ html: string[] }>) => paginas.map((p) => p.html.join(' ')).join(' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const empresa = { RAZAOSOCIAL: 'HIPER PINHEIRAO LTDA', ENDERECO: 'RUA A', BAIRRO: 'CENTRO', CEP: '35000-000', FONE1: '3333', CIDADE: 'GV', UF: 'MG' };

describe('Tela de perfis — os relatórios do Imprimir no layout da produção', () => {
  it('"Relação perfil x operador": o perfil no cabeçalho e os operadores na lista (a lista é do FrxDBMasterDet)', () => {
    const linhas = [
      { CODOPERADOR: 23, CODPERFIL: 4, PERFIL: 'COMPRADOR GERAL', OPERADOR: 'JOAO LUCAS' },
      { CODOPERADOR: 31, CODPERFIL: 4, PERFIL: 'COMPRADOR GERAL', OPERADOR: 'VANICE' },
    ];
    const t = texto(paginasDoModelo(modelo('operadores-vinculados-perfil.fr3'), { FrxDBMaster: linhas, FrxDBMasterDet: linhas, FrxDBEmpresa: [empresa], dbdEmpresa: [empresa] }, agora));
    expect(t).toContain('Relação operadores vinculados ao perfil');
    expect(t).toContain('Perfil: COMPRADOR GERAL');
    expect(t).toMatch(/23 JOAO LUCAS/);
    expect(t).toMatch(/31 VANICE/);
    expect(t).toContain('HIPER PINHEIRAO LTDA');
  });

  it('"Relação perfil x permissões de acesso": a tela e a opção de cada permissão do perfil', () => {
    const linhas = [
      { PERFIL: 'COMPRADOR GERAL', FORM_CAPTION: 'AGENDA DE PROMOCOES', CAPTION: 'Acessar formulário' },
      { PERFIL: 'COMPRADOR GERAL', FORM_CAPTION: 'PEDIDO DE COMPRA', CAPTION: 'Gravar registro' },
    ];
    const t = texto(paginasDoModelo(modelo('permissao-vinculada-perfil.fr3'), { FrxDBMaster: linhas, FrxDBEmpresa: [empresa], dbdEmpresa: [empresa] }, agora));
    expect(t).toContain('Relatório de permissões do perfil');
    expect(t).toContain('Perfil: COMPRADOR GERAL');
    expect(t).toContain('AGENDA DE PROMOCOES');
    expect(t).toContain('Gravar registro');
  });
});
