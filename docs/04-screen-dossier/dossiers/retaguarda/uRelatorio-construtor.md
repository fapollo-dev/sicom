# CONSTRUTOR DE RELATÓRIOS (`FRMRELATORIO` / `uRelatorio.pas`) — recon e proposta

Pedido do usuário: *"existem configurações de relatórios específicas para cada cliente em que na
frmrelatoriogeral faz a criação desses relatórios até mesmo pelo próprio cliente, é uma solução simples e
prática, mas caso tenha algum recurso melhor ou mais otimizado estou à disposição para me apresentar a ideia"*.

## 1. O que existe hoje, medido

| | |
|---|---|
| `FRMRELATORIO` "Relatório Geral" | **1.251 acessos**, último em **02/09/2026** |
| `FRMCADASTRORELATORIO` "Cadastro de Relatórios" | 73 acessos, último em 21/08/2026 |
| `uRelatorio.pas` | 3.445 linhas (a tela é o construtor E o executor) |
| layouts `.fr3` em `RELATORIOS` | 1.227 linhas · **659 nomes distintos** · 54,5 MB · **624 personalizados** |
| definições em `RELATORIOS_CUSTOMIZADOS` | 109 linhas · **95 nomes distintos** · 520 KB |
| views de origem no Oracle | **417** `GET_*` |

É a segunda tela de relatório mais usada do sistema — atrás só do `FRMRELVENDAS` (20.937 acessos), que já
migramos como hub.

## 2. O modelo do legado (decodificado de uma definição real)

Cada relatório do cliente é um XML `GET_<VIEW>_<NOME LIVRE>.XML` cujo `ROWDATA` tem duas partes:

- **um cabeçalho** (`cdsConfiguracoes`): `TITULO_REL`, `MOSTRA_SOMENTE_AGRUPAMENTO`, `SALTAR_PG_GRUPO`,
  `IMPRIMIR_EM_PAISAGEM`;
- **uma linha por coluna** (`cdsCamposAImprimir`): `CAMPO`, `TITULO`, `TAMANHO`, `POSICAO`, `LINHA`,
  `TABELA` (o rótulo humano da fonte — ex.: "CARTOES BAIXADOS") e, quando é coluna calculada,
  `CAMPOCALC` + `CAMPO1` + `OPERACAO` + `CAMPO2` + `FORMULA` + `VALOR_PERC` + `TOTALIZAR` + `CONDICAO`.

Exemplo real (`GET_CARTAOBX_CARTAO TAXA.XML`, 13 linhas): fonte "CARTOES BAIXADOS", colunas Código, Lote,
Data, Data Baixa, Cod Operadora… cada uma com título, largura e posição.

O que a tela oferece (`uRelatorio.pas`): escolher a fonte, adicionar/remover campos, **subir e descer** para
ordenar, **campos calculados**, **condições** (o WHERE), salvar a estrutura, imprimir pelo FastReport e
exportar **CSV** e **Excel**.

⇒ **O usuário tem razão: é simples e prático, e o desenho está certo.** O cliente escolhe uma fonte, monta as
colunas e salva. Não há nada a inventar aqui — há o que melhorar em volta.

## 3. Cobertura: quanto disso o Apollo já sustenta

Casando cada um dos 95 relatórios do cliente com a view de origem, e a view com o que já portamos:

| | |
|---|---|
| a fonte **já existe no Apollo** | **42 (44%)** |
| a fonte ainda não foi portada | 45 |
| base não identificada pelo nome | 8 |

As que faltam se concentram: **`GET_RCB` sozinha responde por 13 relatórios**; depois `GET_APAGARBX` (4),
`GET_ARECEBERBX` (4), `GET_CP_CEN` (3). Ou seja, **portar 4 views cobre 24 dos 45 que faltam**.

## 4. A proposta

Manter o modelo e mudar três coisas.

### (a) A fonte deixa de ser uma view opaca — vira um CATÁLOGO

Hoje o cliente escolhe `GET_CARTAOBX` e vê nomes de coluna crus. A proposta é um catálogo de fontes com
metadados: rótulo em português, descrição, e por campo o tipo, o rótulo, o formato (moeda/data/quantidade) e
se aceita filtro. O construtor passa a ser navegável por quem não conhece o banco — que é justamente quem usa.

Bônus que sai de graça: as 47 views que já portamos entram no catálogo sem trabalho novo, e o **RBAC por
fonte** passa a existir (hoje quem abre a tela vê todas as 417).

### (b) A saída deixa de ser só papel

A mesma definição rende **tela** (grid ordenável e filtrável, que é como se confere), **CSV**, **Excel** e
**PDF**. Hoje o `.fr3` é papel e o CSV/Excel são exportações separadas do grid, com regras próprias.

### (c) A definição vira DADO versionado, não um XML opaco

A definição passa a ser JSON no Postgres, com quem alterou e quando. Dá para comparar duas versões, voltar
atrás e auditar. Hoje são 4 KB de XML binário sem histórico.

### O que NÃO propor, e por quê

**Renderizar o `.fr3` no servidor.** Não existe biblioteca livre que leia o formato do FastReport; manter isso
nos prenderia ao Delphi para sempre. Os 659 layouts continuam sendo dado do cliente (a mig 197 já os traz na
carga e eles ficam guardados), mas o Apollo desenha a saída a partir da definição, não do `.fr3`.

## 5. Cortes propostos

1. **catálogo + executor + tela de execução** — o cliente roda os relatórios que já existem, com filtro de
   período e exportação CSV/Excel. É o valor imediato: cobre os 42 que já têm fonte.
2. **o construtor** — montar e editar: escolher fonte, colunas, ordem, títulos, larguras, campos calculados,
   condições, totais e agrupamento. É o que dá autonomia ao cliente.
3. **importador dos 95 XMLs** + as 4 views que destravam 24 relatórios + saída PDF.

## 6. Pergunta que fica para o cliente

Dos 659 layouts, **quantos ele realmente usa?** O nome sugere muita duplicata de teste
(`dup_Duplicata001_1ddd.fr3`, `GET_PRODUTOS_PRODUTOS_WIL`, `..._LETICIA`, `..._TESTE`). Saber quais são os
vivos muda o tamanho do corte-3 — e é informação que só ele tem.
