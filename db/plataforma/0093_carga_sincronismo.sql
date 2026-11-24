-- Plataforma 0093 (2026-11-24): tela "Carga e sincronismo" e leitura direta do servidor Firebird (ADR 0010).
-- 1. cliente_origem ganha o tipo firebird_servidor (host, porta, banco, usuário e referência da senha no cofre; a
--    senha nunca fica aqui). Os campos do arquivo passam a NULL e o CHECK por tipo exige os campos de cada tipo.
--    identidade_base: o que identifica a base lida (ODS, página, data de criação...), sem dado de pessoa; a
--    continuação entre execuções de uma origem de servidor exige a mesma identidade.
-- 2. conector_execucao ganha a pausa: `pausando` (ativo: entra na trava de uma execução ativa por cliente) e
--    `pausada` (final: concluido_em preenchido; a retomada é uma execução nova com continuação), mais o pedido de
--    pausa, o arquivo de log da execução e o modo pedido pela tela (completa ou diferencial).
-- Sem gatilhos. Idempotente: os CHECKs são removidos com IF EXISTS antes de recriar; colunas com IF NOT EXISTS.

-- 1. cliente_origem -------------------------------------------------------------------------------------------------
ALTER TABLE cliente_origem
  DROP CONSTRAINT IF EXISTS ck_cliente_origem_tipo,
  DROP CONSTRAINT IF EXISTS ck_cliente_origem_caminho,
  DROP CONSTRAINT IF EXISTS ck_cliente_origem_sha256,
  DROP CONSTRAINT IF EXISTS ck_cliente_origem_campos_tipo,
  DROP CONSTRAINT IF EXISTS ck_cliente_origem_servidor_porta;

ALTER TABLE cliente_origem
  MODIFY COLUMN tipo VARCHAR(30) NOT NULL DEFAULT 'firebird_arquivo'
    COMMENT 'firebird_arquivo = arquivo .fdb na pasta autorizada; firebird_servidor = leitura direta do servidor do hospital',
  MODIFY COLUMN caminho_relativo VARCHAR(255) NULL COMMENT 'Só firebird_arquivo: relativo à pasta autorizada do conector; nunca absoluto',
  MODIFY COLUMN tamanho_bytes BIGINT UNSIGNED NULL COMMENT 'Só firebird_arquivo: tamanho do arquivo no vínculo',
  MODIFY COLUMN sha256 CHAR(64) NULL COMMENT 'Só firebird_arquivo: resumo do arquivo no vínculo; o motor confere antes e depois de cada execução',
  MODIFY COLUMN modificado_em DATETIME(6) NULL COMMENT 'Só firebird_arquivo: mtime do arquivo = horário de corte declarado da imagem',
  MODIFY COLUMN ods_versao SMALLINT UNSIGNED NULL COMMENT 'Versão do formato em disco (cabeçalho do arquivo ou servidor)',
  MODIFY COLUMN pagina_bytes INT UNSIGNED NULL COMMENT 'Tamanho de página (cabeçalho do arquivo ou servidor)',
  ADD COLUMN IF NOT EXISTS nome_exibicao VARCHAR(120) NULL COMMENT 'Nome da origem na tela (ex.: servidor do hospital)' AFTER tipo,
  ADD COLUMN IF NOT EXISTS servidor_host VARCHAR(255) NULL COMMENT 'Só firebird_servidor: host ou IP do servidor Firebird' AFTER pagina_bytes,
  ADD COLUMN IF NOT EXISTS servidor_porta INT UNSIGNED NULL COMMENT 'Só firebird_servidor: porta (padrão 3050)' AFTER servidor_host,
  ADD COLUMN IF NOT EXISTS servidor_banco VARCHAR(500) NULL COMMENT 'Só firebird_servidor: caminho ou alias do banco no servidor' AFTER servidor_porta,
  ADD COLUMN IF NOT EXISTS servidor_usuario VARCHAR(63) NULL COMMENT 'Só firebird_servidor: usuário de leitura' AFTER servidor_banco,
  ADD COLUMN IF NOT EXISTS senha_referencia_cofre VARCHAR(200) NULL
    COMMENT 'Só firebird_servidor: referência da senha no cofre de segredos (cofre:... ou, fora de produção, env:NOME); nunca a senha'
    AFTER servidor_usuario,
  ADD COLUMN IF NOT EXISTS identidade_base JSON NULL
    COMMENT 'Identidade da base lida (ODS, página, criação...), sem dado de pessoa; a continuação exige a mesma'
    AFTER senha_referencia_cofre;

