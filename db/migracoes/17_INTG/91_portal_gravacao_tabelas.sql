-- Portal do paciente, gravação no banco próprio (modulos-proprios-1, família portal-b): só para frente e idempotente
-- (ADR 0002, parte 2). A conta do portal passa a guardar o convite, a credencial (só resumos e o envelope cifrado), o
-- tipo (paciente ou responsável que não é paciente) e os motivos; o vínculo do responsável ganha validade e quem
-- decidiu; o ato da cópia do prontuário aceita a conta do portal como autora; o consentimento pelo vínculo do portal.

ALTER TABLE conta_portal_paciente
  MODIFY paciente_id BIGINT UNSIGNED NULL COMMENT 'Titular da conta; nulo na conta do responsável que não é paciente',
  MODIFY login VARCHAR(254) NULL COMMENT 'Login da conta ativa (o e-mail confirmado)',
  MODIFY email VARCHAR(254) NULL COMMENT 'E-mail confirmado na ativação ou na troca',
  ADD COLUMN IF NOT EXISTS estabelecimento_id BIGINT UNSIGNED NULL COMMENT 'Estabelecimento onde a conta foi aberta',
  ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'paciente' COMMENT 'paciente ou responsavel',
  ADD COLUMN IF NOT EXISTS nome_responsavel VARCHAR(150) NULL COMMENT 'Nome do responsável que não é paciente',
  ADD COLUMN IF NOT EXISTS nascimento_responsavel DATE NULL,
  ADD COLUMN IF NOT EXISTS email_resumo CHAR(64) NULL COMMENT 'SHA-256 do e-mail normalizado',
  ADD COLUMN IF NOT EXISTS senha_resumo VARCHAR(255) NULL COMMENT 'Resumo da senha; a senha nunca é guardada',
  ADD COLUMN IF NOT EXISTS segundo_fator_envelope VARCHAR(1000) NULL COMMENT 'Segredo do autenticador cifrado com a chave mestra',
  ADD COLUMN IF NOT EXISTS segundo_fator_em DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS termo_uso_aceito VARCHAR(40) NULL COMMENT 'Versão do termo de uso aceita na ativação',
  ADD COLUMN IF NOT EXISTS politica_aceita VARCHAR(40) NULL COMMENT 'Versão da política de privacidade aceita',
  ADD COLUMN IF NOT EXISTS convite_resumo CHAR(64) NULL COMMENT 'SHA-256 do código do convite; o código nunca é guardado',
  ADD COLUMN IF NOT EXISTS convite_valido_ate DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS convite_usado_em DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS convite_erradas SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS convite_origem VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS convidado_por VARCHAR(60) NULL,
  ADD COLUMN IF NOT EXISTS motivo_bloqueio VARCHAR(250) NULL,
  ADD COLUMN IF NOT EXISTS motivo_encerramento VARCHAR(250) NULL,
  ADD COLUMN IF NOT EXISTS paciente_vigente BIGINT UNSIGNED AS (IF(situacao <> 'encerrada' AND excluido_em IS NULL, paciente_id, NULL)) PERSISTENT COMMENT 'Auxiliar da unicidade: uma conta vigente por paciente',
  DROP CONSTRAINT IF EXISTS ck_conta_portal_paciente_tipo,
  ADD CONSTRAINT ck_conta_portal_paciente_tipo CHECK (tipo IN ('paciente','responsavel')),
  DROP CONSTRAINT IF EXISTS ck_conta_portal_paciente_titular,
  ADD CONSTRAINT ck_conta_portal_paciente_titular CHECK (tipo = 'responsavel' OR paciente_id IS NOT NULL),
  DROP CONSTRAINT IF EXISTS ck_conta_portal_paciente_responsavel,
  ADD CONSTRAINT ck_conta_portal_paciente_responsavel CHECK (tipo = 'paciente' OR (paciente_id IS NULL AND nome_responsavel IS NOT NULL)),
  DROP CONSTRAINT IF EXISTS ck_conta_portal_paciente_ativa,
  ADD CONSTRAINT ck_conta_portal_paciente_ativa CHECK (situacao <> 'ativa' OR (email IS NOT NULL AND email_resumo IS NOT NULL AND senha_resumo IS NOT NULL)),
  DROP CONSTRAINT IF EXISTS ck_conta_portal_paciente_encerrada,
  ADD CONSTRAINT ck_conta_portal_paciente_encerrada CHECK (situacao <> 'encerrada' OR (encerrada_em IS NOT NULL AND motivo_encerramento IS NOT NULL)),
  DROP CONSTRAINT IF EXISTS ck_conta_portal_paciente_convite_origem,
  ADD KEY IF NOT EXISTS ix_conta_portal_paciente_paciente (paciente_id),
  ADD KEY IF NOT EXISTS ix_conta_portal_paciente_estabelecimento (estabelecimento_id),
  ADD UNIQUE KEY IF NOT EXISTS uq_conta_portal_paciente_convite (convite_resumo),
  ADD UNIQUE KEY IF NOT EXISTS uq_conta_portal_paciente_email_resumo (email_resumo);
