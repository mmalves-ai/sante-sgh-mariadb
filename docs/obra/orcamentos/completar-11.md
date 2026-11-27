# Orçamento: completar-11 (27/11 16h20)

Fecha o que a completar-10 deixou e o que veio da sessão do conector. Tarefas: (1) tela da central de integrações
externas (decisão 53: o pedido do dono é a chave pela tela); (2) partida a frio do E2E e religar o pacote @jornada
(decisão 59); (3) A4, construtor com a versão migrada sem formato; (4) A5, modelos liberados por cliente (ADR 0002);
(5) decisão 62, rotina "destino confirmado → aferição"; (6) fichas do conector; (7) C2-017 e (8) C3-027, que só pedem o E2E.

estimativa_M: 10
teto_M: 13

Base: completar-10 mediu ~1,05 M por agente; 8 x 1,2 M ≈ 10 M.

## BRIEF da rodada
- O mesmo da completar-10 (docs/obra/orcamentos/completar-10.md, seção "BRIEF da rodada"), mais docs/obra/integracoes-externas.md
  para a central.
- A4/A5 vêm da revisão da sessão do conector: a versão migrada de modelo_documento_versao tem formato NULL
  (formulario-novo-porta-propria.ts:122 e :546 recusam "nova versão a partir desta" e o código em uso);
  MODELOS_LIBERADOS_PADRAO e MODELOS_FORA_DA_LIBERACAO (packages/contratos/src/pep/registro-clinico.ts:402-424) são
  constantes de um hospital e viram configuração por cliente.
