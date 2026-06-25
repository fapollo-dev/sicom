import { BadGatewayException, Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import type { CepResposta } from '@apollo/shared';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';

/**
 * Proxy de CEP (espelha o `mskCEPExit`/`btnConsultaCEP` do legado: autofill de endereço).
 * Consulta o ViaCEP (gratuito, sem auth) e devolve os campos prontos p/ a tela de Parceiros.
 * O `idcidade` é o código IBGE do município (a tabela CIDADES usa IBGE como PK).
 * Erros viram envelope ADR-015 via AllExceptionsFilter (nunca 500 genérico).
 * Receita Federal (CNPJ) e SINTEGRA (IE) ficam para fase futura.
 */
@Controller('cadastro/cep')
@UseGuards(AcessoGuard)
export class CepController {
  @Get(':cep')
  async consultar(@Param('cep') cepParam: string): Promise<CepResposta> {
    const cep = (cepParam ?? '').replace(/\D/g, '');
    if (cep.length !== 8) throw new NotFoundException('CEP inválido. Informe 8 dígitos.');

    let dados: Record<string, unknown>;
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 8000);
      const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: ac.signal });
      clearTimeout(t);
      if (!resp.ok) throw new Error(`status ${resp.status}`);
      dados = (await resp.json()) as Record<string, unknown>;
    } catch {
      throw new BadGatewayException('Não foi possível consultar o CEP no momento. Tente novamente.');
    }

    if (dados.erro) throw new NotFoundException('CEP não encontrado.');

    const ibge = Number(dados.ibge);
    return {
      cep,
      endereco: String(dados.logradouro ?? ''),
      bairro: String(dados.bairro ?? ''),
      cidade: String(dados.localidade ?? ''),
      uf: String(dados.uf ?? ''),
      idcidade: Number.isFinite(ibge) && ibge > 0 ? ibge : undefined,
    };
  }
}
