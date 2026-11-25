-- Financeiro, chaves da apropriação ao projeto com natureza, etapa e título a receber (07-FIN linha 128, C2-107): só para
-- frente e idempotente.
ALTER TABLE apropriacao_projeto ADD CONSTRAINT fk_apropriacao_projeto_titulo_receber_id FOREIGN KEY IF NOT EXISTS (titulo_receber_id) REFERENCES titulo_receber (id) ON DELETE RESTRICT;
ALTER TABLE apropriacao_projeto ADD CONSTRAINT fk_apropriacao_projeto_etapa_projeto_id FOREIGN KEY IF NOT EXISTS (etapa_projeto_id) REFERENCES etapa_projeto (id) ON DELETE RESTRICT;
