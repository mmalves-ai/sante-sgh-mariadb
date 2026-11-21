-- FAT, lote 10 (F2.2 ondas finais, onda 3; pedidos dos lotes 03-04 e 03-16). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (10_chaves.sql).

-- 03-04: valor da hora por tipo de plantão
ALTER TABLE valor_hora_plantao
  ADD COLUMN tipo_plantao VARCHAR(20) NULL COMMENT 'Tipo de plantão a que o valor se aplica; nulo vale para todos',
  ADD CONSTRAINT ck_valor_hora_plantao_tipo_plantao CHECK (tipo_plantao IS NULL OR tipo_plantao IN ('presencial','sobreaviso','diarista'));

-- 03-16: retorno do recurso de glosa e recibo do protocolo
ALTER TABLE glosa_item
  ADD COLUMN motivo_retorno_glosa_id BIGINT UNSIGNED NULL COMMENT 'Motivo da negativa ou do acatamento parcial no retorno do recurso',
  ADD COLUMN evidencia_prontuario VARCHAR(250) NULL COMMENT 'Evidência do prontuário na decisão de recorrer',
  ADD KEY ix_glosa_item_motivo_retorno_glosa (motivo_retorno_glosa_id);
ALTER TABLE protocolo_recebimento
  ADD COLUMN numero_recibo VARCHAR(60) NULL COMMENT 'Recibo do comprovante de entrega do lote';
