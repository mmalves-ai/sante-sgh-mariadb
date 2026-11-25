-- Impressão da identificação do paciente (01-ADM L79): a pulseira e a etiqueta de cada atendimento passam a ter a
-- primeira impressão registrada (via 1), com a estação e a impressora por onde saiu. É a prova que a reimpressão
-- controlada exige: a partir dela, cada nova via vai para registro_reimpressao com o motivo do catálogo.
-- Uma linha por atendimento e tipo; nunca apagada. Só para frente e idempotente (ADR 0002, parte 2).

CREATE TABLE IF NOT EXISTS impressao_identificacao (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id  BIGINT UNSIGNED NOT NULL,
  atendimento_id      BIGINT UNSIGNED NOT NULL,
  tipo                VARCHAR(20) NOT NULL COMMENT 'pulseira ou etiqueta de identificação',
  vias                SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Vias já impressas (a primeira impressão é a via 1)',
  primeira_impressao_em DATETIME(3) NOT NULL,
  ultima_impressao_em DATETIME(3) NOT NULL,
  finalidade_impressao_id BIGINT UNSIGNED NULL,
  estacao_trabalho_id BIGINT UNSIGNED NULL COMMENT 'Estação da primeira impressão',
  impressora_id       BIGINT UNSIGNED NULL COMMENT 'Impressora da primeira impressão, resolvida pela estação',
  criado_em           DATETIME(3) NOT NULL,
  criado_por          BIGINT UNSIGNED NULL,
  alterado_em         DATETIME(3) NULL,
  alterado_por        BIGINT UNSIGNED NULL,
  versao              INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_impressao_identificacao_tipo CHECK (tipo IN ('pulseira','etiqueta')),
  CONSTRAINT ck_impressao_identificacao_vias CHECK (vias >= 1),
  CONSTRAINT ck_impressao_identificacao_datas CHECK (ultima_impressao_em >= primeira_impressao_em),
  UNIQUE KEY uq_impressao_identificacao_atendimento_tipo (atendimento_id, tipo),
  KEY ix_impressao_identificacao_estabelecimento_id (estabelecimento_id),
  KEY ix_impressao_identificacao_finalidade_impressao_id (finalidade_impressao_id),
  KEY ix_impressao_identificacao_estacao_trabalho_id (estacao_trabalho_id),
  KEY ix_impressao_identificacao_impressora_id (impressora_id)
) COMMENT='Primeira impressão e número de vias da pulseira e da etiqueta de identificação de cada atendimento';
