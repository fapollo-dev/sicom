# Anatomia Delphi para agentes

> O que é um projeto Delphi por dentro — `.dpr`, `.pas`, `.dfm`, `.dproj` — e como **ler e parsear** esses arquivos para extrair o que o sistema faz. O `.dfm` é **texto serializado parseável**: dele saem o scaffold React, o taborder, os mnemônicos `&` e o mapa de event handlers que alimenta o dossiê (seção 04) e a camada de teclado.

## Pré-requisitos de leitura

- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — a tese "não migre o que você vê, migre o que o sistema faz" e a vantagem **procedural** do legado.
- [../00-orientation/glossary.md](../00-orientation/glossary.md) — `.dpr`/`.pas`/`.dfm`/`.dproj`/`TForm`/`TDataModule`/`TQuery`/`TDataSource`/`TabOrder`/`&`.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-010** (mnemônicos extraídos do `.dfm`) e **ADR-012** (toda tela passa por dossiê).
- [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md) — consumidora do mapa de teclado que o parser de `.dfm` produz.

> Este arquivo é a **base de alfabetização**. Os dois arquivos-coroa da seção — [dynamic-sql-extraction.md](dynamic-sql-extraction.md) e [business-rule-extraction.md](business-rule-extraction.md) — assumem que você já sabe o que é um `.pas` e um `.dfm`. As armadilhas de estado escondido ficam em [hidden-coupling-traps.md](hidden-coupling-traps.md).

---

## Por que um agente precisa disto

Você pode nunca ter aberto o Delphi IDE. Não precisa. Um projeto Delphi é um punhado de tipos de arquivo-texto com papéis bem definidos, e **três dos quatro são parseáveis sem nenhuma ferramenta proprietária**. A migração não roda o Delphi — ela **lê** o Delphi. Saber qual arquivo guarda o quê é o que separa "olhei a tela" (proibido) de "li o que a tela faz" (obrigatório).

A regra de ouro desta seção: **o `.dfm` te dá a casca (o que aparece, a ordem do teclado, quais eventos existem); o `.pas` te dá o miolo (o que cada evento faz, a SQL, a regra).** Você precisa dos dois, casados.

---

## Os quatro tipos de arquivo

| Extensão | É | Equivalente conceitual no alvo | Parseável? |
|----------|---|--------------------------------|------------|
| `.dpr` | Projeto / entry point. Lista as units, cria a `Application`, instancia os forms iniciais. | `main.ts` + config do app | Sim (texto Pascal curto) |
| `.pas` | **Unit** de código Object Pascal: a classe do form/datamodule, os métodos, os **event handlers**, a lógica, a SQL dinâmica. | Service/controller (NestJS) ou componente (React) | Sim (texto Pascal) |
| `.dfm` | **Form** serializado: árvore de componentes com layout (Left/Top/Width/Height), propriedades, **bindings de evento** (`OnClick = ...`) e SQL de design-time (`SQL.Strings`). | JSX + props (a tela); **fonte do scaffold, taborder, mnemônicos, handlers** | **Sim — é o que mais importa** |
| `.dproj` | Config de build (MSBuild XML): plataformas, defines, libs, opções de compilador. | `package.json` / config de build | Sim (XML), mas raramente útil p/ migração de regra |

Pareamento: **cada `.dfm` tem um `.pas` de mesmo nome** (`CadProduto.dfm` ↔ `CadProduto.pas`). Eles descrevem **a mesma classe** — o `.dfm` é a parte declarativa (componentes), o `.pas` é a parte imperativa (código). É o mesmo padrão de um componente React onde o JSX e os handlers convivem, só que aqui estão em dois arquivos.

---

## O `.dpr` — entry point

Curto e quase sempre boilerplate. Serve para descobrir **quais units existem** e **qual form abre primeiro**.