ALTER TABLE cliente_origem
  ADD CONSTRAINT ck_cliente_origem_tipo CHECK (tipo IN ('firebird_arquivo','firebird_servidor')),
  ADD CONSTRAINT ck_cliente_origem_sha256 CHECK (sha256 IS NULL OR CAST(sha256 AS BINARY) REGEXP '^[0-9a-f]{64}$'),
  ADD CONSTRAINT ck_cliente_origem_caminho CHECK (caminho_relativo IS NULL OR (caminho_relativo NOT LIKE '/%'
                                                  AND caminho_relativo NOT LIKE '%..%' AND caminho_relativo <> '')),
  ADD CONSTRAINT ck_cliente_origem_servidor_porta CHECK (servidor_porta IS NULL OR servidor_porta BETWEEN 1 AND 65535),
  ADD CONSTRAINT ck_cliente_origem_campos_tipo CHECK (
    (tipo = 'firebird_arquivo' AND caminho_relativo IS NOT NULL AND tamanho_bytes IS NOT NULL AND sha256 IS NOT NULL
      AND modificado_em IS NOT NULL AND ods_versao IS NOT NULL AND pagina_bytes IS NOT NULL)
    OR (tipo = 'firebird_servidor' AND servidor_host IS NOT NULL AND servidor_host <> ''
      AND servidor_porta IS NOT NULL AND servidor_banco IS NOT NULL AND servidor_banco <> ''
      AND servidor_usuario IS NOT NULL AND servidor_usuario <> ''
      AND senha_referencia_cofre IS NOT NULL AND senha_referencia_cofre <> ''));

-- 2. conector_execucao ----------------------------------------------------------------------------------------------
ALTER TABLE conector_execucao
  DROP CONSTRAINT IF EXISTS ck_conector_execucao_estado,
  DROP CONSTRAINT IF EXISTS ck_conector_execucao_fim,
  DROP CONSTRAINT IF EXISTS ck_conector_execucao_modo,
  DROP CONSTRAINT IF EXISTS ck_conector_execucao_arquivo_log;

ALTER TABLE conector_execucao
  MODIFY COLUMN concluido_em DATETIME(3) NULL COMMENT 'Fim (concluída, falhou, cancelada ou pausada)',
  MODIFY COLUMN cliente_ativo BIGINT UNSIGNED
    AS (IF(estado IN ('fila','abrindo','lendo','gravando','conciliando','pausando'), cliente_id, NULL)) STORED
    COMMENT 'Trava: uma execução ativa (na fila, rodando ou pausando) por cliente',
  ADD COLUMN IF NOT EXISTS pausa_solicitada_em DATETIME(3) NULL
    COMMENT 'Pedido de pausa: o motor lê no batimento e para no próximo ponto seguro' AFTER concluido_em,
  ADD COLUMN IF NOT EXISTS pausa_solicitada_por BIGINT UNSIGNED NULL
    COMMENT 'Administrador da plataforma que pediu a pausa' AFTER pausa_solicitada_em,
  ADD COLUMN IF NOT EXISTS arquivo_log VARCHAR(255) NULL
    COMMENT 'Log da execução, relativo à pasta de logs do conector; sem valores de linha' AFTER pausa_solicitada_por,
  ADD COLUMN IF NOT EXISTS modo VARCHAR(20) NULL
    COMMENT 'Modo pedido pela tela: completa ou diferencial (NULL = pedido pela linha de comando)' AFTER arquivo_log;

ALTER TABLE conector_execucao
  ADD CONSTRAINT ck_conector_execucao_estado CHECK (estado IN ('fila','abrindo','lendo','gravando','conciliando',
                                                              'pausando','concluida','falhou','cancelada','pausada')),
  ADD CONSTRAINT ck_conector_execucao_fim CHECK ((estado IN ('concluida','falhou','cancelada','pausada'))
                                                 = (concluido_em IS NOT NULL)),
  ADD CONSTRAINT ck_conector_execucao_modo CHECK (modo IS NULL OR modo IN ('completa','diferencial')),
  ADD CONSTRAINT ck_conector_execucao_arquivo_log CHECK (arquivo_log IS NULL OR (arquivo_log NOT LIKE '/%'
                                                         AND arquivo_log NOT LIKE '%..%' AND arquivo_log <> ''));

ALTER TABLE conector_execucao
  ADD CONSTRAINT fk_conector_execucao_pausa_solicitada_por FOREIGN KEY IF NOT EXISTS (pausa_solicitada_por)
    REFERENCES administrador_plataforma (id) ON DELETE RESTRICT;
