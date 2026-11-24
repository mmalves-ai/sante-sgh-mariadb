-- PEP, porta própria do construtor de formulários novos (pep-portas-proprias, 23/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). O formulário novo é o próprio modelo de documento clínico: o código e o título no
-- modelo; cada versão do construtor em modelo_documento_versao, com o ciclo de revisão (rascunho, revisão, aprovação
-- por outra pessoa, publicação e aposentadoria), a história em modelo_documento_evento (só inclusão) e os casos de
-- teste em modelo_documento_caso_teste. As regras do ciclo ficam no domínio e na porta; aqui só chaves e coerência.

ALTER TABLE modelo_documento_versao
  ADD COLUMN IF NOT EXISTS titulo VARCHAR(300) NULL COMMENT 'Título desta versão (vai ao modelo quando publicada)',
  ADD COLUMN IF NOT EXISTS tipo_registro VARCHAR(30) NULL COMMENT 'Registro clínico que esta versão produz',
  ADD COLUMN IF NOT EXISTS formato VARCHAR(40) NULL COMMENT 'Formato da definição do construtor; nulo = versão que não veio do construtor',
  ADD COLUMN IF NOT EXISTS origem_modelo_documento_versao_id BIGINT UNSIGNED NULL COMMENT 'Versão publicada de que esta partiu',
  ADD COLUMN IF NOT EXISTS aprovada_em DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS aprovacao_usuario_id BIGINT UNSIGNED NULL COMMENT 'Quem aprovou a versão (nunca quem a escreveu)',
  ADD COLUMN IF NOT EXISTS parecer VARCHAR(2000) NULL COMMENT 'Parecer da última aprovação ou devolução',
  ADD COLUMN IF NOT EXISTS destino_publicacao VARCHAR(20) NULL COMMENT 'Onde a publicação vale: só neste sistema, também no modelo de origem ou como registro resumo',
  ADD COLUMN IF NOT EXISTS aposentada_em DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS aposentadoria_usuario_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS motivo_aposentadoria VARCHAR(500) NULL,
  DROP CONSTRAINT IF EXISTS ck_modelo_documento_versao_situacao,
  ADD CONSTRAINT ck_modelo_documento_versao_situacao CHECK (situacao IN ('rascunho','revisao','publicada','substituida','aposentada','descartada')),
  DROP CONSTRAINT IF EXISTS ck_modelo_documento_versao_publicacao,
  ADD CONSTRAINT ck_modelo_documento_versao_publicacao CHECK (situacao NOT IN ('publicada','substituida','aposentada') OR (publicada_em IS NOT NULL AND publicacao_usuario_id IS NOT NULL AND hash_definicao IS NOT NULL)),
  DROP CONSTRAINT IF EXISTS ck_modelo_documento_versao_tipo_registro,
  ADD CONSTRAINT ck_modelo_documento_versao_tipo_registro CHECK (tipo_registro IS NULL OR tipo_registro IN ('evolucao','anamnese','exame_fisico','diagnostico','resumo_clinico','sumario_alta','formulario','escala','termo','laudo','receita','atestado','parecer','outro')),
  DROP CONSTRAINT IF EXISTS ck_modelo_documento_versao_construtor,
  ADD CONSTRAINT ck_modelo_documento_versao_construtor CHECK (formato IS NULL OR (titulo IS NOT NULL AND tipo_registro IS NOT NULL AND usuario_id IS NOT NULL)),
  DROP CONSTRAINT IF EXISTS ck_modelo_documento_versao_aprovacao,
  ADD CONSTRAINT ck_modelo_documento_versao_aprovacao CHECK ((aprovada_em IS NULL) = (aprovacao_usuario_id IS NULL)),
  DROP CONSTRAINT IF EXISTS ck_modelo_documento_versao_destino,
  ADD CONSTRAINT ck_modelo_documento_versao_destino CHECK (destino_publicacao IS NULL OR destino_publicacao IN ('so_sistema','modelo_origem','registro_resumo')),
  DROP CONSTRAINT IF EXISTS ck_modelo_documento_versao_aposentadoria,
  ADD CONSTRAINT ck_modelo_documento_versao_aposentadoria CHECK ((situacao = 'aposentada') = (aposentada_em IS NOT NULL AND aposentadoria_usuario_id IS NOT NULL AND motivo_aposentadoria IS NOT NULL));

CREATE TABLE IF NOT EXISTS modelo_documento_evento (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  modelo_documento_versao_id BIGINT UNSIGNED NOT NULL,
  tipo_evento       VARCHAR(20) NOT NULL,
  usuario_id        BIGINT UNSIGNED NOT NULL COMMENT 'Quem salvou, enviou, aprovou, devolveu, publicou ou aposentou',
  ocorrido_em       DATETIME(3) NOT NULL,
  hash_definicao    CHAR(64) NULL COMMENT 'SHA-256 da definição publicada (só na publicação)',
  texto             VARCHAR(2000) NULL COMMENT 'Parecer ou motivo do passo',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_modelo_documento_evento_tipo CHECK (tipo_evento IN ('salvo','revisao','aprovado','devolvido','publicado','aposentado')),
  CONSTRAINT ck_modelo_documento_evento_hash CHECK ((tipo_evento = 'publicado') = (hash_definicao IS NOT NULL)),
  CONSTRAINT ck_modelo_documento_evento_texto CHECK (tipo_evento NOT IN ('aprovado','devolvido','aposentado') OR texto IS NOT NULL),
  KEY ix_modelo_documento_evento_versao (modelo_documento_versao_id, ocorrido_em, id),
  KEY ix_modelo_documento_evento_usuario (usuario_id)
) COMMENT='História do ciclo de uma versão do construtor de formulários (só inclusão)';

CREATE TABLE IF NOT EXISTS modelo_documento_caso_teste (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  modelo_documento_versao_id BIGINT UNSIGNED NOT NULL,
  ordem             SMALLINT UNSIGNED NOT NULL,
  nome              VARCHAR(200) NOT NULL,
  dados             JSON NOT NULL COMMENT 'Respostas de entrada e resultado esperado do caso',
  excluido_em       DATETIME(3) NULL,
  excluido_por      BIGINT UNSIGNED NULL,
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_modelo_documento_caso_teste_dados CHECK (JSON_VALID(dados)),
  CONSTRAINT ck_modelo_documento_caso_teste_ordem CHECK (ordem >= 1),
  UNIQUE KEY uq_modelo_documento_caso_teste_ordem (modelo_documento_versao_id, ordem)
) COMMENT='Caso de teste de uma versão do construtor: respostas e o resultado esperado das regras';
