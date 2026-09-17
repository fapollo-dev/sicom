import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ConfIntegBancariaDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * CONFIGURAÇÃO DA INTEGRAÇÃO BANCÁRIA — BOLETO (`FRMCONFINTEGBANCARIA`). **50 acessos, 3 operadores.**
 * Migration 236. A tabela veio com o CNAB (migration 153); faltava a tela.
 *
 * É o que o CNAB de cobrança lê para montar a remessa: banco, conta, layout, convênio e o sequencial do
 * próximo arquivo. No cliente são **3 configurações**, a última alterada em **02/07/2025** — uma por
 * empresa/conta, duas no Itaú (`C400`) e uma no Banco do Brasil.
 *
 * ⚠️ **`SEQUENCIAREMESSA` é ESTADO, não configuração.** O `cnab-remessa.service` o incrementa a cada remessa,
 * sob lock. O legado deixa editar pela tela, e nós também (cópia fiel) — mas quem baixar o número faz o banco
 * receber dois arquivos com o mesmo sequencial, e a remessa é rejeitada. A tela avisa.
 *
 * ⚠️ **`CODBCO` é o código INTERNO** (`BANCOS.CODBANCO`, ex. 526 = Itaú aqui) e **`CODFORNBCO` é o FEBRABAN**
 * ('341', '001'). São dois números diferentes para o mesmo banco, e trocá-los gera remessa que o banco não lê.
 */
