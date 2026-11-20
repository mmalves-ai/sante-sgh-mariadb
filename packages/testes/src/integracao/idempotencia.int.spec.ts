// Idempotency-Key sobre a cópia (ficha do M04, regra 8): a mesma chave com a mesma entrada devolve o
// resultado da primeira execução sem gravar de novo; com entrada diferente, recusa. Transação desfeita.
import { ErroOperacao, operacao } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginLivre, usuarioSintetico } from '../massa/sintetica.js';
import {
  type Ambiente,
  contar,
  ctx,
  ctxOperacao,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

const criarUsuario = operacao('acesso.criarUsuarioIntegracao');

describe.skipIf(!PODE_ESCREVER)('idempotência na cópia (transação desfeita)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('repetição devolve o primeiro resultado; entrada diferente com a mesma chave é recusada', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = await loginLivre(e, Date.now() % 1_000_000);
      const c = ctxOperacao(a, 'SGH.TESTE');
      const entrada = usuarioSintetico('usuario-tecnico', login);
      const primeira = await a.executor.executar(criarUsuario, a.cod, entrada, c, { escritor: e });
      const segunda = await a.executor.executar(criarUsuario, a.cod, entrada, c, { escritor: e });
      let codigo = '';
      try {
        await a.executor.executar(criarUsuario, a.cod, usuarioSintetico('variante-nomec', login), c, {
          escritor: e,
        });
      } catch (x) {
        codigo = x instanceof ErroOperacao ? (x.problema.codigo ?? '') : String(x);
      }
      return {
        mesmoResultado: JSON.stringify(primeira.resultado) === JSON.stringify(segunda.resultado),
        repetida: segunda.repetida,
        linhas: await contar(e, 'SELECT COUNT(*) N FROM TBUSERS WHERE NOME = ?', [login]),
        trilhas: await contar(e, 'SELECT COUNT(*) N FROM SGH_TRILHA WHERE CORRELACAO = ? AND OPERACAO = ?', [
          c.traceId,
          'acesso.criarUsuarioIntegracao',
        ]),
        codigo,
      };
    });
    expect(r).toMatchObject({
      mesmoResultado: true,
      repetida: true,
      linhas: 1,
      codigo: 'idempotencia-divergente',
    });
    console.log(`[${a.cod}] idempotência: ${JSON.stringify(r)}`);
  });
});