```pascal
program SuperERP;

uses
  Forms,
  Principal in 'Principal.pas' {frmPrincipal},
  CadProduto in 'cad\CadProduto.pas' {frmCadProduto},
  ConsultaProduto in 'cad\ConsultaProduto.pas' {frmConsultaProduto},
  DMPrincipal in 'DMPrincipal.pas' {dmPrincipal: TDataModule},   // <- datamodule global
  Venda in 'pdv\Venda.pas' {frmVenda};

{$R *.res}

begin
  Application.Initialize;
  Application.CreateForm(TdmPrincipal, dmPrincipal);   // datamodule criado PRIMEIRO e fica vivo
  Application.CreateForm(TfrmPrincipal, frmPrincipal);
  Application.Run;
end.
```

O que extrair daqui:

- **Inventário de units** (o `uses`): cada par `Unit in 'caminho.pas' {Form}` é uma tela ou um datamodule. Vira a lista de telas a serem dossiadas.
- **Datamodules criados no boot** (`CreateForm(TdmPrincipal, ...)` antes do form principal): são **estado global vivo durante toda a sessão** — a fonte número um de acoplamento oculto. Marque-os já aqui; eles voltam em [hidden-coupling-traps.md](hidden-coupling-traps.md).
- A ordem de criação importa: o datamodule existe antes de qualquer tela, então qualquer tela pode depender dele estar pronto.

---

## O `.pas` — a unit de código

Aqui mora o miolo. Estrutura típica de um `.pas` de form:

```pascal
unit CadProduto;

interface

uses
  Windows, Messages, SysUtils, Classes, Forms, StdCtrls, DB, DBClient, Mask;

type
  TfrmCadProduto = class(TForm)
    edCodigo: TEdit;            // <- estes campos espelham os componentes do .dfm
    edDescricao: TEdit;
    edPreco: TEdit;
    btnSalvar: TButton;
    qryProduto: TFDQuery;       // dataset (tem SQL de design-time no .dfm)
    procedure btnSalvarClick(Sender: TObject);   // <- event handler (ligado pelo .dfm)
    procedure edPrecoExit(Sender: TObject);
    procedure FormShow(Sender: TObject);
  private
    procedure CalcularMargem;   // método auxiliar (não é evento)
  public
    ProdutoId: Integer;         // estado público — outra tela pode setar isto antes de abrir
  end;

var
  frmCadProduto: TfrmCadProduto;

implementation

{$R *.dfm}    // <- ESTA diretiva amarra este .pas ao .dfm de mesmo nome

procedure TfrmCadProduto.btnSalvarClick(Sender: TObject);
begin
  if Trim(edDescricao.Text) = '' then
  begin
    ShowMessage('Descrição obrigatória');   // validação — regra de negócio (seção 03)
    edDescricao.SetFocus;
    Exit;
  end;
  CalcularMargem;
  // ... monta SQL, ParamByName, ExecSQL ...   (extração em dynamic-sql-extraction.md)
end;

procedure TfrmCadProduto.edPrecoExit(Sender: TObject);
begin
  CalcularMargem;   // recalcula ao sair do campo preço (OnExit)
end;

end.
```

Pontos de leitura para o agente:

- A seção `class(TForm)` no `interface` **lista os componentes** (campos) e **os handlers** (os `procedure ...Click/Exit/Show`). Cruze com o `.dfm` para saber qual evento de qual componente chama qual método.
- A diretiva `{$R *.dfm}` é o que **carrega o `.dfm` em runtime**. É a prova de que o par `.pas`/`.dfm` descrevem a mesma classe.
- Métodos **sem** correspondente `On...` no `.dfm` (como `CalcularMargem`) são **lógica interna** — quase sempre é onde a regra de negócio densa vive. Não pare nos handlers; siga as chamadas.
- Campos `public` (`ProdutoId`) são **canais de entrada de estado**: outra tela pode fazer `frmCadProduto.ProdutoId := 42` antes de `ShowModal`. Isso é dependência oculta — registre no campo "estado externo" do dossiê ([hidden-coupling-traps.md](hidden-coupling-traps.md)).

---

## O `.dfm` — o form serializado (o arquivo que mais importa)

