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

## 7. Corte-1 ENTREGUE — o catálogo e o executor (`mig 202`, smoke §95, 1081/0)

### 7.1 O achado que encurtou o trabalho

O usuário disse: *"isso já funciona 100%, só analisar nosso banco de dados"* — e estava literalmente certo.
**O catálogo do legado não é uma tabela: é o COMENTÁRIO da view.** `GET_CARTAOBX` tem
`COMMENT = ';CARTOES BAIXADOS'`, e é esse rótulo que a tela mostra no combo de fontes e que fica gravado no
campo `TABELA` de cada definição. São **198 das 417 views** que têm rótulo — e são exatamente as ofertadas
(é o filtro do `SetaViews`). Não havia catálogo a escrever: havia catálogo a **ler**.

A mig 202 copiou os rótulos do cliente para as **28 views que já existem no Apollo**, e o serviço lê o
catálogo do mesmo lugar (`obj_description`). Cada view nova que portarmos entra sozinha, bastando o comentário.

### 7.2 O que entrou

- **Catálogo de fontes** (`/relatorios/construtor/fontes`) e **campos por fonte**, com tipo e formato sugerido
  (numérico com nome de dinheiro vira moeda; data vira data) — o cliente troca no construtor, como no legado.
- **`relatorio_definicao`** (JSON, a mesma forma do XML campo a campo) e **`relatorio_definicao_hist`**: cada
  gravação guarda a versão anterior, com autor e data. É o que o XML de 4 KB do legado não tem.
- **Executor**: colunas na ordem definida, com o título do cliente, condições salvas + filtros de execução,
  ordenação e **totais de rodapé** nas colunas marcadas. Coluna **calculada** (`CAMPO1` operação `CAMPO2`)
  com proteção de divisão por zero.
- **CSV** com `;` e vírgula decimal — o que o Excel pt-BR abre sem perguntar (o `BtnExportaCSVClick`).
- Tela de execução em `/relatorios/construtor`, com filtro por campo e exportação.
- RBAC **separado** como no legado: `FRMRELATORIO` (rodar, 1.251 acessos) × `FRMCADASTRORELATORIO`
  (cadastrar, 73). Quem executa não precisa poder criar.

### 7.3 A superfície de injeção, e como está fechada

Um construtor de consulta é o lugar onde um nome de campo vira SQL. Três travas, todas com teste no smoke:

1. a **fonte** tem de ser uma view **com rótulo** — `operadores` não é fonte e devolve `FONTE_NAO_CATALOGADA`;
2. todo **campo** (coluna, calculada, condição, ordenação, agrupamento) é conferido contra o
   `information_schema` **daquela fonte** antes de qualquer SQL ser montada, e só então vira `sql.ref`;
3. todo **operador** vem de uma lista fechada e todo **valor** viaja como parâmetro.

### 7.4 O que fica

*(corte-2 fechado na seção 8.)* Corte-3: importar os 95 XMLs do cliente, portar as quatro views que destravam
24 relatórios (`GET_RCB` sozinha vale 13) e a saída em PDF.

## 8. Corte-2 ENTREGUE — o construtor pela tela (smoke §95.8, 1082/0)

A tela que dá autonomia ao cliente, e a razão de ele ter 95 relatórios próprios. Faz o que a do legado faz
(`uRelatorio.pas`): escolher a fonte, adicionar campos, **subir e descer** para ordenar
(`btnUpClick`/`btnDownClick`), título e largura por coluna, **coluna calculada** (`btnAddCalculadosClick`),
**condições**, marcar o que **totaliza** e escolher paisagem.

Três diferenças conscientes:

- **a prévia roda sem gravar** — é como se confere antes de salvar; no legado é preciso salvar a estrutura
  primeiro;
- **trocar de fonte diz o tamanho do prejuízo**: o legado avisa "ao mudar de tabela a configuração efetuada
  será perdida" (`cbbTabelaShowCloseUp`); aqui a confirmação diz **quantas colunas** serão perdidas;
- **a fonte aparece pelo rótulo** ("CONTAS A PAGAR"), não pelo nome da view — e a lista de campos mostra o
  tipo ao lado, que é o que decide se o campo pode entrar numa conta.

Rotas: `/relatorios/construtor/novo` e `/relatorios/construtor/:cod/editar`, ambas atrás de
`FRMCADASTRORELATORIO` — separado de quem só executa.
