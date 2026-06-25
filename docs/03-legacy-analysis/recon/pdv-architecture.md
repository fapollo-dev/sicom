# Arquitetura do PDV legado (`vendas-master`)

> Reconhecimento do **PDV/frente de caixa** — a metade do sistema onde vivem o **offline (ADR-008)**, TEF, ECF/fiscal e periféricos. Achado central: **o offline-first já existe no legado** — o PDV opera contra um **banco local embarcado** e sincroniza com a **central Oracle**, via replicação. Não é greenfield: há um precedente funcional a entender e preservar. Análise estática read-only sobre `/Library/SicomGit/vendas-master`.

## Pré-requisitos de leitura

- [mapa-reconhecimento.md](mapa-reconhecimento.md) — §B (módulos), §F (risco-coroa), §D (replicação `REMESSA_SERVER`).
- [../../00-orientation/canonical-decisions.md](../../00-orientation/canonical-decisions.md) — **ADR-008** (PDV offline-first em Electron), **ADR-001** (edge+nuvem).
- [../../01-architecture/](../../01-architecture/) — arquitetura-alvo edge↔nuvem e sync offline.

---

## 1. Estrutura de build (loader + DLL)

- **`Pdv.dpr` é um `program`** (o executável-loader): faz `LoadLibrary` e chama uma função exportada (`ShowFormDLL_`) — uma casca fina.
- **`ApPDV.dpr` é uma `library` (DLL)** — o PDV real mora aqui. Padrão **loader-EXE + DLL** (permite trocar a DLL sem trocar o loader; ecoa a "janela de versão" da [ADR-009](../../00-orientation/canonical-decisions.md)).
- ~60k linhas, 104 `.pas`. **Arquitetura mais em camadas** que a retaguarda: `BO/` (business objects), `VO/` (value objects), `Tef/`, `Componentes/`, `Aut/`, `CargaCliente/`, `Units/`, `Util/`.

### Camadas BO/VO (diferente da retaguarda plana)
- **`BO.*`** (regra): `BO.Caixa`, `BO.CodigoPromocional`, `BO.TrocoSolidario`, `BO.Vasilhame`, `BO.PesquisaSatisfacao`.
- **`VO.*`** (dados/entidades): `VO.Vendas`, `VO.CX_Vendas`, `VO.Caixa`, `VO.Finalizadoras_Caixa`, `VO.Forma_Pagamento`, `VO.Operador`, `VO.MovContasBancarias`, `VO.HistSangriaSuprimento`, **`VO.Remessa`** (replicação no lado PDV), etc.

> Para a migração isto é **bom**: BO/VO já separam regra de dado — mais perto da camada service/entidade do alvo que a retaguarda (onde regra+UI+SQL estão misturadas). O dossiê do PDV parte de um código mais organizado.

---

## 2. O modelo offline (o achado central) — `Util/uConexao.pas`

`TConexao` é um **singleton** (`class var FInstance`) com **duas conexões FireDAC** simultâneas:

| Conexão | Tipo (`TTipoConexaoBanco`) | Driver | Banco | Papel |
|---|---|---|---|---|
| `FConexaoPDV` | `tcbPDV` | **`DriverID=IB`** (Firebird/Interbase **embarcado**) | local, caminho do parâmetro de config **`BD LOCAL`** | **operação offline** — vender sem internet |
| `FConexaoRetaguarda` | `tcbRetaguarda` | **`DriverID=Ora`** (Oracle) quando config `BANCO DE DADOS = 'ORACLE'` | central da loja/retaguarda | sync / consulta central |

- Drivers linkados: **SQLite, Interbase/Firebird e Oracle** (`FireDAC.Phys.SQLite/IB/Oracle`). O **local hoje é Firebird embarcado** (per o bloco `tcbPDV`); SQLite está disponível (instalações mais novas podem usá-lo — confirmar no runtime/config real).
- Config vem de uma **tabela/dataset de configuração** (`vConfig`, chaves `'BD LOCAL'`, `'BANCO DE DADOS'`) — o PDV se autoconfigura por parâmetro, não por hardcode.

