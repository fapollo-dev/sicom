/**
 * Contrato ÚNICO de resposta de erro da API (back↔front). Toda falha vira este
 * envelope — status code ajustado, `code` estável e `message` em PORTUGUÊS com o
 * motivo real. NUNCA um 500 genérico "erro no servidor" (ADR-015). Erros de
 * validação/regra trazem os detalhes por campo em `campos`.
 */
export interface CampoErro {
  /** caminho do campo (ex.: 'descricao', 'itens.0.codrcb') */
  campo: string;
  /** mensagem legível em PT-BR */
  mensagem: string;
}

export interface ErroResposta {
  /** HTTP status ajustado (400/403/404/409/422/500…) */
  statusCode: number;
  /** código estável MAIÚSCULAS_SNAKE (ex.: VALIDACAO, REGRA_NEGOCIO, DUPLICADO) */
  code: string;
  /** motivo real, em português, legível pelo usuário */
  message: string;
  /** erros por campo (validação/obrigatórios) — opcional */
  campos?: CampoErro[];
}

/** type-guard simples para o front decidir se um body é o envelope padrão. */
export function isErroResposta(x: unknown): x is ErroResposta {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as any).code === 'string' &&
    typeof (x as any).message === 'string'
  );
}
