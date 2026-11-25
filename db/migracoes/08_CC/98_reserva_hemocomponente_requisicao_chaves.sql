-- Chaves da reserva de hemocomponente ligada à requisição transfusional (04-CC linha 103, F8, 25/11/2026): só para
-- frente e idempotente.

ALTER TABLE reserva_hemocomponente_cirurgia
  ADD CONSTRAINT fk_reserva_hemocomponente_cirurgia_requisicao_item FOREIGN KEY IF NOT EXISTS (requisicao_transfusao_item_id) REFERENCES requisicao_transfusao_item (id) ON DELETE RESTRICT;
