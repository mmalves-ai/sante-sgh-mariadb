-- Autorização prévia à operadora: transmissão ao webservice pela central de integrações externas (06-FAT linha 27,
-- C2-081, decisão 53 do dono, 27/11/2026). Só para frente e idempotente (ADR 0002, parte 2). Sem gatilho; as gravações
-- são da porta própria (apps/api/src/modulos/tiss/autorizacao-previa-propria.ts, transmitirWebservice).
--   - transmissao_modo: por onde a transmissão automática respondeu ('simulador', o padrão e sempre fora de produção,
--     ou 'real'); nulo quando a entrega foi registrada à mão por outro canal;
--   - protocolo_transmissao: o protocolo devolvido pelo webservice (no simulador, 'SIM-...' determinístico);
--   - falha_transmissao e falha_transmissao_em: a última recusa ou erro de transporte; o pedido segue pronto para envio.

ALTER TABLE solicitacao_autorizacao
  ADD COLUMN IF NOT EXISTS transmissao_modo VARCHAR(20) NULL COMMENT 'Modo da central na transmissão automática: simulador ou real';
ALTER TABLE solicitacao_autorizacao
  ADD COLUMN IF NOT EXISTS protocolo_transmissao VARCHAR(40) NULL COMMENT 'Protocolo devolvido pelo webservice da operadora';
ALTER TABLE solicitacao_autorizacao
  ADD COLUMN IF NOT EXISTS falha_transmissao VARCHAR(300) NULL COMMENT 'Última recusa ou erro de transporte da transmissão automática';
ALTER TABLE solicitacao_autorizacao
  ADD COLUMN IF NOT EXISTS falha_transmissao_em DATETIME(3) NULL COMMENT 'Instante da última falha da transmissão automática';

ALTER TABLE solicitacao_autorizacao DROP CONSTRAINT IF EXISTS ck_solicitacao_autorizacao_transmissao;
ALTER TABLE solicitacao_autorizacao
  ADD CONSTRAINT ck_solicitacao_autorizacao_transmissao CHECK ((transmissao_modo IS NULL OR transmissao_modo IN ('simulador','real')) AND (protocolo_transmissao IS NULL OR transmissao_modo IS NOT NULL));
