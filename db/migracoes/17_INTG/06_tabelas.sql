-- INTG, lote 06 (F2.2 ondas finais, onda 5b; pedidos do lote 05-13). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (06_chaves.sql).

-- 05-13: a aprovação da carga feita numa sessão de suporte ("como" o usuário, ADR 0021) fica marcada na carga; a
-- publicação do worker leva a mesma marca à trilha (antes a trilha levava só o aprovador).
ALTER TABLE carga_catalogo
  ADD COLUMN aprovada_como_sessao_suporte_id BIGINT UNSIGNED NULL COMMENT 'Sessão de suporte em que a carga foi aprovada (publicação marcada como a sessão)' AFTER aprovada_por_usuario_id,
  ADD COLUMN aprovada_como_acao_suporte_id BIGINT UNSIGNED NULL COMMENT 'Ação de suporte da aprovação' AFTER aprovada_como_sessao_suporte_id,
  ADD KEY ix_carga_catalogo_aprovada_como (aprovada_como_sessao_suporte_id),
  ADD KEY ix_carga_catalogo_aprovada_como_acao (aprovada_como_acao_suporte_id),
  ADD CONSTRAINT ck_carga_catalogo_aprovada_como CHECK (aprovada_como_acao_suporte_id IS NULL OR aprovada_como_sessao_suporte_id IS NOT NULL);

-- 05-13: catálogos licenciados (regra 7 do AGENTS.md): o item publicado é do estabelecimento que comprovou a licença,
-- nunca da rede; a escrita confere na transação que a licença é do mesmo estabelecimento, do mesmo catálogo e vigente.
CREATE TABLE item_catalogo_licenciado (
  id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id          BIGINT UNSIGNED NOT NULL COMMENT 'Estabelecimento que comprovou a licença (regra 7: nunca vale para a rede)',
  licenca_catalogo_id         BIGINT UNSIGNED NOT NULL COMMENT 'Licença vigente que autorizou a carga desta edição',
  catalogo                    VARCHAR(30) NOT NULL COMMENT 'Catálogo licenciado (brasindice, simpro)',
  codigo                      VARCHAR(10) NOT NULL COMMENT 'Código do item no catálogo (apresentação ou produto)',
  edicao                      VARCHAR(12) NOT NULL COMMENT 'Edição do arquivo oficial carregado',
  nome                        VARCHAR(150) NOT NULL,
  classificacao               VARCHAR(20) NULL COMMENT 'material, medicamento ou outra classe do catálogo',
  codigo_apresentacao         VARCHAR(4) NULL,
  codigo_fabricante           INT UNSIGNED NULL COMMENT 'Laboratório ou fabricante no catálogo',
  fator_conversao             INT UNSIGNED NULL,
  unidade                     VARCHAR(10) NULL,
  registro_anvisa             VARCHAR(15) NULL,
  referencia_fabricante       VARCHAR(100) NULL,
  codigo_tuss                 VARCHAR(10) NULL,
  preco_maximo_consumidor     DECIMAL(14,4) NULL,
  preco_fabrica               DECIMAL(14,4) NULL,
  preco                       DECIMAL(14,4) NULL COMMENT 'Preço único do catálogo que não separa fábrica e consumidor',
  ativo                       BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em                   DATETIME(3) NOT NULL,
  criado_por                  BIGINT UNSIGNED NULL,
  alterado_em                 DATETIME(3) NULL,
  alterado_por                BIGINT UNSIGNED NULL,
  versao                      INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_item_catalogo_licenciado_catalogo CHECK (catalogo IN ('brasindice','simpro')),
  CONSTRAINT ck_item_catalogo_licenciado_precos CHECK ((preco_maximo_consumidor IS NULL OR preco_maximo_consumidor >= 0) AND (preco_fabrica IS NULL OR preco_fabrica >= 0) AND (preco IS NULL OR preco >= 0)),
  CONSTRAINT ck_item_catalogo_licenciado_fator CHECK (fator_conversao IS NULL OR fator_conversao > 0),
  UNIQUE KEY uq_item_catalogo_licenciado_edicao (estabelecimento_id, catalogo, codigo, edicao),
  KEY ix_item_catalogo_licenciado_licenca (licenca_catalogo_id),
  KEY ix_item_catalogo_licenciado_tuss (codigo_tuss)
) COMMENT='Apresentação ou produto de catálogo licenciado, com os preços por edição, só no estabelecimento licenciado';
