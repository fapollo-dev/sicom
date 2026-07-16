# Dossiê de Tela — OPERADORES (Cadastro de usuários) — `uCadUsuarios`

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | corte-1 (núcleo cadastral, global) ENTREGUE 2026-07-03; **corte-2** (empresas-permitidas + supervisor + trava usuário-sistema, migration 056) ENTREGUE e verde 2026-07-04; **corte-3a** (AUTH backend: login/hash-scrypt/JWT/troca-de-senha/auditoria, migration 070) ENTREGUE e verde 2026-07-13; **corte-3b** (AUTH front: tela de login/AuthContext/guarda de rota/headers→token) ENTREGUE e verde 2026-07-13; **corte-3c** (ENDURECIMENTO: lockout + auditoria de falha desconhecida + expiração no cliente, migration 071) ENTREGUE e verde 2026-07-14. Recon 3 agentes + auditoria adversarial (2 agentes/corte). Verde corte-3c: api tsc 0 · api test **138** · smoke **497/0** (16 AUTH) · web tsc 0 · web test **32** · web build ✓. |
| **Autor** | Claude (agente de migração) |
| **Fontes legadas** | `uCadUsuarios.pas`/`.dfm` (a tela; herda `TfrmCadMasterDetalhe`) · `uRdmCadUsuarios.pas`/`.dfm` (DataModule) · `uCadPerfilOperador.pas` (perfis) · `uCtrlPermissoes.pas` (permissões granulares) · `uTrocarSenhaUsuario.pas` (troca de senha). ⚠️ `UcadOperadoras.pas`→`OPERADORAS` = operadoras de CARTÃO, NÃO usuários. |
| **Golden** | Oracle PINHEIRAO: OPERADORES 29 col / **157 linhas**; GRUPO_OPERADOR 6 grupos; PERMISSOES 31.877; ponte RELACAO_OPERADOR_EMPRESA (154/157). |

## 1. Modelo (Oracle real)
- **`OPERADORES`** é **GLOBAL no schema** — NÃO tem coluna de empresa. O vínculo operador↔empresa é a ponte **`RELACAO_OPERADOR_EMPRESA`** (N:N, 154/157). PK `CODOPERADOR` (NUMBER; sequence app-side `ID_CODOPERADOR`). 2 FKs: `CODPARCEIRO`→PARCEIROS, `IDGRUPO`→GRUPO_OPERADOR. 2 triggers (AUDIT + REM replicação).
- **Núcleo:** `NOME`(30), `LOGIN`(50), `TIPOOP`(3: USU/OPE/SUP/FOR/PRO/ASU/ANS), `MENU`, `IDGRUPO` (derivado de TIPOOP), `CODPARCEIRO` (funcionário, opcional), `IDSUPERVISOR` (auto-ref), `CODIGOAUXILIAR`, `DESABILITADO` (bloqueia login), `DESABILITA_OPERACOES_BASICAS`, `DESABILITA_DESCONTO_PDV`, `SOLICITAR_ALTERACAO_SENHA`, `ATIVO`, soft-delete `INDR`(I/E)+INDR_DATA/USUARIO, auditoria.
- **TIPOOP → IDGRUPO** (uCadUsuarios.pas:451-462): USU→1, OPE→2, SUP→3, FOR→4, PRO→5, ASU→6, ANS→7. Grupos: 1 Usuário/2 Operador/3 Supervisor/4 Fornecedor/5 Proprietário/6 Analista Suporte/7 Analista Sistema.
- **Senha:** 4 campos (`SENHA`/`SENHAPDV`/`SENHARETAGUARDA` = cifra de César reversível `encSenha`; `LOGIN_SENHA` = CryptApollo) — **NÃO é hash**, exibida em claro ao editar. Confirmação de senha (campo não-persistido). Troca dedicada (`uTrocarSenhaUsuario`). **Não há senha por operação** (desconto/cancelamento são flags/permissões). `BIOMETRIA` (BLOB, 2/157).
- **RBAC (3 camadas):** `PERFIL` (uCadPerfilOperador) + `PERMISSOES` granular form×opção×empresa (uCtrlPermissoes) + **esta tela só VINCULA perfis** (RELACAO_OPERADOR_PERFIL/_COMPRA). TIPOOP/IDGRUPO = categoria.
- **Validações (btnGravar, uCadUsuarios.pas:402-482):** LOGIN único ignorando INDR='E' (:408) · confirmação de senha (:424) · **≥1 empresa** (:444) · deriva IDGRUPO (:451). NOME/SENHA **não** são obrigatórios no legado (só a PK). Protegido: `LOGIN='SICOM'` não edita/exclui (:332/:358). Lookup parceiro = `GET_PARCEIROS FUN='S'` (:491).

