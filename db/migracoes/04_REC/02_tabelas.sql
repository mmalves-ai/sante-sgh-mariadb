-- REC, lote 02: senhas e marcação, serviço e situação do atendimento, domínios da recepção e valores padrão.
-- Sem FOREIGN KEY aqui; as chaves ficam em 02_chaves.sql.

CREATE TABLE senha_emitida_marcacao (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  senha_emitida_id    BIGINT UNSIGNED NOT NULL,
  marcacao_horario_id BIGINT UNSIGNED NOT NULL COMMENT 'Marcação da agenda (consulta ou exame) que motivou a chegada',
  criado_em           DATETIME(3) NOT NULL,
  criado_por          BIGINT UNSIGNED NULL,
  alterado_em         DATETIME(3) NULL,
  alterado_por        BIGINT UNSIGNED NULL,
  versao              INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em         DATETIME(3) NULL,
  excluido_por        BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_senha_emitida_marcacao_senha_marcacao (senha_emitida_id, marcacao_horario_id),
  KEY ix_senha_emitida_marcacao_marcacao_horario (marcacao_horario_id)
) COMMENT='Liga a senha à marcação da agenda que motivou a chegada';

CREATE TABLE servico_atendimento (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo                   VARCHAR(30) NOT NULL,
  descricao                VARCHAR(150) NOT NULL,
  ativo                    BOOLEAN NOT NULL DEFAULT TRUE,
  especialidade_medica_id  BIGINT UNSIGNED NULL COMMENT 'Especialidade associada ao serviço',
  anamnese_modelo_documento_clinico_id BIGINT UNSIGNED NULL COMMENT 'Modelo de anamnese aberto por padrão nos atendimentos do serviço',
  exige_caucao             BOOLEAN NOT NULL DEFAULT FALSE,
  valor_caucao_retido      DECIMAL(15,2) NULL COMMENT 'Valor de caução retido na abertura do atendimento',
  valor_caucao_deposito    DECIMAL(15,2) NULL COMMENT 'Valor de caução exigido em depósito',
  permite_solicitacao      BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'Pode figurar como serviço solicitante em pedidos e encaminhamentos',
  codigo_externo           VARCHAR(30) NULL COMMENT 'Código do serviço em sistema integrado',
  criado_em                DATETIME(3) NOT NULL,
  criado_por               BIGINT UNSIGNED NULL,
  alterado_em              DATETIME(3) NULL,
  alterado_por             BIGINT UNSIGNED NULL,
  versao                   INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_servico_atendimento_valor_caucao_retido CHECK (valor_caucao_retido IS NULL OR valor_caucao_retido >= 0),
  CONSTRAINT ck_servico_atendimento_valor_caucao_deposito CHECK (valor_caucao_deposito IS NULL OR valor_caucao_deposito >= 0),
  UNIQUE KEY uq_servico_atendimento_codigo (codigo),
  KEY ix_servico_atendimento_especialidade_medica (especialidade_medica_id),
  KEY ix_servico_atendimento_anamnese_modelo (anamnese_modelo_documento_clinico_id)
) COMMENT='Serviço clínico em que o atendimento é aberto (ortopedia, cardiologia), com especialidade, anamnese padrão e caução exigida';

CREATE TABLE situacao_atendimento (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo               VARCHAR(30) NOT NULL,
  descricao            VARCHAR(150) NOT NULL,
  ativo                BOOLEAN NOT NULL DEFAULT TRUE,
  fase                 VARCHAR(30) NOT NULL COMMENT 'Fase do fluxo a que a situação pertence',
  permite_atendimento  BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'O paciente pode ser atendido nesta situação',
  encerra_atendimento  BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Situação final (alta, cancelamento)',
  conta_como_triagem   BOOLEAN NOT NULL DEFAULT FALSE,
  ordem                SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Ordem de exibição no fluxo',
  criado_em            DATETIME(3) NOT NULL,
  criado_por           BIGINT UNSIGNED NULL,
  alterado_em          DATETIME(3) NULL,
  alterado_por         BIGINT UNSIGNED NULL,
  versao               INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_situacao_atendimento_fase CHECK (fase IN ('aberto','triagem','em_atendimento','alta','cancelado')),
  UNIQUE KEY uq_situacao_atendimento_codigo (codigo)
) COMMENT='Situações possíveis do atendimento (aberto, em triagem, em atendimento, alta, cancelado), indicando as que encerram ou contam como triagem';

CREATE TABLE tipo_indicacao (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo               VARCHAR(30) NOT NULL,
  descricao            VARCHAR(150) NOT NULL,
  ativo                BOOLEAN NOT NULL DEFAULT TRUE,
  categoria            VARCHAR(30) NOT NULL COMMENT 'Natureza de quem indicou',
  exige_profissional   BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Pede a identificação do profissional que indicou',
  exige_complemento    BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Pede texto identificando quem indicou',
  criado_em            DATETIME(3) NOT NULL,
  criado_por           BIGINT UNSIGNED NULL,
  alterado_em          DATETIME(3) NULL,
  alterado_por         BIGINT UNSIGNED NULL,
  versao               INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_tipo_indicacao_categoria CHECK (categoria IN ('colaborador','medico_externo','hospital','parceiro','proprio_paciente','formador_opiniao','outro')),
  UNIQUE KEY uq_tipo_indicacao_codigo (codigo)
) COMMENT='Quem indicou o paciente ou o atendimento (colaborador, médico externo, hospital, parceiro, o próprio)';

