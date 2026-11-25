-- Chaves da 95_pagina_inicial (só para frente e idempotente).
ALTER TABLE modelo_pagina_inicial_bloco ADD CONSTRAINT fk_modelo_pagina_inicial_bloco_tipo_bloco_pagina_id FOREIGN KEY IF NOT EXISTS (tipo_bloco_pagina_id) REFERENCES tipo_bloco_pagina (id) ON DELETE RESTRICT;
