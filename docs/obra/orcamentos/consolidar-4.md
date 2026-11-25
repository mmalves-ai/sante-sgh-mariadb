# Orçamento: consolidar-4

estimativa_M: 4
teto_M: 5.2

- **Por quê:** o ci-sim do merge da tela Carga e sincronismo (9f2a5ef7) ficou vermelho só por código vindo do branch
  da sessão Painel de Injeção: lint de fronteira em tools/db/plataforma-criar-admin(.spec).ts (importa apps/api) e
  nome de tabela dinâmico sem catálogo em apps/api/src/modulos/plataforma-onboarding/ponte-script.ts (gerador de
  privilégios; derruba privilegios.spec e a SBIS). A sessão não respondeu em 2 h; o push está parado.
- **Agentes:** 1 corretor no worktree ../sante-sgh-wt/push-fix (branch push-fix a partir de 9f2a5ef7, fora da árvore
  da rodada construir-1) × 3 M + margem; teto 5,2 M.
