import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { SpedArquivo, fmtData, soDigitos } from './sped-writer';

type AnyDB = Kysely<any>;

/** COD_VER (versão do leiaute) por período — aproximado (o fisco mantém a tabela oficial; refinar por período).
 *  Fiel ao GetVersaoLeiaute do legado (deriva do ano de DT_INI). 2020+ = layout mais recente do EFD-Contribuições. */
function codVersao(dtini: string): string {
  const ano = Number(String(dtini).slice(0, 4)) || 0;
  if (ano <= 2011) return '001';
  if (ano <= 2017) return '003';
  if (ano === 2018) return '004';
  if (ano === 2019) return '005';
  return '006';
}

/**
 * SPED EFD-Contribuições (PIS/COFINS) — SCAFFOLD corte-1: motor escritor + BLOCO 0 (identificação/estabelecimentos)
 * + BLOCO 9 (totalizador). O legado escreve via ACBr; aqui construímos ao padrão SPED público. O BLOCO C (documentos)
 * e o BLOCO M (apuração) são o corte-2; a SAÍDA de VAREJO (cupons/ReduçãoZ do PDV) é PDV-DEPENDENTE e ainda não
 * migrada — por isso o arquivo é PARCIAL/não-transmissível (só o envelope + cadastros). Escopo por empresa (tenant).
 */
@Injectable()
export class SpedEfdContribuicoesService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(dtini: string, dtfim: string): Promise<{ arquivo: string; linhas: number; estabelecimentos: number; parcial: true; aviso: string }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;

    const empresa = (await db
      .selectFrom('empresas')
      .select(['razao_social', 'cnpj', 'insc', 'uf', 'idcidade', 'classfiscal'])
      .where('idempresa', '=', emp)
      .executeTakeFirst()) as { razao_social?: string; cnpj?: string; insc?: string; uf?: string; idcidade?: number; classfiscal?: string } | undefined;
    if (!empresa) throw new BusinessRuleError('EMPRESA_NAO_ENCONTRADA', { idempresa: emp });

    const cnpj = soDigitos(empresa.cnpj);
    const raiz = cnpj.slice(0, 8);
    const arq = new SpedArquivo();

    // 0000 — identificação: COD_VER|TIPO_ESCRIT(0=original)|IND_SIT_ESP|NUM_REC_ANTERIOR|DT_INI|DT_FIN|NOME|CNPJ|UF|COD_MUN|SUFRAMA|IND_NAT_PJ(00)|IND_ATIV(1)
    arq.add('0000', [codVersao(dtini), '0', '', '', fmtData(dtini), fmtData(dtfim), empresa.razao_social ?? '', cnpj, empresa.uf ?? '', empresa.idcidade != null ? String(empresa.idcidade) : '', '', '00', '1']);
    // 0001 — abertura do bloco 0 (0=com dados).
    arq.add('0001', ['0']);
    // 0110 — regime de apuração: LR → não-cumulativo (COD_INC_TRIB=1); senão cumulativo (2). (Refinável por config.)
    const naoCumulativo = String(empresa.classfiscal ?? '') === 'LR';
    arq.add('0110', [naoCumulativo ? '1' : '2', naoCumulativo ? '1' : '', naoCumulativo ? '0' : '', '']);
    // 0140 — estabelecimentos que compartilham a RAIZ do CNPJ (fiel ao loop por SubStr(CNPJ,1,x) do legado).
    const estabs = (await db
      .selectFrom('empresas')
      .select(['idempresa', 'razao_social', 'cnpj', 'insc', 'im', 'uf', 'idcidade'])
      .where(sql`substr(coalesce(cnpj,''),1,8)`, '=', raiz)
      .orderBy('idempresa')
      .execute()) as Array<{ idempresa: number; razao_social?: string; cnpj?: string; insc?: string; im?: string; uf?: string; idcidade?: number }>;
    // 0140: COD_EST|NOME|CNPJ|UF|IE|COD_MUN|IM|SUFRAMA (fold auditoria [BAIXA]: IM vinha sempre vazio).
    for (const e of estabs) {
      arq.add('0140', [String(e.idempresa), e.razao_social ?? '', soDigitos(e.cnpj), e.uf ?? '', e.insc ?? '', e.idcidade != null ? String(e.idcidade) : '', e.im ?? '', '']);
    }
    arq.fecharBloco('0990', '0');

    const arquivo = arq.gerar();
    return {
      arquivo,
      linhas: arquivo.trimEnd().split('\r\n').length,
      estabelecimentos: estabs.length,
      parcial: true,
      aviso: 'PARCIAL: só bloco 0 (cadastros) + bloco 9 (totalizador). Blocos C (documentos) e M (apuração) = corte-2; a saída de varejo (cupons/ReduçãoZ do PDV) ainda não foi migrada.',
    };
  }
}
