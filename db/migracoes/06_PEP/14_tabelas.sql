-- PEP, lote 14 (F2.2 onda 2; pedidos dos lotes 02-01, 02-04, 02-05, 02-06): tabelas e colunas que as portas próprias pedem.
-- Convenções do ADR 0002 (parte 2). Sem FOREIGN KEY aqui (14_chaves.sql).

CREATE TABLE pedido_numeracao_receita (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  documento_prontuario_id BIGINT UNSIGNED NOT NULL,
  entidade_origem_id BIGINT UNSIGNED NOT NULL COMMENT 'Receita que originou o documento',
  tipo_receita VARCHAR(20) NOT NULL,
  medicamentos SMALLINT UNSIGNED NOT NULL,
  situacao VARCHAR(20) NOT NULL DEFAULT 'pendente',
  tentativas SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  numero VARCHAR(40) NULL,
  retorno VARCHAR(60) NULL COMMENT 'Código do retorno do serviço (nunca o texto)',
  usuario_id BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_pedido_numeracao_receita_tipo CHECK (tipo_receita IN ('controle-especial','antimicrobiano')),
  CONSTRAINT ck_pedido_numeracao_receita_situacao CHECK (situacao IN ('pendente','numerada','recusada','erro')),
  CONSTRAINT ck_pedido_numeracao_receita_numero CHECK (situacao <> 'numerada' OR numero IS NOT NULL),
  KEY ix_pedido_numeracao_receita_documento (documento_prontuario_id),
  KEY ix_pedido_numeracao_receita_fila (estabelecimento_id, situacao),
  KEY ix_pedido_numeracao_receita_usuario_id (usuario_id)
) COMMENT='Pedido de numeração da receita controlada no serviço nacional, com tentativas e retorno';

CREATE TABLE conflito_sincronizacao_checagem (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  horario_administracao_id BIGINT UNSIGNED NOT NULL,
  paciente_id BIGINT UNSIGNED NOT NULL,
  chave_ato VARCHAR(80) NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  situacao_encontrada_id BIGINT UNSIGNED NULL,
  desfecho_tentado VARCHAR(20) NOT NULL,
  ocorrido_em DATETIME(3) NOT NULL,
  aparelho_beira_leito_id BIGINT UNSIGNED NULL,
  resolucao VARCHAR(30) NULL,
  resolvido_por_usuario_id BIGINT UNSIGNED NULL,
  resolvido_em DATETIME(3) NULL,
  observacao VARCHAR(500) NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_conflito_sincronizacao_checagem_tipo CHECK (tipo IN ('suspenso','ja_checado','mudou')),
  CONSTRAINT ck_conflito_sincronizacao_checagem_resolucao CHECK ((resolucao IS NULL) = (resolvido_em IS NULL)),
  UNIQUE KEY uq_conflito_sincronizacao_checagem_chave (estabelecimento_id, chave_ato),
  KEY ix_conflito_sincronizacao_checagem_horario (horario_administracao_id)
) COMMENT='Conflito do ato de checagem feito sem conexão com o horário que mudou, e a resolução';

CREATE TABLE aparelho_beira_leito (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  unidade_internacao_id BIGINT UNSIGNED NOT NULL,
  nome VARCHAR(80) NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  identificador_hash CHAR(64) NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_sincronismo_em DATETIME(3) NULL,
  motivo_alteracao VARCHAR(300) NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_aparelho_beira_leito_tipo CHECK (tipo IN ('tablet','coletor','celular')),
  UNIQUE KEY uq_aparelho_beira_leito_hash (estabelecimento_id, identificador_hash)
) COMMENT='Aparelho autorizado da checagem à beira do leito';

