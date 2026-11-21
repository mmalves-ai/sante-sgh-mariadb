-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

CREATE TABLE politica_segundo_fator (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  alvo VARCHAR(20) NOT NULL COMMENT 'perfil ou todos',
  perfil_acesso_id BIGINT UNSIGNED NULL,
  onda TINYINT UNSIGNED NOT NULL,
  inicio DATE NOT NULL,
  prazo_adesao_dias SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  motivo VARCHAR(500) NOT NULL,
  encerrada_em DATETIME(3) NULL,
  encerrada_por_usuario_id BIGINT UNSIGNED NULL,
  motivo_encerramento VARCHAR(500) NULL,
  substituida_por_id BIGINT UNSIGNED NULL COMMENT 'Linha nova quando a política foi alterada',
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_politica_segundo_fator_alvo CHECK (alvo IN ('perfil','todos')),
  CONSTRAINT ck_politica_segundo_fator_alvo_perfil CHECK ((alvo = 'perfil') = (perfil_acesso_id IS NOT NULL)),
  CONSTRAINT ck_politica_segundo_fator_onda CHECK (onda IN (1,2)),
  CONSTRAINT ck_politica_segundo_fator_prazo CHECK (prazo_adesao_dias <= 365),
  CONSTRAINT ck_politica_segundo_fator_encerramento CHECK (encerrada_em IS NULL OR (encerrada_por_usuario_id IS NOT NULL AND motivo_encerramento IS NOT NULL)),
  KEY ix_politica_segundo_fator_estabelecimento (estabelecimento_id, encerrada_em),
  KEY ix_politica_segundo_fator_perfil (perfil_acesso_id),
  KEY ix_politica_segundo_fator_substituida (substituida_por_id),
  KEY ix_politica_segundo_fator_encerrada_por (encerrada_por_usuario_id),
  CONSTRAINT ck_politica_segundo_fator_origem CHECK (origem IN ('sistema','migracao','integracao'))
) COMMENT='Exigência do segundo fator por estabelecimento, em ondas, com início, prazo de adesão e histórico de alteração';

ALTER TABLE segundo_fator_usuario
  ADD COLUMN IF NOT EXISTS segredo_cifrado VARCHAR(255) NULL COMMENT 'Segredo do autenticador cifrado em envelope (chave mestra do ambiente); nunca em claro' AFTER referencia_cofre,
  DROP CONSTRAINT IF EXISTS ck_segundo_fator_usuario_autenticador,
  ADD CONSTRAINT ck_segundo_fator_usuario_autenticador CHECK (tipo <> 'aplicativo_autenticador' OR situacao = 'revogado' OR referencia_cofre IS NOT NULL OR segredo_cifrado IS NOT NULL);
ALTER TABLE perfil_acesso
  ADD COLUMN IF NOT EXISTS acesso_amplo BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Perfil de acesso amplo, alvo do saneamento (dissolvido em perfis de trabalho)' AFTER privilegiado;
ALTER TABLE usuario_perfil
  ADD COLUMN IF NOT EXISTS revogado_motivo VARCHAR(500) NULL COMMENT 'Motivo da revogação da concessão',
  ADD COLUMN IF NOT EXISTS ativo_chave TINYINT UNSIGNED AS (IF(excluido_em IS NULL, 1, NULL)) PERSISTENT COMMENT 'Só para a unicidade: a concessão excluída não conta',
  ADD UNIQUE KEY IF NOT EXISTS uq_usuario_perfil_par_ativo (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, ativo_chave),
  DROP INDEX IF EXISTS uq_usuario_perfil_par;
ALTER TABLE mensagem_interna
  ADD COLUMN IF NOT EXISTS exige_ciencia BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'A mensagem pede ciência de cada destinatário';
ALTER TABLE mensagem_interna_destinatario
  ADD COLUMN IF NOT EXISTS via VARCHAR(40) NULL COMMENT 'Por onde chegou: usuário, grupo, setor ou unidade',
  ADD COLUMN IF NOT EXISTS ciente_em DATETIME(3) NULL COMMENT 'Ciência do destinatário',
  DROP CONSTRAINT IF EXISTS ck_mensagem_interna_destinatario_ciencia,
  ADD CONSTRAINT ck_mensagem_interna_destinatario_ciencia CHECK (ciente_em IS NULL OR lida);
ALTER TABLE comunicado_destinatario
  ADD COLUMN IF NOT EXISTS via VARCHAR(40) NULL COMMENT 'Por onde o público expandido chegou na publicação';
