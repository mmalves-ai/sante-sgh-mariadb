# F2.4, lote 07-acesso (gestão de acessos, identidade, comentários do domínio de acesso)

## O que mudou
- **Gestão de acessos no banco próprio** (`gestao-fonte-propria.ts`): o que recusava com `modelo-pendente` passou a ler e
  gravar nas tabelas da etapa compartilhada, sempre por inclusão (linha nova), pelo Executor (trilha e idempotência na
  mesma transação):
  - alteração da concessão de perfil grava o antes e o depois em `usuario_perfil_alteracao` (e `alteracoesPerfil` lê);
    a revogação grava o motivo em `usuario_perfil.revogado_motivo` (o histórico mostra);
  - política de senha por versão (`politica_senha_versao`) e limite de sessões por perfil (`limite_sessao_perfil`):
    o histórico é lido; **a gravação recusa com `aplicacao-pendente`** até a sessão (login e troca de senha) aplicar a
    versão publicada e o limite por perfil (pedido fora do lote). Sem isso o gestor veria uma regra "publicada" que não
    vale. A lógica de publicar e de definir já está escrita atrás das travas `SESSAO_APLICA_*` em
    `gestao-fonte-propria.ts`: ligar a sessão, virar a trava e repor o teste de gravação;
  - exceções das contas dormentes (`excecao_conta_dormente`);
  - conferência do registro no conselho (`conferencia_registro_conselho` sobre as inscrições do profissional da conta);
  - RH: mapa cargo → perfil (`perfil_cargo_rh`), resolução das tarefas (`resolucao_tarefa_rh`) e o retrato do RH
    (vínculos, histórico de cargo, férias e afastamentos) lido do modelo próprio, também dentro da gravação.
- **Identidade** (`porta-identidade-propria.ts`): política do segundo fator por onda em `politica_segundo_fator` (incluir,
  alterar encerrando a vigente e ligando a nova, encerrar); o segredo do autenticador vai para `segredo_cifrado`
  (linhas antigas com o envelope em `referencia_cofre` continuam lidas).
- **Vocabulário:** `destino: 'legado'` saiu do cliente web da gestão (`'banco' | 'memoria'`, como a API).
- **Nomes de origem:** comentários do contrato (inclusive o nome do sistema de origem em `contratos/acesso/gestao.ts`, que o
  verificador da F2.4 não pega) e do domínio de acesso reescritos com termos de negócio; a trilha das
  mensagens anteriores usa `mensagem_interna`; o descritivo de auditoria da recertificação ficou neutro.
- **Testes:** caso novo de integração da gestão (alteração, revogação, política de senha, limites, dormência, conselho,
  RH) e da política do segundo fator; 19 de 19 no cliente `f24_07acesso`.

## Decisões pela melhor prática (para o dono ver)
1. **Exceção de conta dormente sempre com prazo** no banco próprio (recusa `prazo-obrigatorio`): no modelo a validade nula
   é a retirada, e exceção sem prazo deixa conta parada aberta para sempre.
2. **Mapa cargo → perfil: uma linha por dia.** Mudança no mesmo dia altera a linha do dia (o anterior vai à trilha); em
   dia novo, a anterior é encerrada na véspera.
3. **Política do segundo fator por grupo é recusada** (`sem-grupos`): o modelo próprio concede por perfil.
4. **A tarefa de RH aponta para o fato de origem** (vínculo, mudança de cargo, férias ou afastamento) por entidade e id; a
   conta criada pela tarefa vale como usuário do vínculo até o cadastro do colaborador ligá-la.
5. **Gravação aceita só quando produz efeito:** política versionada e limite por perfil recusam (`aplicacao-pendente`)
   em vez de gravar sem aplicar.
6. **Nova versão da política de senha exige número** (`exige_numero` = verdadeiro), como o mínimo do produto.

## Pedidos (detalhe em 07-acesso.json)
- Lista das tabelas clínicas a gerar do catálogo próprio (gerador em `tools/` e contrato da imutabilidade).
- Inventário de segredos com identificadores próprios de ponta a ponta (`i18n-segredos.ts` depende dele).
- Flags `GEUSERS.*` das sementes sintéticas: etapa coordenada da seção 5 de `padroes.md`.
- Sessão aplicar a versão publicada da política de senha e o limite de sessões (fora do lote).
- Pedidos de acesso e recertificação: adaptador a escrever (`adaptador-pendente`).
