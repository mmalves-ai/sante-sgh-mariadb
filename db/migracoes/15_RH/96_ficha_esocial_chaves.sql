-- Chaves da 96_ficha_esocial (só para frente e idempotente).
ALTER TABLE ficha_esocial_vinculo ADD CONSTRAINT fk_ficha_esocial_vinculo_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE ficha_esocial_vinculo ADD CONSTRAINT fk_ficha_esocial_vinculo_vinculo_trabalho_id FOREIGN KEY IF NOT EXISTS (vinculo_trabalho_id) REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT;
