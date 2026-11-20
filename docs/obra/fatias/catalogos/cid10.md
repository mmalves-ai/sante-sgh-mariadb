# Fatia do carregador: cid10

Fonte: catalogos/cache/cid10/CID10CSV.zip. Tabelas de destino: terminologia, terminologia_edicao, termo_terminologia, capitulo_cid10, agrupamento_cid10, topografia_tumor, correspondencia_cid_morfologia

CREATE TABLE terminologia (
  id                                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo                               VARCHAR(30) NOT NULL,
  nome                                 VARCHAR(150) NOT NULL,
  sigla                                VARCHAR(20) NULL,
  tipo                                 VARCHAR(30) NOT NULL,
  numero_tabela_tiss                   VARCHAR(5) NULL COMMENT 'Número da tabela no padrão TISS (ex.: 22)',
  orgao_responsavel                    VARCHAR(150) NULL,
  url_fonte                            VARCHAR(500) NULL,
  idioma                               VARCHAR(10) NOT NULL DEFAULT 'pt-BR',
  licenciada                           BOOLEAN NOT NULL DEFAULT FALSE,
  emitir_em_guia                       BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Código da terminologia é impresso na guia',
  modulo_dono                          VARCHAR(10) NULL COMMENT 'Módulo responsável pela manutenção',
  responsavel_usuario_id               BIGINT UNSIGNED NULL,
  edicao_vigente_terminologia_edicao_id BIGINT UNSIGNED NULL,
  ativo                                BOOLEAN NOT NULL DEFAULT TRUE,
  origem                               VARCHAR(20) NOT NULL DEFAULT 'sistema' COMMENT 'Como o registro entrou: sistema, migracao ou integracao',
  criado_em                            DATETIME(3) NOT NULL,
  criado_por                           BIGINT UNSIGNED NULL,
  alterado_em                          DATETIME(3) NULL,
  alterado_por                         BIGINT UNSIGNED NULL,
  versao                               INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em                          DATETIME(3) NULL,
  excluido_por                         BIGINT UNSIGNED NULL,
  CONSTRAINT ck_terminologia_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_terminologia_tipo CHECK (tipo IN ('procedimento','diagnostico','ocupacao','dominio_tiss','dominio_ans','clinica','honorarios','material_medicamento','geografica','outro')),
  UNIQUE KEY uq_terminologia_codigo (codigo),
  UNIQUE KEY uq_terminologia_numero_tiss (numero_tabela_tiss),
  KEY ix_terminologia_responsavel_usuario (responsavel_usuario_id),
  KEY ix_terminologia_edicao_vigente_terminologia_edicao (edicao_vigente_terminologia_edicao_id)
) COMMENT='Terminologia ou tabela de referência mantida (TUSS, CID-10, CBO, tabelas TISS e ANS, CBHPM) com fonte e dono';
ALTER TABLE terminologia
  ADD CONSTRAINT fk_terminologia_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_terminologia_edicao_vigente_terminologia_edicao_id FOREIGN KEY (edicao_vigente_terminologia_edicao_id) REFERENCES terminologia_edicao (id) ON DELETE RESTRICT;


