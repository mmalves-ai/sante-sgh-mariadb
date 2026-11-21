-- REL, lote 4 (F4 conector, rodada 4: pedidos de modelo das fatias, registrados para a trilha F2.2 em
-- docs/obra/passagens/F4-pedidos-f22.md). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (04_chaves.sql).

-- L8-18 (6, 11)
ALTER TABLE relatorio_parametro
  ADD COLUMN visivel BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'Falso: parâmetro oculto na tela';
ALTER TABLE relatorio_parametro_pesquisa
  ADD COLUMN especificacao TEXT NULL COMMENT 'Texto da busca do sistema anterior, nunca executado';
ALTER TABLE relatorio_tela
  MODIFY COLUMN relatorio_id BIGINT UNSIGNED NULL DEFAULT NULL,
  ADD COLUMN agrupamento_relatorio_id BIGINT UNSIGNED NULL COMMENT 'Botão que imprime um agrupamento de relatórios' AFTER relatorio_id,
  ADD KEY ix_relatorio_tela_agrupamento_relatorio_id (agrupamento_relatorio_id),
  ADD CONSTRAINT ck_relatorio_tela_alvo CHECK ((relatorio_id IS NULL) <> (agrupamento_relatorio_id IS NULL));
