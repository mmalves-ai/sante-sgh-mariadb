-- Qualidade, auditoria interna gravada no banco próprio (F3.9-Q2, 24/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2).
-- O contrato da auditoria aceita título de até 200 caracteres e o checklist com a seção de cada item (agrupamento do
-- manual, área ou processo). O modelo guardava o título em 150 e não tinha onde guardar a seção: a auditoria com título
-- longo recusaria no banco e a seção se perderia na gravação. O título passa a 200 (só alarga; nada é cortado) e o item
-- ganha a seção, opcional.
ALTER TABLE auditoria_interna
  MODIFY COLUMN titulo VARCHAR(200) NOT NULL;
ALTER TABLE auditoria_interna_item
  ADD COLUMN IF NOT EXISTS secao VARCHAR(80) NULL COMMENT 'Seção do checklist (agrupamento do item)' AFTER pergunta;
