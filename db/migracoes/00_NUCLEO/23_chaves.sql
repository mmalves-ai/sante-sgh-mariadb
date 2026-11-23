-- SBIS-16: chaves da cabeça da cadeia da trilha (só para frente, idempotente).
ALTER TABLE trilha_cadeia ADD CONSTRAINT fk_trilha_cadeia_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE trilha_cadeia ADD CONSTRAINT fk_trilha_cadeia_ultimo_trilha_auditoria_id FOREIGN KEY IF NOT EXISTS (ultimo_trilha_auditoria_id) REFERENCES trilha_auditoria (id) ON DELETE RESTRICT;
ALTER TABLE trilha_cadeia ADD CONSTRAINT fk_trilha_cadeia_primeiro_trilha_auditoria_id_dia FOREIGN KEY IF NOT EXISTS (primeiro_trilha_auditoria_id_dia) REFERENCES trilha_auditoria (id) ON DELETE RESTRICT;
