-- Banco de controle da plataforma (ADR 0002, itens 1, 2, 8 e 9). Fica separado dos bancos dos clientes.
-- Um cliente = um banco próprio. O administrador da plataforma pode tudo.

CREATE TABLE IF NOT EXISTS cliente (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo            VARCHAR(40) NOT NULL COMMENT 'Identificador curto, minúsculo, usado no nome do banco',
  nome              VARCHAR(150) NOT NULL,
  documento_cnpj    CHAR(14) NULL,
  situacao          VARCHAR(20) NOT NULL DEFAULT 'implantacao',
  banco_nome        VARCHAR(64) NOT NULL COMMENT 'Nome do banco MariaDB do cliente',
  banco_servidor    VARCHAR(255) NOT NULL DEFAULT 'local' COMMENT 'Servidor do banco; local = o mesmo da plataforma',
  versao_migracao   VARCHAR(40) NULL COMMENT 'Última migração aplicada no banco do cliente',
  origem_dados      VARCHAR(30) NOT NULL DEFAULT 'vazio' COMMENT 'vazio = começa do zero; conector_spdata = migrado pelo conector',
  identidade_visual JSON NULL COMMENT 'Logotipos e cores (única configuração específica de cliente)',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_cliente_situacao CHECK (situacao IN ('implantacao','homologacao','producao','suspenso','encerrado')),
  CONSTRAINT ck_cliente_origem_dados CHECK (origem_dados IN ('vazio','conector_spdata')),
  CONSTRAINT ck_cliente_codigo CHECK (codigo REGEXP '^[a-z][a-z0-9_]{1,39}$'),
  UNIQUE KEY uq_cliente_codigo (codigo),
  UNIQUE KEY uq_cliente_banco (banco_servidor, banco_nome)
) COMMENT='Cliente da plataforma (hospital ou rede), cada um com o seu banco';

CREATE TABLE IF NOT EXISTS administrador_plataforma (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nome              VARCHAR(150) NOT NULL,
  email             VARCHAR(254) NOT NULL,
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_administrador_plataforma_email (email)
) COMMENT='Administrador da plataforma: acesso total a todos os clientes e recursos';

CREATE TABLE IF NOT EXISTS cliente_evento (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cliente_id        BIGINT UNSIGNED NOT NULL,
  tipo              VARCHAR(40) NOT NULL COMMENT 'Ex.: criado, migracao_aplicada, catalogo_carregado, conector_carga, conector_diferencial, virada',
  detalhe           JSON NULL,
  ocorrido_em       DATETIME(3) NOT NULL,
  administrador_plataforma_id BIGINT UNSIGNED NULL,
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  KEY ix_cliente_evento_cliente (cliente_id, ocorrido_em),
  CONSTRAINT fk_cliente_evento_cliente_id FOREIGN KEY (cliente_id) REFERENCES cliente (id) ON DELETE RESTRICT,
  CONSTRAINT fk_cliente_evento_administrador_plataforma_id FOREIGN KEY (administrador_plataforma_id) REFERENCES administrador_plataforma (id) ON DELETE RESTRICT
) COMMENT='Linha do tempo operacional de cada cliente (criação, migrações, cargas, virada)';
