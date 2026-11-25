-- Reserva de hemocomponente da cirurgia ligada à requisição transfusional (04-CC linha 103, F8, 25/11/2026).
-- Só para frente e idempotente (ADR 0002, parte 2). Sem gatilho: as regras do vínculo (mesmo paciente, mesmo tipo de
-- hemocomponente, requisição e item vivos, requisição sem outra cirurgia) são do domínio (@sgh/dominio-cirurgia,
-- reserva-cirurgia.ts) e da porta própria (cirurgia/reserva-cirurgia-propria.ts).
--   - reserva_hemocomponente_cirurgia.requisicao_transfusao_item_id: o item da requisição transfusional que atende a
--     reserva; a agência transfusional enxerga a cirurgia pela requisição, e a reserva lê as bolsas atendidas dela.

ALTER TABLE reserva_hemocomponente_cirurgia
  ADD COLUMN IF NOT EXISTS requisicao_transfusao_item_id BIGINT UNSIGNED NULL COMMENT 'Item da requisição transfusional que atende a reserva' AFTER hemocomponente_id;
ALTER TABLE reserva_hemocomponente_cirurgia
  ADD KEY IF NOT EXISTS ix_reserva_hemocomponente_cirurgia_requisicao_item (requisicao_transfusao_item_id);
