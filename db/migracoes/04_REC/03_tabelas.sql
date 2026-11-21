-- REC, lote 03 (F2.2 onda 1): configuração da fila por serviço, senha suspensa, dispositivos do painel e do totem,
-- termos assinados no balcão e etapas do pronto atendimento.
-- Sem FOREIGN KEY aqui (03_chaves.sql). Os destinos de encaminhamento por local já existem (local_atendimento_encaminhamento, lote 01).

ALTER TABLE gerador_senha
  ADD COLUMN intercalar_prioritarias TINYINT UNSIGNED NOT NULL DEFAULT 2 COMMENT 'Na ordem intercalada: prioritárias antes de uma normal',
  ADD COLUMN tempo_alvo_espera_minutos SMALLINT UNSIGNED NULL COMMENT 'Meta de espera da emissão à chamada; nulo sem meta',
  ADD COLUMN rotulo_totem VARCHAR(40) NULL COMMENT 'Rótulo do botão no totem; nulo: a descrição',
  ADD COLUMN exibe_no_totem BOOLEAN NOT NULL DEFAULT TRUE,
  DROP CONSTRAINT ck_gerador_senha_ordem_lista,
  ADD CONSTRAINT ck_gerador_senha_ordem_lista CHECK (ordem_lista IN ('chegada','prioridade','intercalada','horario_marcacao')),
  ADD CONSTRAINT ck_gerador_senha_intercalar CHECK (intercalar_prioritarias BETWEEN 1 AND 9);

ALTER TABLE senha_emitida
  DROP CONSTRAINT ck_senha_emitida_situacao,
  ADD CONSTRAINT ck_senha_emitida_situacao CHECK (situacao IN ('aguardando','chamada','em_atendimento','encaminhada','atendida','suspensa','nao_compareceu','cancelada'));

CREATE TABLE dispositivo_recepcao (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  tipo               VARCHAR(20) NOT NULL,
  nome               VARCHAR(60) NOT NULL,
  ponto_recepcao_id  BIGINT UNSIGNED NULL,
  conteudo           VARCHAR(20) NULL COMMENT 'Painel de TV de setor: leitos, higienizacao, bloco, pa',
  tecnico_usuario_id BIGINT UNSIGNED NULL COMMENT 'Conta de serviço com que o totem grava',
  voz                BOOLEAN NOT NULL DEFAULT FALSE,
  resumo_token       CHAR(64) NOT NULL COMMENT 'SHA-256 do token; o token nunca é guardado',
  prefixo_token      CHAR(8) NOT NULL,
  valido_ate         DATETIME(3) NOT NULL,
  revogado_em        DATETIME(3) NULL,
  revogado_por       BIGINT UNSIGNED NULL,
  ultimo_uso_em      DATETIME(3) NULL,
  login_substituido  VARCHAR(60) NULL,
  conferido_em       DATETIME(3) NULL,
  conferido_por      BIGINT UNSIGNED NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_dispositivo_recepcao_tipo CHECK (tipo IN ('totem','painel','paineltv')),
  CONSTRAINT ck_dispositivo_recepcao_conteudo CHECK (conteudo IS NULL OR conteudo IN ('leitos','higienizacao','bloco','pa')),
  CONSTRAINT ck_dispositivo_recepcao_totem CHECK (tipo <> 'totem' OR tecnico_usuario_id IS NOT NULL),
  UNIQUE KEY uq_dispositivo_recepcao_resumo_token (resumo_token),
  KEY ix_dispositivo_recepcao_estabelecimento (estabelecimento_id),
  KEY ix_dispositivo_recepcao_ponto_recepcao (ponto_recepcao_id),
  KEY ix_dispositivo_recepcao_tecnico_usuario (tecnico_usuario_id)
) COMMENT='Dispositivo do perfil Painel/Totem da recepção (token guardado só por resumo)';

