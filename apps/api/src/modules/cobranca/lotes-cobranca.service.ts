import { Injectable } from '@nestjs/common';
import type { CriarLoteCobrancaDto } from '@apollo/shared';
import { LoteCobrancaRepository } from './lote-cobranca.repository';

@Injectable()
export class LotesCobrancaService {
  constructor(private readonly repo: LoteCobrancaRepository) {}

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
}
