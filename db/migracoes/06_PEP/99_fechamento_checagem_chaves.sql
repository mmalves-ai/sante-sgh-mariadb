-- PEP, fechamento da checagem do turno (03-PEP L113): chaves estrangeiras (idempotentes) do 99_fechamento_checagem_tabelas.

ALTER TABLE fechamento_checagem_horario ADD CONSTRAINT fk_fechamento_checagem_horario_fechamento_id FOREIGN KEY IF NOT EXISTS (fechamento_horario_checagem_id) REFERENCES fechamento_horario_checagem (id) ON DELETE RESTRICT;
ALTER TABLE fechamento_checagem_horario ADD CONSTRAINT fk_fechamento_checagem_horario_horario_id FOREIGN KEY IF NOT EXISTS (horario_administracao_id) REFERENCES horario_administracao (id) ON DELETE RESTRICT;
ALTER TABLE fechamento_checagem_horario ADD CONSTRAINT fk_fechamento_checagem_horario_situacao_id FOREIGN KEY IF NOT EXISTS (situacao_checagem_id) REFERENCES situacao_checagem (id) ON DELETE RESTRICT;
