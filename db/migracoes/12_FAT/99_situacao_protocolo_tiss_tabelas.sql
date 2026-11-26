-- Situações do protocolo alinhadas à terminologia TISS do status do protocolo (06-FAT linha 31, F3.7, 25/11/2026,
-- correção da revisão da 12_FAT/99_situacao_protocolo): só para frente e idempotente (ADR 0002, parte 2). Sem gatilho.
-- A carga anterior numerou as situações de 1 a 7 numa lista própria, que não batia com a terminologia: lá 4 é
-- "Encerrado sem pagamento", 5 "Analisado e aguardando liberação para o pagamento", 6 "Pagamento efetuado",
-- 7 "Não localizado", 8 "Aguardando informação complementar", 9 "Cancelado" e 10 "Bloqueio judicial do prestador".
--   - numero_tiss passa a ser o número da terminologia; o código gravado em protocolo_recebimento.situacao não muda
--     para as situações que já existiam (o histórico continua lido pelo código);
--   - as situações da terminologia que faltavam entram (5, 6, 7 e 10), com o código aceito pelo CHECK das três tabelas
--     (o padrão da base, a situação do protocolo e o histórico da situação);
--   - "recusado" não existe na terminologia: fica sem número e inativa (some da escolha e do registro; o histórico que
--     já a usa continua com o nome). Situação ativa tem sempre o número TISS (CHECK).
--   - o nome só muda onde o hospital não o renomeou.
ALTER TABLE situacao_protocolo_recebimento
  MODIFY numero_tiss SMALLINT UNSIGNED NULL
    COMMENT 'Número do status do protocolo na terminologia TISS (1 a 10); nulo só na situação inativa fora da terminologia';

UPDATE situacao_protocolo_recebimento
   SET numero_tiss = NULL, ativo = FALSE, alterado_em = UTC_TIMESTAMP(3), versao = versao + 1
 WHERE codigo = 'recusado' AND (numero_tiss IS NOT NULL OR ativo);
UPDATE situacao_protocolo_recebimento
   SET numero_tiss = 9, alterado_em = UTC_TIMESTAMP(3), versao = versao + 1
 WHERE codigo = 'cancelado' AND numero_tiss <> 9;
UPDATE situacao_protocolo_recebimento
   SET numero_tiss = 8, alterado_em = UTC_TIMESTAMP(3), versao = versao + 1
 WHERE codigo = 'aguardando_informacao' AND numero_tiss <> 8;
UPDATE situacao_protocolo_recebimento
   SET nome = 'Encerrado sem pagamento', alterado_em = UTC_TIMESTAMP(3), versao = versao + 1
 WHERE codigo = 'encerrado' AND nome = 'Encerrado';
UPDATE situacao_protocolo_recebimento
   SET nome = 'Aguardando informação complementar', alterado_em = UTC_TIMESTAMP(3), versao = versao + 1
 WHERE codigo = 'aguardando_informacao' AND nome = 'Aguardando informação';
UPDATE situacao_protocolo_recebimento
   SET ordem = numero_tiss, alterado_em = UTC_TIMESTAMP(3), versao = versao + 1
 WHERE codigo IN ('aguardando_informacao', 'cancelado') AND ordem IN (5, 6);

ALTER TABLE situacao_protocolo_recebimento
  DROP CONSTRAINT IF EXISTS ck_situacao_protocolo_recebimento_codigo,
  DROP CONSTRAINT IF EXISTS ck_situacao_protocolo_recebimento_ativa_tiss;
ALTER TABLE situacao_protocolo_recebimento
  ADD CONSTRAINT ck_situacao_protocolo_recebimento_codigo CHECK (codigo IN ('recebido','em_analise','liberado_pagamento','encerrado','analisado_aguardando_liberacao','pagamento_efetuado','nao_localizado','aguardando_informacao','cancelado','bloqueio_judicial','recusado')),
  ADD CONSTRAINT ck_situacao_protocolo_recebimento_ativa_tiss CHECK (numero_tiss IS NOT NULL OR NOT ativo),
  COMMENT = 'Situações do protocolo de recebimento do lote TISS, numeradas pela terminologia TISS do status do protocolo';

ALTER TABLE protocolo_recebimento DROP CONSTRAINT IF EXISTS ck_protocolo_recebimento_situacao;
ALTER TABLE protocolo_recebimento
  ADD CONSTRAINT ck_protocolo_recebimento_situacao CHECK (situacao IN ('recebido','em_analise','liberado_pagamento','encerrado','analisado_aguardando_liberacao','pagamento_efetuado','nao_localizado','aguardando_informacao','cancelado','bloqueio_judicial','recusado'));

ALTER TABLE protocolo_recebimento_situacao DROP CONSTRAINT IF EXISTS ck_protocolo_recebimento_situacao_situacao;
ALTER TABLE protocolo_recebimento_situacao
  ADD CONSTRAINT ck_protocolo_recebimento_situacao_situacao CHECK (situacao IN ('recebido','em_analise','liberado_pagamento','encerrado','analisado_aguardando_liberacao','pagamento_efetuado','nao_localizado','aguardando_informacao','cancelado','bloqueio_judicial','recusado','sem_resposta'));

INSERT INTO situacao_protocolo_recebimento (codigo, numero_tiss, nome, ordem, ativo, criado_em, versao)
SELECT p.codigo, p.numero_tiss, p.nome, p.numero_tiss, TRUE, UTC_TIMESTAMP(3), 1
  FROM (
    SELECT 'analisado_aguardando_liberacao' AS codigo, 5 AS numero_tiss,
           'Analisado e aguardando liberação para o pagamento' AS nome
    UNION ALL SELECT 'pagamento_efetuado', 6, 'Pagamento efetuado'
    UNION ALL SELECT 'nao_localizado', 7, 'Não localizado'
    UNION ALL SELECT 'bloqueio_judicial', 10, 'Bloqueio judicial do prestador'
  ) p
 WHERE NOT EXISTS (SELECT 1 FROM situacao_protocolo_recebimento s WHERE s.codigo = p.codigo);
