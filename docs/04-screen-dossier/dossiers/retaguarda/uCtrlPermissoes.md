# CONTROLE DE PERMISSÕES (`FRMCTRLPERMISSOES`) — a tela que governa o RBAC

Recon feito em 2026-09-04, depois que o ensaio de escrita do cutover mostrou que 91 dos 176 pares (formulário,
opção) que o app exige não existiam no cliente. Ao renomear grants eu estava mexendo no dado desta tela **sem
ter lido a tela** — o usuário alertou, e o alerta procede. Fontes: `uCtrlPermissoes.pas` (2.287 linhas),
`uCtrlPermissoes.dfm` (1.852), `udmPrincipal.pas:2698-2714` e `:3971-4000`, e a procedure `SP_REPLICA_PERMISSAO`
no próprio Oracle.

## 1. Como o legado decide se pode

`udmPrincipal.pas:3971-4000` — `VerificaPermissao(AForm, ACodOperador, Opcao)`:

```
SELECT * FROM PERMISSOES WHERE form = :form AND codoperador = :op
                           AND codempresa = :emp AND opcao = :opcao
Result := RecordCount > 0
```

Três coisas que isto fixa, e que o nosso guard já faz:
- **fail-closed**: sem linha, não pode. Tela sem grant nenhum é tela inacessível — para todos;
- **`if Opcao = '' then Opcao := AForm`** (`:3976`): sem opção, a opção é o **próprio nome do formulário**. É o
  "gate da tela", e é por isso que existem linhas como `('FRMCADPLC','FRMCADPLC')`;
- a chave é **(form, opção, operador, EMPRESA)** — permissão é por empresa.

## 2. Usuário × Perfil: é UM ou OUTRO, e o cliente usa USUÁRIO

`GetConfigControlePermissao` (`udmPrincipal.pas:2698`) lê a config **`CONTROLE_PERMISSOES`**: `'Usuario'`/`'U'`
→ por usuário · `'Perfil'`/`'P'` → por perfil · qualquer outra coisa → ambos.

Em **produção o valor é `'Usuario'`**. E os números confirmam o uso: **55.251 linhas por operador** contra 2.438
por perfil (que nesse modo o legado nem consulta), com 42 vínculos operador×perfil ativos que hoje não têm
efeito nenhum.

A exclusividade é imposta na gravação (`AdicionarPermissao`, `:314-315`):

```pascal
Operador  := iif(Permissao.GetTipoPermissao = tpPerfil, 0, Operador);
CodPerfil := iif(Operador = 0, CodPerfil, 0);
```

⇒ **uma linha nunca tem operador e perfil ao mesmo tempo**.

## 3. O que a tela faz (e o tamanho do que temos)

| # | ação do legado | onde | temos? |
|---|---|---|---|
| 1 | conceder/revogar uma opção | `AdicionarPermissao` `:294` · `RemoverPermissao` | **só por PERFIL** |
| 2 | árvore de menu → formulários → opções | `MontarArvore`, `CarregaDataSetMenu` | catálogo simples |
| 3 | **marcar/desmarcar TODOS os formulários** | `btnMarcarTodosFormClick` `:472` | ✗ |
| 4 | **marcar/desmarcar todas as opções** de um form | `btnMarcarTodosOpcoesClick` `:516` | ✗ |
| 5 | **clonar permissões** de um usuário/perfil para outro, inclusive **entre empresas** | `btnCopiarParaClick` `:389` → `SP_REPLICA_PERMISSAO` | ✗ |
| 6 | trocar a empresa em edição | `cbbEmpresaChange` | ✗ (a nossa é a empresa da sessão) |
| 7 | log de toda ação | `GravaLog` + `AUDIT_PERMISSOES` | ✓ (audit_permissoes) |

### ⛔ A lacuna que importa

Nosso `PermissoesService` só tem `listarPorPerfil` e `setGrant(codperfil, …)`. **Não há concessão por
OPERADOR** — que é exatamente o modo que o cliente usa. Depois da virada, o administrador não conseguiria dar
nem tirar permissão de um usuário pela tela; só de perfil, que no modo `'Usuario'` não vale nada.

