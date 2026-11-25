-- Chaves estrangeiras das ocorrências da apuração da receita contábil (06-FAT linha 37, F3.7, 25/11/2026). Só para
-- frente e idempotente (ADR 0002, parte 2).

ALTER TABLE ocorrencia_contabil_receita
  ADD CONSTRAINT fk_ocorrencia_contabil_receita_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_contabil_receita_conta_hospitalar_id FOREIGN KEY IF NOT EXISTS (conta_hospitalar_id) REFERENCES conta_hospitalar (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_contabil_receita_conta_hospitalar_item_id FOREIGN KEY IF NOT EXISTS (conta_hospitalar_item_id) REFERENCES conta_hospitalar_item (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ocorrencia_contabil_receita_lancamento_id FOREIGN KEY IF NOT EXISTS (lancamento_contabil_receita_id) REFERENCES lancamento_contabil_receita (id) ON DELETE RESTRICT;