> **Implicação para [ADR-008](../../00-orientation/canonical-decisions.md):** o offline-first **não é invenção nova** — o legado já roda o caixa contra um **DB local embarcado** e fala com a **central Oracle** à parte. O alvo (Electron + DB local + sync ao edge) tem um **precedente funcional**: vale extrair a semântica de o-que-fica-local, o-que-sincroniza e como concilia. A novidade do alvo é a casca (Electron/web) e o sync explícito — não o conceito.

---

## 3. Sync / replicação no PDV

- `VO.Remessa` (lado PDV) + a tabela/mecanismo `REMESSA_*` da central ([mapa-reconhecimento.md §D](mapa-reconhecimento.md)) formam o canal **loja↔central**. Mesmo padrão de outbox por terminal (`CODTERMINAL`) visto na retaguarda.
- `CargaCliente/` sugere **carga inicial** de cadastros (produtos/clientes/preços) para o PDV operar offline — o "que precisa estar local" da [ADR-008](../../00-orientation/canonical-decisions.md). Confirmar conteúdo no runtime.

---

## 4. Risco-coroa concentrado no PDV (TEF + fiscal + periféricos)

- **TEF em dois modos**: `Componentes/UtefDiscado.pas` (**discado**) e `UTefDedic.pas` (**dedicado/integrado**), com toda a UI de fluxo: `uInformacaoTEF`, `UaguardeTEF`, `UcoletaTef`, `UMenuTefd`, `UmsgTEF2`, `URealizaTransacao`, `UBandeiras`, `UgeraCheque`/`UdadosCheque`. Mais os diálogos genéricos em `Tef/` (`uTEF`, `uTEFLeCheque/LeDigitos/LeSimNao/Mensagem`).
- **ECF / fiscal**: `UlancamentoECF` (resquício de ECF/impressora fiscal antiga) + NFC-e/SAT via **ACBr** ([mapa-reconhecimento.md §F](mapa-reconhecimento.md)).
- **Periféricos**: impressora (ACBrPosPrinter), balança (ACBrBAL), gaveta, pinpad — a "camada de drivers no Electron" da [ADR-008](../../00-orientation/canonical-decisions.md).

> Trilha de risco dedicada (canon). O PDV é onde **offline + fiscal + TEF + periférico + teclado** convergem — o subsistema mais perigoso e o último a migrar no strangler.

---

## 5. O que isto muda no entendimento do projeto

1. **Offline tem precedente** — modelar o alvo a partir do que o legado já faz (local embarcado + central + remessa), não do zero.
2. **PDV ≠ retaguarda em maturidade** — BO/VO ajudam; o dossiê do PDV é mais limpo, mas o **risco-coroa** (TEF/fiscal/periférico) é todo dele.
3. **Build loader+DLL** ecoa a necessidade de atualizar o PDV em campo sem big-bang ([ADR-009](../../00-orientation/canonical-decisions.md)).
4. **Pilotos da Fase 1 ficam na retaguarda** (cadastros) — o PDV entra **depois**, com a trilha fiscal/TEF já amadurecida.

## Pendências (confirmar no runtime / banco-sombra)

- Banco local **atual** é Firebird embarcado ou já SQLite? (ler config real `BD LOCAL`).
- O que a **carga inicial** (`CargaCliente`) baixa para o PDV operar offline.
- Como a **conciliação** de venda offline acontece (idempotência, numeração/série, contingência fiscal).

## Ver também

- [mapa-reconhecimento.md](mapa-reconhecimento.md) — §B/§D/§F.
- [form-base-cadmaster.md](form-base-cadmaster.md) — o engine CRUD (retaguarda); o PDV tem padrão próprio (BO/VO).
- [../../00-orientation/canonical-decisions.md](../../00-orientation/canonical-decisions.md) — ADR-001/008/009.
