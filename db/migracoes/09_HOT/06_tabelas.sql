-- HOT, lote 06 (F2.2 onda 3; pedidos dos lotes 03-01, 03-02, 03-03 e 03-04: SAME, higienização, digitalização, engenharia clínica e nutrição). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (06_chaves.sql).

CREATE TABLE registro_prontuario_ocorrencia (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  atendimento_id BIGINT UNSIGNED NOT NULL,
  movimento_prontuario_id BIGINT UNSIGNED NULL COMMENT 'Movimento do volume, quando o registro se refere a um',
  tipo VARCHAR(20) NOT NULL COMMENT 'ocorrencia, aceite ou cobranca',
  motivo VARCHAR(200) NULL,
  protocolo VARCHAR(30) NULL,
  registrado_em DATETIME(3) NOT NULL,
  registrado_por_usuario_id BIGINT UNSIGNED NOT NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_registro_prontuario_ocorrencia_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_registro_prontuario_ocorrencia_tipo CHECK (tipo IN ('ocorrencia','aceite','cobranca')),
  CONSTRAINT ck_registro_prontuario_ocorrencia_motivo CHECK (tipo <> 'ocorrencia' OR motivo IS NOT NULL),
  KEY ix_registro_prontuario_ocorrencia_atendimento_id (atendimento_id),
  KEY ix_registro_prontuario_ocorrencia_estabelecimento_id (estabelecimento_id, registrado_em),
  KEY ix_registro_prontuario_ocorrencia_movimento_prontuario_id (movimento_prontuario_id),
  KEY ix_registro_prontuario_ocorrencia_registrado_por_usuario_id (registrado_por_usuario_id)
) COMMENT='Ocorrência, aceite e cobrança do prontuário no SAME, com ou sem movimento do volume';

ALTER TABLE inspecao_limpeza
  ADD COLUMN foto_arquivo_id BIGINT UNSIGNED NULL COMMENT 'Foto da etapa inspecionada',
  ADD KEY ix_inspecao_limpeza_foto_arquivo_id (foto_arquivo_id);

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

CREATE TABLE modelo_equipamento_curso (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  fabricante_id BIGINT UNSIGNED NOT NULL,
  modelo VARCHAR(60) NOT NULL COMMENT 'Modelo normalizado (maiúsculas, sem espaços duplos)',
  curso_id BIGINT UNSIGNED NOT NULL,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_modelo_equipamento_curso (estabelecimento_id, fabricante_id, modelo, curso_id),
  KEY ix_modelo_equipamento_curso_fabricante_id (fabricante_id),
  KEY ix_modelo_equipamento_curso_curso_id (curso_id)
) COMMENT='Curso exigido para operar cada modelo de equipamento (RDC 509/2021, art. 15)';

CREATE TABLE evento_ciclo_equipamento (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  equipamento_saude_id BIGINT UNSIGNED NOT NULL,
  tipo VARCHAR(30) NOT NULL COMMENT 'incorporacao, desativacao ou descarte',
  data_evento DATE NOT NULL,
  motivo VARCHAR(500) NOT NULL,
  documento VARCHAR(60) NULL COMMENT 'Laudo ou certificado de destinação',
  destino VARCHAR(30) NULL COMMENT 'residuo, doacao, venda ou devolucao',
  valor_contabil DECIMAL(15,2) NULL COMMENT 'Valor contábil do bem na data',
  valor_obtido DECIMAL(15,2) NULL,
  autorizado_por VARCHAR(150) NOT NULL COMMENT 'Nome de quem autorizou o evento',
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_evento_ciclo_equipamento_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_evento_ciclo_equipamento_tipo CHECK (tipo IN ('incorporacao','desativacao','descarte')),
  CONSTRAINT ck_evento_ciclo_equipamento_destino CHECK (destino IS NULL OR destino IN ('residuo','doacao','venda','devolucao')),
  CONSTRAINT ck_evento_ciclo_equipamento_descarte CHECK (tipo <> 'descarte' OR (documento IS NOT NULL AND destino IS NOT NULL)),
  CONSTRAINT ck_evento_ciclo_equipamento_valores CHECK ((valor_contabil IS NULL OR valor_contabil >= 0) AND (valor_obtido IS NULL OR valor_obtido >= 0)),
  UNIQUE KEY uq_evento_ciclo_equipamento_tipo (equipamento_saude_id, tipo)
) COMMENT='Incorporação, desativação e descarte do equipamento (RDC 509/2021), com documento, destino e valores';