CREATE TABLE dispositivo_recepcao_local (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dispositivo_recepcao_id BIGINT UNSIGNED NOT NULL,
  local_atendimento_id BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_dispositivo_recepcao_local_par (dispositivo_recepcao_id, local_atendimento_id),
  KEY ix_dispositivo_recepcao_local_local_atendimento (local_atendimento_id)
) COMMENT='Locais de atendimento que o painel mostra';

CREATE TABLE dispositivo_recepcao_gerador (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dispositivo_recepcao_id BIGINT UNSIGNED NOT NULL,
  gerador_senha_id   BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_dispositivo_recepcao_gerador_par (dispositivo_recepcao_id, gerador_senha_id),
  KEY ix_dispositivo_recepcao_gerador_gerador_senha (gerador_senha_id)
) COMMENT='Serviços (geradores de senha) que o totem oferece';

CREATE TABLE termo_consentimento_recepcao (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  termo_consentimento_modelo_id BIGINT UNSIGNED NOT NULL,
  paciente_id        BIGINT UNSIGNED NOT NULL,
  senha_emitida_id   BIGINT UNSIGNED NULL,
  tipo_atendimento   VARCHAR(30) NULL,
  meio               VARCHAR(10) NOT NULL,
  tipo_assinante_id  BIGINT UNSIGNED NOT NULL,
  nome_signatario    VARCHAR(150) NOT NULL,
  resumo_assinatura  CHAR(64) NOT NULL COMMENT 'SHA-256 do conteúdo canônico assinado',
  arquivo_id         BIGINT UNSIGNED NULL COMMENT 'Imagem da assinatura',
  assinado_em        DATETIME(3) NOT NULL,
  revogado_em        DATETIME(3) NULL,
  revogado_por       BIGINT UNSIGNED NULL,
  motivo_revogacao   VARCHAR(500) NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  origem             VARCHAR(20) NOT NULL DEFAULT 'sistema',
  CONSTRAINT ck_termo_consentimento_recepcao_meio CHECK (meio IN ('tela','portal')),
  CONSTRAINT ck_termo_consentimento_recepcao_revogacao CHECK (revogado_em IS NULL OR CHAR_LENGTH(TRIM(motivo_revogacao)) >= 10),
  CONSTRAINT ck_termo_consentimento_recepcao_origem CHECK (origem IN ('sistema','migracao','integracao')),
  KEY ix_termo_consentimento_recepcao_estabelecimento (estabelecimento_id),
  KEY ix_termo_consentimento_recepcao_modelo (termo_consentimento_modelo_id),
  KEY ix_termo_consentimento_recepcao_paciente (paciente_id),
  KEY ix_termo_consentimento_recepcao_senha_emitida (senha_emitida_id),
  KEY ix_termo_consentimento_recepcao_tipo_assinante (tipo_assinante_id),
  KEY ix_termo_consentimento_recepcao_arquivo (arquivo_id)
) COMMENT='Termo de consentimento assinado no balcão (imutável; a revogação é fato novo)';

CREATE TABLE atendimento_etapa_pa (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  atendimento_id     BIGINT UNSIGNED NOT NULL,
  etapa              VARCHAR(30) NOT NULL,
  ocorrida_em        DATETIME(3) NOT NULL,
  usuario_id         BIGINT UNSIGNED NULL COMMENT 'Responsável pela etapa',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  origem             VARCHAR(20) NOT NULL DEFAULT 'sistema',
  CONSTRAINT ck_atendimento_etapa_pa_etapa CHECK (etapa IN ('chegada','classificacao','chamada','atendimento_medico','reavaliacao','observacao','decisao','saida')),
  CONSTRAINT ck_atendimento_etapa_pa_origem CHECK (origem IN ('sistema','migracao','integracao')),
  KEY ix_atendimento_etapa_pa_atendimento (atendimento_id, ocorrida_em),
  KEY ix_atendimento_etapa_pa_usuario (usuario_id)
) COMMENT='Etapas do paciente no pronto atendimento, com momento e responsável';
