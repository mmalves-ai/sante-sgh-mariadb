# Orçamento: f3-funcoes

estimativa_M: 253
teto_M: 329

- **Medido (24/11, 09h, fichas finais da f3-marcos depois da revisão adversarial):** 255 funções da lista mínima da
  F3: 92 cobertas (36%), 141 parciais, 22 faltam. Nenhum marco aceito.
- **Rodada:** 163 funções pendentes em 58 fatias de até 3 funções (54 geradas por script das fichas,
  sante-sgh-dados/obra/f3-funcoes/fatiar.py, mais 4 com as 10 gravações da gestão da qualidade), intercaladas por
  marco para não haver duas fatias do mesmo módulo ao mesmo tempo no começo. Cada fatia em linha de produção:
  construtor → revisor adversarial ("sem cara de SPDATA" + contrato de efeito) → corretor. 3 integradores no fim
  (A: F3.1 a F3.3; B: F3.4 a F3.6; C: F3.7 a F3.9), que recontam pela ficha e rodam os E2E.
- **Agentes:** 58 × (construtor 2,0 + revisor 0,6 + corretor 1,0) + 3 × 3 = 217,8 M × 1,2 ≈ **253 M**; teto **329 M**.
- **Memória:** carga da ProntoCardio na reta final; o vigia v4 derruba os testes dos agentes abaixo de 4 GB; os
  agentes testam com MIN_GB=10 e, se esperarem mais de 8 min, seguem com o código e registram o teste não rodado.
