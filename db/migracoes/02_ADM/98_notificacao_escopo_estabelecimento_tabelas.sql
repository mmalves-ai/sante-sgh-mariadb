-- Notificação por regra no banco próprio (01-ADM L76, correção): escopo por estabelecimento e ligação aviso-envio
-- indexável. Só para frente e idempotente (ADR 0002, parte 2).
--
-- 1. regra_alerta_estabelecimento: a regra global (sem estabelecimento) é ativada ou desativada por estabelecimento
--    num registro próprio; a situação geral da regra só muda pela administração da plataforma.
-- 2. regra_alerta_destinatario.estabelecimento_id: o destinatário escolhido por um estabelecimento vale só nele
--    (nulo = escolhido pela plataforma, vale para todos). A unicidade passa a incluir o escopo.
-- 3. envio_notificacao_aviso: um item por aviso reunido no envio, com o canal, único por canal e aviso (o "não
--    reenviar" vira busca por índice em vez de varrer o JSON de todos os envios). Carga dos envios já gravados.

CREATE TABLE IF NOT EXISTS regra_alerta_estabelecimento (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  regra_alerta_id    BIGINT UNSIGNED NOT NULL,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  ativo              BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'A regra global vale neste estabelecimento',
  criado_em          DATETIME(3) NOT NULL,
  criado_por         BIGINT UNSIGNED NULL,
  alterado_em        DATETIME(3) NULL,
  alterado_por       BIGINT UNSIGNED NULL,
  versao             INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_regra_alerta_estabelecimento (regra_alerta_id, estabelecimento_id),
  KEY ix_regra_alerta_estabelecimento_estabelecimento_id (estabelecimento_id)
) COMMENT='Situação da regra de alerta global em cada estabelecimento (ativa ou desativada só nele)';

ALTER TABLE regra_alerta_destinatario
  ADD COLUMN IF NOT EXISTS estabelecimento_id BIGINT UNSIGNED NULL COMMENT 'Estabelecimento que escolheu o destinatário (nulo = todos)' AFTER regra_alerta_id,
  ADD COLUMN IF NOT EXISTS escopo_estabelecimento BIGINT UNSIGNED AS (COALESCE(estabelecimento_id, 0)) PERSISTENT COMMENT 'Escopo para a unicidade (0 = todos)' AFTER estabelecimento_id,
  ADD KEY IF NOT EXISTS ix_regra_alerta_destinatario_estabelecimento_id (estabelecimento_id);
ALTER TABLE regra_alerta_destinatario
  ADD UNIQUE KEY IF NOT EXISTS uq_regra_alerta_destinatario_escopo_destino (regra_alerta_id, escopo_estabelecimento, tipo_destinatario, destino_id);
ALTER TABLE regra_alerta_destinatario
  DROP INDEX IF EXISTS uq_regra_alerta_destinatario_regra_destino;

CREATE TABLE IF NOT EXISTS envio_notificacao_aviso (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  envio_notificacao_id   BIGINT UNSIGNED NOT NULL,
  notificacao_usuario_id BIGINT UNSIGNED NOT NULL,
  canal_notificacao_id   BIGINT UNSIGNED NOT NULL COMMENT 'Canal do envio (repetido para a unicidade por canal)',
  criado_em              DATETIME(3) NOT NULL,
  criado_por             BIGINT UNSIGNED NULL,
  alterado_em            DATETIME(3) NULL,
  alterado_por           BIGINT UNSIGNED NULL,
  versao                 INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_envio_notificacao_aviso_canal_aviso (canal_notificacao_id, notificacao_usuario_id),
  KEY ix_envio_notificacao_aviso_envio (envio_notificacao_id),
  KEY ix_envio_notificacao_aviso_aviso (notificacao_usuario_id)
) COMMENT='Cada aviso reunido num envio de notificação, único por canal (o aviso não sai duas vezes pelo mesmo canal)';
-- Colunas de auditoria (convenção do DDL, ADR 0002 parte 2), também para o banco que já tinha a tabela.
ALTER TABLE envio_notificacao_aviso
  ADD COLUMN IF NOT EXISTS alterado_em DATETIME(3) NULL AFTER criado_por,
  ADD COLUMN IF NOT EXISTS alterado_por BIGINT UNSIGNED NULL AFTER alterado_em;

INSERT IGNORE INTO envio_notificacao_aviso (envio_notificacao_id, notificacao_usuario_id, canal_notificacao_id, criado_em)
SELECT en.id, j.aviso, en.canal_notificacao_id, en.criado_em
  FROM envio_notificacao en
  JOIN JSON_TABLE(en.avisos_consolidados, '$[*]' COLUMNS (aviso BIGINT UNSIGNED PATH '$')) j
  JOIN notificacao_usuario n ON n.id = j.aviso
 WHERE en.avisos_consolidados IS NOT NULL;

ALTER TABLE envio_notificacao
  ADD KEY IF NOT EXISTS ix_envio_notificacao_limite (estabelecimento_id, canal_notificacao_id, regra_consolidacao_notificacao_id, ocorrido_em);
