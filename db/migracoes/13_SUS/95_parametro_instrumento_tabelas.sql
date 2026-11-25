-- Faturamento SUS, parâmetros próprios de cada instrumento (C1-051, 06-SUS linha 53, 25/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho; as regras ficam no domínio (dominio-faturamento, configuracao-sus.ts).
-- Um cadastro por estabelecimento e instrumento (CIHA, BPA, APAC, AIH), com os campos tipados de cada leiaute do
-- Ministério no lugar do texto solto nos parâmetros gerais; campo nulo: vale o parâmetro geral enquanto não cadastrado.
-- Cada campo só pode ser preenchido no seu instrumento (CHECK). Nada é apagado: a alteração sobe a versão e a trilha da
-- operação guarda o antes e o depois.
CREATE TABLE IF NOT EXISTS parametro_instrumento_sus (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id   BIGINT UNSIGNED NOT NULL,
  instrumento          VARCHAR(10) NOT NULL,
  fonte_padrao         VARCHAR(30) NULL COMMENT 'CIHA: fonte de remuneração padrão (lista fechada do domínio)',
  orgao_origem         VARCHAR(30) NULL COMMENT 'BPA: órgão de origem do arquivo',
  sigla_origem         VARCHAR(6) NULL COMMENT 'BPA: sigla do órgão de origem',
  cnpj_prestador       CHAR(14) NULL COMMENT 'BPA: CNPJ do prestador, só dígitos',
  orgao_destino        VARCHAR(40) NULL COMMENT 'BPA: órgão de destino (secretaria)',
  indicador_destino    CHAR(1) NULL COMMENT 'BPA: E estadual, M municipal',
  uf                   CHAR(2) NULL COMMENT 'APAC: UF do gestor',
  uti_por_acomodacao   VARCHAR(200) NULL COMMENT 'AIH: acomodação:tipo de UTI:procedimento da diária, separados por ponto e vírgula',
  diretor_clinico_cns  CHAR(15) NULL COMMENT 'AIH: CNS do diretor clínico',
  criado_em            DATETIME(3) NOT NULL,
  criado_por           BIGINT UNSIGNED NULL,
  alterado_em          DATETIME(3) NULL,
  alterado_por         BIGINT UNSIGNED NULL,
  versao               INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_parametro_instrumento_sus_instrumento CHECK (instrumento IN ('ciha','bpa','apac','aih')),
  CONSTRAINT ck_parametro_instrumento_sus_indicador CHECK (indicador_destino IS NULL OR indicador_destino IN ('E','M')),
  CONSTRAINT ck_parametro_instrumento_sus_cnpj CHECK (cnpj_prestador IS NULL OR cnpj_prestador REGEXP '^[0-9]{14}$'),
  CONSTRAINT ck_parametro_instrumento_sus_cns CHECK (diretor_clinico_cns IS NULL OR diretor_clinico_cns REGEXP '^[0-9]{15}$'),
  CONSTRAINT ck_parametro_instrumento_sus_campos CHECK (
    (instrumento = 'ciha' OR fonte_padrao IS NULL)
    AND (instrumento = 'bpa' OR (orgao_origem IS NULL AND sigla_origem IS NULL AND cnpj_prestador IS NULL AND orgao_destino IS NULL AND indicador_destino IS NULL))
    AND (instrumento = 'apac' OR uf IS NULL)
    AND (instrumento = 'aih' OR (uti_por_acomodacao IS NULL AND diretor_clinico_cns IS NULL))),
  UNIQUE KEY uq_parametro_instrumento_sus_estabelecimento_instrumento (estabelecimento_id, instrumento),
  CONSTRAINT fk_parametro_instrumento_sus_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT
) COMMENT='Parâmetros próprios de cada instrumento do faturamento SUS (CIHA, BPA, APAC, AIH) por estabelecimento';
