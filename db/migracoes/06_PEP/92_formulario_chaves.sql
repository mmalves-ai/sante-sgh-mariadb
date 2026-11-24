-- PEP, porta própria do construtor de formulários novos: chaves estrangeiras (idempotentes) do 92_formulario_tabelas.

ALTER TABLE modelo_documento_versao ADD CONSTRAINT fk_modelo_documento_versao_origem_versao_id FOREIGN KEY IF NOT EXISTS (origem_modelo_documento_versao_id) REFERENCES modelo_documento_versao (id) ON DELETE RESTRICT;
ALTER TABLE modelo_documento_versao ADD CONSTRAINT fk_modelo_documento_versao_aprovacao_usuario_id FOREIGN KEY IF NOT EXISTS (aprovacao_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE modelo_documento_versao ADD CONSTRAINT fk_modelo_documento_versao_aposentadoria_usuario_id FOREIGN KEY IF NOT EXISTS (aposentadoria_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE modelo_documento_evento ADD CONSTRAINT fk_modelo_documento_evento_versao_id FOREIGN KEY IF NOT EXISTS (modelo_documento_versao_id) REFERENCES modelo_documento_versao (id) ON DELETE RESTRICT;
ALTER TABLE modelo_documento_evento ADD CONSTRAINT fk_modelo_documento_evento_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE modelo_documento_caso_teste ADD CONSTRAINT fk_modelo_documento_caso_teste_versao_id FOREIGN KEY IF NOT EXISTS (modelo_documento_versao_id) REFERENCES modelo_documento_versao (id) ON DELETE RESTRICT;
