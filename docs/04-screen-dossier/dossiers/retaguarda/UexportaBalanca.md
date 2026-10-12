# EXPORTAR PARA BALANÇA (`FRMEXPORTABALANCA`, `UexportaBalanca.pas`)

> Fonte: `UexportaBalanca.pas` (629 linhas) + `.dfm`, `uConfigExportaBalanca.pas` (o Configurador), `uDMConfExportaBalanca.dfm`
> (`SELECT CB.*, E.RAZAOSOCIAL FROM CONFIG_BALANCA CB JOIN EMPRESAS E`). Produção (MENUEXPRESS): **9.650 acessos, 43 operadores**; LOG
> "Exportar para balança": 4.303 em 2026 (loja 1: 3.035 / 19 operadores; loja 2: 1.266 / 11). Apollo: `/cadastro/exporta-balanca`
> (`GET configs`, `POST configs`, `DELETE configs/:id`, `POST gerar/:id`, `POST gerar-lote`). Smoke §47i (.1–.7) e o configurador;
> jsdom `exportaBalanca.spec.tsx`.

## 1. O que a tela faz

Gera os arquivos que o software MGV das balanças Toledo carrega (e, para Filizola, os da Filizola): o PLU é o código de barras curto
(≤ 6 dígitos), com preço (a promoção quando ativa, em centavos), validade e descrição (`DESCRICAO_BALANCA` ou a do produto). A grade
"Lista de empresas configuradas para exportação" mostra a `CONFIG_BALANCA` de cada loja; o operador marca as linhas e "Exportar"
grava, para cada loja marcada, os arquivos no diretório dela e roda o `Config\CargaBalanca.bat` da estação.

## 2. Os cortes anteriores

- **corte-1** (`796a0c7`, 31/07/2026): TXITENS (320), CADASTRO (83), ITENSMGV (Prix4-N 113 / Prix5-N 150), posição a posição; o filtro
  de ativo pela config `ATIVO_PELA_MULTIPRECO` (`/*ATIVO*/`); a flag peso/unidade pela SIGLA da unidade (no Oracle `p.unidade <> ''`
  nunca é verdade).
- **corte-2** (mig 274): **INFNUTRI.TXT** (a tabela nutricional da Toledo, só para `EXPDADOSNUTRICIONAIS = 'S'`).
- o Configurador (`BTNCONFIGURABAL`): diretório, tipo, modelo, campo do setor e as flags, com as regras do `btnAddItemClick`.

## 3. A auditoria controle a controle (12/10/2026)

| Controle do legado | Antes no Apollo | Agora |
|---|---|---|
| A grade lista a config de **todas** as lojas (`MostrarEmpresas`, sem filtro de loja), por IDEMPRESA, com a razão social | só a config da loja da sessão | as configs de todas as lojas que o operador alcança (a da sessão + `RELACAO_OPERADOR_EMPRESA`), com as colunas do legado: Selecionar, Empresa, razão social, Tipo, Modelo, Ex.Tabela Nutricional, Ex.Receita, Ex. tara, Campo do setor, Diretório |
| "Selecionar" + **T marca todas** + `&Exportar` com as marcadas | um botão "Gerar arquivos" por linha | igual ao legado; nada marcado → "Selecione os registros na grade á exportar e tente novamente!"; o Exportar desabilita sem config (`PermiteExportar`) |
| Cada loja gera com o **preço dela** (`cdsBusca.Params[0] := CodEmpresa` — MULTI_PRECO da loja da config) | a loja da sessão | a loja da config (o filtro de ativo também pela config dela) |
| Loja sem produto: "Não foi encontrado produto para balança." e as outras seguem (o `Exit` sai só da loja) | erro | aviso por loja |
| Cada loja no diretório dela | — | uma loja baixa os .TXT; várias, um `Balanca.zip` com uma pasta por loja (a última pasta do diretório configurado: `LJ1/`, `LJ2/`) |
| A Empresa do Configurador (`edtCODEMPRESA` + pesquisa) | sempre a da sessão | qualquer loja do operador |
| INFNUTRI só com o "Ex.Tabela Nutricional" da config (`if (ExportaTabela) and …`, :130) | ⛔ saía sempre que o produto tinha o flag | só com a config marcada (as duas da produção estão com S — sem efeito hoje) |

**Uso que justifica a lote** (LOG da produção, 2026): **227 vezes** o mesmo operador gravou duas linhas no mesmo segundo — as duas
lojas exportadas num clique. A LOG leva a loja da **sessão** (os pares são "1,1" 213 vezes e "2,2" 13), e o Apollo grava igual.

Fora, com prova (produção, só leitura, 12/10/2026):
- **TXINFO.TXT / REC_ASS.TXT** (receita): a fonte é `RECEITAS` (`left join receitas r on r.idproduto = p.idproduto`) — **0 linhas**
  (as duas configs têm `EXPORT_RECEITA = 'S'`, mas o arquivo sai vazio no legado). O `CODRECEITA` do ITENSMGV sai 000000, igual.
- **TARA.txt** e o ITENSMGV v4 com tara: `EXPORTA_TARA = 'N'` nas duas configs, `TARA` com **0 linhas**, nenhum produto com `TARA_ID`.
- **Filizola** (CADTXT/SETORTXT/NUTRI/REC_ASS): nenhuma config Filizola.
- `EXPORTA_RDC429` (coluna do binário novo, ausente do fonte de 2020): 'N' nas duas.
- o `CargaBalanca.bat` e a gravação no `D:\Dados\Balanca\LJn` são da estação Windows — a entrega web é o download.
