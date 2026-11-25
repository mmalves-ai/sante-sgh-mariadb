-- Cadastro, doença crônica declarada pelo paciente (F7, 09-AREA linha 73, 25/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio (errosVulnerabilidade: data e informante).
-- O cadastro nacional pede as condições de saúde referidas pelo próprio cidadão (hipertensão, diabetes, asma...). É
-- declaração do cadastro, com data e informante, e não diagnóstico: o diagnóstico continua na lista de problemas do
-- prontuário. A condição vem do vocabulário de doenças crônicas por CID (condicao_cronica). Encerrada com data, nunca
-- apagada; uma só vigente por condição (a coluna gerada repete o par enquanto a declaração está aberta e viva).
CREATE TABLE IF NOT EXISTS paciente_condicao_cronica (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  paciente_id            BIGINT UNSIGNED NOT NULL,
  condicao_cronica_id    BIGINT UNSIGNED NOT NULL,
  declarada_em           DATE NOT NULL COMMENT 'Data em que a condição foi declarada no cadastro',
  informante_tipo        VARCHAR(30) NOT NULL DEFAULT 'paciente' COMMENT 'Quem informou a condição',
  informante_nome        VARCHAR(150) NULL COMMENT 'Nome de quem informou, quando não é o próprio paciente nem o serviço',
  vigencia_fim           DATE NULL COMMENT 'Data em que a declaração deixou de valer',
  observacao             VARCHAR(500) NULL,
  condicao_vigente       VARCHAR(45)
    AS (IF(vigencia_fim IS NULL AND excluido_em IS NULL, CONCAT(paciente_id, '-', condicao_cronica_id), NULL)) PERSISTENT
    COMMENT 'Paciente e condição enquanto a declaração está vigente; nulo depois, para a unicidade',
  origem                 VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em              DATETIME(3) NOT NULL,
  criado_por             BIGINT UNSIGNED NULL,
  alterado_em            DATETIME(3) NULL,
  alterado_por           BIGINT UNSIGNED NULL,
  versao                 INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em            DATETIME(3) NULL,
  excluido_por           BIGINT UNSIGNED NULL,
  CONSTRAINT ck_paciente_condicao_cronica_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_paciente_condicao_cronica_informante_tipo CHECK (informante_tipo IN ('paciente','responsavel','familiar','profissional','servico_social','outro')),
  CONSTRAINT ck_paciente_condicao_cronica_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= declarada_em),
  UNIQUE KEY uq_paciente_condicao_cronica_paciente_condicao_data (paciente_id, condicao_cronica_id, declarada_em),
  UNIQUE KEY uq_paciente_condicao_cronica_vigente (condicao_vigente),
  KEY ix_paciente_condicao_cronica_condicao (condicao_cronica_id)
) COMMENT='Doenças crônicas declaradas no cadastro do paciente, com data e informante';
