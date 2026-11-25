-- Situações do protocolo de recebimento do lote TISS no banco (06-FAT linha 31, F3.7, 25/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho.
--   - situacao_protocolo_recebimento: as situações que a tela do protocolo oferece e que a operação
--     faturamento.registrar-protocolo aceita, lidas do banco (antes uma lista fixa no código). O número é o do status
--     do protocolo na terminologia TISS (o que a tela envia); o código é o valor gravado em
--     protocolo_recebimento.situacao, que continua conferido pelo CHECK da tabela. O hospital pode renomear, reordenar
--     ou inativar; inativa some da escolha e deixa de ser aceita no registro, e o histórico guarda o código.
CREATE TABLE IF NOT EXISTS situacao_protocolo_recebimento (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo        VARCHAR(30) NOT NULL COMMENT 'Valor gravado em protocolo_recebimento.situacao',
  numero_tiss   SMALLINT UNSIGNED NOT NULL COMMENT 'Número do status do protocolo na terminologia TISS',
  nome          VARCHAR(80) NOT NULL,
  ordem         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em     DATETIME(3) NOT NULL,
  criado_por    BIGINT UNSIGNED NULL,
  alterado_em   DATETIME(3) NULL,
  alterado_por  BIGINT UNSIGNED NULL,
  versao        INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_situacao_protocolo_recebimento_codigo CHECK (codigo IN ('recebido','em_analise','liberado_pagamento','encerrado','aguardando_informacao','cancelado','recusado')),
  CONSTRAINT ck_situacao_protocolo_recebimento_numero CHECK (numero_tiss BETWEEN 1 AND 99),
  UNIQUE KEY uq_situacao_protocolo_recebimento_codigo (codigo),
  UNIQUE KEY uq_situacao_protocolo_recebimento_numero_tiss (numero_tiss)
) COMMENT='Situações do protocolo de recebimento do lote TISS, com o número do status na terminologia TISS';

INSERT INTO situacao_protocolo_recebimento (codigo, numero_tiss, nome, ordem, ativo, criado_em, versao)
SELECT p.codigo, p.numero_tiss, p.nome, p.ordem, TRUE, UTC_TIMESTAMP(3), 1
  FROM (
    SELECT 'recebido' AS codigo, 1 AS numero_tiss, 'Recebido' AS nome, 1 AS ordem
    UNION ALL SELECT 'em_analise', 2, 'Em análise', 2
    UNION ALL SELECT 'liberado_pagamento', 3, 'Liberado para pagamento', 3
    UNION ALL SELECT 'encerrado', 4, 'Encerrado', 4
    UNION ALL SELECT 'aguardando_informacao', 5, 'Aguardando informação', 5
    UNION ALL SELECT 'cancelado', 6, 'Cancelado', 6
    UNION ALL SELECT 'recusado', 7, 'Recusado', 7
  ) p
 WHERE NOT EXISTS (SELECT 1 FROM situacao_protocolo_recebimento s WHERE s.codigo = p.codigo);
