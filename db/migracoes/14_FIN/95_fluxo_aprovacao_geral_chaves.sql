-- Financeiro, chaves do fluxo de aprovação configurável (07-FIN linha 65): só para frente e idempotente.
ALTER TABLE membro_agrupador_aprovacao ADD CONSTRAINT fk_membro_agrupador_aprovacao_agrupador_aprovacao_id FOREIGN KEY IF NOT EXISTS (agrupador_aprovacao_id) REFERENCES agrupador_aprovacao (id) ON DELETE RESTRICT;
ALTER TABLE pedido_aprovacao ADD CONSTRAINT fk_pedido_aprovacao_fluxo_aprovacao_id FOREIGN KEY IF NOT EXISTS (fluxo_aprovacao_id) REFERENCES fluxo_aprovacao (id) ON DELETE RESTRICT;
ALTER TABLE pedido_aprovacao ADD CONSTRAINT fk_pedido_aprovacao_etapa_fluxo_aprovacao_id FOREIGN KEY IF NOT EXISTS (etapa_fluxo_aprovacao_id) REFERENCES etapa_fluxo_aprovacao (id) ON DELETE RESTRICT;
ALTER TABLE decisao_aprovacao ADD CONSTRAINT fk_decisao_aprovacao_etapa_fluxo_aprovacao_id FOREIGN KEY IF NOT EXISTS (etapa_fluxo_aprovacao_id) REFERENCES etapa_fluxo_aprovacao (id) ON DELETE RESTRICT;
ALTER TABLE decisao_aprovacao ADD CONSTRAINT fk_decisao_aprovacao_resposta_padrao_aprovacao_id FOREIGN KEY IF NOT EXISTS (resposta_padrao_aprovacao_id) REFERENCES resposta_padrao_aprovacao (id) ON DELETE RESTRICT;
