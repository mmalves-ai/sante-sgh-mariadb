-- SAME pelo volume (F3.9-4, 04-HOT L126): a chave do volume alvo da ocorrência do arquivo. Idempotente.
ALTER TABLE ocorrencia_arquivo_prontuario ADD CONSTRAINT fk_ocorrencia_arquivo_prontuario_volume FOREIGN KEY IF NOT EXISTS (volume_prontuario_id) REFERENCES volume_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE ocorrencia_arquivo_prontuario ADD CONSTRAINT fk_ocorrencia_arquivo_prontuario_deliberacao FOREIGN KEY IF NOT EXISTS (deliberacao_reuniao_id) REFERENCES deliberacao_reuniao (id) ON DELETE RESTRICT;
