# Fatia do carregador: bcb

Fonte: catalogos/cache/bcb_bancos/ParticipantesSTR.csv. Tabelas de destino: banco

CREATE TABLE banco (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo_compensacao CHAR(3) NULL COMMENT 'Código de compensação (COMPE); nulo para instituição só com ISPB',
  digito_compensacao CHAR(1) NULL,
  codigo_ispb       CHAR(8) NOT NULL COMMENT 'Identificador do sistema de pagamentos brasileiro',
  descricao         VARCHAR(150) NOT NULL COMMENT 'Nome da instituição',
  nome_curto        VARCHAR(60) NULL,
  participa_compe   BOOLEAN NOT NULL DEFAULT TRUE,
  participa_pix     BOOLEAN NOT NULL DEFAULT FALSE,
  vigencia_inicio   DATE NOT NULL,
  vigencia_fim      DATE NULL,
  versao_fonte      VARCHAR(30) NOT NULL COMMENT 'Versão da lista oficial carregada',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_banco_codigo_compensacao CHECK (codigo_compensacao IS NULL OR codigo_compensacao REGEXP '^[0-9]{3}$'),
  CONSTRAINT ck_banco_codigo_ispb CHECK (codigo_ispb REGEXP '^[0-9]{8}$'),
  CONSTRAINT ck_banco_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  UNIQUE KEY uq_banco_codigo_ispb (codigo_ispb),
  UNIQUE KEY uq_banco_codigo_compensacao (codigo_compensacao)
) COMMENT='Instituições financeiras com código de compensação e ISPB';


## Cabeçalho e 2 linhas
ISPB,Nome_Reduzido,Número_Código,Participa_da_Compe,Acesso_Principal,Nome_Extenso,Início_da_Operação
00000000,BCO DO BRASIL S.A.,001,Sim,RSFN,Banco do Brasil S.A.,22/04/2002
00000208,BRB - BCO DE BRASILIA S.A.,070,Sim,RSFN,BRB - BANCO DE BRASILIA S.A.,22/04/2002
