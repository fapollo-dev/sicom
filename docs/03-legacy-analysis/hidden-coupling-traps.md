# Armadilhas de acoplamento oculto

> A armadilha que quebra a vantagem "procedural, tudo na ordem": **datamodules + variáveis globais = acoplamento OCULTO** que a leitura linear de **uma** tela não mostra. Uma tela parece autocontida, mas depende de estado que **outra tela** deixou — datamodule compartilhado, conexão/sessão global, query global aberta em outro form. Como **detectar** (listar tudo que a tela toca fora dela — o campo "estado externo" do dossiê) e como **quebrar** na migração (dependências explícitas, sem singletons mutáveis compartilhados).

## Pré-requisitos de leitura

- [delphi-anatomy.md](delphi-anatomy.md) — `TDataModule`, `Connection = dmPrincipal.conn`, campos `public`, queries globais.
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — a tese: a vantagem procedural é real, **mas** o acoplamento oculto é a sua exceção.
- [../00-orientation/glossary.md](../00-orientation/glossary.md) — `TDataModule` marcado como **armadilha de estado global**; BDE/FireDAC.
- [business-rule-extraction.md](business-rule-extraction.md) e [dynamic-sql-extraction.md](dynamic-sql-extraction.md) — o estado externo governa condicionais e parâmetros de SQL.

---

## Por que a vantagem procedural tem uma exceção

A canon promete: o legado é **procedural**, então você lê de cima a baixo, na ordem, sem surpresa. Verdade — **dentro de um método**. A armadilha é que o ERP Delphi distribui estado em **dois lugares que a leitura de uma tela não alcança**:

1. **`TDataModule` compartilhado** — datasets e conexão que **muitas telas** usam, criados no boot e vivos a sessão inteira.
2. **Variáveis globais** — `var` no nível de unit, variáveis do `dmPrincipal`, "constantes" lidas no login (`EmpresaAtual`, `UsuarioLogado`, `ParametrosSistema`).

Uma tela lê `EmpresaAtual` ou usa `dmPrincipal.qryAux` **como se fosse dela**, mas quem **preencheu** esse estado foi outra tela, ou o login, ou um form que rodou antes. A tela parece autocontida; **não é**. Ler só o `.pas` dela e jurar que entendeu = a forma número um de migrar uma tela que **quebra** quando isolada.

> Regra: a tela procedural é honesta sobre o que faz **com o que recebe**. Ela é **silenciosa** sobre o que **recebe de fora**. Caçar o "de fora" é o trabalho deste arquivo.

---

## As 4 formas de acoplamento oculto

### 1) Datamodule compartilhado (conexão + queries globais)

```pascal
// DMPrincipal.dfm — criado no boot, vivo a sessão inteira (.dpr: CreateForm(TdmPrincipal,...))
object dmPrincipal: TDataModule
  object conn: TFDConnection ... end          // UMA conexão para TODAS as telas
  object qryAux: TFDQuery                      // query GLOBAL reutilizada por vários forms
    Connection = conn
  end
end
```

```pascal
// Tela A — abre a query global com UMA SQL
procedure TfrmA.Carregar;
begin
  dmPrincipal.qryAux.SQL.Text := 'SELECT * FROM cliente WHERE id = :id';
  dmPrincipal.qryAux.ParamByName('id').AsInteger := 10;
  dmPrincipal.qryAux.Open;
  // ... usa qryAux.FieldByName('nome') ...
end;

// Tela B — REUSA a MESMA query global, presumindo OUTRO conteúdo
procedure TfrmB.Mostrar;
begin
  // BUG LATENTE: se A rodou antes e deixou qryAux aberta em 'cliente',
  // B pode ler o registro errado se não reabrir. O acoplamento é INVISÍVEL
  // lendo só TfrmB — qryAux não é declarada em B.
  Label1.Caption := dmPrincipal.qryAux.FieldByName('nome').AsString;
end;
```

