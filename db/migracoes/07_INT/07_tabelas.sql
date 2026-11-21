-- INT, lote 7 (F4 conector, rodada 4: pedidos de modelo das fatias, registrados para a trilha F2.2 em
-- docs/obra/passagens/F4-pedidos-f22.md). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (07_chaves.sql).

-- L6-14 (12)
ALTER TABLE acomodacao
  ADD COLUMN local_cobranca_id BIGINT UNSIGNED NULL COMMENT 'Local de cobrança da acomodação',
  ADD KEY ix_acomodacao_local_cobranca_id (local_cobranca_id);

-- L6-14 (15)
ALTER TABLE ocupacao_leito
  ADD COLUMN categoria_acomodacao_id BIGINT UNSIGNED NULL COMMENT 'Nulo: a categoria do quarto',
  ADD KEY ix_ocupacao_leito_categoria_acomodacao_id (categoria_acomodacao_id);

-- L6-15 (M5): uma unidade assistencial pode ter várias alas ou blocos de internação
ALTER TABLE unidade_internacao
  ADD KEY ix_unidade_internacao_unidade_assistencial (unidade_assistencial_id),
  DROP INDEX uq_unidade_internacao_unidade_assistencial;

-- L6-15 (LEITO_CRITICIDADE_AREA)
ALTER TABLE leito_hospitalar
  ADD COLUMN criticidade_area_id BIGINT UNSIGNED NULL COMMENT 'Classe sanitária da área do leito (higienização)',
  ADD KEY ix_leito_hospitalar_criticidade_area_id (criticidade_area_id);

-- L6-15 (INTERNACAO_AUTORIZACAO)
ALTER TABLE internacao
  ADD COLUMN autorizado_em DATE NULL COMMENT 'Data da autorização da internação' AFTER senha_autorizacao,
  ADD COLUMN autorizacao_validade DATE NULL COMMENT 'Validade da autorização' AFTER autorizado_em;
