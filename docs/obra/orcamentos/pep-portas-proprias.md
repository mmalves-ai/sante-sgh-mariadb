# Orçamento: pep-portas-proprias

estimativa_M: 22.4
teto_M: 29

- **Lacuna de construção (achada pelo dono no browser em 23/11, cerca de 21h40; causa conferida pelo orquestrador):**
  em `apps/api/src/modulos/pep/modulo.ts` (portasDoPep, ramo `ctx.nucleo && cliente`), 4 das 6 portas do PEP não têm
  adaptador sobre o MariaDB e recusam todo método com 503: `prontuario` (lista de registros, busca por palavra,
  conteúdo, acessos), `formularioNovo`, `prescricao` e `documentos`. Só `registro` e `worklist` são próprias. Vem da
  F2.2 onda 4 (eba07ff8). O DDL existe (06_PEP: prescricao, prescricao_item*, documento_prontuario, receita_medica,
  modelo_documento_clinico...).
- **Rodada:** por porta, em linha de produção: construtor (porta própria + testes unitários + .int.spec contra cliente
  de teste, com a porta de memória como especificação de comportamento) → revisor adversarial só do diff → corretor.
  Depois, um integrador liga as 4 portas no modulo.ts, roda os .int.spec e a suíte da API e varre todos os módulos
  atrás de "porta que recusa no ramo do núcleo".
- **Agentes:** 4 construtores × 2,5 M = 10; 4 revisores × 0,5 = 2; 4 corretores × 0,8 = 3,2; integrador 1 × 3,5.
  Soma 18,7 M × 1,2 = **22,4 M**; teto **29 M**.
