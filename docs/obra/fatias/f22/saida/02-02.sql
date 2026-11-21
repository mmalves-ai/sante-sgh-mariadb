-- Pedido do lote 02-02 (F2.2 onda 2): área de preparação das cargas dos catálogos oficiais (M13) e licença dos
-- catálogos licenciados (regra 7). Destino proposto: db/migracoes/17_INTG (junto de terminologia e
-- terminologia_edicao), tabelas e chaves. Convenções do ADR 0002 (parte 2): snake_case, auditoria, versao, CHECK.
-- O teste de integração do lote (apps/api/src/modulos/catalogos/porta-propria.int.spec.ts) cria estas tabelas no
-- cliente f22_o2 quando faltam (marcadas no COMMENT com "[teste 02-02]") e as apaga no fim; depois da migração, usa as
-- do banco.

CREATE TABLE carga_catalogo (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id       BIGINT UNSIGNED NOT NULL,
  catalogo                 VARCHAR(30) NOT NULL COMMENT 'Código do catálogo oficial na definição do produto (cid, sigtap, cep...)',
  arquivo_nome             VARCHAR(200) NOT NULL COMMENT 'Nomes dos arquivos enviados, com a codificação lida',
  arquivo_sha256           CHAR(64) NOT NULL,
  arquivo_bytes            BIGINT UNSIGNED NOT NULL,
  arquivo_guardado         VARCHAR(200) NULL COMMENT 'Endereço do original no armazenamento com retenção; nulo: não guardado',
  situacao                 VARCHAR(20) NOT NULL DEFAULT 'comparada',
  edicao                   VARCHAR(12) NULL COMMENT 'Competência AAAAMM, versão TISS ou edição do arquivo',
  total_linhas             INT UNSIGNED NOT NULL DEFAULT 0,
  linhas_validas           INT UNSIGNED NOT NULL DEFAULT 0,
  linhas_erro              INT UNSIGNED NOT NULL DEFAULT 0,
  itens_novos              INT UNSIGNED NOT NULL DEFAULT 0,
  itens_removidos          INT UNSIGNED NOT NULL DEFAULT 0,
  itens_alterados          INT UNSIGNED NOT NULL DEFAULT 0,
  itens_iguais             INT UNSIGNED NOT NULL DEFAULT 0,
  lotes_total              INT UNSIGNED NOT NULL DEFAULT 0,
  lotes_publicados         INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Confirmado pelo worker na mesma transação de cada lote',
  tamanho_lote             INT UNSIGNED NOT NULL DEFAULT 0,
  motivo                   VARCHAR(500) NULL,
  aprovada_em              DATETIME(3) NULL,
  aprovada_por_usuario_id  BIGINT UNSIGNED NULL,
  encerrada_em             DATETIME(3) NULL COMMENT 'Rejeitada, cancelada ou com falha',
  encerrada_por_usuario_id BIGINT UNSIGNED NULL,
  publicada_em             DATETIME(3) NULL,
  criado_em                DATETIME(3) NOT NULL,
  criado_por               BIGINT UNSIGNED NULL COMMENT 'Quem enviou a carga',
  alterado_em              DATETIME(3) NULL,
  alterado_por             BIGINT UNSIGNED NULL,
  versao                   INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_carga_catalogo_situacao CHECK (situacao IN ('preparada','validada','comparada','aprovada','publicando','publicada','rejeitada','cancelada','falhou')),
  CONSTRAINT ck_carga_catalogo_linhas CHECK (linhas_validas + linhas_erro = total_linhas),
  CONSTRAINT ck_carga_catalogo_lotes CHECK (lotes_publicados <= lotes_total),
  CONSTRAINT ck_carga_catalogo_sha CHECK (arquivo_sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT ck_carga_catalogo_aprovada CHECK (situacao NOT IN ('aprovada','publicando','publicada') OR aprovada_em IS NOT NULL),
  CONSTRAINT ck_carga_catalogo_aprovador CHECK (situacao NOT IN ('aprovada','publicando','publicada') OR aprovada_por_usuario_id IS NOT NULL),
  CONSTRAINT ck_carga_catalogo_encerrada CHECK (situacao NOT IN ('rejeitada','cancelada','falhou') OR encerrada_em IS NOT NULL),
  CONSTRAINT ck_carga_catalogo_publicada CHECK (situacao <> 'publicada' OR publicada_em IS NOT NULL),
  KEY ix_carga_catalogo_estabelecimento (estabelecimento_id, catalogo, situacao),
  KEY ix_carga_catalogo_sha (estabelecimento_id, catalogo, arquivo_sha256),
  KEY ix_carga_catalogo_aprovada_por (aprovada_por_usuario_id),
  KEY ix_carga_catalogo_encerrada_por (encerrada_por_usuario_id)
) COMMENT='Carga de catálogo oficial: arquivo por hash, situação, totais da comparação, lotes de publicação e decisão';

CREATE TABLE carga_catalogo_linha (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  carga_catalogo_id BIGINT UNSIGNED NOT NULL,
  linha             INT UNSIGNED NOT NULL COMMENT 'Linha no arquivo (itens removidos: numeração a partir de 9.000.000)',
  entidade          VARCHAR(40) NOT NULL COMMENT 'Entidade do catálogo na definição do produto',
  chave             VARCHAR(200) NOT NULL COMMENT 'Chave natural do item (campo=valor;...)',
  resultado         VARCHAR(10) NOT NULL,
  comparacao        VARCHAR(10) NULL,
  valores           JSON NULL COMMENT 'Valores do arquivo (na alteração, só os que mudam)',
  valores_antes     JSON NULL COMMENT 'Valores que o banco tinha',
  motivo            VARCHAR(500) NULL,
  lote              INT UNSIGNED NULL COMMENT 'Lote de publicação do item; nulo: não vai à publicação',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_carga_catalogo_linha_resultado CHECK (resultado IN ('valida','erro')),
  CONSTRAINT ck_carga_catalogo_linha_comparacao CHECK (comparacao IS NULL OR comparacao IN ('novo','removido','alterado','igual')),
  CONSTRAINT ck_carga_catalogo_linha_lote CHECK (lote IS NULL OR (lote >= 1 AND resultado = 'valida')),
  UNIQUE KEY uq_carga_catalogo_linha_linha (carga_catalogo_id, linha),
  KEY ix_carga_catalogo_linha_lote (carga_catalogo_id, lote),
  KEY ix_carga_catalogo_linha_comparacao (carga_catalogo_id, comparacao, resultado)
) COMMENT='Linha preparada da carga de catálogo: entidade, chave natural, valores antes e depois, resultado e lote';

CREATE TABLE licenca_catalogo (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id     BIGINT UNSIGNED NOT NULL,
  catalogo               VARCHAR(30) NOT NULL COMMENT 'Código do catálogo licenciado (brasindice, simpro...)',
  numero_contrato        VARCHAR(60) NULL,
  vigencia_inicio        DATE NOT NULL,
  vigencia_fim           DATE NULL COMMENT 'Nulo enquanto vigente',
  comprovante_arquivo_id BIGINT UNSIGNED NOT NULL COMMENT 'Contrato ou nota da licença (regra 7: só entra com a prova)',
  observacao             VARCHAR(500) NULL,
  criado_em              DATETIME(3) NOT NULL,
  criado_por             BIGINT UNSIGNED NULL,
  alterado_em            DATETIME(3) NULL,
  alterado_por           BIGINT UNSIGNED NULL,
  versao                 INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em            DATETIME(3) NULL,
  excluido_por           BIGINT UNSIGNED NULL,
  CONSTRAINT ck_licenca_catalogo_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  KEY ix_licenca_catalogo_estabelecimento (estabelecimento_id, catalogo, vigencia_inicio),
  KEY ix_licenca_catalogo_comprovante (comprovante_arquivo_id)
) COMMENT='Licença de catálogo licenciado por estabelecimento, com vigência e o comprovante';

-- chaves
ALTER TABLE carga_catalogo
  ADD CONSTRAINT fk_carga_catalogo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carga_catalogo_aprovada_por_usuario_id FOREIGN KEY (aprovada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_carga_catalogo_encerrada_por_usuario_id FOREIGN KEY (encerrada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE carga_catalogo_linha
  ADD CONSTRAINT fk_carga_catalogo_linha_carga_catalogo_id FOREIGN KEY (carga_catalogo_id) REFERENCES carga_catalogo (id) ON DELETE RESTRICT;
ALTER TABLE licenca_catalogo
  ADD CONSTRAINT fk_licenca_catalogo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_licenca_catalogo_comprovante_arquivo_id FOREIGN KEY (comprovante_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
