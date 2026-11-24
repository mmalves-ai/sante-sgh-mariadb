-- Financeiro, chaves do uso do saldo do adiantamento como evento (06-FAT linha 39): só para frente e idempotente.
ALTER TABLE aplicacao_adiantamento_paciente ADD CONSTRAINT fk_aplicacao_adiantamento_paciente_estornador_usuario_id FOREIGN KEY IF NOT EXISTS (estornador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
