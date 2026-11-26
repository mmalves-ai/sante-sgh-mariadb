-- Cancelamento da exceção da regra de lançamento automático (06-FAT linha 16, F3.7, C1-090, 25/11/2026): só para
-- frente e idempotente (ADR 0002, parte 2). A chave estrangeira de quem cancelou.

ALTER TABLE regra_lancamento_excecao
  ADD CONSTRAINT fk_regra_lancamento_excecao_cancelada_por FOREIGN KEY IF NOT EXISTS (cancelada_por) REFERENCES usuario (id) ON DELETE RESTRICT;
