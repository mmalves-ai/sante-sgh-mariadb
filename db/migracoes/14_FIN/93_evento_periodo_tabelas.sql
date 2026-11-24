-- Financeiro, eventos do período financeiro (F3.8, 07-FIN linha 85, 24/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2).
-- Cada fechamento, pedido de reabertura e decisão sobre o pedido (autorizada ou recusada) vira uma linha: quem, quando,
-- a justificativa e quantos movimentos o fechamento contou. O registro do período guarda só o último ciclo; o histórico
-- de todos os ciclos fica aqui, consultável na tela. Nada é apagado nem alterado depois de gravado.
-- A linha é pela competência do estabelecimento (não pelo id do período): o pedido e a decisão se ligam à mesma chave
-- que trava o lançamento.
CREATE TABLE IF NOT EXISTS evento_periodo_financeiro (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id    BIGINT UNSIGNED NOT NULL,
  competencia           DATE NOT NULL COMMENT 'Primeiro dia do mês de competência',
  tipo                  VARCHAR(30) NOT NULL COMMENT 'fechamento, pedido_reabertura, reabertura ou reabertura_recusada',
  usuario_id            BIGINT UNSIGNED NOT NULL COMMENT 'Quem fechou, pediu ou decidiu',
  ocorrido_em           DATETIME(3) NOT NULL,
  justificativa         VARCHAR(500) NULL COMMENT 'Motivo do pedido ou da decisão',
  quantidade_movimentos INT UNSIGNED NULL COMMENT 'Movimentos contados no fechamento',
  origem                VARCHAR(20) NOT NULL DEFAULT 'sistema' COMMENT 'sistema, migracao ou integracao',
  criado_em             DATETIME(3) NOT NULL,
  criado_por            BIGINT UNSIGNED NULL,
  alterado_em           DATETIME(3) NULL,
  alterado_por          BIGINT UNSIGNED NULL,
  versao                INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em           DATETIME(3) NULL,
  excluido_por          BIGINT UNSIGNED NULL,
  CONSTRAINT ck_evento_periodo_financeiro_tipo CHECK (tipo IN ('fechamento','pedido_reabertura','reabertura','reabertura_recusada')),
  CONSTRAINT ck_evento_periodo_financeiro_competencia CHECK (DAYOFMONTH(competencia) = 1),
  CONSTRAINT ck_evento_periodo_financeiro_pedido CHECK (tipo <> 'pedido_reabertura' OR justificativa IS NOT NULL),
  CONSTRAINT ck_evento_periodo_financeiro_fechamento CHECK (tipo <> 'fechamento' OR quantidade_movimentos IS NOT NULL),
  CONSTRAINT ck_evento_periodo_financeiro_origem CHECK (origem IN ('sistema','migracao','integracao')),
  KEY ix_evento_periodo_financeiro_competencia (estabelecimento_id, competencia, id),
  KEY ix_evento_periodo_financeiro_usuario_id (usuario_id)
) COMMENT='Histórico de fechamentos, pedidos e decisões de reabertura do período financeiro';