## 2. Monorepo
Stub mínimo `operadores` (5 col) criado no 049 (Caixa corte-2b) para a quebra de caixa (`caixa.service.fechar` lê `codparceiro`). Cabe no **engine declarativo** (como `contas_bancarias`/`empresas`): global, `pkGerada:false`, soft-delete INDR, `derivar`. RBAC via `permissoes` (form/opcao/codoperador/codempresa; `x-operador-id`→codoperador). Lookup parceiro via `cadastro/parceiros` (useResourceOptions). **Não há infra de auth/senha/hash no monorepo.**

## 3. Plano de cortes
- **Corte-1 (ESTE) — núcleo cadastral (GLOBAL):** amplia `operadores` (051, aditivo sobre o stub 049) com nome/login/tipoop/idgrupo/desabilitado/flags PDV/solicitar_alteracao_senha/idsupervisor/codigoauxiliar/INDR/auditoria; `grupo_operador` (6 grupos); view `get_operadores` (JOIN parceiro/grupo/supervisor); **LOGIN único** (índice parcial `ux_operadores_login`, case-insensitive, ignora excluídos); CRUD engine **global** (`empresaScoped:false`), **pk digitada**, soft-delete INDR, **`derivar` tipoop→idgrupo**; RBAC `FRMCADOPERADOR`. Front `OperadoresCadMaster` (nome/login/tipo/parceiro-lookup FUN='S'/desabilitado/flags PDV/solicitar-troca-senha). Colisão de login → `LOGIN_DUPLICADO` (409, msg PT via constraint `ux_operadores_login`).
  - **Endurecimentos CONSCIENTES do legado:** NOME/LOGIN **obrigatórios** (o legado só exige a PK); login único **case-INsensitive** (upper(login); o legado compara case-sensitive). Ambos documentados.
  - **Colunas reais NÃO editadas pela tela** (fora do delta, fiéis ao `.dfm`): **`ATIVO`** (existe no Oracle, 148S/9N, mas a tela não a edita — o bloqueio é `DESABILITADO`, a situação é `INDR`; expor um checkbox "Ativo" inerte seria ruído) · **`CODIGOAUXILIAR`** (0-preenchido no Oracle). As colunas ficam na tabela (fidelidade de dados), fora do formulário. **`MENU`** (Padrão/Personalizado) e **`IDSUPERVISOR`** (sem UI no corte-1) = adiados.
