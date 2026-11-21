-- FIN, lote 11 (F2.2 onda 2; pedidos dos lotes 02-03, 02-07, 02-08, 02-11): tabelas e colunas que as portas próprias pedem.
-- Convenções do ADR 0002 (parte 2). Sem FOREIGN KEY aqui (11_chaves.sql).

CREATE TABLE coleta_estatistica_custo (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  competencia DATE NOT NULL,
  resumo JSON NOT NULL COMMENT 'Contagens por fonte',
  linhas INT UNSIGNED NOT NULL DEFAULT 0,
  duracao_ms INT UNSIGNED NOT NULL DEFAULT 0,
  coletada_em DATETIME(3) NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_coleta_estatistica_custo_competencia CHECK (DAY(competencia) = 1),
  CONSTRAINT ck_coleta_estatistica_custo_resumo CHECK (JSON_VALID(resumo)),
  KEY ix_coleta_estatistica_custo_competencia (estabelecimento_id, competencia)
) COMMENT='Coleta automática das estatísticas de custeio da competência';

CREATE TABLE apuracao_custo_centro (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  apuracao_custo_id BIGINT UNSIGNED NOT NULL,
  centro_custo_id BIGINT UNSIGNED NOT NULL,
  classe VARCHAR(30) NOT NULL,
  ordem_rateio SMALLINT UNSIGNED NULL,
  criterio_tipo_dado_estatistico_id BIGINT UNSIGNED NULL,
  custo_pessoal DECIMAL(15,2) NOT NULL DEFAULT 0,
  custo_materiais DECIMAL(15,2) NOT NULL DEFAULT 0,
  custo_despesas DECIMAL(15,2) NOT NULL DEFAULT 0,
  custo_despesas_gerais DECIMAL(15,2) NOT NULL DEFAULT 0,
  custo_direto DECIMAL(15,2) NOT NULL DEFAULT 0,
  custo_recebido DECIMAL(15,2) NOT NULL DEFAULT 0,
  recebidos JSON NULL,
  custo_repassado DECIMAL(15,2) NOT NULL DEFAULT 0,
  custo_nao_rateado DECIMAL(15,2) NOT NULL DEFAULT 0,
  custo_final DECIMAL(15,2) NOT NULL DEFAULT 0,
  base_criterio DECIMAL(15,4) NULL,
  producao_codigo VARCHAR(30) NULL,
  producao_quantidade DECIMAL(15,4) NULL,
  custo_unitario DECIMAL(15,4) NULL,
  valor_receita DECIMAL(15,2) NOT NULL DEFAULT 0,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_apuracao_custo_centro (apuracao_custo_id, centro_custo_id),
  CONSTRAINT ck_apuracao_custo_centro_classe CHECK (classe IN ('produtivo','auxiliar','administrativo','externo')),
  CONSTRAINT ck_apuracao_custo_centro_recebidos CHECK (recebidos IS NULL OR JSON_VALID(recebidos))
) COMMENT='Linha por centro da apuração do custo do mês';

CREATE TABLE arquivo_fiscal_gerado (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  tipo VARCHAR(30) NOT NULL,
  periodo VARCHAR(7) NOT NULL COMMENT 'AAAA ou AAAA-MM',
  leiaute VARCHAR(60) NOT NULL,
  titulo_receber_id BIGINT UNSIGNED NULL,
  conta_hospitalar_id BIGINT UNSIGNED NULL,
  momento VARCHAR(20) NULL,
  numero VARCHAR(30) NULL,
  quantidade_registros INT UNSIGNED NOT NULL DEFAULT 0,
  valor_total DECIMAL(15,2) NOT NULL DEFAULT 0,
  valor_iss DECIMAL(15,2) NULL,
  valor_ibs DECIMAL(15,2) NULL,
  valor_cbs DECIMAL(15,2) NULL,
  valor_liquido DECIMAL(15,2) NULL,
  hash_arquivo CHAR(64) NOT NULL,
  chave_objeto VARCHAR(300) NULL,
  destino VARCHAR(20) NOT NULL,
  situacao VARCHAR(20) NOT NULL DEFAULT 'gerado',
  gerado_em DATETIME(3) NOT NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_arquivo_fiscal_gerado_tipo CHECK (tipo IN ('nfse','dmed','reinf_r2000','reinf_r4000')),
  CONSTRAINT ck_arquivo_fiscal_gerado_destino CHECK (destino IN ('simulador','prefeitura','receita')),
  CONSTRAINT ck_arquivo_fiscal_gerado_situacao CHECK (situacao IN ('gerado','simulado','autorizado','rejeitado','enviado','cancelado')),
  CONSTRAINT ck_arquivo_fiscal_gerado_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_arquivo_fiscal_gerado_hash (estabelecimento_id, tipo, hash_arquivo),
  KEY ix_arquivo_fiscal_gerado_titulo_receber (titulo_receber_id),
  KEY ix_arquivo_fiscal_gerado_conta_hospitalar (conta_hospitalar_id)
) COMMENT='Arquivo fiscal gerado (NFS-e simulada, DMED, EFD-REINF) com hash e destino';

