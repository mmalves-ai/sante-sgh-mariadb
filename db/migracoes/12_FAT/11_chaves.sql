-- FAT, lote 11: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE diaria_por_plano_local
  ADD CONSTRAINT fk_diaria_por_plano_local_fonte_pagadora_id FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_diaria_por_plano_local_plano_fonte_pagadora_id FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora (id) ON DELETE RESTRICT;
