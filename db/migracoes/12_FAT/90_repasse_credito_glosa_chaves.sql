-- Repasse, glosa revertida depois do desconto (família repasse-glosa, fecho-1, 24/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). A chave estrangeira do crédito para a produção que ele devolve.

ALTER TABLE lancamento_repasse
  ADD CONSTRAINT fk_lancamento_repasse_producao_repasse_id FOREIGN KEY IF NOT EXISTS (producao_repasse_id) REFERENCES producao_repasse (id) ON DELETE RESTRICT;
