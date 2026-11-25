-- PEP, documento exigido: chave do estabelecimento de origem da regra (C2-028), do 99_obrigatoriedade_origem_tabelas.
-- Só para frente e idempotente.
ALTER TABLE regra_obrigatoriedade_documento ADD CONSTRAINT fk_regra_obrigatoriedade_documento_estabelecimento_origem_id FOREIGN KEY IF NOT EXISTS (estabelecimento_origem_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