O `.dfm` **não é binário opaco**. Em Delphi moderno é **texto** (DFM textual), uma árvore de objetos com propriedades. Você consegue lê-lo e parseá-lo direto. Exemplo real e completo de uma tela de cadastro:

```pascal
object frmCadProduto: TfrmCadProduto
  Left = 0
  Top = 0
  Caption = 'Cadastro de &Produto'      // mnemônico no título
  ClientHeight = 300
  ClientWidth = 520
  KeyPreview = True                      // o form intercepta teclas antes dos controles
  OnShow = FormShow                      // EVENTO do form -> método FormShow no .pas
  PixelsPerInch = 96
  TextHeight = 13

  object lblCodigo: TLabel
    Left = 16
    Top = 16
    Width = 40
    Caption = 'C&ódigo'                  // mnemônico: Alt+O
    FocusControl = edCodigo              // o & deste label FOCA edCodigo (papel 2 do &)
  end
  object edCodigo: TEdit
    Left = 80
    Top = 13
    Width = 90
    TabOrder = 0                         // primeiro na ordem de tabulação
  end

  object lblDescricao: TLabel
    Left = 16
    Top = 48
    Width = 52
    Caption = '&Descrição'               // Alt+D
    FocusControl = edDescricao
  end
  object edDescricao: TEdit
    Left = 80
    Top = 45
    Width = 410
    TabOrder = 1
  end

  object lblPreco: TLabel
    Left = 16
    Top = 80
    Caption = '&Preço'
    FocusControl = edPreco
  end
  object edPreco: TEdit
    Left = 80
    Top = 77
    Width = 90
    TabOrder = 2
    OnExit = edPrecoExit                 // EVENTO OnExit -> método edPrecoExit no .pas
  end

  object btnSalvar: TButton
    Left = 80
    Top = 250
    Width = 90
    Caption = '&Salvar'                  // Alt+S aciona o botão
    Default = True                       // Enter no form aciona este botão
    TabOrder = 3
    OnClick = btnSalvarClick             // EVENTO OnClick -> método btnSalvarClick no .pas
  end
  object btnCancelar: TButton
    Left = 180
    Top = 250
    Caption = '&Cancelar'
    Cancel = True                        // Esc aciona este botão
    TabOrder = 4
  end

  object qryProduto: TFDQuery            // componente NÃO-VISUAL: o dataset
    Connection = dmPrincipal.conn        // conexão vem do DATAMODULE global (acoplamento!)
    SQL.Strings = (                      // <- SEMENTE da SQL (design-time)
      'SELECT id, codigo, descricao, preco_venda'
      'FROM produto'
      'WHERE id = :id')
    Left = 440
    Top = 16
  end
end
```

### A ligação `OnClick = Handler` — como o `.dfm` amarra ao `.pas`

Esta é a costura central. No `.dfm`, uma propriedade de evento guarda **o nome de um método**:

```
OnClick = btnSalvarClick
```

Isso significa: *o evento OnClick do `btnSalvar` é tratado pelo método `btnSalvarClick`, que está na classe `TfrmCadProduto`, no arquivo `CadProduto.pas`.* Em runtime, ao clicar (ou Alt+S, ou Enter porque `Default=True`), o VCL chama `frmCadProduto.btnSalvarClick(btnSalvar)`. É **exatamente** o equivalente de `onClick={btnSalvarClick}` num JSX — só que o "JSX" (o `.dfm`) e o handler (o `.pas`) estão em arquivos separados, amarrados pelo `{$R *.dfm}` e pelo nome da classe.

Mapa de tradução conceitual:

| `.dfm` | `.pas` | React equivalente |
|--------|--------|-------------------|
| `OnClick = btnSalvarClick` | `procedure TfrmCadProduto.btnSalvarClick(Sender: TObject)` | `<Button onClick={onSalvar}>` + `function onSalvar()` |
| `OnExit = edPrecoExit` | `procedure ...edPrecoExit(...)` | `<input onBlur={onPrecoBlur}>` |
| `OnShow = FormShow` | `procedure ...FormShow(...)` | `useEffect(() => {...}, [])` ao montar |
| `Caption = '&Salvar'` | — | `<Button label="&Salvar">` (camada de teclado) |
| `FocusControl = edCodigo` | — | label com `htmlFor`/foco programático |
| `TabOrder = 0` | — | ordem do DOM + `tabindex="0"` |

