# Dossiê de Tela — PERFIS & PERMISSÕES — `FRMCADPERFILOPERADOR` (`uCadPerfilOperador` / `uCtrlPermissoes`)

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | **corte-1 + corte-2 ENTREGUES e verdes** (2026-07-16). c1: PERFIL CRUD + relação operador↔perfil. c2: matriz de grants FORM×OPCAO por perfil + **acesso.service perfil-aware** (modos usuario/perfil/ambos). Front /cadastro/perfis. Auditoria adversarial (segurança-RBAC + correctness) em andamento. |
| **Autor** | Claude (agente de migração) |
| **Fontes legadas** | `uCadPerfilOperador.pas`, `uCtrlPermissoes.pas`, `udmPrincipal.pas` (`PossuiAcessoForm`). |
| **Golden** | Oracle PINHEIRAO (READ-ONLY 2026-07-16): `PERFIL` (20), `PERMISSOES` (31.878; 29.089 por CODOPERADOR, 2.785 por CODPERFIL, 327 forms distintos), `RELACAO_OPERADOR_PERFIL` (62). |

## 1. Modelo RBAC (Oracle real → migração)

- **PERMISSOES** (já migrado, mig 002): `FORM, OPCAO, CODOPERADOR, CODPERFIL, CODEMPRESA, CAPTION, FORM_CAPTION`. **Presença de linha = acesso concedido** (sem flag). Grant keyed a CODOPERADOR (direto, modo dominante) OU CODPERFIL (por perfil).
- **PERFIL** (mig 084): `CODPERFIL, PERFIL (nome), ATIVO, TIPO, INDR (soft-delete)`. GLOBAL (sem empresa, fiel).
- **RELACAO_OPERADOR_PERFIL** (mig 084): operador↔perfil M:N (`CODRELACAO, CODOPERADOR, CODPERFIL, INDR`). UNIQUE parcial 1-ativo-por-par.
- **Modo** (`CONFIGURACOES.CONTROLE_PERMISSOES`): 'usuario' (PINHEIRAO, direto) / 'perfil' (só perfis) / 'ambos' (∪). No monorepo = `APP_PERMISSAO_MODO` (default 'usuario'). Acesso efetivo (ambos) = grants próprios ∪ grants dos perfis do operador.
- **Adiado:** `PERFILREL` (herança de perfil, 4), `OPERADORES_RESTRICAO_ACESSO` (janela de horário, 1), `APP_PERMISSOES` (mobile, 255), `AUDIT_PERMISSOES` (trilha).

## 2. Corte-1 (ENTREGUE) — PERFIL + relação

- **perfil.crud** (createCrudController, `cadastro/perfil`, RBAC FRMCADPERFILOPERADOR, soft-delete): CRUD dos perfis. View `get_perfil` (+ `qtde_operadores`).
- **PerfilRelacaoService/Controller** (`cadastro/perfil-operador`, base própria p/ não colidir com o `:id` do CRUD): matriz operador→perfis (`GET :codoperador`) + `set` (PUT: atribui reativando um soft-deletado ou criando; remove por soft-delete). Idempotente via UNIQUE parcial.

## 3. Corte-2 (ENTREGUE) — matriz de grants + acesso perfil-aware

- **acesso.service perfil-aware** (`possuiAcesso`): 'usuario' = grants diretos (default, inalterado); 'perfil' = grants dos perfis (via relacao_operador_perfil; sem perfis → nega); 'ambos' = `OR(codoperador, codperfil IN perfis)`. **Aditivo** — no default nada muda; nos outros modos o operador só GANHA acesso pelos perfis. Escopo por empresa preservado.
- **PermissoesService/Controller** (`cadastro/permissoes`): `catalogo` (DISTINCT form×opcao das permissões da empresa — o universo conhecido, já que o app não tem registro de forms separado), `listarPorPerfil(codperfil)`, `setGrant` (delete-then-insert por-perfil, `upper(form/opcao)` consistente com o `possuiAcesso`, escopo empresa). RBAC BTNPERMISSOES.
- **Front** `/cadastro/perfis`: CRUD de perfis + painel de permissões do perfil (toggle conceder/revogar otimista sobre o catálogo).

### Verificação
shared build · api tsc 0 · api test 145 · **smoke 548/0** (§77.1-6: criar/atribuir/idempotência/gates + catálogo/grant + **acesso perfil-aware** provado: op8 modo usuario→403, modo ambos via perfil→200, revogado→403) · web tsc 0 · test 32 · build.

## 4. Adiado (com procedência)
- Herança de perfil (`PERFILREL`), janela de horário (`OPERADORES_RESTRICAO_ACESSO`), permissões mobile (`APP_PERMISSOES`), trilha de auditoria (`AUDIT_PERMISSOES`).
- Catálogo de forms COMPLETO (hoje = DISTINCT das permissões existentes; o legado tem o catálogo no app — um registro estático de forms/opções seria o ideal, mas não há fonte migrável).
- Grant por-OPERADOR direto pela matriz (a matriz atual é por-PERFIL; o grant direto por-operador é o modo 'usuario' já existente, semeado/gerido fora desta tela).
