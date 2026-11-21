-- F2.4 (dívida da migração), 2ª volta: DDL pedido pelos lotes, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v2.md

ALTER TABLE evento_processo_licitatorio
  ADD COLUMN IF NOT EXISTS resultado VARCHAR(20) NULL COMMENT 'Resultado do parecer ou da decisão do recurso',
  ADD COLUMN IF NOT EXISTS veiculo_publicacao VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS empresa_fornecedora_id BIGINT UNSIGNED NULL COMMENT 'Licitante que recorreu',
  ADD COLUMN IF NOT EXISTS pedido_compra_id BIGINT UNSIGNED NULL COMMENT 'Pedido de compra ligado ao processo',
  ADD COLUMN IF NOT EXISTS arquivo_id BIGINT UNSIGNED NULL COMMENT 'Documento do parecer, recurso ou ata',
  DROP CONSTRAINT IF EXISTS ck_evento_processo_licitatorio_tipo,
  ADD CONSTRAINT ck_evento_processo_licitatorio_tipo CHECK (tipo IN ('avanco','recurso','decisao_recurso','homologacao','encerramento','documento','registro','parecer','publicacao','esclarecimento','ata','pedido')),
  DROP CONSTRAINT IF EXISTS ck_evento_processo_licitatorio_resultado,
  ADD CONSTRAINT ck_evento_processo_licitatorio_resultado CHECK (resultado IS NULL OR resultado IN ('favoravel','ressalvas','desfavoravel','provido','nao_provido')),
  DROP CONSTRAINT IF EXISTS ck_evento_processo_licitatorio_veiculo,
  ADD CONSTRAINT ck_evento_processo_licitatorio_veiculo CHECK (veiculo_publicacao IS NULL OR veiculo_publicacao IN ('pncp','diario_oficial','jornal','sitio')),
  DROP CONSTRAINT IF EXISTS ck_evento_processo_licitatorio_com_resultado,
  ADD CONSTRAINT ck_evento_processo_licitatorio_com_resultado CHECK (tipo NOT IN ('parecer','decisao_recurso') OR resultado IS NOT NULL),
  DROP CONSTRAINT IF EXISTS ck_evento_processo_licitatorio_recurso,
  ADD CONSTRAINT ck_evento_processo_licitatorio_recurso CHECK (tipo <> 'recurso' OR empresa_fornecedora_id IS NOT NULL),
  DROP CONSTRAINT IF EXISTS ck_evento_processo_licitatorio_pedido,
  ADD CONSTRAINT ck_evento_processo_licitatorio_pedido CHECK (tipo <> 'pedido' OR pedido_compra_id IS NOT NULL),
  DROP CONSTRAINT IF EXISTS ck_evento_processo_licitatorio_publicacao,
  ADD CONSTRAINT ck_evento_processo_licitatorio_publicacao CHECK (tipo <> 'publicacao' OR (veiculo_publicacao IS NOT NULL AND referencia IS NOT NULL)),
  ADD UNIQUE KEY IF NOT EXISTS uq_evento_processo_licitatorio_pedido (processo_licitatorio_id, pedido_compra_id),
  ADD KEY IF NOT EXISTS ix_evento_processo_licitatorio_fornecedor (empresa_fornecedora_id),
  ADD KEY IF NOT EXISTS ix_evento_processo_licitatorio_pedido_compra (pedido_compra_id),
  ADD KEY IF NOT EXISTS ix_evento_processo_licitatorio_arquivo (arquivo_id);
ALTER TABLE processo_licitatorio
  ADD COLUMN IF NOT EXISTS metodo_estimativa VARCHAR(30) NOT NULL DEFAULT 'mediana' COMMENT 'Método da estimativa fixado na abertura',
  ADD COLUMN IF NOT EXISTS julgado_em DATE NULL,
  ADD COLUMN IF NOT EXISTS julgado_por_usuario_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS homologado_em DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS homologado_por_usuario_id BIGINT UNSIGNED NULL,
  DROP CONSTRAINT IF EXISTS ck_processo_licitatorio_metodo_estimativa,
  ADD CONSTRAINT ck_processo_licitatorio_metodo_estimativa CHECK (metodo_estimativa IN ('mediana','media','menor')),
  DROP CONSTRAINT IF EXISTS ck_processo_licitatorio_homologacao,
  ADD CONSTRAINT ck_processo_licitatorio_homologacao CHECK (etapa <> 'homologado' OR homologado_por_usuario_id IS NOT NULL),
  DROP CONSTRAINT IF EXISTS ck_processo_licitatorio_julgamento,
  ADD CONSTRAINT ck_processo_licitatorio_julgamento CHECK (julgado_em IS NULL OR julgado_por_usuario_id IS NOT NULL),
  ADD KEY IF NOT EXISTS ix_processo_licitatorio_julgado_por (julgado_por_usuario_id),
  ADD KEY IF NOT EXISTS ix_processo_licitatorio_homologado_por (homologado_por_usuario_id);
ALTER TABLE processo_licitatorio_item
  ADD COLUMN IF NOT EXISTS valor_unitario_adjudicado DECIMAL(19,6) NULL COMMENT 'Valor do lance ou proposta vencedora, já com o desempate',
  DROP CONSTRAINT IF EXISTS ck_processo_licitatorio_item_adjudicado,
  ADD CONSTRAINT ck_processo_licitatorio_item_adjudicado CHECK (valor_unitario_adjudicado IS NULL OR valor_unitario_adjudicado >= 0);
ALTER TABLE pesquisa_preco_item
  MODIFY COLUMN motivo_desconsideracao VARCHAR(1000) NULL,
  ADD COLUMN IF NOT EXISTS desconsiderado_em DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS desconsiderado_por_usuario_id BIGINT UNSIGNED NULL,
  DROP CONSTRAINT IF EXISTS ck_pesquisa_preco_item_desconsideracao,
  ADD CONSTRAINT ck_pesquisa_preco_item_desconsideracao CHECK (considerado <> 0 OR (motivo_desconsideracao IS NOT NULL AND desconsiderado_por_usuario_id IS NOT NULL)),
  ADD KEY IF NOT EXISTS ix_pesquisa_preco_item_desconsiderado_por (desconsiderado_por_usuario_id);
ALTER TABLE proposta_licitacao_item
  ADD COLUMN IF NOT EXISTS nota_tecnica DECIMAL(5,2) NULL COMMENT 'Nota técnica (técnica e preço, melhor técnica)',
  DROP CONSTRAINT IF EXISTS ck_proposta_licitacao_item_nota_tecnica,
  ADD CONSTRAINT ck_proposta_licitacao_item_nota_tecnica CHECK (nota_tecnica IS NULL OR nota_tecnica BETWEEN 0 AND 100);
