-- Produção hospitalar mensal e valor da categoria clínica (F8, 09-AREA linha 87, 25/11/2026). Só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho: as regras ficam no domínio (@sgh/dominio-internacao,
-- producao-hospitalar) e na porta própria (apps/api/src/modulos/adt/producao-hospitalar-propria.ts).
--   - faixa_valor_categoria_clinica: valor da diária de cada categoria clínica por vigência (do estabelecimento ou de
--     todos). A faixa trocada encerra na véspera da nova; nada se apaga.
--   - atendimento_categoria_clinica (12_FAT/01) recebe os períodos do atendimento em cada categoria, com o valor pela
--     faixa vigente em cada dia.
--   - producao_hospitalar_mensal: a apuração do mês (movimento, paciente-dia, leito-dia, ocupação, permanência, giro,
--     intervalo de substituição, mortalidade, pontualidade da alta e valor produzido) pelos conceitos da Portaria MS
--     312/2002, por categoria clínica e o total do hospital (clinica_assistencial_id nulo). Reapurada enquanto aberta;
--     fechada, não muda mais.
CREATE TABLE IF NOT EXISTS faixa_valor_categoria_clinica (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  clinica_assistencial_id  BIGINT UNSIGNED NOT NULL,
  estabelecimento_id       BIGINT UNSIGNED NULL COMMENT 'Nulo: vale para todos os estabelecimentos do cliente',
  vigencia_inicio          DATE NOT NULL,
  vigencia_fim             DATE NULL,
  valor_diaria             DECIMAL(15,2) NOT NULL COMMENT 'Valor de cada dia do paciente na categoria clínica',
  observacao               VARCHAR(400) NULL,
  criado_em                DATETIME(3) NOT NULL,
  criado_por               BIGINT UNSIGNED NULL,
  alterado_em              DATETIME(3) NULL,
  alterado_por             BIGINT UNSIGNED NULL,
  versao                   INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_faixa_valor_categoria_clinica_valor CHECK (valor_diaria >= 0),
  CONSTRAINT ck_faixa_valor_categoria_clinica_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  KEY ix_faixa_valor_categoria_clinica_clinica (clinica_assistencial_id, vigencia_inicio),
  KEY ix_faixa_valor_categoria_clinica_estabelecimento (estabelecimento_id)
) COMMENT='Valor da diária de cada categoria clínica por vigência, usado no valor dos períodos do atendimento';

CREATE TABLE IF NOT EXISTS producao_hospitalar_mensal (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id       BIGINT UNSIGNED NOT NULL,
  competencia              DATE NOT NULL COMMENT 'Primeiro dia do mês apurado',
  clinica_assistencial_id  BIGINT UNSIGNED NULL COMMENT 'Nulo: total do hospital',
  chave_clinica            BIGINT UNSIGNED AS (IFNULL(clinica_assistencial_id, 0)) STORED,
  apurado_ate              DATE NOT NULL COMMENT 'Último dia contado (o mês corrente vai até ontem)',
  leitos_operacionais      INT UNSIGNED NOT NULL,
  entradas                 INT UNSIGNED NOT NULL,
  saidas                   INT UNSIGNED NOT NULL COMMENT 'Altas, transferências externas, óbitos e evasões',
  obitos                   INT UNSIGNED NOT NULL,
  transferencias_externas  INT UNSIGNED NOT NULL,
  paciente_dia             INT UNSIGNED NOT NULL,
  leito_dia                INT UNSIGNED NOT NULL,
  taxa_ocupacao            DECIMAL(7,2) NULL COMMENT 'Paciente-dia sobre leito-dia, em %',
  media_permanencia        DECIMAL(9,2) NULL COMMENT 'Paciente-dia sobre saídas, em dias',
  giro_leito               DECIMAL(9,2) NULL COMMENT 'Saídas por leito operacional no mês (produtividade do leito)',
  intervalo_substituicao   DECIMAL(9,2) NULL COMMENT 'Dias que o leito fica vago entre uma saída e a entrada seguinte',
  taxa_mortalidade         DECIMAL(7,2) NULL COMMENT 'Óbitos sobre saídas, em %',
  saidas_com_previsao      INT UNSIGNED NOT NULL COMMENT 'Saídas que tinham data prevista de alta',
  saidas_no_prazo          INT UNSIGNED NOT NULL COMMENT 'Saídas até a data prevista de alta',
  pontualidade_alta        DECIMAL(7,2) NULL COMMENT 'Saídas no prazo sobre saídas com previsão, em %',
  valor_produzido          DECIMAL(15,2) NOT NULL COMMENT 'Diárias do mês pela faixa vigente da categoria clínica',
  dias_sem_faixa           INT UNSIGNED NOT NULL COMMENT 'Paciente-dia sem faixa de valor vigente (fora do valor)',
  situacao                 VARCHAR(10) NOT NULL DEFAULT 'aberta',
  apurado_em               DATETIME(3) NOT NULL,
  fechado_em               DATETIME(3) NULL,
  fechado_por              BIGINT UNSIGNED NULL,
  criado_em                DATETIME(3) NOT NULL,
  criado_por               BIGINT UNSIGNED NULL,
  alterado_em              DATETIME(3) NULL,
  alterado_por             BIGINT UNSIGNED NULL,
  versao                   INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_producao_hospitalar_mensal_situacao CHECK (situacao IN ('aberta','fechada')),
  CONSTRAINT ck_producao_hospitalar_mensal_fechada CHECK (situacao = 'aberta' OR fechado_em IS NOT NULL),
  CONSTRAINT ck_producao_hospitalar_mensal_competencia CHECK (DAYOFMONTH(competencia) = 1),
  CONSTRAINT ck_producao_hospitalar_mensal_apurado CHECK (apurado_ate >= competencia),
  CONSTRAINT ck_producao_hospitalar_mensal_saidas CHECK (obitos + transferencias_externas <= saidas AND saidas_no_prazo <= saidas_com_previsao AND saidas_com_previsao <= saidas),
  CONSTRAINT ck_producao_hospitalar_mensal_valor CHECK (valor_produzido >= 0),
  UNIQUE KEY uq_producao_hospitalar_mensal (estabelecimento_id, competencia, chave_clinica),
  KEY ix_producao_hospitalar_mensal_clinica (clinica_assistencial_id)
) COMMENT='Produção hospitalar do mês por categoria clínica e do hospital (movimento, produtividade, pontualidade, valor)';
