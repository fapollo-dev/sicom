# Extração de regra de negócio

> Como extrair regra de negócio do legado **com profundidade**: validações, cálculos, condicionais e efeitos colaterais — documentando **o porquê** e capturando os **casos de borda**. A vantagem procedural do Delphi (linear, tudo na ordem) só vira força se você ler **de cima a baixo sem presumir** e **não perder nenhuma condicional**. A regra vai para a **camada de service** — não no controller, não na SQL solta.

## Pré-requisitos de leitura

- [delphi-anatomy.md](delphi-anatomy.md) — como achar os métodos que importam (mapa de event handlers) e seguir as chamadas internas.
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — "zero perda de regra de negócio"; a vantagem procedural; o risco-coroa fiscal.
- [../02-stack-and-standards/backend-nestjs-standards.md](../02-stack-and-standards/backend-nestjs-standards.md) — onde a regra mora: **service** (controller/service/repository), erros tipados.
- [dynamic-sql-extraction.md](dynamic-sql-extraction.md) — as condicionais que **montam SQL** saem por lá; as de **validação/cálculo** saem por aqui. Juntas, nenhuma escapa.

---

## A regra existe — está toda no `.pas`

A boa notícia do legado Delphi: ele é **procedural**. Não há injeção de dependência mágica, nem AOP, nem middleware invisível. A regra de negócio é uma sequência de comandos, **na ordem**, dentro de um método que você consegue ler de cima a baixo. `btnSalvarClick` faz, em ordem: valida → calcula → grava → dispara efeitos. Tudo está ali.

A má notícia: ela está **misturada** com UI (`ShowMessage`, `SetFocus`), com SQL (`SQL.Add`, `ExecSQL`) e com estado global (`dmPrincipal.qry...`, variáveis de unit). Extrair = **separar a regra do ruído** e provar que você pegou tudo.

> Princípio inegociável: **leia o método inteiro, de cima a baixo, sem presumir.** Não pule um `if` porque "parece validação trivial". Cada `if`, `case`, `while`, `try/except`, cada `Exit` antecipado, cada efeito colateral é **regra** até prova em contrário. Perder uma condicional = perder uma regra = quebrar paridade.

---

## O que conta como regra de negócio (as 4 categorias)

| Categoria | No `.pas` aparece como | Vai para |
|-----------|------------------------|----------|
| **Validação** | `if Trim(x)='' then ShowMessage/Exit`, checagens antes de gravar | `service` — lança erro tipado (`BusinessRuleError`) |
| **Cálculo** | aritmética, `Round`, `Trunc`, fórmulas de preço/imposto/margem | `service` — função pura testável |
| **Condicional de fluxo** | `if/case` que muda **o que acontece** (não só a SQL) | `service` — ramos explícitos |
| **Efeito colateral** | gravar em **outra** tabela, atualizar saldo, logar, disparar evento | `service` — orquestração, transação |

Tudo isso vai para o **service** (ADR-006, camadas em [../02-stack-and-standards/backend-nestjs-standards.md](../02-stack-and-standards/backend-nestjs-standards.md)). **Nunca** no controller (que só faz transporte) e **nunca** "solto na SQL" (uma trigger ou um `CASE` no SELECT que esconde a regra de quem lê o código). A regra fica **testável e isolada**.

---

## O método de leitura (passo a passo, sem perder nada)

1. **Entre pelos handlers que o `.dfm` aponta** (`btnSalvarClick`, `edPrecoExit`, `FormShow`) — o mapa de eventos de [delphi-anatomy.md](delphi-anatomy.md) diz quais são.
2. **Siga toda chamada interna.** `btnSalvarClick` chama `CalcularMargem` e `ValidarTributacao`? A regra densa está lá. Não pare na superfície do handler.
3. **Marque cada ponto de decisão.** Numere os `if`/`case`/`Exit`/`except`. Eles são o **inventário de condicionais** — espelha o inventário de SQL da frente A em [dynamic-sql-extraction.md](dynamic-sql-extraction.md). Nenhum número fica sem destino.
4. **Para cada decisão, capture o PORQUÊ.** Por que `if uf = 'SP'`? Por que `* 0.18`? Se o código não diz, **o nome da variável, a tabela de parâmetros e a borda do valor dizem** — e às vezes é regra **fiscal** (consulte a lei; ver risco-coroa). Documente a hipótese.
5. **Liste os efeitos colaterais.** O que mais este método grava/atualiza além do óbvio? (saldo de estoque, kardex, financeiro, log). Isso conecta com [hidden-coupling-traps.md](hidden-coupling-traps.md).
6. **Capture os casos de borda.** Valor zero, negativo, nulo, string vazia, data limite, arredondamento (R$ 0,005 → ?), isenção, alíquota zero. Cada borda vira um **caso de teste** no dossiê.
7. **Reescreva como service puro** + testes que provam cada ramo e cada borda.

