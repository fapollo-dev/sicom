import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { CriarLoteCobrancaDto } from '@apollo/shared';
import { LoteCobrancaRepository } from './lote-cobranca.repository';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { empresaParaRelatorio, registroFr3 } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;

@Injectable()
export class LotesCobrancaService {
  constructor(
    private readonly repo: LoteCobrancaRepository,
    private readonly dbp: DatabaseProvider,
  ) {}

  list() {
    return this.repo.list();
  }
  /** read da tela completa: master + RAZAO + itens com display columns + juros/total. */
  read(cod: number) {
    return this.repo.readEnriched(cod);
  }
  /** picker de documentos ARECEBER (tenant-scoped, fail-closed). */
  listAreceber(opts: { consiliado?: 'S' | 'N'; excluirDoLote?: number } = {}) {
    return this.repo.listAreceber(opts);
  }
  /** lookup do "Cobrador" (parceiros FUN='S'). */
  listCobradores() {
    return this.repo.listCobradores();
  }
  async criar(dto: CriarLoteCobrancaDto) {
    await this.repo.assertCobradorValido(dto.codparceiro); // FUN='S' (legado SegFornecedor)
    const cod = await this.repo.create(
      { codparceiro: dto.codparceiro, data: dto.data },
      dto.itens,
    );
    return this.repo.readEnriched(cod);
  }
  async atualizar(cod: number, dto: CriarLoteCobrancaDto) {
    await this.repo.assertCobradorValido(dto.codparceiro); // FUN='S' (legado SegFornecedor)
    await this.repo.update(cod, { codparceiro: dto.codparceiro, data: dto.data }, dto.itens);
    return this.repo.readEnriched(cod);
  }
  async excluir(cod: number) {
    await this.repo.remove(cod);
  }

  /**
   * O botão Imprimir (`UCadLoteCobranca.pas`): "Relatório geral" (`RelatrioGeral1Click`) → `Relatorios\lote_cobranca.fr3`; "Relatório
   * agrupado por bairro" (`RelatrioAgrupadopor1Click`) → `lote_cobrancaBairro.fr3`, com o `cdsITENS_LOTECOB.IndexFieldNames :=
   * 'BAIRRO;RAZAO'` (o layout agrupa por BAIRRO e CODPARCEIRO). Os datasets: `frxDBDatasetPrincipal` = o lote (`sqqLoteCobranca`: código,
   * cobrador, data, a RAZAO do cobrador), `frxDBDtsTemp` = os itens (`sqqITENS_LOTECOB` = a view GET_ITENS_LOTECOB, o JUROS/TOTAL na hora
   * da impressão) e `frxDBDtsEmpresa` = a empresa do login. O legado imprime o que está na tela (inclusive itens ainda não gravados); o
   * Apollo, o lote gravado. Sem ORDER BY no SQL, o geral sai na ordem dos itens (CODILOTCOB).
   */
  async impressao(cod: number, agrupado: 'GERAL' | 'BAIRRO') {
    const emp = currentTenant().empresaId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    const db = this.dbp.forTenantRead() as AnyDB;
    const lote = (await sql<Record<string, unknown>>`
      SELECT l.codlotecob, l.codparceiro, l.data, p.razao
        FROM lote_cobranca l LEFT JOIN parceiros p ON p.codparceiro = l.codparceiro
       WHERE l.codlotecob = ${cod}`.execute(db)).rows[0];
    if (!lote) throw new BusinessRuleError('LOTE_NAO_ENCONTRADO', { codlotecob: cod }, 'Lote de cobrança não encontrado.');
    // o índice do ClientDataSet põe o nulo primeiro
    const ordem = agrupado === 'BAIRRO' ? sql`bairro NULLS FIRST, razao NULLS FIRST, codilotcob` : sql`codilotcob`;
    const itens = (await sql<Record<string, unknown>>`
      SELECT codilotcob, codlotecob, codrcb, codparceiro, razao, dtvenda, dtvenc, duplicata, valor, txjuros, juros, total,
             endereco, bairro, cidade, uf, telefone
        FROM get_itens_lotecob WHERE codlotecob = ${cod} ORDER BY ${ordem}`.execute(db)).rows;
    const nums = new Set(['codilotcob', 'codlotecob', 'codrcb', 'codparceiro', 'valor', 'txjuros', 'juros', 'total']);
    return {
      titulo: `Lote de cobrança ${cod}`,
      modelo: await modeloFr3(db, agrupado === 'BAIRRO' ? 'lote_cobrancaBairro.fr3' : 'lote_cobranca.fr3'),
      datasets: {
        frxDBDatasetPrincipal: [registroFr3(lote, nums)],
        frxDBDtsTemp: itens.map((i) => registroFr3(i, nums)),
        frxDBDtsEmpresa: [await empresaParaRelatorio(db, emp)],
      },
    };
  }
}
