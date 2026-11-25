-- Financeiro, chaves do recebimento pelo encontro de contas (07-FIN linha 69): só para frente e idempotente.
ALTER TABLE encontro_contas_item ADD CONSTRAINT fk_encontro_contas_item_recebimento_id FOREIGN KEY IF NOT EXISTS (recebimento_id) REFERENCES recebimento (id) ON DELETE RESTRICT;
ALTER TABLE encontro_contas ADD CONSTRAINT fk_encontro_contas_fonte_pagadora_id FOREIGN KEY IF NOT EXISTS (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT;
