/**
 * UFs do Brasil (referência fixa) — `iduf` = código IBGE (confere com a tabela UF do
 * legado: RO=11 … DF=53). Usado como LOOKUP do campo `iduf` (mostra a SIGLA, não o
 * número cru). Reference data fixa → não precisa de tabela/endpoint.
 */
export interface Uf {
  iduf: number;
  sigla: string;
  nome: string;
}

export const UFS: Uf[] = [
  { iduf: 11, sigla: 'RO', nome: 'Rondônia' },
  { iduf: 12, sigla: 'AC', nome: 'Acre' },
  { iduf: 13, sigla: 'AM', nome: 'Amazonas' },
  { iduf: 14, sigla: 'RR', nome: 'Roraima' },
  { iduf: 15, sigla: 'PA', nome: 'Pará' },
  { iduf: 16, sigla: 'AP', nome: 'Amapá' },
  { iduf: 17, sigla: 'TO', nome: 'Tocantins' },
  { iduf: 21, sigla: 'MA', nome: 'Maranhão' },
  { iduf: 22, sigla: 'PI', nome: 'Piauí' },
  { iduf: 23, sigla: 'CE', nome: 'Ceará' },
  { iduf: 24, sigla: 'RN', nome: 'Rio Grande do Norte' },
  { iduf: 25, sigla: 'PB', nome: 'Paraíba' },
  { iduf: 26, sigla: 'PE', nome: 'Pernambuco' },
  { iduf: 27, sigla: 'AL', nome: 'Alagoas' },
  { iduf: 28, sigla: 'SE', nome: 'Sergipe' },
  { iduf: 29, sigla: 'BA', nome: 'Bahia' },
  { iduf: 31, sigla: 'MG', nome: 'Minas Gerais' },
  { iduf: 32, sigla: 'ES', nome: 'Espírito Santo' },
  { iduf: 33, sigla: 'RJ', nome: 'Rio de Janeiro' },
  { iduf: 35, sigla: 'SP', nome: 'São Paulo' },
  { iduf: 41, sigla: 'PR', nome: 'Paraná' },
  { iduf: 42, sigla: 'SC', nome: 'Santa Catarina' },
  { iduf: 43, sigla: 'RS', nome: 'Rio Grande do Sul' },
  { iduf: 50, sigla: 'MS', nome: 'Mato Grosso do Sul' },
  { iduf: 51, sigla: 'MT', nome: 'Mato Grosso' },
  { iduf: 52, sigla: 'GO', nome: 'Goiás' },
  { iduf: 53, sigla: 'DF', nome: 'Distrito Federal' },
];

/** opções {value,label} para SelectField (value = iduf como string, label = sigla — nome). */
export const UF_OPCOES = UFS.map((u) => ({ value: String(u.iduf), label: `${u.sigla} — ${u.nome}` }));
