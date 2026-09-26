/**
 * O FUSO DO PROCESSO é o da loja — importado PRIMEIRO pelos pontos de entrada (main.ts, smoke, dev-embedded).
 *
 * O `pg` entrega `date` à meia-noite e `timestamp` (sem fuso — o legado grava a hora local nas colunas DATE/TIMESTAMP) no fuso do
 * PROCESSO, e o código lê horas/dias desses valores. Num servidor em UTC, o smoke inteiro rodado com `TZ=UTC` dá 32 falhas (vendas por
 * hora, CNAB, razão contábil, fluxo de caixa…). Com o processo fixo no fuso da loja, o servidor pode estar em qualquer fuso.
 * `APOLLO_TZ` troca, se um dia houver loja em outro fuso. (O Node relê `process.env.TZ` quando ele é atribuído.)
 */
process.env.TZ = process.env.APOLLO_TZ ?? 'America/Sao_Paulo';
export {};
