-- F2.4 (dívida da migração), 3ª etapa, 4ª leva: DDL pedido pelos lotes das portas (p-*), só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v4.md

-- Queixa técnica aberta pela ordem de serviço do equipamento: a natureza (desvio técnico, evento adverso, que usa a
-- notificação de incidente já ligada, ou alerta sanitário) e o alerta ligado.
ALTER TABLE queixa_tecnica_produto
  ADD COLUMN IF NOT EXISTS natureza VARCHAR(20) NOT NULL DEFAULT 'queixa_tecnica' COMMENT 'queixa_tecnica, evento_adverso ou alerta_sanitario' AFTER tipo_desvio,
  ADD COLUMN IF NOT EXISTS alerta_sanitario_id BIGINT UNSIGNED NULL COMMENT 'Alerta sanitário de que a queixa trata' AFTER notificacao_incidente_id,
  DROP CONSTRAINT IF EXISTS ck_queixa_tecnica_produto_natureza,
  ADD CONSTRAINT ck_queixa_tecnica_produto_natureza CHECK (natureza IN ('queixa_tecnica','evento_adverso','alerta_sanitario')),
  DROP CONSTRAINT IF EXISTS ck_queixa_tecnica_produto_alerta,
  ADD CONSTRAINT ck_queixa_tecnica_produto_alerta CHECK (natureza <> 'alerta_sanitario' OR alerta_sanitario_id IS NOT NULL),
  ADD KEY IF NOT EXISTS ix_queixa_tecnica_produto_alerta (alerta_sanitario_id);

-- Ficha de IRAS (infecção relacionada à assistência à saúde): implante (janela de vigilância de 90 dias na infecção
-- do sítio cirúrgico), a cultura que embasou a ficha e o microrganismo como informado (o código do cadastro, quando
-- resolvido, vai em caso_infeccao_microrganismo).
ALTER TABLE caso_infeccao
  ADD COLUMN IF NOT EXISTS implante BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Cirurgia com implante (vigilância de 90 dias)' AFTER nivel_cirurgico,
  ADD COLUMN IF NOT EXISTS exame_item_id BIGINT UNSIGNED NULL COMMENT 'Cultura do paciente que embasou a ficha' AFTER ato_cirurgico_id,
  ADD COLUMN IF NOT EXISTS microrganismo_descricao VARCHAR(80) NULL COMMENT 'Microrganismo como informado na ficha' AFTER exame_item_id,
  ADD KEY IF NOT EXISTS ix_caso_infeccao_exame_item (exame_item_id);

-- Decisão da CCIH sobre o antimicrobiano prescrito (com ou sem ficha, inclusive a não liberação) e as revisões do
-- 3º e do 7º dia. liberacao_antimicrobiano segue como o histórico da ficha completa.
CREATE TABLE IF NOT EXISTS decisao_antimicrobiano (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  prescricao_item_id BIGINT UNSIGNED NOT NULL,
  prescricao_id BIGINT UNSIGNED NOT NULL,
  internacao_id BIGINT UNSIGNED NULL,
  paciente_id BIGINT UNSIGNED NOT NULL,
  insumo_id BIGINT UNSIGNED NOT NULL,
  ficha_antimicrobiano_id BIGINT UNSIGNED NULL,
  prescrito_em DATETIME(3) NOT NULL,
  inicio_tratamento_em DATETIME(3) NOT NULL COMMENT 'Início do tratamento (dia 1 das revisões)',
  decisao VARCHAR(25) NOT NULL COMMENT 'liberado, liberado_com_ajuste ou nao_liberado',
  dias_autorizados SMALLINT UNSIGNED NULL,
  justificativa VARCHAR(500) NULL,
  no_prazo BOOLEAN NOT NULL COMMENT 'Decidido dentro do prazo da CCIH',
  decidido_em DATETIME(3) NOT NULL,
  decidido_por_usuario_id BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_decisao_antimicrobiano_decisao CHECK (decisao IN ('liberado','liberado_com_ajuste','nao_liberado')),
  CONSTRAINT ck_decisao_antimicrobiano_dias CHECK (dias_autorizados IS NULL OR dias_autorizados > 0),
  CONSTRAINT ck_decisao_antimicrobiano_justificativa CHECK (decisao = 'liberado' OR justificativa IS NOT NULL),
  CONSTRAINT ck_decisao_antimicrobiano_liberado_dias CHECK (decisao = 'nao_liberado' OR dias_autorizados IS NOT NULL),
  UNIQUE KEY uq_decisao_antimicrobiano_item (prescricao_item_id),
  KEY ix_decisao_antimicrobiano_estabelecimento (estabelecimento_id, decidido_em),
  KEY ix_decisao_antimicrobiano_prescricao (prescricao_id),
  KEY ix_decisao_antimicrobiano_internacao (internacao_id),
  KEY ix_decisao_antimicrobiano_paciente (paciente_id),
  KEY ix_decisao_antimicrobiano_insumo (insumo_id),
  KEY ix_decisao_antimicrobiano_ficha (ficha_antimicrobiano_id),
  KEY ix_decisao_antimicrobiano_usuario (decidido_por_usuario_id)
) COMMENT='Decisão da CCIH sobre o antimicrobiano restrito prescrito (liberado, com ajuste ou não liberado)';

