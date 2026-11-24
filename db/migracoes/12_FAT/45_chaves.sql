-- Controle dos lançamentos automáticos da conta (45_tabelas.sql). FK RESTRICT; a do item e a da conta em cascata nunca:
-- o item estornado continua na conta (situação "estornado"), e o controle o acompanha.
ALTER TABLE lancamento_automatico_conta
  ADD CONSTRAINT fk_lancamento_automatico_conta_conta_hospitalar_id FOREIGN KEY IF NOT EXISTS (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_automatico_conta_conta_hospitalar_item_id FOREIGN KEY IF NOT EXISTS (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_automatico_conta_categoria_acomodacao_id FOREIGN KEY IF NOT EXISTS (categoria_acomodacao_id) REFERENCES categoria_acomodacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_automatico_conta_regra_diaria_id FOREIGN KEY IF NOT EXISTS (regra_diaria_id) REFERENCES regra_diaria (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lancamento_automatico_conta_regra_lancamento_item_id FOREIGN KEY IF NOT EXISTS (regra_lancamento_item_id) REFERENCES regra_lancamento_item (id) ON DELETE RESTRICT;
