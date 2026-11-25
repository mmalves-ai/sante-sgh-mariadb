-- Cadastro, histórico da transferência dos registros do profissional provisório (F8, 02-CAD linha 21, 25/11/2026): só
-- para frente e idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio (pendenciasTransferencia).
-- A regularização troca o profissional do atendimento e das agendas cirúrgica e de internação pelo cadastro definitivo.
-- Para a autoria do registro clínico não se perder, o registro ligado guarda: o profissional em cujo nome o registro
-- estava quando foi ligado ao provisório (o substituto declarado), o profissional que estava no registro no momento da
-- transferência, a situação do registro naquele momento e quando a transferência foi feita. Nada é apagado.
ALTER TABLE profissional_provisorio_uso
  ADD COLUMN IF NOT EXISTS substituto_profissional_id BIGINT UNSIGNED NULL
    COMMENT 'Profissional em cujo nome o registro estava quando foi ligado ao provisório' AFTER agendamento_internacao_id;
ALTER TABLE profissional_provisorio_uso
  ADD COLUMN IF NOT EXISTS anterior_profissional_id BIGINT UNSIGNED NULL
    COMMENT 'Profissional que estava no registro antes da transferência ao cadastro definitivo' AFTER substituto_profissional_id;
ALTER TABLE profissional_provisorio_uso
  ADD COLUMN IF NOT EXISTS situacao_registro_transferencia VARCHAR(30) NULL
    COMMENT 'Situação do registro no momento da transferência (encerrado, realizado...)' AFTER anterior_profissional_id;
ALTER TABLE profissional_provisorio_uso
  ADD COLUMN IF NOT EXISTS transferencia_confirmada BOOLEAN NOT NULL DEFAULT FALSE
    COMMENT 'A transferência de registro encerrado, faturado ou com outro profissional foi confirmada por quem regularizou' AFTER situacao_registro_transferencia;
ALTER TABLE profissional_provisorio_uso
  ADD COLUMN IF NOT EXISTS transferido_em DATETIME(3) NULL
    COMMENT 'Quando o registro passou ao cadastro definitivo' AFTER transferencia_confirmada;
ALTER TABLE profissional_provisorio_uso
  ADD CONSTRAINT IF NOT EXISTS ck_profissional_provisorio_uso_transferencia CHECK (
    transferido_em IS NULL OR (regularizado AND anterior_profissional_id IS NOT NULL));