CREATE TABLE IF NOT EXISTS revisao_decisao_antimicrobiano (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  decisao_antimicrobiano_id BIGINT UNSIGNED NOT NULL,
  marco VARCHAR(5) NOT NULL COMMENT 'd3 ou d7 (dia contado do início do tratamento como dia 1)',
  conduta VARCHAR(20) NOT NULL,
  observacao VARCHAR(500) NULL,
  revisado_em DATETIME(3) NOT NULL,
  revisado_por_usuario_id BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_revisao_decisao_antimicrobiano_marco CHECK (marco IN ('d3','d7')),
  CONSTRAINT ck_revisao_decisao_antimicrobiano_conduta CHECK (conduta IN ('manter','descalonar','escalonar','ajustar_dose','trocar_via','suspender')),
  UNIQUE KEY uq_revisao_decisao_antimicrobiano_marco (decisao_antimicrobiano_id, marco),
  KEY ix_revisao_decisao_antimicrobiano_usuario (revisado_por_usuario_id)
) COMMENT='Revisões do 3º e do 7º dia da terapia antimicrobiana decidida pela CCIH';

-- Configuração do antimicrobiano no cadastro de produtos (insumo): restrito, ATC (classificação anatômica
-- terapêutica química), DDD (dose diária definida) e gramas por unidade, para o consumo em DDD.
CREATE TABLE IF NOT EXISTS configuracao_antimicrobiano_insumo (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  insumo_id BIGINT UNSIGNED NOT NULL,
  restrito BOOLEAN NOT NULL DEFAULT FALSE,
  codigo_atc VARCHAR(7) NULL COMMENT 'Código ATC da OMS',
  ddd_gramas DECIMAL(15,4) NULL COMMENT 'Dose diária definida em gramas',
  gramas_por_unidade DECIMAL(15,4) NULL COMMENT 'Gramas do princípio por unidade de consumo do insumo',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_configuracao_antimicrobiano_insumo_ddd CHECK (ddd_gramas IS NULL OR ddd_gramas > 0),
  CONSTRAINT ck_configuracao_antimicrobiano_insumo_gramas CHECK (gramas_por_unidade IS NULL OR gramas_por_unidade > 0),
  CONSTRAINT ck_configuracao_antimicrobiano_insumo_atc CHECK (codigo_atc IS NULL OR codigo_atc REGEXP '^[A-Z][0-9]{2}[A-Z]{2}[0-9]{2}$'),
  UNIQUE KEY uq_configuracao_antimicrobiano_insumo (estabelecimento_id, insumo_id),
  KEY ix_configuracao_antimicrobiano_insumo_insumo (insumo_id)
) COMMENT='Configuração do insumo antimicrobiano pela CCIH no estabelecimento (restrito, ATC, DDD e gramas por unidade)';

-- Bundle: o turno estornado (exclusão lógica) pode ser lançado de novo; a unicidade vale só entre os não excluídos.
ALTER TABLE verificacao_bundle
  ADD COLUMN IF NOT EXISTS vigente_chave TINYINT UNSIGNED AS (IF(excluido_em IS NULL, 1, NULL)) PERSISTENT COMMENT 'Só para a unicidade: 1 enquanto não excluída',
  ADD UNIQUE KEY IF NOT EXISTS uq_verificacao_bundle_dispositivo_turno_vigente (dispositivo_invasivo_paciente_id, data_referencia, turno, vigente_chave);
ALTER TABLE verificacao_bundle
  DROP INDEX IF EXISTS uq_verificacao_bundle_dispositivo_turno;