### `SP_REPLICA_PERMISSAO` (lida no Oracle, não no fonte Delphi)

```
'U' → DELETE FROM PERMISSOES WHERE CODOPERADOR = <para> AND CODEMPRESA = <paraEmp>
      INSERT (FORM, OPCAO, CODOPERADOR, CODEMPRESA)  ← SELECT FORM, OPCAO ... CODOPERADOR = <de> AND CODEMPRESA = <deEmp>
'P' → idem por CODPERFIL
```

Três detalhes com consequência: é **destrutivo** (apaga tudo do destino antes de copiar), é **cross-empresa**
(copiar de (usuário, empresa 1) para (usuário, empresa 2)) e **não leva `CAPTION`/`FORM_CAPTION`**.

## 4. `CAPTION` e `FORM_CAPTION` — o rótulo mora no dado

`AdicionarPermissao` grava também `CAPTION` (o texto do botão) e `FORM_CAPTION` (o nome da tela). Isso faz do
**próprio banco do cliente a melhor fonte de equivalência** — melhor que o `.dfm`, porque é o que o operador
enxerga hoje. Foi assim que as renomeações do §7w ficaram confirmadas:

| par | CAPTION | FORM_CAPTION |
|---|---|---|
| `FRMCADPLC` / `FRMCADPLC` | Acessar formulário | **CENTRO DE CUSTOS** |
| `FRMRELDRECONTABIL` | Acessar formulário | **DEMONSTRACAO DO RESULTADO DO EXERCICIO (DRE)** |
| `FRMAPAGAR` | Acessar formulário | CONTAS A PAGAR |
| `FRMCADDEVOLUCAO` | Acessar formulário | DEVOLUCAO DE PRODUTOS |
| `FRMFECHAMENTOCAIXA` / `BTNABRIR` · `BTNFECHA` | **Abrir Caixa** · **Fechar Caixa** | FECHAMENTO DE CAIXA |
| `FRMMOVCAIXA` / `BTNGRAVAR` | Gravar registro | LANCAMENTO DE CAIXA |
| `FRMNF` / `BTNFATURAMENTO` | Faturamento | NOTAS DE ENTRADA |

⚠️ dois avisos: só **7.086 das 57.689** linhas têm caption (o resto foi criado por outra via, e a tela mostra
sem rótulo), e o caption do DADO pode divergir do `.dfm` — `FRMAJUSTEESTOQUE/BTNOK` é "Ajustar" no `.dfm` e
**"Enviar"** no banco. Quando divergirem, **o dado manda**: é o que o cliente vê.

⚠️ e **nós não gravamos caption nenhum** (`permissoes.service.ts:69` insere só form/opcao/codperfil/codempresa).
Permissão concedida pelo Apollo aparece sem rótulo na tela — do legado e da nossa.

## 5. Quirk a copiar com registro: o filtro do segmento INDÚSTRIA

`btnMarcarTodosFormClick` (`:478-493`): antes de marcar tudo, se a empresa **não** é `SEGMENTO = 'INDUSTRIA'`, a
tela localiza o menu "INDÚSTRIA" e **filtra fora os formulários filhos dele** (`CODPAI <> codPai`). Ou seja,
"marcar todos" nunca concede as telas de indústria a um supermercado. O cliente é varejo — o filtro vale.

## 6. O que fazer (proposta, não decisão)

1. **Concessão por OPERADOR** no serviço e na tela — é o modo do cliente e hoje não existe. Com a exclusividade
   do `:314-315` (operador **ou** perfil, nunca os dois).
2. **`CAPTION`/`FORM_CAPTION` na gravação**, com o rótulo que o catálogo já conhece.
3. **Clonar permissões** (usuário→usuário, com empresa de origem e destino), reproduzindo o `SP_REPLICA_PERMISSAO`
   — inclusive o DELETE prévio, que é o que faz a cópia ser cópia e não união.
4. **Marcar/desmarcar todos** por formulário e por opção, com o filtro de INDÚSTRIA.
5. Seleção de **empresa** na tela (hoje usamos a da sessão).

Nada disto é cauda: é a tela que o administrador usa para consertar acesso no dia seguinte à virada — e, sem o
item 1, ele não consegue.
