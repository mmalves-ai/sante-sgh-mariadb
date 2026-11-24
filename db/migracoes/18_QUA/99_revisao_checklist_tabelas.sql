-- Qualidade, revisão de prontuários no banco próprio (modulos-proprios-3, família qualidade-q3, 24/11/2026): só para
-- frente e idempotente (ADR 0002, parte 2).
-- O item do checklist da qualidade ganha o código estável do item (ex.: 'assinatura'). A resposta da revisão e a
-- pendência gerada ao profissional apontam o item pelo código, que não muda entre as versões publicadas (o enunciado
-- pode mudar). Opcional: os checklists de outras finalidades e os já carregados podem não ter código; dentro da mesma
-- versão o código é único.
ALTER TABLE modelo_checklist_qualidade_item
  ADD COLUMN IF NOT EXISTS codigo VARCHAR(40) NULL COMMENT 'Código estável do item entre as versões do checklist'
  AFTER sequencia;
ALTER TABLE modelo_checklist_qualidade_item
  ADD UNIQUE KEY IF NOT EXISTS uq_modelo_checklist_qualidade_item_versao_codigo (modelo_checklist_qualidade_versao_id, codigo);
