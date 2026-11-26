-- Recusas da carga (fase 2, K1): registro clínico, alta, receita, documento emitido, ficha de antimicrobiano e tipo de fechamento de balanço hídrico migrados. Só relaxa no registro migrado (col IS NOT NULL OR origem = 'migracao', precedente 06_PEP/40_tabelas.sql); no sistema a
-- obrigatoriedade continua. Idempotente e válida em qualquer ordem (ADR 0002): DROP CONSTRAINT IF EXISTS antes de
-- recriar, MODIFY repetível, ADD COLUMN IF NOT EXISTS.

-- Registro clínico: o autor é o profissional; o login (usuário) falta em parte dos profissionais da origem.
-- Quem suspendeu também pode ser só o profissional no registro migrado.
ALTER TABLE registro_assistencial
  MODIFY COLUMN autor_usuario_id BIGINT UNSIGNED NULL COMMENT 'Usuário do autor; nulo só no registro migrado de profissional sem login (o autor é o profissional)',
  ADD COLUMN IF NOT EXISTS suspenso_por_profissional_id BIGINT UNSIGNED NULL COMMENT 'Profissional que suspendeu; no registro migrado pode substituir o usuário' AFTER suspenso_por_usuario_id,
  ADD KEY IF NOT EXISTS ix_registro_assistencial_suspenso_por_profissional (suspenso_por_profissional_id),
  DROP CONSTRAINT IF EXISTS ck_registro_assistencial_autor_usuario,
  DROP CONSTRAINT IF EXISTS ck_registro_assistencial_suspensao;
ALTER TABLE registro_assistencial
  ADD CONSTRAINT ck_registro_assistencial_autor_usuario CHECK (autor_usuario_id IS NOT NULL OR origem = 'migracao'),
  ADD CONSTRAINT ck_registro_assistencial_suspensao CHECK (situacao NOT IN ('suspenso','corrigido') OR (suspenso_em IS NOT NULL AND justificativa_suspensao IS NOT NULL AND (suspenso_por_usuario_id IS NOT NULL OR (origem = 'migracao' AND suspenso_por_profissional_id IS NOT NULL))));

-- Alta médica: a alta migrada sem médico informado entra (decisão do dono de 25/11); a nova exige o médico.
ALTER TABLE alta_medica
  MODIFY COLUMN profissional_id BIGINT UNSIGNED NULL COMMENT 'Médico que dá a alta; nulo só na alta migrada sem médico informado',
  DROP CONSTRAINT IF EXISTS ck_alta_medica_profissional;
ALTER TABLE alta_medica
  ADD CONSTRAINT ck_alta_medica_profissional CHECK (profissional_id IS NOT NULL OR origem = 'migracao');

-- Receita: a emissão retroativa sem justificativa só é aceita na receita migrada (o histórico não tinha o campo).
ALTER TABLE receita_medica DROP CONSTRAINT IF EXISTS ck_receita_medica_retroativa;
ALTER TABLE receita_medica
  ADD CONSTRAINT ck_receita_medica_retroativa CHECK (emitida_em >= registrada_em - INTERVAL 5 MINUTE OR justificativa_retroativa IS NOT NULL OR origem = 'migracao');

-- Documento emitido (atestado, declaração, requerimento): texto vazio só no migrado.
ALTER TABLE documento_emitido
  MODIFY COLUMN texto TEXT NULL COMMENT 'Texto do documento; nulo só no documento migrado sem texto na origem',
  DROP CONSTRAINT IF EXISTS ck_documento_emitido_texto;
ALTER TABLE documento_emitido
  ADD CONSTRAINT ck_documento_emitido_texto CHECK (texto IS NOT NULL OR origem = 'migracao');

-- Ficha de antimicrobiano: a ficha migrada pode não ter o atendimento ligado.
ALTER TABLE ficha_antimicrobiano
  MODIFY COLUMN atendimento_id BIGINT UNSIGNED NULL COMMENT 'Atendimento da ficha; nulo só na ficha migrada sem atendimento ligado',
  DROP CONSTRAINT IF EXISTS ck_ficha_antimicrobiano_atendimento;
ALTER TABLE ficha_antimicrobiano
  ADD CONSTRAINT ck_ficha_antimicrobiano_atendimento CHECK (atendimento_id IS NOT NULL OR origem = 'migracao');

-- Tipo de fechamento do balanço hídrico: a duração pode faltar no migrado (o hospital completa pela pendência).
ALTER TABLE tipo_fechamento_balanco
  ADD COLUMN IF NOT EXISTS origem VARCHAR(20) NOT NULL DEFAULT 'sistema' COMMENT 'sistema, migracao ou integracao',
  MODIFY COLUMN periodo_horas SMALLINT UNSIGNED NULL COMMENT 'Duração do período fechado; nula só no tipo migrado sem duração',
  DROP CONSTRAINT IF EXISTS ck_tipo_fechamento_balanco_origem,
  DROP CONSTRAINT IF EXISTS ck_tipo_fechamento_balanco_periodo_obrigatorio;
ALTER TABLE tipo_fechamento_balanco
  ADD CONSTRAINT ck_tipo_fechamento_balanco_origem CHECK (origem IN ('sistema','migracao','integracao')),
  ADD CONSTRAINT ck_tipo_fechamento_balanco_periodo_obrigatorio CHECK (periodo_horas IS NOT NULL OR origem = 'migracao');
