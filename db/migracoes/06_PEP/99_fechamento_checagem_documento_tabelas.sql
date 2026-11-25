-- PEP, registro do fechamento da checagem do turno no prontuário (03-PEP L113, C1-023, 25/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio (dominio-enfermagem/checagem/registro-turno.ts).
-- Cada fechamento gera, por atendimento da composição, um documento do prontuário (documento_prontuario, à espera da
-- assinatura do enfermeiro) com o que foi administrado, não administrado, suspenso e o que ficou pendente. Esta tabela
-- liga o fechamento ao documento de cada paciente; nunca se apaga (a reabertura deixa o documento no histórico e o
-- novo fechamento gera outro).
CREATE TABLE IF NOT EXISTS fechamento_checagem_paciente (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fechamento_horario_checagem_id BIGINT UNSIGNED NOT NULL,
  atendimento_id    BIGINT UNSIGNED NOT NULL,
  paciente_id       BIGINT UNSIGNED NOT NULL,
  quantidade_administrados INT UNSIGNED NOT NULL DEFAULT 0,
  quantidade_nao_administrados INT UNSIGNED NOT NULL DEFAULT 0,
  quantidade_suspensos INT UNSIGNED NOT NULL DEFAULT 0,
  quantidade_pendentes INT UNSIGNED NOT NULL DEFAULT 0,
  documento_prontuario_id BIGINT UNSIGNED NULL COMMENT 'Documento do prontuário do paciente com o registro do turno',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_fechamento_checagem_paciente_par (fechamento_horario_checagem_id, atendimento_id),
  UNIQUE KEY uq_fechamento_checagem_paciente_documento (documento_prontuario_id),
  KEY ix_fechamento_checagem_paciente_atendimento (atendimento_id),
  KEY ix_fechamento_checagem_paciente_paciente (paciente_id)
) COMMENT='Registro do fechamento da checagem do turno por paciente, com o documento do prontuário gerado';