-- A conta encerrada libera o paciente para uma conta nova (a unicidade passa à conta vigente).
ALTER TABLE conta_portal_paciente DROP KEY IF EXISTS uq_conta_portal_paciente_paciente;
-- A conta pertence ao estabelecimento (como na memória): uma conta vigente por paciente em cada estabelecimento.
ALTER TABLE conta_portal_paciente ADD UNIQUE KEY IF NOT EXISTS uq_conta_portal_paciente_vigente_estab (estabelecimento_id, paciente_vigente);
ALTER TABLE conta_portal_paciente DROP KEY IF EXISTS uq_conta_portal_paciente_vigente;

ALTER TABLE vinculo_responsavel_portal
  ADD COLUMN IF NOT EXISTS validade DATE NULL COMMENT 'Fim da validade da prova (procuração)',
  ADD COLUMN IF NOT EXISTS prova_arquivo_chave VARCHAR(300) NULL COMMENT 'Chave do arquivo da prova no armazenamento',
  ADD COLUMN IF NOT EXISTS decidido_por VARCHAR(60) NULL COMMENT 'Quem decidiu ou encerrou (login do hospital ou a conta do portal)',
  DROP CONSTRAINT IF EXISTS ck_vinculo_responsavel_portal_decisao,
  ADD CONSTRAINT ck_vinculo_responsavel_portal_decisao CHECK (situacao = 'pendente' OR (decidido_em IS NOT NULL AND (decidido_por_usuario_id IS NOT NULL OR (situacao = 'encerrado' AND decidido_por IS NOT NULL)))),
  DROP CONSTRAINT IF EXISTS ck_vinculo_responsavel_portal_segregacao,
  ADD CONSTRAINT ck_vinculo_responsavel_portal_segregacao CHECK (situacao NOT IN ('ativo','recusado') OR decidido_por IS NULL OR decidido_por <> pedido_por);

ALTER TABLE ato_copia_prontuario
  MODIFY usuario_id BIGINT UNSIGNED NULL COMMENT 'Usuário do hospital que fez o ato; nulo quando foi a conta do portal',
  ADD COLUMN IF NOT EXISTS conta_portal_paciente_id BIGINT UNSIGNED NULL COMMENT 'Conta do portal que pediu a cópia',
  DROP CONSTRAINT IF EXISTS ck_ato_copia_prontuario_autor,
  ADD CONSTRAINT ck_ato_copia_prontuario_autor CHECK (usuario_id IS NOT NULL OR (ato = 'solicitacao' AND conta_portal_paciente_id IS NOT NULL)),
  ADD KEY IF NOT EXISTS ix_ato_copia_prontuario_conta_portal_paciente (conta_portal_paciente_id);

ALTER TABLE solicitacao_copia_prontuario
  ADD COLUMN IF NOT EXISTS legitimidade_em DATETIME(3) NULL COMMENT 'Quando a legitimidade do solicitante foi conferida',
  DROP CONSTRAINT IF EXISTS ck_solicitacao_copia_prontuario_terceiro,
  ADD CONSTRAINT ck_solicitacao_copia_prontuario_terceiro CHECK (solicitante_tipo = 'paciente' OR autorizacao_arquivo_id IS NOT NULL OR legitimidade_em IS NOT NULL OR situacao IN ('solicitada','em_analise','negada','cancelada'));

ALTER TABLE consentimento_titular
  DROP CONSTRAINT IF EXISTS ck_consentimento_titular_representante,
  ADD CONSTRAINT ck_consentimento_titular_representante CHECK (tipo_signatario = 'paciente' OR responsavel_paciente_id IS NOT NULL OR vinculo_responsavel_portal_id IS NOT NULL);

ALTER TABLE consentimento_titular
  ADD COLUMN IF NOT EXISTS versao_termo VARCHAR(40) NULL COMMENT 'Versão do termo aceita ou recusada';
