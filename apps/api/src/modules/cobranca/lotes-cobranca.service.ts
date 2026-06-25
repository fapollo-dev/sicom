import { Injectable } from '@nestjs/common';
import type { CriarLoteCobrancaDto } from '@apollo/shared';
import { LoteCobrancaRepository } from './lote-cobranca.repository';

@Injectable()
export class LotesCobrancaService {
  constructor(private readonly repo: LoteCobrancaRepository) {}

  list() {
    return this.repo.list();
  }
  read(cod: number) {
    return this.repo.read(cod);
  }
  async criar(dto: CriarLoteCobrancaDto) {
    const cod = await this.repo.create(
      { codparceiro: dto.codparceiro, data: dto.data },
      dto.itens,
    );
    return this.repo.read(cod);
  }
  async atualizar(cod: number, dto: CriarLoteCobrancaDto) {
    await this.repo.update(cod, { codparceiro: dto.codparceiro, data: dto.data }, dto.itens);
    return this.repo.read(cod);
  }
  async excluir(cod: number) {
    await this.repo.remove(cod);
  }
}