> Sem essa ligação, o `.dfm` é só um desenho morto. **O scaffold sai do `.dfm`; o comportamento sai dos métodos que o `.dfm` aponta.** Extrair o mapa `componente → evento → método` é o primeiro passo de qualquer dossiê.

---

## Como ler um form (a sequência mental)

1. **Abra o par `.dfm` + `.pas` juntos.** Nunca um sem o outro.
2. **No `.dfm`, monte a árvore de componentes** (o que aparece) e colete: `Caption` (texto + `&`), `TabOrder`, `FocusControl`, e **todas** as props `On...` (os eventos ligados).
3. **Para cada `On... = Metodo`, vá ao `.pas`** e leia o método. Siga as chamadas internas (`CalcularMargem`) — a regra densa costuma estar nos auxiliares, não nos handlers.
4. **Liste os componentes não-visuais** (`TFDQuery`, `TDataSource`, `TClientDataSet`): de onde vem a `Connection`? Há `SQL.Strings`? Isso é semente de SQL (vai para [dynamic-sql-extraction.md](dynamic-sql-extraction.md)).
5. **Marque o estado de entrada/saída**: campos `public`, `ShowModal` que retorna `ModalResult`, leitura/escrita em datamodule global. Isso vira o campo "estado externo" do dossiê ([hidden-coupling-traps.md](hidden-coupling-traps.md)).
6. **Não presuma.** Leia `FormShow`/`OnCreate` inteiros — eles preparam estado que o resto da tela assume pronto.

---

## Datamodules (`TDataModule`)

Um `TDataModule` é um **container não-visual** de datasets e conexões, com seu próprio `.dfm` + `.pas` (mesma anatomia, sem componentes visuais). Existe para **compartilhar** conexão e queries entre várias telas.

```pascal
object dmPrincipal: TDataModule
  object conn: TFDConnection
    Params.Strings = (
      'Database=SUPERERP'
      'DriverID=PG')
    Left = 32
    Top = 24
  end
  object qryAux: TFDQuery           // query GLOBAL — qualquer form pode abrir/usar
    Connection = conn
    Left = 120
    Top = 24
  end
  object qParametros: TFDQuery      // tabela de parâmetros do sistema, lida no boot
    Connection = conn
    SQL.Strings = ('SELECT * FROM parametros WHERE id_empresa = :emp')
    Left = 208
    Top = 24
  end
end
```

Por que isto é central (e perigoso):

- **A conexão é uma só, global.** `qryProduto.Connection = dmPrincipal.conn` no exemplo acima — a tela de produto não tem conexão própria; usa a do datamodule. Mesma transação, mesma sessão.
- **Queries globais são estado mutável compartilhado.** Se a tela A abre `dmPrincipal.qryAux` com uma SQL e a tela B reusa `qryAux` presumindo outro conteúdo, há acoplamento invisível. Esta é **a** armadilha — desenvolvida em [hidden-coupling-traps.md](hidden-coupling-traps.md).
- **Parâmetros lidos no boot** (`qParametros`) viram "constantes" que telas leem sem mostrar de onde vieram. Caçar isso é parte do dossiê.

> No alvo, o datamodule **não** se traduz em "um singleton compartilhado". Ele se quebra em **dependências explícitas**: conexão por tenant ([../02-stack-and-standards/backend-nestjs-standards.md](../02-stack-and-standards/backend-nestjs-standards.md), tenant context), e cada query vira um método de repository **sem estado compartilhado**.

---

## Data-binding: `TQuery` / `TDataSource` / controles `DB*`

O Delphi liga dados a controles por **data-binding declarativo**, em três peças:

