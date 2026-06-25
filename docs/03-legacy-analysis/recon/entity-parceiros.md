# Mapa de entidade — `PARCEIROS` (o "party" central)

> A entidade mais central do ERP: **um único cadastro polimórfico** que é cliente, fornecedor, funcionário, transportadora e convênio ao mesmo tempo, referenciado por **31 tabelas**. Não é candidata a tela-piloto (central e arriscada demais), mas é a **entidade-chave a modelar cedo** — e o **exemplo concreto** do contrato mestre-detalhe ([form-base-cadmaster.md §5b](form-base-cadmaster.md)). Mapeamento estático: dicionário Oracle (read-only, schema `COLUMBIA`) + código `udmParceiros`.

## Pré-requisitos de leitura

- [form-base-cadmaster.md](form-base-cadmaster.md) — o engine CRUD e a variante mestre-detalhe (nested datasets) que esta tela usa.
- [mapa-reconhecimento.md](mapa-reconhecimento.md) — §D (replicação), §F (fiscal), §E (volume).
- [../business-rule-extraction.md](../business-rule-extraction.md) — flags `char` 'S'/'N' → enum/boolean; `Currency` → decimal.

---

## 1. O quê — party polimórfico

`PARCEIROS` (**14.271 linhas**, **169 colunas**, PK `PK_PARCEIROS` em `CODPARCEIRO`) é uma **parte de negócio única** marcada por **flags de papel** (todos `CHAR(1)` 'S'/'N'):

| Flag | Papel |
|---|---|
| `CLI` | Cliente |
| `FRN` | Fornecedor |
| `CON` | Convênio |
| `FUN` | Funcionário |
| `TRA` | Transportadora |

> **Por isso `uCadClientes`, `uCadFornecedores`, `uCadAssociados` (e outras) são a MESMA tabela** filtrada por papel — telas diferentes, entidade única. `TIPOFJ` distingue pessoa (`F`ísica/`J`urídica/`R`ural/`G`overnamental/`E`ntidade). `ATIVADO`/`BLOQUED` controlam status.

---

## 2. As 169 colunas — acreção de 20 anos (agrupadas)

- **Identidade**: `CODPARCEIRO`, `RAZAO`, `FANTASIA`, `TIPOFJ`, `DTNASCIMENTO`, `EMAIL`, `SEXO`, `ESTADO_CIVIL`, `ESTRANGEIRO`, `IDENTIFICADOR`.
- **Financeiro/crédito**: `CREDITO`, `LIMITE_ESPECIAL`, `COMISSAO`, `TXJURO`, `TOLERANCIA`, `DIASPRAZO`, `DIASFINAN`, `DESCPADRAO`, `VENCIMENTOS`, `SALDO`/saldos (datasets aux).
- **Fiscal (risco-coroa)**: `CONTRIBUINTE_ICMS`, `CLASSFISCAL`, `CNAE`, `SUFRAMA`, `CARACTERISTICA_TRIBUTARIA`, e **flags de retenção** `HABILITA_RETENCAO_{PIS,COFINS,CSLL,IR,INSS,ISSQN,FUNRURAL,SENAR}_NF` + alíquotas (`PERC_ALIQUOTA_*`). Retenção de fornecedor é regra fiscal sensível.
- **Comercial/compras**: `CODVENDEDOR`, `CODCOMPRADOR`, `CODPERFIL_COMPRA`/`CODPERFIL_PARCEIRO` (→ `PERFIL`), `CLASSFORNECEDOR`, `TIPO_FORNECEDOR`, `PRAZO_ENTREGA/RECEBIMENTO/REPOSICAO`, `PARTICIPA_COTACAO`, `REGRAS_TABELA_FORNECEDOR`.
- **Funcionário** (quando `FUN='S'`): `CARGO`, `RENDA`, `TEMPOSERVICO`, `PERCSALARIO`, `VRSEGURO/EXAME/XEROX/SPC`, `SENHA_AUTPDV`, `BIOMETRIA`.
- **Contatos múltiplos**: responsáveis comercial/financeiro/logístico, cada um com `EMAIL_*`/`FONE_*`.
- **Fidelidade/marketing**: `CLUBEFIDELIDADE`, `COD_IZIO`, `CAMPANHA_IZIO`, `PUBLICIDADE_{SMS,EMAIL,WHATSAPP}`, `DTCARTAOFIDELIDADE`.
- **Auditoria**: `DTCADASTRO`, `USUCADASTRO`, `DTULTIMALTERACAO`/`DTULTALTERACAO`, `USULTALTERACAO`, `ULTIMA_ALTER`.

