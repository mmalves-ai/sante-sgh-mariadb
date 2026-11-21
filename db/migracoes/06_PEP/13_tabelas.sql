-- PEP, lote 13 (F2.2 onda 1): termo exigido na recepção, impressão digital e licença dos protocolos publicados,
-- código longo do fluxograma, CBO do rascunho, registros do protocolo gerenciado e aviso de estouro da classificação.
-- Sem FOREIGN KEY aqui (13_chaves.sql).

ALTER TABLE termo_consentimento_modelo
  ADD COLUMN tipos_atendimento JSON NULL COMMENT 'Tipos de atendimento em que o termo é pedido na recepção',
  ADD COLUMN exigido_recepcao BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN resumo_texto CHAR(64) NULL COMMENT 'SHA-256 do texto da versão',
  DROP CONSTRAINT ck_termo_consentimento_modelo_finalidade,
  ADD CONSTRAINT ck_termo_consentimento_modelo_finalidade CHECK (finalidade IN ('procedimento','cirurgia','anestesia','sedacao','transfusao','quimioterapia','exame','imagem','pesquisa','internacao','uso_imagem','geral','atendimento','comunicacao','compartilhamento_rede','protecao_dados')),
  ADD CONSTRAINT ck_termo_consentimento_modelo_tipos CHECK (tipos_atendimento IS NULL OR JSON_TYPE(tipos_atendimento) = 'ARRAY');

ALTER TABLE protocolo_classificacao_risco_versao
  ADD COLUMN impressao CHAR(64) NULL COMMENT 'SHA-256 do JSON canônico do conteúdo publicado',
  ADD COLUMN licenca_registro VARCHAR(60) NULL,
  ADD COLUMN licenca_titular VARCHAR(150) NULL,
  ADD COLUMN licenca_valida_ate DATE NULL,
  ADD CONSTRAINT ck_protocolo_classificacao_risco_versao_licenca CHECK ((licenca_registro IS NULL) = (licenca_valida_ate IS NULL));

ALTER TABLE protocolo_gerenciado_versao
  ADD COLUMN impressao CHAR(64) NULL COMMENT 'SHA-256 do JSON canônico do conteúdo publicado';

ALTER TABLE fluxograma_classificacao_risco MODIFY codigo VARCHAR(60) NULL;

ALTER TABLE registro_assistencial_rascunho
  ADD COLUMN ocupacao_cbo_id BIGINT UNSIGNED NULL COMMENT 'Ocupação com que o autor abriu o rascunho',
  ADD KEY ix_registro_assistencial_rascunho_ocupacao_cbo (ocupacao_cbo_id);

CREATE TABLE inclusao_protocolo_registro (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  inclusao_protocolo_paciente_id BIGINT UNSIGNED NOT NULL,
  tipo               VARCHAR(20) NOT NULL,
  codigo             VARCHAR(40) NOT NULL COMMENT 'Código da meta ou do item de checklist no protocolo publicado',
  situacao           VARCHAR(30) NOT NULL,
  ocorrido_em        DATETIME(3) NULL,
  prazo_em           DATETIME(3) NULL,
  motivo             VARCHAR(500) NULL,
  usuario_id         BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  origem             VARCHAR(20) NOT NULL DEFAULT 'sistema',
  CONSTRAINT ck_inclusao_protocolo_registro_tipo CHECK (tipo IN ('meta','checklist','encerramento')),
  CONSTRAINT ck_inclusao_protocolo_registro_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_inclusao_protocolo_registro_codigo (inclusao_protocolo_paciente_id, tipo, codigo),
  KEY ix_inclusao_protocolo_registro_usuario (usuario_id)
) COMMENT='Metas, checklist e encerramento do protocolo gerenciado do paciente (uma vez cada)';

CREATE TABLE aviso_estouro_classificacao (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  classificacao_risco_id BIGINT UNSIGNED NOT NULL,
  chave              VARCHAR(80) NOT NULL COMMENT 'Chave do aviso (uma vez por chave)',
  prazo_em           DATETIME(3) NOT NULL,
  avisado_em         DATETIME(3) NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_aviso_estouro_classificacao_chave (chave),
  KEY ix_aviso_estouro_classificacao_classificacao_risco (classificacao_risco_id)
) COMMENT='Aviso de estouro do tempo-alvo da classificação de risco, uma vez por chave';
