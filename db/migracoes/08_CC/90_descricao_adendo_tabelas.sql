-- Centro cirúrgico, descrição cirúrgica assinada (F3.4, fatia F3.4-4, 24/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho; as regras ficam no domínio (@sgh/dominio-cirurgia, descricao) e na operação.
--   - descricao_cirurgica_adendo (nova): o adendo do cirurgião à descrição já assinada. A descrição assinada não muda
--     (documento do prontuário); a correção ou o complemento entra aqui, com o motivo, a conta e o horário, e a
--     descrição passa a "retificada". Nunca apagado.

CREATE TABLE IF NOT EXISTS descricao_cirurgica_adendo (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  descricao_cirurgica_id BIGINT UNSIGNED NOT NULL,
  sequencia              SMALLINT UNSIGNED NOT NULL,
  texto                  TEXT NOT NULL,
  motivo                 VARCHAR(500) NOT NULL,
  registrado_em          DATETIME(3) NOT NULL,
  usuario_id             BIGINT UNSIGNED NOT NULL COMMENT 'Conta do cirurgião que registrou o adendo',
  origem                 VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em              DATETIME(3) NOT NULL,
  criado_por             BIGINT UNSIGNED NULL,
  alterado_em            DATETIME(3) NULL,
  alterado_por           BIGINT UNSIGNED NULL,
  versao                 INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_descricao_cirurgica_adendo_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_descricao_cirurgica_adendo_texto CHECK (CHAR_LENGTH(TRIM(texto)) >= 5),
  CONSTRAINT ck_descricao_cirurgica_adendo_motivo CHECK (CHAR_LENGTH(TRIM(motivo)) >= 5),
  UNIQUE KEY uq_descricao_cirurgica_adendo_sequencia (descricao_cirurgica_id, sequencia),
  KEY ix_descricao_cirurgica_adendo_usuario_id (usuario_id)
) COMMENT='Adendo do cirurgião à descrição cirúrgica assinada (a descrição assinada não muda)';
