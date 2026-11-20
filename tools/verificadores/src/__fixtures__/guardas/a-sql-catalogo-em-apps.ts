// guarda-caminho: apps/api/src/modulos/config/gravacao.ts
// Fixture PROIBIDA (regra a): SQL de catálogo (RDB$) em apps/*; só @sgh/legado conhece o banco.
export const sql = 'SELECT TRIM(RDB$TRIGGER_NAME) N FROM RDB$TRIGGERS';