Por que é traiçoeiro: lendo `TfrmB.Mostrar` você vê `dmPrincipal.qryAux` e **não sabe** qual SQL está lá — depende de quem abriu por último. O **registro corrente** do dataset é estado global mutável. Dois forms compartilhando `qryAux` é acoplamento por dataset.

### 2) Conexão / transação / sessão global (BDE/FireDAC)

```pascal
// uma transação global aberta numa tela e commitada noutra
procedure TfrmPedido.Iniciar;
begin
  dmPrincipal.conn.StartTransaction;   // abre transação na conexão GLOBAL
  // ... grava itens ...
end;

procedure TfrmPedido.Finalizar;
begin
  dmPrincipal.conn.Commit;             // commit noutro método/fluxo
  // Se uma OUTRA tela usar a mesma conn no meio, está DENTRO desta transação
  // sem saber — locks, leitura suja, rollback que arrasta o que não devia.
end;
```

A conexão única (ADR implícito do legado: BDE/FireDAC com uma sessão) significa que **transação é global**. Uma tela abre transação; outra, usando a mesma `conn`, fica acoplada a ela. Erros clássicos: deadlock entre telas, `Commit`/`Rollback` que afeta operação alheia, leitura de dado não-commitado de outra tela.

### 3) Variáveis globais ("constantes" de sessão)

```pascal
// Globais.pas — estado de sessão que TODA tela lê como se fosse constante
unit Globais;
interface
var
  EmpresaAtual: Integer;            // setado no login / troca de empresa
  UsuarioLogado: Integer;
  PermiteEstoqueNegativo: Boolean;  // lido de parametros no boot
  AliquotaPadraoIcms: Double;
implementation
end.
```

```pascal
// uma tela qualquer usa EmpresaAtual sem mostrar de onde veio
qry.ParamByName('emp').AsInteger := EmpresaAtual;   // <- estado externo!
if not PermiteEstoqueNegativo then ...               // <- regra governada por global
```

Toda tela depende de `EmpresaAtual` estar setada (login fez). Pior: **troca de empresa** muda `EmpresaAtual` em runtime — uma tela aberta antes da troca pode operar com o valor velho. Em multi-loja isso vira bug de tenant cruzado, exatamente o que o alvo **proíbe** (isolamento fail-closed, [../02-stack-and-standards/backend-nestjs-standards.md](../02-stack-and-standards/backend-nestjs-standards.md)).

### 4) Estado de entrada/saída entre forms (`public` + `ShowModal`)

```pascal
// Tela de consulta seta um campo público da tela de cadastro ANTES de abrir
procedure TfrmConsulta.Editar;
begin
  frmCadProduto := TfrmCadProduto.Create(Self);
  try
    frmCadProduto.ProdutoId := qryGrid.FieldByName('id').AsInteger;  // injeta estado
    frmCadProduto.Modo := 'EDICAO';                                  // injeta modo
    if frmCadProduto.ShowModal = mrOk then                           // espera resultado
      qryGrid.Refresh;                                               // efeito ao voltar
  finally
    frmCadProduto.Free;
  end;
end;
```

Aqui o acoplamento é **mais visível** (está no `Create/ShowModal`), mas ainda escapa se você lê só `frmCadProduto`: o `FormShow` dele **assume** `ProdutoId` e `Modo` já preenchidos. Ler `TfrmCadProduto` sozinho dá a impressão de que `ProdutoId` "aparece do nada".

---

## Como detectar (o campo "estado externo" do dossiê)

Para **cada tela**, produza explicitamente a lista do que ela toca **fora de si**. Esse é o campo **"estado externo"** do dossiê (seção 04). Quatro varreduras:

### Varredura 1 — referências a datamodule

```ts
// grep por uso de qualquer datamodule no .pas da tela
const dmRefRe = /\b(dm\w+)\.(\w+)/g;   // dmPrincipal.qryAux, dmPrincipal.conn, dmFiscal.qryNcm
// registrar: { datamodule:'dmPrincipal', member:'qryAux', usos:['SQL.Text','Open','FieldByName'] }
```

Para cada referência, classifique: é **conexão** (transação global), **query global** (registro corrente compartilhado), ou **método/util** do datamodule.

