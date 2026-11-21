-- F2.4 (dívida da migração), 2ª volta: DDL pedido pelos lotes, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v2.md

ALTER TABLE ocorrencia_arquivo_prontuario ADD CONSTRAINT fk_ocorrencia_arquivo_prontuario_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE ocorrencia_arquivo_prontuario ADD CONSTRAINT fk_ocorrencia_arquivo_prontuario_atendimento_id FOREIGN KEY IF NOT EXISTS (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE ocorrencia_arquivo_prontuario ADD CONSTRAINT fk_ocorrencia_arquivo_prontuario_movimento_prontuario_id FOREIGN KEY IF NOT EXISTS (movimento_prontuario_id) REFERENCES movimento_prontuario (id) ON DELETE RESTRICT;
ALTER TABLE ocorrencia_arquivo_prontuario ADD CONSTRAINT fk_ocorrencia_arquivo_prontuario_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
