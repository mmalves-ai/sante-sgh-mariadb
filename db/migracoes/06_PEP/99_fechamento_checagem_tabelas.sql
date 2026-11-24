-- PEP, fechamento da checagem do turno (03-PEP L113, correção da revisão, 24/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho; as regras ficam no domínio (dominio-enfermagem/checagem/fechamento-turno.ts).
--   - a justificativa de fechar com pendências e a quantidade de pendentes passam a ficar no próprio fechamento (antes
--     só na trilha), para a leitura do turno e o histórico por paciente;
--   - fechamento_checagem_horario guarda a composição de cada fechamento: os horários que ele travou e os pendentes que
--     ele passou ao turno seguinte. Nunca se apaga: a reabertura e o novo fechamento do mesmo turno deixam os dois
--     conjuntos reconstruíveis (horario_administracao.fechamento_horario_checagem_id aponta só o vigente).
ALTER TABLE fechamento_horario_checagem
  ADD COLUMN IF NOT EXISTS quantidade_pendentes INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Horários pendentes passados ao turno seguinte' AFTER quantidade_horarios,
  ADD COLUMN IF NOT EXISTS justificativa_pendencias VARCHAR(500) NULL COMMENT 'Por que o turno fechou com horários pendentes' AFTER quantidade_pendentes;

ALTER TABLE fechamento_horario_checagem
  ADD CONSTRAINT IF NOT EXISTS ck_fechamento_horario_checagem_pendencias CHECK (quantidade_pendentes = 0 OR justificativa_pendencias IS NOT NULL);

CREATE TABLE IF NOT EXISTS fechamento_checagem_horario (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fechamento_horario_checagem_id BIGINT UNSIGNED NOT NULL,
  horario_administracao_id BIGINT UNSIGNED NOT NULL,
  papel             VARCHAR(20) NOT NULL COMMENT 'travado (resolvido, travado pelo fechamento) ou pendente (passado ao turno seguinte)',
  situacao_checagem_id BIGINT UNSIGNED NOT NULL COMMENT 'Situação do horário no instante do fechamento',
  turno_anterior    BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'O horário era de um turno anterior e chegou pendente a este',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_fechamento_checagem_horario_papel CHECK (papel IN ('travado','pendente')),
  UNIQUE KEY uq_fechamento_checagem_horario_par (fechamento_horario_checagem_id, horario_administracao_id),
  KEY ix_fechamento_checagem_horario_horario (horario_administracao_id, papel),
  KEY ix_fechamento_checagem_horario_situacao (situacao_checagem_id)
) COMMENT='Composição do fechamento da checagem do turno: horários travados e pendentes passados adiante';
