-- SGO, lote 11 (F2.2 onda 2; pedidos dos lotes 02-09, 02-10): tabelas e colunas que as portas próprias pedem.
-- Convenções do ADR 0002 (parte 2). Sem FOREIGN KEY aqui (11_chaves.sql).

CREATE TABLE complemento_sib_beneficiario (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  beneficiario_plano_id BIGINT UNSIGNED NOT NULL,
  declaracao_nascido_vivo CHAR(11) NULL,
  reside_exterior BOOLEAN NOT NULL DEFAULT FALSE,
  itens_excluidos_cobertura BOOLEAN NOT NULL DEFAULT FALSE,
  motivo_movimento_cadastral_id BIGINT UNSIGNED NULL COMMENT 'Motivo de cancelamento informado à ANS',
  aceito_envio_ans_id BIGINT UNSIGNED NULL,
  aceito_em DATETIME(3) NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  CONSTRAINT ck_complemento_sib_beneficiario_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_complemento_sib_beneficiario (beneficiario_plano_id),
  KEY ix_complemento_sib_beneficiario_motivo (motivo_movimento_cadastral_id),
  KEY ix_complemento_sib_beneficiario_envio (aceito_envio_ans_id)
) COMMENT='Complemento cadastral do beneficiário para o SIB';

CREATE TABLE conta_portal_prestador_funcao (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conta_portal_prestador_id BIGINT UNSIGNED NOT NULL,
  funcao_portal_prestador_id BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_conta_portal_prestador_funcao (conta_portal_prestador_id, funcao_portal_prestador_id),
  KEY ix_conta_portal_prestador_funcao_funcao (funcao_portal_prestador_id)
) COMMENT='Funções liberadas para a conta do portal do prestador';

ALTER TABLE envio_ans
  ADD COLUMN destino VARCHAR(20) NOT NULL DEFAULT 'simulador' AFTER tipo_envio,
  ADD COLUMN quadros JSON NULL COMMENT 'Resumo do arquivo gerado (quadros da obrigação)',
  ADD COLUMN cobranca_ressarcimento_sus_id BIGINT UNSIGNED NULL COMMENT 'Aviso do ressarcimento ao SUS analisado neste envio',
  ADD CONSTRAINT ck_envio_ans_destino CHECK (destino IN ('simulador','ans')),
  ADD CONSTRAINT ck_envio_ans_quadros CHECK (quadros IS NULL OR JSON_VALID(quadros)),
  ADD KEY ix_envio_ans_cobranca_ressarcimento_sus_id (cobranca_ressarcimento_sus_id);

ALTER TABLE envio_ans_item
  ADD COLUMN ressarcimento_sus_atendimento_id BIGINT UNSIGNED NULL,
  ADD KEY ix_envio_ans_item_ressarcimento_sus_atendimento_id (ressarcimento_sus_atendimento_id);

ALTER TABLE fatura_plano
  ADD COLUMN valor_multa DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER valor_acrescimo,
  ADD COLUMN valor_juros DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER valor_multa,
  ADD COLUMN motivo_dispensa VARCHAR(500) NULL,
  ADD COLUMN motivo_cancelamento VARCHAR(500) NULL,
  ADD COLUMN acordo_inadimplencia_id BIGINT UNSIGNED NULL COMMENT 'Acordo de que esta fatura é parcela',
  ADD CONSTRAINT ck_fatura_plano_multa_juros CHECK (valor_multa >= 0 AND valor_juros >= 0),
  ADD CONSTRAINT ck_fatura_plano_motivo_cancelamento CHECK (situacao <> 'cancelada' OR motivo_cancelamento IS NOT NULL),
  ADD KEY ix_fatura_plano_acordo_inadimplencia_id (acordo_inadimplencia_id);

