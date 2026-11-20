// Outbox sobre a cópia (ficha do M04, regra 7 e seção 10): legado, SGH_ e outbox na mesma transação —
// transação desfeita não deixa evento; o relay com o Valkey "parado" (publicador que falha) deixa o evento
// pendente, com nova tentativa; quando volta, o evento sai uma vez e não sai de novo. Tudo na transação
// desfeita do teste (o relay usa o mesmo escritor); a publicação real no BullMQ é coberta no worker.
import { chaveDoEvento, cicloRelay, operacao, type PendenteOutbox } from '@sgh/legado';
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

describe.skipIf(!PODE_ESCREVER)('outbox na cópia (transação desfeita)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('o evento nasce na transação do negócio e some com o ROLLBACK; o relay respeita a falha e publica uma vez', async () => {
    let chave = '';
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = await loginLivre(e, Date.now() % 1_000_000);
      const c = ctxOperacao(a, 'SGH.TESTE');
      const s = await a.executor.executar(
        criarUsuario,
        a.cod,
        usuarioSintetico('usuario-tecnico', login),
        c,
        { escritor: e },
      );
      chave = chaveDoEvento(a.cod, 'acesso.criarUsuarioIntegracao', c.idempotencyKey, 0);
      const naTransacao = await contar(e, 'SELECT COUNT(*) N FROM SGH_OUTBOX WHERE CHAVE_EVENTO = ?', [
        chave,
      ]);
      const acesso = {
        ler: <T>(fn: (l: typeof e) => Promise<T>) => fn(e),
        escrever: <T>(fn: (w: typeof e) => Promise<T>) => fn(e),
      };
      const cfg = { lote: 1000, tentativas: 5, esperaInicialS: 0, esperaMaximaS: 0 };
      const publicados: PendenteOutbox[] = [];
      const parado = await cicloRelay(
        acesso,
        a.cod,
        async () => {
          throw new Error('connect ECONNREFUSED 127.0.0.1:1');
        },
        cfg,
      );
      const [pend] = await e.consultar(
        'SELECT SITUACAO, TENTATIVAS FROM SGH_OUTBOX WHERE CHAVE_EVENTO = ?',
        [chave],
        { teto: 1 },
      );
      const voltou = await cicloRelay(
        acesso,
        a.cod,
        async (ev) => {
          publicados.push(ev);
        },
        cfg,
      );
      const deNovo = await cicloRelay(
        acesso,
        a.cod,
        async (ev) => {
          publicados.push(ev);
        },
        cfg,
      );
      const [pub] = await e.consultar('SELECT SITUACAO FROM SGH_OUTBOX WHERE CHAVE_EVENTO = ?', [chave], {
        teto: 1,
      });
      return {
        eventos: s.eventos.length,
        naTransacao,
        parado: {
          falhas: parado.falhas,
          situacao: String(pend?.['SITUACAO']).trim(),
          tentativas: Number(pend?.['TENTATIVAS']),
        },
        publicadosNoRetorno: voltou.publicados,
        publicadosDeNovo: deNovo.publicados,
        vezesDoEvento: publicados.filter((p) => p.chave === chave).length,
        cargaSoComIds: publicados.every((p) =>
          Object.values(p.carga).every((v) => typeof v === 'number' || /^[a-z0-9-]+$/.test(String(v))),
        ),
        situacaoFinal: String(pub?.['SITUACAO']).trim(),
      };
    });
    expect(r).toMatchObject({
      eventos: 1,
      naTransacao: 1,
      parado: { falhas: 1, situacao: 'pendente', tentativas: 1 },
      publicadosDeNovo: 0,
      vezesDoEvento: 1,
      cargaSoComIds: true,
      situacaoFinal: 'publicado',
    });
    expect(r.publicadosNoRetorno).toBeGreaterThanOrEqual(1);
    const depois = await a.nucleo.lerSomente(ctx(a), (l) =>
      contar(l, 'SELECT COUNT(*) N FROM SGH_OUTBOX WHERE CHAVE_EVENTO = ?', [chave]),
    );
    expect(depois).toBe(0);
    console.log(`[${a.cod}] outbox: ${JSON.stringify(r)}; depois do ROLLBACK ${depois} evento`);
  });
});
