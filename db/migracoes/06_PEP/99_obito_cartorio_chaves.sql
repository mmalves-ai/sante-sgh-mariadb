-- PEP, declaração de óbito: chave estrangeira (idempotente) do 99_obito_cartorio_tabelas (C1-112).

ALTER TABLE declaracao_obito ADD CONSTRAINT fk_declaracao_obito_cartorio_registro_civil_id FOREIGN KEY IF NOT EXISTS (cartorio_registro_civil_id) REFERENCES cartorio_registro_civil (id) ON DELETE RESTRICT;
