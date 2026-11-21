-- INTG, lote 04 (F2.2 ondas finais, onda 4; pedidos do lote 04-02, e do 03-12 na troca de e-mail). Convenções do ADR 0002
-- (parte 2). Só para frente. Sem FOREIGN KEY aqui (04_chaves.sql).

-- 04-02: um profissional numa só conta vigente; a conta desligada ou encerrada continua sendo do mesmo médico
ALTER TABLE conta_portal_profissional_externo
  MODIFY pessoa_fisica_id BIGINT UNSIGNED NOT NULL COMMENT 'Pessoa do médico dono da conta (a mesma do profissional ligado); quem autoriza fica em autorizada_por_usuario_id',
  ADD COLUMN profissional_vigente_id BIGINT UNSIGNED AS (IF(situacao <> 'encerrada' AND autorizada_em IS NOT NULL AND excluido_em IS NULL, profissional_id, NULL)) PERSISTENT COMMENT 'Profissional da conta vigente (autorizada, não encerrada, não excluída), para um profissional numa só conta vigente' AFTER profissional_id,
  ADD KEY ix_conta_portal_profissional_externo_profissional (profissional_id),
  DROP INDEX uq_conta_portal_profissional_externo_profissional,
  ADD UNIQUE KEY uq_conta_portal_profissional_externo_profissional_vigente (profissional_vigente_id);

-- 04-02: histórico dos atos sobre a conta do médico externo (fato histórico: sem exclusão)
CREATE TABLE ato_conta_portal_profissional_externo (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conta_portal_profissional_externo_id BIGINT UNSIGNED NOT NULL,
  ato VARCHAR(20) NOT NULL,
  situacao_anterior VARCHAR(30) NOT NULL COMMENT 'Situação da conta antes do ato',
  motivo VARCHAR(250) NULL,
  pedidos_pendentes SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Pedidos do médico ainda pendentes no momento do ato',
  decisao_pedidos VARCHAR(10) NULL COMMENT 'O que se fez com os pedidos pendentes',
  realizado_por_usuario_id BIGINT UNSIGNED NULL,
  realizado_em DATETIME(3) NOT NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_ato_conta_portal_profissional_externo_ato CHECK (ato IN ('bloqueio','desbloqueio','encerramento','troca_senha','troca_email')),
  CONSTRAINT ck_ato_conta_portal_profissional_externo_situacao_anterior CHECK (situacao_anterior IN ('pendente','ativa','bloqueada','suspensa','encerrada')),
  CONSTRAINT ck_ato_conta_portal_profissional_externo_decisao CHECK (decisao_pedidos IS NULL OR decisao_pedidos IN ('retirar','manter')),
  CONSTRAINT ck_ato_conta_portal_profissional_externo_motivo CHECK (ato NOT IN ('bloqueio','desbloqueio','encerramento') OR motivo IS NOT NULL),
  CONSTRAINT ck_ato_conta_portal_profissional_externo_pendentes CHECK (pedidos_pendentes = 0 OR decisao_pedidos IS NOT NULL),
  CONSTRAINT ck_ato_conta_portal_profissional_externo_origem CHECK (origem IN ('sistema','migracao','integracao')),
  KEY ix_ato_conta_portal_profissional_externo_conta_realizado (conta_portal_profissional_externo_id, realizado_em),
  KEY ix_ato_conta_portal_profissional_externo_realizado_por (realizado_por_usuario_id)
) COMMENT='Ato sobre a conta do médico externo no portal (bloqueio, desbloqueio, encerramento, trocas), com motivo e quem fez';

-- 03-12 e 04-02: troca de e-mail da conta do portal (do paciente ou do médico externo), confirmada por código
CREATE TABLE troca_email_conta_portal (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conta_portal_paciente_id BIGINT UNSIGNED NULL,
  conta_portal_profissional_externo_id BIGINT UNSIGNED NULL,
  email_novo VARCHAR(254) NOT NULL,
  email_novo_resumo CHAR(64) NOT NULL COMMENT 'SHA-256 do e-mail novo normalizado',
  codigo_resumo CHAR(64) NOT NULL COMMENT 'SHA-256 do código de confirmação; o código nunca é guardado',
  valido_ate DATETIME(3) NOT NULL,
  canal_pedido VARCHAR(20) NOT NULL COMMENT 'Onde a troca foi pedida',
  motivo VARCHAR(200) NOT NULL,
  pedido_por_usuario_id BIGINT UNSIGNED NULL COMMENT 'Atendente que pediu no balcão; nulo quando o titular pediu no portal',
  envio VARCHAR(20) NOT NULL COMMENT 'Como o código foi enviado',
  situacao VARCHAR(30) NOT NULL DEFAULT 'pendente',
  decidido_em DATETIME(3) NULL,
  conta_pendente VARCHAR(30) AS (IF(situacao = 'pendente' AND excluido_em IS NULL, CONCAT(IF(conta_portal_paciente_id IS NULL, 'medico:', 'paciente:'), COALESCE(conta_portal_paciente_id, conta_portal_profissional_externo_id)), NULL)) PERSISTENT COMMENT 'Auxiliar da unicidade: uma troca pendente por conta',
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_troca_email_conta_portal_conta CHECK ((conta_portal_paciente_id IS NULL) + (conta_portal_profissional_externo_id IS NULL) = 1),
  CONSTRAINT ck_troca_email_conta_portal_canal CHECK (canal_pedido IN ('portal','balcao')),
  CONSTRAINT ck_troca_email_conta_portal_envio CHECK (envio IN ('simulador','plataforma')),
  CONSTRAINT ck_troca_email_conta_portal_situacao CHECK (situacao IN ('pendente','confirmada','cancelada','expirada')),
  CONSTRAINT ck_troca_email_conta_portal_decisao CHECK (situacao = 'pendente' OR decidido_em IS NOT NULL),
  CONSTRAINT ck_troca_email_conta_portal_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_troca_email_conta_portal_codigo (codigo_resumo),
  UNIQUE KEY uq_troca_email_conta_portal_pendente (conta_pendente),
  KEY ix_troca_email_conta_portal_paciente (conta_portal_paciente_id),
  KEY ix_troca_email_conta_portal_profissional_externo (conta_portal_profissional_externo_id),
  KEY ix_troca_email_conta_portal_pedido_por (pedido_por_usuario_id)
) COMMENT='Pedido de troca do e-mail de uma conta do portal, confirmado por código enviado ao endereço novo';