ALTER TABLE notificacao_usuario
  ADD COLUMN IF NOT EXISTS tipo VARCHAR(30) NULL COMMENT 'Tipo do aviso',
  ADD COLUMN IF NOT EXISTS evento VARCHAR(80) NULL COMMENT 'Evento que gerou o aviso',
  ADD KEY IF NOT EXISTS ix_notificacao_usuario_usuario_tipo (usuario_id, tipo);
ALTER TABLE pedido_titular
  DROP CONSTRAINT IF EXISTS ck_pedido_titular_canal,
  ADD CONSTRAINT ck_pedido_titular_canal CHECK (canal_recebimento IN ('presencial','email','portal','telefone','carta','outro')),
  ADD COLUMN IF NOT EXISTS fundamento_decisao VARCHAR(40) NULL COMMENT 'Fundamento legal da decisão do pedido',
  ADD COLUMN IF NOT EXISTS conta_portal_paciente_id BIGINT UNSIGNED NULL COMMENT 'Conta do portal que abriu o pedido',
  ADD COLUMN IF NOT EXISTS motivo_cancelamento VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS observacao_cancelamento VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS cancelado_em DATETIME(3) NULL,
  DROP CONSTRAINT IF EXISTS ck_pedido_titular_fundamento,
  ADD CONSTRAINT ck_pedido_titular_fundamento CHECK (fundamento_decisao IS NULL OR fundamento_decisao IN ('guarda_legal_prontuario','obrigacao_legal','exercicio_de_direito','identidade_nao_confirmada','outro')),
  DROP CONSTRAINT IF EXISTS ck_pedido_titular_cancelamento,
  ADD CONSTRAINT ck_pedido_titular_cancelamento CHECK (cancelado_em IS NULL OR situacao = 'cancelado'),
  ADD KEY IF NOT EXISTS ix_pedido_titular_conta_portal_paciente (conta_portal_paciente_id);
ALTER TABLE consentimento_titular
  ADD COLUMN IF NOT EXISTS canal_registro VARCHAR(20) NULL COMMENT 'Onde o consentimento foi registrado',
  ADD COLUMN IF NOT EXISTS conta_portal_paciente_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS vinculo_responsavel_portal_id BIGINT UNSIGNED NULL COMMENT 'Vínculo pelo qual o responsável registrou',
  DROP CONSTRAINT IF EXISTS ck_consentimento_titular_canal_registro,
  ADD CONSTRAINT ck_consentimento_titular_canal_registro CHECK (canal_registro IS NULL OR canal_registro IN ('portal','balcao','sistema')),
  ADD KEY IF NOT EXISTS ix_consentimento_titular_conta_portal_paciente (conta_portal_paciente_id),
  ADD KEY IF NOT EXISTS ix_consentimento_titular_vinculo_responsavel_portal (vinculo_responsavel_portal_id);

CREATE TABLE usuario_perfil_alteracao (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_perfil_id BIGINT UNSIGNED NOT NULL,
  vigencia_inicio_antes DATE NOT NULL,
  vigencia_fim_antes DATE NULL,
  motivo_antes VARCHAR(500) NULL,
  vigencia_inicio DATE NOT NULL,
  vigencia_fim DATE NULL,
  motivo VARCHAR(500) NOT NULL,
  justificativa VARCHAR(500) NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_usuario_perfil_alteracao_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  CONSTRAINT ck_usuario_perfil_alteracao_vigencia_antes CHECK (vigencia_fim_antes IS NULL OR vigencia_fim_antes >= vigencia_inicio_antes),
  KEY ix_usuario_perfil_alteracao_usuario_perfil (usuario_perfil_id)
) COMMENT='Alteração de vigência ou motivo de uma concessão de perfil, com o antes e o depois';

