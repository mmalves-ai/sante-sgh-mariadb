# Orçamento: construir-2

estimativa_M: 430
teto_M: 560

- **Por quê:** as 124 funções fecháveis por agente de esforço grande (G) da triagem-1 (F3, F7 e F8), uma por agente,
  com os passos concretos da triagem (`sante-sgh-dados/obra/construir-2/fatias.json`). A construir-1 (138 P e M)
  rendeu 92 prontas por ~305 M (3,3 M por função pronta) com o mesmo desenho.
- **Desenho:** igual ao da construir-1 (construtor prova domínio e contrato de efeito, escreve o E2E sem rodar, não
  edita a ficha; revisão adversarial só do pronto; corretor só com achado); integração à parte.
- **Agentes:** 124 construtores × 2,4 M + ~90 revisores × 0,35 M + ~70 corretores × 1,3 M ≈ 420 M; teto 560 M.
- **Portão de rendimento:** acima de 5 M por função pronta (G pesa mais que P/M), parar e redesenhar (por exemplo,
  partir a função em duas fatias sequenciais).
