-- FAT, lote 08 (F2.2 onda 2; pedidos dos lotes 02-08, 02-12): tabelas e colunas que as portas próprias pedem.
-- Convenções do ADR 0002 (parte 2). Sem FOREIGN KEY aqui (08_chaves.sql).

CREATE TABLE decisao_lancamento_tardio (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  conta_hospitalar_id BIGINT UNSIGNED NOT NULL COMMENT 'Conta já fechada quando o lançamento chegou',
  conta_hospitalar_item_id BIGINT UNSIGNED NULL COMMENT 'Item lançado depois do fechamento, quando já existe',
  atendimento_id BIGINT UNSIGNED NOT NULL,
  lancamento_origem_evento_id BIGINT UNSIGNED NULL COMMENT 'Evento de origem do lançamento (prescrição, dispensação, laudo)',
  chegou_em DATETIME(3) NOT NULL,
  decisao VARCHAR(20) NULL,
  motivo VARCHAR(250) NULL,
  decidido_em DATETIME(3) NULL,
  decidido_por_usuario_id BIGINT UNSIGNED NULL,
  conta_complementar_id BIGINT UNSIGNED NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_decisao_lancamento_tardio_decisao CHECK (decisao IS NULL OR decisao IN ('reabrir','complementar','descartar')),
  CONSTRAINT ck_decisao_lancamento_tardio_decidida CHECK (decisao IS NULL OR (decidido_em IS NOT NULL AND decidido_por_usuario_id IS NOT NULL AND motivo IS NOT NULL)),
  KEY ix_decisao_lancamento_tardio_pendentes (estabelecimento_id, decisao),
  KEY ix_decisao_lancamento_tardio_conta (conta_hospitalar_id),
  KEY ix_decisao_lancamento_tardio_item (conta_hospitalar_item_id),
  KEY ix_decisao_lancamento_tardio_atendimento (atendimento_id),
  KEY ix_decisao_lancamento_tardio_evento (lancamento_origem_evento_id),
  KEY ix_decisao_lancamento_tardio_usuario (decidido_por_usuario_id),
  KEY ix_decisao_lancamento_tardio_complementar (conta_complementar_id)
) COMMENT='Fila do lançamento que chega depois do fechamento da conta e a decisão do faturista';

CREATE TABLE regra_faturabilidade (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  fonte_pagadora_id BIGINT UNSIGNED NOT NULL,
  nome VARCHAR(120) NOT NULL,
  exige VARCHAR(30) NOT NULL COMMENT 'O que a regra exige do item (guia, laudo, autorização...)',
  natureza_conta VARCHAR(20) NULL COMMENT 'Nulo: vale para toda natureza de conta',
  seletor JSON NOT NULL COMMENT 'Grupos de faturamento e itens faturáveis a que a regra se aplica',
  bloqueia_fechamento BOOLEAN NOT NULL DEFAULT TRUE,
  vigencia_inicio DATE NOT NULL,
  vigencia_fim DATE NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_regra_faturabilidade_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  CONSTRAINT ck_regra_faturabilidade_natureza CHECK (natureza_conta IS NULL OR natureza_conta IN ('ambulatorial','pronto_atendimento','externo','internacao','domiciliar')),
  CONSTRAINT ck_regra_faturabilidade_seletor CHECK (JSON_VALID(seletor)),
  UNIQUE KEY uq_regra_faturabilidade_nome (estabelecimento_id, fonte_pagadora_id, nome),
  KEY ix_regra_faturabilidade_fonte_pagadora (fonte_pagadora_id)
) COMMENT='Regra de faturabilidade por fonte pagadora: o que o item precisa para ser cobrado';

CREATE TABLE importacao_tabela_linha (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  importacao_tabela_id BIGINT UNSIGNED NOT NULL,
  numero_linha INT UNSIGNED NOT NULL,
  item_faturavel_id BIGINT UNSIGNED NULL,
  codigo_item VARCHAR(30) NULL,
  descricao VARCHAR(255) NULL,
  valores JSON NULL COMMENT 'Componentes lidos do arquivo',
  valores_vigentes JSON NULL COMMENT 'Componentes vigentes antes da importação',
  resultado VARCHAR(20) NOT NULL,
  comparacao VARCHAR(20) NULL,
  motivo VARCHAR(255) NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_importacao_tabela_linha_resultado CHECK (resultado IN ('valida','erro')),
  CONSTRAINT ck_importacao_tabela_linha_comparacao CHECK (comparacao IS NULL OR comparacao IN ('novo','removido','alterado','igual')),
  CONSTRAINT ck_importacao_tabela_linha_json CHECK ((valores IS NULL OR JSON_VALID(valores)) AND (valores_vigentes IS NULL OR JSON_VALID(valores_vigentes))),
  UNIQUE KEY uq_importacao_tabela_linha (importacao_tabela_id, numero_linha),
  KEY ix_importacao_tabela_linha_item (item_faturavel_id)
) COMMENT='Linha do arquivo de uma carga de tabela de preço, com a validação e a comparação com o vigente';

ALTER TABLE orcamento_particular
  ADD COLUMN urgencia BOOLEAN NOT NULL DEFAULT FALSE AFTER situacao,
  ADD COLUMN exige_garantia_antes BOOLEAN NOT NULL DEFAULT FALSE AFTER urgencia;

ALTER TABLE orcamento_particular_item
  ADD COLUMN descricao VARCHAR(150) NULL COMMENT 'Item livre digitado no orçamento' AFTER tipo_item,
  DROP CONSTRAINT ck_orcamento_particular_item_alvo,
  ADD CONSTRAINT ck_orcamento_particular_item_alvo CHECK (item_faturavel_id IS NOT NULL OR grupo_faturamento_id IS NOT NULL OR funcao_equipe_cobranca_id IS NOT NULL OR descricao IS NOT NULL);
