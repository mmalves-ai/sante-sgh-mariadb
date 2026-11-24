-- Faturamento, ciclos da competência do convênio (F3.7, 06-FAT linha 32, 24/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio (@sgh/dominio-faturamento, competencia/reabertura.ts) e a
-- gravação nas operações faturamento.fecharCompetencia e faturamento.reabrirCompetencia (apps/api, tiss/operacoes.ts).
--   - ciclo_competencia_fonte_pagadora: cada fechamento (com o retrato: contas, valor apresentado, quem e quando) e
--     cada reabertura (quem, quando, o motivo e as contas já em lote no momento) vira uma linha própria, só incluída.
--     A linha de fechamento_competencia_fonte_pagadora guarda só o estado atual; nenhum retrato ou motivo é
--     sobrescrito. Histórico nunca é apagado.

CREATE TABLE IF NOT EXISTS ciclo_competencia_fonte_pagadora (
  id                                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id                        BIGINT UNSIGNED NOT NULL,
  fechamento_competencia_fonte_pagadora_id  BIGINT UNSIGNED NOT NULL,
  tipo                                      VARCHAR(20) NOT NULL COMMENT 'fechamento ou reabertura',
  ocorrido_em                               DATETIME(3) NOT NULL,
  usuario_id                                BIGINT UNSIGNED NULL,
  quantidade_contas                         INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'No fechamento: contas da competência',
  valor_apresentado                         DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT 'No fechamento: soma das contas',
  contas_em_lote                            INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Na reabertura: contas já em lote',
  valor_em_lote                             DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT 'Na reabertura: valor das contas em lote',
  impacto_confirmado                        BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Na reabertura: quem reabriu confirmou o impacto',
  motivo                                    VARCHAR(250) NULL,
  origem                                    VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em                                 DATETIME(3) NOT NULL,
  criado_por                                BIGINT UNSIGNED NULL,
  alterado_em                               DATETIME(3) NULL,
  alterado_por                              BIGINT UNSIGNED NULL,
  versao                                    INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em                               DATETIME(3) NULL,
  excluido_por                              BIGINT UNSIGNED NULL,
  CONSTRAINT ck_ciclo_competencia_fonte_pagadora_tipo CHECK (tipo IN ('fechamento','reabertura')),
  CONSTRAINT ck_ciclo_competencia_fonte_pagadora_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_ciclo_competencia_fonte_pagadora_motivo CHECK (tipo <> 'reabertura' OR motivo IS NOT NULL),
  CONSTRAINT ck_ciclo_competencia_fonte_pagadora_valores CHECK (valor_apresentado >= 0 AND valor_em_lote >= 0),
  KEY ix_ciclo_competencia_fonte_pagadora_fechamento (fechamento_competencia_fonte_pagadora_id, ocorrido_em),
  KEY ix_ciclo_competencia_fonte_pagadora_estabelecimento (estabelecimento_id),
  KEY ix_ciclo_competencia_fonte_pagadora_usuario (usuario_id)
) COMMENT='Cada fechamento e reabertura da competência do convênio, com o retrato e o motivo (só inclusão)';
