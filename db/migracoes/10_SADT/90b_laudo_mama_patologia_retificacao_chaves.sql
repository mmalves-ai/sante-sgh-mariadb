-- SADT, retificação dos laudos estruturados de mamografia e de anatomia patológica (C2-071): chaves estrangeiras de
-- 90b_laudo_mama_patologia_retificacao_tabelas.
ALTER TABLE laudo_mama
  ADD CONSTRAINT fk_laudo_mama_laudo_retificado_id FOREIGN KEY IF NOT EXISTS (laudo_retificado_id) REFERENCES laudo_mama (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_mama_retificado_por_usuario_id FOREIGN KEY IF NOT EXISTS (retificado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE laudo_anatomopatologico
  ADD CONSTRAINT fk_laudo_anatomopatologico_laudo_retificado_id FOREIGN KEY IF NOT EXISTS (laudo_retificado_id) REFERENCES laudo_anatomopatologico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_laudo_anatomopatologico_retificado_por_usuario_id FOREIGN KEY IF NOT EXISTS (retificado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
