-- Acréscimo de horário especial em coluna própria no item da conta (06-FAT linha 17, F3.7, 24/11/2026): só para frente
-- e idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio (@sgh/dominio-faturamento, conta/ajustes.ts)
-- e na operação (apps/api/src/modulos/faturamento/conta-ajustes-propria.ts).
--   - conta_hospitalar_item.valor_acrescimo_horario: a parte de valor_acrescimo que veio da faixa de horário especial.
--     Reaplicar o horário troca só essa parte; o acréscimo manual ou importado do item (o resto) fica como está.
--   - Itens já marcados com a faixa (gravados antes desta coluna) tinham em valor_acrescimo só o acréscimo de horário:
--     a parte de horário passa a ser esse valor (só onde a coluna ainda está zerada).

ALTER TABLE conta_hospitalar_item
  ADD COLUMN IF NOT EXISTS valor_acrescimo_horario DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT 'Parte do acréscimo que vem da faixa de horário especial' AFTER valor_acrescimo;

ALTER TABLE conta_hospitalar_item
  ADD CONSTRAINT IF NOT EXISTS ck_conta_hospitalar_item_acrescimo_horario CHECK (valor_acrescimo_horario >= 0);

UPDATE conta_hospitalar_item
   SET valor_acrescimo_horario = valor_acrescimo
 WHERE acrescimo_horario_especial_id IS NOT NULL AND valor_acrescimo_horario = 0 AND valor_acrescimo > 0;
