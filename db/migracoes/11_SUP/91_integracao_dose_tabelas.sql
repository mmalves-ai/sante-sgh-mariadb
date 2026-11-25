-- Suprimentos, a regra de integração prescrição × estoque aplicada a cada dose (F3.6-04, 05-SUP linha 7, 24/11/2026):
-- só para frente e idempotente (ADR 0002, parte 2).
-- Quando uma regra de integração atende o item prescrito, cada horário do item ganha aqui a decisão: se a dose vai ao
-- estoque, o local que a atende (o substituto quando o principal não tem saldo), a regra que decidiu e o instante em
-- que a dose entra na fila da farmácia (na prescrição, antes do horário, ou à espera da liberação do farmacêutico ou
-- do aprazamento). Horário sem linha aqui: nenhuma regra atende o item, e a dose segue sem integração automática.
-- A decisão é do domínio (regraVigente e decidirIntegracao); o banco só guarda o resultado.
CREATE TABLE IF NOT EXISTS integracao_dose_estoque (
  id                             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id             BIGINT UNSIGNED NOT NULL,
  horario_administracao_id       BIGINT UNSIGNED NOT NULL COMMENT 'A dose (horário do item prescrito)',
  prescricao_item_id             BIGINT UNSIGNED NOT NULL,
  regra_integracao_prescricao_id BIGINT UNSIGNED NOT NULL COMMENT 'Regra vigente no momento da decisão',
  integra_estoque                BOOLEAN NOT NULL COMMENT 'Falso: a regra diz que este item não vai ao estoque',
  tipo_integracao                VARCHAR(30) NOT NULL,
  momento_integracao             VARCHAR(30) NOT NULL,
  forma_dispensacao              VARCHAR(30) NOT NULL,
  atendente_local_estoque_id     BIGINT UNSIGNED NULL COMMENT 'Local que atende a dose; nulo sem saldo no principal e no substituto, ou sem integração',
  usou_substituto                BOOLEAN NOT NULL DEFAULT FALSE,
  liberar_em                     DATETIME(3) NULL COMMENT 'Instante em que a dose entra na fila da farmácia; nulo enquanto espera o evento',
  evento_liberacao               VARCHAR(30) NULL COMMENT 'Evento que liberou a dose depois da prescrição',
  origem                         VARCHAR(20) NOT NULL DEFAULT 'sistema' COMMENT 'sistema, migracao ou integracao',
  criado_em                      DATETIME(3) NOT NULL,
  criado_por                     BIGINT UNSIGNED NULL,
  alterado_em                    DATETIME(3) NULL,
  alterado_por                   BIGINT UNSIGNED NULL,
  versao                         INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_integracao_dose_estoque_tipo CHECK (tipo_integracao IN ('requisicao_automatica','dispensacao_direta','sem_integracao')),
  CONSTRAINT ck_integracao_dose_estoque_momento CHECK (momento_integracao IN ('na_prescricao','na_liberacao_farmaceutica','no_aprazamento','antes_do_horario')),
  CONSTRAINT ck_integracao_dose_estoque_forma CHECK (forma_dispensacao IN ('dose_individualizada','dose_unitaria','dose_coletiva','kit')),
  CONSTRAINT ck_integracao_dose_estoque_evento CHECK (evento_liberacao IS NULL OR evento_liberacao IN ('liberacao_farmaceutica','aprazamento')),
  CONSTRAINT ck_integracao_dose_estoque_sem_integracao CHECK (integra_estoque OR (atendente_local_estoque_id IS NULL AND liberar_em IS NULL)),
  CONSTRAINT ck_integracao_dose_estoque_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_integracao_dose_estoque_horario (horario_administracao_id),
  KEY ix_integracao_dose_estoque_fila (estabelecimento_id, atendente_local_estoque_id, liberar_em),
  KEY ix_integracao_dose_estoque_prescricao_item_id (prescricao_item_id),
  KEY ix_integracao_dose_estoque_regra_integracao_prescricao_id (regra_integracao_prescricao_id),
  KEY ix_integracao_dose_estoque_atendente_local_estoque_id (atendente_local_estoque_id)
) COMMENT='Decisão da regra de integração prescrição × estoque para cada dose: local que atende e liberação para a farmácia';