-- Consumo de preparação alcoólica: sem censo fechado não há denominador (nulo, e não zero).
ALTER TABLE consumo_preparacao_alcoolica
  MODIFY COLUMN pacientes_dia INT UNSIGNED NULL COMMENT 'Pacientes-dia da competência; nulo sem censo fechado';

-- Matriz de riscos: controles existentes em texto livre (o vínculo ao catálogo segue em risco_institucional_controle).
ALTER TABLE risco_institucional
  ADD COLUMN IF NOT EXISTS controles_descricao TEXT NULL COMMENT 'Controles existentes, em texto' AFTER consequencias;

-- Não conformidade: cancelamento com motivo e a marca de duplicada.
ALTER TABLE nao_conformidade_qualidade
  ADD COLUMN IF NOT EXISTS cancelada_em DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS cancelada_por_usuario_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS duplicada_de_id BIGINT UNSIGNED NULL COMMENT 'Não conformidade de que esta é duplicada',
  DROP CONSTRAINT IF EXISTS ck_nao_conformidade_qualidade_situacao,
  ADD CONSTRAINT ck_nao_conformidade_qualidade_situacao CHECK (situacao IN ('aberta','em_tratamento','em_verificacao','encerrada','reaberta','cancelada')),
  DROP CONSTRAINT IF EXISTS ck_nao_conformidade_qualidade_cancelamento,
  ADD CONSTRAINT ck_nao_conformidade_qualidade_cancelamento CHECK ((situacao = 'cancelada') = (cancelada_em IS NOT NULL) AND (cancelada_em IS NULL) = (motivo_cancelamento IS NULL) AND (cancelada_em IS NULL) = (cancelada_por_usuario_id IS NULL)),
  ADD KEY IF NOT EXISTS ix_nao_conformidade_qualidade_cancelada_por (cancelada_por_usuario_id),
  ADD KEY IF NOT EXISTS ix_nao_conformidade_qualidade_duplicada (duplicada_de_id);

-- Documento da qualidade: resumo SHA-256 da revisão publicada e a retirada da versão com motivo.
ALTER TABLE documento_qualidade_versao
  ADD COLUMN IF NOT EXISTS resumo_sha256 CHAR(64) NULL COMMENT 'SHA-256 do conteúdo publicado',
  ADD COLUMN IF NOT EXISTS retirada_em DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS retirada_por_usuario_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS motivo_retirada VARCHAR(500) NULL,
  DROP CONSTRAINT IF EXISTS ck_documento_qualidade_versao_resumo,
  ADD CONSTRAINT ck_documento_qualidade_versao_resumo CHECK (resumo_sha256 IS NULL OR resumo_sha256 REGEXP '^[0-9a-f]{64}$'),
  DROP CONSTRAINT IF EXISTS ck_documento_qualidade_versao_retirada,
  ADD CONSTRAINT ck_documento_qualidade_versao_retirada CHECK ((retirada_em IS NULL) = (motivo_retirada IS NULL) AND (retirada_em IS NULL) = (retirada_por_usuario_id IS NULL)),
  ADD KEY IF NOT EXISTS ix_documento_qualidade_versao_retirada_por (retirada_por_usuario_id);

-- Ciência do documento: pela conta (usuário) quando o leitor não é colaborador; um dos dois é obrigatório (a tabela
-- estava vazia em todos os clientes).
ALTER TABLE documento_qualidade_ciencia
  MODIFY COLUMN colaborador_id BIGINT UNSIGNED NULL,
  DROP CONSTRAINT IF EXISTS ck_documento_qualidade_ciencia_leitor,
  ADD CONSTRAINT ck_documento_qualidade_ciencia_leitor CHECK (colaborador_id IS NOT NULL OR usuario_id IS NOT NULL);

-- Auditoria interna: o referencial é a categoria (semeada com os códigos do contrato: ona, rdc, interno, outro); os
-- auditores em texto e o cancelamento com motivo.
ALTER TABLE auditoria_interna
  ADD COLUMN IF NOT EXISTS auditores_descricao VARCHAR(400) NULL COMMENT 'Auditores, em texto' AFTER auditor_lider_usuario_id,
  ADD COLUMN IF NOT EXISTS cancelada_em DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento VARCHAR(500) NULL,
  DROP CONSTRAINT IF EXISTS ck_auditoria_interna_cancelamento,
  ADD CONSTRAINT ck_auditoria_interna_cancelamento CHECK ((situacao = 'cancelada') = (cancelada_em IS NOT NULL) AND (cancelada_em IS NULL) = (motivo_cancelamento IS NULL));

