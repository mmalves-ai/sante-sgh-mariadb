-- Histórico da autorização da internação pela operadora (F3.4, 04-INT linha 68): a guia inicial e cada prorrogação
-- numa linha própria, com senha, diárias, período de validade e quem autorizou na operadora. A internação continua
-- com o retrato da guia vigente; o histórico nunca é sobrescrito nem apagado. Só para frente e idempotente
-- (ADR 0002, parte 2). Origem: docs/fases/fichas/F3.4-internacao-cc.md.
CREATE TABLE IF NOT EXISTS guia_internacao (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  internacao_id         BIGINT UNSIGNED NOT NULL,
  conta_hospitalar_id   BIGINT UNSIGNED NULL COMMENT 'Conta (parcial) da internação a que a guia pertence',
  sequencia             SMALLINT UNSIGNED NOT NULL,
  tipo                  VARCHAR(20) NOT NULL COMMENT 'inicial ou prorrogacao',
  numero_guia           VARCHAR(20) NOT NULL,
  senha                 VARCHAR(20) NULL,
  diarias_autorizadas   SMALLINT UNSIGNED NOT NULL,
  inicio_validade       DATE NOT NULL,
  fim_validade          DATE NOT NULL,
  autorizador_nome      VARCHAR(150) NULL COMMENT 'Quem autorizou na operadora',
  observacao            VARCHAR(400) NULL,
  origem                VARCHAR(20) NOT NULL DEFAULT 'sistema' COMMENT 'sistema, migracao ou integracao',
  criado_em             DATETIME(3) NOT NULL,
  criado_por            BIGINT UNSIGNED NULL,
  alterado_em           DATETIME(3) NULL,
  alterado_por          BIGINT UNSIGNED NULL,
  versao                INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em           DATETIME(3) NULL,
  excluido_por          BIGINT UNSIGNED NULL,
  CONSTRAINT ck_guia_internacao_tipo CHECK (tipo IN ('inicial','prorrogacao')),
  CONSTRAINT ck_guia_internacao_diarias CHECK (diarias_autorizadas > 0),
  CONSTRAINT ck_guia_internacao_validade CHECK (fim_validade >= inicio_validade),
  CONSTRAINT ck_guia_internacao_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_guia_internacao_internacao_sequencia (internacao_id, sequencia),
  KEY ix_guia_internacao_conta_hospitalar (conta_hospitalar_id)
) COMMENT='Guia inicial e prorrogações da autorização da internação, com validade e quem autorizou';

-- Correção da guia sem linha nova (revisão da F3.4): o motivo da última correção fica na linha; o antes e o depois
-- de cada correção ficam na trilha (a versão muda a cada uma).
ALTER TABLE guia_internacao
  ADD COLUMN IF NOT EXISTS motivo_retificacao VARCHAR(400) NULL COMMENT 'Motivo da última correção da guia';

-- Diagnósticos da internação (04-INT linha 67): um principal vigente só (o anterior fica marcado como substituído
-- pelo novo) e a retirada do lançado por engano com o motivo (exclusão lógica; o registro nunca é apagado).
ALTER TABLE diagnostico_internacao
  ADD COLUMN IF NOT EXISTS substituido_em DATETIME(3) NULL COMMENT 'Quando outro principal tomou o lugar deste',
  ADD COLUMN IF NOT EXISTS substituido_por_diagnostico_id BIGINT UNSIGNED NULL COMMENT 'Diagnóstico principal que substituiu este',
  ADD COLUMN IF NOT EXISTS motivo_retirada VARCHAR(400) NULL COMMENT 'Motivo da retirada do diagnóstico lançado por engano';
ALTER TABLE diagnostico_internacao
  ADD KEY IF NOT EXISTS ix_diagnostico_internacao_substituido_por_diagnostico (substituido_por_diagnostico_id);
