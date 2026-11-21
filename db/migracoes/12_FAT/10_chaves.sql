-- FAT, lote 10: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE glosa_item
  ADD CONSTRAINT fk_glosa_item_motivo_retorno_glosa_id FOREIGN KEY (motivo_retorno_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT;
