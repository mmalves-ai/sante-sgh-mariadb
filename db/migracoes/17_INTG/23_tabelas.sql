-- F2.4 (dívida da migração), 3ª etapa, 4ª leva: DDL pedido pelos lotes das portas (p-*), só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v4.md

-- Portal de resultados: o protocolo de acesso do atendimento (o código impresso nunca é guardado, só o resumo).
CREATE TABLE IF NOT EXISTS protocolo_acesso_portal (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  paciente_id BIGINT UNSIGNED NOT NULL,
  atendimento_id BIGINT UNSIGNED NOT NULL,
  resumo_protocolo CHAR(64) NOT NULL COMMENT 'SHA-256 do código impresso; o código nunca é guardado',
  situacao VARCHAR(20) NOT NULL DEFAULT 'ativo' COMMENT 'ativo, revogado ou expirado',
  tentativas_falhas SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  bloqueado_ate DATETIME(3) NULL,
  emitido_em DATETIME(3) NOT NULL,
  emitido_por_usuario_id BIGINT UNSIGNED NULL,
  revogado_em DATETIME(3) NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_protocolo_acesso_portal_situacao CHECK (situacao IN ('ativo','revogado','expirado')),
  CONSTRAINT ck_protocolo_acesso_portal_revogacao CHECK (situacao <> 'revogado' OR revogado_em IS NOT NULL),
  CONSTRAINT ck_protocolo_acesso_portal_resumo CHECK (resumo_protocolo REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT ck_protocolo_acesso_portal_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_protocolo_acesso_portal_resumo (resumo_protocolo),
  KEY ix_protocolo_acesso_portal_paciente (estabelecimento_id, paciente_id),
  KEY ix_protocolo_acesso_portal_atendimento (atendimento_id),
  KEY ix_protocolo_acesso_portal_paciente_id (paciente_id),
  KEY ix_protocolo_acesso_portal_emitido_por (emitido_por_usuario_id)
) COMMENT='Protocolo de uso por atendimento para o paciente consultar os resultados no portal (com a data de nascimento)';

-- Autocadastro do médico externo: o resumo da senha (com sal) e o segredo do segundo fator cifrado (envelope com a
-- chave mestra do ambiente), nunca em claro. A aprovação copia os dois para a conta.
ALTER TABLE pedido_vinculo_profissional_externo
  ADD COLUMN IF NOT EXISTS resumo_senha VARCHAR(255) NULL COMMENT 'Resumo da senha com sal; a senha nunca é guardada',
  ADD COLUMN IF NOT EXISTS segredo_segundo_fator_cifrado VARCHAR(255) NULL COMMENT 'Segredo do autenticador cifrado com a chave mestra do ambiente; nunca em claro';
-- O autocadastro conta as tentativas erradas e bloqueia como a conta: a senha do pedido passa à conta na aprovação.
ALTER TABLE pedido_vinculo_profissional_externo
  ADD COLUMN IF NOT EXISTS tentativas_falhas SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Tentativas de entrada erradas seguidas, antes da conta',
  ADD COLUMN IF NOT EXISTS bloqueado_ate DATETIME(3) NULL COMMENT 'Entrada bloqueada até este instante pelas tentativas erradas';
ALTER TABLE conta_portal_profissional_externo
  ADD COLUMN IF NOT EXISTS resumo_senha VARCHAR(255) NULL COMMENT 'Resumo da senha com sal; a senha nunca é guardada',
  ADD COLUMN IF NOT EXISTS segredo_segundo_fator_cifrado VARCHAR(255) NULL COMMENT 'Segredo do autenticador cifrado com a chave mestra do ambiente; nunca em claro';