> Característica clássica de legado: **denormalizado e flag-pesado**. Apesar de 169 colunas, só há **2 FKs de saída** (`CODPERFIL_*` → `PERFIL`) — o resto é texto livre, flags `char` e códigos soltos sem FK. No alvo isso vira tipos/enums explícitos e, onde fizer sentido, FKs reais.

---

## 3. Mestre-detalhe (o exemplo concreto dos nested datasets)

`udmParceiros` confirma o padrão de [form-base-cadmaster.md §5b](form-base-cadmaster.md): `cdsParceiros` (master) carrega **campos `TDataSetField`** (datasets aninhados), cada um ligado a um ClientDataSet de detalhe, servidos por **um provider** (`dspParceiros`) num pacote só:

| Detalhe (nested) | ClientDataSet | Tabela | Linhas | O quê |
|---|---|---|---|---|
| `qryEndParceiros` | `cdsEndParceiros` | `PARCEIROS_END` | 14.257 | **endereços** (~1 por parceiro) |
| `sqqParceiros_Pgto` | `cdsParceiros_Pgto` | `PARCEIROS_PGTO` | 8.843 | condições de pagamento |
| `sqqParceiros_Banco` | `cdsParceiros_Banco` | `PARCEIROS_BANCOS` | 0 | dados bancários |
| `qryRelParceiros` | `cdsRelParceiros` | `PARCEIROS_REL` | 24 | relacionamentos |
| `sqqCodReferencia_For` | `cdsCodReferencia_For` | (ref. fornecedor) | — | códigos de referência |
| `qryFaturamento` | — | (faturamento) | — | tipo de faturamento |

Outros datasets **auxiliares** (não-detalhe, só leitura): `cdsHistoricoVendas`, `cdsSaldoParceiros`, `cdsDescSaldo`. Tabelas-detalhe vazias (`PARCEIROS_SALARIO`, `PARCEIROS_VENDEDORES*`, `PARCEIROS_PRODUCAO`) existem mas sem uso neste schema.

> Salvar um parceiro = aplicar master + todos os detalhes alterados **numa transação** (o provider único resolve o pacote aninhado). No alvo: um **aggregate** Parceiro {dados + endereços + pagamentos + bancos} salvo atomicamente.

---

## 4. Centralidade — 31 tabelas referenciam `PARCEIROS`

FKs de entrada (amostra): `VENDAS`, `NF`, `NFC`, `APAGAR`, `ARECEBER`, `CHEQUE`, `CHQ_PROPRIO`, `PEDIDOCOMPRA`, `DEVOLUCAO`/`DEVOLUCAO_PRODUTO`, `COTACAO_FORN`/`COTACAO_PARTICIPANTES`, `OPERADORES`, `TROCA`, `PRODUCAO`, `ACORDO_COMERCIAL`, `CONVENIO_FUN`, `SITUACAO_NF_PARCEIROS`, além das próprias `PARCEIROS_*`.

> **Implicação:** é a **pedra angular** do modelo — quase todo fluxo (venda, NF, financeiro, compra) aponta para `PARCEIROS`. Por isso **não é piloto** (mexer aqui toca tudo), mas **precisa ser modelada cedo** como entidade compartilhada, porque os módulos seguintes dependem dela. É também a tabela que **mais replica** (9.722 UPDATEs pendentes em `REMESSA_SERVER` no schema amostrado — [mapa-reconhecimento.md §D](mapa-reconhecimento.md)).

---

## 5. Pesquisa — `GET_PARCEIROS` com colunas derivadas

A view de pesquisa decodifica/calcula em SQL:
```sql
SELECT P.RAZAO, P.CODPARCEIRO, P.FANTASIA,
       CASE WHEN P.TIPOFJ='F' THEN 'FISICA' WHEN 'R' THEN 'RURAL'
            WHEN 'G' THEN 'GOVERNAMENTAL' WHEN 'J' THEN 'JURIDICA'
            WHEN 'E' THEN 'ENTIDADE' ELSE '' END,
       TRUNC(P.DTCADASTRO), TRUNC(P.DTNASCIMENTO),
       <cálculo de idade a partir de DTNASCIMENTO> ...
FROM PARCEIROS P ...
```
> A view embute **regra de apresentação** (decodificar flags, calcular idade). No alvo, essa lógica deve subir para o **service/serializer** (não ficar escondida na view) — [business-rule-extraction.md](../business-rule-extraction.md).

