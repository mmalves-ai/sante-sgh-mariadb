-- Itens do lote de laudos SUS (C2-119, 06-SUS linha 57, 25/11/2026): só para frente e idempotente (ADR 0002, parte 2).
-- Sem gatilho; as regras ficam no domínio (dominio-faturamento, sus/laudo-internacao.ts) e na porta.
-- O lote guarda para sempre a lista do que continha: uma linha por laudo incluído (situação do laudo na inclusão e a data
-- do envio ao gestor). O laudo que sai do lote (reenvio corrigido depois de devolvido, ou o lote cancelado) recebe a data
-- e o motivo da retirada; a linha nunca é apagada. `laudo_internacao_sus.lote_laudo_sus_id` aponta só o lote ativo.
CREATE TABLE IF NOT EXISTS item_lote_laudo_sus (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lote_laudo_sus_id        BIGINT UNSIGNED NOT NULL,
  laudo_internacao_sus_id  BIGINT UNSIGNED NOT NULL,
  situacao_na_inclusao     VARCHAR(30) NOT NULL COMMENT 'Situação do laudo quando entrou no lote',
  incluido_em              DATETIME(3) NOT NULL,
  enviado_em               DATETIME(3) NULL COMMENT 'Envio do laudo ao gestor dentro deste lote',
  retirado_em              DATETIME(3) NULL COMMENT 'Saída do laudo do lote (o item fica)',
  motivo_retirada          VARCHAR(30) NULL,
  criado_em                DATETIME(3) NOT NULL,
  criado_por               BIGINT UNSIGNED NULL,
  alterado_em              DATETIME(3) NULL,
  alterado_por             BIGINT UNSIGNED NULL,
  versao                   INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_item_lote_laudo_sus_lote_laudo (lote_laudo_sus_id, laudo_internacao_sus_id),
  KEY ix_item_lote_laudo_sus_laudo (laudo_internacao_sus_id),
  CONSTRAINT ck_item_lote_laudo_sus_motivo_retirada CHECK (motivo_retirada IS NULL OR motivo_retirada IN ('reenvio_corrigido','lote_cancelado')),
  CONSTRAINT ck_item_lote_laudo_sus_retirada CHECK ((retirado_em IS NULL) = (motivo_retirada IS NULL))
) COMMENT='Laudos que cada lote de laudos SUS continha (histórico do lote, nunca apagado)';
