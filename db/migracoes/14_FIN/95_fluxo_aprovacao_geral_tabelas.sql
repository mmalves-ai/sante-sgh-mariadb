-- Fluxo de aprovação configurável (07-FIN linha 65, F8, 25/11/2026): só para frente e idempotente (ADR 0002, parte 2).
-- Sem gatilho; a regra fica no domínio (@sgh/dominio-financeiro, fluxo-aprovacao.ts) e na operação
-- (apps/api/src/modulos/financeiro/fluxo-aprovacao-propria.ts).
-- O agrupador (agrupador_aprovacao) dizia o critério (centro de custo, credor...) mas não quais valores entram nele:
-- membro_agrupador_aprovacao guarda cada valor; o membro retirado fica inativo, nunca apagado.
-- O pedido de aprovação passa a saber o fluxo e a etapa em que está, e cada decisão guarda a etapa, a resposta padrão
-- escolhida e o canal (web ou celular), para a trilha completa de quem aprovou o quê, onde e com qual resposta.
CREATE TABLE IF NOT EXISTS membro_agrupador_aprovacao (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  agrupador_aprovacao_id BIGINT UNSIGNED NOT NULL,
  valor_id               BIGINT UNSIGNED NOT NULL COMMENT 'Id do valor do critério (centro de custo, credor, natureza...)',
  ativo                  BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em              DATETIME(3) NOT NULL,
  criado_por             BIGINT UNSIGNED NULL,
  alterado_em            DATETIME(3) NULL,
  alterado_por           BIGINT UNSIGNED NULL,
  versao                 INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_membro_agrupador_aprovacao_valor (agrupador_aprovacao_id, valor_id)
) COMMENT='Valor que pertence ao agrupador de aprovação (o centro de custo, o credor ou a natureza do critério)';

ALTER TABLE pedido_aprovacao
  ADD COLUMN IF NOT EXISTS fluxo_aprovacao_id BIGINT UNSIGNED NULL COMMENT 'Fluxo configurável aplicado ao documento' AFTER alcada_aprovacao_nivel_id,
  ADD COLUMN IF NOT EXISTS etapa_fluxo_aprovacao_id BIGINT UNSIGNED NULL COMMENT 'Etapa do fluxo em que o pedido está agora' AFTER fluxo_aprovacao_id,
  ADD KEY IF NOT EXISTS ix_pedido_aprovacao_fluxo (fluxo_aprovacao_id, situacao),
  ADD KEY IF NOT EXISTS ix_pedido_aprovacao_etapa (etapa_fluxo_aprovacao_id);

ALTER TABLE decisao_aprovacao
  ADD COLUMN IF NOT EXISTS etapa_fluxo_aprovacao_id BIGINT UNSIGNED NULL COMMENT 'Etapa do fluxo em que a decisão foi tomada' AFTER alcada_aprovacao_nivel_id,
  ADD COLUMN IF NOT EXISTS resposta_padrao_aprovacao_id BIGINT UNSIGNED NULL COMMENT 'Resposta padrão escolhida pelo aprovador' AFTER etapa_fluxo_aprovacao_id,
  ADD COLUMN IF NOT EXISTS canal VARCHAR(10) NOT NULL DEFAULT 'web' COMMENT 'Onde a decisão foi tomada: web ou celular' AFTER endereco_ip,
  ADD KEY IF NOT EXISTS ix_decisao_aprovacao_etapa (etapa_fluxo_aprovacao_id),
  ADD KEY IF NOT EXISTS ix_decisao_aprovacao_resposta (resposta_padrao_aprovacao_id);
ALTER TABLE decisao_aprovacao
  ADD CONSTRAINT IF NOT EXISTS ck_decisao_aprovacao_canal CHECK (canal IN ('web','celular'));