- **Corte-2 (ESTE) — empresas-permitidas + supervisor + trava usuário-sistema (migration 056, 2026-07-04):** migrou o CRUD simples → **MESTRE-DETALHE** (`operadores.aggregate.ts` via `AggregateEngineService`; removeu `operadores.crud.ts`). **Empresas-permitidas** = detalhe 1:N `relacao_operador_empresa` (espelho FIEL do Oracle: PK SURROGATE `codrelacao`+sequence, `codoperador`/`codempresa` FK, SEM unique composto, SEM INDR → substitute delete+insert; hard-delete na cascata — o Oracle confirma que operador excluído fica com 0 empresas). **≥1 empresa** no gravar (uCadUsuarios.pas:444) via zod `empresas.min(1)` (obrigatório no create; opcional no update parcial — omitir mantém as existentes). **Trava usuário-sistema** (`validar`/`validarRemocao`→422 `OPERADOR_PROTEGIDO`): não editar/excluir/**criar/renomear** para os logins `['SICOM','ADMIN']` (checa a PK no update E o `dto.login` no create/rename). **Supervisor** (`idsupervisor`) = lookup opcional (auto-relação de aplicação; 0 dados reais, sem FK, sem regra). Front `OperadoresCadMaster` migrado p/ `<CadMasterDet>` (sub-grid de empresas + SelectField de supervisor). Smoke §40 (17 casos). **Alvo da trava (achado de paridade):** o legado protege literal `LOGIN='SICOM'`, mas o usuário-sistema REAL deste tenant é **op 1 `LOGIN='ADMIN'` 'ACESSO DE PROGRAMADOR'** (Oracle; SICOM não existe como operador) → o seed 056 cria o ADMIN real (não colide no import) e o serviço protege AMBOS.
- **Corte-3a (ENTREGUE, migration 070) — AUTH backend:** ver §5. **SENHA com HASH real** (scrypt) + login/JWT + troca-de-senha + auditoria. **ENFORCEMENT das empresas** (o login exige vínculo em RELACAO_OPERADOR_EMPRESA).
- **Corte-3b (próximo) — front do auth:** tela de login + AuthContext + guarda de rota + centralizar os 15 fetchers de headers-fixos → token; remover o fallback de header-identity (env `AUTH_ALLOW_HEADER_IDENTITY`). **Adiado além disso:** **perfis** (RELACAO_OPERADOR_PERFIL/_COMPRA) · **biometria** (BLOB) · TIPOOP='PRO'/ADMIN poderes especiais · **RBAC editor** (PERFIL + PERMISSOES granular = epic próprio, uCadPerfilOperador/uCtrlPermissoes) · **senha de operação por empresa** (SENHAADMIN/DESC/CANCEL/GAVETA — César, na EMPRESAS) · **liberação de supervisor** (chaves USUARIOS_LIBERAM_* + ChamaLiberacaoLogin + LOG_LIBERACOES) · **lockout/expiração/histórico** (endurecimento além do legado, que não tem). **Latente:** ao reativar operador (F→A), re-exigir ≥1 empresa. **Cutover real:** decodificar `OPERADORES.SENHA` (César −13) → `hashSenha` + `solicitar_alteracao_senha='S'` para todos (import das 157 linhas; script à parte, contra a exportação Oracle).

## 3b. Auditoria do corte-1 (2026-07-03)
Dois auditores adversariais (paridade vs. legado/Oracle; regressão/segurança/multi-tenant). **Regressão: APROVADO — 0 ALTA/MÉDIA/BAIXA** (migração aditiva; seed preserva `codparceiro` de op7/op8 → trava `OPERADOR_SEM_PARCEIRO` do Caixa intacta; multi-tenant global correto; login único → 409 sem 500; pk-digitada+derivar corretos; **senha ausente por design**; db-types/view em paridade). **Paridade — achados corrigidos:** (ALTA) checkbox `ativo` inerte → **removido do formulário/schema/colunas** (a coluna é real no Oracle mas a tela legada não a edita; bloqueio=DESABILITADO/situação=INDR); (MÉDIA) case-insensitive vendido como "fiel" → **relabelado como endurecimento**; (BAIXA) `codigoauxiliar` sem uso → removido do delta; (BAIXA) mensagem de login genérica → **`LOGIN_DUPLICADO`** (msg PT por constraint). **Documentados (não-código):** trava `LOGIN='SICOM'` (o engine não tem hook por-linha → corte-2, sem operador SICOM no monorepo hoje); dossiê escrito. `derivar` TIPOOP→IDGRUPO confirmado fiel (uCadUsuarios.pas:453-464) e roda em create+update.

## 4. Riscos
`operadores` é global (o `codempresa` do stub 049 fica vestigial); LOGIN único cai em 409 DUPLICADO genérico (sem código de domínio — aceitável, como outros cadastros de chave única); trava SICOM não migrada (não há operador SICOM no monorepo, mas a regra é real → corte-2); senha **deliberadamente não migrada** (cifra fraca sem consumidor); a numeração de CODOPERADOR é digitada (pkGerada:false) — quando houver import das 157 linhas reais, preservar os códigos legados.

## 5. Corte-3a — AUTENTICAÇÃO (backend) — ENTREGUE e verde, 2026-07-13
Recon 3 frentes (Oracle READ-ONLY + fonte Delphi + monorepo). **Achado decisivo:** a senha do legado (`OPERADORES.SENHA`) é **cifra REVERSÍVEL** — César +13 (`TJvCaesarCipher`, chave `APOLLOSISTEMASDEAUTOMAÇÃO` é ENGODO: `StrToIntDef` cai no default 13; udmPrincipal.dfm:889 + JvCipher.pas). O agente decodificou 155/155 senhas para claro (op 1 = `APOLLOSG`, maioria PINs de 4 díg). 2ª coluna `LOGIN_SENHA` (CryptApollo, chave `824EE260648344C2A92016F3161394E2`) é redundante e depende de `FuncoesApollo.pas` (ausente do disco) → **descartada**. Login legado (uLogin.pas:339 CheckUser): `caesar(digitada)==SENHA AND RELACAO_OPERADOR_EMPRESA.CODEMPRESA AND not DESABILITADO AND not INDR='E'`; flag `SOLICITAR_ALTERACAO_SENHA` força troca; auditoria `OPERADORES_ACESSOS` (LOGON/LOGOFF, **sem lockout/expiração/histórico/mínimo**). Backdoors a eliminar: dev `APOLLOSG`, mestra `SYSAPOLLO<dia><mês>`, `SENHARETAGUARDA`-mestra (uSenhaAdmin.pas:71-85).

**Decisões (usuário):** (1) cutover = re-hashear a senha decodificada + `solicitar_alteracao_senha='S'` p/ todos (entra 1x, troca obrigatória); (2) **zero-dep** — `node:crypto` scrypt + JWT HS256 artesanal (o repo só tem kysely/pg/zod/fast-xml-parser); (3) escopo = **backend core** agora, front no corte-3b.

**O que foi construído (migration 070):**
- **`operadores.senha_hash`** (scrypt `scrypt$N$r$p$salt$key`, `apps/api/src/shared/auth/crypto.ts`) — `hashSenha`/`verificarSenha` (timing-safe) + `decodeSenhaLegado`/`encodeSenhaLegado` (César, p/ o cutover). **`operadores_acessos`** (auditoria LOGON/LOGOFF, fiel; sem FAIL).
- **JWT HS256 artesanal** (`apps/api/src/shared/auth/jwt.ts`): `signJwt`/`verifyJwt` sobre `node:crypto` HMAC; payload `{tenant, sub, emp, iat, exp}` (12h); **alg fixo HS256 na verificação** (o header alg é IGNORADO → sem algorithm-confusion); `exp` sempre checado; segredo `AUTH_JWT_SECRET` (fallback de DEV explícito — **produção deve setar**).
- **`AuthModule`** (`/auth`, público quanto a RBAC): `POST /auth/login` (login+senha+empresa? escopado por empresa — needsEmpresa quando há várias), `POST /auth/trocar-senha` (senha atual + nova ≥6 + confirmação; zera a flag), `GET /auth/me`, `POST /auth/logout` (auditoria). Erros PT: `CREDENCIAIS_INVALIDAS`(401, mesma resposta p/ usuário-inexistente e senha-errada), `OPERADOR_DESABILITADO`/`OPERADOR_SEM_EMPRESA`(403), `SENHA_ATUAL_INVALIDA`(422).
- **Middleware modo-duplo** (`tenant.middleware.ts`): JWT Bearer = identidade real; fallback por header só quando `AUTH_ALLOW_HEADER_IDENTITY !== '0'` (dev/test/smoke não quebram; produção seta '0'). Tenant vem do JWT senão do header (login público). O resto do stack (RBAC/db-per-tenant/agregados) consome o `TenantCtx` sem mudança.
- **Smoke §71** (11 checks): senha errada→401 · **backdoor eliminado (ADMIN/APOLLOSG→401)** · login OK + token + auditoria LOGON · Bearer→/auth/me · Bearer autoriza rota protegida · multi-empresa→needsEmpresa · empresa inválida→403 · desabilitado→403 · troca-1º-acesso (mustChange→troca→re-login+flag zerada) · nova senha <6→400 · sem tenant→403. **`auth.spec.ts`** (8): scrypt round-trip/fail-safe, César round-trip, JWT assina/expira/adultera, middleware modo-duplo (Bearer vence header; header-off ignora header; fail-closed).

### Divergências CONSCIENTES / honestidade
- **`mustChangePassword` é retornado mas o login ainda emite token** — o legado bloqueia a ENTRADA até trocar; aqui a UI (corte-3b) força o fluxo. Um gate server-side estrito (recusar chamadas ≠ /auth/trocar-senha enquanto a flag='S') é endurecimento adiado.
- **Sem lockout/expiração/histórico/auditoria-de-falha** — fiel ao legado (que não tem); endurecimento adiado. O único mínimo novo é 6 chars na senha nova.
- **Fallback de header-identity** — ponte de transição (o front ainda manda headers fixos); removido no corte-3b. Em produção, `AUTH_ALLOW_HEADER_IDENTITY=0`.
- **Segredo JWT default de DEV** — se `AUTH_JWT_SECRET` não for setado, usa um fallback conhecido (documentado; produção obriga a variável).
- **Fixtures no 070** (op 90 AUTHTEST 2-empresas, empresa 91) — só para o smoke; id 91 alto p/ não colidir com o smoke de EMPRESAS (que cria a empresa 2).

### Auditoria adversarial (2 agentes: segurança/paridade + regressão/multi-tenant) — folds aplicados
O núcleo cripto passou LIMPO (JWT sem algorithm-confusion — alg fixo HS256, header ignorado; verificação timing-safe; body só parseado após a assinatura conferir; scrypt fail-safe; backdoors comprovadamente ausentes; paridade do login confirmada na fonte). Folds dobrados:
- **[ALTA, regressão introduzida] senha_hash vazava no read** — o `read()` do engine faz `selectAll()` na tabela base; a 070 adicionou `senha_hash` → saía no `GET /cadastro/operadores/:id` e no echo de POST/PUT (a allowlist `colunas` só filtra a ESCRITA). Fix: `colunasOcultasLeitura?: string[]` no `CrudConfig`, aplicada no `read()` do `CrudEngineService`; `operadoresAggregateConfig.colunasOcultasLeitura = ['senha_hash']`. Smoke §71.11.
- **[ALTA, segurança] produção fail-OPEN** — `AUTH_JWT_SECRET` e `AUTH_ALLOW_HEADER_IDENTITY` tinham default inseguro sem guarda. Fix: `assertAuthConfigProducao()` no `main.ts` aborta o boot se, em produção, o segredo estiver ausente/for o default de DEV; `headerIdentityAllowed()` retorna **false em produção** incondicionalmente (fail-closed mesmo se esquecerem o env). Testes A1 em `auth.spec.ts`.
- **[MÉDIA] leitura anônima cross-tenant** — `GET` do CRUD factory não tem `@RequerAcesso` → sem token, só `x-tenant-id` lia qualquer tenant. Fix: `AcessoGuard` agora **exige operador resolvido** (JWT ou header-dev) em TODA rota guardada (inclui leituras) → sem operador = 401. Smoke §71.12.
- **[MÉDIA] mustChange só advisory** — o token funcionava antes da troca (derrota a rotação no cutover). Fix: login com troca-obrigatória emite token com claim `chg` (TTL 15 min); o `AcessoGuard` barra tudo ≠ `/auth/*` com `SENHA_TROCA_OBRIGATORIA` (403). Smoke §71.8.
- **[BAIXA] timing oracle de existência** — o `||` pulava o scrypt p/ usuário inexistente. Fix: `verificarSenha` roda SEMPRE (contra o hash real ou `DUMMY_HASH`). **[BAIXA] custo scrypt** → p=1→3 (memória ~16 MB). **[BAIXA] executavel** → `Generated`. **[MÉDIA-parcial] auditoria de FALHA** → `LOGON_FAIL` para login CONHECIDO (brute-force contra conta).
- **ADIADO (documentado):** rate-limit/throttling + lockout/expiração/histórico de senha (endurecimento além do legado; precisa dep de throttle ou limiter próprio + schema `tentativas/bloqueado`); revogação de token (JWT stateless — TTL 12h; RBAC re-checa a cada request); validação de `x-tenant-id` contra allowlist (evicção/DoS de pool — dívida pré-existente do `DatabaseProvider`); auditoria de falha de login DESCONHECIDO (FK NOT NULL em codoperador).

**Verde pós-fold:** api tsc 0 · api test **138** · smoke **494/0** (13 AUTH) · web tsc 0 · web test 27 · build ✓.

## 6. Corte-3b — AUTENTICAÇÃO (front) — ENTREGUE e verde, 2026-07-13
Torna o auth VISÍVEL: tela de login + guarda de rota + a identidade real substituindo os headers FIXOS
(`x-operador-id:7`/`x-empresa-id:1`) que todas as telas mandavam. Front-only (nenhuma mudança no back).
- **`shared/auth/session.ts`** — singleton NÃO-React da sessão (`{token, operador, empresa, empresas}`) em
  localStorage (sobrevive a reload) + `apiHeaders()` (Bearer) que os fetchers consomem + `loginHeaders()`
  (o tenant viaja só no login; depois o JWT o carrega). `subscribeSessao` reativa o React.
- **`features/auth/`** — `authApi.ts` (login/trocar-senha/me/logout); `AuthContext.tsx` (provider + `useAuth`;
  só grava sessão no sucesso PLENO — needsEmpresa/mustChange NÃO gravam, a tela conduz); `LoginPage.tsx`
  (máquina de estados **credenciais → escolher empresa → trocar senha obrigatória → app**; o token `chg`
  restrito é usado no trocar-senha e a tela re-loga com a senha nova); `RequireAuth.tsx` (sem sessão → `/login`).
- **Wiring:** `router.tsx` (rota `/login` pública FORA do AppLayout; o AppLayout dentro de `<RequireAuth>`);
  `providers.tsx` (`<AuthProvider>` envolvendo tudo); `AppLayout.tsx` (user real da sessão + `onLogout` → sair+/login).
- **Migração dos 15 fetchers** (14 `*Api.ts` + `resourceApi.ts` + o inline do PlanoContas): `headers: HEADERS`
  (fixos) → `headers: apiHeaders()` (Bearer). Nenhum header fixo restou no app.
- **Testes** `apps/web/test/auth.spec.ts` (4): apiHeaders vira Bearer após login e limpa no logout; loginHeaders
  leva o tenant não o Bearer; persistência em localStorage. Web test 27→31.

### Divergências CONSCIENTES / adiados
- **Tenant fixo por config** (`VITE_TENANT_ID`, default 'pinheirao') — sem seleção de tenant por subdomínio/campo
  (multi-tenant de login = fase posterior). **JWT em localStorage** — padrão SPA, exposto a XSS (tradeoff aceito;
  httpOnly cookie = endurecimento futuro). **Sem refresh token** (TTL 12h; ao expirar, re-login).
- **Dev usa SMOKE/smoke123** (fixture da migration 070) — no cutover real cada operador entra com a senha
  legada decodificada e troca no 1º acesso.

### Auditoria adversarial (2 agentes: auth-flow/segurança + migração/regressão) — folds aplicados
Sem bypass de auth nem vazamento de tenant; migração dos 15 fetchers 100% limpa (paths/content-type/sem órfãos,
build+tsc+testes verdes, grafo de import acíclico). Folds dobrados:
- **[MÉDIA] 401 / token expirado deixava a app "presa"** — o JWT de 12h vence e nada limpava a sessão stale
  (`autenticado` seguia true). Fix: `handle401(res)` em TODOS os fetchers (401 c/ sessão → `setSessao(null)` →
  o `RequireAuth` redireciona ao /login) + revalidação no boot (`apiMe()` no `AuthProvider`; 401 derruba a
  sessão persistida, erro de rede não desloga).
- **[MÉDIA] troca-obrigatória travava na falha do re-login** — se o re-login pós-troca falhasse, retentar
  re-tentava a TROCA com a senha ANTIGA (já inválida) → `SENHA_ATUAL_INVALIDA` eterno. Fix: desacoplado —
  após a troca OK, volta à etapa credenciais com a senha NOVA; a retentativa vira login normal.
- **[BAIXA] sessão do localStorage sem validação de shape** → `carregar()` valida token/operador/empresa
  (formato antigo/corrompido = sem sessão) + `AppLayout` usa `sessao?.operador?.` (evita white-screen).
- **[BAIXA] deep-link** — o `RequireAuth` guarda `from`; o `LoginPage` agora navega pra lá após o login.
- **[BAIXA] sync entre abas** — listener de `storage` recarrega a sessão (logout/login numa aba reflete nas outras).
- **[BAIXA] XSS de JWT-em-localStorage** anotado como tradeoff; **[nit]** save duplicado removido (o `entrar`
  já grava; `concluirLogin` eliminado).
- **[MÉDIA, regressão de TESTE] `appLayoutScope.spec.tsx` virou vacuous** (o AppLayout passou a usar `useAuth`;
  o error boundary do RouterProvider engolia o throw). Fix: render sob `<AuthProvider>` **+ asserção FORTE**
  (o botão "Gerar" tem de estar no DOM — `.not.toThrow()` seria vacuoso porque o boundary captura throws da rota).

**Verde pós-fold:** web tsc 0 · web test **31** · web build ✓ (api/smoke inalterados: 494/0).

## 7. Corte-3c — ENDURECIMENTO de segurança do login — ENTREGUE e verde, 2026-07-14
Fecha a lacuna que a auditoria do 3a adiou (M3). **DIVERGÊNCIA CONSCIENTE do legado:** o retaguarda NÃO tem
lockout, contador de tentativas, expiração nem auditoria de FALHA — isto é HARDENING, não cópia fiel (sem golden).
- **`operadores.tentativas_login` + `bloqueado_ate`** (migration 071) — LOCKOUT por tentativas no BANCO (cross-
  instância). Falha conta (incremento atômico `coalesce(tentativas_login,0)+1`); ao exceder `AUTH_MAX_TENTATIVAS_LOGIN`
  → `bloqueado_ate = now()+AUTH_BLOQUEIO_LOGIN_MINUTOS`; login durante o bloqueio → **403 OPERADOR_BLOQUEADO**
  (antes da senha); login correto ZERA o contador; janela expirada recomeça do zero. Config GLOBAL (o login é
  pré-empresa — lida como valor-base, sem override; 0 = desliga).
- **Auditoria de login DESCONHECIDO** — `operadores_acessos.codoperador` virou NULLABLE + `login_tentativa`;
  a falha de um login inexistente agora grava LOGON_FAIL (a limitação anotada no 3a). A SENHA tentada NUNCA é gravada.
- **Expiração no CLIENTE** (`tokenExpirado` em session.ts) — o boot decodifica o `exp` do JWT (sem verificar
  assinatura, só UX) e derruba a sessão expirada ANTES de bater no servidor; se válido, o `apiMe` ainda pega a
  invalidação server-side.
- **Smoke §72** (3): lockout (3 falhas → 403 durante o bloqueio, senha certa não entra) · reset (login correto
  zera o contador) · auditoria de desconhecido (login_tentativa + codoperador NULL). `auth.spec.ts` +1 (tokenExpirado).

### Tradeoffs CONSCIENTES (lockout)
- **DoS auto-infligido** — um atacante pode bloquear a conta de uma vítima só errando a senha dela (tradeoff
  clássico de lockout); a janela curta (15 min) limita o dano. **Enumeração** — a conta bloqueada revela que
  existe (inerente ao lockout; UX de ERP interno). **Rate-limit por IP** (bloqueia brute-force distribuído/
  desconhecido) fica adiado (precisa store compartilhado tipo Redis para a frota; o lockout DB é por-operador).

### Auditoria adversarial (lockout) — folds + limitações documentadas
Lógica central APROVADA (ordem checagem→senha, incremento atômico, reset, migração idempotente, `tokenExpirado`
correto). Folds dobrados:
- **[MÉDIA] `login_tentativa` sem limite → storage-DoS** — `loginSchema.login` ganhou `.max(50)` (espelha o
  cadastro; um login de 5 MB era gravado inteiro no log de falha) + `slice(0,50)` defensivo no insert. `senha` `.max(200)`.
- **[BAIXA] `make_interval(mins => n)`** exigia inteiro → trocado por `secs => n*60` (tolera config fracionária).

**Limitações CONSCIENTES (remédio real = rate-limiting por IP, fast-follow — precisa de store compartilhado
tipo Redis para a frota; adiado):**
- **[MÉDIA] burst concorrente** — o check-then-act do bloqueio (SELECT do topo vs 2º UPDATE) deixa um lote de
  requests em voo consumir > `max` palpites numa janela (o incremento em si é atômico; o bloqueio eventual
  dispara). `scryptSync` serializa o event loop (~10/s) e o lockout ainda fecha — amplificação limitada. Fecha
  de vez com rate-limit ou `SELECT FOR UPDATE` no login.
- **[MÉDIA] DoS auto-infligido** — errar a senha da vítima trava a conta dela; re-trava ao expirar a janela.
- **[BAIXA] enumeração** — conta bloqueada responde 403+minutos (rápido) vs 401 lento (inexistente) → oráculo
  de login válido (timing + status). Aceitável em ERP interno.
- **[BAIXA] `scryptSync` bloqueia o event loop** em todo login (inclui desconhecido, nunca limitado) — flood de
  logins degrada a API; fecha com rate-limit. **[BAIXA] `needsEmpresa` (senha certa, sem empresa) não gera LOGON**
  (o re-login com empresa audita); **[info] `me()` não revoga JWT vivo** ao desabilitar/bloquear (stateless, TTL 12h).

**Verde pós-fold:** api tsc 0 · api test **138** · smoke **497/0** (16 AUTH) · web tsc 0 · web test **32** · web build ✓.

## 8. E7 — SENHA DE OPERAÇÃO por empresa — ENTREGUE e verde, 2026-07-16

Escopo: `EMPRESAS.SENHAADMIN/DESC/CANCEL/GAVETA` (César +13 no legado; verificada por `uSenhaAdmin.pas` via
`dmPrincipal.encSenha`, mesmo componente/key-engodo → shift 13). É uma senha **da empresa** (não do operador) que
autoriza ações sensíveis. Os backdoors mestres do legado (`SYSAPOLLO<dia><mês>`, `OPERADORES.SENHARETAGUARDA`) NÃO
foram reimplementados (são vulnerabilidades — já eliminadas no corte-3a).

**Corte-1 (base, migration 086):** `empresas.senha_{admin,desc,cancel,gaveta}_hash` (scrypt, NÃO a cifra César).
`SenhaOperacaoService.definir` (RBAC `FRMCADEMPRESA/BTNSENHAOPERACAO`) e `verificar` (qualquer operador
autenticado). `verificar` é **timing-safe** (sempre roda scrypt com `DUMMY_HASH`) e **não vira oráculo** (senha
errada e senha-não-configurada colapsam em `ok:false` — `!!row?.hash && ok`). Base `cadastro/senha-operacao`.

**Corte-2a — WIRE do gate 'DESC' na baixa de A Receber:** fiel a `UBaixaAreceber.edtDesc_AcreExit →
SenhaAdministrativa('DESC')` — **qualquer desconto/acréscimo líquido ≠ 0** na baixa exige a senha 'desc' da empresa.
Verificação ANTES da transação (fail-fast, sem locks). `baixarTituloSchema` ganhou `senhaOperacao` (opcional, ≤30,
nunca persistida). Wiring: `CadastroModule` exporta `SenhaOperacaoService`; `CobrancaModule` o importa (aresta
acíclica). Front: campo de senha condicional no diálogo de baixa (aparece só quando há desconto; botão travado sem
a senha). **Paridade:** A PAGAR NÃO gateia (fiel a `UBaixaApagar`); o estorno de baixa NÃO gateia (fiel — `UconsRCBbx`
só gateia editar OBS com 'ADM'). Os gates 'ADM' do legado são em *enable de campo* do cadastro (edtVlrDoc/OBS), não
uma ação distinta no monorepo → não migrados (nota).

**Corte-2b — CUTOVER César→scrypt das senhas da EMPRESA** (`scripts/cutover/senha-empresa.ts` engine +
`load-senha-empresa.ts` loader + `extract-senha-empresa.py` READ-ONLY + `report-senha-empresa.ts` + spec):
- **ACHADO (recon READ-ONLY PINHEIRAO, 4 empresas):** os bytes cifrados têm DIFERENÇAS idênticas entre empresas →
  mesmo plaintext ("081223" em homolog), mas SHIFTS distintos, todos MÚLTIPLOS DE 13 (emp50=13×1, emp51=13×5,
  emp1=13×9, emp2=13×10). É a assinatura de um **RE-ENCODE CUMULATIVO** (`udmCadEmpresa` GetText/SetText re-encoda
  +13 a cada gravação). Como o app decoda com shift **FIXO 13**, só a senha salva 1× (emp50) é verificável — as
  outras 3 já estavam QUEBRADAS no próprio legado (só os backdoors, agora eliminados, as liberavam). **Isto afeta o
  cutover das 157 senhas de OPERADOR (Wave 5): checar se OPERADORES.SENHA sofre o mesmo acúmulo.**
- **Engine:** decoda com shift 13 (fiel ao app) e classifica: `limpa` (decode-13 todo ASCII 32–126 → migra),
  `controle` (byte 0–31/127–159) ou `latin1` (byte ≥160) → SUSPEITA (não migra; admin redefine). A senha em claro
  nunca sai do motor (hash imediato). Números reais: 4 empresas → 12 migradas (mas emp51/emp2 são lixo-imprimível
  do bug — só emp50 é a senha real; ver limitação) → após o fold só ASCII migra.
- **Postura (como o codref):** ferramenta + engine VERIFICADO (spec 6 testes + smoke §80 contra Postgres real),
  NÃO a carga viva (falta o banco do tenant + a corrupção do homolog torna a redefinição pelo admin o caminho real).

### Auditoria adversarial (2 agentes: paridade/segurança + regressão/correctness) — folds aplicados
- **[ALTA] regressão no FRONT** — o diálogo de baixa AR tinha campo "Desconto" mas nenhum campo de senha → baixa
  com desconto travava na UI (422 sem input p/ digitar). Fix: campo `type=password` condicional + botão travado.
- **[ALTA] classificação migrava lixo em silêncio** — `temControle` (só 0–31/127–159) deixava passar emp2 (latin-1
  ≥160) e emp51 (ASCII residual) como `limpa`. Fix: `classificar` → só ASCII imprimível migra; latin-1 e controle
  viram SUSPEITA com motivo. (emp51 ASCII segue indetectável — é exatamente o que o app decoda; doc honesta.)
- **[MÉDIA] §80.3 vacuous + doc do loader errada** ("re-hasheia" — o loader NÃO hasheia). Fix: doc corrigida +
  §80.3 re-roda o MOTOR (salt novo) e testa não-clobber; §80.3b testa `sobrescrever=true`.
- **[BAIXA] loader clobberava senha redefinida** ao re-rodar. Fix: `sobrescrever=false` (padrão) só preenche coluna
  vazia (`AND col IS NULL`) — não sobrescreve redefinição do admin.
- **[BAIXA] fidelidade de bytes/charset** no extrator (NLS do oracledb podia remapear byte alto). Fix:
  `RAWTOHEX(UTL_RAW.CAST_TO_RAW(...))` → bytes exatos → latin-1 no Python.
- **[BAIXA] artefato bruto = segredo** (César reversível). Fix: aviso `[SEGREDO]` no extrator (apagar após uso).
- **[BAIXA] cobertura** "empresa sem senha na baixa" — smoke §32.5.0.

**Limitação CONSCIENTE deferida (como o corte-3c):** o gate 'DESC' é chamável por operador autenticado sem lockout
→ um insider com `BTNBAIXAR` mas sem a senha pode fazer brute-force online de um segredo curto (homolog: 6 dígitos).
scrypt (N=16384,p=3) atrasa mas não impede. Remédio = lockout por-empresa / rate-limit por IP (precisa store
compartilhado tipo Redis p/ a frota) → **fast-follow**. O legado tinha proteção estritamente PIOR (sem lockout +
backdoors mestres). Não é oráculo do segredo (config-vs-errada colapsam).

**Verde pós-fold:** api tsc 0 · api test **151** (145 + 6 cutover) · smoke **567/0** (§32.5 gate + §80 cutover) ·
web tsc 0 · web test **32**.
