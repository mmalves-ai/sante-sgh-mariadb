-- Envio de documentos anexos pelo TISS (06-FAT linha 28, F3.7, 25/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2). Sem gatilho; a regra fica em @sgh/dominio-faturamento (tiss/cancelamento-documentos.ts) e a gravação em
-- apps/api/src/modulos/tiss/cancelamento-documentos-propria.ts.
--   - envio_documento_tiss_item.tipo_documento_tiss: o tipo do documento na terminologia do padrão (01 a 17), que vai
--     na mensagem ENVIO_DOCUMENTO; nulo só nas linhas anteriores a esta coluna;
--   - envio_documento_tiss_item.formato_documento_tiss: o formato do arquivo no padrão (01 JPEG, 02 PDF, 03 PNG,
--     04 TIFF; 05 a 09 com assinatura), derivado do tipo do arquivo na anexação.

ALTER TABLE envio_documento_tiss_item
  ADD COLUMN IF NOT EXISTS tipo_documento_tiss CHAR(2) NULL COMMENT 'Tipo do documento no padrão TISS (01 a 17)' AFTER tipo_documento_termo_terminologia_id;

ALTER TABLE envio_documento_tiss_item
  ADD COLUMN IF NOT EXISTS formato_documento_tiss CHAR(2) NULL COMMENT 'Formato do arquivo no padrão TISS (01 a 09)' AFTER tipo_documento_tiss;

ALTER TABLE envio_documento_tiss_item
  ADD CONSTRAINT IF NOT EXISTS ck_envio_documento_tiss_item_tipo_tiss CHECK (tipo_documento_tiss IS NULL OR tipo_documento_tiss IN ('01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17'));

ALTER TABLE envio_documento_tiss_item
  ADD CONSTRAINT IF NOT EXISTS ck_envio_documento_tiss_item_formato_tiss CHECK (formato_documento_tiss IS NULL OR formato_documento_tiss IN ('01','02','03','04','05','06','07','08','09'));
