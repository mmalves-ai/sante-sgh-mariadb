-- Layout do arquivo do tarifador telefônico (06-FAT linha 23, F8, 25/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho; a leitura do arquivo é do domínio (@sgh/dominio-faturamento, conta/tarifador.ts)
-- e a gravação é da porta própria (apps/api/src/modulos/faturamento/tarifador-propria.ts).
--   - layout_tarifador: como a central telefônica do estabelecimento exporta os bilhetes (separador, cabeçalho,
--     posição de cada coluna a partir de 1, formatos da data, da duração e do valor, DDD do hospital). O faturista
--     descreve uma vez e importa o arquivo a cada fechamento. Inativar é marcar ativo = falso; nada se apaga.

CREATE TABLE IF NOT EXISTS layout_tarifador (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id  BIGINT UNSIGNED NOT NULL,
  descricao           VARCHAR(100) NOT NULL,
  separador           VARCHAR(20) NOT NULL COMMENT 'ponto_virgula, virgula, tabulacao, barra',
  tem_cabecalho       BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'A primeira linha do arquivo é o cabeçalho',
  formato_data        VARCHAR(20) NOT NULL COMMENT 'dia_mes_ano ou ano_mes_dia',
  formato_duracao     VARCHAR(30) NOT NULL COMMENT 'segundos, minutos ou horas_minutos_segundos',
  separador_decimal   CHAR(1) NOT NULL DEFAULT ',',
  ddd_local           CHAR(2) NULL COMMENT 'DDD do hospital: ligação para outro DDD é interurbana',
  coluna_ramal        SMALLINT UNSIGNED NULL,
  coluna_data_hora    SMALLINT UNSIGNED NOT NULL,
  coluna_hora         SMALLINT UNSIGNED NULL COMMENT 'Quando a hora vem separada da data',
  coluna_duracao      SMALLINT UNSIGNED NOT NULL,
  coluna_numero       SMALLINT UNSIGNED NOT NULL COMMENT 'Número discado',
  coluna_valor        SMALLINT UNSIGNED NULL COMMENT 'Valor cobrado pelo tarifador',
  coluna_atendimento  SMALLINT UNSIGNED NULL COMMENT 'Número do atendimento, quando a central o grava',
  ativo               BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em           DATETIME(3) NOT NULL,
  criado_por          BIGINT UNSIGNED NULL,
  alterado_em         DATETIME(3) NULL,
  alterado_por        BIGINT UNSIGNED NULL,
  versao              INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_layout_tarifador_descricao (estabelecimento_id, descricao),
  CONSTRAINT ck_layout_tarifador_separador CHECK (separador IN ('ponto_virgula','virgula','tabulacao','barra')),
  CONSTRAINT ck_layout_tarifador_formato_data CHECK (formato_data IN ('dia_mes_ano','ano_mes_dia')),
  CONSTRAINT ck_layout_tarifador_formato_duracao CHECK (formato_duracao IN ('segundos','minutos','horas_minutos_segundos')),
  CONSTRAINT ck_layout_tarifador_decimal CHECK (separador_decimal IN (',','.')),
  CONSTRAINT ck_layout_tarifador_colunas CHECK (
    coluna_data_hora BETWEEN 1 AND 60 AND coluna_duracao BETWEEN 1 AND 60 AND coluna_numero BETWEEN 1 AND 60
    AND (coluna_ramal IS NULL OR coluna_ramal BETWEEN 1 AND 60)
    AND (coluna_hora IS NULL OR coluna_hora BETWEEN 1 AND 60)
    AND (coluna_valor IS NULL OR coluna_valor BETWEEN 1 AND 60)
    AND (coluna_atendimento IS NULL OR coluna_atendimento BETWEEN 1 AND 60))
) COMMENT='Layout do arquivo de bilhetes da central telefônica, por estabelecimento';
