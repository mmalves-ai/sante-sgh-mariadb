-- Faixa de horário especial só para o atendimento de urgência ou emergência (06-FAT linha 17, F3.7, 25/11/2026): só
-- para frente e idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio (@sgh/dominio-faturamento,
-- conta/ajustes.ts: faixaDoHorario) e na operação (apps/api/src/modulos/faturamento/conta-ajustes-propria.ts).
--   - acrescimo_horario_especial.exige_urgencia: a faixa só vale quando o caráter do atendimento da conta é de
--     urgência ou emergência (carater_atendimento_tiss.urgencia). Falso (o padrão): vale em qualquer caráter, como até
--     aqui, então as faixas já gravadas não mudam.

ALTER TABLE acrescimo_horario_especial
  ADD COLUMN IF NOT EXISTS exige_urgencia BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Só vale no atendimento de caráter urgência ou emergência' AFTER aplica_procedimentos_vinculados;
