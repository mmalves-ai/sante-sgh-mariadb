-- Repasse, saldo devedor do profissional (família repasse-glosa, fecho-1, 24/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). A chave estrangeira do saldo devedor para o débito de origem.

ALTER TABLE estorno_repasse
  ADD CONSTRAINT fk_estorno_repasse_origem_estorno_repasse_id FOREIGN KEY IF NOT EXISTS (origem_estorno_repasse_id) REFERENCES estorno_repasse (id) ON DELETE RESTRICT;
