-- Plataforma 0003: origem vinculada e fila de execuções do conector (F4, plano L2; ADR 0003 itens 4 a 9).
-- O painel da administração da plataforma vincula o arquivo de origem do cliente e pede Importar/Sincronizar; o
-- motor (conector/) retira as execuções desta fila com SELECT ... FOR UPDATE SKIP LOCKED.
-- Uma execução ativa por cliente: índice único sobre coluna gerada que só vale nos estados ativos (MariaDB não tem
-- índice parcial; NULL não colide). Uma origem ativa por cliente, do mesmo jeito. Sem gatilhos. Idempotente.

CREATE TABLE IF NOT EXISTS cliente_origem (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cliente_id        BIGINT UNSIGNED NOT NULL,
  tipo              VARCHAR(30) NOT NULL DEFAULT 'firebird_arquivo' COMMENT 'firebird_arquivo = arquivo .fdb na pasta autorizada',
  caminho_relativo  VARCHAR(255) NOT NULL COMMENT 'Relativo à pasta autorizada do conector; nunca absoluto',
  tamanho_bytes     BIGINT UNSIGNED NOT NULL,
  sha256            CHAR(64) NOT NULL COMMENT 'Resumo do arquivo no vínculo; o motor confere antes e depois de cada execução',
  modificado_em     DATETIME(6) NOT NULL COMMENT 'mtime do arquivo = horário de corte declarado da imagem',
  ods_versao        SMALLINT UNSIGNED NOT NULL COMMENT 'Versão do formato em disco lida do cabeçalho',
  pagina_bytes      INT UNSIGNED NOT NULL COMMENT 'Tamanho de página lido do cabeçalho',
  vinculado_em      DATETIME(3) NOT NULL,
  vinculado_por     BIGINT UNSIGNED NULL COMMENT 'Administrador da plataforma que vinculou',
  ativo             BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'Só uma origem ativa por cliente; a anterior fica no histórico',
  cliente_ativo     BIGINT UNSIGNED AS (IF(ativo, cliente_id, NULL)) STORED COMMENT 'Trava: uma origem ativa por cliente',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_cliente_origem_cliente_ativo (cliente_ativo),
  KEY ix_cliente_origem_cliente (cliente_id, vinculado_em),
  CONSTRAINT ck_cliente_origem_tipo CHECK (tipo IN ('firebird_arquivo')),
  CONSTRAINT ck_cliente_origem_sha256 CHECK (CAST(sha256 AS BINARY) REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT ck_cliente_origem_caminho CHECK (caminho_relativo NOT LIKE '/%' AND caminho_relativo NOT LIKE '%..%'
                                              AND caminho_relativo <> ''),
  CONSTRAINT fk_cliente_origem_cliente_id FOREIGN KEY (cliente_id) REFERENCES cliente (id) ON DELETE RESTRICT,
  CONSTRAINT fk_cliente_origem_vinculado_por FOREIGN KEY (vinculado_por) REFERENCES administrador_plataforma (id) ON DELETE RESTRICT
) COMMENT='Arquivo de origem vinculado ao cliente para o conector (caminho relativo, tamanho, resumo e cabeçalho)';

CREATE TABLE IF NOT EXISTS conector_execucao (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cliente_id        BIGINT UNSIGNED NOT NULL,
  cliente_origem_id BIGINT UNSIGNED NOT NULL COMMENT 'Origem vinculada no momento do pedido',
  tipo              VARCHAR(20) NOT NULL COMMENT 'importar = carga inicial; sincronizar = diferencial',
  estado            VARCHAR(20) NOT NULL DEFAULT 'fila',
  etapa             VARCHAR(120) NULL COMMENT 'Etapa corrente, em texto curto, sem valores de linha',
  percentual        DECIMAL(5,2) NOT NULL DEFAULT 0,
  contadores        JSON NULL COMMENT 'Só contagens e agregados (tabelas, registros, divergências)',
  versao_mapa       VARCHAR(40) NULL,
  versao_schema     VARCHAR(120) NULL COMMENT 'Última migração do banco do cliente na execução',
  imagem_sha256     CHAR(64) NULL COMMENT 'Resumo do arquivo lido; igual antes e depois',
  motivo_falha      VARCHAR(500) NULL COMMENT 'Motivo técnico, sem valores de linha',
  trabalhador       VARCHAR(80) NULL COMMENT 'Processo do motor que retirou a execução',
  solicitado_em     DATETIME(3) NOT NULL,
  solicitado_por    BIGINT UNSIGNED NULL COMMENT 'Administrador da plataforma que pediu',
  iniciado_em       DATETIME(3) NULL,
  batimento_em      DATETIME(3) NULL COMMENT 'Último sinal de vida do trabalhador',
  concluido_em      DATETIME(3) NULL COMMENT 'Fim (concluída, falhou ou cancelada)',
  cliente_ativo     BIGINT UNSIGNED AS (IF(estado IN ('fila','abrindo','lendo','gravando','conciliando'), cliente_id, NULL)) STORED
                    COMMENT 'Trava: uma execução ativa (na fila ou rodando) por cliente',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_conector_execucao_cliente_ativo (cliente_ativo),
  KEY ix_conector_execucao_estado (estado, id),
  KEY ix_conector_execucao_cliente (cliente_id, solicitado_em),
  CONSTRAINT ck_conector_execucao_tipo CHECK (tipo IN ('importar','sincronizar')),
  CONSTRAINT ck_conector_execucao_estado CHECK (estado IN ('fila','abrindo','lendo','gravando','conciliando',
                                                          'concluida','falhou','cancelada')),
  CONSTRAINT ck_conector_execucao_percentual CHECK (percentual BETWEEN 0 AND 100),
  CONSTRAINT ck_conector_execucao_contadores CHECK (contadores IS NULL OR JSON_VALID(contadores)),
  CONSTRAINT ck_conector_execucao_sha256 CHECK (imagem_sha256 IS NULL OR CAST(imagem_sha256 AS BINARY) REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT ck_conector_execucao_fim CHECK ((estado IN ('concluida','falhou','cancelada')) = (concluido_em IS NOT NULL)),
  CONSTRAINT fk_conector_execucao_cliente_id FOREIGN KEY (cliente_id) REFERENCES cliente (id) ON DELETE RESTRICT,
  CONSTRAINT fk_conector_execucao_cliente_origem_id FOREIGN KEY (cliente_origem_id) REFERENCES cliente_origem (id) ON DELETE RESTRICT,
  CONSTRAINT fk_conector_execucao_solicitado_por FOREIGN KEY (solicitado_por) REFERENCES administrador_plataforma (id) ON DELETE RESTRICT
) COMMENT='Fila e histórico das execuções do conector (Importar/Sincronizar), com estado, etapa e progresso';
