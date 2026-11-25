-- Aditivo do contrato de plano (08-SGO linha 94, F7, C2-108, 25/11/2026): só para frente e idempotente (ADR 0002, parte 2).
-- A chave estrangeira da tabela de preço do aditivo.

ALTER TABLE aditivo_contrato_plano
  ADD CONSTRAINT fk_aditivo_contrato_plano_tabela_preco_plano_id FOREIGN KEY IF NOT EXISTS (tabela_preco_plano_id) REFERENCES tabela_preco_plano (id) ON DELETE RESTRICT;
