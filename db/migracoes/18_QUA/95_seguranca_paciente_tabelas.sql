-- Qualidade, segurança do paciente, etapa 2 no banco próprio (modulos-proprios-1, família qualidade-a, 23/11/2026): só
-- para frente e idempotente (ADR 0002, parte 2). A vigilância de produto (tecnovigilância e farmacovigilância) usa a
-- queixa técnica que já existe, com o que o registro da tela pede: a área, o tipo do registro, o produto e o lote como
-- informados (quando o item não está no cadastro), a série, o fabricante, o registro sanitário, o alerta e a conduta; a
-- investigação entra na situação. A sugestão de notificação resolvida (o resumo da origem com a conta, nunca a origem em
-- claro) ganha tabela própria, uma linha por resumo no estabelecimento. As regras ficam no domínio e na porta.

ALTER TABLE queixa_tecnica_produto
  ADD COLUMN IF NOT EXISTS area_vigilancia VARCHAR(20) NULL COMMENT 'tecnovigilancia ou farmacovigilancia' AFTER natureza,
  ADD COLUMN IF NOT EXISTS tipo_vigilancia VARCHAR(20) NULL COMMENT 'Tipo do registro: queixa técnica, evento adverso, reação adversa, inefetividade ou alerta sanitário' AFTER area_vigilancia,
  ADD COLUMN IF NOT EXISTS produto_descricao VARCHAR(200) NULL COMMENT 'Produto como informado, quando o item não está no cadastro' AFTER tipo_vigilancia,
  ADD COLUMN IF NOT EXISTS lote_descricao VARCHAR(60) NULL COMMENT 'Lote como informado' AFTER produto_descricao,
  ADD COLUMN IF NOT EXISTS numero_serie VARCHAR(60) NULL COMMENT 'Número de série do equipamento ou material' AFTER lote_descricao,
  ADD COLUMN IF NOT EXISTS fabricante_descricao VARCHAR(150) NULL COMMENT 'Fabricante como informado' AFTER numero_serie,
  ADD COLUMN IF NOT EXISTS registro_sanitario VARCHAR(30) NULL COMMENT 'Número do registro do produto na vigilância sanitária' AFTER fabricante_descricao,
  ADD COLUMN IF NOT EXISTS alerta_descricao VARCHAR(200) NULL COMMENT 'Alerta sanitário como informado (número ou título)' AFTER registro_sanitario,
  ADD COLUMN IF NOT EXISTS conduta VARCHAR(20) NOT NULL DEFAULT 'nenhuma' COMMENT 'Conduta vigente com o produto' AFTER alerta_descricao,
  DROP CONSTRAINT IF EXISTS ck_queixa_tecnica_produto_area_vigilancia,
  ADD CONSTRAINT ck_queixa_tecnica_produto_area_vigilancia CHECK (area_vigilancia IS NULL OR area_vigilancia IN ('tecnovigilancia','farmacovigilancia')),
  DROP CONSTRAINT IF EXISTS ck_queixa_tecnica_produto_tipo_vigilancia,
  ADD CONSTRAINT ck_queixa_tecnica_produto_tipo_vigilancia CHECK (tipo_vigilancia IS NULL OR tipo_vigilancia IN ('queixa_tecnica','evento_adverso','reacao_adversa','inefetividade','alerta_sanitario')),
  DROP CONSTRAINT IF EXISTS ck_queixa_tecnica_produto_registro_vigilancia,
  ADD CONSTRAINT ck_queixa_tecnica_produto_registro_vigilancia CHECK ((area_vigilancia IS NULL) = (tipo_vigilancia IS NULL)),
  DROP CONSTRAINT IF EXISTS ck_queixa_tecnica_produto_conduta,
  ADD CONSTRAINT ck_queixa_tecnica_produto_conduta CHECK (conduta IN ('nenhuma','segregado','suspenso_uso','recolhido','devolvido')),
  DROP CONSTRAINT IF EXISTS ck_queixa_tecnica_produto_situacao,
  ADD CONSTRAINT ck_queixa_tecnica_produto_situacao CHECK (situacao IN ('aberta','em_investigacao','lote_segregado','enviada_fabricante','enviada_vigilancia','encerrada','cancelada')),
  DROP CONSTRAINT IF EXISTS ck_queixa_tecnica_produto_alvo,
  ADD CONSTRAINT ck_queixa_tecnica_produto_alvo CHECK (insumo_id IS NOT NULL OR equipamento_saude_id IS NOT NULL OR produto_descricao IS NOT NULL),
  DROP CONSTRAINT IF EXISTS ck_queixa_tecnica_produto_alerta,
  ADD CONSTRAINT ck_queixa_tecnica_produto_alerta CHECK (natureza <> 'alerta_sanitario' OR alerta_sanitario_id IS NOT NULL OR alerta_descricao IS NOT NULL),
  DROP CONSTRAINT IF EXISTS ck_queixa_tecnica_produto_notificada,
  ADD CONSTRAINT ck_queixa_tecnica_produto_notificada CHECK (situacao <> 'enviada_vigilancia' OR enviada_vigilancia_em IS NOT NULL),
  ADD KEY IF NOT EXISTS ix_queixa_tecnica_produto_estabelecimento_situacao (estabelecimento_id, situacao, area_vigilancia);

ALTER TABLE queixa_tecnica_produto_evento
  ADD COLUMN IF NOT EXISTS conduta VARCHAR(20) NULL COMMENT 'Conduta com o produto neste andamento' AFTER situacao,
  DROP CONSTRAINT IF EXISTS ck_queixa_tecnica_produto_evento_situacao,
  ADD CONSTRAINT ck_queixa_tecnica_produto_evento_situacao CHECK (situacao IN ('aberta','em_investigacao','lote_segregado','enviada_fabricante','enviada_vigilancia','encerrada','cancelada')),
  DROP CONSTRAINT IF EXISTS ck_queixa_tecnica_produto_evento_conduta,
  ADD CONSTRAINT ck_queixa_tecnica_produto_evento_conduta CHECK (conduta IS NULL OR conduta IN ('nenhuma','segregado','suspenso_uso','recolhido','devolvido'));

CREATE TABLE IF NOT EXISTS sugestao_notificacao_resolvida (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id  BIGINT UNSIGNED NOT NULL,
  resumo              CHAR(64) NOT NULL COMMENT 'Resumo SHA-256 da origem da sugestão com a conta (a origem não fica em claro)',
  resolvida_em        DATE NOT NULL COMMENT 'Dia em que a sugestão virou notificação',
  origem              VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em           DATETIME(3) NOT NULL,
  criado_por          BIGINT UNSIGNED NULL,
  alterado_em         DATETIME(3) NULL,
  alterado_por        BIGINT UNSIGNED NULL,
  versao              INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_sugestao_notificacao_resolvida_resumo CHECK (resumo REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT ck_sugestao_notificacao_resolvida_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_sugestao_notificacao_resolvida_resumo (estabelecimento_id, resumo)
) COMMENT='Sugestão automática de notificação de incidente já resolvida (virou notificação), pelo resumo da origem com a conta';
