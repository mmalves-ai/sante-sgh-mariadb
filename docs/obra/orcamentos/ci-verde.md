# Orçamento: ci-verde

estimativa_M: 7
teto_M: 9

- **Objetivo e critério de pronto:** a CI do GitHub (`.github/workflows/ci.yml`) verde no `sante-sgh`.
  - Ela nunca foi adaptada do `new-sgh` e falha em todo push, com e-mail "run failed" para o dono.
  - Pronto quando cada passo do `ci.yml` passa localmente e no GitHub.
- **Escopo, etapa 1 (agora, 1 agente):**
  - verificadores, configuração do Nx, `package.json`, `.github/` e `tools/`;
  - retirar ou adaptar o que é do `new-sgh`: legado, assinatura, coexistência com o Firebird, matriz, pentest,
    implantação e SBIS onde dependem do legado;
  - a raiz do `.env` registrada;
  - os segredos de teste falsos marcados como fixture.
- **Escopo, etapa 2 (depois do conferidor da F2.4):** `prettier --write` e `nx lint typecheck test build` sobre o
  código, feitos pelo orquestrador ou pelo mesmo agente.
- **Agentes por papel:** compartilhado 1 (4,5 M), revisor 1 (0,5 M), corretor até 1 (0,8 M).
- **Estimativa:** 5,8 × 1,2 ≈ 7 M. Teto: 9 M.
- **Regra:** nenhum verificador é afrouxado para passar. O que é do `new-sgh` e não vale aqui sai com registro do
  motivo; o que vale aqui é corrigido de verdade.
- **Fora do escopo:** `apps/` e `packages/` (a F2.4 está editando agora).
