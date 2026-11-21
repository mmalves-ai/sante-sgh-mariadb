-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

ALTER TABLE livro_controlado
  ADD COLUMN IF NOT EXISTS modo_fechamento VARCHAR(20) NULL COMMENT 'Fechamento de conferência ou oficial',
  ADD COLUMN IF NOT EXISTS hash_conteudo CHAR(64) NULL COMMENT 'SHA-256 do conteúdo montado no fechamento',
  ADD COLUMN IF NOT EXISTS conteudo_arquivo_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS guarda_ate DATE NULL COMMENT 'Fim da guarda legal',
  DROP CONSTRAINT IF EXISTS ck_livro_controlado_modo_fechamento,
  ADD CONSTRAINT ck_livro_controlado_modo_fechamento CHECK (modo_fechamento IS NULL OR modo_fechamento IN ('conferencia','oficial')),
  DROP CONSTRAINT IF EXISTS ck_livro_controlado_fechamento_oficial,
  ADD CONSTRAINT ck_livro_controlado_fechamento_oficial CHECK (modo_fechamento IS NULL OR modo_fechamento <> 'oficial' OR (hash_conteudo IS NOT NULL AND conteudo_arquivo_id IS NOT NULL)),
  ADD KEY IF NOT EXISTS ix_livro_controlado_conteudo_arquivo (conteudo_arquivo_id);
ALTER TABLE dispensacao
  MODIFY COLUMN atendimento_id BIGINT UNSIGNED NULL COMMENT 'Nulo só na dispensação ambulatorial',
  MODIFY COLUMN setor_funcional_id BIGINT UNSIGNED NULL COMMENT 'Nulo só na dispensação ambulatorial',
  MODIFY COLUMN centro_custo_id BIGINT UNSIGNED NULL COMMENT 'Nulo só na dispensação ambulatorial',
  ADD COLUMN IF NOT EXISTS receita_controlada_id BIGINT UNSIGNED NULL COMMENT 'Receita apresentada na dispensação ambulatorial',
  DROP CONSTRAINT IF EXISTS ck_dispensacao_tipo,
  ADD CONSTRAINT ck_dispensacao_tipo CHECK (tipo IN ('horario','periodo','avulsa','cirurgica','ambulatorial')),
  DROP CONSTRAINT IF EXISTS ck_dispensacao_prescricao,
  ADD CONSTRAINT ck_dispensacao_prescricao CHECK (tipo IN ('avulsa','cirurgica','ambulatorial') OR prescricao_id IS NOT NULL),
  DROP CONSTRAINT IF EXISTS ck_dispensacao_internacao,
  ADD CONSTRAINT ck_dispensacao_internacao CHECK (tipo = 'ambulatorial' OR (atendimento_id IS NOT NULL AND setor_funcional_id IS NOT NULL AND centro_custo_id IS NOT NULL)),
  DROP CONSTRAINT IF EXISTS ck_dispensacao_ambulatorial,
  ADD CONSTRAINT ck_dispensacao_ambulatorial CHECK (tipo <> 'ambulatorial' OR receita_controlada_id IS NOT NULL OR prescricao_id IS NOT NULL),
  ADD KEY IF NOT EXISTS ix_dispensacao_receita_controlada (receita_controlada_id);

CREATE TABLE conferencia_controlado (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  lancamento_controlado_id BIGINT UNSIGNED NULL,
  documento_tipo VARCHAR(20) NOT NULL,
  documento_estoque_id BIGINT UNSIGNED NOT NULL,
  lote_insumo_id BIGINT UNSIGNED NULL,
  lote_chave BIGINT UNSIGNED AS (IFNULL(lote_insumo_id, 0)) PERSISTENT COMMENT 'Só para a unicidade',
  quantidade_documento DECIMAL(15,4) NOT NULL,
  quantidade_contada DECIMAL(15,4) NOT NULL,
  justificativa VARCHAR(500) NULL,
  conferente_usuario_id BIGINT UNSIGNED NOT NULL,
  conferido_em DATETIME(3) NOT NULL,
  reautenticado_em DATETIME(3) NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_conferencia_controlado_documento_tipo CHECK (documento_tipo IN ('saida','devolucao','perda')),
  CONSTRAINT ck_conferencia_controlado_divergencia CHECK (quantidade_documento = quantidade_contada OR justificativa IS NOT NULL),
  CONSTRAINT ck_conferencia_controlado_quantidades CHECK (quantidade_documento >= 0 AND quantidade_contada >= 0),
  UNIQUE KEY uq_conferencia_controlado_documento (documento_estoque_id, lote_chave),
  KEY ix_conferencia_controlado_estabelecimento (estabelecimento_id),
  KEY ix_conferencia_controlado_lancamento (lancamento_controlado_id),
  KEY ix_conferencia_controlado_lote (lote_insumo_id),
  KEY ix_conferencia_controlado_conferente (conferente_usuario_id)
) COMMENT='Dupla conferência do medicamento controlado num documento de estoque (saída, devolução ou perda), por lote';

CREATE TABLE evento_processo_licitatorio (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  processo_licitatorio_id BIGINT UNSIGNED NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  etapa_anterior VARCHAR(30) NULL,
  etapa_posterior VARCHAR(30) NULL,
  descricao VARCHAR(2000) NOT NULL,
  referencia VARCHAR(80) NULL COMMENT 'Número da emissão do documento',
  prazo DATE NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  ocorrido_em DATETIME(3) NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_evento_processo_licitatorio_tipo CHECK (tipo IN ('avanco','recurso','decisao_recurso','homologacao','encerramento','documento','registro')),
  CONSTRAINT ck_evento_processo_licitatorio_documento CHECK (tipo <> 'documento' OR referencia IS NOT NULL),
  UNIQUE KEY uq_evento_processo_licitatorio_referencia (processo_licitatorio_id, tipo, referencia),
  KEY ix_evento_processo_licitatorio_usuario (usuario_id)
) COMMENT='Histórico do processo licitatório: avanço de etapa, recurso e decisão, homologação, encerramento e documento emitido';