CREATE TABLE reavaliacao_escala (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  paciente_id BIGINT UNSIGNED NOT NULL,
  internacao_id BIGINT UNSIGNED NULL,
  escala_clinica_id BIGINT UNSIGNED NOT NULL,
  motivo VARCHAR(20) NOT NULL,
  chave VARCHAR(80) NOT NULL,
  devida_em DATETIME(3) NOT NULL,
  prazo_em DATETIME(3) NOT NULL,
  situacao VARCHAR(20) NOT NULL DEFAULT 'pendente',
  cumprida_em DATETIME(3) NULL,
  aplicacao_escala_id BIGINT UNSIGNED NULL,
  motivo_dispensa VARCHAR(300) NULL,
  observacao VARCHAR(300) NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_reavaliacao_escala_motivo CHECK (motivo IN ('admissao','diaria','mudanca_quadro')),
  CONSTRAINT ck_reavaliacao_escala_situacao CHECK (situacao IN ('pendente','cumprida','dispensada')),
  CONSTRAINT ck_reavaliacao_escala_prazo CHECK (prazo_em >= devida_em),
  UNIQUE KEY uq_reavaliacao_escala_chave (estabelecimento_id, chave)
) COMMENT='Reavaliação programada de escala de risco';

CREATE TABLE classificacao_paciente (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  paciente_id BIGINT UNSIGNED NOT NULL,
  internacao_id BIGINT UNSIGNED NOT NULL,
  unidade_internacao_id BIGINT UNSIGNED NOT NULL,
  data_referencia DATE NOT NULL,
  turno VARCHAR(10) NOT NULL,
  instrumento VARCHAR(10) NOT NULL,
  itens JSON NOT NULL,
  total DECIMAL(7,2) NOT NULL,
  categoria VARCHAR(30) NOT NULL,
  horas_24h DECIMAL(5,2) NOT NULL,
  situacao VARCHAR(20) NOT NULL DEFAULT 'valida',
  motivo_estorno VARCHAR(300) NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_classificacao_paciente_turno CHECK (turno IN ('diurno','noturno')),
  CONSTRAINT ck_classificacao_paciente_instrumento CHECK (instrumento IN ('fugulin','nas')),
  CONSTRAINT ck_classificacao_paciente_situacao CHECK (situacao IN ('valida','estornada'))
) COMMENT='Classificação de pacientes por grau de dependência da enfermagem';

CREATE TABLE indice_gravidade_uti (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  paciente_id BIGINT UNSIGNED NOT NULL,
  internacao_id BIGINT UNSIGNED NULL,
  indice VARCHAR(10) NOT NULL,
  variaveis JSON NOT NULL,
  pontuacao DECIMAL(7,2) NOT NULL,
  categoria_diagnostica SMALLINT NULL,
  tipo_admissao VARCHAR(20) NULL,
  mortalidade_estimada DECIMAL(5,2) NULL,
  coletado_em DATETIME(3) NOT NULL,
  situacao VARCHAR(20) NOT NULL DEFAULT 'registrado',
  validado_por_profissional_id BIGINT UNSIGNED NULL,
  validado_em DATETIME(3) NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_indice_gravidade_uti_indice CHECK (indice IN ('apache2','sofa')),
  CONSTRAINT ck_indice_gravidade_uti_situacao CHECK (situacao IN ('registrado','validado','estornado')),
  CONSTRAINT ck_indice_gravidade_uti_validacao CHECK (situacao <> 'validado' OR (validado_em IS NOT NULL AND validado_por_profissional_id IS NOT NULL))
) COMMENT='Índice de gravidade da UTI';

CREATE TABLE parada_cardiorrespiratoria_ficha (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  paciente_id BIGINT UNSIGNED NOT NULL,
  atendimento_id BIGINT UNSIGNED NOT NULL,
  acionamento_resposta_rapida_id BIGINT UNSIGNED NULL,
  anterior_ficha_id BIGINT UNSIGNED NULL,
  numero_versao SMALLINT UNSIGNED NOT NULL,
  situacao VARCHAR(20) NOT NULL,
  colapso_em DATETIME(3) NOT NULL,
  unidade_internacao_id BIGINT UNSIGNED NULL,
  em_uti BOOLEAN NOT NULL DEFAULT FALSE,
  dados JSON NOT NULL,
  motivo_correcao VARCHAR(500) NULL,
  inativada BOOLEAN NOT NULL DEFAULT FALSE,
  motivo_inativacao VARCHAR(300) NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_parada_cardiorrespiratoria_ficha_situacao CHECK (situacao IN ('rascunho','finalizada'))
) COMMENT='Ficha da parada cardiorrespiratória (Utstein), por versão';

