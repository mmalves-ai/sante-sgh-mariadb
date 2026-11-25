-- Suprimentos, chave do doador pessoa da doação recebida (C1-126, 09-AREA linha 79): só para frente e idempotente, do
-- 96_entrada_doacao_tabelas.
ALTER TABLE nota_entrada ADD CONSTRAINT fk_nota_entrada_doador_pessoa_fisica FOREIGN KEY IF NOT EXISTS (doador_pessoa_fisica_id) REFERENCES pessoa_fisica (id) ON DELETE RESTRICT;
