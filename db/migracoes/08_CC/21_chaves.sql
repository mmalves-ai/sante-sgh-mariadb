-- F2.4 (dívida da migração), 2ª volta: DDL pedido pelos lotes, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v2.md

ALTER TABLE ato_cirurgico ADD CONSTRAINT fk_ato_cirurgico_classificacao_asa_id FOREIGN KEY IF NOT EXISTS (classificacao_asa_id) REFERENCES classificacao_asa (id) ON DELETE RESTRICT;
ALTER TABLE ato_cirurgico_procedimento ADD CONSTRAINT fk_ato_cirurgico_procedimento_especialidade_medica_id FOREIGN KEY IF NOT EXISTS (especialidade_medica_id) REFERENCES especialidade_medica (id) ON DELETE RESTRICT;
ALTER TABLE ato_cirurgico_dispositivo ADD CONSTRAINT fk_ato_cirurgico_dispositivo_ato_cirurgico_id FOREIGN KEY IF NOT EXISTS (ato_cirurgico_id) REFERENCES ato_cirurgico (id) ON DELETE RESTRICT;