```
TFDQuery (a SQL e o resultado)
   └── TDataSource (a ponte)
          └── TDBEdit / TDBGrid / TDBComboBox (o controle que mostra/edita)
```

Exemplo no `.dfm`:

```pascal
object qryCli: TFDQuery
  Connection = dmPrincipal.conn
  SQL.Strings = ('SELECT id, nome, limite_credito FROM cliente WHERE id = :id')
end
object dsCli: TDataSource
  DataSet = qryCli                 // a ponte aponta para o dataset
end
object dbeNome: TDBEdit
  DataSource = dsCli               // o controle escuta a ponte
  DataField = 'nome'               // ligado à coluna 'nome'
  TabOrder = 0
end
object grdItens: TDBGrid
  DataSource = dsCli               // grid inteiro ligado ao dataset
end
```

O que significa para a migração:

- `TDBEdit.DataField = 'nome'` = **two-way binding** ao campo `nome` do dataset ativo. Editar o controle altera o registro corrente; navegar o dataset atualiza o controle. No alvo isso é **estado de formulário** (`react-hook-form`) + **data-fetching** (React Query) — ver [../00-orientation/glossary.md](../00-orientation/glossary.md) (`TDataSource` → estado + data-fetching).
- `TDBGrid` ligado a `TDataSource` = o grid é o dataset renderizado, com **registro corrente** compartilhado. No alvo vira o `DataGrid` teclado-first ([../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md), seção 5), alimentado por uma query do repository.
- **Atenção ao "registro corrente" implícito**: muito código Pascal faz `qryCli.FieldByName('limite_credito').AsFloat` contando que o dataset esteja posicionado na linha certa — posicionamento que **outra ação** deixou. Mais acoplamento invisível.

---

## Posicionamento absoluto `Left`/`Top` → precisa re-fluir

Todo controle no `.dfm` tem `Left`, `Top`, `Width`, `Height` em **pixels absolutos**. O Delphi VCL é layout absoluto: o form tem tamanho fixo e cada componente está cravado numa coordenada.

```pascal
object edDescricao: TEdit
  Left = 80      // x absoluto
  Top = 45       // y absoluto
  Width = 410
  Height = 21
end
```

Implicações:

- **Não copie coordenadas para CSS.** `Left=80; Top=45` não vira `position:absolute; left:80px; top:45px`. Isso reproduz a tela travada e quebra em qualquer resolução/zoom/densidade.
- **Use as coordenadas só para inferir o agrupamento e a ordem visual.** Componentes alinhados no mesmo `Top` são uma **linha**; mesmo `Left` numa coluna são um **grupo**. Disso você deriva um layout de **grid/flex responsivo** que preserva a *leitura* (label à esquerda, campo à direita, linha a linha) sem o pixel-perfect.
- **O que é sagrado é o `TabOrder`, não o `Left/Top`.** A memória muscular do operador segue a ordem de tabulação (ADR-010), que você reproduz na ordem do DOM ([../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md)). O posicionamento visual pode (e deve) re-fluir.

> Regra: o `Left/Top` informa o **scaffold inicial** (qual campo perto de qual, em que ordem de linha); o layout final é **responsivo**, não absoluto. O agente gera um esqueleto a partir das coordenadas e o re-flui.

---

## Componentes proprietários (DevExpress / TMS) — sem equivalente 1:1

Boa parte dos ERPs Delphi usa suítes de terceiros: **DevExpress** (`cxGrid`, `cxLookupComboBox`, `cxButtonEdit`, `dxBarManager`), **TMS** (`TAdvStringGrid`, `TAdvEdit`), entre outras. No `.dfm` aparecem com propriedades densas e específicas do fabricante:

```pascal
object cxgProdutos: TcxGrid
  object cxgProdutosDBTableView: TcxGridDBTableView
    DataController.DataSource = dsProd
    OptionsView.GroupByBox = True            // agrupamento por coluna (feature DevExpress)
    object colDescricao: TcxGridDBColumn
      DataBinding.FieldName = 'descricao'
      Width = 300
    end
  end
end
```