### Varredura 2 — variáveis globais lidas/escritas

```ts
// cruzar identificadores da tela com o conjunto de globais conhecidas (Globais.pas + vars do dm)
// para cada uso: é LEITURA (depende de) ou ESCRITA (deixa estado p/ outros)?
const globals = new Set(['EmpresaAtual','UsuarioLogado','PermiteEstoqueNegativo','AliquotaPadraoIcms']);
// resultado: { name:'EmpresaAtual', mode:'read', impacto:'parametro de SQL e de regra' }
```

Escrita em global é **pior** que leitura: a tela vira fonte de acoplamento para as próximas. Marque com destaque.

### Varredura 3 — estado de entrada/saída do form

- Campos `public` da classe → **entradas** que outra tela injeta (`ProdutoId`, `Modo`).
- `ShowModal` / `ModalResult` → **contrato de saída** (o que o chamador espera de volta).
- `FormShow`/`OnCreate` que **lê** esses campos → confirma a dependência.

### Varredura 4 — transação/conexão compartilhada

- `StartTransaction`/`Commit`/`Rollback` na `conn` global → a tela participa de **transação global**; mapeie o escopo real (onde abre, onde fecha, quem mais usa `conn` no meio).

> Saída das 4 varreduras = a seção **"estado externo"** do dossiê: *"esta tela LÊ `EmpresaAtual`, `PermiteEstoqueNegativo`; USA `dmPrincipal.qryAux` (compartilhada com frmB) e `dmPrincipal.conn` (transação global); RECEBE `ProdutoId`/`Modo` do chamador; ESCREVE nada global."* Sem essa lista, a migração da tela está cega.

---

## Como quebrar o acoplamento na migração

Princípio único: **dependências explícitas, sem singletons mutáveis compartilhados.** Cada acoplamento oculto vira um parâmetro/dependência declarado. Tabela de conversão:

| Acoplamento oculto (legado) | Quebra no alvo |
|------------------------------|----------------|
| `dmPrincipal.conn` (conexão global) | Conexão **por tenant**, resolvida por request (`DatabaseProvider.forTenant()`), nunca singleton mutável — [../02-stack-and-standards/backend-nestjs-standards.md](../02-stack-and-standards/backend-nestjs-standards.md) |
| `dmPrincipal.qryAux` (query global, registro corrente compartilhado) | **Sem dataset compartilhado.** Cada consulta é um método de repository que retorna **dados imutáveis**; nenhum "registro corrente" global |
| Transação global na `conn` | Transação **explícita e escopada** ao caso de uso (`db.transaction()`), começa e termina no **mesmo** service; nunca atravessa telas |
| `EmpresaAtual`/`UsuarioLogado` (globais de sessão) | **Tenant/usuário no contexto request-scoped** (`AsyncLocalStorage`, fail-closed) — não uma `var` global mutável; troca de empresa = novo contexto, não mutação |
| `PermiteEstoqueNegativo`/parâmetros no boot | **Parâmetros carregados por tenant** e passados como dependência ao service; não global lida no boot uma vez |
| `frmX.ProdutoId := …` antes de `ShowModal` | **Props/argumentos explícitos**: a tela React recebe `produtoId`/`modo` por rota/props; o service recebe por parâmetro do método |
| `ShowModal = mrOk` + `Refresh` ao voltar | Retorno de função / resultado de mutação (React Query invalida e refaz a query) |

### Exemplo — a query global vira repository sem estado

Legado (compartilhado, perigoso):

```pascal
dmPrincipal.qryAux.SQL.Text := 'SELECT nome, limite_credito FROM cliente WHERE id = :id';
dmPrincipal.qryAux.ParamByName('id').AsInteger := idCliente;
dmPrincipal.qryAux.Open;
nome := dmPrincipal.qryAux.FieldByName('nome').AsString;  // registro corrente GLOBAL
```

Alvo (explícito, sem estado compartilhado):

