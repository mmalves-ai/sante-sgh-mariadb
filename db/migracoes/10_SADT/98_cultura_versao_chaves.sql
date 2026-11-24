-- Chave da versão substituída da cultura (10_SADT/98). Idempotente.
ALTER TABLE resultado_cultura_versao ADD CONSTRAINT fk_resultado_cultura_versao_resultado_cultura_id FOREIGN KEY IF NOT EXISTS (resultado_cultura_id) REFERENCES resultado_cultura (id) ON DELETE RESTRICT;
