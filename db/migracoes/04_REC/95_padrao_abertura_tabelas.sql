-- Recepção, valores habituais da abertura do atendimento (F3.2, 02-REC linha 31, 24/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho; as regras ficam no domínio e na porta.
--   - Uma linha por escopo: a do estabelecimento (usuario_id nulo) e a de cada usuário. O que a pessoa costuma usar
--     (unidade, centro de custo, convênio, especialidade) preenche a ficha quando o paciente não tem atendimento
--     anterior, ou quando a herança não trouxe o campo. Campo nulo: sem valor habitual nesse escopo.
--   - escopo_unico: no MariaDB o UNIQUE aceita NULL repetido; a coluna gerada troca o nulo por 0 e garante uma linha
--     por escopo. A linha nunca é apagada: limpar o campo grava nulo, e a trilha guarda quem mudou o quê.
CREATE TABLE IF NOT EXISTS padrao_abertura_atendimento (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id      BIGINT UNSIGNED NOT NULL,
  usuario_id              BIGINT UNSIGNED NULL COMMENT 'Valores habituais de um usuário; nulo vale para o estabelecimento',
  unidade_assistencial_id BIGINT UNSIGNED NULL COMMENT 'Unidade habitual',
  centro_custo_id         BIGINT UNSIGNED NULL COMMENT 'Centro de custo habitual',
  fonte_pagadora_id       BIGINT UNSIGNED NULL COMMENT 'Convênio habitual',
  especialidade_medica_id BIGINT UNSIGNED NULL COMMENT 'Especialidade habitual',
  criado_em               DATETIME(3) NOT NULL,
  criado_por              BIGINT UNSIGNED NULL,
  alterado_em             DATETIME(3) NULL,
  alterado_por            BIGINT UNSIGNED NULL,
  versao                  INT UNSIGNED NOT NULL DEFAULT 1,
  escopo_unico            VARCHAR(50) AS (CONCAT_WS(':', estabelecimento_id, IFNULL(usuario_id, 0))) PERSISTENT
    COMMENT 'Auxiliar da unicidade: o escopo com nulo trocado por 0',
  UNIQUE KEY uq_padrao_abertura_atendimento_escopo_unico (escopo_unico),
  KEY ix_padrao_abertura_atendimento_usuario_id (usuario_id),
  KEY ix_padrao_abertura_atendimento_unidade_assistencial_id (unidade_assistencial_id),
  KEY ix_padrao_abertura_atendimento_centro_custo_id (centro_custo_id),
  KEY ix_padrao_abertura_atendimento_fonte_pagadora_id (fonte_pagadora_id),
  KEY ix_padrao_abertura_atendimento_especialidade_medica_id (especialidade_medica_id)
) COMMENT='Valores habituais da abertura do atendimento, do estabelecimento e de cada usuário';