CREATE TABLE passagem_turno_pendencia (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  passagem_turno_paciente_id BIGINT UNSIGNED NOT NULL,
  sequencia SMALLINT UNSIGNED NOT NULL,
  descricao VARCHAR(500) NOT NULL,
  prazo_em DATETIME(3) NULL,
  resolvida BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_passagem_turno_pendencia_sequencia (passagem_turno_paciente_id, sequencia)
) COMMENT='Pendência de cada paciente na passagem de plantão';

CREATE TABLE emissao_documento (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  codigo CHAR(36) NOT NULL COMMENT 'Identificador público da emissão (UUID)',
  rede VARCHAR(63) NOT NULL COMMENT 'Segmento da rede na chave do objeto',
  estabelecimento_codigo VARCHAR(20) NOT NULL COMMENT 'Segmento do estabelecimento na chave do objeto',
  modelo VARCHAR(40) NOT NULL,
  versao_modelo VARCHAR(20) NOT NULL,
  origem_tipo VARCHAR(40) NOT NULL COMMENT 'Tipo do registro de origem do documento',
  origem_registro_id BIGINT UNSIGNED NOT NULL,
  via SMALLINT UNSIGNED NOT NULL,
  original_emissao_documento_id BIGINT UNSIGNED NULL COMMENT 'Emissão original (via 1) da reemissão',
  motivo_reemissao VARCHAR(200) NULL,
  hash_conteudo CHAR(64) NOT NULL COMMENT 'SHA-256 do PDF gravado',
  chave_objeto VARCHAR(300) NOT NULL COMMENT 'Chave do objeto no armazenamento imutável',
  identificador_qr VARCHAR(64) NOT NULL,
  autor VARCHAR(60) NOT NULL COMMENT 'Login de quem emitiu, no momento da emissão',
  autor_usuario_id BIGINT UNSIGNED NULL,
  emitido_em DATETIME(3) NOT NULL,
  versao_objeto VARCHAR(100) NULL COMMENT 'Versão do objeto gravado (a leitura é sempre por ela)',
  situacao VARCHAR(20) NOT NULL DEFAULT 'reservada',
  confirmado_em DATETIME(3) NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_emissao_documento_situacao CHECK (situacao IN ('reservada','emitida')),
  CONSTRAINT ck_emissao_documento_confirmacao CHECK ((situacao = 'reservada' AND versao_objeto IS NULL AND confirmado_em IS NULL) OR (situacao = 'emitida' AND versao_objeto IS NOT NULL AND confirmado_em IS NOT NULL)),
  CONSTRAINT ck_emissao_documento_via CHECK (via >= 1 AND ((via = 1) = (original_emissao_documento_id IS NULL))),
  CONSTRAINT ck_emissao_documento_reemissao CHECK (via = 1 OR motivo_reemissao IS NOT NULL),
  CONSTRAINT ck_emissao_documento_hash CHECK (hash_conteudo REGEXP '^[0-9a-f]{64}$'),
  UNIQUE KEY uq_emissao_documento_codigo (codigo),
  UNIQUE KEY uq_emissao_documento_chave_objeto (chave_objeto),
  UNIQUE KEY uq_emissao_documento_identificador_qr (identificador_qr),
  UNIQUE KEY uq_emissao_documento_original_via (original_emissao_documento_id, via),
  KEY ix_emissao_documento_origem (origem_tipo, origem_registro_id),
  KEY ix_emissao_documento_estabelecimento (estabelecimento_id, emitido_em),
  KEY ix_emissao_documento_autor_usuario_id (autor_usuario_id)
) COMMENT='Emissão de documento em PDF imutável: via, chave do objeto, QR de validação e hash';

ALTER TABLE balanco_lancamento
  ADD COLUMN horario_administracao_id BIGINT UNSIGNED NULL AFTER prescricao_item_id,
  ADD COLUMN chave_ato VARCHAR(80) NULL COMMENT 'Idempotency-Key do ato + posição (reenvio do aparelho)',
  ADD UNIQUE KEY uq_balanco_lancamento_chave_ato (balanco_hidrico_paciente_id, chave_ato),
  ADD KEY ix_balanco_lancamento_horario (horario_administracao_id);