@Injectable()
export class ConfIntegBancariaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async listar(): Promise<Array<Record<string, unknown>>> {
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    return (await sql<Record<string, unknown>>`
      SELECT c.*, b.banco AS nome_banco, e.fantasia AS nome_empresa
        FROM conf_integ_bancaria c
        LEFT JOIN bancos b   ON b.codbco = c.codbco
        -- ⚠️ no destino a PK de "empresas" é "idempresa" (o "CODEMPRESA" do legado, digitado)
        LEFT JOIN empresas e ON e.idempresa = c.codempresa
       ORDER BY c.codempresa, c.codbco
    `.execute(db)).rows;
  }

  async criar(dto: ConfIntegBancariaDto, operador: number | null): Promise<{ codconf: number }> {
    this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      await this.validar(trx, dto, null);
      const r = (await sql<{ codconf: number }>`
        INSERT INTO conf_integ_bancaria
          (codempresa, codbco, agencia, nrconta, codfornbco, arqteste, layoutremessa, codempresa_arquivo,
           dias_baixa_boleto, tipo_integ_bancaria, identempresabco, sequenciaremessa, obs_boleto,
           iniciais_arquivo, nosso_numero_inicial, habilitar_bolecode, usultalteracao, dtultimalteracao)
        VALUES (${dto.codempresa}, ${dto.codbco}, ${dto.agencia ?? null}, ${dto.nrconta ?? null},
                ${dto.codfornbco ?? null}, ${dto.arqteste}, ${dto.layoutremessa},
                ${dto.codempresa_arquivo ?? null}, ${dto.dias_baixa_boleto ?? null},
                ${dto.tipo_integ_bancaria}, ${dto.identempresabco ?? null}, ${dto.sequenciaremessa},
                ${dto.obs_boleto ?? null}, ${dto.iniciais_arquivo ?? null},
                ${dto.nosso_numero_inicial ?? null}, ${dto.habilitar_bolecode}, ${operador}, now())
        RETURNING codconf
      `.execute(trx)).rows[0];
      return { codconf: Number(r.codconf) };
    });
  }

  async atualizar(codconf: number, dto: ConfIntegBancariaDto, operador: number | null): Promise<{ codconf: number }> {
    this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      await this.validar(trx, dto, codconf);
      const r = await sql`
        UPDATE conf_integ_bancaria
           SET codempresa = ${dto.codempresa}, codbco = ${dto.codbco}, agencia = ${dto.agencia ?? null},
               nrconta = ${dto.nrconta ?? null}, codfornbco = ${dto.codfornbco ?? null},
               arqteste = ${dto.arqteste}, layoutremessa = ${dto.layoutremessa},
               codempresa_arquivo = ${dto.codempresa_arquivo ?? null},
               dias_baixa_boleto = ${dto.dias_baixa_boleto ?? null},
               tipo_integ_bancaria = ${dto.tipo_integ_bancaria},
               identempresabco = ${dto.identempresabco ?? null},
               sequenciaremessa = ${dto.sequenciaremessa}, obs_boleto = ${dto.obs_boleto ?? null},
               iniciais_arquivo = ${dto.iniciais_arquivo ?? null},
               nosso_numero_inicial = ${dto.nosso_numero_inicial ?? null},
               habilitar_bolecode = ${dto.habilitar_bolecode},
               usultalteracao = ${operador}, dtultimalteracao = now()
         WHERE codconf = ${codconf}
      `.execute(trx);
      if (!Number(r.numAffectedRows ?? 0)) throw new BusinessRuleError('CONF_BANCARIA_NAO_ENCONTRADA', { codconf });
      return { codconf };
    });
  }

  /**
   * ⚠️ a configuração de uma empresa que **já gerou remessa** não é apagada.
   *
   * A guarda é conservadora de propósito: `arquivo_remessa_areceber` guarda `codempresa` e
   * `codcontacorrente`, **não** o `codconf` — então não dá para saber com precisão qual configuração gerou
   * qual arquivo. Diante disso, a escolha é barrar por empresa: apagar a configuração de quem já emitiu
   * boleto deixaria o histórico sem dizer com que conta, layout e convênio aquele arquivo foi montado.
   */
  async excluir(codconf: number): Promise<{ codconf: number }> {
    this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    const existe = (await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM conf_integ_bancaria WHERE codconf = ${codconf}
    `.execute(db)).rows[0];
    if (!Number(existe?.n)) throw new BusinessRuleError('CONF_BANCARIA_NAO_ENCONTRADA', { codconf });
    const usos = (await sql<{ n: number }>`
      SELECT count(*)::int AS n
        FROM arquivo_remessa_areceber r
        JOIN conf_integ_bancaria c ON c.codempresa = r.codempresa
       WHERE c.codconf = ${codconf}
    `.execute(db)).rows[0];
    if (Number(usos?.n) > 0) throw new BusinessRuleError('CONF_BANCARIA_EM_USO', { codconf, remessas: Number(usos.n) });
    await sql`DELETE FROM conf_integ_bancaria WHERE codconf = ${codconf}`.execute(db);
    return { codconf };
  }

  private async validar(trx: AnyDB, dto: ConfIntegBancariaDto, codconf: number | null): Promise<void> {
    // `edtCODBCOExit` :143 — 'Banco não encontrado com o Código informado. Verifique!'
    const bco = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM bancos WHERE codbco = ${dto.codbco}`.execute(trx)).rows[0];
    if (!Number(bco?.n)) throw new BusinessRuleError('BANCO_NAO_ENCONTRADO', { codbco: dto.codbco });
    // `edtCodEmpresaExit` :178 — 'Empresa não encontrada!'
    for (const e of [dto.codempresa, dto.codempresa_arquivo].filter((x): x is number => x != null)) {
      const r = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM empresas WHERE idempresa = ${e}`.execute(trx)).rows[0];
      if (!Number(r?.n)) throw new BusinessRuleError('EMPRESA_NAO_ENCONTRADA', { codempresa: e });
    }
    // ⚠️ duas configurações para a mesma empresa+conta+tipo fariam o CNAB escolher uma delas em silêncio
    const dup = (await sql<{ codconf: number }>`
      SELECT codconf FROM conf_integ_bancaria
       WHERE codempresa = ${dto.codempresa} AND codbco = ${dto.codbco}
         AND coalesce(nrconta, '') = coalesce(${dto.nrconta ?? null}, '')
         AND tipo_integ_bancaria = ${dto.tipo_integ_bancaria}
         AND (${codconf}::int IS NULL OR codconf <> ${codconf}::int)
    `.execute(trx)).rows[0];
    if (dup) throw new BusinessRuleError('CONF_BANCARIA_DUPLICADA', { codconf: Number(dup.codconf) });
  }
}
