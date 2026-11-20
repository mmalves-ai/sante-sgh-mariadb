// guarda-caminho: packages/legado/src/catalogo/gravacao/importarCep.ts
// Fixture PROIBIDA (M13, ficha seção 10): DELETE em tabela de catálogo, mesmo dentro de uma receita (o item que
// sai da fonte oficial fica "removido na fonte" na comparação; nada é excluído).
export const sql = 'DELETE FROM TBCEP WHERE CEP = ?';
