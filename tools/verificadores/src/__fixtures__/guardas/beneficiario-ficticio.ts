// guarda-caminho: packages/legado/src/operadora/repositorios/beneficiarios.ts
// Fixture PROIBIDA (M56, regra 4): leitura dos registros fictícios de beneficiário do módulo de operadora, mesmo
// dentro do adaptador (nunca lidos como beneficiário real nem alterados; Anexo B: descartar).
export const sql = 'SELECT ID, NOME FROM PSBENEFI WHERE EMP = ?';
