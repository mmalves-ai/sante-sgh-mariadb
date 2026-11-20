# Fatia do carregador: sigtap

Fonte: catalogos/cache/sigtap/TabelaUnificada_*.zip (a mais recente). Tabelas de destino: compatibilidade_sigtap, competencia_sigtap, dominio_sigtap, equivalencia_sigtap_item, grupo_sigtap, habilitacao_sigtap, procedimento_sigtap, procedimento_sigtap_atributo, procedimento_sigtap_cbo, procedimento_sigtap_cid, procedimento_sigtap_habilitacao, procedimento_sigtap_incremento, procedimento_sigtap_leito, procedimento_sigtap_opm, procedimento_sigtap_registro, procedimento_sigtap_servico, procedimento_sigtap_valor, servico_classificacao_sigtap, ocupacao_cbo

CREATE TABLE compatibilidade_sigtap (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  principal_procedimento_sigtap_id BIGINT UNSIGNED NOT NULL,
  principal_instrumento_dominio_sigtap_id BIGINT UNSIGNED NULL COMMENT 'Instrumento de registro do principal',
  compativel_procedimento_sigtap_id BIGINT UNSIGNED NOT NULL,
  compativel_instrumento_dominio_sigtap_id BIGINT UNSIGNED NULL COMMENT 'Instrumento de registro do secundário',
  tipo_compatibilidade VARCHAR(30) NOT NULL,
  quantidade_maxima INT UNSIGNED NULL,
  descricao VARCHAR(250) NULL,
  vigencia_inicio DATE NOT NULL,
  vigencia_fim DATE NULL,
  versao_fonte VARCHAR(30) NOT NULL COMMENT 'Competência ou versão da tabela unificada carregada',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_compatibilidade_sigtap_tipo_compatibilidade CHECK (tipo_compatibilidade IN ('compativel','incompativel','concomitante','exclusivo','associado')),
  UNIQUE KEY uq_compatibilidade_sigtap_par (principal_procedimento_sigtap_id, compativel_procedimento_sigtap_id, tipo_compatibilidade, principal_instrumento_dominio_sigtap_id, compativel_instrumento_dominio_sigtap_id, vigencia_inicio),
  CONSTRAINT ck_compatibilidade_sigtap_distintos CHECK (principal_procedimento_sigtap_id <> compativel_procedimento_sigtap_id),
  CONSTRAINT ck_compatibilidade_sigtap_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  KEY ix_compatibilidade_sigtap_principal_instrumento_dominio_ad244159 (principal_instrumento_dominio_sigtap_id),
  KEY ix_compatibilidade_sigtap_compativel_procedimento_sigtap_id (compativel_procedimento_sigtap_id),
  KEY ix_compatibilidade_sigtap_compativel_instrumento_domini_880d2e9e (compativel_instrumento_dominio_sigtap_id)
) COMMENT='Compatibilidades e incompatibilidades entre procedimentos (principal e secundário) por instrumento';
ALTER TABLE compatibilidade_sigtap
  ADD CONSTRAINT fk_compatibilidade_sigtap_principal_procedimento_sigtap_id FOREIGN KEY (principal_procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_compatibilidade_sigtap_principal_instrumento_dominio_35e999cb FOREIGN KEY (principal_instrumento_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_compatibilidade_sigtap_compativel_procedimento_sigtap_id FOREIGN KEY (compativel_procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_compatibilidade_sigtap_compativel_instrumento_domini_630ac84f FOREIGN KEY (compativel_instrumento_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT;


CREATE TABLE competencia_sigtap (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo_competencia CHAR(6) NOT NULL COMMENT 'Competência AAAAMM da tabela unificada',
  descricao VARCHAR(150) NOT NULL,
  data_publicacao DATE NULL,
  vigencia_inicio DATE NOT NULL,
  vigencia_fim DATE NULL,
  versao_fonte VARCHAR(30) NOT NULL COMMENT 'Competência ou versão da tabela unificada carregada',
  situacao_carga VARCHAR(30) NOT NULL DEFAULT 'pendente',
  carregada_em DATETIME(3) NULL,
  carregada_por_usuario_id BIGINT UNSIGNED NULL,
  arquivo_id BIGINT UNSIGNED NULL COMMENT 'Pacote oficial baixado',
  quantidade_procedimentos INT UNSIGNED NULL,
  vigente BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Competência em uso no faturamento',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_competencia_sigtap_situacao_carga CHECK (situacao_carga IN ('pendente','carregando','carregada','falha','substituida')),
  UNIQUE KEY uq_competencia_sigtap_codigo_competencia (codigo_competencia),
  CONSTRAINT ck_competencia_sigtap_codigo CHECK (codigo_competencia REGEXP '^[0-9]{4}(0[1-9]|1[0-2])$'),
  CONSTRAINT ck_competencia_sigtap_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  KEY ix_competencia_sigtap_carregada_por_usuario_id (carregada_por_usuario_id),
  KEY ix_competencia_sigtap_arquivo_id (arquivo_id)
) COMMENT='Competência da tabela unificada carregada, com data de publicação e situação da carga';
ALTER TABLE competencia_sigtap
  ADD CONSTRAINT fk_competencia_sigtap_carregada_por_usuario_id FOREIGN KEY (carregada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_competencia_sigtap_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;


CREATE TABLE dominio_sigtap (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lista VARCHAR(30) NOT NULL,
  codigo_sigtap VARCHAR(10) NOT NULL COMMENT 'Código oficial dentro da lista',
  sigla VARCHAR(10) NULL,
  descricao VARCHAR(250) NOT NULL,
  detalhe TEXT NULL COMMENT 'Texto longo (ex.: regra condicionada)',
  pai_dominio_sigtap_id BIGINT UNSIGNED NULL COMMENT 'Ex.: subtipo dentro do financiamento',
  vigencia_inicio DATE NOT NULL,
  vigencia_fim DATE NULL,
  versao_fonte VARCHAR(30) NOT NULL COMMENT 'Competência ou versão da tabela unificada carregada',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_dominio_sigtap_lista CHECK (lista IN ('modalidade','complexidade','financiamento','subtipo_financiamento','instrumento_registro','tipo_leito','atributo_complementar','motivo_cobranca','rubrica','regra_condicionada','tipo_prestador')),
  UNIQUE KEY uq_dominio_sigtap_lista_codigo_vigencia (lista, codigo_sigtap, vigencia_inicio),
  CONSTRAINT ck_dominio_sigtap_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  KEY ix_dominio_sigtap_pai_dominio_sigtap_id (pai_dominio_sigtap_id)
) COMMENT='Listas auxiliares da tabela unificada (modalidade, complexidade, financiamento, instrumento, leito, rubrica)';
ALTER TABLE dominio_sigtap
  ADD CONSTRAINT fk_dominio_sigtap_pai_dominio_sigtap_id FOREIGN KEY (pai_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT;


CREATE TABLE equivalencia_sigtap_item (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  item_faturavel_id BIGINT UNSIGNED NOT NULL,
  procedimento_sigtap_id BIGINT UNSIGNED NOT NULL,
  instrumento VARCHAR(30) NOT NULL DEFAULT 'todos',
  pacote BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'O item entra como pacote no procedimento',
  gera_servico_hospitalar BOOLEAN NOT NULL DEFAULT FALSE,
  vigencia_inicio DATE NOT NULL,
  vigencia_fim DATE NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_equivalencia_sigtap_item_instrumento CHECK (instrumento IN ('bpa','apac','aih','raas','ciha','todos')),
  UNIQUE KEY uq_equivalencia_sigtap_item_par (item_faturavel_id, procedimento_sigtap_id, instrumento, vigencia_inicio),
  CONSTRAINT ck_equivalencia_sigtap_item_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  KEY ix_equivalencia_sigtap_item_procedimento_sigtap_id (procedimento_sigtap_id)
) COMMENT='De-para do item faturável do hospital para o procedimento da tabela unificada, usado na CIHA';
ALTER TABLE equivalencia_sigtap_item
  ADD CONSTRAINT fk_equivalencia_sigtap_item_item_faturavel_id FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_equivalencia_sigtap_item_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT;


CREATE TABLE grupo_sigtap (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nivel VARCHAR(30) NOT NULL,
  codigo_sigtap VARCHAR(6) NOT NULL COMMENT 'Código completo: 2 dígitos (grupo), 4 (subgrupo) ou 6 (forma)',
  pai_grupo_sigtap_id BIGINT UNSIGNED NULL,
  descricao VARCHAR(150) NOT NULL,
  vigencia_inicio DATE NOT NULL,
  vigencia_fim DATE NULL,
  versao_fonte VARCHAR(30) NOT NULL COMMENT 'Competência ou versão da tabela unificada carregada',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_grupo_sigtap_nivel CHECK (nivel IN ('grupo','subgrupo','forma_organizacao')),
  UNIQUE KEY uq_grupo_sigtap_codigo_vigencia (codigo_sigtap, vigencia_inicio),
  CONSTRAINT ck_grupo_sigtap_codigo CHECK ((nivel = 'grupo' AND codigo_sigtap REGEXP '^[0-9]{2}$') OR (nivel = 'subgrupo' AND codigo_sigtap REGEXP '^[0-9]{4}$') OR (nivel = 'forma_organizacao' AND codigo_sigtap REGEXP '^[0-9]{6}$')),
  CONSTRAINT ck_grupo_sigtap_pai CHECK ((nivel = 'grupo') = (pai_grupo_sigtap_id IS NULL)),
  CONSTRAINT ck_grupo_sigtap_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  KEY ix_grupo_sigtap_pai_grupo_sigtap_id (pai_grupo_sigtap_id)
) COMMENT='Hierarquia da tabela unificada: grupo, subgrupo e forma de organização por competência';
ALTER TABLE grupo_sigtap
  ADD CONSTRAINT fk_grupo_sigtap_pai_grupo_sigtap_id FOREIGN KEY (pai_grupo_sigtap_id) REFERENCES grupo_sigtap (id) ON DELETE RESTRICT;


CREATE TABLE habilitacao_sigtap (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tipo VARCHAR(30) NOT NULL,
  codigo_habilitacao VARCHAR(4) NOT NULL COMMENT 'Código oficial da habilitação ou do grupo',
  grupo_habilitacao_sigtap_id BIGINT UNSIGNED NULL COMMENT 'Grupo da habilitação',
  descricao VARCHAR(250) NOT NULL,
  detalhe VARCHAR(500) NULL,
  vigencia_inicio DATE NOT NULL,
  vigencia_fim DATE NULL,
  versao_fonte VARCHAR(30) NOT NULL COMMENT 'Competência ou versão da tabela unificada carregada',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_habilitacao_sigtap_tipo CHECK (tipo IN ('habilitacao','grupo_habilitacao')),
  UNIQUE KEY uq_habilitacao_sigtap_tipo_codigo_vigencia (tipo, codigo_habilitacao, vigencia_inicio),
  CONSTRAINT ck_habilitacao_sigtap_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  KEY ix_habilitacao_sigtap_grupo_habilitacao_sigtap_id (grupo_habilitacao_sigtap_id)
) COMMENT='Habilitações do Ministério da Saúde e seus grupos, por competência';
ALTER TABLE habilitacao_sigtap
  ADD CONSTRAINT fk_habilitacao_sigtap_grupo_habilitacao_sigtap_id FOREIGN KEY (grupo_habilitacao_sigtap_id) REFERENCES habilitacao_sigtap (id) ON DELETE RESTRICT;


CREATE TABLE procedimento_sigtap (
  id                                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo_sigtap                            CHAR(10) NOT NULL COMMENT 'Código oficial de 10 dígitos',
  descricao                                VARCHAR(250) NOT NULL,
  descricao_detalhada                      TEXT NULL,
  grupo_sigtap_id                          BIGINT UNSIGNED NOT NULL COMMENT 'Forma de organização (último nível da hierarquia grupo, subgrupo, forma)',
  sexo                                     VARCHAR(30) NOT NULL DEFAULT 'ambos',
  idade_minima_meses                       SMALLINT UNSIGNED NULL COMMENT 'Idade mínima em meses',
  idade_maxima_meses                       SMALLINT UNSIGNED NULL COMMENT 'Idade máxima em meses',
  quantidade_maxima                        INT UNSIGNED NULL COMMENT 'Quantidade máxima por instrumento de registro',
  permanencia_dias                         SMALLINT UNSIGNED NULL COMMENT 'Média de permanência em dias',
  pontos                                   SMALLINT UNSIGNED NULL COMMENT 'Pontos do ato profissional para rateio',
  complexidade_dominio_sigtap_id           BIGINT UNSIGNED NULL,
  financiamento_dominio_sigtap_id          BIGINT UNSIGNED NULL,
  subtipo_financiamento_dominio_sigtap_id  BIGINT UNSIGNED NULL,
  rubrica_dominio_sigtap_id                BIGINT UNSIGNED NULL,
  exige_ato_anestesico                     BOOLEAN NOT NULL DEFAULT FALSE,
  ortese_protese                           BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'O procedimento é uma OPM',
  vigencia_inicio                          DATE NOT NULL COMMENT 'Primeiro dia da competência inicial',
  vigencia_fim                             DATE NULL COMMENT 'Último dia da competência final; nulo enquanto vigente',
  versao_fonte                             VARCHAR(30) NOT NULL COMMENT 'Competência ou versão do arquivo oficial carregado',
  ativo                                    BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em                                DATETIME(3) NOT NULL,
  criado_por                               BIGINT UNSIGNED NULL,
  alterado_em                              DATETIME(3) NULL,
  alterado_por                             BIGINT UNSIGNED NULL,
  versao                                   INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_procedimento_sigtap_sexo CHECK (sexo IN ('ambos','masculino','feminino','nao_se_aplica')),
  UNIQUE KEY uq_procedimento_sigtap_codigo_sigtap (codigo_sigtap),
  KEY ix_procedimento_sigtap_descricao (descricao),
  CONSTRAINT ck_procedimento_sigtap_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  CONSTRAINT ck_procedimento_sigtap_codigo CHECK (codigo_sigtap REGEXP '^[0-9]{10}$'),
  CONSTRAINT ck_procedimento_sigtap_idade CHECK (idade_minima_meses IS NULL OR idade_maxima_meses IS NULL OR idade_minima_meses <= idade_maxima_meses),
  KEY ix_procedimento_sigtap_grupo_sigtap (grupo_sigtap_id),
  KEY ix_procedimento_sigtap_complexidade_dominio_sigtap (complexidade_dominio_sigtap_id),
  KEY ix_procedimento_sigtap_financiamento_dominio_sigtap (financiamento_dominio_sigtap_id),
  KEY ix_procedimento_sigtap_subtipo_financiamento_dominio_sigtap (subtipo_financiamento_dominio_sigtap_id),
  KEY ix_procedimento_sigtap_rubrica_dominio_sigtap (rubrica_dominio_sigtap_id)
) COMMENT='Procedimento da tabela unificada SUS: complexidade, financiamento, idade, sexo e permanência (atributos da competência mais recente carregada)';
ALTER TABLE procedimento_sigtap
  ADD CONSTRAINT fk_procedimento_sigtap_grupo_sigtap_id FOREIGN KEY (grupo_sigtap_id) REFERENCES grupo_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_complexidade_dominio_sigtap_id FOREIGN KEY (complexidade_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_financiamento_dominio_sigtap_id FOREIGN KEY (financiamento_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_subtipo_financiamento_dominio_sigtap_id FOREIGN KEY (subtipo_financiamento_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_rubrica_dominio_sigtap_id FOREIGN KEY (rubrica_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT;


CREATE TABLE procedimento_sigtap_atributo (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  procedimento_sigtap_id   BIGINT UNSIGNED NOT NULL,
  tipo_atributo            VARCHAR(30) NOT NULL,
  valor_dominio_sigtap_id  BIGINT UNSIGNED NOT NULL COMMENT 'Valor do atributo na lista auxiliar da tabela unificada',
  vigencia_inicio          DATE NOT NULL COMMENT 'Primeiro dia da competência inicial',
  vigencia_fim             DATE NULL COMMENT 'Último dia da competência final; nulo enquanto vigente',
  versao_fonte             VARCHAR(30) NOT NULL COMMENT 'Competência ou versão do arquivo oficial carregado',
  criado_em                DATETIME(3) NOT NULL,
  criado_por               BIGINT UNSIGNED NULL,
  alterado_em              DATETIME(3) NULL,
  alterado_por             BIGINT UNSIGNED NULL,
  versao                   INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_procedimento_sigtap_atributo_tipo_atributo CHECK (tipo_atributo IN ('modalidade','tipo_prestador','motivo_cobranca','carater_atendimento','regra_condicionada','atributo_complementar','detalhe','esquema','estadio','nivel_hierarquia','origem','lista_verificacao')),
  UNIQUE KEY uq_procedimento_sigtap_atributo_procedimento_sigtap_id_ti_a362bf (procedimento_sigtap_id, tipo_atributo, valor_dominio_sigtap_id, vigencia_inicio),
  CONSTRAINT ck_procedimento_sigtap_atributo_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  KEY ix_procedimento_sigtap_atributo_valor_dominio_sigtap (valor_dominio_sigtap_id)
) COMMENT='Demais atributos do procedimento por competência: modalidade, tipo de prestador, motivo de cobrança, caráter, regra condicionada e detalhes';
ALTER TABLE procedimento_sigtap_atributo
  ADD CONSTRAINT fk_procedimento_sigtap_atributo_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_atributo_valor_dominio_sigtap_id FOREIGN KEY (valor_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT;


CREATE TABLE procedimento_sigtap_cbo (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  procedimento_sigtap_id  BIGINT UNSIGNED NOT NULL,
  ocupacao_cbo_id         BIGINT UNSIGNED NOT NULL,
  vigencia_inicio         DATE NOT NULL COMMENT 'Primeiro dia da competência inicial',
  vigencia_fim            DATE NULL COMMENT 'Último dia da competência final; nulo enquanto vigente',
  versao_fonte            VARCHAR(30) NOT NULL COMMENT 'Competência ou versão do arquivo oficial carregado',
  criado_em               DATETIME(3) NOT NULL,
  criado_por              BIGINT UNSIGNED NULL,
  alterado_em             DATETIME(3) NULL,
  alterado_por            BIGINT UNSIGNED NULL,
  versao                  INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_procedimento_sigtap_cbo_procedimento_sigtap_id_ocupaca_523036 (procedimento_sigtap_id, ocupacao_cbo_id, vigencia_inicio),
  CONSTRAINT ck_procedimento_sigtap_cbo_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  KEY ix_procedimento_sigtap_cbo_ocupacao_cbo (ocupacao_cbo_id)
) COMMENT='Ocupações (CBO) que podem executar cada procedimento, por competência';
ALTER TABLE procedimento_sigtap_cbo
  ADD CONSTRAINT fk_procedimento_sigtap_cbo_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_cbo_ocupacao_cbo_id FOREIGN KEY (ocupacao_cbo_id) REFERENCES ocupacao_cbo (id) ON DELETE RESTRICT;


CREATE TABLE procedimento_sigtap_cid (
  id                         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  procedimento_sigtap_id     BIGINT UNSIGNED NOT NULL,
  cid_termo_terminologia_id  BIGINT UNSIGNED NOT NULL COMMENT 'CID-10 compatível',
  principal                  BOOLEAN NOT NULL DEFAULT TRUE,
  secundario                 BOOLEAN NOT NULL DEFAULT FALSE,
  padrao                     BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'CID sugerido por padrão para o procedimento',
  vigencia_inicio            DATE NOT NULL COMMENT 'Primeiro dia da competência inicial',
  vigencia_fim               DATE NULL COMMENT 'Último dia da competência final; nulo enquanto vigente',
  versao_fonte               VARCHAR(30) NOT NULL COMMENT 'Competência ou versão do arquivo oficial carregado',
  criado_em                  DATETIME(3) NOT NULL,
  criado_por                 BIGINT UNSIGNED NULL,
  alterado_em                DATETIME(3) NULL,
  alterado_por               BIGINT UNSIGNED NULL,
  versao                     INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_procedimento_sigtap_cid_procedimento_sigtap_id_cid_ter_d1d8c5 (procedimento_sigtap_id, cid_termo_terminologia_id, vigencia_inicio),
  CONSTRAINT ck_procedimento_sigtap_cid_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  CONSTRAINT ck_procedimento_sigtap_cid_uso CHECK (principal OR secundario),
  KEY ix_procedimento_sigtap_cid_cid_termo_terminologia (cid_termo_terminologia_id)
) COMMENT='CIDs principais e secundários compatíveis com cada procedimento, por competência';
ALTER TABLE procedimento_sigtap_cid
  ADD CONSTRAINT fk_procedimento_sigtap_cid_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_cid_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;


CREATE TABLE procedimento_sigtap_habilitacao (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  procedimento_sigtap_id  BIGINT UNSIGNED NOT NULL,
  habilitacao_sigtap_id   BIGINT UNSIGNED NOT NULL,
  grupo_habilitacao       VARCHAR(10) NULL COMMENT 'Grupo de habilitações alternativas: basta uma do grupo',
  vigencia_inicio         DATE NOT NULL COMMENT 'Primeiro dia da competência inicial',
  vigencia_fim            DATE NULL COMMENT 'Último dia da competência final; nulo enquanto vigente',
  versao_fonte            VARCHAR(30) NOT NULL COMMENT 'Competência ou versão do arquivo oficial carregado',
  criado_em               DATETIME(3) NOT NULL,
  criado_por              BIGINT UNSIGNED NULL,
  alterado_em             DATETIME(3) NULL,
  alterado_por            BIGINT UNSIGNED NULL,
  versao                  INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_procedimento_sigtap_habilitacao_procedimento_sigtap_id_8b6786 (procedimento_sigtap_id, habilitacao_sigtap_id, vigencia_inicio),
  CONSTRAINT ck_procedimento_sigtap_habilitacao_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  KEY ix_procedimento_sigtap_habilitacao_habilitacao_sigtap (habilitacao_sigtap_id)
) COMMENT='Habilitações exigidas por procedimento, por competência';
ALTER TABLE procedimento_sigtap_habilitacao
  ADD CONSTRAINT fk_procedimento_sigtap_habilitacao_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_habilitacao_habilitacao_sigtap_id FOREIGN KEY (habilitacao_sigtap_id) REFERENCES habilitacao_sigtap (id) ON DELETE RESTRICT;


CREATE TABLE procedimento_sigtap_incremento (
  id                               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  procedimento_sigtap_id           BIGINT UNSIGNED NOT NULL,
  habilitacao_sigtap_id            BIGINT UNSIGNED NOT NULL,
  percentual_incremento            DECIMAL(7,4) NULL COMMENT 'Percentual sobre o valor total',
  percentual_servico_hospitalar    DECIMAL(7,4) NULL,
  percentual_servico_profissional  DECIMAL(7,4) NULL,
  percentual_servico_ambulatorial  DECIMAL(7,4) NULL,
  vigencia_inicio                  DATE NOT NULL COMMENT 'Primeiro dia da competência inicial',
  vigencia_fim                     DATE NULL COMMENT 'Último dia da competência final; nulo enquanto vigente',
  versao_fonte                     VARCHAR(30) NOT NULL COMMENT 'Competência ou versão do arquivo oficial carregado',
  criado_em                        DATETIME(3) NOT NULL,
  criado_por                       BIGINT UNSIGNED NULL,
  alterado_em                      DATETIME(3) NULL,
  alterado_por                     BIGINT UNSIGNED NULL,
  versao                           INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_procedimento_sigtap_incremento_procedimento_sigtap_id__defb9f (procedimento_sigtap_id, habilitacao_sigtap_id, vigencia_inicio),
  CONSTRAINT ck_procedimento_sigtap_incremento_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  CONSTRAINT ck_procedimento_sigtap_incremento_percentuais CHECK (COALESCE(percentual_incremento,0) >= 0 AND COALESCE(percentual_servico_hospitalar,0) >= 0 AND COALESCE(percentual_servico_profissional,0) >= 0 AND COALESCE(percentual_servico_ambulatorial,0) >= 0),
  KEY ix_procedimento_sigtap_incremento_habilitacao_sigtap (habilitacao_sigtap_id)
) COMMENT='Percentual de incremento do procedimento conforme a habilitação do estabelecimento';
ALTER TABLE procedimento_sigtap_incremento
  ADD CONSTRAINT fk_procedimento_sigtap_incremento_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_incremento_habilitacao_sigtap_id FOREIGN KEY (habilitacao_sigtap_id) REFERENCES habilitacao_sigtap (id) ON DELETE RESTRICT;


CREATE TABLE procedimento_sigtap_leito (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  procedimento_sigtap_id  BIGINT UNSIGNED NOT NULL,
  especialidade_leito_id  BIGINT UNSIGNED NOT NULL,
  padrao                  BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Especialidade sugerida por padrão',
  vigencia_inicio         DATE NOT NULL COMMENT 'Primeiro dia da competência inicial',
  vigencia_fim            DATE NULL COMMENT 'Último dia da competência final; nulo enquanto vigente',
  versao_fonte            VARCHAR(30) NOT NULL COMMENT 'Competência ou versão do arquivo oficial carregado',
  criado_em               DATETIME(3) NOT NULL,
  criado_por              BIGINT UNSIGNED NULL,
  alterado_em             DATETIME(3) NULL,
  alterado_por            BIGINT UNSIGNED NULL,
  versao                  INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_procedimento_sigtap_leito_procedimento_sigtap_id_espec_020977 (procedimento_sigtap_id, especialidade_leito_id, vigencia_inicio),
  CONSTRAINT ck_procedimento_sigtap_leito_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  KEY ix_procedimento_sigtap_leito_especialidade_leito (especialidade_leito_id)
) COMMENT='Especialidades de leito em que o procedimento pode ser realizado, por competência';
ALTER TABLE procedimento_sigtap_leito
  ADD CONSTRAINT fk_procedimento_sigtap_leito_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_leito_especialidade_leito_id FOREIGN KEY (especialidade_leito_id) REFERENCES especialidade_leito (id) ON DELETE RESTRICT;


CREATE TABLE procedimento_sigtap_opm (
  id                                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  procedimento_sigtap_id                      BIGINT UNSIGNED NOT NULL,
  opm_procedimento_sigtap_id                  BIGINT UNSIGNED NOT NULL COMMENT 'A OPM, que também é procedimento da tabela unificada',
  quantidade_maxima                           SMALLINT UNSIGNED NULL,
  instrumento_procedimento_dominio_sigtap_id  BIGINT UNSIGNED NULL COMMENT 'Instrumento de registro do procedimento principal',
  instrumento_opm_dominio_sigtap_id           BIGINT UNSIGNED NULL COMMENT 'Instrumento de registro da OPM',
  tipo_compatibilidade                        VARCHAR(30) NOT NULL DEFAULT 'compativel',
  vigencia_inicio                             DATE NOT NULL COMMENT 'Primeiro dia da competência inicial',
  vigencia_fim                                DATE NULL COMMENT 'Último dia da competência final; nulo enquanto vigente',
  versao_fonte                                VARCHAR(30) NOT NULL COMMENT 'Competência ou versão do arquivo oficial carregado',
  criado_em                                   DATETIME(3) NOT NULL,
  criado_por                                  BIGINT UNSIGNED NULL,
  alterado_em                                 DATETIME(3) NULL,
  alterado_por                                BIGINT UNSIGNED NULL,
  versao                                      INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_procedimento_sigtap_opm_tipo_compatibilidade CHECK (tipo_compatibilidade IN ('compativel','incompativel','concomitante')),
  UNIQUE KEY uq_procedimento_sigtap_opm_procedimento_sigtap_id_opm_pro_129f99 (procedimento_sigtap_id, opm_procedimento_sigtap_id, vigencia_inicio),
  CONSTRAINT ck_procedimento_sigtap_opm_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  CONSTRAINT ck_procedimento_sigtap_opm_distintos CHECK (opm_procedimento_sigtap_id <> procedimento_sigtap_id),
  KEY ix_procedimento_sigtap_opm_opm_procedimento_sigtap (opm_procedimento_sigtap_id),
  KEY ix_procedimento_sigtap_opm_instrumento_procedimento_domin_eda99d (instrumento_procedimento_dominio_sigtap_id),
  KEY ix_procedimento_sigtap_opm_instrumento_opm_dominio_sigtap (instrumento_opm_dominio_sigtap_id)
) COMMENT='OPM compatíveis com cada procedimento e quantidade máxima por instrumento, por competência';
ALTER TABLE procedimento_sigtap_opm
  ADD CONSTRAINT fk_procedimento_sigtap_opm_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_opm_opm_procedimento_sigtap_id FOREIGN KEY (opm_procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_opm_instrumento_procedimento_domin_a61a56 FOREIGN KEY (instrumento_procedimento_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_opm_instrumento_opm_dominio_sigtap_id FOREIGN KEY (instrumento_opm_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT;


CREATE TABLE procedimento_sigtap_registro (
  id                             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  procedimento_sigtap_id         BIGINT UNSIGNED NOT NULL,
  instrumento_dominio_sigtap_id  BIGINT UNSIGNED NOT NULL COMMENT 'Instrumento de registro',
  complementar                   BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Instrumento complementar, não o principal',
  vigencia_inicio                DATE NOT NULL COMMENT 'Primeiro dia da competência inicial',
  vigencia_fim                   DATE NULL COMMENT 'Último dia da competência final; nulo enquanto vigente',
  versao_fonte                   VARCHAR(30) NOT NULL COMMENT 'Competência ou versão do arquivo oficial carregado',
  criado_em                      DATETIME(3) NOT NULL,
  criado_por                     BIGINT UNSIGNED NULL,
  alterado_em                    DATETIME(3) NULL,
  alterado_por                   BIGINT UNSIGNED NULL,
  versao                         INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_procedimento_sigtap_registro_procedimento_sigtap_id_in_7134fc (procedimento_sigtap_id, instrumento_dominio_sigtap_id, complementar, vigencia_inicio),
  CONSTRAINT ck_procedimento_sigtap_registro_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  KEY ix_procedimento_sigtap_registro_instrumento_dominio_sigtap (instrumento_dominio_sigtap_id)
) COMMENT='Instrumentos de registro (BPA, AIH, APAC, RAAS) principal e complementar de cada procedimento, por competência';
ALTER TABLE procedimento_sigtap_registro
  ADD CONSTRAINT fk_procedimento_sigtap_registro_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_registro_instrumento_dominio_sigtap_id FOREIGN KEY (instrumento_dominio_sigtap_id) REFERENCES dominio_sigtap (id) ON DELETE RESTRICT;


CREATE TABLE procedimento_sigtap_servico (
  id                               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  procedimento_sigtap_id           BIGINT UNSIGNED NOT NULL,
  servico_classificacao_sigtap_id  BIGINT UNSIGNED NOT NULL,
  vigencia_inicio                  DATE NOT NULL COMMENT 'Primeiro dia da competência inicial',
  vigencia_fim                     DATE NULL COMMENT 'Último dia da competência final; nulo enquanto vigente',
  versao_fonte                     VARCHAR(30) NOT NULL COMMENT 'Competência ou versão do arquivo oficial carregado',
  criado_em                        DATETIME(3) NOT NULL,
  criado_por                       BIGINT UNSIGNED NULL,
  alterado_em                      DATETIME(3) NULL,
  alterado_por                     BIGINT UNSIGNED NULL,
  versao                           INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_procedimento_sigtap_servico_procedimento_sigtap_id_ser_335e64 (procedimento_sigtap_id, servico_classificacao_sigtap_id, vigencia_inicio),
  CONSTRAINT ck_procedimento_sigtap_servico_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  KEY ix_procedimento_sigtap_servico_servico_classificacao_sigtap (servico_classificacao_sigtap_id)
) COMMENT='Serviço e classificação exigidos por procedimento, por competência';
ALTER TABLE procedimento_sigtap_servico
  ADD CONSTRAINT fk_procedimento_sigtap_servico_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_procedimento_sigtap_servico_servico_classificacao_sigtap_id FOREIGN KEY (servico_classificacao_sigtap_id) REFERENCES servico_classificacao_sigtap (id) ON DELETE RESTRICT;


CREATE TABLE procedimento_sigtap_valor (
  id                               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  procedimento_sigtap_id           BIGINT UNSIGNED NOT NULL,
  valor_servico_hospitalar         DECIMAL(15,2) NOT NULL DEFAULT 0,
  valor_servico_profissional       DECIMAL(15,2) NOT NULL DEFAULT 0,
  valor_servico_ambulatorial       DECIMAL(15,2) NOT NULL DEFAULT 0,
  valor_profissional_ambulatorial  DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT 'Parte profissional do valor ambulatorial',
  valor_anestesia_ambulatorial     DECIMAL(15,2) NOT NULL DEFAULT 0,
  valor_total_hospitalar           DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT 'Serviço hospitalar mais profissional',
  valor_total_ambulatorial         DECIMAL(15,2) NOT NULL DEFAULT 0,
  vigencia_inicio                  DATE NOT NULL COMMENT 'Primeiro dia da competência inicial',
  vigencia_fim                     DATE NULL COMMENT 'Último dia da competência final; nulo enquanto vigente',
  versao_fonte                     VARCHAR(30) NOT NULL COMMENT 'Competência ou versão do arquivo oficial carregado',
  criado_em                        DATETIME(3) NOT NULL,
  criado_por                       BIGINT UNSIGNED NULL,
  alterado_em                      DATETIME(3) NULL,
  alterado_por                     BIGINT UNSIGNED NULL,
  versao                           INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_procedimento_sigtap_valor_procedimento_sigtap_id_vigen_5216b2 (procedimento_sigtap_id, vigencia_inicio),
  CONSTRAINT ck_procedimento_sigtap_valor_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  CONSTRAINT ck_procedimento_sigtap_valor_valores CHECK (valor_servico_hospitalar >= 0 AND valor_servico_profissional >= 0 AND valor_servico_ambulatorial >= 0 AND valor_profissional_ambulatorial >= 0 AND valor_anestesia_ambulatorial >= 0 AND valor_total_hospitalar >= 0 AND valor_total_ambulatorial >= 0)
) COMMENT='Valores do procedimento por competência (serviço hospitalar, profissional, ambulatorial)';
ALTER TABLE procedimento_sigtap_valor
  ADD CONSTRAINT fk_procedimento_sigtap_valor_procedimento_sigtap_id FOREIGN KEY (procedimento_sigtap_id) REFERENCES procedimento_sigtap (id) ON DELETE RESTRICT;


CREATE TABLE servico_classificacao_sigtap (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo_sigtap_servico    CHAR(3) NOT NULL COMMENT 'Código oficial do serviço especializado',
  descricao_servico        VARCHAR(150) NOT NULL,
  codigo_sigtap_classificacao CHAR(3) NOT NULL COMMENT 'Código oficial da classificação dentro do serviço',
  descricao                VARCHAR(150) NOT NULL COMMENT 'Descrição da classificação',
  vigencia_inicio          DATE NOT NULL COMMENT 'Primeiro dia da competência inicial',
  vigencia_fim             DATE NULL COMMENT 'Último dia da competência final; nulo enquanto vigente',
  versao_fonte             VARCHAR(30) NOT NULL COMMENT 'Competência ou versão da tabela unificada carregada',
  criado_em                DATETIME(3) NOT NULL,
  criado_por               BIGINT UNSIGNED NULL,
  alterado_em              DATETIME(3) NULL,
  alterado_por             BIGINT UNSIGNED NULL,
  versao                   INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_servico_classificacao_sigtap_codigos CHECK (codigo_sigtap_servico REGEXP '^[0-9]{3}$' AND codigo_sigtap_classificacao REGEXP '^[0-9]{3}$'),
  CONSTRAINT ck_servico_classificacao_sigtap_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  UNIQUE KEY uq_servico_classificacao_sigtap_codigo_vigencia (codigo_sigtap_servico, codigo_sigtap_classificacao, vigencia_inicio),
  KEY ix_servico_classificacao_sigtap_vigencia (vigencia_inicio, vigencia_fim)
) COMMENT='Serviços especializados e classificações da tabela unificada, por competência';


CREATE TABLE ocupacao_cbo (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo_cbo       CHAR(6) NOT NULL,
  descricao        VARCHAR(250) NOT NULL,
  familia_cbo      CHAR(4) NULL COMMENT 'Família ocupacional (4 primeiros dígitos)',
  area_saude       BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Ocupação da saúde, aceita em produção e guia',
  aceita_tiss      BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Consta na tabela de ocupações da troca de informação com operadoras',
  ativo            BOOLEAN NOT NULL DEFAULT TRUE,
  vigencia_inicio  DATE NULL,
  vigencia_fim     DATE NULL,
  versao_fonte     VARCHAR(30) NULL COMMENT 'Versão ou data da publicação oficial carregada',
  criado_em        DATETIME(3) NOT NULL,
  criado_por       BIGINT UNSIGNED NULL,
  alterado_em      DATETIME(3) NULL,
  alterado_por     BIGINT UNSIGNED NULL,
  versao           INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_ocupacao_cbo_codigo_cbo (codigo_cbo),
  KEY ix_ocupacao_cbo_descricao (descricao)
) COMMENT='Classificação oficial de ocupações, usada na profissão do paciente e no registro do profissional';


## Leiautes dos arquivos (posição fixa, latin-1)
### rl_excecao_compatibilidade_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_PROCEDIMENTO_RESTRICAO,10,1,10,VARCHAR2
CO_PROCEDIMENTO_PRINCIPAL,10,11,20,VARCHAR2
CO_REGISTRO_PRINCIPAL,2,21,22,VARCHAR2
CO_PROCEDIMENTO_COMPATIVEL,10,23,32,VARCHAR2
CO_REGISTRO_COMPATIVEL,2,33,34,VARCHAR2
TP_COMPATIBILIDADE,1,35,35,VARCHAR2
DT_COMPETENCIA,6,36,41,CHAR

### rl_procedimento_cid_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_PROCEDIMENTO,10,1,10,VARCHAR2
CO_CID,4,11,14,VARCHAR2
ST_PRINCIPAL,1,15,15,CHAR
DT_COMPETENCIA,6,16,21,CHAR

### rl_procedimento_comp_rede_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_PROCEDIMENTO,10,1,10,VARCHAR2
CO_COMPONENTE_REDE,10,11,20,VARCHAR2

### rl_procedimento_compativel_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_PROCEDIMENTO_PRINCIPAL,10,1,10,VARCHAR2
CO_REGISTRO_PRINCIPAL,2,11,12,VARCHAR2
CO_PROCEDIMENTO_COMPATIVEL,10,13,22,VARCHAR2
CO_REGISTRO_COMPATIVEL,2,23,24,VARCHAR2
TP_COMPATIBILIDADE,1,25,25,VARCHAR2
QT_PERMITIDA,4,26,29,NUMBER
DT_COMPETENCIA,6,30,35,CHAR

### rl_procedimento_detalhe_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_PROCEDIMENTO,10,1,10,VARCHAR2
CO_DETALHE,3,11,13,VARCHAR2
DT_COMPETENCIA,6,14,19,CHAR

### rl_procedimento_habilitacao_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_PROCEDIMENTO,10,1,10,VARCHAR2
CO_HABILITACAO,4,11,14,VARCHAR2
NU_GRUPO_HABILITACAO,4,15,18,VARCHAR2
DT_COMPETENCIA,6,19,24,CHAR

### rl_procedimento_incremento_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_PROCEDIMENTO,10,1,10,VARCHAR2
CO_HABILITACAO,4,11,14,VARCHAR2
VL_PERCENTUAL_SH,7,15,21,NUMBER
VL_PERCENTUAL_SA,7,22,28,NUMBER
VL_PERCENTUAL_SP,7,29,35,NUMBER
DT_COMPETENCIA,6,36,41,CHAR

### rl_procedimento_leito_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_PROCEDIMENTO,10,1,10,VARCHAR2
CO_TIPO_LEITO,2,11,12,VARCHAR2
DT_COMPETENCIA,6,13,18,CHAR

### rl_procedimento_modalidade_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_PROCEDIMENTO,10,1,10,VARCHAR2
CO_MODALIDADE,2,11,12,VARCHAR2
DT_COMPETENCIA,6,13,18,CHAR

### rl_procedimento_ocupacao_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_PROCEDIMENTO,10,1,10,VARCHAR2
CO_OCUPACAO,6,11,16,CHAR
DT_COMPETENCIA,6,17,22,CHAR

### rl_procedimento_origem_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_PROCEDIMENTO,10,1,10,VARCHAR2
CO_PROCEDIMENTO_ORIGEM,10,11,20,VARCHAR2
DT_COMPETENCIA,6,21,26,CHAR

### rl_procedimento_registro_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_PROCEDIMENTO,10,1,10,VARCHAR2
CO_REGISTRO,2,11,12,VARCHAR2
DT_COMPETENCIA,6,13,18,CHAR

### rl_procedimento_regra_cond_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_PROCEDIMENTO,10,1,10,VARCHAR2
CO_REGRA_CONDICIONADA,4,11,14,VARCHAR2

### rl_procedimento_renases_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_PROCEDIMENTO,10,1,10,VARCHAR2
CO_RENASES,10,11,20,VARCHAR2

### rl_procedimento_servico_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_PROCEDIMENTO,10,1,10,VARCHAR2
CO_SERVICO,3,11,13,VARCHAR2
CO_CLASSIFICACAO,3,14,16,VARCHAR2
DT_COMPETENCIA,6,17,22,CHAR

### rl_procedimento_sia_sih_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_PROCEDIMENTO,10,1,10,VARCHAR2
CO_PROCEDIMENTO_SIA_SIH,10,11,20,VARCHAR2
TP_PROCEDIMENTO,1,21,21,VARCHAR2
DT_COMPETENCIA,6,22,27,CHAR

### rl_procedimento_tuss_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_PROCEDIMENTO,10,1,10,VARCHAR2
CO_TUSS,10,11,20,VARCHAR2

### tb_cid_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_CID,4,1,4,VARCHAR2
NO_CID,100,5,104,VARCHAR2
TP_AGRAVO,1,105,105,CHAR
TP_SEXO,1,106,106,CHAR
TP_ESTADIO,1,107,107,CHAR
VL_CAMPOS_IRRADIADOS,4,108,111,NUMBER

### tb_componente_rede_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_COMPONENTE_REDE,10,1,10,VARCHAR2
NO_COMPONENTE_REDE,150,11,160,VARCHAR2
CO_REDE_ATENCAO,3,161,163,VARCHAR2

### tb_descricao_detalhe_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_DETALHE,3,1,3,VARCHAR2
DS_DETALHE,4000,4,4003,VARCHAR2
DT_COMPETENCIA,6,4004,4009,CHAR

### tb_descricao_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_PROCEDIMENTO,10,1,10,VARCHAR2
DS_PROCEDIMENTO,4000,11,4010,VARCHAR2
DT_COMPETENCIA,6,4011,4016,CHAR

### tb_detalhe_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_DETALHE,3,1,3,VARCHAR2
NO_DETALHE,100,4,103,VARCHAR2
DT_COMPETENCIA,6,104,109,CHAR

### tb_financiamento_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_FINANCIAMENTO,2,1,2,VARCHAR2
NO_FINANCIAMENTO,100,3,102,VARCHAR2
DT_COMPETENCIA,6,103,108,CHAR

### tb_forma_organizacao_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_GRUPO,2,1,2,VARCHAR2
CO_SUB_GRUPO,2,3,4,VARCHAR2
CO_FORMA_ORGANIZACAO,2,5,6,VARCHAR2
NO_FORMA_ORGANIZACAO,100,7,106,VARCHAR2
DT_COMPETENCIA,6,107,112,CHAR

### tb_grupo_habilitacao_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
NU_GRUPO_HABILITACAO,4,1,4,VARCHAR2
NO_GRUPO_HABILITACAO,20,5,24,VARCHAR2
DS_GRUPO_HABILITACAO,250,25,274,VARCHAR2

### tb_grupo_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_GRUPO,2,1,2,VARCHAR2
NO_GRUPO,100,3,102,VARCHAR2
DT_COMPETENCIA,6,103,108,CHAR

### tb_habilitacao_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_HABILITACAO,4,1,4,VARCHAR2
NO_HABILITACAO,150,5,154,VARCHAR2
DT_COMPETENCIA,6,155,160,CHAR

### tb_modalidade_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_MODALIDADE,2,1,2,VARCHAR2
NO_MODALIDADE,100,3,102,VARCHAR2
DT_COMPETENCIA,6,103,108,CHAR

### tb_ocupacao_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_OCUPACAO,6,1,6,CHAR
NO_OCUPACAO,150,7,156,VARCHAR2

### tb_procedimento_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_PROCEDIMENTO,10,1,10,VARCHAR2
NO_PROCEDIMENTO,250,11,260,VARCHAR2
TP_COMPLEXIDADE,1,261,261,VARCHAR2
TP_SEXO,1,262,262,VARCHAR2
QT_MAXIMA_EXECUCAO,4,263,266,NUMBER
QT_DIAS_PERMANENCIA,4,267,270,NUMBER
QT_PONTOS,4,271,274,NUMBER
VL_IDADE_MINIMA,4,275,278,NUMBER
VL_IDADE_MAXIMA,4,279,282,NUMBER
VL_SH,12,283,294,NUMBER
VL_SA,12,295,306,NUMBER
VL_SP,12,307,318,NUMBER
CO_FINANCIAMENTO,2,319,320,VARCHAR2
CO_RUBRICA,6,321,326,VARCHAR2
QT_TEMPO_PERMANENCIA,4,327,330,NUMBER
DT_COMPETENCIA,6,331,336,CHAR

### tb_rede_atencao_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_REDE_ATENCAO,3,1,3,VARCHAR2
NO_REDE_ATENCAO,50,4,53,VARCHAR2

### tb_registro_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_REGISTRO,2,1,2,VARCHAR2
NO_REGISTRO,50,3,52,VARCHAR2
DT_COMPETENCIA,6,53,58,CHAR

### tb_regra_condicionada_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_REGRA_CONDICIONADA,4,1,4,VARCHAR2
NO_REGRA_CONDICIONADA,150,5,154,VARCHAR2
DS_REGRA_CONDICIONADA,4000,155,4154,VARCHAR2

### tb_renases_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_RENASES,10,1,10,VARCHAR2
NO_RENASES,150,11,160,VARCHAR2

### tb_rubrica_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_RUBRICA,6,1,6,VARCHAR2
NO_RUBRICA,100,7,106,VARCHAR2
DT_COMPETENCIA,6,107,112,CHAR

### tb_servico_classificacao_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_SERVICO,3,1,3,VARCHAR2
CO_CLASSIFICACAO,3,4,6,VARCHAR2
NO_CLASSIFICACAO,150,7,156,VARCHAR2
DT_COMPETENCIA,6,157,162,CHAR

### tb_servico_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_SERVICO,3,1,3,VARCHAR2
NO_SERVICO,120,4,123,VARCHAR2
DT_COMPETENCIA,6,124,129,CHAR

### tb_sia_sih_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_PROCEDIMENTO_SIA_SIH,10,1,10,VARCHAR2
NO_PROCEDIMENTO_SIA_SIH,100,11,110,VARCHAR2
TP_PROCEDIMENTO,1,111,111,VARCHAR2
DT_COMPETENCIA,6,112,117,CHAR

### tb_sub_grupo_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_GRUPO,2,1,2,VARCHAR2
CO_SUB_GRUPO,2,3,4,VARCHAR2
NO_SUB_GRUPO,100,5,104,VARCHAR2
DT_COMPETENCIA,6,105,110,CHAR

### tb_tipo_leito_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_TIPO_LEITO,2,1,2,VARCHAR2
NO_TIPO_LEITO,60,3,62,VARCHAR2
DT_COMPETENCIA,6,63,68,CHAR

### tb_tuss_layout.txt
Coluna,Tamanho,Inicio,Fim,Tipo
CO_TUSS,10,1,10,VARCHAR2
NO_TUSS,450,11,460,VARCHAR2

