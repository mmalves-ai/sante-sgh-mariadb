-- Receita contábil do faturamento: recebido, receita prevista e ocorrências da apuração (06-FAT linha 37, F3.7,
-- 25/11/2026). Só para frente e idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio
-- (@sgh/dominio-faturamento, conta/receita-contabil.ts) e a apuração na API (faturamento/receita-contabil-propria.ts).
--   - lancamento_contabil_receita.tipo_acao passa a aceitar 'previsao' (receita prevista do item lançado, com a conta de
--     receita prevista da regra) e 'recebimento' (o recebido na baixa, da conta de entrada contra o "a receber").
--   - ocorrencia_contabil_receita: o fato que não virou evento (pendência, com o motivo) e o evento contabilizado que
--     diverge do apurado agora (divergência, corrigida só pela reabertura). Uma ocorrência aberta por fato e tipo; a
--     resolvida fica no histórico, nunca apagada.

ALTER TABLE lancamento_contabil_receita DROP CONSTRAINT IF EXISTS ck_lancamento_contabil_receita_tipo_acao;
ALTER TABLE lancamento_contabil_receita
  ADD CONSTRAINT ck_lancamento_contabil_receita_tipo_acao CHECK (tipo_acao IN ('receita','estorno','glosa','recurso','acrescimo','desconto','transferencia','previsao','recebimento'));

CREATE TABLE IF NOT EXISTS ocorrencia_contabil_receita (
  id                              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id              BIGINT UNSIGNED NOT NULL,
  tipo                            VARCHAR(20) NOT NULL COMMENT 'pendencia (o fato não virou evento) ou divergencia (o contabilizado difere do apurado)',
  chave_fato                      VARCHAR(150) NOT NULL COMMENT 'Chave estável do fato do faturamento',
  fato                            VARCHAR(30) NOT NULL,
  conta_hospitalar_id             BIGINT UNSIGNED NULL,
  conta_hospitalar_item_id        BIGINT UNSIGNED NULL,
  lancamento_contabil_receita_id  BIGINT UNSIGNED NULL COMMENT 'Evento contabilizado que diverge do apurado',
  data_referencia                 DATE NULL,
  valor                           DECIMAL(15,2) NULL,
  motivo                          VARCHAR(500) NOT NULL,
  situacao                        VARCHAR(20) NOT NULL DEFAULT 'aberta',
  resolvida_em                    DATETIME(3) NULL,
  chave_viva                      VARCHAR(150) AS (IF(situacao = 'aberta', chave_fato, NULL)) PERSISTENT COMMENT 'Só para a unicidade: uma ocorrência aberta por fato e tipo',
  criado_em                       DATETIME(3) NOT NULL,
  criado_por                      BIGINT UNSIGNED NULL,
  alterado_em                     DATETIME(3) NULL,
  alterado_por                    BIGINT UNSIGNED NULL,
  versao                          INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_ocorrencia_contabil_receita_tipo CHECK (tipo IN ('pendencia','divergencia')),
  CONSTRAINT ck_ocorrencia_contabil_receita_fato CHECK (fato IN ('fechamento','reabertura','glosa','glosa_aceita','recurso_acatado','desconto','previsao','recebimento','recebimento_estornado')),
  CONSTRAINT ck_ocorrencia_contabil_receita_situacao CHECK (situacao IN ('aberta','resolvida')),
  CONSTRAINT ck_ocorrencia_contabil_receita_resolvida CHECK (situacao <> 'resolvida' OR resolvida_em IS NOT NULL),
  CONSTRAINT ck_ocorrencia_contabil_receita_divergencia CHECK (tipo <> 'divergencia' OR lancamento_contabil_receita_id IS NOT NULL),
  UNIQUE KEY uq_ocorrencia_contabil_receita_viva (estabelecimento_id, tipo, chave_viva),
  KEY ix_ocorrencia_contabil_receita_situacao (estabelecimento_id, situacao, tipo),
  KEY ix_ocorrencia_contabil_receita_conta_hospitalar (conta_hospitalar_id),
  KEY ix_ocorrencia_contabil_receita_conta_hospitalar_item (conta_hospitalar_item_id),
  KEY ix_ocorrencia_contabil_receita_lancamento (lancamento_contabil_receita_id)
) COMMENT='Pendências e divergências da apuração da receita contábil do faturamento, com o motivo';
