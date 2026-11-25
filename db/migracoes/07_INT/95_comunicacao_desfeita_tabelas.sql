-- Comunicação à operadora desfeita (C2-070, 06-FAT linha 26, 25/11/2026). Só para frente e idempotente (ADR 0002,
-- parte 2). Sem gatilho: a regra fica no domínio (@sgh/dominio-internacao, comunicacoesAoDesfazer) e na porta própria
-- (apps/api/src/modulos/adt/comunicacao-operadora-propria.ts, `desfazer`).
--   - quando a alta é cancelada ou a internação é excluída, as comunicações atingidas recebem a marca (desfeita_em e
--     o motivo); a que a operadora ainda não recebeu é cancelada, a enviada ou confirmada fica com a retificação
--     pendente (cancelar junto à operadora) até a equipe registrar o cancelamento. Nada é apagado.
--   - a comunicação desfeita não conta como existente: a nova alta é comunicada de novo, com a data corrigida.
ALTER TABLE comunicacao_internacao_operadora
  ADD COLUMN IF NOT EXISTS desfeita_em DATETIME(3) NULL COMMENT 'Quando o evento comunicado foi desfeito (alta cancelada ou internação excluída)' AFTER origem,
  ADD COLUMN IF NOT EXISTS motivo_desfeita VARCHAR(500) NULL COMMENT 'Por que a comunicação deixou de valer' AFTER desfeita_em,
  ADD COLUMN IF NOT EXISTS retificacao_pendente BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'A operadora recebeu a comunicação desfeita: cancelar junto a ela' AFTER motivo_desfeita,
  ADD CONSTRAINT IF NOT EXISTS ck_comunicacao_internacao_operadora_desfeita CHECK ((desfeita_em IS NULL) = (motivo_desfeita IS NULL)),
  ADD CONSTRAINT IF NOT EXISTS ck_comunicacao_internacao_operadora_retificacao CHECK (retificacao_pendente = FALSE OR desfeita_em IS NOT NULL);
