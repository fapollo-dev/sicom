# FRMGERARFINANCEIROLOTE — Gerar financeiro em lote

**8 acessos · 3 operadores** no menu — e **10.666 títulos gerados em 2026**. `uGerarFinanceiroLote.pas`
(348) + `udmGerarFinanceiroLote`. Migration **266**. API `GET/POST cobranca/gerar-financeiro-lote`.
Tela `/cobranca/gerar-financeiro-lote`. Smoke §144 (4 checks).

## 1. O que faz

A cobrança mensal dos clientes de valor fixo. O operador escolhe vários clientes (`CLI='S' AND
ATIVADO='S'`, seleção múltipla), uma data de vencimento e um banco; a tela gera **um `ARECEBER` por
cliente** no valor de `PARCEIROS.FIXO`. Oito acessos no menu porque é aberta uma vez por mês — e cada
abertura vale ~1.300 títulos.

## 2. O que o dado diz (produção, 18/09/2026)

| | |
|---|---:|
| clientes com `FIXO > 0` | **169** — R$ **182.522,81** (de R$ 100 a R$ 6.800) |
| títulos `DUPLICATA = 'DUP 01/01'` por ano | 2020: 3.397 · 2021: 8.906 · 2022: 11.058 · 2023: 12.619 · 2024: 14.456 · 2025: 15.059 · **2026: 10.666** |
| 2026 por mês | 1.111 a 1.354 títulos, R$ 64 mil a 94 mil |
| 2026 por loja | 7.477 na 1 · 3.189 na 2 (todos `TIPODOC='DUPLICATA'`) |
| grupos (parceiro, venc, valor, empresa, banco) repetidos em 2026 | 47 |

## 3. Regras do fonte, copiadas

- o título nasce `QUITADA='N'`, `GERADO='SISTEMA'`, `NRODUP=1`, `DUPLICATA='DUP 01/01'`,
  `TXJUROS = EMPRESAS.TXJUROPADRAO`, `TIPODOC='DUPLICATA'`, `IDPGTO` = a forma **DUPLICATA** da empresa;
- **sem a forma DUPLICATA cadastrada o legado recusa a tela inteira** ("Não existe a forma de pagamento
  DUPLICATA cadastrada") — aqui 422 `FORMA_DUPLICATA_NAO_CADASTRADA`;
- `DTVENDA` = hoje, **ou** o dia `PARCEIROS.VENC_PREV` do mês do vencimento quando "Vencimento do Cliente"
  está marcado;
- **guarda anti-duplicidade**: antes de gravar, procura `ARECEBER` do mesmo (parceiro, vencimento, valor,
  empresa, banco) e **descarta** a linha se achar — é o que impede a segunda geração do mês virar cobrança
  dobrada. Os 47 grupos repetidos de 2026 vieram por outro caminho, não por esta tela;
- banco é obrigatório.

## 4. O que o Apollo faz a mais

- **`simular: true`** — mostra quem entraria e quem seria descartado (e por quê), sem gravar nada. O legado
  só descobre depois de gerar.
- `codoperador` carimbado no título (o destino não tinha a coluna); `parceiros.fixo` também não existia na
  carga — as duas entram na 266.
- Tenant-scoped, transação única, e o descarte volta com o `codrcb` do título que já existia.
