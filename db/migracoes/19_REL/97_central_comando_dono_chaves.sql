-- Chaves da 97_central_comando_dono (só para frente e idempotente).
ALTER TABLE alerta_fluxo_unidade ADD CONSTRAINT fk_alerta_fluxo_unidade_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