-- Comissões: membro externo (sem colaborador nem profissional) por nome e função; assinatura da ata da reunião.
ALTER TABLE comissao_membro
  ADD COLUMN IF NOT EXISTS nome_externo VARCHAR(80) NULL COMMENT 'Nome do membro sem cadastro de colaborador nem de profissional' AFTER profissional_id,
  ADD COLUMN IF NOT EXISTS funcao VARCHAR(60) NULL COMMENT 'Função ou cargo do membro' AFTER nome_externo,
  DROP CONSTRAINT IF EXISTS ck_comissao_membro_pessoa,
  ADD CONSTRAINT ck_comissao_membro_pessoa CHECK (colaborador_id IS NOT NULL OR profissional_id IS NOT NULL OR nome_externo IS NOT NULL);
ALTER TABLE reuniao_comissao
  ADD COLUMN IF NOT EXISTS ata_assinada_em DATETIME(3) NULL AFTER ata_arquivo_id,
  ADD COLUMN IF NOT EXISTS ata_assinada_por_usuario_id BIGINT UNSIGNED NULL AFTER ata_assinada_em,
  DROP CONSTRAINT IF EXISTS ck_reuniao_comissao_assinatura,
  ADD CONSTRAINT ck_reuniao_comissao_assinatura CHECK ((ata_assinada_em IS NULL) = (ata_assinada_por_usuario_id IS NULL) AND (ata_assinada_em IS NULL OR ata IS NOT NULL OR ata_arquivo_id IS NOT NULL)),
  ADD KEY IF NOT EXISTS ix_reuniao_comissao_ata_assinada_por (ata_assinada_por_usuario_id);

-- Envios regulatórios da gestão da qualidade (gerar e transmitir, com revisão por competência). O arquivo fica no
-- armazenamento pela chave (ADR 0004).
CREATE TABLE IF NOT EXISTS envio_regulatorio_qualidade (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  tipo VARCHAR(20) NOT NULL COMMENT 'pm_qualiss, iras ou notivisa',
  competencia DATE NOT NULL,
  revisao SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  arquivo_nome VARCHAR(120) NOT NULL,
  chave_objeto VARCHAR(500) NOT NULL COMMENT 'Chave do arquivo no armazenamento',
  resumo_sha256 CHAR(64) NOT NULL,
  linhas INT UNSIGNED NOT NULL DEFAULT 0,
  resumo VARCHAR(1000) NULL,
  situacao VARCHAR(20) NOT NULL DEFAULT 'gerado' COMMENT 'gerado, transmitido ou substituido',
  gerado_em DATETIME(3) NOT NULL,
  gerado_por_usuario_id BIGINT UNSIGNED NOT NULL,
  transmitido_em DATETIME(3) NULL,
  transmitido_por_usuario_id BIGINT UNSIGNED NULL,
  protocolo VARCHAR(60) NULL COMMENT 'Protocolo do destino na transmissão',
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_envio_regulatorio_qualidade_tipo CHECK (tipo IN ('pm_qualiss','iras','notivisa')),
  CONSTRAINT ck_envio_regulatorio_qualidade_situacao CHECK (situacao IN ('gerado','transmitido','substituido')),
  CONSTRAINT ck_envio_regulatorio_qualidade_competencia CHECK (DAYOFMONTH(competencia) = 1),
  CONSTRAINT ck_envio_regulatorio_qualidade_revisao CHECK (revisao >= 1),
  CONSTRAINT ck_envio_regulatorio_qualidade_resumo CHECK (resumo_sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT ck_envio_regulatorio_qualidade_transmissao CHECK ((situacao <> 'transmitido' OR transmitido_em IS NOT NULL) AND (transmitido_em IS NULL) = (transmitido_por_usuario_id IS NULL)),
  CONSTRAINT ck_envio_regulatorio_qualidade_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_envio_regulatorio_qualidade_revisao (estabelecimento_id, tipo, competencia, revisao),
  KEY ix_envio_regulatorio_qualidade_gerado_por (gerado_por_usuario_id),
  KEY ix_envio_regulatorio_qualidade_transmitido_por (transmitido_por_usuario_id)
) COMMENT='Envios regulatórios da qualidade (PM-QUALISS, IRAS, Notivisa) por competência, com revisão';
