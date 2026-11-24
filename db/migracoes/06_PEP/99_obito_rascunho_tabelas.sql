-- PEP, declaração de óbito (03-PEP L126, corretor do F3.3, 24/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2). Sem gatilho; a regra fica no domínio (declaracao-obito.ts) e na porta própria.
--   O rascunho (sem número) pode ser cancelado sem ganhar data de emissão: a cancelada sem número é a que nunca foi
--   emitida e fica com emitida_em nulo. A regra da declaração emitida não muda: emitida exige número e data de
--   emissão, e a cancelada que teve número continua exigindo a data de emissão.

ALTER TABLE declaracao_obito
  DROP CONSTRAINT IF EXISTS ck_declaracao_obito_emitida,
  ADD CONSTRAINT ck_declaracao_obito_emitida CHECK (
    situacao = 'rascunho' OR emitida_em IS NOT NULL OR (situacao = 'cancelada' AND numero IS NULL)),
  DROP CONSTRAINT IF EXISTS ck_declaracao_obito_numero,
  ADD CONSTRAINT ck_declaracao_obito_numero CHECK (
    situacao = 'rascunho' OR numero IS NOT NULL OR (situacao = 'cancelada' AND emitida_em IS NULL));
