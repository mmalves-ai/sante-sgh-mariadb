-- Recepção, etapas do pronto atendimento (família sae-atendimento, modulos-proprios-2, 24/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho; as regras ficam na porta.
--   - atendimento_etapa_pa: o quadro do PA registra também a abertura da ficha e a ida a exames (as etapas do
--     vocabulário do produto); a linha é só de acréscimo (cada etapa é um fato com hora e responsável).
ALTER TABLE atendimento_etapa_pa
  DROP CONSTRAINT IF EXISTS ck_atendimento_etapa_pa_etapa,
  ADD CONSTRAINT ck_atendimento_etapa_pa_etapa CHECK (etapa IN ('chegada','abertura','classificacao','chamada',
    'atendimento_medico','exames','reavaliacao','observacao','decisao','saida'));