CREATE TABLE glosa_titulo_receber (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  titulo_receber_id BIGINT UNSIGNED NOT NULL,
  conta_hospitalar_item_id BIGINT UNSIGNED NULL,
  situacao VARCHAR(30) NOT NULL,
  valor DECIMAL(15,2) NOT NULL,
  motivo VARCHAR(200) NOT NULL,
  meio VARCHAR(10) NOT NULL DEFAULT 'tela',
  chave_evento VARCHAR(100) NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_glosa_titulo_receber_situacao CHECK (situacao IN ('aceita','recurso_deferido','recurso_indeferido')),
  CONSTRAINT ck_glosa_titulo_receber_valor CHECK (valor > 0),
  CONSTRAINT ck_glosa_titulo_receber_meio CHECK (meio IN ('tela','evento')),
  CONSTRAINT ck_glosa_titulo_receber_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_glosa_titulo_receber_chave_evento (chave_evento),
  KEY ix_glosa_titulo_receber_titulo_receber (titulo_receber_id),
  KEY ix_glosa_titulo_receber_conta_hospitalar_item (conta_hospitalar_item_id)
) COMMENT='Glosa registrada no título a receber, por evento';

CREATE TABLE calculo_depreciacao (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  competencia DATE NOT NULL COMMENT 'Primeiro dia do mês calculado',
  base VARCHAR(30) NOT NULL DEFAULT 'societaria',
  rodada SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1 no primeiro cálculo; N+1 depois de N estornos',
  bens_calculados INT UNSIGNED NOT NULL DEFAULT 0,
  bens_ignorados INT UNSIGNED NOT NULL DEFAULT 0,
  valor_total DECIMAL(15,2) NOT NULL DEFAULT 0,
  situacao VARCHAR(30) NOT NULL DEFAULT 'vigente',
  estornado_em DATETIME(3) NULL,
  estorno_usuario_id BIGINT UNSIGNED NULL,
  motivo_estorno VARCHAR(500) NULL,
  origem_estorno VARCHAR(30) NULL,
  vigente_chave VARCHAR(40) AS (IF(situacao = 'vigente', CONCAT(estabelecimento_id, '|', competencia, '|', base), NULL)) STORED,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_calculo_depreciacao_competencia CHECK (DAYOFMONTH(competencia) = 1),
  CONSTRAINT ck_calculo_depreciacao_situacao CHECK (situacao IN ('vigente','estornado')),
  CONSTRAINT ck_calculo_depreciacao_estorno CHECK (situacao <> 'estornado' OR (estornado_em IS NOT NULL AND motivo_estorno IS NOT NULL)),
  CONSTRAINT ck_calculo_depreciacao_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_calculo_depreciacao_rodada (estabelecimento_id, competencia, base, rodada),
  UNIQUE KEY uq_calculo_depreciacao_vigente (vigente_chave)
) COMMENT='Cálculo mensal da depreciação do estabelecimento, com o estorno';

