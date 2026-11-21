-- Pedido do lote 03-02 (F2.2, onda 3): o índice e o ciclo da digitalização certificada no documento_digitalizado
-- (09_HOT). Só para frente; convenções do ADR 0002. As FKs vão para o _chaves.sql do grupo.
ALTER TABLE documento_digitalizado
  ADD COLUMN lote_digitalizacao_id BIGINT UNSIGNED NULL COMMENT 'Lote de digitalização em que o documento entrou' AFTER volume_prontuario_id,
  ADD COLUMN ordem_lote SMALLINT UNSIGNED NULL COMMENT 'Ordem do documento no lote' AFTER lote_digitalizacao_id,
  ADD COLUMN descricao VARCHAR(120) NULL COMMENT 'Descrição do documento no índice' AFTER tipo_documento_arquivo_id,
  ADD COLUMN resolucao_dpi SMALLINT UNSIGNED NULL COMMENT 'Resolução da imagem (Decreto 10.278/2020)' AFTER quantidade_paginas,
  ADD COLUMN cor VARCHAR(20) NULL COMMENT 'Modo de cor da captura' AFTER resolucao_dpi,
  ADD COLUMN motivo_rejeicao VARCHAR(200) NULL COMMENT 'Motivo da recusa na conferência da fidelidade' AFTER conferente_usuario_id,
  ADD COLUMN assinatura_icp_id BIGINT UNSIGNED NULL COMMENT 'Assinatura ICP-Brasil de quem conferiu' AFTER motivo_rejeicao,
  ADD COLUMN assinado_em DATETIME(3) NULL AFTER assinatura_icp_id,
  DROP CONSTRAINT ck_documento_digitalizado_situacao,
  ADD CONSTRAINT ck_documento_digitalizado_situacao CHECK (situacao IN ('pendente_conferencia','conferido','rejeitado','assinado','substituido')),
  ADD CONSTRAINT ck_documento_digitalizado_cor CHECK (cor IS NULL OR cor IN ('monocromatico','cinza','colorido')),
  ADD CONSTRAINT ck_documento_digitalizado_resolucao CHECK (resolucao_dpi IS NULL OR resolucao_dpi BETWEEN 75 AND 1200),
  ADD CONSTRAINT ck_documento_digitalizado_ordem CHECK (ordem_lote IS NULL OR (ordem_lote > 0 AND lote_digitalizacao_id IS NOT NULL)),
  ADD CONSTRAINT ck_documento_digitalizado_rejeicao CHECK (situacao <> 'rejeitado' OR (motivo_rejeicao IS NOT NULL AND conferente_usuario_id IS NOT NULL AND conferido_em IS NOT NULL)),
  ADD CONSTRAINT ck_documento_digitalizado_assinado CHECK (situacao <> 'assinado' OR (conferido AND assinatura_icp_id IS NOT NULL AND assinado_em IS NOT NULL)),
  ADD CONSTRAINT ck_documento_digitalizado_segregacao CHECK (conferente_usuario_id IS NULL OR conferente_usuario_id <> digitalizador_usuario_id),
  ADD UNIQUE KEY uq_documento_digitalizado_lote_ordem (lote_digitalizacao_id, ordem_lote),
  ADD UNIQUE KEY uq_documento_digitalizado_assinatura_icp (assinatura_icp_id);
-- _chaves.sql
ALTER TABLE documento_digitalizado
  ADD CONSTRAINT fk_documento_digitalizado_lote_digitalizacao_id FOREIGN KEY (lote_digitalizacao_id) REFERENCES lote_digitalizacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documento_digitalizado_assinatura_icp_id FOREIGN KEY (assinatura_icp_id) REFERENCES assinatura_icp (id) ON DELETE RESTRICT;
-- Carga de domínio (carregador versionado do produto, não do teste): os tipos documentais do índice da digitalização.
INSERT INTO tipo_documento_arquivo (codigo, descricao, grupo, guardado_no_arquivo, prazo_guarda_anos, criado_em) VALUES
  ('ficha-atendimento','Ficha de atendimento','prontuario',TRUE,20,NOW(3)),
  ('evolucao','Evolução','prontuario',TRUE,20,NOW(3)),
  ('prescricao','Prescrição','prontuario',TRUE,20,NOW(3)),
  ('exame','Resultado de exame','exame',TRUE,20,NOW(3)),
  ('laudo','Laudo','exame',TRUE,20,NOW(3)),
  ('termo-consentimento','Termo de consentimento','prontuario',TRUE,20,NOW(3)),
  ('folha-sala','Folha de sala','prontuario',TRUE,20,NOW(3)),
  ('prontuario-antigo','Prontuário antigo','prontuario',TRUE,20,NOW(3)),
  ('outro','Outro documento do prontuário','outro',TRUE,20,NOW(3))
ON DUPLICATE KEY UPDATE codigo = codigo;
