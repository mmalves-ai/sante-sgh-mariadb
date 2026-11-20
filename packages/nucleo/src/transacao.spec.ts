import { describe, expect, it } from 'vitest';
import { BancoDuble, CONFIG_TESTE, erroDoBanco } from './duble-banco.spec-util.js';
import { ErroLeitura, ErroTempoEsgotado, ErroTetoLinhas } from './erros.js';
import { conferirSqlLeitura, escreverTransacao, lerSomente } from './transacao.js';

const CTX = { cliente: 'teste_duble', estabelecimento: null, usuario: null, correlacao: 'c-1' };

describe('caminho de leitura', () => {
  it.each([
    'UPDATE a SET b = 1',
    'insert into a values (1)',
    'DELETE FROM a',
    'CALL proc()',
    'SET @x = 1',
    'SELECT * FROM a FOR UPDATE',
    'SELECT * FROM a LOCK IN SHARE MODE',
    'SELECT NEXTVAL(s)',
    'SELECT 1; DROP TABLE a',
    'SELECT a INTO OUTFILE "/tmp/x" FROM b',
    'SELECT SLEEP(10)',
  ])('recusa: %s', (sql) => {
    expect(() => conferirSqlLeitura(sql)).toThrow(ErroLeitura);
  });

  it('aceita SELECT e WITH', () => {
    expect(() => conferirSqlLeitura('SELECT id FROM a WHERE b = ?')).not.toThrow();
    expect(() => conferirSqlLeitura('WITH x AS (SELECT 1) SELECT * FROM x;')).not.toThrow();
  });

  it('lerSomente abre READ ONLY, desfaz e devolve a conexão', async () => {
    const banco = new BancoDuble().quando(/FROM a/, [{ id: 1 }, { id: 2 }]);
    const r = await lerSomente(banco.fonte(), CONFIG_TESTE, CTX, async (l) => ({
      todas: await l.consultar('SELECT id FROM a'),
      uma: await l.uma('SELECT id FROM a'),
    }));
    expect(r).toEqual({ todas: [{ id: 1 }, { id: 2 }], uma: { id: 1 } });
    expect(banco.estados).toEqual(['somente-leitura', 'desfazer', 'devolver']);
  });

  it('teto de linhas e tempo esgotado viram erros próprios', async () => {
    const banco = new BancoDuble().quando(/FROM a/, [{ id: 1 }, { id: 2 }]).quando(/FROM lenta/, () => {
      throw erroDoBanco(
        1969,
        'ER_STATEMENT_TIMEOUT',
        'Query execution was interrupted (max_statement_time exceeded)',
      );
    });
    await expect(
      lerSomente(banco.fonte(), CONFIG_TESTE, CTX, (l) => l.consultar('SELECT id FROM a', [], { teto: 1 })),
    ).rejects.toThrow(ErroTetoLinhas);
    await expect(
      lerSomente(banco.fonte(), CONFIG_TESTE, CTX, (l) => l.consultar('SELECT id FROM lenta')),
    ).rejects.toThrow(ErroTempoEsgotado);
    await expect(
      lerSomente(banco.fonte(), CONFIG_TESTE, CTX, (l) => l.consultar('UPDATE a SET b = 1')),
    ).rejects.toThrow(ErroLeitura);
  });

  it('recusa contexto de outro cliente e contexto inválido', async () => {
    const banco = new BancoDuble();
    await expect(lerSomente(banco.fonte('outro'), CONFIG_TESTE, CTX, async () => 1)).rejects.toThrow(/outro/);
    await expect(
      lerSomente(banco.fonte(), CONFIG_TESTE, { ...CTX, correlacao: '' }, async () => 1),
    ).rejects.toThrow(/correlação/);
    expect(banco.estados).toEqual([]);
  });
});

describe('caminho de escrita', () => {
  it('confirma no sucesso; desfaz quando pedido', async () => {
    const banco = new BancoDuble();
    const id = await escreverTransacao(banco.fonte(), CONFIG_TESTE, CTX, async (e) => {
      const n = await e.executar('UPDATE a SET b = ? WHERE id = ?', [1, 2]);
      expect(n).toBe(1);
      return e.inserir('INSERT INTO a (b) VALUES (?)', [1]);
    });
    expect(id).toBe(100);
    expect(banco.estados).toEqual(['iniciar', 'confirmar', 'devolver']);
    const simulado = new BancoDuble();
    await escreverTransacao(simulado.fonte(), CONFIG_TESTE, CTX, (e) => e.executar('DELETE FROM a'), false);
    expect(simulado.estados).toEqual(['iniciar', 'desfazer', 'devolver']);
  });

  it('desfaz no erro e descarta a conexão que caiu', async () => {
    const banco = new BancoDuble().quando(/^UPDATE/, () => {
      throw erroDoBanco(1205, 'ER_LOCK_WAIT_TIMEOUT', 'Lock wait timeout exceeded');
    });
    await expect(
      escreverTransacao(banco.fonte(), CONFIG_TESTE, CTX, (e) => e.executar('UPDATE a SET b = 1')),
    ).rejects.toThrow();
    expect(banco.estados).toEqual(['iniciar', 'desfazer', 'devolver']);
    const caiu = new BancoDuble().quando(/^UPDATE/, () => {
      throw Object.assign(new Error('socket'), { code: 'ER_SOCKET_UNEXPECTED_CLOSE', fatal: true });
    });
    await expect(
      escreverTransacao(caiu.fonte(), CONFIG_TESTE, CTX, (e) => e.executar('UPDATE a SET b = 1')),
    ).rejects.toThrow();
    expect(caiu.estados.at(-1)).toBe('descartar');
  });

  it('consultarParaAtualizar acrescenta FOR UPDATE; RETURNING e inserir são conferidos', async () => {
    const banco = new BancoDuble().quando(/RETURNING/, [{ id: 7 }]);
    await escreverTransacao(banco.fonte(), CONFIG_TESTE, CTX, async (e) => {
      await e.consultarParaAtualizar('SELECT id FROM a WHERE id = ?', [1]);
      expect(await e.executarRetornando('INSERT INTO a (b) VALUES (1) RETURNING id')).toEqual({ id: 7 });
      await expect(e.executarRetornando('INSERT INTO a (b) VALUES (1)')).rejects.toThrow(/RETURNING/);
      await expect(e.inserir('UPDATE a SET b = 1')).rejects.toThrow(/INSERT/);
    });
    expect(banco.comandos[0]?.sql).toBe('SELECT id FROM a WHERE id = ? FOR UPDATE');
  });
});
