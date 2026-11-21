-- F2.4 (dívida da migração), 3ª etapa, 4ª leva: DDL pedido pelos lotes das portas (p-*), só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v4.md

-- Empregador no eSocial: indicativo de cooperativa e de construtora anuláveis (nulo = não informado; as informações
-- só cabem em certas classificações tributárias e não podem virar "não" por padrão).
ALTER TABLE cadastro_empregador
  MODIFY COLUMN indicador_cooperativa VARCHAR(20) NULL DEFAULT NULL COMMENT 'Indicativo de cooperativa; nulo: não informado',
  MODIFY COLUMN construtora BOOLEAN NULL DEFAULT NULL COMMENT 'Indicativo de construtora; nulo: não informado',
  DROP CONSTRAINT IF EXISTS ck_cadastro_empregador_indicador_cooperativa,
  ADD CONSTRAINT ck_cadastro_empregador_indicador_cooperativa CHECK (indicador_cooperativa IS NULL OR indicador_cooperativa IN ('nao_cooperativa','trabalho','producao','outra'));

-- Folha externa: a unidade da soma pelo sentido (decisão: comentário, sem trocar a coluna que a porta já grava).
ALTER TABLE lote_folha_intercambio
  MODIFY COLUMN soma DECIMAL(15,2) NOT NULL COMMENT 'Soma do lote, com a unidade pelo sentido: reais (líquido mais encargos) no recebido; minutos (ponto mais plantão) no exportado';