CREATE TABLE tipo_painel (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo               VARCHAR(30) NOT NULL,
  descricao            VARCHAR(150) NOT NULL,
  ativo                BOOLEAN NOT NULL DEFAULT TRUE,
  finalidade           VARCHAR(30) NOT NULL COMMENT 'O que o painel exibe',
  criado_em            DATETIME(3) NOT NULL,
  criado_por           BIGINT UNSIGNED NULL,
  alterado_em          DATETIME(3) NULL,
  alterado_por         BIGINT UNSIGNED NULL,
  versao               INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_tipo_painel_finalidade CHECK (finalidade IN ('senha','atendimento','portal','outro')),
  UNIQUE KEY uq_tipo_painel_codigo (codigo)
) COMMENT='Tipos de painel (senha, atendimento, portal)';

CREATE TABLE tipo_senha_autorizacao (
  id                              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo                          VARCHAR(30) NOT NULL,
  descricao                       VARCHAR(150) NOT NULL,
  ativo                           BOOLEAN NOT NULL DEFAULT TRUE,
  detalhamento                    VARCHAR(500) NULL COMMENT 'Explicação da regra para o usuário da recepção',
  quantidade_caracteres           SMALLINT UNSIGNED NULL COMMENT 'Tamanho exato exigido da senha; nulo quando livre',
  prefixo                         VARCHAR(100) NULL COMMENT 'Prefixo obrigatório da senha',
  prefixo_com_ano                 BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'O prefixo leva o ano corrente',
  sufixo                          VARCHAR(100) NULL COMMENT 'Sufixo obrigatório da senha',
  sufixo_com_ano                  BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'O sufixo leva o ano corrente',
  vale_ambulatorial               BOOLEAN NOT NULL DEFAULT FALSE,
  limite_atendimentos_ambulatorial SMALLINT UNSIGNED NULL COMMENT 'Quantos atendimentos ambulatoriais uma senha cobre; nulo sem limite',
  vale_internacao                 BOOLEAN NOT NULL DEFAULT FALSE,
  limite_atendimentos_internacao  SMALLINT UNSIGNED NULL,
  vale_externo                    BOOLEAN NOT NULL DEFAULT FALSE,
  limite_atendimentos_externo     SMALLINT UNSIGNED NULL,
  validade_meses                  SMALLINT UNSIGNED NULL COMMENT 'Meses até a senha expirar',
  validade_meses_apos_falta       SMALLINT UNSIGNED NULL COMMENT 'Meses de validade quando o paciente atinge o limite de faltas',
  limite_faltas                   SMALLINT UNSIGNED NULL,
  compartilhada                   BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Uma senha pode servir a mais de um atendimento ou serviço',
  abrangencia_especialidade       VARCHAR(30) NOT NULL DEFAULT 'todas' COMMENT 'Especialidades em que a regra é verificada',
  criado_em                       DATETIME(3) NOT NULL,
  criado_por                      BIGINT UNSIGNED NULL,
  alterado_em                     DATETIME(3) NULL,
  alterado_por                    BIGINT UNSIGNED NULL,
  versao                          INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_tipo_senha_autorizacao_abrangencia CHECK (abrangencia_especialidade IN ('todas','selecionadas','nenhuma')),
  CONSTRAINT ck_tipo_senha_autorizacao_quantidade CHECK (quantidade_caracteres IS NULL OR quantidade_caracteres BETWEEN 1 AND 100),
  CONSTRAINT ck_tipo_senha_autorizacao_uso CHECK (vale_ambulatorial OR vale_internacao OR vale_externo),
  UNIQUE KEY uq_tipo_senha_autorizacao_codigo (codigo)
) COMMENT='Tipos de senha de autorização da operadora (consulta, exame, internação), com regra de formato';

CREATE TABLE valor_padrao_recepcao (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id   BIGINT UNSIGNED NOT NULL,
  usuario_id           BIGINT UNSIGNED NULL COMMENT 'Usuário a quem o padrão se aplica; nulo para todos',
  estacao_trabalho_id  BIGINT UNSIGNED NULL COMMENT 'Estação a que o padrão se aplica; nulo para todas',
  contexto             VARCHAR(30) NOT NULL COMMENT 'Tela em que o padrão é aplicado',
  tipo_atendimento     VARCHAR(30) NULL COMMENT 'Tipo de atendimento a que o padrão se restringe; nulo para todos',
  campo                VARCHAR(60) NOT NULL COMMENT 'Nome técnico do campo da tela',
  rotulo               VARCHAR(150) NULL COMMENT 'Rótulo exibido para o campo',
  valor                VARCHAR(500) NOT NULL COMMENT 'Valor padrão (id ou texto) gravado como texto',
  ordem                SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ativo                BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em            DATETIME(3) NOT NULL,
  criado_por           BIGINT UNSIGNED NULL,
  alterado_em          DATETIME(3) NULL,
  alterado_por         BIGINT UNSIGNED NULL,
  versao               INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_valor_padrao_recepcao_contexto CHECK (contexto IN ('atendimento','agendamento')),
  CONSTRAINT ck_valor_padrao_recepcao_tipo_atendimento CHECK (tipo_atendimento IS NULL OR tipo_atendimento IN ('ambulatorial','urgencia','internacao','externo','exame','domiciliar')),
  UNIQUE KEY uq_valor_padrao_recepcao_escopo_campo (estabelecimento_id, usuario_id, estacao_trabalho_id, contexto, tipo_atendimento, campo),
  KEY ix_valor_padrao_recepcao_usuario (usuario_id),
  KEY ix_valor_padrao_recepcao_estacao_trabalho (estacao_trabalho_id)
) COMMENT='Valores padrão de campos da recepção por usuário ou estação (local, fonte pagadora, tipo)';
