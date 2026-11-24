-- PEP, porta própria dos documentos (família pareceres, sumários, transferência, óbito e ciência; pep-gravacao,
-- 23/11/2026): só para frente e idempotente (ADR 0002, parte 2). Sem gatilho; as regras ficam no domínio e na porta.
--   - sumario_alta: o rascunho estruturado salvo pela tela (texto JSON), o resumo SHA-256 dele e a conta que salvou
--     cada versão (o profissional responsável já existe; a conta distingue duas contas do mesmo profissional);
--   - declaracao_obito: o número da declaração pode faltar no registro (rascunho); emitida ou cancelada exige número;
--     as causas como o médico as escreveu (a estrutura por linha fica em declaracao_obito_causa);
--   - ciencia_resultado_critico: a conta que deu ciência e a quem a conduta foi escalonada;
--   - relatorio_transferencia (nova): o relatório de transferência do paciente para outro serviço, ligado ao documento
--     do prontuário; nunca apagado (correção por cancelamento com motivo).

ALTER TABLE sumario_alta
  ADD COLUMN IF NOT EXISTS conteudo_rascunho LONGTEXT NULL COMMENT 'Sumário estruturado salvo pela tela (JSON), por versão',
  ADD COLUMN IF NOT EXISTS hash_conteudo CHAR(64) NULL COMMENT 'Resumo SHA-256 (hexadecimal) do conteúdo desta versão',
  ADD COLUMN IF NOT EXISTS registrado_usuario_id BIGINT UNSIGNED NULL COMMENT 'Conta que salvou esta versão',
  DROP CONSTRAINT IF EXISTS ck_sumario_alta_conteudo_rascunho,
  ADD CONSTRAINT ck_sumario_alta_conteudo_rascunho CHECK (conteudo_rascunho IS NULL OR JSON_VALID(conteudo_rascunho)),
  DROP CONSTRAINT IF EXISTS ck_sumario_alta_hash_conteudo,
  ADD CONSTRAINT ck_sumario_alta_hash_conteudo CHECK (hash_conteudo IS NULL OR hash_conteudo REGEXP '^[0-9a-f]{64}$');

ALTER TABLE declaracao_obito
  MODIFY COLUMN numero VARCHAR(11) NULL COMMENT 'Número da declaração de óbito; pode faltar só no rascunho',
  ADD COLUMN IF NOT EXISTS causas_declaradas TEXT NULL COMMENT 'Causas da morte como o médico as escreveu',
  DROP CONSTRAINT IF EXISTS ck_declaracao_obito_numero,
  ADD CONSTRAINT ck_declaracao_obito_numero CHECK (situacao = 'rascunho' OR numero IS NOT NULL);

ALTER TABLE ciencia_resultado_critico
  ADD COLUMN IF NOT EXISTS ciente_usuario_id BIGINT UNSIGNED NULL COMMENT 'Conta que registrou a ciência',
  ADD COLUMN IF NOT EXISTS escalonado_para VARCHAR(150) NULL COMMENT 'Conta ou equipe a quem a conduta foi escalonada',
  DROP CONSTRAINT IF EXISTS ck_ciencia_resultado_critico_ciente_usuario,
  ADD CONSTRAINT ck_ciencia_resultado_critico_ciente_usuario CHECK (ciente_usuario_id IS NULL OR ciente_em IS NOT NULL);

CREATE TABLE IF NOT EXISTS relatorio_transferencia (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  paciente_id       BIGINT UNSIGNED NOT NULL,
  atendimento_id    BIGINT UNSIGNED NOT NULL,
  destino           VARCHAR(300) NOT NULL COMMENT 'Serviço ou hospital de destino',
  motivo            VARCHAR(2000) NOT NULL,
  conteudo          LONGTEXT NOT NULL COMMENT 'Relatório estruturado (JSON)',
  hash_conteudo     CHAR(64) NOT NULL,
  profissional_id   BIGINT UNSIGNED NOT NULL COMMENT 'Profissional que registrou',
  usuario_id        BIGINT UNSIGNED NOT NULL COMMENT 'Conta que registrou',
  inscricao_conselho_id BIGINT UNSIGNED NULL COMMENT 'Inscrição (ocupação) com que registrou',
  registrado_em     DATETIME(3) NOT NULL,
  situacao          VARCHAR(20) NOT NULL DEFAULT 'registrado',
  cancelado_em      DATETIME(3) NULL,
  motivo_cancelamento VARCHAR(500) NULL,
  documento_prontuario_id BIGINT UNSIGNED NULL,
  origem            VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em       DATETIME(3) NULL,
  excluido_por      BIGINT UNSIGNED NULL,
  CONSTRAINT ck_relatorio_transferencia_situacao CHECK (situacao IN ('registrado','cancelado')),
  CONSTRAINT ck_relatorio_transferencia_cancelamento CHECK (situacao <> 'cancelado' OR (cancelado_em IS NOT NULL AND motivo_cancelamento IS NOT NULL)),
  CONSTRAINT ck_relatorio_transferencia_hash CHECK (hash_conteudo REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT ck_relatorio_transferencia_conteudo CHECK (JSON_VALID(conteudo)),
  CONSTRAINT ck_relatorio_transferencia_destino CHECK (CHAR_LENGTH(TRIM(destino)) > 0),
  CONSTRAINT ck_relatorio_transferencia_origem CHECK (origem IN ('sistema','migracao','integracao')),
  KEY ix_relatorio_transferencia_atendimento (atendimento_id, registrado_em),
  KEY ix_relatorio_transferencia_paciente (paciente_id),
  KEY ix_relatorio_transferencia_estabelecimento (estabelecimento_id),
  KEY ix_relatorio_transferencia_profissional (profissional_id),
  KEY ix_relatorio_transferencia_usuario (usuario_id),
  KEY ix_relatorio_transferencia_inscricao (inscricao_conselho_id),
  KEY ix_relatorio_transferencia_documento (documento_prontuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Relatório de transferência do paciente para outro serviço';
