import { describe, expect, it } from 'vitest';
import { BIBLIOTECA_CLIENTE_PADRAO, conferirSqlAscii, sqlCompativelComFirebird5 } from './driver.js';

describe('driver: regras comuns', () => {
  it('SQL só em ASCII (acento vai por parâmetro)', () => {
    expect(() => conferirSqlAscii('SELECT 1 FROM RDB$DATABASE')).not.toThrow();
    expect(() => conferirSqlAscii("SELECT 1 FROM TBUF WHERE NOME = 'São Paulo'")).toThrow(/parâmetro/);
  });
  it('biblioteca cliente padrão é a do sistema (TEC-1)', () => {
    expect(BIBLIOTECA_CLIENTE_PADRAO).toBe('/lib/x86_64-linux-gnu/libfbclient.so.2');
  });
});

describe('M58.2: identificador reservado no Firebird 5 (LOCAL) vai entre aspas', () => {
  const q = sqlCompativelComFirebird5;
  it('coluna solta, com apelido e em minúsculas', () => {
    expect(q('SELECT QTDE FROM GEARMLOC WHERE ANO = ? AND LOCAL = ?')).toBe(
      'SELECT QTDE FROM GEARMLOC WHERE ANO = ? AND "LOCAL" = ?',
    );
    expect(
      q('SELECT a.LOCAL, g.NOME FROM GEARMLOC a JOIN GELOCARM g ON g.COD = a.LOCAL ORDER BY a.LOCAL'),
    ).toBe(
      'SELECT a."LOCAL", g.NOME FROM GEARMLOC a JOIN GELOCARM g ON g.COD = a."LOCAL" ORDER BY a."LOCAL"',
    );
    expect(q('insert into CCLANCIR (SEQ, local) values (?, ?)')).toBe(
      'insert into CCLANCIR (SEQ, "LOCAL") values (?, ?)',
    );
  });
  it('não mexe em literal, aspas, comentário, palavra maior nem no uso como palavra-chave', () => {
    const intactos = [
      "SELECT 'LOCAL' X FROM RDB$DATABASE",
      'SELECT "LOCAL" FROM GEARMLOC',
      'SELECT LOCALTIMESTAMP, LOCALTIME FROM RDB$DATABASE',
      'SELECT LOCAL_ID, ID_LOCAL, LOCAL$X FROM T',
      'SELECT 1 FROM T -- LOCAL\n',
      'SELECT /* LOCAL */ 1 FROM T',
      'SELECT CURRENT_TIMESTAMP AT LOCAL FROM RDB$DATABASE',
      'SET TIME ZONE LOCAL',
      "SELECT 'it''s LOCAL' FROM T",
    ];
    for (const s of intactos) expect(q(s)).toBe(s);
  });
  it('idempotente e sem custo no SQL sem a palavra', () => {
    const uma = q('UPDATE GEARMLOC SET QTDE = ? WHERE LOCAL = ?');
    expect(q(uma)).toBe(uma);
    const sem = 'SELECT 1 FROM RDB$DATABASE';
    expect(q(sem)).toBe(sem);
  });
});
