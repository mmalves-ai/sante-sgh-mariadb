-- Controle orçamentário na compra e no pagamento (07-FIN linha 130, C2-112, F8, 25/11/2026): a exceção justificada fica
-- presa à linha do orçamento para a qual foi pedida (a reserva e a nota só usam a exceção da mesma linha e da mesma
-- conta), e o ajuste da nota final que passa da reserva guarda se excedeu o saldo e quem autorizou (a própria sessão no
-- registro ou no alerta confirmado; o aprovador da exceção no bloqueio). Só para frente e idempotente (ADR 0002,
-- parte 2). Sem gatilho: a regra fica no domínio (packages/dominio-financeiro/src/controle-orcamentario.ts) e na porta
-- (apps/api/src/modulos/orcamento/controle-orcamentario-propria.ts).
ALTER TABLE excecao_orcamentaria
  ADD COLUMN IF NOT EXISTS linha_orcamento_id BIGINT UNSIGNED NULL COMMENT 'Linha do orçamento cujo saldo a exceção libera' AFTER centro_custo_id,
  ADD KEY IF NOT EXISTS ix_excecao_orcamentaria_linha (linha_orcamento_id, competencia);

ALTER TABLE ajuste_orcamento_nota
  ADD COLUMN IF NOT EXISTS excedeu_saldo BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'A nota passou da reserva além do saldo orçado',
  ADD COLUMN IF NOT EXISTS autorizador_usuario_id BIGINT UNSIGNED NULL COMMENT 'Quem autorizou o excesso (sessão ou aprovador da exceção)',
  ADD KEY IF NOT EXISTS ix_ajuste_orcamento_nota_autorizador (autorizador_usuario_id);

ALTER TABLE ajuste_orcamento_nota
  ADD CONSTRAINT IF NOT EXISTS ck_ajuste_orcamento_nota_excesso CHECK (excedeu_saldo = FALSE OR autorizador_usuario_id IS NOT NULL);
