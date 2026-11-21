-- F2.4 (dívida da migração), 2ª volta: DDL pedido pelos lotes, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v2.md

CREATE TABLE IF NOT EXISTS atributo_categoria_acomodacao (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  categoria_acomodacao_id BIGINT UNSIGNED NOT NULL,
  sexo_permitido VARCHAR(30) NULL,
  criticidade VARCHAR(30) NULL,
  idade_minima_dias INT UNSIGNED NULL,
  idade_maxima_dias INT UNSIGNED NULL,
  andar SMALLINT NULL,
  ramal VARCHAR(20) NULL,
  terapia_intensiva BOOLEAN NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_atributo_categoria_acomodacao_sexo CHECK (sexo_permitido IS NULL OR sexo_permitido IN ('qualquer','masculino','feminino')),
  CONSTRAINT ck_atributo_categoria_acomodacao_criticidade CHECK (criticidade IS NULL OR criticidade IN ('baixa','media','alta','intensiva')),
  CONSTRAINT ck_atributo_categoria_acomodacao_faixa_etaria CHECK (idade_minima_dias IS NULL OR idade_maxima_dias IS NULL OR idade_minima_dias <= idade_maxima_dias),
  UNIQUE KEY uq_atributo_categoria_acomodacao (estabelecimento_id, categoria_acomodacao_id),
  KEY ix_atributo_categoria_acomodacao_categoria (categoria_acomodacao_id)
) COMMENT='Atributos padrão do tipo de acomodação no estabelecimento, herdados pelos leitos sem atributo próprio';
