-- Qualidade, revisão de prontuários (família qualidade-q3): chaves estrangeiras (idempotentes) do
-- 99_revisao_checklist_tabelas.

ALTER TABLE modelo_checklist_qualidade ADD CONSTRAINT fk_modelo_checklist_qualidade_comissao_hospitalar_id FOREIGN KEY IF NOT EXISTS (comissao_hospitalar_id) REFERENCES comissao_hospitalar (id) ON DELETE RESTRICT;
ALTER TABLE modelo_checklist_qualidade_versao ADD CONSTRAINT fk_modelo_checklist_qualidade_versao_inativado_por_usuario_id FOREIGN KEY IF NOT EXISTS (inativado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