---

## Exemplo real — cálculo de preço de venda com desconto e imposto

Uma rotina densa e típica de retaguarda: dado um custo, calcula o preço de venda aplicando margem, desconto por condição, e o imposto conforme a tributação do produto e a UF. Linear, mas cheio de condicionais que **não podem** se perder.

### Legado (Object Pascal — ler de cima a baixo)

```pascal
// PrecoVenda.pas — chamado por edPrecoExit / btnCalcularClick
function TfrmPreco.CalcularPrecoVenda(
  custo: Currency; idProduto: Integer; uf: string;
  condicaoPagamento: Integer): Currency;
var
  margem, preco, aliqIcms, aliqPis, aliqCofins, descCond: Double;
  tributacao: string;
begin
  // 1) margem vem do cadastro do produto (parâmetro por produto)
  qryProd.Close;
  qryProd.SQL.Text := 'SELECT margem_lucro, tributacao FROM produto WHERE id = :id';
  qryProd.ParamByName('id').AsInteger := idProduto;
  qryProd.Open;
  margem     := qryProd.FieldByName('margem_lucro').AsFloat;   // ex.: 30 (=30%)
  tributacao := qryProd.FieldByName('tributacao').AsString;    // 'T','S','I','N'

  if margem <= 0 then
    margem := 30;                         // REGRA: default 30% se produto sem margem

  // 2) preço base = custo + margem
  preco := custo * (1 + margem / 100);

  // 3) imposto conforme TRIBUTAÇÃO do produto
  if tributacao = 'T' then                // Tributado normal
  begin
    aliqIcms := ObterAliquotaIcms(uf);    // tabela por UF (ICMS interno)
    aliqPis    := 1.65;
    aliqCofins := 7.60;
    preco := preco * (1 + (aliqIcms + aliqPis + aliqCofins) / 100);
  end
  else if tributacao = 'S' then           // Substituição Tributária (ST)
  begin
    // REGRA: em ST o ICMS já foi recolhido na cadeia; NÃO soma ICMS de novo,
    // mas aplica MVA (margem de valor agregado) por UF.
    preco := preco * (1 + ObterMva(uf, idProduto) / 100);
  end
  else if tributacao = 'I' then           // Isento
    // REGRA: isento -> sem acréscimo de imposto
  else if tributacao = 'N' then           // Não tributado
    ;                                     // idem isento

  // 4) desconto por condição de pagamento
  if condicaoPagamento = 1 then           // à vista
    descCond := 5                          // 5% de desconto à vista
  else if condicaoPagamento = 2 then      // 30 dias
    descCond := 0
  else if condicaoPagamento >= 3 then     // parcelado: acréscimo, não desconto
    descCond := -3                         // -3% = acréscimo de 3%
  else
    descCond := 0;

  preco := preco * (1 - descCond / 100);

  // 5) arredondamento comercial: 2 casas, modo "round half up"
  Result := RoundTo(preco, -2);           // REGRA: arredonda no FIM, nunca no meio

  // 6) efeito colateral: registra o cálculo para auditoria de preço
  GravarHistoricoPreco(idProduto, custo, Result, uf, condicaoPagamento);
end;
```

### O que extrair (e não perder)

Inventário de condicionais e regras desta única função:

