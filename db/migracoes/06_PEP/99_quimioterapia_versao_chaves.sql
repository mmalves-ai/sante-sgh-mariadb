-- PEP, oncologia (C2-090): a versão do protocolo do ciclo. Só para frente e idempotente.
ALTER TABLE ciclo_quimioterapia ADD CONSTRAINT fk_ciclo_quimioterapia_protocolo_quimioterapia_id FOREIGN KEY IF NOT EXISTS (protocolo_quimioterapia_id) REFERENCES protocolo_quimioterapia (id) ON DELETE RESTRICT;
