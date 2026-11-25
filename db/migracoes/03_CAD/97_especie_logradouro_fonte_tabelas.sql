-- Cadastro, espécie de logradouro carregada da tabela oficial (F3.1, 02-CAD linha 14, 24/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho.
-- A lista pública de tipos de logradouro que o carregador versionado lê é a Tabela 20 do leiaute do eSocial (código e
-- descrição). O código da base postal é de catálogo licenciado e só chega com o espelho desse catálogo: deixa de ser
-- obrigatório (continua único quando preenchido). A chave do carregador passa a ser o código da tabela oficial, único,
-- no lugar do índice comum que havia sobre ele.
ALTER TABLE especie_logradouro
  MODIFY COLUMN codigo_dne VARCHAR(5) NULL
    COMMENT 'Código do tipo de logradouro na base nacional de endereçamento postal (catálogo licenciado; nulo até a carga dele)';
ALTER TABLE especie_logradouro
  ADD UNIQUE KEY IF NOT EXISTS uq_especie_logradouro_codigo_esocial (codigo_esocial);
ALTER TABLE especie_logradouro DROP INDEX IF EXISTS ix_especie_logradouro_codigo_esocial;
