-- Financeiro e contabilidade, de-para da consolidação (F8, 07-FIN linha 127, C2-101, 25/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2).
-- Cada conta contábil de um estabelecimento membro do grupo aponta para uma conta do plano gerencial comum
-- (conta_gerencial_consolidada); a apuração mensal da consolidação soma os saldos por essa ligação. Nada é apagado: a
-- ligação trocada fica inativa e a nova entra.
CREATE TABLE IF NOT EXISTS depara_conta_gerencial (
  id                             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  grupo_consolidacao_id          BIGINT UNSIGNED NOT NULL,
  conta_contabil_id              BIGINT UNSIGNED NOT NULL COMMENT 'Conta do plano do estabelecimento membro',
  conta_gerencial_consolidada_id BIGINT UNSIGNED NOT NULL COMMENT 'Conta do plano gerencial comum',
  ativo                          BOOLEAN NOT NULL DEFAULT TRUE,
  chave_ativa                    BIGINT UNSIGNED AS (CASE WHEN ativo THEN conta_contabil_id END) PERSISTENT COMMENT 'Uma ligação ativa por conta e grupo',
  criado_em                      DATETIME(3) NOT NULL,
  criado_por                     BIGINT UNSIGNED NULL,
  alterado_em                    DATETIME(3) NULL,
  alterado_por                   BIGINT UNSIGNED NULL,
  versao                         INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_depara_conta_gerencial_ativa (grupo_consolidacao_id, chave_ativa),
  KEY ix_depara_conta_gerencial_conta_contabil (conta_contabil_id),
  KEY ix_depara_conta_gerencial_conta_gerencial (conta_gerencial_consolidada_id)
) COMMENT='De-para da conta contábil do estabelecimento para a conta do plano gerencial comum do grupo de consolidação';

-- O saldo consolidado passa a ser do grupo: dois grupos sobre o mesmo plano gerencial comum não se sobrepõem. A chave
-- única nova inclui o grupo (a anterior fica substituída nas chaves; nenhuma linha é apagada).
ALTER TABLE saldo_consolidado_mensal
  ADD COLUMN IF NOT EXISTS grupo_consolidacao_id BIGINT UNSIGNED NULL COMMENT 'Grupo de consolidação do saldo' AFTER id;
