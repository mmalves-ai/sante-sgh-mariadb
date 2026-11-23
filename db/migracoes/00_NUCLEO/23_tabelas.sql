-- SBIS-16 (pedidos dos lotes f22 02-06 e 05-05): a trilha de auditoria passa a ser encadeada por hash, por
-- estabelecimento. Só para frente e idempotente (ADR 0002). Nenhum gatilho: o núcleo (packages/nucleo/src/trilha.ts)
-- calcula o SHA-256 da linha na mesma transação dela, depois de travar a cabeça da cadeia (trilha_cadeia,
-- SELECT ... FOR UPDATE), o que dá ordem total sem bifurcação entre transações concorrentes. O fecho diário fica em
-- trilha_auditoria_fecho (02_ADM), gravado pelo núcleo na virada do dia da cadeia ou pela operação de fecho.
-- Linhas anteriores a esta migração ficam sem encadeamento (as quatro colunas nulas).

ALTER TABLE trilha_auditoria
  ADD COLUMN IF NOT EXISTS estabelecimento_chave BIGINT UNSIGNED AS (IFNULL(estabelecimento_id, 0)) PERSISTENT COMMENT 'Escopo da cadeia: 0 para eventos sem estabelecimento',
  ADD COLUMN IF NOT EXISTS cadeia_dia DATE NULL COMMENT 'Dia (UTC, relógio do banco) da cadeia em que a linha entrou; nulo: linha anterior ao encadeamento',
  ADD COLUMN IF NOT EXISTS hash_anterior CHAR(64) NULL COMMENT 'Hash da linha anterior da cadeia do estabelecimento (SHA-256; zeros no primeiro elo)',
  ADD COLUMN IF NOT EXISTS hash_linha CHAR(64) NULL COMMENT 'SHA-256 do conteúdo canônico desta linha mais o hash anterior',
  ADD CONSTRAINT IF NOT EXISTS ck_trilha_auditoria_cadeia CHECK (
    (cadeia_dia IS NULL AND hash_anterior IS NULL AND hash_linha IS NULL)
    OR (cadeia_dia IS NOT NULL AND hash_anterior REGEXP '^[0-9a-f]{64}$' AND hash_linha REGEXP '^[0-9a-f]{64}$')),
  ADD UNIQUE KEY IF NOT EXISTS uq_trilha_auditoria_elo (estabelecimento_chave, hash_anterior),
  ADD KEY IF NOT EXISTS ix_trilha_auditoria_cadeia (estabelecimento_chave, cadeia_dia, id);

CREATE TABLE IF NOT EXISTS trilha_cadeia (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NULL COMMENT 'Nulo: cadeia dos eventos sem estabelecimento',
  estabelecimento_chave BIGINT UNSIGNED AS (IFNULL(estabelecimento_id, 0)) PERSISTENT COMMENT 'Só para a unicidade da cadeia',
  ultimo_trilha_auditoria_id BIGINT UNSIGNED NULL COMMENT 'Último elo da cadeia',
  ultimo_hash       CHAR(64) NOT NULL COMMENT 'Hash do último elo (zeros na cadeia vazia)',
  dia_aberto        DATE NULL COMMENT 'Dia da cadeia ainda sem fecho',
  primeiro_trilha_auditoria_id_dia BIGINT UNSIGNED NULL COMMENT 'Primeiro elo do dia aberto',
  hash_inicio_dia   CHAR(64) NULL COMMENT 'Hash anterior ao primeiro elo do dia aberto',
  quantidade_dia    INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Elos gravados no dia aberto',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_trilha_cadeia_hash CHECK (ultimo_hash REGEXP '^[0-9a-f]{64}$' AND (hash_inicio_dia IS NULL OR hash_inicio_dia REGEXP '^[0-9a-f]{64}$')),
  CONSTRAINT ck_trilha_cadeia_dia CHECK (quantidade_dia = 0 OR (dia_aberto IS NOT NULL AND primeiro_trilha_auditoria_id_dia IS NOT NULL AND hash_inicio_dia IS NOT NULL AND ultimo_trilha_auditoria_id IS NOT NULL)),
  UNIQUE KEY uq_trilha_cadeia_estabelecimento (estabelecimento_chave),
  KEY ix_trilha_cadeia_estabelecimento (estabelecimento_id),
  KEY ix_trilha_cadeia_ultimo (ultimo_trilha_auditoria_id),
  KEY ix_trilha_cadeia_primeiro_dia (primeiro_trilha_auditoria_id_dia)
) COMMENT='Cabeça da cadeia de hash da trilha de auditoria por estabelecimento: último elo e dia aberto (trava da ordem)';
