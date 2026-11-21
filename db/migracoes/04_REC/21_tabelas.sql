-- F2.4 (dívida da migração), 2ª volta: DDL pedido pelos lotes, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v2.md

ALTER TABLE dispositivo_recepcao
  ADD COLUMN IF NOT EXISTS painel_tv_id BIGINT UNSIGNED NULL COMMENT 'Painel de TV de setor que este dispositivo exibe',
  DROP CONSTRAINT IF EXISTS ck_dispositivo_recepcao_painel_tv,
  ADD CONSTRAINT ck_dispositivo_recepcao_painel_tv CHECK (painel_tv_id IS NULL OR tipo = 'paineltv'),
  ADD KEY IF NOT EXISTS ix_dispositivo_recepcao_painel_tv (painel_tv_id);
