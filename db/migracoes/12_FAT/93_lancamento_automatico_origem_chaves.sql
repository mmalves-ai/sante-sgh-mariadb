-- Lançamento automático com origem na diferença de acomodação e no pacote de diárias (04-INT linha 81, F3.4,
-- 25/11/2026): só para frente e idempotente (ADR 0002, parte 2). As chaves estrangeiras das duas origens novas.

ALTER TABLE lancamento_automatico_conta
  ADD CONSTRAINT fk_lancamento_automatico_conta_diferenca_acomodacao_id FOREIGN KEY IF NOT EXISTS (diferenca_acomodacao_id) REFERENCES diferenca_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_automatico_conta_conta_hospitalar_pacote_id FOREIGN KEY IF NOT EXISTS (conta_hospitalar_pacote_id) REFERENCES conta_hospitalar_pacote (id) ON DELETE RESTRICT;
