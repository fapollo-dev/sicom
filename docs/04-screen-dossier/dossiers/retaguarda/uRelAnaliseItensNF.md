# ANÁLISE DE ITENS DA NOTA FISCAL (`FRMRELANALISEITENSNF`)

`uRelAnaliseItensNF.pas` (297). **34 acessos.** API `relatorios/analise-itens-nf`. Migration 245. A regra do corte 1 está no cabeçalho do serviço.

## ✅ O Imprimir e a nota escolhida (06/10/2026)

- O Imprimir é a única saída do legado: `Rel_AnaliseItensNF.fr3` (931) com o `cdsRel` no `frxDBDataset1` e a variável Empresa = a razão
  social da loja do login; o legado imprime mesmo sem linhas.
- Com a **nota escolhida** (`edtNF`), o legado troca o período por 01/01/1900 a 01/01/2050 (:150) — a consulta do Apollo passou a fazer o
  mesmo (antes aplicava o período junto com o filtro da nota).
- Os padrões do corte 1 (só entradas, sem canceladas, a loja do login) seguem documentados no cabeçalho do serviço; "todas" e "incluir
  canceladas" devolvem o conjunto do legado.

Smoke §122.4; teste de renderização do 931.
