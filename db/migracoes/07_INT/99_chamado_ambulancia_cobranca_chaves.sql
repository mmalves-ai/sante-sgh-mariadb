-- Internação, chaves do chamado de ambulância com cobrança e do maqueiro (04-INT linha 83): só para frente e idempotente.
ALTER TABLE chamado_ambulancia ADD CONSTRAINT fk_chamado_ambulancia_conta_hospitalar_item_id FOREIGN KEY IF NOT EXISTS (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT;
ALTER TABLE solicitacao_transporte_paciente ADD CONSTRAINT fk_solicitacao_transporte_paciente_maqueiro_profissional_id FOREIGN KEY IF NOT EXISTS (maqueiro_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