ALTER TABLE balanco_fechamento
  ADD COLUMN diurese_ml DECIMAL(15,4) NULL,
  ADD COLUMN debito_urinario DECIMAL(10,4) NULL,
  ADD COLUMN oliguria BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN temperatura_maxima DECIMAL(4,1) NULL,
  ADD COLUMN quantidade_lancamentos INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN parcelas JSON NULL,
  ADD CONSTRAINT ck_balanco_fechamento_diurese CHECK (diurese_ml IS NULL OR diurese_ml >= 0);

ALTER TABLE horario_administracao_evento
  ADD COLUMN velocidade_ml_h DECIMAL(10,2) NULL,
  ADD COLUMN volume_infundido_ml DECIMAL(10,2) NULL,
  DROP CONSTRAINT ck_horario_administracao_evento_evento,
  ADD CONSTRAINT ck_horario_administracao_evento_evento CHECK (evento IN ('geracao','aprazamento','reaprazamento','checagem','nao_administrado','estorno','suspensao','conferencia','etiqueta_impressa','infusao_inicio','infusao_pausa','infusao_velocidade','infusao_termino'));

ALTER TABLE aplicacao_escala
  ADD COLUMN gatilho VARCHAR(20) NULL,
  ADD COLUMN faixa VARCHAR(30) NULL,
  ADD COLUMN escala_clinica_versao_id BIGINT UNSIGNED NULL,
  ADD COLUMN suspeita_infeccao BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN motivo_inativacao VARCHAR(300) NULL;

ALTER TABLE afericao_valor
  ADD COLUMN retifica_afericao_valor_id BIGINT UNSIGNED NULL COMMENT 'Valor que esta linha retifica',
  ADD COLUMN motivo_retificacao VARCHAR(500) NULL,
  ADD CONSTRAINT ck_afericao_valor_retificacao CHECK ((retifica_afericao_valor_id IS NULL) = (motivo_retificacao IS NULL)),
  ADD UNIQUE KEY uq_afericao_valor_retifica (retifica_afericao_valor_id);

ALTER TABLE passagem_turno
  ADD COLUMN data_referencia DATE NULL COMMENT 'Dia do turno passado';

ALTER TABLE passagem_turno_paciente
  ADD COLUMN situacao_sbar VARCHAR(2000) NULL,
  ADD COLUMN historia_sbar VARCHAR(2000) NULL,
  ADD COLUMN avaliacao_sbar VARCHAR(2000) NULL,
  ADD COLUMN recomendacao_sbar VARCHAR(2000) NULL;

ALTER TABLE receita_medica
  ADD COLUMN protocolo_enfermagem VARCHAR(60) NULL COMMENT 'Protocolo que autoriza a prescrição do enfermeiro',
  ADD COLUMN tipo_protocolo_enfermagem VARCHAR(20) NULL,
  ADD COLUMN versao_lista_enfermagem VARCHAR(30) NULL COMMENT 'Versão da lista de medicamentos do protocolo',
  ADD COLUMN segundo_identificador VARCHAR(20) NULL COMMENT 'O segundo identificador impresso do paciente',
  ADD CONSTRAINT ck_receita_medica_tipo_protocolo CHECK (tipo_protocolo_enfermagem IS NULL OR tipo_protocolo_enfermagem IN ('institucional','programa')),
  ADD CONSTRAINT ck_receita_medica_segundo_identificador CHECK (segundo_identificador IS NULL OR segundo_identificador IN ('cpf','nascimento')),
  ADD CONSTRAINT ck_receita_medica_protocolo_completo CHECK (protocolo_enfermagem IS NULL OR (tipo_protocolo_enfermagem IS NOT NULL AND versao_lista_enfermagem IS NOT NULL AND segundo_identificador IS NOT NULL));

ALTER TABLE processo_enfermagem
  ADD COLUMN terminologia_edicao_id BIGINT UNSIGNED NULL COMMENT 'Edição da classificação usada (NNN, CIPE ou a sintética)' AFTER setor_funcional_id,
  ADD KEY ix_processo_enfermagem_terminologia_edicao (terminologia_edicao_id);
