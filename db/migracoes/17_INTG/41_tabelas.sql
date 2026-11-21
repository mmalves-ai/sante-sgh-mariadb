-- F4 rodada 5 (ADR 0007, itens 17 e 20): cofre de segredos do cliente e histórico da mescla não destrutiva.
-- O MESMO texto está em conector/sante_conector/continuidade.py (DDL_COFRE, DDL_MESCLA): o conector garante as
-- tabelas no banco do cliente antes de usá-las (CREATE TABLE IF NOT EXISTS). Sem gatilho; só leitura pela API.

CREATE TABLE IF NOT EXISTS segredo_cofre (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  referencia VARCHAR(200) NOT NULL COMMENT 'Referência gravada na coluna que usa o segredo (cofre:...)',
  envelope TEXT NOT NULL COMMENT 'Segredo cifrado: v1.<iv>.<tag>.<corpo> (AES-256-GCM, base64url); nunca em claro',
  versao_chave VARCHAR(20) NOT NULL DEFAULT 'v1' COMMENT 'Versão do envelope e da chave mestra (rotação)',
  finalidade VARCHAR(60) NOT NULL COMMENT 'Tabela e coluna do destino que usam o segredo',
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL, criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL, alterado_por BIGINT UNSIGNED NULL, versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_segredo_cofre_referencia CHECK (referencia LIKE 'cofre:%'),
  CONSTRAINT ck_segredo_cofre_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_segredo_cofre_referencia (referencia)
) COMMENT='Cofre de segredos do cliente: credenciais cifradas com a chave mestra do deploy; a tabela de uso guarda só a referência';

CREATE TABLE IF NOT EXISTS historico_mescla_migracao (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tabela_destino VARCHAR(64) NOT NULL COMMENT 'Tabela do registro que já existia e foi adotado',
  registro_id BIGINT UNSIGNED NOT NULL COMMENT 'Id do registro adotado (mantido como estava na coluna em conflito)',
  coluna VARCHAR(64) NOT NULL,
  valor_origem TEXT NULL COMMENT 'Valor que a origem trazia para a coluna (o do destino foi mantido)',
  tabela_origem VARCHAR(63) NOT NULL,
  chave_origem VARCHAR(500) NOT NULL,
  criado_em DATETIME(3) NOT NULL, criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL, alterado_por BIGINT UNSIGNED NULL, versao INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_historico_mescla_migracao (tabela_destino, registro_id, coluna, tabela_origem, chave_origem),
  KEY ix_historico_mescla_migracao_registro (tabela_destino, registro_id)
) COMMENT='Mescla não destrutiva da migração: valor da origem guardado quando o destino já tinha outro';
