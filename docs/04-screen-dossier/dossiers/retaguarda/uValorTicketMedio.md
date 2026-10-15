# VALOR DO TICKET MÉDIO (`FRMVALORTICKETMEDIO`, `uValorTicketMedio.pas`) — auditoria controle a controle (15/10/2026)

| | |
|---|---|
| **Tela** | `/relatorios/ticket-medio` (`RelTicketMedioPage`) · API `relatorios/ticket-medio` |
| **Uso** | 1.417 acessos (MENUEXPRESS: "Valor ticket medio" + "Produtos") |
| **Já convertido** | o SQL do `aqqValorTicketMedio` (nível cupom → dia; líquido = bruto [IAT A arredonda, senão trunca] + acréscimos − descontos; COUNT(NROCUPOM) ignora nulos; os 3 modos de hora; o dia no fuso do negócio) — smoke TICKET MÉDIO |

| Controle do legado | Apollo |
|---|---|
| `edtDtInicial`/`edtDtFinal`, `edtHrInicial`/`edtHrFinal` (00:00/23:59), `btnProcessar`, os totais (QTDE_CUPONS_TOTAL, MEDIA_TOTAL, TOTAL_VENDA_TOTAL) | ✅ já havia |
| `CbFiltroHora` — `CbFiltroHoraClick` marca junto o `cbHoraPorDia` (e desmarcar desmarca) | ✅ a tela agora segue (antes ficava desmarcado: o padrão do legado é a faixa em cada dia) |
| As lojas (`GetMultiEmpresa` no /*IDEMPRESA*/) | ✅ "Empresas" — as do operador (antes só a do login) |
| `btnImprimir` (Rel_TicketMedio.fr3: frxDBDataset1 FANTASIA/IDEMPRESA/DTVENDA/QTDE_CUPONS/TOTAL_VENDA/MEDIA/TOTAL_VENDA_TOTAL, frxDBEmpresa) | ✅ `POST relatorios/ticket-medio/impressao` (MEDIA_QTDE_PRODUTOS_CUPOM e AREAM2_VENDA, do layout do binário novo, não existem no SQL do fonte — em branco) |

Smoke §325.
