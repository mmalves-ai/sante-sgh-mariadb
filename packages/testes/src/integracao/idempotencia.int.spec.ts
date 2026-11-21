// Chave de idempotência sobre o MariaDB real (cliente f22_o5), em transação desfeita: a mesma chave com a mesma
// entrada devolve o resultado da primeira execução sem gravar de novo (a mesma trilha); com entrada diferente, recusa;
// a mesma chave usada por OUTRO usuário também é recusada (não devolve os ids de quem gravou).
// Melhoria: a recusa por outro usuário é nova (a versão antiga só comparava a entrada).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Ambiente,
  CLIENTE,
  codigoDe,
  codigoSintetico,
  contar,
  ctxOperacao,
  desfeito,
  incluirEstabelecimento,
  MARCA,
  prepararAmbiente,
  SEM_BANCO,
} from './escrita.spec-util.js';

describe.skipIf(SEM_BANCO)('idempotência no MariaDB (cliente f22_o5, transação desfeita)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('repetição devolve o primeiro resultado; entrada diferente ou outro usuário com a mesma chave é recusado', async () => {
    const r = await desfeito(a, async (e) => {
      const codigo = codigoSintetico();
      const login = `sint.idem.${Date.now().toString(36)}`;
      const outroUsuario = await e.inserir(
        `INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'integracao', NOW(3))`,
        [login, `USUARIO ${MARCA}`],
      );
      const c = ctxOperacao(a);
      const entrada = { codigo, nome: `Hospital ${MARCA}` };
      const primeira = await a.executor.executar(incluirEstabelecimento, CLIENTE, entrada, c, {
        escritor: e,
      });
      const segunda = await a.executor.executar(incluirEstabelecimento, CLIENTE, entrada, c, { escritor: e });
      let divergente = '';
      try {
        await a.executor.executar(
          incluirEstabelecimento,
          CLIENTE,
          { ...entrada, nome: `Outro ${MARCA}` },
          c,
          {
            escritor: e,
          },
        );
      } catch (x) {
        divergente = codigoDe(x);
      }
      let deOutro = '';
      try {
        await a.executor.executar(
          incluirEstabelecimento,
          CLIENTE,
          entrada,
          { ...c, usuario: outroUsuario },
          {
            escritor: e,
          },
        );
      } catch (x) {
        deOutro = codigoDe(x);
      }
      return {
        mesmoResultado: JSON.stringify(primeira.resultado) === JSON.stringify(segunda.resultado),
        repetida: segunda.repetida,
        mesmaTrilha: segunda.trilha === primeira.trilha,
        semNovoEvento: segunda.eventos.length,
        linhas: await contar(e, 'SELECT COUNT(*) AS n FROM estabelecimento WHERE codigo = ?', [codigo]),
        registros: await contar(e, 'SELECT COUNT(*) AS n FROM idempotencia_operacao WHERE chave = ?', [
          c.chaveIdempotencia,
        ]),
        divergente,
        deOutro,
      };
    });
    expect(r).toEqual({
      mesmoResultado: true,
      repetida: true,
      mesmaTrilha: true,
      semNovoEvento: 0,
      linhas: 1,
      registros: 1,
      divergente: 'idempotencia-divergente',
      deOutro: 'idempotencia-divergente',
    });
  });
});