CREATE TABLE ajuste_valor_bem (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bem_patrimonial_id BIGINT UNSIGNED NOT NULL,
  tipo VARCHAR(30) NOT NULL,
  competencia_marco DATE NOT NULL,
  data_ajuste DATE NOT NULL,
  valor_contabil_antes DECIMAL(15,2) NOT NULL,
  valor_contabil_depois DECIMAL(15,2) NOT NULL,
  depreciacao_acumulada_marco DECIMAL(15,2) NOT NULL,
  valor_perda DECIMAL(15,2) NOT NULL DEFAULT 0,
  valor_residual DECIMAL(15,2) NOT NULL DEFAULT 0,
  vida_restante_meses SMALLINT UNSIGNED NOT NULL,
  valor_justo DECIMAL(15,2) NULL,
  laudo_bem_id BIGINT UNSIGNED NULL,
  motivo VARCHAR(500) NOT NULL,
  origem_ajuste VARCHAR(30) NOT NULL,
  estornado_em DATETIME(3) NULL,
  data_estorno DATE NULL,
  estorno_usuario_id BIGINT UNSIGNED NULL,
  motivo_estorno VARCHAR(500) NULL,
  origem_estorno VARCHAR(30) NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_ajuste_valor_bem_tipo CHECK (tipo IN ('revisao_estimativa','impairment','reavaliacao')),
  CONSTRAINT ck_ajuste_valor_bem_marco CHECK (DAYOFMONTH(competencia_marco) = 1),
  CONSTRAINT ck_ajuste_valor_bem_valores CHECK (valor_contabil_antes >= 0 AND valor_contabil_depois >= 0 AND valor_perda >= 0 AND valor_residual >= 0),
  CONSTRAINT ck_ajuste_valor_bem_estorno CHECK (estornado_em IS NULL OR (motivo_estorno IS NOT NULL AND data_estorno IS NOT NULL)),
  CONSTRAINT ck_ajuste_valor_bem_origem CHECK (origem IN ('sistema','migracao','integracao')),
  KEY ix_ajuste_valor_bem_bem (bem_patrimonial_id, competencia_marco)
) COMMENT='Ajuste de valor do bem (revisão de estimativa, recuperabilidade, reavaliação) com o estorno';

