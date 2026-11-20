// guarda-caminho: packages/legado/src/cadastro/gravacao/numerar.ts
// Fixture PROIBIDA (regra f): ID por MAX(ID)+1 (os IDs vêm dos generators do legado).
export const sql = 'SELECT MAX(ID) + 1 N FROM RICADPAC';
