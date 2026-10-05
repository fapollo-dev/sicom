import type { Kysely } from 'kysely';
import { BusinessRuleError } from '../errors/app-error';
import { modeloFr3 } from './modelo-fr3';
import { registroFr3 } from './registro-fr3';

type AnyDB = Kysely<any>;
type Linha = Record<string, unknown>;

/** o filtro comum das telas do `TFrmRelMaster`: o período e as lojas do `GetMultiEmpresa` */
export interface FiltroMestre { dataIni: string; dataFim: string; empresas?: number[] | null }

/**
 * A impressão das telas que herdam o `TFrmRelMaster` (URelMaster.pas — RelCaixa, RelCompras, DRE contábil, perdas, cortesias, funcionário,
 * DDE, análise de comportamento, análise pedido × NF, histórico do PDV, troca de mercadoria): `GeraRelatorio` carrega
 * `Relatorios\<NomeRelatorio da classe>` com três datasets fixos — `DBDRelatorio` (o QryRelatorio, o `GetSQL` da classe), `DbdAuxiliar` (o
 * QryAuxiliar, o `GetSQLAuxiliar`) e `DBDVariaveisAdicionais` (o MemVariaveisAdicionais: IDEmpresas no formato do `GetMultiEmpresa`
 * — "1,2" —, DataInicial, DataFinal, NiveisExpandidos, Tabela e os campos que a subclasse acrescenta) — mais os conjuntos próprios da tela.
 * Sem registro (`ValidarExistenciaRegistros`): "Não foram encontrados registros para imprimir o relatório.".
 */
export async function relatorioMestre(db: AnyDB, o: {
  arquivo: string;
  titulo: string;
  /** a tela já decidiu (a apuração do caixa olha mais de um conjunto); sem isto, vale o DBDRelatorio vazio */
  vazio?: boolean;
  relatorio: Linha[];
  auxiliar?: Linha[];
  variaveis: { empresas: number[]; dataIni: string; dataFim: string; niveis?: number; tabela?: number; extras?: Record<string, unknown> };
  extras?: Record<string, Linha[]>;
}) {
  if (o.vazio ?? !o.relatorio.length) throw new BusinessRuleError('RELATORIO_SEM_REGISTROS', {}, 'Não foram encontrados registros para imprimir o relatório.');
  const dia = (s: string) => `${s.slice(0, 10)}T00:00:00`;
  const v = o.variaveis;
  return {
    titulo: o.titulo,
    modelo: await modeloFr3(db, o.arquivo),
    datasets: {
      DBDRelatorio: o.relatorio.map((r) => registroFr3(r)),
      DbdAuxiliar: (o.auxiliar ?? []).map((r) => registroFr3(r)),
      DBDVariaveisAdicionais: [{
        IDEmpresas: v.empresas.join(','), DataInicial: dia(v.dataIni), DataFinal: dia(v.dataFim), NiveisExpandidos: v.niveis ?? 0, Tabela: v.tabela ?? 0,
        ...(v.extras ?? {}),
      }],
      ...Object.fromEntries(Object.entries(o.extras ?? {}).map(([k, rows]) => [k, rows.map((r) => registroFr3(r))])),
    },
  };
}
