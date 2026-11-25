-- Chaves da 93_catraca_colaborador (só para frente e idempotente).
ALTER TABLE regra_acesso_dispositivo ADD CONSTRAINT fk_regra_acesso_dispositivo_terminal_acesso_id FOREIGN KEY IF NOT EXISTS (terminal_acesso_id) REFERENCES terminal_acesso (id) ON DELETE RESTRICT;
