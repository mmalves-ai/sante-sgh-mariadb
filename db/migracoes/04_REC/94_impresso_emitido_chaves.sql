-- Chaves da emissão dos impressos do atendimento (F3.2, 02-REC linha 35). Idempotente.
ALTER TABLE atendimento_impresso_emitido
  ADD CONSTRAINT fk_atendimento_impresso_emitido_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_impresso_emitido_atendimento_id FOREIGN KEY IF NOT EXISTS (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_impresso_emitido_modelo_ficha_impressa_id FOREIGN KEY IF NOT EXISTS (modelo_ficha_impressa_id) REFERENCES modelo_ficha_impressa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_atendimento_impresso_emitido_criado_por FOREIGN KEY IF NOT EXISTS (criado_por) REFERENCES usuario (id) ON DELETE RESTRICT;
