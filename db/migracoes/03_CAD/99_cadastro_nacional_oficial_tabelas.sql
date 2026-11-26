-- Catálogo oficial do cadastro nacional de estabelecimentos de saúde (C3-011, 02-CAD linha 29, 26/11/2026): só para
-- frente e idempotente (ADR 0002, parte 2). Sem gatilho; a conferência fica no domínio (dominio-faturamento,
-- sus/conferencia-cnes.ts). Carregado por catalogos/carregadores/cnes.py a partir da base pública do DATASUS, por
-- competência (regra 7: dado público vem da fonte oficial, por carregador versionado). Só entram os estabelecimentos
-- que o cliente cadastrou (ou as UFs pedidas na carga): é a referência que a conferência compara com o cadastro local.

CREATE TABLE IF NOT EXISTS estabelecimento_cadastro_nacional (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  competencia       DATE NOT NULL COMMENT 'Primeiro dia do mês da competência da base oficial',
  codigo_cnes       CHAR(7) NOT NULL COMMENT 'Número do estabelecimento no cadastro nacional',
  codigo_municipio  CHAR(6) NULL COMMENT 'Município do estabelecimento (código do IBGE com 6 dígitos)',
  cnpj              CHAR(14) NULL COMMENT 'CNPJ próprio do estabelecimento; nulo quando não informado',
  razao_social      VARCHAR(150) NOT NULL,
  nome_fantasia     VARCHAR(150) NULL,
  codigo_tipo_unidade VARCHAR(3) NULL COMMENT 'Tipo de estabelecimento no cadastro nacional',
  versao_fonte      VARCHAR(30) NOT NULL COMMENT 'Competência da base oficial carregada (AAAAMM)',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_estabelecimento_cadastro_nacional_competencia CHECK (DAYOFMONTH(competencia) = 1),
  CONSTRAINT ck_estabelecimento_cadastro_nacional_cnes CHECK (codigo_cnes REGEXP '^[0-9]{7}$'),
  CONSTRAINT ck_estabelecimento_cadastro_nacional_cnpj CHECK (cnpj IS NULL OR cnpj REGEXP '^[0-9]{14}$'),
  UNIQUE KEY uq_estabelecimento_cadastro_nacional (competencia, codigo_cnes),
  KEY ix_estabelecimento_cadastro_nacional_cnes (codigo_cnes)
) COMMENT='Estabelecimentos da base oficial do cadastro nacional, por competência (catálogo público)';

CREATE TABLE IF NOT EXISTS habilitacao_cadastro_nacional (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  competencia       DATE NOT NULL COMMENT 'Primeiro dia do mês da competência da base oficial',
  codigo_cnes       CHAR(7) NOT NULL COMMENT 'Número do estabelecimento no cadastro nacional',
  codigo_habilitacao VARCHAR(6) NOT NULL COMMENT 'Código oficial da habilitação',
  competencia_inicio DATE NULL COMMENT 'Primeiro dia da competência inicial da habilitação',
  competencia_fim   DATE NULL COMMENT 'Primeiro dia da competência final; nulo enquanto vigente',
  numero_portaria   VARCHAR(30) NULL,
  leitos_habilitados INT UNSIGNED NULL,
  versao_fonte      VARCHAR(30) NOT NULL COMMENT 'Competência da base oficial carregada (AAAAMM)',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_habilitacao_cadastro_nacional_competencia CHECK (DAYOFMONTH(competencia) = 1),
  CONSTRAINT ck_habilitacao_cadastro_nacional_cnes CHECK (codigo_cnes REGEXP '^[0-9]{7}$'),
  CONSTRAINT ck_habilitacao_cadastro_nacional_codigo CHECK (codigo_habilitacao REGEXP '^[0-9]{1,6}$'),
  UNIQUE KEY uq_habilitacao_cadastro_nacional (competencia, codigo_cnes, codigo_habilitacao),
  KEY ix_habilitacao_cadastro_nacional_cnes (codigo_cnes, competencia)
) COMMENT='Habilitações dos estabelecimentos na base oficial do cadastro nacional, por competência (catálogo público)';

CREATE TABLE IF NOT EXISTS servico_cadastro_nacional (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  competencia       DATE NOT NULL COMMENT 'Primeiro dia do mês da competência da base oficial',
  codigo_cnes       CHAR(7) NOT NULL COMMENT 'Número do estabelecimento no cadastro nacional',
  codigo_servico    CHAR(3) NOT NULL COMMENT 'Serviço especializado',
  codigo_classificacao CHAR(3) NOT NULL COMMENT 'Classificação dentro do serviço',
  versao_fonte      VARCHAR(30) NOT NULL COMMENT 'Competência da base oficial carregada (AAAAMM)',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_servico_cadastro_nacional_competencia CHECK (DAYOFMONTH(competencia) = 1),
  CONSTRAINT ck_servico_cadastro_nacional_cnes CHECK (codigo_cnes REGEXP '^[0-9]{7}$'),
  CONSTRAINT ck_servico_cadastro_nacional_codigos CHECK (codigo_servico REGEXP '^[0-9]{3}$' AND codigo_classificacao REGEXP '^[0-9]{3}$'),
  UNIQUE KEY uq_servico_cadastro_nacional (competencia, codigo_cnes, codigo_servico, codigo_classificacao),
  KEY ix_servico_cadastro_nacional_cnes (codigo_cnes, competencia)
) COMMENT='Serviços e classificações dos estabelecimentos na base oficial do cadastro nacional, por competência (catálogo público)';

CREATE TABLE IF NOT EXISTS leito_cadastro_nacional (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  competencia       DATE NOT NULL COMMENT 'Primeiro dia do mês da competência da base oficial',
  codigo_cnes       CHAR(7) NOT NULL COMMENT 'Número do estabelecimento no cadastro nacional',
  codigo_tipo_leito VARCHAR(3) NOT NULL COMMENT 'Tipo do leito no cadastro nacional',
  codigo_leito      VARCHAR(3) NOT NULL COMMENT 'Especialidade do leito no cadastro nacional',
  quantidade_existente INT UNSIGNED NOT NULL DEFAULT 0,
  quantidade_sus    INT UNSIGNED NOT NULL DEFAULT 0,
  versao_fonte      VARCHAR(30) NOT NULL COMMENT 'Competência da base oficial carregada (AAAAMM)',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_leito_cadastro_nacional_competencia CHECK (DAYOFMONTH(competencia) = 1),
  CONSTRAINT ck_leito_cadastro_nacional_cnes CHECK (codigo_cnes REGEXP '^[0-9]{7}$'),
  CONSTRAINT ck_leito_cadastro_nacional_sus CHECK (quantidade_sus <= quantidade_existente),
  UNIQUE KEY uq_leito_cadastro_nacional (competencia, codigo_cnes, codigo_tipo_leito, codigo_leito),
  KEY ix_leito_cadastro_nacional_cnes (codigo_cnes, competencia)
) COMMENT='Leitos dos estabelecimentos na base oficial do cadastro nacional, por competência (catálogo público)';
