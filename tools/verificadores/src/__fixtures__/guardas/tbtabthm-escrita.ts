// guarda-caminho: packages/legado/src/preco/gravacao/reajustar.ts
// Fixture PROIBIDA (M12, regra 4): escrita em TBTABTHM, mesmo dentro de uma receita (o trigger propagaria
// para TBPROCTO; item novo de tabela não é gravado pelo novo).
export const sql = 'UPDATE TBTABTHM SET CH = ? WHERE TAB = ? AND COD = ?';
