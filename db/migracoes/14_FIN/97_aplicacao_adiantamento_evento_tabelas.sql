-- Uso do saldo do adiantamento do paciente como evento (06-FAT linha 39, F3.7, 24/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio (@sgh/dominio-faturamento, conta/adiantamento-paciente.ts)
-- e na operação (apps/api/src/modulos/faturamento/particular-adiantamento-propria.ts).
-- Antes havia uma linha só por adiantamento e conta (ou título): aplicar de novo somava ou reativava a linha estornada e
-- o estorno sumia do extrato. Agora cada aplicação é uma linha nova, numerada por adiantamento; o estorno marca a linha
-- (com quem, quando e o motivo) e nunca é desfeito. Nada é apagado nem reescrito depois de gravado.
ALTER TABLE aplicacao_adiantamento_paciente
  ADD COLUMN IF NOT EXISTS sequencia INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Ordem da aplicação dentro do adiantamento' AFTER adiantamento_paciente_id,
  ADD COLUMN IF NOT EXISTS motivo_estorno VARCHAR(500) NULL COMMENT 'Motivo do estorno da aplicação' AFTER estornado_em,
  ADD COLUMN IF NOT EXISTS estornador_usuario_id BIGINT UNSIGNED NULL COMMENT 'Quem estornou a aplicação' AFTER motivo_estorno;

-- Numera as linhas que já existiam (só as anteriores à sequência: a primeira de cada adiantamento continua 1).
UPDATE aplicacao_adiantamento_paciente x
  JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY adiantamento_paciente_id ORDER BY id) AS rn
          FROM aplicacao_adiantamento_paciente) o ON o.id = x.id
   SET x.sequencia = o.rn
 WHERE x.sequencia = 1 AND o.rn > 1;

ALTER TABLE aplicacao_adiantamento_paciente
  ADD UNIQUE KEY IF NOT EXISTS uq_aplicacao_adiantamento_paciente_sequencia (adiantamento_paciente_id, sequencia),
  ADD KEY IF NOT EXISTS ix_aplicacao_adiantamento_paciente_adiantamento_conta (adiantamento_paciente_id, conta_hospitalar_id),
  ADD KEY IF NOT EXISTS ix_aplicacao_adiantamento_paciente_estornador (estornador_usuario_id);
ALTER TABLE aplicacao_adiantamento_paciente DROP INDEX IF EXISTS uq_aplicacao_adiantamento_paciente_conta;
ALTER TABLE aplicacao_adiantamento_paciente DROP INDEX IF EXISTS uq_aplicacao_adiantamento_paciente_titulo;
ALTER TABLE aplicacao_adiantamento_paciente
  ADD CONSTRAINT IF NOT EXISTS ck_aplicacao_adiantamento_paciente_motivo_estorno CHECK (motivo_estorno IS NULL OR estornado = TRUE);
