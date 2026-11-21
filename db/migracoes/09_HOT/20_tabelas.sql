-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

ALTER TABLE solicitacao_copia_prontuario
  ADD COLUMN IF NOT EXISTS pedido_titular_id BIGINT UNSIGNED NULL COMMENT 'Pedido do titular que originou a cópia',
  ADD KEY IF NOT EXISTS ix_solicitacao_copia_prontuario_pedido_titular (pedido_titular_id);
ALTER TABLE preparo_lactario
  ADD COLUMN IF NOT EXISTS conferido_por_usuario_id BIGINT UNSIGNED NULL COMMENT 'Quem conferiu (outra pessoa que não o manipulador)',
  ADD COLUMN IF NOT EXISTS conferido_em DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS etiqueta_emitida_em DATETIME(3) NULL COMMENT 'Primeira emissão da etiqueta',
  DROP CONSTRAINT IF EXISTS ck_preparo_lactario_conferencia,
  ADD CONSTRAINT ck_preparo_lactario_conferencia CHECK ((conferido_em IS NULL) = (conferido_por_usuario_id IS NULL)),
  ADD KEY IF NOT EXISTS ix_preparo_lactario_conferido_por (conferido_por_usuario_id);
ALTER TABLE contrato_servico_terceirizado
  ADD COLUMN IF NOT EXISTS contrato_fornecedor_id BIGINT UNSIGNED NULL COMMENT 'Contrato de suprimentos de origem',
  ADD KEY IF NOT EXISTS ix_contrato_servico_terceirizado_contrato_fornecedor (contrato_fornecedor_id);

CREATE TABLE ato_copia_prontuario (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  solicitacao_copia_prontuario_id BIGINT UNSIGNED NOT NULL,
  ato VARCHAR(20) NOT NULL,
  ato_unico VARCHAR(20) AS (IF(ato = 'geracao', NULL, ato)) PERSISTENT COMMENT 'Só para a unicidade: a geração pode repetir',
  solicitante VARCHAR(30) NULL,
  vinculo VARCHAR(30) NULL,
  prova VARCHAR(40) NULL,
  hash_conteudo CHAR(64) NULL,
  paginas INT UNSIGNED NULL,
  meio VARCHAR(20) NULL,
  recebedor VARCHAR(150) NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  ocorrido_em DATETIME(3) NOT NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_ato_copia_prontuario_ato CHECK (ato IN ('solicitacao','legitimidade','geracao','entrega')),
  CONSTRAINT ck_ato_copia_prontuario_geracao CHECK (ato <> 'geracao' OR (hash_conteudo IS NOT NULL AND paginas IS NOT NULL)),
  UNIQUE KEY uq_ato_copia_prontuario_ato (solicitacao_copia_prontuario_id, ato_unico),
  KEY ix_ato_copia_prontuario_estabelecimento (estabelecimento_id),
  KEY ix_ato_copia_prontuario_usuario (usuario_id),
  CONSTRAINT ck_ato_copia_prontuario_origem CHECK (origem IN ('sistema','migracao','integracao'))
) COMMENT='Ato da cópia de prontuário: solicitação, conferência da legitimidade, geração e entrega';

CREATE TABLE preparo_lactario_evento (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  preparo_lactario_id BIGINT UNSIGNED NOT NULL,
  evento VARCHAR(20) NOT NULL,
  dados_antes LONGTEXT NULL,
  dados_depois LONGTEXT NULL,
  motivo VARCHAR(500) NULL,
  ocorrido_em DATETIME(3) NOT NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_preparo_lactario_evento_evento CHECK (evento IN ('alterado','cancelado','etiqueta_emitida')),
  CONSTRAINT ck_preparo_lactario_evento_motivo CHECK (evento = 'etiqueta_emitida' OR motivo IS NOT NULL),
  CONSTRAINT ck_preparo_lactario_evento_dados CHECK ((dados_antes IS NULL OR JSON_VALID(dados_antes)) AND (dados_depois IS NULL OR JSON_VALID(dados_depois))),
  KEY ix_preparo_lactario_evento_preparo (preparo_lactario_id, ocorrido_em),
  KEY ix_preparo_lactario_evento_usuario (usuario_id)
) COMMENT='Histórico do preparo do lactário: alteração, cancelamento e emissão da etiqueta, com antes e depois';

