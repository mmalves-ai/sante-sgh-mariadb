-- Produtividade por meta na remuneração variável (07-FIN linha 157, F8, 25/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho; a regra fica em packages/dominio-repasse/src/remuneracao-variavel.ts e a gravação
-- em apps/api/src/modulos/repasse/remuneracao-variavel-propria.ts.
--   - meta_produtividade_repasse: liga o indicador de produtividade ao profissional, com a forma do prêmio
--     (percentual da produção ou valor fixo), o peso e o evento do lançamento; encerrar grava vigencia_fim;
--   - meta_produtividade_repasse_faixa: as faixas do valor apurado do indicador e o prêmio de cada uma;
--   - apuracao_meta_produtividade: o valor apurado da meta na competência (informado ou copiado do indicador gerencial
--     fechado); a correção cria a nova versão da linha, nunca apaga.

CREATE TABLE IF NOT EXISTS meta_produtividade_repasse (
  id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id          BIGINT UNSIGNED NOT NULL,
  profissional_id             BIGINT UNSIGNED NOT NULL,
  indicador_produtividade_id  BIGINT UNSIGNED NOT NULL,
  centro_custo_id             BIGINT UNSIGNED NULL COMMENT 'Recorte do indicador; nulo: o estabelecimento',
  evento_repasse_id           BIGINT UNSIGNED NULL COMMENT 'Evento do prêmio no lançamento',
  forma_premio                VARCHAR(30) NOT NULL COMMENT 'percentual_producao ou valor_fixo',
  peso                        DECIMAL(7,4) NOT NULL DEFAULT 100 COMMENT 'Percentual do prêmio da faixa que vale para esta meta',
  vigencia_inicio             DATE NOT NULL,
  vigencia_fim                DATE NULL COMMENT 'Nulo: sem data de término',
  criado_em                   DATETIME(3) NOT NULL,
  criado_por                  BIGINT UNSIGNED NULL,
  alterado_em                 DATETIME(3) NULL,
  alterado_por                BIGINT UNSIGNED NULL,
  versao                      INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_meta_produtividade_repasse_vigencia (estabelecimento_id, profissional_id, indicador_produtividade_id, vigencia_inicio),
  CONSTRAINT ck_meta_produtividade_repasse_forma CHECK (forma_premio IN ('percentual_producao','valor_fixo')),
  CONSTRAINT ck_meta_produtividade_repasse_peso CHECK (peso > 0 AND peso <= 100),
  CONSTRAINT ck_meta_produtividade_repasse_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  KEY ix_meta_produtividade_repasse_profissional_id (profissional_id),
  KEY ix_meta_produtividade_repasse_indicador_produtividade_id (indicador_produtividade_id),
  KEY ix_meta_produtividade_repasse_centro_custo_id (centro_custo_id),
  KEY ix_meta_produtividade_repasse_evento_repasse_id (evento_repasse_id)
) COMMENT='Meta de produtividade do profissional: indicador, forma do prêmio, peso e vigência';

CREATE TABLE IF NOT EXISTS meta_produtividade_repasse_faixa (
  id                             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  meta_produtividade_repasse_id  BIGINT UNSIGNED NOT NULL,
  sequencia                      SMALLINT UNSIGNED NOT NULL,
  limite_inicial                 DECIMAL(15,4) NOT NULL COMMENT 'Valor apurado do indicador a partir do qual a faixa vale (inclusive)',
  limite_final                   DECIMAL(15,4) NULL COMMENT 'Até onde a faixa vale (inclusive); nulo: sem teto',
  premio                         DECIMAL(15,4) NOT NULL COMMENT 'Percentual da produção ou valor em reais, pela forma da meta',
  criado_em                      DATETIME(3) NOT NULL,
  criado_por                     BIGINT UNSIGNED NULL,
  alterado_em                    DATETIME(3) NULL,
  alterado_por                   BIGINT UNSIGNED NULL,
  versao                         INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_meta_produtividade_repasse_faixa_sequencia (meta_produtividade_repasse_id, sequencia),
  CONSTRAINT ck_meta_produtividade_repasse_faixa_limites CHECK (limite_final IS NULL OR limite_final >= limite_inicial),
  CONSTRAINT ck_meta_produtividade_repasse_faixa_premio CHECK (premio > 0)
) COMMENT='Faixas do valor apurado da meta de produtividade e o prêmio de cada uma';

CREATE TABLE IF NOT EXISTS apuracao_meta_produtividade (
  id                             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  meta_produtividade_repasse_id  BIGINT UNSIGNED NOT NULL,
  competencia                    DATE NOT NULL COMMENT 'Primeiro dia do mês de competência',
  valor_apurado                  DECIMAL(15,4) NOT NULL,
  fonte                          VARCHAR(20) NOT NULL DEFAULT 'informado' COMMENT 'informado ou indicador (gerencial fechado)',
  observacao                     VARCHAR(500) NULL,
  substituida_em                 DATETIME(3) NULL COMMENT 'Valor corrigido por outra linha; a vigente tem nulo',
  criado_em                      DATETIME(3) NOT NULL,
  criado_por                     BIGINT UNSIGNED NULL,
  alterado_em                    DATETIME(3) NULL,
  alterado_por                   BIGINT UNSIGNED NULL,
  versao                         INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_apuracao_meta_produtividade_competencia CHECK (DAYOFMONTH(competencia) = 1),
  CONSTRAINT ck_apuracao_meta_produtividade_fonte CHECK (fonte IN ('informado','indicador')),
  KEY ix_apuracao_meta_produtividade_meta (meta_produtividade_repasse_id, competencia)
) COMMENT='Valor apurado da meta de produtividade na competência, com o histórico das correções';
