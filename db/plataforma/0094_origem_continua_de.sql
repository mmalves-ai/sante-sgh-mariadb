-- Plataforma 0094 (2026-11-24): continuidade declarada entre duas origens do mesmo cliente (ADR 0010).
-- Quando a origem muda de forma, mas a base é a mesma (ex.: a cópia do arquivo passa a ser servida pelo servidor
-- Firebird do hospital), o administrador declara em `continua_de_origem_id` qual origem anterior a nova continua.
-- Só com essa declaração a continuação de uma importação aproveita as marcas de tabela concluída das execuções da
-- origem anterior (conector/continuar.py). Havendo prova (identidade da base, versão e página), ela precisa bater;
-- sem prova, vale a declaração, registrada no evento do cliente. Sem a coluna preenchida, nada muda.
-- Sem gatilhos. Idempotente (coluna, índice e chave estrangeira com IF NOT EXISTS).

ALTER TABLE cliente_origem
  ADD COLUMN IF NOT EXISTS continua_de_origem_id BIGINT UNSIGNED NULL
    COMMENT 'Origem anterior do mesmo cliente com a MESMA base, declarada pelo administrador; NULL = sem continuidade'
    AFTER identidade_base,
  ADD INDEX IF NOT EXISTS ix_cliente_origem_continua_de (continua_de_origem_id);

ALTER TABLE cliente_origem
  ADD CONSTRAINT fk_cliente_origem_continua_de FOREIGN KEY IF NOT EXISTS (continua_de_origem_id)
    REFERENCES cliente_origem (id);
