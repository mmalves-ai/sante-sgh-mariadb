-- Recepção, emissão dos impressos do atendimento (F3.2, 02-REC linha 35, 24/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho; as regras ficam no domínio e na porta.
--   - Uma linha por emissão (só acréscimo, nunca alterada nem apagada): qual impresso saiu para o atendimento (a
--     ficha, a etiqueta, a pulseira ou um modelo configurado), em que formato, quantas cópias, quem e quando.
--   - sequencia: 1 na primeira emissão do impresso para o atendimento; 2 em diante é reimpressão, que fica
--     registrada com o responsável. alvo_unico junta o impresso e o modelo (o UNIQUE do MariaDB aceita NULL
--     repetido), e garante uma sequência por impresso do atendimento.
--   - resumo_conteudo: o resumo SHA-256 do que foi impresso, para conferir depois o que saiu sem guardar o conteúdo.
CREATE TABLE IF NOT EXISTS atendimento_impresso_emitido (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id       BIGINT UNSIGNED NOT NULL,
  atendimento_id           BIGINT UNSIGNED NOT NULL,
  impresso                 VARCHAR(20) NOT NULL COMMENT 'ficha, etiqueta ou pulseira',
  modelo_ficha_impressa_id BIGINT UNSIGNED NULL COMMENT 'Modelo configurado que saiu; nulo no impresso padrão',
  formato                  VARCHAR(10) NOT NULL,
  copias                   TINYINT UNSIGNED NOT NULL,
  sequencia                SMALLINT UNSIGNED NOT NULL COMMENT '1 na primeira emissão; 2 em diante é reimpressão',
  resumo_conteudo          CHAR(64) NOT NULL COMMENT 'SHA-256 do conteúdo impresso',
  criado_em                DATETIME(3) NOT NULL COMMENT 'Momento da emissão',
  criado_por               BIGINT UNSIGNED NULL COMMENT 'Quem emitiu',
  alterado_em              DATETIME(3) NULL COMMENT 'Sempre nulo: a emissão não se altera',
  alterado_por             BIGINT UNSIGNED NULL,
  versao                   INT UNSIGNED NOT NULL DEFAULT 1,
  alvo_unico               VARCHAR(45) AS (CONCAT_WS(':', impresso, IFNULL(modelo_ficha_impressa_id, 0))) PERSISTENT
    COMMENT 'Auxiliar da unicidade: o impresso e o modelo, com nulo trocado por 0',
  UNIQUE KEY uq_atendimento_impresso_emitido_sequencia (atendimento_id, alvo_unico, sequencia),
  KEY ix_atendimento_impresso_emitido_estabelecimento_id (estabelecimento_id, criado_em),
  KEY ix_atendimento_impresso_emitido_modelo (modelo_ficha_impressa_id),
  KEY ix_atendimento_impresso_emitido_criado_por (criado_por),
  CONSTRAINT ck_atendimento_impresso_emitido_impresso CHECK (impresso IN ('ficha','etiqueta','pulseira')),
  CONSTRAINT ck_atendimento_impresso_emitido_formato CHECK (formato IN ('pdf','zpl')),
  CONSTRAINT ck_atendimento_impresso_emitido_copias CHECK (copias BETWEEN 1 AND 20),
  CONSTRAINT ck_atendimento_impresso_emitido_sequencia CHECK (sequencia >= 1),
  CONSTRAINT ck_atendimento_impresso_emitido_modelo CHECK (modelo_ficha_impressa_id IS NULL OR impresso = 'ficha')
) COMMENT='Cada emissão de impresso do atendimento (ficha, etiqueta, pulseira, modelo configurado), com a reimpressão numerada';
