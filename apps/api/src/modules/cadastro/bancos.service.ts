import { Injectable } from '@nestjs/common';
import type { CriarBancoDto, AtualizarBancoDto } from '@apollo/shared';
import { BancoRepository } from './banco.repository';
import { BancoUserCols } from './banco.queries';

/**
 * Regra de negócio do Cadastro de Bancos (camada service — seção 02).
 * Espelha o contrato herdado do form-base TfrmCadMaster:
 *  - BR-01 RBAC por form+ação (PossuiAcessoForm) → agora no AcessoGuard (controller).
 *  - BR-02 obrigatórios → já garantidos pela zod (validação antes do banco).
 *  - BR-04 uppercase → já aplicado pela zod (.toUpperCase()).
 * O carimbo de auditoria e o outbox ficam no repository (efeitos), na transação.
 */
@Injectable()
export class BancosService {
  constructor(private readonly repo: BancoRepository) {}

  /** camelCase (DTO/zod) → snake_case (colunas do banco), só os campos presentes (delta). */
  private toCols(dto: AtualizarBancoDto): BancoUserCols {
    const c: BancoUserCols = {};
    if (dto.agencia !== undefined) c.agencia = dto.agencia;
    if (dto.banco !== undefined) c.banco = dto.banco;
    if (dto.cidade !== undefined) c.cidade = dto.cidade;
    if (dto.uf !== undefined) c.uf = dto.uf;
    if (dto.agenciaCedente !== undefined) c.agencia_cedente = dto.agenciaCedente;
    if (dto.codbcoblt !== undefined) c.codbcoblt = dto.codbcoblt;
    if (dto.convenio !== undefined) c.convenio = dto.convenio;
    if (dto.carteiraCobranca !== undefined) c.carteira_cobranca = dto.carteiraCobranca;
    if (dto.variacaoCarteira !== undefined) c.variacao_carteira = dto.variacaoCarteira;
    return c;
  }

  list() {
    return this.repo.list();
  }

  read(codbco: number) {
    return this.repo.read(codbco);
  }

  async criar(dto: CriarBancoDto) {
    const codbco = await this.repo.create(this.toCols(dto));
    return this.repo.read(codbco);
  }

  async atualizar(codbco: number, dto: AtualizarBancoDto) {
    await this.repo.update(codbco, this.toCols(dto));
    return this.repo.read(codbco);
  }

  async excluir(codbco: number) {
    await this.repo.remove(codbco);
  }
}
