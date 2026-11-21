-- HOT, lote 05 (F2.2 onda 2; pedidos dos lotes 02-12, 02-14): tabelas e colunas que as portas próprias pedem.
-- Convenções do ADR 0002 (parte 2). Sem FOREIGN KEY aqui (05_chaves.sql).

CREATE TABLE inventario_enxoval (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  numero VARCHAR(30) NOT NULL COMMENT 'Número de negócio (sequencia_negocio)',
  contado_em DATETIME(3) NOT NULL,
  setor_funcional_id BIGINT UNSIGNED NULL COMMENT 'Nulo: inventário da rouparia central',
  responsavel_usuario_id BIGINT UNSIGNED NOT NULL,
  situacao VARCHAR(20) NOT NULL DEFAULT 'registrado',
  cancelado_em DATETIME(3) NULL,
  motivo_cancelamento VARCHAR(500) NULL,
  observacao VARCHAR(500) NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_inventario_enxoval_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_inventario_enxoval_situacao CHECK (situacao IN ('registrado','cancelado')),
  CONSTRAINT ck_inventario_enxoval_cancelamento CHECK (situacao <> 'cancelado' OR (cancelado_em IS NOT NULL AND motivo_cancelamento IS NOT NULL)),
  UNIQUE KEY uq_inventario_enxoval_numero (estabelecimento_id, numero),
  KEY ix_inventario_enxoval_data (estabelecimento_id, contado_em),
  KEY ix_inventario_enxoval_setor_funcional (setor_funcional_id),
  KEY ix_inventario_enxoval_responsavel_usuario (responsavel_usuario_id)
) COMMENT='Contagem das peças do enxoval na rouparia ou no setor';

CREATE TABLE inventario_enxoval_item (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  inventario_enxoval_id BIGINT UNSIGNED NOT NULL,
  sequencia SMALLINT UNSIGNED NOT NULL,
  peca_enxoval_id BIGINT UNSIGNED NOT NULL,
  quantidade_contada INT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_inventario_enxoval_item_sequencia (inventario_enxoval_id, sequencia),
  UNIQUE KEY uq_inventario_enxoval_item_peca (inventario_enxoval_id, peca_enxoval_id),
  KEY ix_inventario_enxoval_item_peca_enxoval (peca_enxoval_id)
) COMMENT='Quantidade contada de cada peça no inventário do enxoval';

CREATE TABLE peca_enxoval_composicao (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kit_peca_enxoval_id BIGINT UNSIGNED NOT NULL,
  componente_peca_enxoval_id BIGINT UNSIGNED NOT NULL,
  quantidade SMALLINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_peca_enxoval_composicao_quantidade CHECK (quantidade BETWEEN 1 AND 99),
  CONSTRAINT ck_peca_enxoval_composicao_distintas CHECK (kit_peca_enxoval_id <> componente_peca_enxoval_id),
  UNIQUE KEY uq_peca_enxoval_composicao (kit_peca_enxoval_id, componente_peca_enxoval_id),
  KEY ix_peca_enxoval_composicao_componente (componente_peca_enxoval_id)
) COMMENT='Peças que compõem um kit do enxoval, com a quantidade';

CREATE TABLE remessa_lavanderia_item (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  remessa_lavanderia_id BIGINT UNSIGNED NOT NULL,
  sequencia SMALLINT UNSIGNED NOT NULL,
  peca_enxoval_id BIGINT UNSIGNED NOT NULL,
  quantidade INT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_remessa_lavanderia_item_quantidade CHECK (quantidade > 0),
  UNIQUE KEY uq_remessa_lavanderia_item_sequencia (remessa_lavanderia_id, sequencia),
  UNIQUE KEY uq_remessa_lavanderia_item_peca (remessa_lavanderia_id, peca_enxoval_id),
  KEY ix_remessa_lavanderia_item_peca_enxoval (peca_enxoval_id)
) COMMENT='Quantidade de cada peça enviada à lavanderia na remessa';

CREATE TABLE baixa_enxoval_item (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  baixa_enxoval_id BIGINT UNSIGNED NOT NULL,
  sequencia SMALLINT UNSIGNED NOT NULL,
  peca_enxoval_id BIGINT UNSIGNED NOT NULL,
  quantidade INT UNSIGNED NOT NULL,
  custo_estimado DECIMAL(15,2) NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_baixa_enxoval_item_quantidade CHECK (quantidade > 0),
  CONSTRAINT ck_baixa_enxoval_item_custo CHECK (custo_estimado IS NULL OR custo_estimado >= 0),
  UNIQUE KEY uq_baixa_enxoval_item_sequencia (baixa_enxoval_id, sequencia),
  UNIQUE KEY uq_baixa_enxoval_item_peca (baixa_enxoval_id, peca_enxoval_id),
  KEY ix_baixa_enxoval_item_peca_enxoval (peca_enxoval_id)
) COMMENT='Peças e quantidades de cada baixa do enxoval';

