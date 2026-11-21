-- Espelho padrão da base (ADR 0006, itens 3 e 4): banco da plataforma com os catálogos oficiais e licenciados,
-- versionados por edição, no MESMO desenho de tabelas do banco do cliente (o espelho recebe as migrações do
-- cliente e, por cima, estas tabelas de controle). O "criar cliente" leva o espelho a todo cliente novo e o
-- comando tools/db/espelho.py atualizar leva cada edição nova aos clientes existentes. Idempotente.

CREATE TABLE IF NOT EXISTS edicao_espelho (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  catalogo          VARCHAR(40) NOT NULL COMMENT 'Fonte carregada (ex.: ibge, sigtap, brasindice, simpro, cbhpm, cep)',
  tipo              VARCHAR(20) NOT NULL COMMENT 'oficial (fonte pública) ou licenciado (arquivo do fornecedor)',
  edicao            VARCHAR(40) NOT NULL COMMENT 'Edição, competência ou versão da publicação',
  vigencia_inicio   DATE NULL,
  arquivo_nome      VARCHAR(255) NULL COMMENT 'Nome do arquivo do fornecedor (sem caminho)',
  arquivo_sha256    CHAR(64) NULL,
  linhas            JSON NULL COMMENT 'Linhas gravadas por tabela',
  avisos            JSON NULL,
  situacao          VARCHAR(20) NOT NULL DEFAULT 'carregando',
  carregada_em      DATETIME(3) NULL,
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_edicao_espelho_tipo CHECK (tipo IN ('oficial','licenciado')),
  CONSTRAINT ck_edicao_espelho_situacao CHECK (situacao IN ('carregando','carregada','falha')),
  CONSTRAINT ck_edicao_espelho_sha256 CHECK (arquivo_sha256 IS NULL OR arquivo_sha256 REGEXP '^[0-9a-f]{64}$'),
  UNIQUE KEY uq_edicao_espelho_catalogo_edicao (catalogo, edicao)
) COMMENT='Edição de catálogo oficial ou licenciado carregada no espelho padrão da base';

CREATE TABLE IF NOT EXISTS tabela_espelho (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tabela            VARCHAR(64) NOT NULL COMMENT 'Tabela do modelo do cliente que o espelho leva',
  catalogo          VARCHAR(40) NOT NULL COMMENT 'Fonte que a preencheu primeiro',
  tipo              VARCHAR(20) NOT NULL COMMENT 'oficial, licenciado ou semente_migracao (preenchida pelas próprias migrações: copiada igual)',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_tabela_espelho_tipo CHECK (tipo IN ('oficial','licenciado','semente_migracao')),
  UNIQUE KEY uq_tabela_espelho_tabela (tabela)
) COMMENT='Tabelas que o espelho leva ao cliente (manifesto da cópia), com a fonte de cada uma';
