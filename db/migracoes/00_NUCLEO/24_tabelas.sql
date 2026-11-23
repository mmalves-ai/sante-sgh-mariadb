-- SBIS-16 (conferência final): marco do encadeamento da trilha. Guarda o maior id de trilha_auditoria sem cadeia no
-- momento em que esta migração roda; dali em diante toda linha entra encadeada pelo núcleo (gravarTrilha), e a prova
-- (verificarDiaTrilha) aponta como quebra qualquer linha do escopo sem cadeia acima do marco, para que um evento
-- incluído por fora da cadeia não passe despercebido. Só para frente e idempotente (ADR 0002): a linha única é gravada
-- uma vez só e nunca alterada (nenhum papel tem UPDATE nela). Nenhum gatilho.

CREATE TABLE IF NOT EXISTS trilha_encadeamento_inicio (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  unica            TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Sempre 1: garante a linha única',
  marco_sem_cadeia BIGINT UNSIGNED NOT NULL COMMENT 'Maior id de trilha_auditoria sem cadeia quando o encadeamento começou (0: nenhuma)',
  criado_em        DATETIME(3) NOT NULL,
  criado_por       BIGINT UNSIGNED NULL,
  alterado_em      DATETIME(3) NULL,
  alterado_por     BIGINT UNSIGNED NULL,
  versao           INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_trilha_encadeamento_inicio_unica CHECK (unica = 1),
  UNIQUE KEY uq_trilha_encadeamento_inicio_unica (unica)
) COMMENT='Marco do início do encadeamento por hash da trilha de auditoria (linha única)';

INSERT INTO trilha_encadeamento_inicio (unica, marco_sem_cadeia, criado_em, versao)
SELECT 1, IFNULL(MAX(id), 0), UTC_TIMESTAMP(3), 1 FROM trilha_auditoria WHERE cadeia_dia IS NULL
HAVING NOT EXISTS (SELECT 1 FROM trilha_encadeamento_inicio);
