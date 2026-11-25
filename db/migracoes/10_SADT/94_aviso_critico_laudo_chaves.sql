-- SADT, aviso crítico com origem no laudo (F3.5, 05-SADT linha 16): chave estrangeira do laudo. Idempotente.
ALTER TABLE aviso_valor_critico
  ADD CONSTRAINT fk_aviso_valor_critico_laudo_diagnostico_id FOREIGN KEY IF NOT EXISTS (laudo_diagnostico_id)
    REFERENCES laudo_diagnostico (id) ON DELETE RESTRICT;
