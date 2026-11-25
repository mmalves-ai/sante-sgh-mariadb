-- Centro cirúrgico, projetos e mutirões cirúrgicos do SUS (F8, 04-CC linha 108, C2-041, 25/11/2026).
-- Só para frente e idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio
-- (@sgh/dominio-cirurgia, mutirao: conferirVinculo, conferirMudancaSituacao, acompanharMetas).
--   - projeto_mutirao_cirurgico.motivo_cancelamento (nova): o motivo exigido ao cancelar o projeto (nada apagado).
--   - vinculo_mutirao_cirurgico (nova): a AIH (conta_aih) ou a APAC (apac) marcada com o projeto, com a justificativa
--     da inclusão e, na retirada, a justificativa da alteração; a linha retirada fica no histórico. Um documento tem no
--     máximo um vínculo vigente (coluna calculada documento_vigente com chave única). A produção do projeto é a soma dos
--     procedimentos SIGTAP dessas contas que estão nas metas; não há faturamento à parte.

ALTER TABLE projeto_mutirao_cirurgico
  ADD COLUMN IF NOT EXISTS motivo_cancelamento VARCHAR(500) NULL COMMENT 'Motivo do cancelamento do projeto' AFTER observacao;

CREATE TABLE IF NOT EXISTS vinculo_mutirao_cirurgico (
  id                                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  projeto_mutirao_cirurgico_id      BIGINT UNSIGNED NOT NULL,
  tipo_documento                    VARCHAR(10) NOT NULL COMMENT 'aih ou apac',
  conta_aih_id                      BIGINT UNSIGNED NULL,
  apac_id                           BIGINT UNSIGNED NULL,
  justificativa_mutirao_cirurgico_id BIGINT UNSIGNED NOT NULL COMMENT 'Justificativa da inclusão',
  complemento                       VARCHAR(500) NULL COMMENT 'Texto livre exigido pela justificativa',
  situacao                          VARCHAR(20) NOT NULL DEFAULT 'vigente',
  retirado_em                       DATETIME(3) NULL,
  retirado_por                      BIGINT UNSIGNED NULL,
  retirada_justificativa_id         BIGINT UNSIGNED NULL COMMENT 'Justificativa da retirada',
  retirada_complemento              VARCHAR(500) NULL,
  documento_vigente                 VARCHAR(30) AS (IF(situacao = 'vigente', CONCAT(tipo_documento, ':', COALESCE(conta_aih_id, apac_id)), NULL)) PERSISTENT COMMENT 'Um vínculo vigente por documento',
  origem                            VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em                         DATETIME(3) NOT NULL,
  criado_por                        BIGINT UNSIGNED NULL,
  alterado_em                       DATETIME(3) NULL,
  alterado_por                      BIGINT UNSIGNED NULL,
  versao                            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_vinculo_mutirao_cirurgico_tipo CHECK (tipo_documento IN ('aih','apac')),
  CONSTRAINT ck_vinculo_mutirao_cirurgico_documento CHECK (
    (tipo_documento = 'aih' AND conta_aih_id IS NOT NULL AND apac_id IS NULL)
    OR (tipo_documento = 'apac' AND apac_id IS NOT NULL AND conta_aih_id IS NULL)),
  CONSTRAINT ck_vinculo_mutirao_cirurgico_situacao CHECK (situacao IN ('vigente','retirado')),
  CONSTRAINT ck_vinculo_mutirao_cirurgico_retirada CHECK (
    (situacao = 'vigente' AND retirado_em IS NULL)
    OR (situacao = 'retirado' AND retirado_em IS NOT NULL AND retirada_justificativa_id IS NOT NULL)),
  CONSTRAINT ck_vinculo_mutirao_cirurgico_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_vinculo_mutirao_cirurgico_documento_vigente (documento_vigente),
  KEY ix_vinculo_mutirao_cirurgico_projeto (projeto_mutirao_cirurgico_id, situacao),
  KEY ix_vinculo_mutirao_cirurgico_conta_aih (conta_aih_id),
  KEY ix_vinculo_mutirao_cirurgico_apac (apac_id),
  KEY ix_vinculo_mutirao_cirurgico_justificativa (justificativa_mutirao_cirurgico_id),
  KEY ix_vinculo_mutirao_cirurgico_retirada_justificativa (retirada_justificativa_id)
) COMMENT='AIH ou APAC marcada com o projeto ou mutirão cirúrgico, com a justificativa e o histórico da retirada';
