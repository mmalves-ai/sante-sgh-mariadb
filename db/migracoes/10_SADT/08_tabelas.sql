-- SADT, lote 08 (F4 conector, rodada 3 de cobertura, grupo 3: pedido de modelo da fatia L7-04, registrado para a
-- trilha F2.2 em docs/obra/passagens/F4-decisoes-destino.md). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (08_chaves.sql).

-- L7-04: exames cobertos por cada assinatura de documento do prontuário (exames assinados em conjunto). Sem o
-- vínculo, perde-se a prova de quais exames cada assinatura cobriu.
CREATE TABLE exame_item_assinatura (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  exame_item_id            BIGINT UNSIGNED NOT NULL,
  documento_prontuario_id  BIGINT UNSIGNED NOT NULL COMMENT 'Documento assinado que cobre o exame',
  local_assistencia_id     BIGINT UNSIGNED NULL COMMENT 'Local de assistência em que a assinatura foi feita',
  origem                   VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em                DATETIME(3) NOT NULL,
  criado_por               BIGINT UNSIGNED NULL,
  alterado_em              DATETIME(3) NULL,
  alterado_por             BIGINT UNSIGNED NULL,
  versao                   INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_exame_item_assinatura_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_exame_item_assinatura (exame_item_id, documento_prontuario_id),
  KEY ix_exame_item_assinatura_documento_prontuario (documento_prontuario_id),
  KEY ix_exame_item_assinatura_local_assistencia (local_assistencia_id)
) COMMENT='Exames cobertos por cada assinatura de documento do prontuário (exames assinados em conjunto)';
