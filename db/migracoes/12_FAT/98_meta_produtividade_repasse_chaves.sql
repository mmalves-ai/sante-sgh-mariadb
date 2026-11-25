-- Produtividade por meta na remuneração variável (07-FIN linha 157, F8, 25/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). As chaves estrangeiras.

ALTER TABLE meta_produtividade_repasse
  ADD CONSTRAINT fk_meta_produtividade_repasse_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_produtividade_repasse_profissional_id FOREIGN KEY IF NOT EXISTS (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_produtividade_repasse_indicador_produtividade_id FOREIGN KEY IF NOT EXISTS (indicador_produtividade_id) REFERENCES indicador_produtividade (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_produtividade_repasse_centro_custo_id FOREIGN KEY IF NOT EXISTS (centro_custo_id) REFERENCES centro_custo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_produtividade_repasse_evento_repasse_id FOREIGN KEY IF NOT EXISTS (evento_repasse_id) REFERENCES evento_repasse (id) ON DELETE RESTRICT;

ALTER TABLE meta_produtividade_repasse_faixa
  ADD CONSTRAINT fk_meta_produtividade_repasse_faixa_meta FOREIGN KEY IF NOT EXISTS (meta_produtividade_repasse_id) REFERENCES meta_produtividade_repasse (id) ON DELETE RESTRICT;

ALTER TABLE apuracao_meta_produtividade
  ADD CONSTRAINT fk_apuracao_meta_produtividade_meta FOREIGN KEY IF NOT EXISTS (meta_produtividade_repasse_id) REFERENCES meta_produtividade_repasse (id) ON DELETE RESTRICT;
