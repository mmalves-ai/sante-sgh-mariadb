-- Recibo do comprovante de entrega do lote TISS no registro do protocolo (06-FAT linha 31, F3.7, 24/11/2026): só para
-- frente e idempotente (ADR 0002, parte 2). Sem gatilho; a gravação é a operação faturamento.registrar-protocolo
-- (apps/api/src/modulos/tiss/operacoes.ts) e a leitura volta no histórico do protocolo do lote.
--   - protocolo_recebimento.recibo: o número ou a identificação do recibo que a fonte pagadora deu na entrega (o que o
--     faturista digita junto do protocolo). Registros anteriores ficam sem recibo (NULL): nada é inventado.

ALTER TABLE protocolo_recebimento
  ADD COLUMN IF NOT EXISTS recibo VARCHAR(60) NULL COMMENT 'Recibo do comprovante de entrega dado pela fonte pagadora' AFTER numero_protocolo;
