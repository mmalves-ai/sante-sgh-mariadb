-- F2.4 (dívida da migração), 2ª volta: DDL pedido pelos lotes, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v2.md

ALTER TABLE horario_administracao_evento
  DROP CONSTRAINT IF EXISTS ck_horario_administracao_evento_evento,
  ADD CONSTRAINT ck_horario_administracao_evento_evento CHECK (evento IN ('geracao','aprazamento','reaprazamento','checagem','nao_administrado','estorno','suspensao','conferencia','etiqueta_impressa','infusao_inicio','infusao_pausa','infusao_retomada','infusao_troca_bolsa','infusao_velocidade','infusao_termino'));
ALTER TABLE inclusao_protocolo_evento
  DROP CONSTRAINT IF EXISTS ck_inclusao_protocolo_evento_evento,
  ADD CONSTRAINT ck_inclusao_protocolo_evento_evento CHECK (evento IN ('sugestao','aceite','descarte','troca_etapa','nao_conformidade','avaliacao_justificativa','saida','reabertura','meta','checklist'));
ALTER TABLE lesao_pele_avaliacao
  ADD COLUMN IF NOT EXISTS dados JSON NULL COMMENT 'Ficha e curativo registrados na tela, em JSON',
  ADD COLUMN IF NOT EXISTS inativada BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Lançada por engano: fica visível, inativa',
  ADD COLUMN IF NOT EXISTS motivo_inativacao VARCHAR(300) NULL,
  DROP CONSTRAINT IF EXISTS ck_lesao_pele_avaliacao_tipo,
  ADD CONSTRAINT ck_lesao_pele_avaliacao_tipo CHECK (tipo_avaliacao IN ('ficha','curativo','reavaliacao','foto')),
  DROP CONSTRAINT IF EXISTS ck_lesao_pele_avaliacao_foto,
  ADD CONSTRAINT ck_lesao_pele_avaliacao_foto CHECK (tipo_avaliacao <> 'foto' OR anexo_prontuario_id IS NOT NULL OR foto_arquivo_id IS NOT NULL),
  DROP CONSTRAINT IF EXISTS ck_lesao_pele_avaliacao_dados,
  ADD CONSTRAINT ck_lesao_pele_avaliacao_dados CHECK (dados IS NULL OR JSON_VALID(dados)),
  DROP CONSTRAINT IF EXISTS ck_lesao_pele_avaliacao_inativacao,
  ADD CONSTRAINT ck_lesao_pele_avaliacao_inativacao CHECK (inativada = 0 OR motivo_inativacao IS NOT NULL);
ALTER TABLE lesao_pele_paciente
  ADD COLUMN IF NOT EXISTS inativada BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Lançada por engano: fica visível, inativa',
  ADD COLUMN IF NOT EXISTS motivo_inativacao VARCHAR(300) NULL,
  DROP CONSTRAINT IF EXISTS ck_lesao_pele_paciente_inativacao,
  ADD CONSTRAINT ck_lesao_pele_paciente_inativacao CHECK (inativada = 0 OR motivo_inativacao IS NOT NULL);

CREATE TABLE IF NOT EXISTS registro_assistencial_extensao (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  registro_assistencial_id BIGINT UNSIGNED NOT NULL,
  componente VARCHAR(20) NOT NULL COMMENT 'Sinal vital, mapa corporal ou anexo ligado ao registro',
  chave VARCHAR(80) NOT NULL COMMENT 'Identificador do item dentro do componente',
  valor TEXT NULL,
  referencia_id BIGINT UNSIGNED NULL COMMENT 'Registro ligado (sinal vital, anexo), conforme o componente',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_registro_assistencial_extensao_componente CHECK (componente IN ('sinal_vital','mapa_corporal','anexo')),
  CONSTRAINT ck_registro_assistencial_extensao_conteudo CHECK (valor IS NOT NULL OR referencia_id IS NOT NULL),
  UNIQUE KEY uq_registro_assistencial_extensao_chave (registro_assistencial_id, componente, chave)
) COMMENT='Resposta de extensão do formulário clínico: sinal vital, mapa corporal ou anexo ligado ao registro';

CREATE TABLE IF NOT EXISTS acionamento_resposta_rapida_evento (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  acionamento_resposta_rapida_id BIGINT UNSIGNED NOT NULL,
  tipo VARCHAR(20) NOT NULL COMMENT 'Chegada do time ou desfecho',
  ocorrido_em DATETIME(3) NULL,
  desfecho VARCHAR(30) NULL,
  anterior_evento_id BIGINT UNSIGNED NULL COMMENT 'Versão corrigida por esta retificação',
  motivo VARCHAR(500) NULL COMMENT 'Motivo da retificação',
  inativado BOOLEAN NOT NULL DEFAULT FALSE,
  motivo_inativacao VARCHAR(300) NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_acionamento_resposta_rapida_evento_tipo CHECK (tipo IN ('chegada','desfecho')),
  CONSTRAINT ck_acionamento_resposta_rapida_evento_chegada CHECK (tipo <> 'chegada' OR ocorrido_em IS NOT NULL),
  CONSTRAINT ck_acionamento_resposta_rapida_evento_desfecho CHECK (desfecho IS NULL OR desfecho IN ('permanece','transferido_uti','pcr','obito','paliativo')),
  CONSTRAINT ck_acionamento_resposta_rapida_evento_desfecho_tipo CHECK (tipo <> 'desfecho' OR desfecho IS NOT NULL),
  CONSTRAINT ck_acionamento_resposta_rapida_evento_retificacao CHECK (anterior_evento_id IS NULL OR motivo IS NOT NULL),
  CONSTRAINT ck_acionamento_resposta_rapida_evento_inativacao CHECK (inativado = 0 OR motivo_inativacao IS NOT NULL),
  UNIQUE KEY uq_acionamento_resposta_rapida_evento_anterior (anterior_evento_id),
  KEY ix_acionamento_resposta_rapida_evento_acionamento (acionamento_resposta_rapida_id, tipo)
) COMMENT='Chegada e desfecho do time de resposta rápida, versionados: a retificação aponta a versão corrigida';