ALTER TABLE reajuste_contrato_plano
  ADD COLUMN percentual_teto_ans DECIMAL(7,4) NULL,
  ADD COLUMN oficio_ans VARCHAR(60) NULL,
  ADD COLUMN cancelado_em DATETIME(3) NULL,
  ADD COLUMN cancelado_por_usuario_id BIGINT UNSIGNED NULL,
  ADD COLUMN motivo_cancelamento VARCHAR(500) NULL,
  ADD CONSTRAINT ck_reajuste_contrato_plano_cancelamento CHECK (situacao <> 'cancelado' OR (cancelado_em IS NOT NULL AND motivo_cancelamento IS NOT NULL));

ALTER TABLE protocolo_beneficiario
  ADD COLUMN operadora_saude_id BIGINT UNSIGNED NULL AFTER estabelecimento_id,
  ADD COLUMN instancia VARCHAR(30) NULL,
  ADD COLUMN natureza VARCHAR(30) NULL,
  ADD COLUMN canal VARCHAR(30) NULL,
  ADD COLUMN assunto VARCHAR(200) NULL,
  ADD COLUMN numero_nip VARCHAR(30) NULL,
  ADD COLUMN urgente BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN alta_complexidade BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN prazo_tipo VARCHAR(20) NOT NULL DEFAULT 'padrao',
  ADD COLUMN prorrogado_ate DATETIME(3) NULL,
  ADD COLUMN motivo_prorrogacao VARCHAR(500) NULL,
  ADD COLUMN escrita_pedida_em DATETIME(3) NULL,
  ADD COLUMN escrita_prazo_em DATETIME(3) NULL,
  ADD COLUMN escrita_enviada_em DATETIME(3) NULL,
  ADD COLUMN escrita_meio VARCHAR(20) NULL,
  ADD COLUMN reanalise_de_protocolo_beneficiario_id BIGINT UNSIGNED NULL,
  ADD CONSTRAINT ck_protocolo_beneficiario_prazo_tipo CHECK (prazo_tipo IN ('imediato','padrao','complexo')),
  ADD CONSTRAINT ck_protocolo_beneficiario_prorrogacao CHECK (prorrogado_ate IS NULL OR motivo_prorrogacao IS NOT NULL),
  ADD KEY ix_protocolo_beneficiario_operadora_saude_id (operadora_saude_id),
  ADD KEY ix_protocolo_beneficiario_reanalise (reanalise_de_protocolo_beneficiario_id);

ALTER TABLE lote_conta_recebida
  ADD COLUMN pago_em DATE NULL,
  ADD COLUMN documento_pagamento VARCHAR(60) NULL,
  ADD CONSTRAINT ck_lote_conta_recebida_pagamento CHECK (situacao <> 'paga' OR pago_em IS NOT NULL);

ALTER TABLE prestador_rede
  DROP CONSTRAINT ck_prestador_rede_forma_remuneracao,
  ADD CONSTRAINT ck_prestador_rede_forma_remuneracao CHECK (forma_remuneracao IN ('procedimento','pacote','diaria','capitacao','assalariado','misto','orcamentacao','drg','bundle_episodio','bundle_condicao_clinica'));

ALTER TABLE produto_plano
  ADD COLUMN operadora_saude_id BIGINT UNSIGNED NULL COMMENT 'Operadora dona do produto' AFTER estabelecimento_id,
  ADD KEY ix_produto_plano_operadora_saude_id (operadora_saude_id);

ALTER TABLE produto_plano
  ADD COLUMN natureza VARCHAR(20) NOT NULL DEFAULT 'plano' AFTER nome,
  ADD CONSTRAINT ck_produto_plano_natureza CHECK (natureza IN ('plano','cartao_desconto'));

ALTER TABLE prestador_rede_historico
  ADD COLUMN substituto_prestador_rede_id BIGINT UNSIGNED NULL,
  ADD COLUMN aviso_beneficiarios_em DATE NULL,
  ADD COLUMN autorizacao_ans VARCHAR(40) NULL,
  ADD KEY ix_prestador_rede_historico_substituto (substituto_prestador_rede_id);

ALTER TABLE movimento_rede_ans
  ADD COLUMN campos_alterados JSON NULL COMMENT 'Campos do registro de prestadores mudados',
  ADD COLUMN motivo VARCHAR(500) NULL;
