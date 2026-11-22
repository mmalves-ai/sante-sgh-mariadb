# Orçamento: ci-etapa2

estimativa_M: 18
teto_M: 23

- **Objetivo:** esteira do GitHub (`.github/workflows/ci.yml`) verde, para liberar o push dos commits retidos. Itens
  "etapa 2" de `docs/obra/ci-verde.md`:
  - prettier, nx lint, typecheck, test e build de `apps/` e `packages/`;
  - segredos (marcador em teste) e SBIS (evidências do produto);
  - permissões e privilégios;
  - lint da instalação (catálogo de operações num pacote);
  - e2e @M00;
  - segurança: Semgrep altos, dependências (vue-i18n, @intlify, fast-uri, fastify, glob, minimatch) e `USER` nos
    Dockerfiles.
- **Agentes por papel:**
  - levantamento por script: 1 × 1 M;
  - lotes por área, sem arquivos em comum: até 4 × 2 M;
  - revisores: 4 × 0,4 M;
  - corretores: até 2 × 1 M;
  - conferidor: 1 × 2 M.
  - Soma 14,6 M × 1,2 = **18 M**; teto 30% acima = **23 M**.
- **Cuidado:** a carga da ProntoCardio roda ao mesmo tempo (worker do conector, banco `cliente_prontocardio`). A
  rodada não toca no conector em execução, no cliente nem na plataforma real.
