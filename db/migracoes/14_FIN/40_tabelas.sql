-- F4 rodada 5 (ADR 0006, item 4): itens próprios do hospital ao lado do catálogo oficial, na mesma tabela.
-- Código oficial liga pelo código; versão antiga, código local e personalização entram como item do hospital,
-- ativo. O carregador oficial e o espelho padrão da base nunca alteram essas colunas (tools/db/espelho.py).

ALTER TABLE banco
  ADD COLUMN item_hospital BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Item próprio do hospital (não veio da fonte oficial); o carregador oficial não o altera',
  ADD COLUMN motivo_item_hospital VARCHAR(30) NULL COMMENT 'Por que é item do hospital: versao_antiga (código revogado em uso) ou codigo_local',
  ADD COLUMN descricao_hospital VARCHAR(255) NULL COMMENT 'Nome que o hospital usa para o item (personalização; a descrição oficial não muda)',
  ADD COLUMN mantido_ativo_hospital BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Código oficial revogado que o hospital segue usando: ativo para ele',
  ADD CONSTRAINT ck_banco_item_hospital CHECK ((item_hospital AND motivo_item_hospital IN ('versao_antiga','codigo_local')) OR (NOT item_hospital AND motivo_item_hospital IS NULL)),
  ADD KEY ix_banco_item_hospital (item_hospital);

ALTER TABLE banco DROP CONSTRAINT ck_banco_codigo_compensacao;
ALTER TABLE banco ADD CONSTRAINT ck_banco_codigo_compensacao CHECK (item_hospital OR (codigo_compensacao IS NULL OR codigo_compensacao REGEXP '^[0-9]{3}$'));

ALTER TABLE banco DROP CONSTRAINT ck_banco_codigo_ispb;
ALTER TABLE banco ADD CONSTRAINT ck_banco_codigo_ispb CHECK (item_hospital OR (codigo_ispb REGEXP '^[0-9]{8}$'));

ALTER TABLE cfop
  ADD COLUMN item_hospital BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Item próprio do hospital (não veio da fonte oficial); o carregador oficial não o altera',
  ADD COLUMN motivo_item_hospital VARCHAR(30) NULL COMMENT 'Por que é item do hospital: versao_antiga (código revogado em uso) ou codigo_local',
  ADD COLUMN descricao_hospital VARCHAR(255) NULL COMMENT 'Nome que o hospital usa para o item (personalização; a descrição oficial não muda)',
  ADD COLUMN mantido_ativo_hospital BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Código oficial revogado que o hospital segue usando: ativo para ele',
  ADD CONSTRAINT ck_cfop_item_hospital CHECK ((item_hospital AND motivo_item_hospital IN ('versao_antiga','codigo_local')) OR (NOT item_hospital AND motivo_item_hospital IS NULL)),
  ADD KEY ix_cfop_item_hospital (item_hospital);

ALTER TABLE cfop DROP CONSTRAINT ck_cfop_codigo;
ALTER TABLE cfop ADD CONSTRAINT ck_cfop_codigo CHECK (item_hospital OR (codigo_cfop REGEXP '^[1-7][0-9]{3}$'));

ALTER TABLE codigo_fiscal_oficial
  ADD COLUMN item_hospital BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Item próprio do hospital (não veio da fonte oficial); o carregador oficial não o altera',
  ADD COLUMN motivo_item_hospital VARCHAR(30) NULL COMMENT 'Por que é item do hospital: versao_antiga (código revogado em uso) ou codigo_local',
  ADD COLUMN descricao_hospital VARCHAR(255) NULL COMMENT 'Nome que o hospital usa para o item (personalização; a descrição oficial não muda)',
  ADD COLUMN mantido_ativo_hospital BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Código oficial revogado que o hospital segue usando: ativo para ele',
  ADD CONSTRAINT ck_codigo_fiscal_oficial_item_hospital CHECK ((item_hospital AND motivo_item_hospital IN ('versao_antiga','codigo_local')) OR (NOT item_hospital AND motivo_item_hospital IS NULL)),
  ADD KEY ix_codigo_fiscal_oficial_item_hospital (item_hospital);
