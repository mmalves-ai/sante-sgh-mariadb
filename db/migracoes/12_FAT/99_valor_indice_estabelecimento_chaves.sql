-- Valor do índice e do porte do acordo por estabelecimento (06-FAT linha 5, F3.7, 25/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). As chaves estrangeiras do estabelecimento.

ALTER TABLE valor_indice
  ADD CONSTRAINT fk_valor_indice_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;

ALTER TABLE valor_porte_medico
  ADD CONSTRAINT fk_valor_porte_medico_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
