-- F3.0 (motores, conta-admissao): controle dos lançamentos automáticos da conta (diárias por dia de corte e taxas por
-- regra), que dá a idempotência por conta, chave e dia de referência e guarda o estorno. Só para frente; FOREIGN KEY em
-- 45_chaves.sql. Regra de negócio no domínio (packages/dominio-faturamento/src/conta/admissao.ts); nenhum gatilho.
--
-- A chave diz o que foi lançado: "diaria" (a principal do paciente), "diaria:<regra>" (adicional por faixa etária),
-- "diaria-acompanhante" e "taxa:<item da regra de lançamento>". Um só lançamento vigente por conta, chave e dia
-- (coluna vigente + UNIQUE): a apuração repetida não duplica, e o estorno libera o dia para o novo lançamento.
CREATE TABLE IF NOT EXISTS lancamento_automatico_conta (
  id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conta_hospitalar_id       BIGINT UNSIGNED NOT NULL,
  conta_hospitalar_item_id  BIGINT UNSIGNED NOT NULL COMMENT 'Item da conta gerado pelo lançamento',
  chave                     VARCHAR(40) NOT NULL COMMENT 'O que foi lançado: diaria, diaria:<regra>, diaria-acompanhante, taxa:<item da regra>',
  dia_referencia            DATE NOT NULL COMMENT 'Dia de permanência (diária) ou da entrada (taxa de abertura) a que o lançamento se refere',
  categoria_acomodacao_id   BIGINT UNSIGNED NULL COMMENT 'Acomodação ocupada no instante que gerou o lançamento',
  regra_diaria_id           BIGINT UNSIGNED NULL,
  regra_lancamento_item_id  BIGINT UNSIGNED NULL,
  situacao                  VARCHAR(20) NOT NULL DEFAULT 'lancado',
  vigente                   TINYINT AS (IF(situacao = 'lancado', 1, NULL)) PERSISTENT COMMENT 'Um só lançamento vigente por conta, chave e dia',
  estornado_em              DATETIME(3) NULL,
  motivo_estorno            VARCHAR(20) NULL,
  criado_em                 DATETIME(3) NOT NULL,
  criado_por                BIGINT UNSIGNED NULL,
  alterado_em               DATETIME(3) NULL,
  alterado_por              BIGINT UNSIGNED NULL,
  versao                    INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_lancamento_automatico_conta_situacao CHECK (situacao IN ('lancado','estornado')),
  CONSTRAINT ck_lancamento_automatico_conta_estorno CHECK ((situacao = 'estornado') = (estornado_em IS NOT NULL AND motivo_estorno IS NOT NULL)),
  CONSTRAINT ck_lancamento_automatico_conta_motivo CHECK (motivo_estorno IS NULL OR motivo_estorno IN ('troca_acomodacao','alta','regra_alterada')),
  CONSTRAINT ck_lancamento_automatico_conta_regra CHECK ((regra_diaria_id IS NULL) <> (regra_lancamento_item_id IS NULL)),
  CONSTRAINT ck_lancamento_automatico_conta_chave CHECK ((chave LIKE 'diaria%') = (regra_diaria_id IS NOT NULL)),
  UNIQUE KEY uq_lancamento_automatico_conta_vigente (conta_hospitalar_id, chave, dia_referencia, vigente),
  UNIQUE KEY uq_lancamento_automatico_conta_item (conta_hospitalar_item_id),
  KEY ix_lancamento_automatico_conta_categoria_acomodacao_id (categoria_acomodacao_id),
  KEY ix_lancamento_automatico_conta_regra_diaria_id (regra_diaria_id),
  KEY ix_lancamento_automatico_conta_regra_lancamento_item_id (regra_lancamento_item_id)
) COMMENT='Lançamento automático da conta (diária por dia de corte, taxa por regra): idempotência por conta, chave e dia, e estorno';
