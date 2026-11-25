-- Prontuário de acesso restrito (F8, 03-PEP L93, 25/11/2026): senha do paciente e contagem das aberturas. Só para frente
-- e idempotente (ADR 0002, parte 2). Sem gatilho: as regras ficam no domínio (@sgh/dominio-pep, prontuario-restrito) e
-- na porta própria (apps/api/src/modulos/pep/prontuario-restrito-propria.ts).
--   - senha_prontuario_paciente: a senha que o paciente define para autorizar o acesso ao prontuário restrito, guardada
--     só como resumo com sal (LGPD art. 46; SBIS NGS1). Uma vigente por paciente; a troca substitui (nada se apaga).
--     Cinco erros seguidos bloqueiam a conferência por um tempo.
--   - acesso_prontuario_restrito: cada abertura do prontuário restrito por uma autorização, numerada, para contar contra
--     o limite da configuração (configuracao_prontuario_restrito.limite_acessos) e mostrar a quem autorizou.
CREATE TABLE IF NOT EXISTS senha_prontuario_paciente (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  paciente_id            BIGINT UNSIGNED NOT NULL,
  senha_resumo           VARCHAR(200) NOT NULL COMMENT 'Resumo com sal da senha (nunca a senha)',
  situacao               VARCHAR(20) NOT NULL DEFAULT 'vigente',
  paciente_vigente       BIGINT UNSIGNED AS (IF(situacao = 'vigente', paciente_id, NULL)) STORED,
  definida_em            DATETIME(3) NOT NULL,
  definida_por_usuario_id BIGINT UNSIGNED NOT NULL,
  tentativas_falhas      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  bloqueada_ate          DATETIME(3) NULL,
  encerrada_em           DATETIME(3) NULL,
  criado_em              DATETIME(3) NOT NULL,
  criado_por             BIGINT UNSIGNED NULL,
  alterado_em            DATETIME(3) NULL,
  alterado_por           BIGINT UNSIGNED NULL,
  versao                 INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_senha_prontuario_paciente_situacao CHECK (situacao IN ('vigente','substituida','revogada')),
  CONSTRAINT ck_senha_prontuario_paciente_encerrada CHECK (situacao = 'vigente' OR encerrada_em IS NOT NULL),
  UNIQUE KEY uq_senha_prontuario_paciente_vigente (paciente_vigente),
  KEY ix_senha_prontuario_paciente_paciente (paciente_id),
  KEY ix_senha_prontuario_paciente_definida_por (definida_por_usuario_id)
) COMMENT='Senha do paciente para autorizar o acesso ao prontuário restrito, só em resumo com sal';

CREATE TABLE IF NOT EXISTS acesso_prontuario_restrito (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  autorizacao_acesso_prontuario_restrito_id BIGINT UNSIGNED NOT NULL,
  paciente_id            BIGINT UNSIGNED NOT NULL,
  usuario_id             BIGINT UNSIGNED NOT NULL COMMENT 'Quem abriu',
  numero_acesso          INT UNSIGNED NOT NULL COMMENT 'Ordem da abertura dentro da autorização',
  acessado_em            DATETIME(3) NOT NULL,
  leitura_prontuario_id  BIGINT UNSIGNED NULL COMMENT 'A leitura registrada na trilha do prontuário',
  criado_em              DATETIME(3) NOT NULL,
  criado_por             BIGINT UNSIGNED NULL,
  alterado_em            DATETIME(3) NULL,
  alterado_por           BIGINT UNSIGNED NULL,
  versao                 INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_acesso_prontuario_restrito_numero CHECK (numero_acesso >= 1),
  UNIQUE KEY uq_acesso_prontuario_restrito_numero (autorizacao_acesso_prontuario_restrito_id, numero_acesso),
  KEY ix_acesso_prontuario_restrito_paciente (paciente_id, acessado_em),
  KEY ix_acesso_prontuario_restrito_usuario (usuario_id),
  KEY ix_acesso_prontuario_restrito_leitura (leitura_prontuario_id)
) COMMENT='Cada abertura do prontuário restrito por uma autorização, numerada para a contagem contra o limite';