CREATE TABLE terminologia_edicao (
  id                                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  terminologia_id                      BIGINT UNSIGNED NOT NULL,
  operacao                             VARCHAR(20) NOT NULL DEFAULT 'inclusao',
  dados                                JSON NULL COMMENT 'Resumo da carga (contagens, avisos)',
  ocorrido_em                          DATETIME(3) NOT NULL,
  usuario_id                           BIGINT UNSIGNED NULL,
  versao_edicao                        VARCHAR(30) NOT NULL,
  publicada_em                         DATE NULL,
  vigencia_inicio                      DATE NOT NULL,
  vigencia_fim                         DATE NULL,
  situacao_carga                       VARCHAR(20) NOT NULL DEFAULT 'pendente',
  arquivo_id                           BIGINT UNSIGNED NULL COMMENT 'Arquivo oficial carregado',
  hash_sha256                          CHAR(64) NULL,
  total_termos                         INT UNSIGNED NULL,
  termos_incluidos                     INT UNSIGNED NULL,
  termos_alterados                     INT UNSIGNED NULL,
  termos_inativados                    INT UNSIGNED NULL,
  carregada_em                         DATETIME(3) NULL,
  criado_em                            DATETIME(3) NOT NULL,
  criado_por                           BIGINT UNSIGNED NULL,
  alterado_em                          DATETIME(3) NULL,
  alterado_por                         BIGINT UNSIGNED NULL,
  versao                               INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_terminologia_edicao_operacao CHECK (operacao IN ('inclusao','alteracao','exclusao')),
  CONSTRAINT ck_terminologia_edicao_situacao CHECK (situacao_carga IN ('pendente','carregando','carregada','falha','revertida')),
  CONSTRAINT ck_terminologia_edicao_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  UNIQUE KEY uq_terminologia_edicao_versao (terminologia_id, versao_edicao),
  KEY ix_terminologia_edicao_usuario (usuario_id),
  KEY ix_terminologia_edicao_arquivo (arquivo_id)
) COMMENT='Edições publicadas de cada terminologia, com data, versão e situação da carga';
ALTER TABLE terminologia_edicao
  ADD CONSTRAINT fk_terminologia_edicao_terminologia_id FOREIGN KEY (terminologia_id) REFERENCES terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_terminologia_edicao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_terminologia_edicao_arquivo_id FOREIGN KEY (arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;


CREATE TABLE termo_terminologia (
  id                                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  terminologia_id                      BIGINT UNSIGNED NOT NULL,
  codigo_termo                         VARCHAR(40) NOT NULL COMMENT 'Código oficial do termo na terminologia',
  descricao                            VARCHAR(500) NOT NULL,
  descricao_completa                   TEXT NULL,
  nome_leigo                           VARCHAR(300) NULL COMMENT 'Descrição em linguagem do paciente',
  termo_superior_id                    BIGINT UNSIGNED NULL COMMENT 'Termo pai na hierarquia (capítulo, grupo, categoria)',
  nivel                                SMALLINT UNSIGNED NULL,
  sexo_id                              BIGINT UNSIGNED NULL COMMENT 'Sexo ao qual o termo se restringe',
  notificavel                          BOOLEAN NOT NULL DEFAULT FALSE,
  terminologia_edicao_id               BIGINT UNSIGNED NULL COMMENT 'Edição que trouxe a versão atual do termo',
  ativo                                BOOLEAN NOT NULL DEFAULT TRUE,
  vigencia_inicio                      DATE NULL,
  vigencia_fim                         DATE NULL,
  versao_fonte                         VARCHAR(30) NULL,
  criado_em                            DATETIME(3) NOT NULL,
  criado_por                           BIGINT UNSIGNED NULL,
  alterado_em                          DATETIME(3) NULL,
  alterado_por                         BIGINT UNSIGNED NULL,
  versao                               INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_termo_terminologia_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  UNIQUE KEY uq_termo_terminologia_codigo (terminologia_id, codigo_termo),
  KEY ix_termo_terminologia_descricao (terminologia_id, descricao(100)),
  KEY ix_termo_terminologia_termo_superior (termo_superior_id),
  KEY ix_termo_terminologia_sexo (sexo_id),
  KEY ix_termo_terminologia_terminologia_edicao (terminologia_edicao_id)
) COMMENT='Termos de cada terminologia: código, descrição, atributos e vigência;
ALTER TABLE termo_terminologia
  ADD CONSTRAINT fk_termo_terminologia_terminologia_id FOREIGN KEY (terminologia_id) REFERENCES terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_terminologia_termo_superior_id FOREIGN KEY (termo_superior_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_terminologia_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_termo_terminologia_terminologia_edicao_id FOREIGN KEY (terminologia_edicao_id) REFERENCES terminologia_edicao (id) ON DELETE RESTRICT;


CREATE TABLE capitulo_cid10 (
  id                              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo_cid10                    VARCHAR(10) NOT NULL COMMENT 'Número romano oficial do capítulo, ex.: IX',
  numero                          TINYINT UNSIGNED NOT NULL COMMENT 'Número arábico do capítulo, para ordenação',
  codigo_inicial                  VARCHAR(4) NOT NULL,
  codigo_final                    VARCHAR(4) NOT NULL,
  descricao                       VARCHAR(300) NOT NULL,
  descricao_abreviada             VARCHAR(150) NULL,
  vigencia_inicio                 DATE NOT NULL,
  vigencia_fim                    DATE NULL,
  versao_fonte                    VARCHAR(30) NOT NULL,
  criado_em                       DATETIME(3) NOT NULL,
  criado_por                      BIGINT UNSIGNED NULL,
  alterado_em                     DATETIME(3) NULL,
  alterado_por                    BIGINT UNSIGNED NULL,
  versao                          INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_capitulo_cid10_faixa CHECK (codigo_final >= codigo_inicial),
  CONSTRAINT ck_capitulo_cid10_numero CHECK (numero BETWEEN 1 AND 30),
  CONSTRAINT ck_capitulo_cid10_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  UNIQUE KEY uq_capitulo_cid10_codigo_cid10 (codigo_cid10),
  UNIQUE KEY uq_capitulo_cid10_numero (numero),
  KEY ix_capitulo_cid10_faixa (codigo_inicial, codigo_final)
) COMMENT='Capítulos da CID-10 com faixa de códigos';


CREATE TABLE agrupamento_cid10 (
  id                              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  capitulo_cid10_id               BIGINT UNSIGNED NOT NULL,
  pai_agrupamento_cid10_id        BIGINT UNSIGNED NULL COMMENT 'Grupo ao qual o subgrupo pertence',
  nivel                           VARCHAR(30) NOT NULL DEFAULT 'grupo',
  codigo_cid10                    VARCHAR(10) NOT NULL COMMENT 'Faixa oficial do agrupamento, ex.: A00-A09',
  codigo_inicial                  VARCHAR(4) NOT NULL,
  codigo_final                    VARCHAR(4) NOT NULL,
  descricao                       VARCHAR(300) NOT NULL,
  descricao_abreviada             VARCHAR(150) NULL,
  vigencia_inicio                 DATE NOT NULL,
  vigencia_fim                    DATE NULL,
  versao_fonte                    VARCHAR(30) NOT NULL,
  criado_em                       DATETIME(3) NOT NULL,
  criado_por                      BIGINT UNSIGNED NULL,
  alterado_em                     DATETIME(3) NULL,
  alterado_por                    BIGINT UNSIGNED NULL,
  versao                          INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_agrupamento_cid10_nivel CHECK (nivel IN ('grupo','subgrupo')),
  CONSTRAINT ck_agrupamento_cid10_faixa CHECK (codigo_final >= codigo_inicial),
  CONSTRAINT ck_agrupamento_cid10_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  UNIQUE KEY uq_agrupamento_cid10_codigo_cid10 (codigo_cid10),
  KEY ix_agrupamento_cid10_capitulo (capitulo_cid10_id),
  KEY ix_agrupamento_cid10_pai (pai_agrupamento_cid10_id),
  KEY ix_agrupamento_cid10_faixa (codigo_inicial, codigo_final)
) COMMENT='Grupos e subgrupos da CID-10 dentro de cada capítulo';
ALTER TABLE agrupamento_cid10
  ADD CONSTRAINT fk_agrupamento_cid10_capitulo_cid10_id FOREIGN KEY (capitulo_cid10_id) REFERENCES capitulo_cid10 (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_agrupamento_cid10_pai_agrupamento_cid10_id FOREIGN KEY (pai_agrupamento_cid10_id) REFERENCES agrupamento_cid10 (id) ON DELETE RESTRICT;


CREATE TABLE topografia_tumor (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo_cid_o      VARCHAR(10) NOT NULL COMMENT 'Código topográfico da classificação de doenças para oncologia (ex.: C50.9)',
  descricao         VARCHAR(150) NOT NULL,
  categoria         VARCHAR(30) NULL COMMENT 'Agrupamento da localização (categoria de três caracteres)',
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  vigencia_inicio   DATE NULL,
  vigencia_fim      DATE NULL,
  versao_fonte      VARCHAR(30) NULL COMMENT 'Edição da classificação de onde veio o código',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_topografia_tumor_vigencia CHECK (vigencia_fim IS NULL OR vigencia_inicio IS NULL OR vigencia_fim >= vigencia_inicio),
  UNIQUE KEY uq_topografia_tumor_codigo_cid_o (codigo_cid_o)
) COMMENT='Localizações topográficas da classificação internacional de doenças para oncologia, usadas no diagnóstico do tumor';


CREATE TABLE correspondencia_cid_morfologia (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo_cid               VARCHAR(10) NOT NULL COMMENT 'CID-10 da neoplasia',
  codigo_morfologia        VARCHAR(10) NOT NULL COMMENT 'Código morfológico da classificação oncológica (CID-O)',
  cid_termo_terminologia_id BIGINT UNSIGNED NULL,
  morfologia_termo_terminologia_id BIGINT UNSIGNED NULL,
  descricao                VARCHAR(250) NULL,
  vigencia_inicio          DATE NULL,
  vigencia_fim             DATE NULL,
  versao_fonte             VARCHAR(30) NOT NULL,
  criado_em                DATETIME(3) NOT NULL,
  criado_por               BIGINT UNSIGNED NULL,
  alterado_em              DATETIME(3) NULL,
  alterado_por             BIGINT UNSIGNED NULL,
  versao                   INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_correspondencia_cid_morfologia_vigencia CHECK (vigencia_fim IS NULL OR vigencia_inicio IS NULL OR vigencia_fim >= vigencia_inicio),
  UNIQUE KEY uq_correspondencia_cid_morfologia_codigos (codigo_cid, codigo_morfologia),
  KEY ix_correspondencia_cid_morfologia_morfologia (codigo_morfologia),
  KEY ix_correspondencia_cid_morfologia_cid_termo (cid_termo_terminologia_id),
  KEY ix_correspondencia_cid_morfologia_morfologia_termo (morfologia_termo_terminologia_id)
) COMMENT='Morfologias tumorais compatíveis com cada CID de neoplasia, carregadas da classificação oncológica oficial';
ALTER TABLE correspondencia_cid_morfologia
  ADD CONSTRAINT fk_correspondencia_cid_morfologia_cid_termo_terminologia_id FOREIGN KEY (cid_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_correspondencia_cid_morfologia_morfologia_termo_term_4ee8e614 FOREIGN KEY (morfologia_termo_terminologia_id) REFERENCES termo_terminologia (id) ON DELETE RESTRICT;


### CID-10-CATEGORIAS.CSV (cabeçalho e 2 linhas, separador ;)
CAT;CLASSIF;DESCRICAO;DESCRABREV;REFER;EXCLUIDOS;
A00;;Cólera;A00   Colera;;;
A01;;Febres tifóide e paratifóide;A01   Febres tifoide e paratifoide;;;
### CID-10-CAPITULOS.CSV (cabeçalho e 2 linhas, separador ;)
NUMCAP;CATINIC;CATFIM;DESCRICAO;DESCRABREV;
1;A00;B99;Capítulo I - Algumas doenças infecciosas e parasitárias;I.   Algumas doenças infecciosas e parasitárias;
2;C00;D48;Capítulo II - Neoplasias [tumores];II.  Neoplasias (tumores);
### CID-10-GRUPOS.CSV (cabeçalho e 2 linhas, separador ;)
CATINIC;CATFIM;DESCRICAO;DESCRABREV;
A00;A09;Doenças infecciosas intestinais;Doenças infecciosas intestinais;
A15;A19;Tuberculose;Tuberculose;
### CID-10-SUBCATEGORIAS.CSV (cabeçalho e 2 linhas, separador ;)
SUBCAT;CLASSIF;RESTRSEXO;CAUSAOBITO;DESCRICAO;DESCRABREV;REFER;EXCLUIDOS;
A000;;;;Cólera devida a Vibrio cholerae 01, biótipo cholerae;A00.0 Colera dev Vibrio cholerae 01 biot cholerae;;;
A001;;;;Cólera devida a Vibrio cholerae 01, biótipo El Tor;A00.1 Colera dev Vibrio cholerae 01 biot El Tor;;;
### CID-O-CATEGORIAS.CSV (cabeçalho e 2 linhas, separador ;)
CAT;DESCRICAO;REFER;
M8000/0;Neoplasia benigna;;
M8000/1;Neoplasia de comportamento incerto se benigno ou maligno;;
### CID-O-GRUPOS.CSV (cabeçalho e 2 linhas, separador ;)
CATINIC;CATFIM;DESCRICAO;REFER;
M800;M800;Neoplasias SOE;;
M801;M801;Neoplasias epiteliais SOE;;