| # | Condicional / regra | Porquê (documentado) | Borda a testar |
|---|---------------------|----------------------|----------------|
| R1 | `if margem <= 0 then margem := 30` | Produto sem margem cadastrada usa default 30% | margem = 0, margem negativa, margem nula |
| R2 | `preco := custo * (1 + margem/100)` | Margem é **markup sobre custo**, não margem sobre preço | custo 0, custo negativo (erro?) |
| R3 | `tributacao = 'T'` → soma ICMS(UF)+PIS+COFINS | Tributado normal acumula os 3 tributos | UF sem alíquota cadastrada |
| R4 | `tributacao = 'S'` → **não** soma ICMS, aplica MVA(UF, produto) | **ST: ICMS já recolhido na cadeia** — somar de novo é bug fiscal | MVA inexistente para a UF/produto |
| R5 | `'I'` e `'N'` → sem imposto | Isento e não-tributado não acrescem | confirmar que **nada** é somado |
| R6 | condição 1 = 5% desc; 2 = 0; ≥3 = **acréscimo** 3% | À vista desconta; parcelado **encarece** | condição 0 ou desconhecida → 0 (else) |
| R7 | `RoundTo(preco, -2)` no **fim** | Arredondar no meio acumula erro de centavo | preço terminando em `…,005` (half-up vs banker's) |
| R8 | `GravarHistoricoPreco(...)` | **Efeito colateral**: auditoria de preço | tem que rodar na **mesma transação**? |

> Pegadinhas que a leitura apressada perde: (a) **R4** — somar ICMS em ST é erro fiscal silencioso (o caminho feliz "tributado" não revela). (b) **R6 com `descCond = -3`** — sinal negativo vira **acréscimo**; quem lê rápido lê "desconto". (c) **R7** — o `RoundTo` do Delphi é **banker's rounding** (round half to even) por padrão em algumas versões; o JS `Math.round` é half-up. **Isso muda centavo** e quebra paridade. Capture na fixture.

### Alvo — service NestJS testável (regra fora do controller, fora da SQL)

```ts
// fiscal/preco/preco-venda.service.ts — a regra extraída, pura e testável
@Injectable()
export class PrecoVendaService {
  constructor(
    private readonly produtos: ProdutoRepository,
    private readonly fiscal: TributacaoRepository,     // alíquotas ICMS / MVA por UF
    private readonly historico: HistoricoPrecoRepository,
  ) {}

  async calcular(input: CalcularPrecoInput): Promise<CalcularPrecoResult> {
    const { custo, idProduto, uf, condicaoPagamento } = input;

    const prod = await this.produtos.getMargemETributacao(idProduto);
    // R1: default de margem
    const margem = prod.margemLucro > 0 ? prod.margemLucro : 30;

    // R2: markup sobre custo (decimal, não float — dinheiro!)
    let preco = mul(custo, add(1, div(margem, 100)));

    // R3..R5: imposto por tributação — ramos EXPLÍCITOS, um por código
    switch (prod.tributacao) {
      case 'T': {
        const icms = await this.fiscal.aliquotaIcms(uf);          // por UF
        const acresc = add(add(icms, 1.65), 7.60);                // ICMS+PIS+COFINS
        preco = mul(preco, add(1, div(acresc, 100)));
        break;
      }
      case 'S': {
        // R4: ST não soma ICMS de novo; aplica MVA por UF/produto
        const mva = await this.fiscal.mva(uf, idProduto);
        preco = mul(preco, add(1, div(mva, 100)));
        break;
      }
      case 'I':
      case 'N':
        break;                                                    // R5: sem acréscimo
      default:
        throw new BusinessRuleError('TRIBUTACAO_DESCONHECIDA', { tributacao: prod.tributacao });
    }

    // R6: desconto/acréscimo por condição (sinal negativo = acréscimo)
    const descCond = this.descontoCondicao(condicaoPagamento);    // 1→5, 2→0, ≥3→-3, else→0
    preco = mul(preco, sub(1, div(descCond, 100)));

    // R7: arredondamento comercial no FIM, half-up explícito (NÃO o default do runtime)
    const precoFinal = roundHalfUp(preco, 2);

    // R8: efeito colateral na MESMA transação (orquestrado pelo service)
    await this.historico.registrar({ idProduto, custo, precoFinal, uf, condicaoPagamento });

    return { precoVenda: precoFinal, margemAplicada: margem, tributacao: prod.tributacao };
  }

  private descontoCondicao(cond: number): number {
    if (cond === 1) return 5;       // à vista
    if (cond === 2) return 0;       // 30 dias
    if (cond >= 3)  return -3;      // parcelado = acréscimo
    return 0;                        // else (R6 default)
  }
}
```

E os testes que **provam cada ramo e cada borda** (golden, alinhados às fixtures do legado):

```ts
// preco-venda.service.spec.ts — um teste por regra/borda do inventário
describe('PrecoVendaService.calcular', () => {
  it('R1: margem 0 usa default 30%', async () => { /* ... espera markup de 30% */ });
  it('R4: ST não soma ICMS, aplica MVA', async () => {
    // prova que tributacao='S' NÃO acresce ICMS — o bug fiscal que a leitura apressada criaria
  });
  it('R6: condição >=3 ENCARECE 3% (acréscimo)', async () => { /* sinal negativo */ });
  it('R7: arredonda half-up no fim (…,005 -> …,01)', async () => {
    // o caso que diverge entre RoundTo(Delphi) e Math.round(JS) — paridade de centavo
  });
  it('borda: tributação desconhecida lança BusinessRuleError', async () => { /* default do switch */ });
});
```

> Note `mul/add/div/roundHalfUp`: **dinheiro não é `number` float**. O legado usa `Currency` (inteiro escalado). No alvo, use decimal (ex.: `decimal.js` ou inteiro de centavos) — `0.1 + 0.2 !== 0.3` em float quebra paridade fiscal. Padronize a aritmética monetária e prove com a fixture.

---

## Documentar o PORQUÊ (não só o quê)

Extrair a regra é metade; a outra metade é o **porquê**, que o código quase nunca diz. Fontes do porquê, em ordem de confiança:

1. **A lei / nota técnica fiscal** (para regra tributária) — a verdade definitiva, e a única que muda sozinha (risco-coroa: legislação muda por lei várias vezes ao ano — [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md)).
2. **A tabela de parâmetros** do sistema (`SELECT * FROM parametros`) — magic numbers como `30`, `0.18` muitas vezes têm origem ali, parametrizável por empresa/UF.
3. **O nome da variável / coluna** (`margem_lucro`, `aliq_icms`) — diz a intenção.
4. **O comportamento de borda** — o que acontece em 0/nulo/negativo revela a intenção do autor.
5. **O especialista de domínio** (quando nada acima resolve) — escale, não chute (ver "quando perguntar" em [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md)).

> Magic number sem porquê documentado é dívida. `* 0.18` precisa virar `aliquotaIcms(uf)` parametrizável **com a fonte registrada no dossiê** — porque amanhã a lei muda e você precisa saber onde mexer sem redeploy geral (ADR-010, fiscal pinável/parametrizável).

---

## Cuidados específicos do Pascal (semântica que muda resultado)

| Construção Pascal | Pegadinha | No alvo |
|-------------------|-----------|---------|
| `Currency` | inteiro escalado (4 casas), **não** float | decimal / inteiro de centavos |
| `RoundTo(x, -2)` | banker's rounding em algumas versões | `roundHalfUp` explícito — confirme com fixture |
| `Trunc` vs `Round` | trunca vs arredonda | função correspondente explícita |
| `''` (string vazia) vs `NULL` | `Text = ''` ≠ `IsNull` | distinguir `'' ` de `null` |
| `Exit` no meio do método | early return — pula o resto | `return`/`throw` no mesmo ponto |
| `try/finally` | libera recurso sempre | `finally`/`using` |
| `try/except` que **engole** erro | erro silencioso vira "deu certo" | **nunca** engolir — erro tipado |
| `if x = 'S'` (flags char) | flags 'S'/'N' em vez de boolean | mapear para enum/boolean explícito |
| ordem dos `if/else if` | primeiro match ganha | preservar a ordem; `switch`/`if` na mesma sequência |

---

## Onde a regra desemboca

- Vai para o **service** do módulo de domínio (ADR-006) — testável, isolada de UI e de SQL ([../02-stack-and-standards/backend-nestjs-standards.md](../02-stack-and-standards/backend-nestjs-standards.md)).
- O **inventário de condicionais + porquê + casos de borda** mora no **dossiê** (seção 04, ADR-012), ao lado da SQL reconstruída ([dynamic-sql-extraction.md](dynamic-sql-extraction.md)) e do mapa de teclado ([delphi-anatomy.md](delphi-anatomy.md)).
- Os **casos de borda** viram golden tests; a paridade se prova contra o legado ([../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md)).
- Os **efeitos colaterais** que cruzam telas/estado global são caçados em [hidden-coupling-traps.md](hidden-coupling-traps.md).

---

## Checklist do agente

- [ ] Li **cada** método apontado pelo `.dfm` **inteiro** e segui as chamadas internas.
- [ ] Numerei **todas** as condicionais (`if/case/Exit/except`) — nenhuma sem destino.
- [ ] Classifiquei cada uma: validação / cálculo / fluxo / efeito colateral.
- [ ] Documentei o **porquê** de cada regra e de cada magic number (com a fonte).
- [ ] Capturei os **casos de borda** (0/nulo/negativo/limite/arredondamento/isenção).
- [ ] Tratei a **aritmética monetária** com decimal e arredondamento explícito (não float).
- [ ] Não engoli nenhum `try/except`; erros viraram **tipados** e nomeados.
- [ ] Reescrevi como **service** puro com um teste por ramo e por borda.
- [ ] Confirmei paridade dos resultados contra o legado (fixtures).

---

## Ver também

- [dynamic-sql-extraction.md](dynamic-sql-extraction.md) — as condicionais que montam SQL (a outra metade do inventário).
- [hidden-coupling-traps.md](hidden-coupling-traps.md) — os efeitos colaterais e o estado externo que a regra toca.
- [delphi-anatomy.md](delphi-anatomy.md) — o mapa de handlers que diz quais métodos ler.
- [../02-stack-and-standards/backend-nestjs-standards.md](../02-stack-and-standards/backend-nestjs-standards.md) — a regra vai para o **service**; erros tipados.
- [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md) — os casos de borda viram golden tests.
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — zero perda de regra; risco-coroa fiscal.
