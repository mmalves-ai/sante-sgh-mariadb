-- NIR (núcleo interno de regulação de leitos): "excluir" a solicitação e a reserva de leito vira cancelamento com
-- motivo, quem e quando (decisão do dono, 23/11/2026; SBIS-26: o registro clínico nunca é apagado). Só para frente
-- e idempotente (ADR 0002, parte 2). Origem: docs/obra/orcamentos/nir-cancelamento.md.

-- O estado da situação passa a morar também na linha da solicitação (estado_situacao), preso à situação pela chave
-- composta (24_chaves.sql, ON UPDATE RESTRICT): assim o CHECK do cancelamento enxerga o estado sem gatilho.
ALTER TABLE situacao_pedido_leito
  ADD UNIQUE KEY IF NOT EXISTS uq_situacao_pedido_leito_id_estado (id, estado);

-- Solicitação de leito: quem cancelou ou rejeitou (o quando e o motivo já existiam) e a cópia do estado.
ALTER TABLE pedido_leito
  ADD COLUMN IF NOT EXISTS cancelado_por_usuario_id BIGINT UNSIGNED NULL COMMENT 'Usuário que cancelou ou rejeitou a solicitação' AFTER motivo_cancelamento,
  ADD COLUMN IF NOT EXISTS estado_situacao VARCHAR(30) NULL COMMENT 'Estado da situação (cópia presa pela chave composta; o CHECK do cancelamento a usa)' AFTER situacao_pedido_leito_id,
  ADD KEY IF NOT EXISTS ix_pedido_leito_cancelado_por_usuario_id (cancelado_por_usuario_id),
  ADD KEY IF NOT EXISTS ix_pedido_leito_situacao_estado (situacao_pedido_leito_id, estado_situacao);

UPDATE pedido_leito pl JOIN situacao_pedido_leito sp ON sp.id = pl.situacao_pedido_leito_id
   SET pl.estado_situacao = sp.estado
 WHERE pl.estado_situacao IS NULL OR pl.estado_situacao <> sp.estado;

-- Linhas anteriores a esta migração (regra registrada no orçamento nir-cancelamento): até 23/11/2026 o cancelamento
-- pelo sistema gravava o quando e o motivo, mas não quem. Quem passa a ser o último que alterou a linha (o
-- cancelamento é final: nada a altera depois), ou quem a criou; o quando que faltar, o da última alteração; o motivo
-- ausente ou curto fica marcado como não registrado. Nada é inventado além disso: a linha sem usuário conhecido faz
-- o CHECK abaixo falhar, e a decisão volta ao dono.
UPDATE pedido_leito pl
   SET pl.data_hora_cancelamento = COALESCE(pl.data_hora_cancelamento, pl.alterado_em, pl.criado_em),
       pl.cancelado_por_usuario_id = COALESCE(pl.cancelado_por_usuario_id,
         (SELECT u.id FROM usuario u WHERE u.id = COALESCE(pl.alterado_por, pl.criado_por))),
       pl.motivo_cancelamento = IF(CHAR_LENGTH(TRIM(COALESCE(pl.motivo_cancelamento, ''))) >= 3, pl.motivo_cancelamento,
         'Motivo não registrado (cancelamento anterior à migração 07_INT/24)')
 WHERE pl.origem = 'sistema' AND pl.estado_situacao IN ('cancelado', 'rejeitado')
   AND (pl.data_hora_cancelamento IS NULL OR pl.cancelado_por_usuario_id IS NULL
        OR CHAR_LENGTH(TRIM(COALESCE(pl.motivo_cancelamento, ''))) < 3);

-- Solicitação: o estado é obrigatório; pelo sistema, cancelada ou rejeitada exige quando, quem e motivo (3+
-- caracteres); fora disso, nenhum dos três. O que veio da migração ou da integração pode não trazer quem.
ALTER TABLE pedido_leito
  MODIFY COLUMN estado_situacao VARCHAR(30) NOT NULL COMMENT 'Estado da situação (cópia presa pela chave composta; o CHECK do cancelamento a usa)',
  DROP CONSTRAINT IF EXISTS ck_pedido_leito_cancelado_por,
  ADD CONSTRAINT ck_pedido_leito_cancelado_por CHECK (cancelado_por_usuario_id IS NULL OR (data_hora_cancelamento IS NOT NULL AND motivo_cancelamento IS NOT NULL)),
  DROP CONSTRAINT IF EXISTS ck_pedido_leito_cancelamento,
  ADD CONSTRAINT ck_pedido_leito_cancelamento CHECK (origem <> 'sistema'
    OR (estado_situacao IN ('cancelado','rejeitado') AND data_hora_cancelamento IS NOT NULL AND cancelado_por_usuario_id IS NOT NULL AND CHAR_LENGTH(TRIM(motivo_cancelamento)) >= 3)
    OR (estado_situacao NOT IN ('cancelado','rejeitado') AND data_hora_cancelamento IS NULL AND motivo_cancelamento IS NULL AND cancelado_por_usuario_id IS NULL));

-- Reserva de leito anterior a esta migração (mesma regra): a cancelada pelo sistema sem quem ou sem motivo.
UPDATE reserva_leito r
   SET r.encerrada_por_usuario_id = COALESCE(r.encerrada_por_usuario_id,
         (SELECT u.id FROM usuario u WHERE u.id = COALESCE(r.alterado_por, r.criado_por))),
       r.motivo_encerramento = IF(CHAR_LENGTH(TRIM(COALESCE(r.motivo_encerramento, ''))) >= 3, r.motivo_encerramento,
         'Motivo não registrado (cancelamento anterior à migração 07_INT/24)')
 WHERE r.situacao = 'cancelada' AND r.origem = 'sistema'
   AND (r.encerrada_por_usuario_id IS NULL OR CHAR_LENGTH(TRIM(COALESCE(r.motivo_encerramento, ''))) < 3);

-- Reserva de leito: o motivo do encerramento cabe os 500 caracteres do cancelamento; a cancelada pelo sistema leva
-- motivo (3+ caracteres), quem e quando (a expirada continua sem usuário: quem a encerra é o vencimento).
ALTER TABLE reserva_leito
  MODIFY COLUMN motivo_encerramento VARCHAR(500) NULL,
  DROP CONSTRAINT IF EXISTS ck_reserva_leito_cancelada,
  ADD CONSTRAINT ck_reserva_leito_cancelada CHECK (situacao <> 'cancelada' OR origem <> 'sistema' OR (encerrada_em IS NOT NULL AND CHAR_LENGTH(TRIM(motivo_encerramento)) >= 3 AND encerrada_por_usuario_id IS NOT NULL));
