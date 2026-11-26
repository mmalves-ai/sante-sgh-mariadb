-- CME, material de terceiro e consignado (F7, 04-CME linha 119, 26/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2). Sem gatilho; as regras ficam no domínio (@sgh/dominio-cirurgia, cme/material-terceiro). O item do
-- recebimento passa a apontar o pacote estéril gerado no envio ao reprocessamento: a rastreabilidade do material de
-- terceiro (recebimento → pacote → ciclo → uso no paciente → devolução) sai por chave, nunca por data ou texto.
ALTER TABLE recebimento_material_terceiro_item
  ADD COLUMN IF NOT EXISTS pacote_esteril_id BIGINT UNSIGNED NULL COMMENT 'Pacote gerado no envio ao reprocessamento' AFTER agendamento_cirurgico_procedimento_id;

ALTER TABLE recebimento_material_terceiro_item
  ADD UNIQUE INDEX IF NOT EXISTS uq_recebimento_material_terceiro_item_pacote_esteril (pacote_esteril_id);