---

## 6. Decisão de modelagem para o alvo (questão de produto/arquitetura)

A grande pergunta que `PARCEIROS` levanta — **não inferível do código, é decisão de produto**:

- **Manter "party" único** (uma tabela/entidade `Parceiro` com flags de papel CLI/FRN/FUN/...) — fiel ao legado, paridade mais simples; ou
- **Especializar** num padrão Party (base `Parceiro` + papéis `Cliente`/`Fornecedor`/`Funcionario`/`Transportadora` como extensões) — mais limpo no alvo, mas exige cuidado de paridade.

> Recomendação: **modelar como party único na Fase inicial** (paridade e migração mais seguras), com as 169 colunas saneadas em grupos/value-objects e os papéis como flags tipadas; reavaliar especialização depois. Registrar como decisão no dossiê de `uCadClientes`/`uCadFornecedores` e escalar ao orquestrador (toca [ADR-006](../../00-orientation/canonical-decisions.md), fronteiras de domínio).

## 7b. Validação com dados reais (✅ `pinheirao@dbhomologacao`, 18.295 parceiros)

Os dados confirmam e **refinam** o mapa:

- **Polimorfismo é a norma, não exceção** — papéis: `CLI` 14.623, `FRN` 12.614, `TRA` 1.515, `FUN` 1.061, `CON` 281. E **10.414 parceiros (57%) acumulam >1 papel** (tipicamente cliente **e** fornecedor). → **Reforça fortemente "manter party único"**: separar em entidades Cliente/Fornecedor distintas **duplicaria/contradiria** 10k+ registros. A decisão de modelagem do §6 fica **decidida pelos dados**: party unificado.
- **`TIPOFJ`**: F (física) 12.735, J (jurídica) 5.380, E (entidade) 155, R/G 11 cada — **+ sujeira**: 2 nulos e 1 valor `'L'` (fora do decode da `GET_PARCEIROS`). → migração precisa tratar valores **desconhecidos/nulos** (não assumir o domínio fechado).
- **Detalhes na prática**: `PARCEIROS_END` **18.259** (≈1 endereço/parceiro — **o detalhe dominante**); os demais são **esparsos** neste tenant (`PARCEIROS_PGTO` 210, `BANCOS` 1, `REL` 2, `SALARIO`/`VENDEDORES` ~0). → a aba de **endereço** é a que importa; as outras são casos de borda (mas variam por tenant — `PGTO` tinha 8.843 em COLUMBIA).
- **Esparsidade das 169 colunas**: várias colunas-âncora estão **vazias** neste tenant — `CNAE` 0, `SUFRAMA` 0, `CODVENDEDOR` 0, `HABILITA_RETENCAO_PIS_NF` 1; `EMAIL` só 753/18k; `CLUBEFIDELIDADE` 1.898. → **muitas das 169 colunas são vestigiais** — a migração pode **consolidar/podar** em vez de carregar 169 campos fiéis. (Confirmar com survey multi-tenant antes de podar definitivamente — uso varia por cliente.)

> **Conclusão de modelagem (agora aterrada em dados):** party único, com as colunas saneadas em grupos/value-objects e **as vestigiais identificadas por densidade real** (não carregar campo morto); `TIPOFJ` como enum **com fallback** para valores sujos; endereço como detalhe de primeira classe, demais detalhes opcionais.

## Pendências (runtime / banco-sombra)

- Capturar a SQL real de gravação do aggregate (master + nested) e a ordem de apply.
- Confirmar quais detalhes/abas cada tela de papel (Clientes vs Fornecedores) exibe e edita.
- Mapear as regras por papel (ex.: retenções fiscais só para fornecedor) — leitura do `.pas` das telas (uCadClientes 5.749 linhas é a maior).

## Ver também

- [form-base-cadmaster.md](form-base-cadmaster.md) — o contrato mestre-detalhe que `PARCEIROS` exemplifica.
- [mapa-reconhecimento.md](mapa-reconhecimento.md) — §D (replicação), §E (volume), §F (fiscal).
- [../../04-screen-dossier/dossiers/retaguarda/uCadBancos.md](../../04-screen-dossier/dossiers/retaguarda/uCadBancos.md) — o piloto (tabela única) que precede esta entidade.