ALTER TABLE visita
  ADD COLUMN cracha_valido_ate DATETIME(3) NULL COMMENT 'Validade do crachá emitido na entrada' AFTER cracha_visitante_id,
  ADD COLUMN chave_pedido VARCHAR(80) NULL COMMENT 'Chave do pedido (Idempotency-Key): o reenvio devolve a mesma visita' AFTER observacao,
  ADD COLUMN excecao VARCHAR(200) NULL COMMENT 'Exceção autorizada pela supervisão (fora do horário, limite)' AFTER chave_pedido,
  ADD COLUMN local_destino VARCHAR(150) NULL COMMENT 'Local visitado quando o destino não é paciente nem setor cadastrado' AFTER excecao,
  ADD COLUMN origem_saida VARCHAR(20) NULL COMMENT 'portaria, catraca ou expirada' AFTER saida_usuario_id,
  ADD CONSTRAINT ck_visita_origem_saida CHECK (origem_saida IS NULL OR origem_saida IN ('portaria','catraca','expirada')),
  ADD UNIQUE KEY uq_visita_chave_pedido (estabelecimento_id, chave_pedido),
  DROP CONSTRAINT ck_visita_visitado,
  ADD CONSTRAINT ck_visita_visitado CHECK (paciente_id IS NOT NULL OR setor_funcional_id IS NOT NULL OR visitado_colaborador_id IS NOT NULL OR local_destino IS NOT NULL);

ALTER TABLE regra_visita_unidade
  ADD COLUMN idade_minima_anos SMALLINT UNSIGNED NULL COMMENT 'Idade mínima do visitante',
  ADD COLUMN duracao_maxima_minutos SMALLINT UNSIGNED NULL COMMENT 'Duração máxima da visita',
  ADD COLUMN conduta_isolamento VARCHAR(20) NOT NULL DEFAULT 'orientar' COMMENT 'Paciente em isolamento: bloquear ou orientar',
  ADD COLUMN observacao VARCHAR(500) NULL,
  ADD COLUMN excluido_em DATETIME(3) NULL,
  ADD COLUMN excluido_por BIGINT UNSIGNED NULL,
  ADD CONSTRAINT ck_regra_visita_unidade_isolamento CHECK (conduta_isolamento IN ('bloquear','orientar'));

ALTER TABLE bloqueio_visitante
  ADD COLUMN limite_visitantes TINYINT UNSIGNED NULL COMMENT 'Limite de visitantes simultâneos (abrangência limite)',
  ADD COLUMN inclui_acompanhante BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Barra também o acompanhante (ordem judicial ou decisão clínica)',
  ADD COLUMN documento_referencia VARCHAR(60) NULL COMMENT 'Processo ou documento da ordem judicial',
  ADD COLUMN motivo_inativacao VARCHAR(500) NULL COMMENT 'Motivo da revogação',
  ADD CONSTRAINT ck_bloqueio_visitante_limite CHECK (limite_visitantes IS NULL OR limite_visitantes BETWEEN 1 AND 10);

ALTER TABLE pessoa_portaria
  ADD COLUMN guarda_ate DATE NULL COMMENT 'Fim do prazo de guarda do cadastro (LGPD)',
  ADD COLUMN anonimizada_em DATETIME(3) NULL COMMENT 'Cadastro anonimizado ao vencer a guarda',
  DROP CONSTRAINT ck_pessoa_portaria_identificacao,
  ADD CONSTRAINT ck_pessoa_portaria_identificacao CHECK (anonimizada_em IS NOT NULL OR cpf IS NOT NULL OR numero_documento IS NOT NULL),
  ADD KEY ix_pessoa_portaria_guarda (guarda_ate);

ALTER TABLE coleta_roupa_suja
  ADD COLUMN cancelado_em DATETIME(3) NULL,
  ADD COLUMN motivo_cancelamento VARCHAR(500) NULL,
  ADD CONSTRAINT ck_coleta_roupa_suja_cancelamento CHECK (situacao <> 'cancelada' OR motivo_cancelamento IS NOT NULL);

ALTER TABLE distribuicao_enxoval
  ADD COLUMN cancelado_em DATETIME(3) NULL,
  ADD COLUMN motivo_cancelamento VARCHAR(500) NULL,
  ADD CONSTRAINT ck_distribuicao_enxoval_cancelamento CHECK (situacao <> 'cancelada' OR motivo_cancelamento IS NOT NULL);

ALTER TABLE baixa_enxoval
  ADD COLUMN cancelado_em DATETIME(3) NULL,
  ADD COLUMN motivo_cancelamento VARCHAR(500) NULL,
  ADD CONSTRAINT ck_baixa_enxoval_cancelamento CHECK (situacao <> 'cancelada' OR motivo_cancelamento IS NOT NULL);

ALTER TABLE retorno_lavanderia
  DROP INDEX uq_retorno_lavanderia_remessa,
  ADD COLUMN remessa_vigente_id BIGINT UNSIGNED AS (IF(situacao = 'cancelado' OR excluido_em IS NOT NULL, NULL, remessa_lavanderia_id)) PERSISTENT COMMENT 'Um retorno vigente por remessa',
  ADD UNIQUE KEY uq_retorno_lavanderia_remessa_vigente (remessa_vigente_id),
  ADD KEY ix_retorno_lavanderia_remessa (remessa_lavanderia_id);