ALTER TABLE equipamento_saude
  ADD COLUMN desativado_em DATE NULL COMMENT 'Data da desativação' AFTER situacao,
  ADD CONSTRAINT ck_equipamento_saude_desativado_em CHECK (situacao = 'desativado' OR desativado_em IS NULL);

ALTER TABLE ordem_servico_manutencao
  ADD COLUMN laudo_arquivo_id BIGINT UNSIGNED NULL COMMENT 'Laudo técnico da OS',
  ADD KEY ix_ordem_servico_manutencao_laudo_arquivo_id (laudo_arquivo_id);

ALTER TABLE plano_preventivo
  ADD COLUMN modelo_plano_codigo VARCHAR(30) NULL COMMENT 'Modelo pronto de origem (PMOC, reservatório de água, gerador)',
  ADD COLUMN modelo_plano_versao SMALLINT UNSIGNED NULL COMMENT 'Versão do modelo pronto de origem',
  ADD CONSTRAINT ck_plano_preventivo_modelo CHECK ((modelo_plano_codigo IS NULL) = (modelo_plano_versao IS NULL)),
  ADD KEY ix_plano_preventivo_modelo (estabelecimento_id, modelo_plano_codigo, ativo);

ALTER TABLE contrato_servico_terceirizado
  ADD COLUMN contrato_fornecedor_id BIGINT UNSIGNED NULL COMMENT 'Contrato de suprimentos de origem',
  ADD KEY ix_contrato_servico_terceirizado_contrato_fornecedor_id (contrato_fornecedor_id),
  ADD UNIQUE KEY uq_contrato_servico_terceirizado_fornecedor_numero (estabelecimento_id, empresa_fornecedora_id, numero),
  DROP INDEX uq_contrato_servico_terceirizado_numero;

CREATE TABLE plano_refeicao_acompanhante (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  internacao_id BIGINT UNSIGNED NOT NULL,
  acompanhante_internacao_id BIGINT UNSIGNED NULL,
  direito_legal VARCHAR(30) NOT NULL COMMENT 'Base legal do direito à refeição do acompanhante',
  inicio_em DATETIME(3) NOT NULL,
  fim_em DATETIME(3) NULL,
  dieta VARCHAR(250) NULL,
  observacao VARCHAR(500) NULL,
  situacao VARCHAR(20) NOT NULL DEFAULT 'ativa',
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_plano_refeicao_acompanhante_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_plano_refeicao_acompanhante_situacao CHECK (situacao IN ('ativa','encerrada','cancelada')),
  CONSTRAINT ck_plano_refeicao_acompanhante_periodo CHECK (fim_em IS NULL OR fim_em >= inicio_em),
  KEY ix_plano_refeicao_acompanhante_internacao_id (internacao_id),
  KEY ix_plano_refeicao_acompanhante_estabelecimento_id (estabelecimento_id, situacao),
  KEY ix_plano_refeicao_acompanhante_acompanhante_internacao_id (acompanhante_internacao_id)
) COMMENT='Refeições previstas do acompanhante pela nutrição: base legal, período e dieta';

CREATE TABLE plano_refeicao_acompanhante_refeicao (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  plano_refeicao_acompanhante_id BIGINT UNSIGNED NOT NULL,
  refeicao_do_dia_id BIGINT UNSIGNED NOT NULL,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_plano_refeicao_acompanhante_refeicao (plano_refeicao_acompanhante_id, refeicao_do_dia_id),
  KEY ix_plano_refeicao_acompanhante_refeicao_refeicao_do_dia_id (refeicao_do_dia_id)
) COMMENT='Refeições do dia a que o acompanhante tem direito no plano';

ALTER TABLE mapa_dieta
  ADD COLUMN hash_conteudo CHAR(64) NULL COMMENT 'Resumo SHA-256 do conteúdo do mapa fechado';

ALTER TABLE mapa_dieta_item
  MODIFY modalidade_dieta_id BIGINT UNSIGNED NULL,
  ADD COLUMN tipo_linha VARCHAR(20) NOT NULL DEFAULT 'oral' COMMENT 'jejum, livre, oral, enteral, parenteral ou sem_prescricao',
  ADD CONSTRAINT ck_mapa_dieta_item_tipo_linha CHECK (tipo_linha IN ('jejum','livre','oral','enteral','parenteral','sem_prescricao')),
  ADD CONSTRAINT ck_mapa_dieta_item_modalidade CHECK (modalidade_dieta_id IS NOT NULL OR tipo_linha IN ('jejum','sem_prescricao'));
