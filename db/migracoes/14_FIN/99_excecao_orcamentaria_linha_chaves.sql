-- Financeiro, chaves da exceção presa à linha e do autorizador do ajuste da nota (07-FIN linha 130, C2-112): só para
-- frente e idempotente.
ALTER TABLE excecao_orcamentaria ADD CONSTRAINT fk_excecao_orcamentaria_linha_orcamento_id FOREIGN KEY IF NOT EXISTS (linha_orcamento_id) REFERENCES linha_orcamento (id) ON DELETE RESTRICT;
ALTER TABLE ajuste_orcamento_nota ADD CONSTRAINT fk_ajuste_orcamento_nota_autorizador_usuario_id FOREIGN KEY IF NOT EXISTS (autorizador_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
