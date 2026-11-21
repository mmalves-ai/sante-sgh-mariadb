-- FIN, lote 13 (F2.2 ondas finais, onda 4; pedidos do lote 04-01). Convenções do ADR 0002 (parte 2). Só para frente.

-- 04-01: leiaute, conferência e parâmetros do arquivo da escrituração contábil gerado (o conteúdo vai pela tabela arquivo)
ALTER TABLE arquivo_sped_contabil
  ADD COLUMN leiaute VARCHAR(10) NULL COMMENT 'Versão do leiaute oficial escrito' AFTER finalidade,
  ADD COLUMN leiaute_conferido BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'O leiaute escrito foi conferido com a versão oficial' AFTER leiaute,
  ADD COLUMN quantidade_linhas INT UNSIGNED NULL AFTER leiaute_conferido,
  ADD COLUMN parametros JSON NULL COMMENT 'Parâmetros da geração, sem dado de pessoa' AFTER quantidade_linhas,
  ADD CONSTRAINT ck_arquivo_sped_contabil_parametros CHECK (parametros IS NULL OR JSON_VALID(parametros));

-- 04-01: observação do encerramento do período (até aqui só na trilha)
ALTER TABLE periodo_contabil
  ADD COLUMN observacao_encerramento VARCHAR(500) NULL COMMENT 'Observação de quem encerrou o período' AFTER encerrante_usuario_id;
