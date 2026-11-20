# Fatia do carregador: ibge

Fonte: catalogos/cache/ibge_uf/estados.json e cache/ibge_municipios/municipios.json (view=nivelado). Tabelas de destino: unidade_federativa, municipio_ibge

CREATE TABLE unidade_federativa (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo_ibge       CHAR(2) NOT NULL COMMENT 'Código oficial da UF no IBGE',
  sigla             CHAR(2) NOT NULL,
  descricao         VARCHAR(150) NOT NULL COMMENT 'Nome oficial da UF',
  codigo_tiss       VARCHAR(3) NULL COMMENT 'Código da UF na terminologia TISS',
  pais_referencia_id BIGINT UNSIGNED NOT NULL,
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  vigencia_inicio   DATE NULL,
  vigencia_fim      DATE NULL,
  versao_fonte      VARCHAR(30) NULL,
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_unidade_federativa_codigo_ibge CHECK (codigo_ibge REGEXP '^[0-9]{2}$'),
  CONSTRAINT ck_unidade_federativa_sigla CHECK (sigla REGEXP '^[A-Z]{2}$'),
  CONSTRAINT ck_unidade_federativa_vigencia CHECK (vigencia_fim IS NULL OR vigencia_inicio IS NULL OR vigencia_fim >= vigencia_inicio),
  UNIQUE KEY uq_unidade_federativa_codigo_ibge (codigo_ibge),
  UNIQUE KEY uq_unidade_federativa_sigla (sigla),
  UNIQUE KEY uq_unidade_federativa_codigo_tiss (codigo_tiss),
  KEY ix_unidade_federativa_pais (pais_referencia_id)
) COMMENT='Estados e Distrito Federal com sigla, código oficial e código usado na TISS';
ALTER TABLE unidade_federativa
  ADD CONSTRAINT fk_unidade_federativa_pais_referencia_id FOREIGN KEY (pais_referencia_id) REFERENCES pais_referencia (id) ON DELETE RESTRICT;


CREATE TABLE municipio_ibge (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo_ibge            CHAR(7) NOT NULL COMMENT 'Código de 7 dígitos, com dígito verificador',
  nome                   VARCHAR(150) NOT NULL,
  unidade_federativa_id  BIGINT UNSIGNED NOT NULL,
  area_ddd_id            BIGINT UNSIGNED NULL,
  codigo_siafi           VARCHAR(4) NULL COMMENT 'Código no sistema de administração financeira federal (nota fiscal de serviço)',
  codigo_tom             VARCHAR(5) NULL COMMENT 'Código na tabela de órgãos e municípios da Receita',
  cep_inicial            CHAR(8) NULL,
  cep_final              CHAR(8) NULL,
  populacao              INT UNSIGNED NULL,
  regional_saude_id      BIGINT UNSIGNED NULL,
  ativo                  BOOLEAN NOT NULL DEFAULT TRUE,
  vigencia_inicio        DATE NULL,
  vigencia_fim           DATE NULL,
  versao_fonte           VARCHAR(30) NULL COMMENT 'Versão ou data da publicação oficial carregada',
  criado_em              DATETIME(3) NOT NULL,
  criado_por             BIGINT UNSIGNED NULL,
  alterado_em            DATETIME(3) NULL,
  alterado_por           BIGINT UNSIGNED NULL,
  versao                 INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_municipio_ibge_codigo CHECK (codigo_ibge REGEXP '^[0-9]{7}$'),
  UNIQUE KEY uq_municipio_ibge_codigo_ibge (codigo_ibge),
  KEY ix_municipio_ibge_nome (unidade_federativa_id, nome),
  KEY ix_municipio_ibge_area_ddd_id (area_ddd_id),
  KEY ix_municipio_ibge_regional_saude_id (regional_saude_id)
) COMMENT='Municípios com código oficial, UF e situação, carregados da fonte do instituto de geografia';
ALTER TABLE municipio_ibge
  ADD CONSTRAINT fk_municipio_ibge_unidade_federativa_id FOREIGN KEY (unidade_federativa_id) REFERENCES unidade_federativa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_municipio_ibge_area_ddd_id FOREIGN KEY (area_ddd_id) REFERENCES area_ddd (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_municipio_ibge_regional_saude_id FOREIGN KEY (regional_saude_id) REFERENCES regional_saude (id) ON DELETE RESTRICT;


## estados.json (1 item)
{"id": 11, "sigla": "RO", "nome": "Rondônia", "regiao": {"id": 1, "sigla": "N", "nome": "Norte"}}
## municipios.json (1 item)
{"municipio-id": 1100015, "municipio-nome": "Alta Floresta D'Oeste", "microrregiao-id": 11006, "microrregiao-nome": "Cacoal", "mesorregiao-id": 1102, "mesorregiao-nome": "Leste Rondoniense", "regiao-imediata-id": 110005, "regiao-imediata-nome": "Cacoal", "regiao-intermediaria-id": 1102, "regiao-intermediaria-nome": "Ji-Paraná", "UF-id": 11, "UF-sigla": "RO", "UF-nome": "Rondônia", "regiao-id": 1, "regiao-sigla": "N", "regiao-nome": "Norte"}
