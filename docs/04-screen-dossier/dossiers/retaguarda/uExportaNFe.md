# FRMEXPORTANFE — Exportação de NF-e

**15 acessos · 2 operadores.** `uExportaNFe.pas` (687). Migration **259**.
API `GET fiscal/nf-exportacao` · `GET fiscal/nf-exportacao/:codnf/xml`. Tela `/fiscal/nf-exportacao`. Smoke §137.

## 1. O que faz

Lista as notas eletrônicas do período e, para as selecionadas, salva o **XML** (`SalvaXMLNFe` — um arquivo
`<chave>-NFe.xml` por nota, a partir de `NF.NFE_XML`) e/ou o **DANFE em PDF** (`ImprimirNFE(true, <chave>.pdf)`)
numa pasta escolhida; a mesma grade reenvia e cancela. No cliente: **43.185 XMLs** guardados (`NFE_XML`); 747
NF-e modelo 55 em 2026 (711 com chave), 958 em 2025.

## 2. Aqui

A lista das notas eletrônicas do período (chave, status SEFAZ, se há XML guardado — `nfe_xml`, que o Apollo já
alimenta na transmissão e no recebimento) e o XML de cada nota para ver e copiar. Transmitir / cancelar /
carta de correção já são a `fiscal/nf`.

## 3. Folds

- **DANFE em PDF**: o Apollo não tem renderizador de DANFE — fica de fora, declarado.
- Salvar em pasta do servidor: o navegador não escreve em pasta; o XML é entregue para copiar/baixar.
- Tenant-scoped; pedir o XML de nota de outra loja é "não encontrado".
