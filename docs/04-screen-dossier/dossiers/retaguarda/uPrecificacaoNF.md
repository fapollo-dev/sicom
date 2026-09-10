# PRECIFICAÇÃO DE NF (`FRMPRECIFICACAONF`) — recon e corte-1

`uPrecificacaoNF.pas` (1.129 linhas) + `uDMPrecificacaoNF.pas` (914). **236 acessos, 17 operadores.**
O usuário classificou a tela como *"de extrema importância e de grande influência"* — tratada com o cuidado
que isso pede: nenhuma conta adivinhada, nenhuma simplificação silenciosa.

## 1. O que a tela é

**É onde o preço de venda nasce.** A mercadoria chega, a nota é lançada, e aqui o operador vê item a item: o
custo que veio na nota, o preço que está valendo na loja, o sugerido pela margem, e decide.

Não confundir com a **Precificação por Custo** (`FRMPRIFICACAOCUSTO`): aquela reprecifica o cadastro a partir
do custo já registrado; esta parte **da nota que acabou de entrar**. A escada de margem é a mesma — e é
literalmente a mesma, por reúso (§4).

## 2. ⚠️ A regra mais importante: aplicar **não muda o preço**

`uPrecificacaoNF.pas:996` — "Aplicar Valores" grava em `LOTE_PRECO` com `PROCESSADO = 'N'`. Quem muda o preço
de fato é o **processamento do lote**, que é também quem gera a etiqueta e a carga do PDV.

É uma trava de conferência, não um detalhe de implementação: o operador precifica a nota inteira, confere, e
só então o lote roda. Foi mantida, e a tela **diz isso em voz alta** para quem não conhece o fluxo.

## 3. As contas, e o que não se adivinha

| conta | fórmula | onde |
|---|---|---|
| **custo unitário** | `(VRCUSTO − desconto% × VRCUSTO) / FATOREMBAL` | `uDMPrecificacaoNF` |
| **quantidade** | `QUANTIDADE × FATOREMBAL` | idem |
| **markup atual** | `VRVENDA / custo unitário` — **é razão, não percentual** | `:812` |
| **ICMS** | `DET_ALIQUOTA.ICM_EFETIVO` pela **UF do FORNECEDOR na nota** | `dfm` |
| **último custo de reposição** | `VRCUSTOREP` da última NF de entrada processada, não cancelada, CFOP na lista, **excluindo a própria** | `dfm:424` |

⚠️ **o fator de embalagem é o coração da tela.** A nota vem em caixa, a loja vende em unidade. O mesmo fator
**divide** o custo e **multiplica** a quantidade. Trocar o sentido de um dos dois erra o preço por uma ordem de
grandeza — e o erro sai direto na etiqueta. Fator zero ou nulo vale **1**.

⚠️ **markup é razão.** `2,5` quer dizer "duas vezes e meia o custo", não "2,5%". Quem lê como percentual põe a
loja para vender abaixo do custo.

⚠️ **o ICMS vem da UF do FORNECEDOR** (`PARCEIROS_END.CODEND = NF.CODPARCEIRO_END`), **não** da UF da empresa —
que é como a Rentabilidade por Categorias resolve a mesma coluna. Duas telas, a mesma `DET_ALIQUOTA`, origens
opostas, e ambas certas: lá interessa onde se VENDE, aqui de onde a mercadoria VEIO.

### O que a tela exclui por padrão

- **transferência** (`CFOP.PROC_TRANSF`, `:911`) — mercadoria da outra loja não é compra, não reprecifica;
- **bonificação** (CFOP `1910`/`2910`, `:916`) — mercadoria de graça não forma preço.

Ambas com caixa para incluir, porque o legado tem.

## 4. O que foi **reusado**, não reescrito

`recalcular()` chama `PrecificacaoCustoService.calcular()`. A escada de margem (PMZ → preço sugerido → lucro)
já tinha sido portada do `FRMPRIFICACAOCUSTO` e certificada; reimplementá-la aqui criaria duas verdades sobre
a margem da mesma empresa. Esta tela **alimenta** aquele cálculo com os componentes que vieram na nota.

## 5. O que a carga estava jogando fora (mig 211)

Mais seis colunas de `NF_PROD` que existiam no legado e não no destino — e as seis são de **preço**:

| coluna | o que é |
|---|---|
| `pmz` | preço de margem zero do item na nota |
| `vrvendasug` | o preço sugerido, gravado no item |
| `ultcusto` | o último custo no momento do lançamento |
| `vrcustocsi` | custo sem imposto |
| `frete2` | o segundo frete (existe no legado, entra no custo) |
| `despextra` | despesa extra do item |

Mais `CFOP.PROC_TRANSF`, que é o que marca o CFOP como transferência. Sem ela o filtro de transferência não
existe. **Achado nº 7 da mesma família** — a carga vinha descartando coluna de dinheiro em silêncio.

## 6. RBAC

Duas permissões, não uma: `FRMPRECIFICACAONF` (abrir/consultar) e **`BTNAPLICAR`** (gravar o lote). O legado
separa, porque ver o preço sugerido e mandar a loja mudar de preço não são o mesmo poder.

## 7. Cobertura (§104 do smoke, 6 checks)

1. o fator de embalagem dividindo o custo e multiplicando a quantidade;
2. markup como razão, ICMS pela UF do fornecedor, último custo excluindo a própria nota;
3. os filtros de transferência e bonificação, ligados e desligados;
4. a marcação de margem negativa;
5. o lote gravado com `PROCESSADO='N'` — e o preço do produto **inalterado** depois de aplicar;
6. as recusas: preço zero e empresa inexistente.

## 8. O que ficou para o corte-2

- o modo **multi-empresa** (precificar a nota para várias lojas de uma vez);
- a **impressão de etiqueta** direto da tela (hoje sai pelo lote, que é o caminho normal);
- o **histórico de preço** do item no painel lateral;
- a coluna de **concorrência**, que o cliente não usa (0 linhas em `PESQUISA_CONCORRENCIA` na produção).
