-- Financeiro, chaves dos eventos do período financeiro (F3.8, 07-FIN linha 85): só para frente e idempotente.
ALTER TABLE evento_periodo_financeiro ADD CONSTRAINT fk_evento_periodo_financeiro_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE evento_periodo_financeiro ADD CONSTRAINT fk_evento_periodo_financeiro_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
