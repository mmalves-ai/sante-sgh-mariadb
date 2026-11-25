-- Remuneração variável por faixa (06-FAT linha 48, F8, 25/11/2026): só para frente e idempotente (ADR 0002, parte 2).
-- A chave estrangeira do evento de desconto da regra.

ALTER TABLE regra_repasse_variavel
  ADD CONSTRAINT fk_regra_repasse_variavel_evento_desconto_repasse_id FOREIGN KEY IF NOT EXISTS (evento_desconto_repasse_id) REFERENCES evento_repasse (id) ON DELETE RESTRICT;
