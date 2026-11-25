-- Fila com o sistema de gestão corporativo (08-INTG L136): só para frente e idempotente (ADR 0002, parte 2).
-- O lote ganha a situação 'enviando': o worker reserva o lote gerado sob trava e versão antes de chamar o adaptador do
-- ERP, para que a tela não o envie nem cancele em paralelo e o mesmo lote não vá duas vezes ao ERP.

ALTER TABLE exportacao_erp
  DROP CONSTRAINT IF EXISTS ck_exportacao_erp_situacao,
  ADD CONSTRAINT ck_exportacao_erp_situacao CHECK (situacao IN ('aberto','gerado','enviando','enviado','processado','processado_com_erro','conciliado','cancelado'));