CREATE TABLE laudo_bem (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bem_patrimonial_id BIGINT UNSIGNED NOT NULL,
  nome_arquivo VARCHAR(150) NOT NULL,
  descricao VARCHAR(300) NOT NULL,
  chave_armazenamento VARCHAR(300) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  tamanho_bytes INT UNSIGNED NOT NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_laudo_bem_sha256 CHECK (sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT ck_laudo_bem_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_laudo_bem_bem_sha256 (bem_patrimonial_id, sha256)
) COMMENT='Laudo em PDF anexado ao bem patrimonial';

ALTER TABLE estatistica_centro_mes
  ADD coleta_estatistica_custo_id BIGINT UNSIGNED NULL,
  ADD estimada BOOLEAN NOT NULL DEFAULT FALSE,
  ADD observacao VARCHAR(400) NULL;

ALTER TABLE apuracao_custo
  ADD rotulo_parcial VARCHAR(120) NULL,
  ADD limite_linha_centavos BIGINT NOT NULL DEFAULT 0,
  ADD custo_produtivos DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD totais JSON NULL,
  ADD completude JSON NULL,
  ADD pendencias JSON NULL,
  ADD impressao CHAR(64) NULL COMMENT 'SHA-256 da forma canônica',
  ADD justificativa VARCHAR(500) NULL,
  ADD duracao_ms INT UNSIGNED NULL,
  ADD aprovado_em DATETIME(3) NULL,
  ADD aprovador_usuario_id BIGINT UNSIGNED NULL,
  ADD substituida_por_apuracao_custo_id BIGINT UNSIGNED NULL;

ALTER TABLE custo_conta_paciente
  ADD valor_glosa DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD valor_recurso DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD receita_liquida DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD parcelas JSON NULL;

ALTER TABLE centro_custo
  ADD observacao_classificacao VARCHAR(500) NULL COMMENT 'Observação da classificação do custeio',
  ADD versao_classificacao INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Versão da classificação do custeio (trava otimista própria)';

ALTER TABLE estatistica_centro_mes
  ADD escopo_destino BIGINT UNSIGNED AS (IFNULL(destino_setor_funcional_id, 0)) PERSISTENT,
  ADD escopo_item BIGINT UNSIGNED AS (IFNULL(item_faturavel_id, 0)) PERSISTENT,
  ADD lancamento_manual BOOLEAN AS (forma_coleta = 'manual') PERSISTENT,
  ADD vigente_marca TINYINT AS (IF(excluido_em IS NULL, 1, NULL)) PERSISTENT,
  DROP INDEX uq_estatistica_centro_mes_chave,
  ADD UNIQUE KEY uq_estatistica_centro_mes_chave (centro_custo_id, tipo_dado_estatistico_id, competencia, escopo_destino, escopo_item, lancamento_manual, vigente_marca);

ALTER TABLE fluxo_aprovacao
  ADD COLUMN tipo_credor_id BIGINT UNSIGNED NULL COMMENT 'Tipo de credor da faixa (nulo: todos)' AFTER centro_custo_id,
  ADD COLUMN permissao_aprovacao VARCHAR(80) NULL COMMENT 'Permissão que o aprovador precisa ter' AFTER tipo_credor_id,
  ADD KEY ix_fluxo_aprovacao_tipo_credor (tipo_credor_id);

ALTER TABLE lote_exportacao_contabil
  ADD COLUMN regua VARCHAR(20) NULL AFTER leiaute,
  ADD COLUMN valor_creditos DECIMAL(15,2) NULL AFTER valor_total,
  ADD COLUMN quantidade_sem_de_para INT UNSIGNED NOT NULL DEFAULT 0 AFTER valor_creditos,
  ADD CONSTRAINT ck_lote_exportacao_contabil_regua CHECK (regua IS NULL OR regua IN ('competencia','caixa'));

ALTER TABLE remessa_bancaria
  ADD COLUMN destino VARCHAR(20) NOT NULL DEFAULT 'banco' AFTER situacao,
  ADD COLUMN ocorrencias_retorno VARCHAR(1000) NULL AFTER destino,
  ADD COLUMN hash_retorno CHAR(64) NULL AFTER ocorrencias_retorno,
  ADD CONSTRAINT ck_remessa_bancaria_destino CHECK (destino IN ('simulador','banco'));

ALTER TABLE movimento_caixa
  ADD COLUMN orcamento_particular_id BIGINT UNSIGNED NULL AFTER adiantamento_paciente_id,
  ADD COLUMN conta_hospitalar_id BIGINT UNSIGNED NULL AFTER orcamento_particular_id,
  ADD COLUMN parcelas SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER valor,
  ADD KEY ix_movimento_caixa_orcamento_particular_id (orcamento_particular_id),
  ADD KEY ix_movimento_caixa_conta_hospitalar_id (conta_hospitalar_id),
  ADD CONSTRAINT ck_movimento_caixa_parcelas CHECK (parcelas BETWEEN 1 AND 24);

ALTER TABLE cota_depreciacao
  ADD COLUMN calculo_depreciacao_id BIGINT UNSIGNED NULL AFTER bem_patrimonial_id,
  ADD KEY ix_cota_depreciacao_bem_competencia (bem_patrimonial_id, competencia),
  DROP INDEX uq_cota_depreciacao_bem_competencia_base,
  ADD UNIQUE KEY uq_cota_depreciacao_calculo_bem (calculo_depreciacao_id, bem_patrimonial_id);

ALTER TABLE bem_patrimonial
  ADD COLUMN termo_doacao_data DATE NULL AFTER termo_doacao_numero,
  ADD COLUMN termo_doacao_doador VARCHAR(120) NULL AFTER termo_doacao_data;

ALTER TABLE movimento_bem
  ADD COLUMN referencia_movimento_bem_id BIGINT UNSIGNED NULL COMMENT 'Saída que a devolução encerra' AFTER motivo_decisao,
  DROP CONSTRAINT ck_movimento_bem_transferencia,
  ADD CONSTRAINT ck_movimento_bem_transferencia CHECK (tipo_movimento <> 'transferencia' OR destino_setor_funcional_id IS NOT NULL OR destino_estabelecimento_id IS NOT NULL OR destino_centro_custo_id IS NOT NULL);

ALTER TABLE inventario_bem
  ADD COLUMN bens_esperados INT UNSIGNED NULL AFTER encerrado_em,
  ADD COLUMN resumo_encerramento JSON NULL AFTER bens_esperados,
  ADD CONSTRAINT ck_inventario_bem_resumo CHECK (resumo_encerramento IS NULL OR JSON_VALID(resumo_encerramento));

ALTER TABLE inventario_bem_item
  ADD COLUMN encontrado_centro_custo_id BIGINT UNSIGNED NULL AFTER encontrado_setor_funcional_id;

ALTER TABLE linha_orcamento
  DROP CONSTRAINT ck_linha_orcamento_consumo;

ALTER TABLE versao_orcamento
  MODIFY percentual_ajuste_base DECIMAL(8,4) NULL COMMENT 'Ajuste aplicado sobre o realizado do ano anterior',
  ADD COLUMN aprovada_chave VARCHAR(30) AS (IF(situacao = 'aprovado', CONCAT(estabelecimento_id, '|', ano), NULL)) STORED,
  ADD UNIQUE KEY uq_versao_orcamento_aprovada (aprovada_chave);
