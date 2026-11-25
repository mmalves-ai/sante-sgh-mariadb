-- C1-119 (07-RH linha 171): a leitura do dosímetro e a exposição a quimioterápico se cancelam com motivo, como a
-- entrega de EPI (W0-06): o registro lançado por engano fica guardado, marcado como cancelado, e deixa de contar na
-- dose do ano e nas pendências. Nunca se apaga (NR-32; CNEN NN 3.01: a dose por período fica no prontuário ocupacional).
-- A chave única da leitura (vínculo, dosímetro e início do período) passa a valer só para a leitura ativa: depois de
-- cancelar a leitura errada, o SESMT lança a certa do mesmo período.
-- Para frente e idempotente.

ALTER TABLE leitura_dosimetria
  ADD COLUMN IF NOT EXISTS situacao VARCHAR(20) NOT NULL DEFAULT 'ativo' COMMENT 'ativo ou cancelado (com motivo)' AFTER observacao,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento VARCHAR(400) NULL AFTER situacao,
  ADD COLUMN IF NOT EXISTS periodo_ativo DATE AS (IF(situacao = 'ativo', periodo_inicio, NULL)) PERSISTENT
    COMMENT 'Auxiliar da unicidade: o início do período da leitura ativa' AFTER motivo_cancelamento,
  ADD UNIQUE KEY IF NOT EXISTS uq_leitura_dosimetria_periodo_ativo (vinculo_trabalho_id, dosimetro, periodo_ativo);

ALTER TABLE leitura_dosimetria DROP KEY IF EXISTS uq_leitura_dosimetria_periodo;

ALTER TABLE leitura_dosimetria
  DROP CONSTRAINT IF EXISTS ck_leitura_dosimetria_situacao,
  DROP CONSTRAINT IF EXISTS ck_leitura_dosimetria_cancelamento;
ALTER TABLE leitura_dosimetria
  ADD CONSTRAINT ck_leitura_dosimetria_situacao CHECK (situacao IN ('ativo','cancelado')),
  ADD CONSTRAINT ck_leitura_dosimetria_cancelamento CHECK (situacao <> 'cancelado' OR motivo_cancelamento IS NOT NULL);

ALTER TABLE exposicao_quimioterapico
  ADD COLUMN IF NOT EXISTS situacao VARCHAR(20) NOT NULL DEFAULT 'ativo' COMMENT 'ativo ou cancelado (com motivo)' AFTER observacao,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento VARCHAR(400) NULL AFTER situacao;

ALTER TABLE exposicao_quimioterapico
  DROP CONSTRAINT IF EXISTS ck_exposicao_quimioterapico_situacao,
  DROP CONSTRAINT IF EXISTS ck_exposicao_quimioterapico_cancelamento;
ALTER TABLE exposicao_quimioterapico
  ADD CONSTRAINT ck_exposicao_quimioterapico_situacao CHECK (situacao IN ('ativo','cancelado')),
  ADD CONSTRAINT ck_exposicao_quimioterapico_cancelamento CHECK (situacao <> 'cancelado' OR motivo_cancelamento IS NOT NULL);