CREATE TABLE politica_senha_versao (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  numero_versao INT UNSIGNED NOT NULL,
  tamanho_minimo TINYINT UNSIGNED NOT NULL,
  exige_maiuscula BOOLEAN NOT NULL,
  exige_minuscula BOOLEAN NOT NULL,
  exige_numero BOOLEAN NOT NULL,
  exige_especial BOOLEAN NOT NULL,
  validade_dias SMALLINT UNSIGNED NULL COMMENT 'Nulo: sem expiração',
  reuso_dias SMALLINT UNSIGNED NULL,
  recusa_nome BOOLEAN NOT NULL DEFAULT TRUE,
  recusa_nascimento BOOLEAN NOT NULL DEFAULT TRUE,
  recusa_comuns BOOLEAN NOT NULL DEFAULT TRUE,
  senhas_proibidas LONGTEXT NULL COMMENT 'Lista JSON de senhas proibidas',
  vigente_desde DATETIME(3) NOT NULL,
  motivo VARCHAR(500) NOT NULL,
  situacao VARCHAR(20) NOT NULL DEFAULT 'publicada',
  cancelada_em DATETIME(3) NULL,
  cancelada_por_usuario_id BIGINT UNSIGNED NULL,
  motivo_cancelamento VARCHAR(500) NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_politica_senha_versao_situacao CHECK (situacao IN ('publicada','cancelada')),
  CONSTRAINT ck_politica_senha_versao_cancelamento CHECK (situacao <> 'cancelada' OR (cancelada_em IS NOT NULL AND cancelada_por_usuario_id IS NOT NULL AND motivo_cancelamento IS NOT NULL)),
  CONSTRAINT ck_politica_senha_versao_tamanho CHECK (tamanho_minimo BETWEEN 6 AND 128),
  CONSTRAINT ck_politica_senha_versao_proibidas CHECK (senhas_proibidas IS NULL OR JSON_VALID(senhas_proibidas)),
  UNIQUE KEY uq_politica_senha_versao_numero (estabelecimento_id, numero_versao),
  KEY ix_politica_senha_versao_cancelada_por (cancelada_por_usuario_id)
) COMMENT='Versão publicada da política de senha do estabelecimento, com vigência (inclusive futura) e cancelamento';

CREATE TABLE limite_sessao_perfil (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  perfil_acesso_id BIGINT UNSIGNED NULL COMMENT 'Nulo: todos os perfis',
  limite SMALLINT UNSIGNED NULL COMMENT 'Nulo: limite retirado',
  motivo VARCHAR(500) NOT NULL,
  vigente_desde DATETIME(3) NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_limite_sessao_perfil_limite CHECK (limite IS NULL OR limite BETWEEN 1 AND 50),
  KEY ix_limite_sessao_perfil_estabelecimento (estabelecimento_id, perfil_acesso_id, vigente_desde),
  KEY ix_limite_sessao_perfil_perfil (perfil_acesso_id)
) COMMENT='Limite de sessões simultâneas por perfil (ou para todos os perfis) no estabelecimento, com vigência e motivo';

CREATE TABLE excecao_conta_dormente (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id BIGINT UNSIGNED NOT NULL,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  valida_ate DATE NULL COMMENT 'Nulo: exceção retirada',
  motivo VARCHAR(500) NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  KEY ix_excecao_conta_dormente_usuario (usuario_id, estabelecimento_id),
  KEY ix_excecao_conta_dormente_estabelecimento (estabelecimento_id)
) COMMENT='Exceção de uma conta à rotina de contas dormentes, com validade e motivo';

CREATE TABLE conferencia_registro_conselho (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id BIGINT UNSIGNED NOT NULL,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  inscricao_conselho_id BIGINT UNSIGNED NOT NULL,
  situacao VARCHAR(20) NOT NULL,
  fonte VARCHAR(20) NOT NULL,
  conferido_em DATETIME(3) NOT NULL,
  valida_ate DATE NULL,
  observacao VARCHAR(500) NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_conferencia_registro_conselho_situacao CHECK (situacao IN ('ativo','inativo','suspenso','cancelado','nao_localizado')),
  CONSTRAINT ck_conferencia_registro_conselho_fonte CHECK (fonte IN ('portal_conselho','documento','declaracao','outra')),
  KEY ix_conferencia_registro_conselho_usuario (usuario_id, conferido_em),
  KEY ix_conferencia_registro_conselho_estabelecimento (estabelecimento_id),
  KEY ix_conferencia_registro_conselho_inscricao (inscricao_conselho_id)
) COMMENT='Conferência da inscrição no conselho de classe de quem tem conta, com fonte, situação e validade';