Como tratar:

- **Não procure um componente "igual".** Não existe um `cxGrid` no React. Você extrai a **intenção** (grid editável com agrupamento por coluna, ordenação, soma de rodapé) e a reconstrói sobre o `DataGrid` padrão do alvo (AG Grid/TanStack), respeitando o teclado.
- **Identifique as features realmente usadas**, não as disponíveis. Um `cxGrid` tem centenas de propriedades; a tela talvez use só `GroupByBox` e um footer de soma. Migre o que a tela usa.
- **Parsing**: o parser de `.dfm` precisa ser **tolerante a tipos desconhecidos** — ele não pode quebrar ao ver `TcxGridDBColumn`. Trate qualquer `object Nome: TTipoDesconhecido ... end` como um nó genérico com props (Width, FieldName, Caption, eventos `On...`), registrando o tipo para revisão manual.
- **Mnemônicos e taborder ainda saem** desses componentes (eles têm `Caption`, `TabOrder`, `On...` como qualquer VCL), então o mapa de teclado é extraível mesmo de componente proprietário.

---

## Parsear o `.dfm` — o que sai dele e para onde vai

O `.dfm` textual tem gramática regular o suficiente para um parser dedicado (não confie só em regex para a árvore inteira; use um parser recursivo simples sobre `object ... end`). Quatro produtos saem dele:

### 1) Scaffold React (esqueleto da tela)

A árvore `object/end` vira uma árvore de componentes. Cada `TEdit`/`TLabel`/`TButton`/`TcxGrid` mapeia para um componente do design system; o agrupamento por `Top`/`Left` vira linhas/colunas re-fluídas.

```ts
// scripts/dfm/parse-dfm.ts — parser recursivo de object...end (esqueleto)
interface DfmNode {
  name: string;                 // edDescricao
  type: string;                 // TEdit / TcxGrid / TFDQuery
  props: Record<string, string | string[]>;  // Caption, TabOrder, SQL.Strings...
  events: Record<string, string>;             // OnClick -> btnSalvarClick
  children: DfmNode[];
}

export function parseDfm(src: string): DfmNode { /* tokeniza object/end, lê props, recursa */ }

// mapa Delphi -> componente do design system (parcial)
const componentMap: Record<string, string> = {
  TEdit: 'Field', TLabel: 'Label', TButton: 'Button',
  TComboBox: 'Select', TCheckBox: 'Checkbox', TDBGrid: 'DataGrid',
  TcxGrid: 'DataGrid', /* proprietário: mesma intenção */
};
```

### 2) Mapa de teclado (taborder + mnemônicos + atalhos)

Isto **alimenta diretamente a camada de teclado** ([../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md), seção 6, onde `extractKeyboardMap` já está especificado). Saem do `.dfm`: `TabOrder` (ordem), `Caption` com `&` (mnemônico), `FocusControl` (papel 2 do `&` — foca campo), `Default`/`Cancel` (Enter/Esc), e os `ShortCut` de `TActionList`.

```ts
// extrai taborder + mnemonico de cada nó (consome o parser acima)
function extractTabAndMnemonics(node: DfmNode): KeyboardMapEntry[] {
  const out: KeyboardMapEntry[] = [];
  walk(node, (n) => {
    const caption = n.props.Caption as string | undefined;
    out.push({
      control: n.name, type: n.type,
      tabOrder: Number(n.props.TabOrder ?? -1),
      mnemonic: caption ? parseMnemonic(caption).key : null,  // reusa parseMnemonic da seção 02
      focusControl: (n.props.FocusControl as string) ?? null, // & que FOCA campo
      isDefault: n.props.Default === 'True',                  // Enter
      isCancel: n.props.Cancel === 'True',                    // Esc
    });
  });
  return out.sort((a, b) => a.tabOrder - b.tabOrder);
}
```

### 3) Mapa de event handlers (componente → evento → método `.pas`)