```ts
// cadastro/cliente.repository.ts — retorna dado imutável, nada de "registro corrente"
@Injectable()
export class ClienteRepository {
  constructor(private readonly dbp: DatabaseProvider) {}
  async getResumo(idCliente: number) {
    return this.dbp.forTenant()                 // conexão por tenant (isolada), não global
      .selectFrom('cliente')
      .select(['nome', 'limite_credito'])
      .where('id', '=', idCliente)              // parâmetro explícito, não estado herdado
      .executeTakeFirst();                       // retorna um objeto imutável
  }
}
// quem chama recebe o dado por valor; não há dataset compartilhado para outra tela corromper.
```

### Exemplo — transação que atravessava telas vira caso de uso escopado

```ts
// vendas/pedido.service.ts — transação começa e termina AQUI, no caso de uso
async registrarPedido(dto: RegistrarPedidoDto) {
  return this.dbp.forTenant().transaction().execute(async (trx) => {
    const pedido = await this.repo.inserirPedido(trx, dto);     // tudo na MESMA trx,
    await this.estoque.baixar(trx, dto.itens);                  // mesmo escopo,
    await this.financeiro.gerarTitulo(trx, pedido);             // nenhuma outra "tela"
    return pedido;                                              // commit ao sair; rollback no throw
  });
}
```

A transação **não vaza** para outra parte do sistema. O legado abria na `conn` global e qualquer coisa usando `conn` ficava dentro dela; aqui a `trx` é um argumento passado explicitamente — nada fora deste bloco a enxerga.

---

## Por que isto também protege o isolamento de tenant

O acoplamento global do legado (`EmpresaAtual` mutável, `conn` única) é **incompatível** com o alvo multi-tenant. Uma `var EmpresaAtual` que muda em runtime é a receita do **vazamento cross-tenant** — o pior bug possível (ADR-003/004). Quebrar o acoplamento não é só limpeza: é **requisito de segurança**. O contexto de tenant é request-scoped e **fail-closed** ([../02-stack-and-standards/backend-nestjs-standards.md](../02-stack-and-standards/backend-nestjs-standards.md)); não existe global mutável de empresa para uma tela velha ler errado.

> Trocar empresa no legado = mutar uma global e torcer. No alvo = novo contexto de request com outro tenant; uma operação **nunca** carrega o tenant de outra. O acoplamento oculto que parecia "detalhe do Delphi" é, na verdade, a fronteira de segurança do produto novo.

---

## Checklist do agente

- [ ] Listei **todo** datamodule que a tela referencia (`dm*.membro`) e classifiquei: conexão / query global / util.
- [ ] Identifiquei **queries globais compartilhadas** com outras telas (registro corrente perigoso).
- [ ] Mapeei o escopo real de **transação global** (onde abre, fecha, quem mais usa a `conn`).
- [ ] Cruzei a tela com as **globais de sessão** (`EmpresaAtual`, parâmetros) — leitura vs escrita.
- [ ] Documentei o **estado de entrada/saída** entre forms (`public`, `ShowModal`/`ModalResult`).
- [ ] Escrevi o campo **"estado externo"** do dossiê com tudo que a tela toca fora de si.
- [ ] Defini a **quebra** de cada acoplamento (dependência explícita, sem singleton mutável).
- [ ] Confirmei que nenhuma global mutável de empresa/tenant sobrevive (isolamento fail-closed).

---

## Ver também

- [delphi-anatomy.md](delphi-anatomy.md) — datamodules, `Connection`, queries não-visuais, campos `public`.
- [dynamic-sql-extraction.md](dynamic-sql-extraction.md) — o estado externo governa parâmetros e condicionais da SQL.
- [business-rule-extraction.md](business-rule-extraction.md) — efeitos colaterais e regras governadas por estado global.
- [../02-stack-and-standards/backend-nestjs-standards.md](../02-stack-and-standards/backend-nestjs-standards.md) — tenant context request-scoped, conexão por tenant, transação escopada.
- [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md) — isolamento de tenant (ADR-003/004) que o acoplamento global ameaça.
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — a vantagem procedural e a sua única exceção.
