-- Centro cirúrgico, mutirão cirúrgico: chaves estrangeiras (idempotentes) do 93_mutirao_vinculo_tabelas.

ALTER TABLE vinculo_mutirao_cirurgico
  ADD CONSTRAINT fk_vinculo_mutirao_cirurgico_projeto FOREIGN KEY IF NOT EXISTS (projeto_mutirao_cirurgico_id) REFERENCES projeto_mutirao_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_mutirao_cirurgico_conta_aih FOREIGN KEY IF NOT EXISTS (conta_aih_id) REFERENCES conta_aih (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_mutirao_cirurgico_apac FOREIGN KEY IF NOT EXISTS (apac_id) REFERENCES apac (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_mutirao_cirurgico_justificativa FOREIGN KEY IF NOT EXISTS (justificativa_mutirao_cirurgico_id) REFERENCES justificativa_mutirao_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_mutirao_cirurgico_retirada_justificativa FOREIGN KEY IF NOT EXISTS (retirada_justificativa_id) REFERENCES justificativa_mutirao_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_vinculo_mutirao_cirurgico_retirado_por FOREIGN KEY IF NOT EXISTS (retirado_por) REFERENCES usuario (id) ON DELETE RESTRICT;
