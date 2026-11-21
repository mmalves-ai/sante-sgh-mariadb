-- F2.4 (dívida da migração), 3ª etapa, 4ª leva: DDL pedido pelos lotes das portas (p-*), só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v4.md

-- Contrato do convênio: o endereço é o da pessoa jurídica da fonte pagadora (já existia); os dados da nota fiscal
-- (razão social, CNPJ, endereço, telefone, inscrição municipal, IBGE) são os da pessoa jurídica tomadora da nota.
ALTER TABLE fonte_pagadora
  ADD COLUMN IF NOT EXISTS nota_fiscal_pessoa_juridica_id BIGINT UNSIGNED NULL COMMENT 'Pessoa jurídica tomadora da nota fiscal (nula: a própria pessoa jurídica da fonte)' AFTER pessoa_juridica_id,
  ADD KEY IF NOT EXISTS ix_fonte_pagadora_nota_fiscal_pessoa_juridica (nota_fiscal_pessoa_juridica_id);

-- Contatos da fonte pagadora por área.
CREATE TABLE IF NOT EXISTS contato_fonte_pagadora (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fonte_pagadora_id BIGINT UNSIGNED NOT NULL,
  area VARCHAR(30) NOT NULL COMMENT 'convenio, credenciamento, contas_medicas, recurso_glosa ou autorizacao',
  nome VARCHAR(150) NULL COMMENT 'Pessoa de contato',
  telefone VARCHAR(20) NULL,
  email VARCHAR(254) NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_contato_fonte_pagadora_area CHECK (area IN ('convenio','credenciamento','contas_medicas','recurso_glosa','autorizacao')),
  CONSTRAINT ck_contato_fonte_pagadora_preenchido CHECK (nome IS NOT NULL OR telefone IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT ck_contato_fonte_pagadora_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_contato_fonte_pagadora_area (fonte_pagadora_id, area)
) COMMENT='Contato da fonte pagadora por área (convênio, credenciamento, contas médicas, recurso de glosa, autorização)';
