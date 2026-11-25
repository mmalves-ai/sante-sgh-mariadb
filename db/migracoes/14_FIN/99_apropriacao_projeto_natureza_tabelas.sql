-- Projeto como centro de resultado (07-FIN linha 128, C2-107, F8, 25/11/2026): a apropriação ao projeto passa a dizer
-- a natureza (receita ou despesa), a etapa e o título a receber (a receita do projeto). Só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho: a regra fica no domínio (@sgh/dominio-financeiro, projeto-resultado.ts:
-- conferirApropriacao) e na porta (apps/api/src/modulos/orcamento/projeto-resultado-propria.ts).
ALTER TABLE apropriacao_projeto
  ADD COLUMN IF NOT EXISTS natureza VARCHAR(10) NOT NULL DEFAULT 'despesa' COMMENT 'Receita ou despesa do projeto' AFTER tipo_origem,
  ADD COLUMN IF NOT EXISTS etapa_projeto_id BIGINT UNSIGNED NULL COMMENT 'Etapa do projeto que recebe o valor' AFTER projeto_id,
  ADD COLUMN IF NOT EXISTS titulo_receber_id BIGINT UNSIGNED NULL COMMENT 'Título a receber apropriado como receita do projeto' AFTER titulo_pagar_id;

ALTER TABLE apropriacao_projeto
  DROP CONSTRAINT IF EXISTS ck_apropriacao_projeto_tipo_origem,
  DROP CONSTRAINT IF EXISTS ck_apropriacao_projeto_origem_coluna;

ALTER TABLE apropriacao_projeto
  ADD CONSTRAINT ck_apropriacao_projeto_tipo_origem CHECK (tipo_origem IN ('titulo','titulo_receber','lancamento','consumo','contrato')),
  ADD CONSTRAINT ck_apropriacao_projeto_origem_coluna CHECK ((tipo_origem = 'titulo' AND titulo_pagar_id IS NOT NULL) OR (tipo_origem = 'titulo_receber' AND titulo_receber_id IS NOT NULL) OR (tipo_origem = 'lancamento' AND lancamento_contabil_id IS NOT NULL) OR (tipo_origem = 'consumo' AND movimento_estoque_id IS NOT NULL) OR (tipo_origem = 'contrato' AND contrato_fornecedor_id IS NOT NULL)),
  ADD CONSTRAINT IF NOT EXISTS ck_apropriacao_projeto_natureza CHECK (natureza IN ('receita','despesa')),
  ADD CONSTRAINT IF NOT EXISTS ck_apropriacao_projeto_natureza_origem CHECK (tipo_origem = 'lancamento' OR (tipo_origem = 'titulo_receber' AND natureza = 'receita') OR (tipo_origem IN ('titulo','consumo','contrato') AND natureza = 'despesa')),
  ADD CONSTRAINT IF NOT EXISTS ck_apropriacao_projeto_valor CHECK (valor > 0),
  ADD UNIQUE KEY IF NOT EXISTS uq_apropriacao_projeto_titulo_receber (projeto_id, titulo_receber_id),
  ADD KEY IF NOT EXISTS ix_apropriacao_projeto_titulo_receber (titulo_receber_id),
  ADD KEY IF NOT EXISTS ix_apropriacao_projeto_etapa (etapa_projeto_id);
