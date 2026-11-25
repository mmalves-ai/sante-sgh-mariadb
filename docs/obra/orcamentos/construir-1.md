# Orçamento: construir-1

estimativa_M: 345
teto_M: 450

- **Por quê:** a triagem-1 (25/11) classificou 262 das 294 funções ainda não cobertas como fecháveis por agente (A).
  Esta rodada pega as 138 de esforço pequeno ou médio (31 P, 107 M; F3 71, F7 29, F8 38), uma por agente, com os passos
  concretos que a triagem já levantou (`sante-sgh-dados/obra/construir-1/fatias.json`).
- **Desenho (o que rendeu ~1 M por função coberta na f3-integrar):** construtor prova domínio e contrato de efeito,
  escreve o E2E e não o roda, não edita a ficha; revisão adversarial só do que ficou pronto; corretor só com achado.
  A integração (E2E em lote, ficha, recontagem) é uma rodada à parte, como a f3-integrar.
- **Agentes:** 138 construtores × 1,9 M + ~100 revisores × 0,45 M + ~60 corretores × 1,0 M ≈ 367 M; meta 345 M pelo
  esforço menor; teto 450 M.
- **Portão de rendimento:** medido a cada relatório; acima de 4 M por função pronta, parar e redesenhar.
