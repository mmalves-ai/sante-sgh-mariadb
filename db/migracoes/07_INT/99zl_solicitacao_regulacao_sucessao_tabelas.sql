-- C3-013 (09 linha D9): a mudança de situação da regulação é uma linha nova com o mesmo número da central, ligada à
-- anterior (solicitacao_anterior_id). O único (central, número) recusava a sucessão; passa a índice simples, e a
-- sucessão ganha um único: cada solicitação tem no máximo uma sucessora. A porta própria confere que o número não
-- está ligado a outro pedido. Só para frente e idempotente (ADR 0002).
ALTER TABLE solicitacao_regulacao
  DROP INDEX IF EXISTS uq_solicitacao_regulacao_central_numero,
  ADD KEY IF NOT EXISTS ix_solicitacao_regulacao_central_numero (central_reguladora_id, numero);

ALTER TABLE solicitacao_regulacao
  ADD UNIQUE KEY IF NOT EXISTS uq_solicitacao_regulacao_sucessao (solicitacao_anterior_id);
