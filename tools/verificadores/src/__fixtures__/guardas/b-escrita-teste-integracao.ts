// guarda-caminho: packages/testes/src/integracao/novo.int.spec.ts
// Fixture PROIBIDA (regra b): teste de integração executa o SQL na cópia; escrita fora do executor só com exceção nominal.
export const sql = 'UPDATE TBGERSEQ SET SEQ = SEQ + 1 WHERE TIPO = 1';
