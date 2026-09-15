# LAYOUT DA GRADE POR OPERADOR — o `[F8]`/`[F9]` do legado

Não é uma tela: é um recurso que aparece em **16 units** do legado, sempre no menu de contexto da grade —
*"Salvar Configurações do Grid [F8]"* e *"Carregar Configurações Originais da Grid [F9]"*.

## 1. O que o legado faz, e onde isso falha

```pascal
cxgridProdutosTableViewProd.StoreToIniFile(
  DirConfiguracoesGrid + 'GridPrecificacaoNF_Operador' + CODOPERADOR + '.ini', ...)
```
(`uPrecificacaoNF.pas:1113`)

Um **arquivo `.ini` no disco da estação**, um por operador e por tela. Resolve enquanto a pessoa usa sempre a
mesma máquina — e falha **em silêncio** no dia em que ela senta noutro caixa, ou em que a estação é
reinstalada: o layout simplesmente não está lá, e ninguém associa uma coisa à outra.

## 2. O que fazemos

O layout vai para o banco (`grade_layout`, mig 219), **por operador e empresa**, e segue a pessoa. Uma linha
por `(operador, empresa, tela, visão)`; salvar de novo **substitui**, senão a tabela viraria um log de cada
arrastada de coluna.

O navegador continua guardando uma cópia local — o `persistId` do `DataTable` —, então:

- a grade abre com o layout certo **antes** de a resposta chegar;
- e continua abrindo se o servidor estiver fora.

⚠️ **falhar aqui não pode quebrar a tela.** Layout é conforto: se a chamada falhar, a grade abre com o cache
ou com o padrão e o operador segue trabalhando. Por isso o `list` do adapter devolve `[]` em erro, em vez de
estourar.

## 3. O que ganhamos além do `.ini`

**Visões nomeadas.** Além do layout corrente (`default`), o operador salva recortes com nome — "Só margem",
"Conferência rápida" — e pode marcá-los como **públicos** para a equipe. O arquivo `.ini` nunca deu isso.

O `[F9]` continua existindo: apagar a visão `default` faz a tela voltar ao padrão de fábrica, **sem** perder
as visões nomeadas.

## 4. ⚠️ Sem RBAC, de propósito

Salvar o layout da **própria** grade é preferência, não privilégio — e o legado também não pede permissão: o
item está no menu de contexto, disponível a quem abriu a tela. Exigir permissão aqui impediria justamente
quem só tem acesso a uma tela de arrumar a grade dela.

O escopo é garantido pelo serviço: ele só enxerga o operador da sessão, e nunca lê nem escreve o layout de
outra pessoa (as visões públicas são as únicas que atravessam, e só para leitura).

## 5. Onde já está ligado

`precificacao-nf` · `conferencia-nf-indexador` · `lancamentos-contabeis` · `produtos-rel` · `ajuste-estoque` ·
`pedido-compra` · `devolucao-compra` · `agenda-promocao`.

Telas com **mais de uma grade** recebem um `persistId` por grade (`pedido-compra`, `pedido-compra-2`), senão
as duas dividiriam o mesmo layout — e mexer numa bagunçaria a outra.

## 6. Cobertura (§111 do smoke, 4 checks)

1. o layout volta inteiro do banco: colunas escondidas, ordem, larguras e densidade;
2. salvar de novo **substitui** em vez de empilhar;
3. visões nomeadas e públicas, e o escopo por tela (uma não vaza para a outra);
4. o `[F9]`: apagar o `default` volta ao padrão **sem** perder as visões nomeadas.

## 7. O que falta

- ligar nas demais telas conforme forem sendo usadas — é uma linha por grade;
- o legado guarda também filtro e sumário (`gsoUseFilter`, `gsoUseSummary`); o `DataTable` persiste filtro,
  busca e agrupamento no mesmo snapshot, então isso já vem junto onde a tela usa esses recursos.