ALTER TABLE notificacao_agravo
  MODIFY COLUMN notificante_profissional_id BIGINT UNSIGNED NULL COMMENT 'Nulo no caso aberto pelo gatilho automático (quem abriu fica em criado_por)',
  ADD COLUMN IF NOT EXISTS origem_gatilho VARCHAR(10) NOT NULL DEFAULT 'manual' COMMENT 'O que abriu o caso: CID, exame, óbito ou registro manual',
  ADD COLUMN IF NOT EXISTS chave_gatilho VARCHAR(120) NULL COMMENT 'Chave idempotente do gatilho',
  ADD COLUMN IF NOT EXISTS exame_id BIGINT UNSIGNED NULL COMMENT 'Exame cujo resultado disparou o caso',
  ADD COLUMN IF NOT EXISTS periodicidade VARCHAR(10) NOT NULL DEFAULT 'imediata',
  ADD COLUMN IF NOT EXISTS gatilho_em DATETIME(3) NULL COMMENT 'Instante do fato que disparou o caso',
  ADD COLUMN IF NOT EXISTS autoridade VARCHAR(5) NULL COMMENT 'Autoridade notificada: municipal, estadual ou federal',
  ADD COLUMN IF NOT EXISTS canal VARCHAR(60) NULL,
  ADD COLUMN IF NOT EXISTS notificada_em DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS recebido_por VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS observacao_notificacao VARCHAR(2000) NULL,
  ADD COLUMN IF NOT EXISTS motivo_descarte VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS justificativa_descarte VARCHAR(2000) NULL,
  ADD COLUMN IF NOT EXISTS encerrado_em DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS encerrado_por_usuario_id BIGINT UNSIGNED NULL,
  DROP CONSTRAINT IF EXISTS ck_notificacao_agravo_origem_gatilho,
  ADD CONSTRAINT ck_notificacao_agravo_origem_gatilho CHECK (origem_gatilho IN ('cid','exame','obito','manual')),
  DROP CONSTRAINT IF EXISTS ck_notificacao_agravo_gatilho,
  ADD CONSTRAINT ck_notificacao_agravo_gatilho CHECK (origem_gatilho = 'manual' OR (chave_gatilho IS NOT NULL AND gatilho_em IS NOT NULL)),
  DROP CONSTRAINT IF EXISTS ck_notificacao_agravo_periodicidade,
  ADD CONSTRAINT ck_notificacao_agravo_periodicidade CHECK (periodicidade IN ('imediata','semanal')),
  DROP CONSTRAINT IF EXISTS ck_notificacao_agravo_autoridade,
  ADD CONSTRAINT ck_notificacao_agravo_autoridade CHECK (autoridade IS NULL OR autoridade IN ('sms','ses','ms')),
  DROP CONSTRAINT IF EXISTS ck_notificacao_agravo_descarte,
  ADD CONSTRAINT ck_notificacao_agravo_descarte CHECK (situacao <> 'descartada' OR (motivo_descarte IS NOT NULL AND justificativa_descarte IS NOT NULL)),
  DROP CONSTRAINT IF EXISTS ck_notificacao_agravo_notificada,
  ADD CONSTRAINT ck_notificacao_agravo_notificada CHECK (situacao <> 'notificada' OR (autoridade IS NOT NULL AND notificada_em IS NOT NULL)),
  DROP CONSTRAINT IF EXISTS ck_notificacao_agravo_encerramento,
  ADD CONSTRAINT ck_notificacao_agravo_encerramento CHECK (encerrado_em IS NULL OR encerrado_por_usuario_id IS NOT NULL),
  ADD UNIQUE KEY IF NOT EXISTS uq_notificacao_agravo_chave_gatilho (estabelecimento_id, chave_gatilho),
  ADD KEY IF NOT EXISTS ix_notificacao_agravo_exame (exame_id),
  ADD KEY IF NOT EXISTS ix_notificacao_agravo_encerrado_por (encerrado_por_usuario_id);

CREATE TABLE IF NOT EXISTS gatilho_exame_agravo (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  padrao VARCHAR(120) NOT NULL COMMENT 'Texto ou expressão do nome do exame',
  exceto VARCHAR(120) NULL COMMENT 'Texto que, presente no nome, exclui o exame',
  codigo_cid10 VARCHAR(6) NOT NULL COMMENT 'CID do agravo aberto pelo resultado reagente',
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  vigente_chave TINYINT AS (IF(excluido_em IS NULL, 1, NULL)) PERSISTENT COMMENT 'Só para a unicidade entre os não excluídos',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_gatilho_exame_agravo_padrao (estabelecimento_id, padrao, codigo_cid10, vigente_chave)
) COMMENT='Gatilho de agravo por resultado de exame: o resultado reagente do exame que casa o padrão abre o caso pelo CID';
