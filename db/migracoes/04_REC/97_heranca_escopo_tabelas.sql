-- Recepção, herança do atendimento anterior (F3.2, 02-REC linha 31, 24/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho; as regras ficam no domínio e na porta.
--   - escopo_unico: a unicidade de uq_regra_heranca_campo_escopo não valia com escopo nulo (no MariaDB, UNIQUE aceita
--     NULL repetido); a coluna gerada troca o nulo por 0 e garante uma regra por campo em cada escopo.
--   - encerrada_em: "voltar ao padrão do estabelecimento" encerra a regra pessoal sem apagá-la (a trilha guarda quem
--     mudou o quê); a mesma linha volta a valer se a pessoa configurar o campo de novo.
ALTER TABLE regra_heranca_campo
  ADD COLUMN IF NOT EXISTS encerrada_em DATETIME(3) NULL COMMENT 'Regra encerrada (vale a do escopo mais amplo); nunca apagada',
  ADD COLUMN IF NOT EXISTS escopo_unico VARCHAR(120) AS (CONCAT_WS(':', IFNULL(estabelecimento_id, 0),
    IFNULL(categoria_atendimento_id, 0), IFNULL(usuario_id, 0), campo)) PERSISTENT
    COMMENT 'Auxiliar da unicidade: o escopo com nulo trocado por 0',
  ADD UNIQUE KEY IF NOT EXISTS uq_regra_heranca_campo_escopo_unico (escopo_unico);