CREATE TABLE perfil_cargo_rh (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  cargo_id BIGINT UNSIGNED NOT NULL,
  perfil_acesso_id BIGINT UNSIGNED NULL COMMENT 'Nulo: o cargo não recebe perfil automático',
  motivo VARCHAR(500) NOT NULL,
  vigencia_inicio DATE NOT NULL,
  vigencia_fim DATE NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_perfil_cargo_rh_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  UNIQUE KEY uq_perfil_cargo_rh_vigencia (estabelecimento_id, cargo_id, vigencia_inicio),
  KEY ix_perfil_cargo_rh_cargo (cargo_id),
  KEY ix_perfil_cargo_rh_perfil (perfil_acesso_id)
) COMMENT='Perfil de acesso sugerido para cada cargo do RH no estabelecimento, com vigência e motivo';

CREATE TABLE resolucao_tarefa_rh (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  usuario_id BIGINT UNSIGNED NULL COMMENT 'Conta afetada; nulo quando a conta ainda não existe',
  tipo VARCHAR(30) NOT NULL,
  referencia_entidade VARCHAR(64) NOT NULL COMMENT 'Fato do RH que gerou a tarefa: vínculo, mudança ou afastamento',
  referencia_id BIGINT UNSIGNED NOT NULL,
  decisao VARCHAR(20) NOT NULL,
  motivo VARCHAR(500) NOT NULL,
  resolvido_em DATETIME(3) NOT NULL,
  resolvido_por_usuario_id BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_resolucao_tarefa_rh_tipo CHECK (tipo IN ('criar_acesso','revisar_acesso','suspender_acesso')),
  CONSTRAINT ck_resolucao_tarefa_rh_decisao CHECK (decisao IN ('atendida','dispensada')),
  UNIQUE KEY uq_resolucao_tarefa_rh_referencia (estabelecimento_id, tipo, referencia_entidade, referencia_id),
  KEY ix_resolucao_tarefa_rh_usuario (usuario_id),
  KEY ix_resolucao_tarefa_rh_resolvido_por (resolvido_por_usuario_id)
) COMMENT='Resolução de uma tarefa de acesso vinda do RH (criar, revisar ou suspender acesso), com decisão e motivo';

CREATE TABLE comunicado_versao (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  comunicado_id BIGINT UNSIGNED NOT NULL,
  numero_versao INT UNSIGNED NOT NULL,
  titulo VARCHAR(200) NOT NULL,
  texto TEXT NOT NULL,
  motivo VARCHAR(500) NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_comunicado_versao_motivo CHECK (CHAR_LENGTH(TRIM(motivo)) >= 3),
  UNIQUE KEY uq_comunicado_versao (comunicado_id, numero_versao)
) COMMENT='Versão anterior de um comunicado corrigido, com título, texto e motivo da correção';

CREATE TABLE marca_processamento (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  processo VARCHAR(60) NOT NULL,
  chave VARCHAR(60) NOT NULL,
  marca_em DATETIME(3) NULL,
  marca_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_marca_processamento_processo_chave (processo, chave)
) COMMENT='Marca da leitura incremental dos processos automáticos (instante e id da última mudança lida)';

CREATE TABLE trilha_auditoria_fecho (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NULL COMMENT 'Nulo: eventos sem estabelecimento',
  estabelecimento_chave BIGINT UNSIGNED AS (IFNULL(estabelecimento_id, 0)) PERSISTENT COMMENT 'Só para a unicidade do dia',
  dia DATE NOT NULL,
  primeiro_trilha_auditoria_id BIGINT UNSIGNED NOT NULL,
  ultimo_trilha_auditoria_id BIGINT UNSIGNED NOT NULL,
  quantidade INT UNSIGNED NOT NULL,
  hash_dia CHAR(64) NOT NULL,
  hash_anterior CHAR(64) NULL,
  fechado_em DATETIME(3) NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_trilha_auditoria_fecho_hash CHECK (hash_dia REGEXP '^[0-9a-f]{64}$' AND (hash_anterior IS NULL OR hash_anterior REGEXP '^[0-9a-f]{64}$')),
  CONSTRAINT ck_trilha_auditoria_fecho_faixa CHECK (ultimo_trilha_auditoria_id >= primeiro_trilha_auditoria_id),
  UNIQUE KEY uq_trilha_auditoria_fecho_dia (estabelecimento_chave, dia),
  KEY ix_trilha_auditoria_fecho_estabelecimento (estabelecimento_id),
  KEY ix_trilha_auditoria_fecho_primeiro (primeiro_trilha_auditoria_id),
  KEY ix_trilha_auditoria_fecho_ultimo (ultimo_trilha_auditoria_id)
) COMMENT='Fecho diário da trilha de auditoria por estabelecimento: faixa de eventos, quantidade e cadeia de resumos';

