-- F2.4 (dívida da migração), 3ª etapa, 4ª leva: DDL pedido pelos lotes das portas (p-*), só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v4.md

-- Histórico da refeição do acompanhante (antes, depois e motivo), como o do preparo do lactário.
CREATE TABLE IF NOT EXISTS plano_refeicao_acompanhante_evento (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  plano_refeicao_acompanhante_id BIGINT UNSIGNED NOT NULL,
  evento VARCHAR(20) NOT NULL COMMENT 'alterado ou cancelado',
  dados_antes LONGTEXT NULL COMMENT 'Plano antes do evento (JSON)',
  dados_depois LONGTEXT NULL COMMENT 'Plano depois do evento (JSON)',
  motivo VARCHAR(500) NOT NULL,
  ocorrido_em DATETIME(3) NOT NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_plano_refeicao_acompanhante_evento_evento CHECK (evento IN ('alterado','cancelado')),
  CONSTRAINT ck_plano_refeicao_acompanhante_evento_dados CHECK ((dados_antes IS NULL OR json_valid(dados_antes)) AND (dados_depois IS NULL OR json_valid(dados_depois))),
  KEY ix_plano_refeicao_acompanhante_evento_plano (plano_refeicao_acompanhante_id, ocorrido_em),
  KEY ix_plano_refeicao_acompanhante_evento_usuario (usuario_id)
) COMMENT='Histórico de alterações e cancelamentos do plano de refeição do acompanhante';