Toda prop `On... = Metodo` vira uma aresta para o `.pas`. É a ponte que diz **quais métodos do `.pas` importam** e o que cada um responde.

```ts
// componente -> { evento: metodoNoPas }
function extractEventMap(root: DfmNode): EventBinding[] {
  const out: EventBinding[] = [];
  walk(root, (n) => {
    for (const [event, method] of Object.entries(n.events)) {
      out.push({ control: n.name, type: n.type, event, handler: method });
      // ex.: { control:'btnSalvar', event:'OnClick', handler:'btnSalvarClick' }
    }
  });
  return out;
}
```

Esse mapa direciona a leitura do `.pas`: você não lê o `.pas` inteiro às cegas — você lê **os métodos que o `.dfm` aponta** e segue as chamadas. É também a lista de **comportamentos a reproduzir** no dossiê (cada handler = uma interação da tela).

### 4) Sementes de SQL (componentes não-visuais)

Cada `TFDQuery`/`TQuery` com `SQL.Strings` é uma **semente** de SQL de design-time. Mas — atenção — essa SQL **muta no `.pas`** em runtime. O `.dfm` só te dá o ponto de partida. A reconstrução da SQL real é o assunto inteiro de [dynamic-sql-extraction.md](dynamic-sql-extraction.md); aqui você só **coleta as sementes** (a SQL declarada e qual `Connection`/datamodule ela usa).

```ts
// coleta sementes de SQL para a extração dinâmica (dynamic-sql-extraction.md)
function extractSqlSeeds(root: DfmNode): SqlSeed[] {
  const out: SqlSeed[] = [];
  walk(root, (n) => {
    if (['TFDQuery', 'TQuery', 'TClientDataSet'].includes(n.type) && n.props['SQL.Strings']) {
      out.push({
        dataset: n.name,
        connection: (n.props.Connection as string) ?? null, // ex.: dmPrincipal.conn (datamodule!)
        seedSql: (n.props['SQL.Strings'] as string[]).join('\n'),
      });
    }
  });
  return out;
}
```

> Os quatro produtos do parser **convergem no dossiê** (seção 04): scaffold + mapa de teclado + mapa de handlers + sementes de SQL formam o esqueleto do dossiê de tela. O dossiê não é escrito do zero — ele é **semeado pelo parser** e completado pela leitura do `.pas` e pela captura de runtime.

---

## Onde isto desemboca

- O **scaffold** e o **mapa de teclado** viram a tela React + o consumo da camada de teclado ([../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md)).
- O **mapa de handlers** direciona a extração de **regra de negócio** ([business-rule-extraction.md](business-rule-extraction.md)) e de **SQL dinâmica** ([dynamic-sql-extraction.md](dynamic-sql-extraction.md)).
- As **sementes de SQL** + a leitura dos `Connection` apontando a datamodules abrem a caça ao **acoplamento oculto** ([hidden-coupling-traps.md](hidden-coupling-traps.md)).
- Tudo é capturado no **dossiê de tela** (seção 04), a unidade de trabalho canônica (ADR-012).

---

## Ver também

- [dynamic-sql-extraction.md](dynamic-sql-extraction.md) — a SQL nasce no `.dfm` (`SQL.Strings`) e muta no `.pas`; como reconstruir a verdade.
- [business-rule-extraction.md](business-rule-extraction.md) — ler os métodos que o `.dfm` aponta e extrair toda condicional.
- [hidden-coupling-traps.md](hidden-coupling-traps.md) — datamodules e estado global: o acoplamento que a leitura linear esconde.
- [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md) — consome o mapa de teclado extraído do `.dfm` (taborder, mnemônicos, atalhos).
- [../02-stack-and-standards/backend-nestjs-standards.md](../02-stack-and-standards/backend-nestjs-standards.md) — para onde a SQL e a regra do `.pas` migram (repository/service).
- [../00-orientation/glossary.md](../00-orientation/glossary.md) — o vocabulário Delphi ↔ alvo.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-010 (mnemônicos do `.dfm`) e ADR-012 (dossiê).
