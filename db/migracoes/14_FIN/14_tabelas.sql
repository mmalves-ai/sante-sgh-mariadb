-- FIN, lote 14 (F4 conector, rodada 4: pedidos de modelo das fatias, registrados para a trilha F2.2 em
-- docs/obra/passagens/F4-pedidos-f22.md). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (14_chaves.sql).

-- L8-10 (2): titulo_pagar
ALTER TABLE titulo_pagar
  ADD COLUMN grupo_lancamento_financeiro_id BIGINT UNSIGNED NULL COMMENT 'Grupo de lançamentos (baixa, borderô, transferência)',
  ADD KEY ix_titulo_pagar_grupo_lancamento_financeiro_id (grupo_lancamento_financeiro_id);

-- L8-10 (2): titulo_receber
ALTER TABLE titulo_receber
  ADD COLUMN grupo_lancamento_financeiro_id BIGINT UNSIGNED NULL COMMENT 'Grupo de lançamentos (baixa, borderô, transferência)',
  ADD KEY ix_titulo_receber_grupo_lancamento_financeiro_id (grupo_lancamento_financeiro_id);

-- L8-10 (2): movimento_bancario
ALTER TABLE movimento_bancario
  ADD COLUMN grupo_lancamento_financeiro_id BIGINT UNSIGNED NULL COMMENT 'Grupo de lançamentos (baixa, borderô, transferência)',
  ADD KEY ix_movimento_bancario_grupo_lancamento_financeiro_id (grupo_lancamento_financeiro_id);

-- L8-10 (2): adiantamento
ALTER TABLE adiantamento
  ADD COLUMN grupo_lancamento_financeiro_id BIGINT UNSIGNED NULL COMMENT 'Grupo de lançamentos (baixa, borderô, transferência)',
  ADD KEY ix_adiantamento_grupo_lancamento_financeiro_id (grupo_lancamento_financeiro_id);

-- L8-11 (6)
ALTER TABLE conta_bancaria
  ADD COLUMN acesso_restrito BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Só os usuários com permissão na conta a veem';

-- L8-05 (9), parte: filtros por tipo de conta e de lançamento (tipo de ato e subtipo da diária a detalhar)
ALTER TABLE depara_conta_externa
  ADD COLUMN tipo_conta_id BIGINT UNSIGNED NULL COMMENT 'Filtro: tipo de conta; nulo: todos',
  ADD COLUMN tipo_lancamento_id BIGINT UNSIGNED NULL COMMENT 'Filtro: tipo de lançamento; nulo: todos',
  ADD KEY ix_depara_conta_externa_tipo_conta_id (tipo_conta_id),
  ADD KEY ix_depara_conta_externa_tipo_lancamento_id (tipo_lancamento_id);
