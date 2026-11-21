-- ADM, lote 9 (F4 conector, rodada 4: pedidos de modelo das fatias, registrados para a trilha F2.2 em
-- docs/obra/passagens/F4-pedidos-f22.md). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (09_chaves.sql).

-- L5-01 (1): permissão de excluir por escopo, separada de operar
ALTER TABLE usuario_escopo
  ADD COLUMN pode_excluir BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Pode excluir registros no escopo' AFTER pode_operar;
ALTER TABLE usuario_escopo DROP CONSTRAINT ck_usuario_escopo_permissao;
ALTER TABLE usuario_escopo ADD CONSTRAINT ck_usuario_escopo_permissao CHECK (pode_consultar OR pode_operar OR pode_excluir);

-- L5-01 (8, 14): periodicidade do aceite em quantidade e unidade (a coluna em dias fica para a API até a F2.2 migrar), reutilização e alfanumérico
ALTER TABLE politica_senha
  ADD COLUMN exige_alfanumerico BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Exige letras e números na senha' AFTER exige_especial,
  ADD COLUMN periodicidade_aceite_quantidade SMALLINT UNSIGNED NULL COMMENT 'Periodicidade do aceite do termo, em unidades' AFTER periodicidade_aceite_dias,
  ADD COLUMN periodicidade_aceite_unidade VARCHAR(10) NULL COMMENT 'dia, mes ou ano' AFTER periodicidade_aceite_quantidade,
  ADD COLUMN reutilizacao_bloqueada_dias SMALLINT UNSIGNED NULL COMMENT 'Dias em que uma senha usada não pode voltar' AFTER senhas_recentes_bloqueadas,
  ADD CONSTRAINT ck_politica_senha_periodicidade_unidade CHECK (periodicidade_aceite_unidade IS NULL OR periodicidade_aceite_unidade IN ('dia','mes','ano')),
  ADD CONSTRAINT ck_politica_senha_periodicidade_par CHECK ((periodicidade_aceite_quantidade IS NULL) = (periodicidade_aceite_unidade IS NULL));
ALTER TABLE politica_senha DROP CONSTRAINT ck_politica_senha_aceite;
ALTER TABLE politica_senha ADD CONSTRAINT ck_politica_senha_aceite CHECK (exige_aceite_periodico = FALSE OR periodicidade_aceite_dias > 0 OR periodicidade_aceite_quantidade > 0);
