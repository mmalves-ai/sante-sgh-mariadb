-- F2.4 (dívida da migração), 3ª etapa, 4ª leva: DDL pedido pelos lotes das portas (p-*), só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v4.md

ALTER TABLE carga_tabela_preco ADD CONSTRAINT fk_carga_tabela_preco_lote_reajuste FOREIGN KEY IF NOT EXISTS (lote_reajuste_id) REFERENCES lote_reajuste (id) ON DELETE RESTRICT;
ALTER TABLE orcamento_particular_item ADD CONSTRAINT fk_orcamento_particular_item_exame FOREIGN KEY IF NOT EXISTS (exame_id) REFERENCES exame (id) ON DELETE RESTRICT;
