-- Metas das 24 horas por paciente (01-ADM L117, central de comando assistencial): só para frente e idempotente
-- (ADR 0002, parte 2). O checklist diário do cuidado (segurança, mobilização, sedação e dor, nutrição, dispositivos,
-- exames, alta, família), com prazo, cumprimento e justificativa do não cumprimento; a meta pode nascer de um risco
-- acendido. Nunca apagada: a meta que deixa de valer fica "cancelada", com o motivo.

CREATE TABLE IF NOT EXISTS meta_cuidado_24h (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  atendimento_id     BIGINT UNSIGNED NOT NULL,
  paciente_id        BIGINT UNSIGNED NOT NULL,
  data_referencia    DATE NOT NULL COMMENT 'Dia do cuidado a que a meta pertence',
  categoria          VARCHAR(30) NOT NULL,
  descricao          VARCHAR(500) NOT NULL,
  prazo_em           DATETIME(3) NOT NULL,
  situacao           VARCHAR(30) NOT NULL DEFAULT 'pendente',
  ocorrencia_risco_clinico_id BIGINT UNSIGNED NULL COMMENT 'Risco acendido que originou a meta',
  responsavel_usuario_id BIGINT UNSIGNED NULL,
  encerrada_em       DATETIME(3) NULL,
  encerrada_por_usuario_id BIGINT UNSIGNED NULL,
  justificativa      VARCHAR(1000) NULL COMMENT 'Por que não foi cumprida ou foi cancelada',
  criado_em          DATETIME(3) NOT NULL,
  criado_por         BIGINT UNSIGNED NULL,
  alterado_em        DATETIME(3) NULL,
  alterado_por       BIGINT UNSIGNED NULL,
  versao             INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_meta_cuidado_24h_categoria CHECK (categoria IN ('seguranca','mobilizacao','sedacao_dor','nutricao','dispositivo','exame','alta','familia','outra')),
  CONSTRAINT ck_meta_cuidado_24h_situacao CHECK (situacao IN ('pendente','cumprida','nao_cumprida','cancelada')),
  CONSTRAINT ck_meta_cuidado_24h_encerramento CHECK (situacao = 'pendente' OR (encerrada_em IS NOT NULL AND encerrada_por_usuario_id IS NOT NULL)),
  CONSTRAINT ck_meta_cuidado_24h_justificativa CHECK (situacao IN ('pendente','cumprida') OR justificativa IS NOT NULL),
  KEY ix_meta_cuidado_24h_estabelecimento_data (estabelecimento_id, data_referencia, situacao),
  KEY ix_meta_cuidado_24h_atendimento_id (atendimento_id, data_referencia),
  KEY ix_meta_cuidado_24h_paciente_id (paciente_id),
  KEY ix_meta_cuidado_24h_ocorrencia_risco_clinico_id (ocorrencia_risco_clinico_id),
  KEY ix_meta_cuidado_24h_responsavel_usuario_id (responsavel_usuario_id),
  KEY ix_meta_cuidado_24h_encerrada_por_usuario_id (encerrada_por_usuario_id)
) COMMENT='Metas das 24 horas do paciente internado (checklist diário do cuidado), com prazo, cumprimento e justificativa';
