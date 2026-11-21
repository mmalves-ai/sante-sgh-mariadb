# Orçamento: preco-profissional

estimativa_M: 4
teto_M: 6

- **Objetivo:** levantar e desenhar o **preço por profissional**, regra comum do mercado e de uso no sistema de origem,
  que o modelo não cobria. Lembrete do dono, 2026-11-21: continuidade e melhor prática.
- **Etapa 1 (agora, 1 agente, só leitura e documento):**
  - Na cópia de desenvolvimento da origem, pelo conector, que só lê, e **só com contagens**, localizar onde ficam:
    - o valor por médico, por convênio, por procedimento ou grupo, e por vigência;
    - os convênios que cada médico atende;
    - a diferença entre o que se cobra (preço) e o que o médico recebe (repasse).
  - Comparar com o modelo (`db/migracoes`, worktree `f4`) e com o cálculo de preço do domínio (`packages/dominio-preco`).
  - Propor DDL, mapa do conector e regra de precedência.
- **Etapa 2 (depois dos lotes da rodada 5):** aplicar. Tem orçamento próprio, a partir da proposta.
- **Agentes:** 1 pesquisador, 3 M de referência. Estimativa: 3 × 1,2 ≈ 4 M. Teto: 6 M.
- **Fora do escopo:** editar arquivos. A rodada 5 e a F2.4 estão rodando.
