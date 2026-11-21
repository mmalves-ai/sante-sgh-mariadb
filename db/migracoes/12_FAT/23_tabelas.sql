-- F2.4 (dívida da migração), 3ª etapa, 4ª leva: DDL pedido pelos lotes das portas (p-*), só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v4.md

-- Carga de honorários: os cinco componentes do valor e os vigentes antes da carga, em colunas (o valor é o CH,
-- coeficiente de honorários), e o nome do item como veio no arquivo.
ALTER TABLE carga_tabela_preco_linha
  MODIFY COLUMN valor DECIMAL(19,6) NOT NULL COMMENT 'Valor do item; nas tabelas de honorários, o CH (coeficiente de honorários)',
  ADD COLUMN IF NOT EXISTS nome_item VARCHAR(300) NULL COMMENT 'Nome do item como veio no arquivo' AFTER codigo_item,
  ADD COLUMN IF NOT EXISTS valor_custo_operacional DECIMAL(19,6) NULL AFTER valor,
  ADD COLUMN IF NOT EXISTS valor_filme DECIMAL(19,6) NULL AFTER valor_custo_operacional,
  ADD COLUMN IF NOT EXISTS valor_anestesista DECIMAL(19,6) NULL AFTER valor_filme,
  ADD COLUMN IF NOT EXISTS valor_outros DECIMAL(19,6) NULL AFTER valor_anestesista,
  ADD COLUMN IF NOT EXISTS anterior_valor DECIMAL(19,6) NULL COMMENT 'Vigente antes da carga (nulo: item novo)' AFTER valor_outros,
  ADD COLUMN IF NOT EXISTS anterior_custo_operacional DECIMAL(19,6) NULL AFTER anterior_valor,
  ADD COLUMN IF NOT EXISTS anterior_filme DECIMAL(19,6) NULL AFTER anterior_custo_operacional,
  ADD COLUMN IF NOT EXISTS anterior_anestesista DECIMAL(19,6) NULL AFTER anterior_filme,
  ADD COLUMN IF NOT EXISTS anterior_outros DECIMAL(19,6) NULL AFTER anterior_anestesista,
  DROP CONSTRAINT IF EXISTS ck_carga_tabela_preco_linha_componentes,
  ADD CONSTRAINT ck_carga_tabela_preco_linha_componentes CHECK (IFNULL(valor_custo_operacional,0) >= 0 AND IFNULL(valor_filme,0) >= 0 AND IFNULL(valor_anestesista,0) >= 0 AND IFNULL(valor_outros,0) >= 0 AND IFNULL(anterior_valor,0) >= 0 AND IFNULL(anterior_custo_operacional,0) >= 0 AND IFNULL(anterior_filme,0) >= 0 AND IFNULL(anterior_anestesista,0) >= 0 AND IFNULL(anterior_outros,0) >= 0);

-- Carga: nome e tamanho do arquivo, catálogo e o lote de reajuste que a publicação gerou. As contagens (novo,
-- alterado, igual, removido) saem das linhas, sem coluna redundante.
ALTER TABLE carga_tabela_preco
  ADD COLUMN IF NOT EXISTS arquivo_nome VARCHAR(120) NULL COMMENT 'Nome do arquivo recebido' AFTER fonte,
  ADD COLUMN IF NOT EXISTS arquivo_bytes INT UNSIGNED NULL COMMENT 'Tamanho do arquivo em bytes' AFTER arquivo_nome,
  ADD COLUMN IF NOT EXISTS catalogo VARCHAR(40) NULL COMMENT 'Catálogo da carga (ex.: honorarios, procedimentos)' AFTER arquivo_bytes,
  ADD COLUMN IF NOT EXISTS lote_reajuste_id BIGINT UNSIGNED NULL COMMENT 'Lote de reajuste gerado na publicação' AFTER publicada_por_usuario_id,
  DROP CONSTRAINT IF EXISTS ck_carga_tabela_preco_arquivo_bytes,
  ADD CONSTRAINT ck_carga_tabela_preco_arquivo_bytes CHECK (arquivo_bytes IS NULL OR arquivo_bytes > 0),
  ADD KEY IF NOT EXISTS ix_carga_tabela_preco_lote_reajuste (lote_reajuste_id);

-- Orçamento particular: o item de exame liga direto ao exame.
ALTER TABLE orcamento_particular_item
  ADD COLUMN IF NOT EXISTS exame_id BIGINT UNSIGNED NULL COMMENT 'Exame do item (tipo exame)' AFTER item_faturavel_id,
  DROP CONSTRAINT IF EXISTS ck_orcamento_particular_item_alvo,
  ADD CONSTRAINT ck_orcamento_particular_item_alvo CHECK (item_faturavel_id IS NOT NULL OR exame_id IS NOT NULL OR grupo_faturamento_id IS NOT NULL OR funcao_equipe_cobranca_id IS NOT NULL OR descricao IS NOT NULL),
  ADD KEY IF NOT EXISTS ix_orcamento_particular_item_exame (exame_id);
