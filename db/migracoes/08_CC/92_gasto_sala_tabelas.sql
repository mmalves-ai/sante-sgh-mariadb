-- Centro cirúrgico, gasto de sala do ato (F3.4, fatia F3.4-5, 24/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2). Sem gatilho; as regras ficam no domínio (@sgh/dominio-cirurgia, gasto-sala) e na operação.
--   - consumo_cirurgia_motivo (nova): os motivos registrados no gasto de sala, nunca apagados: a justificativa do item
--     obrigatório da lista padrão que não foi usado, a reabertura da conferência e o cancelamento do gasto.

CREATE TABLE IF NOT EXISTS consumo_cirurgia_motivo (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  consumo_cirurgia_id BIGINT UNSIGNED NOT NULL,
  tipo                VARCHAR(30) NOT NULL,
  insumo_id           BIGINT UNSIGNED NULL COMMENT 'Produto obrigatório não usado (só no tipo item_nao_usado)',
  motivo              VARCHAR(500) NOT NULL,
  registrado_em       DATETIME(3) NOT NULL,
  usuario_id          BIGINT UNSIGNED NOT NULL COMMENT 'Conta de quem registrou o motivo',
  origem              VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em           DATETIME(3) NOT NULL,
  criado_por          BIGINT UNSIGNED NULL,
  alterado_em         DATETIME(3) NULL,
  alterado_por        BIGINT UNSIGNED NULL,
  versao              INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_consumo_cirurgia_motivo_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_consumo_cirurgia_motivo_tipo CHECK (tipo IN ('item_nao_usado','reabertura','cancelamento')),
  CONSTRAINT ck_consumo_cirurgia_motivo_insumo CHECK ((tipo = 'item_nao_usado') = (insumo_id IS NOT NULL)),
  CONSTRAINT ck_consumo_cirurgia_motivo_motivo CHECK (CHAR_LENGTH(TRIM(motivo)) >= 5),
  KEY ix_consumo_cirurgia_motivo_consumo (consumo_cirurgia_id, tipo),
  KEY ix_consumo_cirurgia_motivo_insumo_id (insumo_id),
  KEY ix_consumo_cirurgia_motivo_usuario_id (usuario_id)
) COMMENT='Motivo registrado no gasto de sala: item obrigatório não usado, reabertura ou cancelamento (nunca apagado)';
