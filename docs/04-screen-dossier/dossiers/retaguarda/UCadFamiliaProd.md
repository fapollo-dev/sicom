# UCadFamiliaProd — Cadastro de categorias e departamentos (FRMCADFAMILIAPROD)

Convertida em 25/09/2026 (a API existia com 2 das 29 colunas e o domínio do TIPO errado; a web não tinha a tela). Smoke §228-§229.

## O TIPO (UCadFamiliaProd.dfm:105-122)
| valor | legenda | produção |
|---|---|---|
| D | Departamento | 34 |
| G | Grupo | 92 |
| S | Subgrupo | 520 |
| P | **Grupo de preço** | 1.818 (9.397 produtos apontam o CODGRUPOPRECO para elas) |
| R | Produção | 1 |
| O | Seção | 1 |
| E | Setor (binário novo) | 6 |

O Apollo tinha R como grupo de preço e recusava P e E.

## Regras (todas no gravar/excluir do servidor, `familias.crud.ts`)
- Subgrupo: departamento/grupo/seção/setor têm de ser do tipo certo e ativos (`CheckAtivo(... AND TIPO = 'D')`, :367-590), cobrado quando
  o campo muda; mensagens do `GetMsgFamiliaProdInativo` (udmPrincipal.pas:2608).
- Setor de perda padrão: um só (`ExisteValorPadrao`, :343) — nunca usado na produção (0 linhas), mas a regra fica.
- Excluir: recusado se algum produto usa a família (departamento, grupo, subgrupo, grupo de preço, seção — :264-290; a coluna
  PRODUTOS.CODSETOR do SQL do legado não existe na produção); senão é **lógico**: EXCLUIDO 'S', ATIVO 'N' (1 linha assim na produção).
  O motor de CRUD ganhou `exclusaoLogica` para isso.
- Inclusão: ATIVO 'S', a loja da sessão (92 de 92 em 2025-26) e os carimbos do form-base.

## Fora, com prova
- Aba Área (FAMILIAS_PROD_AREA, com as somas por departamento/grupo/seção de `ValidaArea`): a tabela está vazia na produção.
