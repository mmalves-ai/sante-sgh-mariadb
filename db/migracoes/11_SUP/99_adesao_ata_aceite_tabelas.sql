-- Suprimentos, aceite do fornecedor na adesão à ata de registro de preços (C2-017, 09-AREA linha 81, 26/11/2026): só para
-- frente e idempotente (ADR 0002, parte 2). A adesão do órgão não participante só é autorizada com o aceite prévio do
-- órgão gerenciador (ofício autorizado, já no modelo) e do fornecedor (Lei 14.133, art. 86, § 2º, III); faltava onde
-- guardar o aceite do fornecedor e a data dele. A regra é do domínio (regras-suprimentos/adesao-ata); o banco só guarda.
ALTER TABLE adesao_ata_registro_preco
  ADD COLUMN IF NOT EXISTS aceite_fornecedor BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'O fornecedor aceitou fornecer ao órgão aderente (art. 86, § 2º, III)' AFTER oficio_autorizado,
  ADD COLUMN IF NOT EXISTS aceite_fornecedor_em DATE NULL COMMENT 'Data do aceite do fornecedor' AFTER aceite_fornecedor,
  ADD COLUMN IF NOT EXISTS motivo_decisao VARCHAR(500) NULL COMMENT 'Motivo da negação ou do cancelamento da adesão' AFTER avaliado_em;
