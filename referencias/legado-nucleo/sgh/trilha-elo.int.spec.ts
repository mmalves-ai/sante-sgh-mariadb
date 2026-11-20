// Elo da SGH_TRILHA com espera curta (18/11/2026), sobre a cópia descartável e em transações DESFEITAS: uma transação
// inclui o elo e fica aberta (como a captura de assinatura ou o teste longo de um agente na mesma cópia); a gravação
// concorrente desiste no teto (FB_TRILHA_ELO_TETO_MS, 3 s no dev) com o 503 "trilha-indisponivel", sem gravar elo;
// liberado o elo, a próxima grava uma vez, encadeada. Os ~25 s de antes da correção (5 tentativas x LOCK TIMEOUT de
// 5 s) são CÁLCULO, não medição: o código anterior não roda aqui (revisão 18/11/2026, achado 8).
// Segundo bloco (revisão, achados 2, 4 e 7): o caminho principal no isolamento da API (READ COMMITTED, como o
// executor), com COMMIT: o elo é liberado DURANTE a espera de B, B é cancelado, refaz na mesma transação, grava uma
// vez encadeado e confirma. Dados sintéticos; o único dado que fica na cópia é o elo sintético de A na variante em
// que A confirma (a trilha é só de inclusão: não se apaga elo); o de B é desfeito por ponto de salvamento antes do
// COMMIT. Rodar: obra-sgh/travas/com-copia.sh env SGH_DEV_PERMITIR_SYSDBA=sim ./pnpm exec vitest run --config
// packages/legado/vitest.integracao.config.ts trilha-elo
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codigos, contexto, criarNucleoIntegracao, env, estabelecimentos } from '../integracao.spec-util.js';
import type { NucleoLegado } from '../legado.js';
import { TETO_ELO_TRILHA_DEV_MS } from '../configuracao.js';
import { criarDriverNativo } from '../driver-nativo.js';
import { PoolsDaRede } from '../pool.js';
import { ErroEsperaCurta, escreverReservado, type Escritor } from '../transacao.js';
import { gravarIdempotencia, gravarTrilha, type LinhaTrilha } from './tecnicas.js';

const cod = codigos[0]!;

function linha(rede: string, correlacao: string): LinhaTrilha {
  return {
    rede,
    hospital: cod,
    usuario: 'USUARIO.TESTE',
    evento: 'teste.trilha-elo',
    recurso: 'teste.recurso',
    operacao: 'teste.operar',
    tabelaAlvo: 'TABELA_X',
    idAlvo: '1',
    chaveNaturalAlvo: null,
    resultado: 'sucesso',
    estacao: null,
    correlacao,
  };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe(`elo da trilha preso por transação longa — estabelecimento ${cod}`, () => {
  let nucleo: NucleoLegado;
  beforeAll(() => {
    nucleo = criarNucleoIntegracao();
  });
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('desiste no teto com 503, sem duplicar elo; liberado, grava uma vez encadeado', async () => {
    const ctx = contexto(cod, nucleo.rede);
    let incluiu!: () => void;
    const elo = new Promise<void>((r) => (incluiu = r));
    // A: inclui o elo e segura a transação aberta por 9 s (depois desfaz).
    const segurando = nucleo.desfazendoNaCopia(ctx, async (e) => {
      await gravarTrilha(e, linha(nucleo.rede, 'trilha-elo-A'));
      incluiu();
      await esperar(9_000);
    });
    await elo;

    // B: a gravação com espera curta desiste no teto.
    const t0 = performance.now();
    const erroB = await nucleo
      .desfazendoNaCopia(ctx, (e) =>
        // Teto do dev (3 s) explícito: o padrão de produção é 25 s (revisão 18/11/2026).
        gravarTrilha(
          { ...e, esperaCurta: { ...e.esperaCurta!, tetoMs: TETO_ELO_TRILHA_DEV_MS } },
          linha(nucleo.rede, 'trilha-elo-B'),
        ),
      )
      .catch((x: unknown) => x);
    const msB = performance.now() - t0;
    expect(erroB).toMatchObject({ problema: { status: 503, codigo: 'trilha-indisponivel' } });
    expect(msB).toBeLessThan(4_000);

    // Escritor sem espera curta (dublês): cai no LOCK TIMEOUT inteiro da inclusão, limitado pelo teto do dev. NÃO é o
    // código anterior à correção (que refazia até 5 vezes, ~25 s por cálculo): só mostra o custo de um LOCK TIMEOUT.
    const t1 = performance.now();
    const erroAntigo = await nucleo
      .desfazendoNaCopia(ctx, (e) => {
        const semEspera = { ...e };
        delete semEspera.esperaCurta;
        return gravarTrilha(semEspera, linha(nucleo.rede, 'trilha-elo-antigo'));
      })
      .catch((x: unknown) => x);
    const msAntigo = performance.now() - t1;
    expect(erroAntigo).toMatchObject({ problema: { status: 503 } });
    expect(msAntigo).toBeGreaterThanOrEqual(4_000);

    await segurando;
    // C: elo livre, grava rápido e uma vez só sobre o último elo confirmado.
    const t2 = performance.now();
    const unicos = await nucleo.desfazendoNaCopia(ctx, async (e) => {
      const r = await gravarTrilha(e, linha(nucleo.rede, 'trilha-elo-C'));
      const [minha] = await e.consultar(
        'SELECT HASH_ANTERIOR FROM SGH_TRILHA WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
        [r.id],
      );
      const n = await e.consultar(
        'SELECT COUNT(*) N FROM SGH_TRILHA WHERE HOSPITAL = ? AND HASH_ANTERIOR = ?',
        [cod, minha?.['HASH_ANTERIOR']],
      );
      return Number(n[0]?.['N']);
    });
    const msC = performance.now() - t2;
    expect(unicos).toBe(1);
    expect(msC).toBeLessThan(2_000);
    console.log(
      `[${cod}] elo preso: nova gravação desistiu em ${Math.round(msB)} ms (503); escritor sem espera curta, ` +
        `${Math.round(msAntigo)} ms (um LOCK TIMEOUT, limitado pelo teto); elo livre: gravou em ${Math.round(msC)} ms, 1 elo sobre o anterior`,
    );
  }, 60_000);
});

// Caminho principal no isolamento da API (READ COMMITTED, escreverReservado como o executor), com COMMIT.
describe(`elo liberado durante a espera, READ COMMITTED com COMMIT — estabelecimento ${cod}`, () => {
  const est = estabelecimentos.find((x) => x.codigo === cod)!;
  // Só na cópia descartável do projeto (loopback, 3351/3352, AMBIENTE dev ou ci): a variante "A confirma" deixa um elo
  // sintético na trilha da cópia.
  const naCopia =
    ['dev', 'ci'].includes(String(env['AMBIENTE'] ?? '')) &&
    ['127.0.0.1', 'localhost', '::1'].includes(est.host) &&
    [3351, 3352].includes(est.porta);
  let nucleo: NucleoLegado;
  let pools: PoolsDaRede;
  beforeAll(() => {
    nucleo = criarNucleoIntegracao();
    pools = new PoolsDaRede(nucleo.rede, [est], criarDriverNativo(), nucleo.config, env);
  });
  afterAll(async () => {
    await pools?.encerrar();
    await nucleo?.encerrar();
  });

  const ultimoElo = async () => {
    const [u] = await nucleo.lerSomente(contexto(cod, nucleo.rede), (l) =>
      l.consultar(
        'SELECT FIRST 1 HASH_LINHA FROM SGH_TRILHA WHERE HOSPITAL = ? ORDER BY HOSPITAL DESC, ID DESC',
        [cod],
        {
          teto: 1,
        },
      ),
    );
    return String(u?.['HASH_LINHA'] ?? '').trim();
  };
  const contarCorrelacao = async (correlacao: string) => {
    const [n] = await nucleo.lerSomente(contexto(cod, nucleo.rede), (l) =>
      l.consultar(
        'SELECT COUNT(*) N FROM SGH_TRILHA WHERE HOSPITAL = ? AND CORRELACAO = ?',
        [cod, correlacao],
        {
          teto: 1,
        },
      ),
    );
    return Number(n?.['N']);
  };

  for (const aConfirma of [false, true]) {
    it.runIf(naCopia)(
      `A ${aConfirma ? 'confirma' : 'desfaz'} o elo em ~1,5 s: B é cancelado, refaz na mesma transação, grava uma vez e confirma`,
      async () => {
        const ctx = contexto(cod, nucleo.rede);
        const marca = randomUUID().slice(0, 8);
        const corrA = `trilha-elo-rc-A-${marca}`;
        const corrB = `trilha-elo-rc-B-${marca}`;
        const base = await ultimoElo();

        let incluiu!: () => void;
        const elo = new Promise<void>((r) => (incluiu = r));
        // A (READ COMMITTED, como a API): inclui o elo, segura ~1,5 s e confirma ou desfaz.
        const segurando = escreverReservado(
          pools,
          nucleo.config,
          ctx,
          async (e) => {
            const r = await gravarTrilha(e, linha(nucleo.rede, corrA));
            incluiu();
            await esperar(1_500);
            return r;
          },
          { confirmar: aConfirma },
        );
        await elo;

        // B, iniciado durante a espera: escrita antes da trilha, trilha (cancelada ao menos uma vez), escrita depois.
        // Ponto de salvamento: o que B gravou é desfeito antes do COMMIT, que mesmo assim é real (prova que a
        // transação segue viva e confirma depois do cancelamento); nada de B fica na cópia.
        let cancelamentos = 0;
        const t0 = performance.now();
        const b = await escreverReservado(
          pools,
          nucleo.config,
          ctx,
          async (e: Escritor) => {
            const curta = e.esperaCurta!;
            const contando: Escritor = {
              ...e,
              esperaCurta: {
                ...curta,
                tetoMs: 10_000,
                async executar(sql, p, ms) {
                  try {
                    return await curta.executar(sql, p, ms);
                  } catch (x) {
                    if (x instanceof ErroEsperaCurta) cancelamentos++;
                    throw x;
                  }
                },
              },
            };
            await e.executar('SAVEPOINT SGH_TESTE_ELO');
            await gravarIdempotencia(e, {
              chave: corrB,
              operacao: 'teste.trilha-elo',
              hospital: cod,
              hashEntrada: marca,
              resultado: '{}',
              usuario: 'USUARIO.TESTE',
            });
            const r = await gravarTrilha(contando, linha(nucleo.rede, corrB));
            const ms = performance.now() - t0;
            const depois = await gravarTrilha(e, linha(nucleo.rede, `${corrB}-depois`));
            const [minha] = await e.consultar(
              'SELECT HASH_ANTERIOR FROM SGH_TRILHA WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
              [r.id],
            );
            const [nB] = await e.consultar(
              'SELECT COUNT(*) N FROM SGH_TRILHA WHERE HOSPITAL = ? AND CORRELACAO = ?',
              [cod, corrB],
            );
            const [antes] = await e.consultar(
              'SELECT COUNT(*) N FROM SGH_IDEMPOTENCIA WHERE CHAVE = ? AND OPERACAO = ? AND HOSPITAL = ?',
              [corrB, 'teste.trilha-elo', cod],
            );
            const [seguinte] = await e.consultar(
              'SELECT HASH_ANTERIOR FROM SGH_TRILHA WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
              [depois.id],
            );
            await e.executar('ROLLBACK TO SAVEPOINT SGH_TESTE_ELO');
            return {
              ms,
              hash: r.hash,
              anterior: String(minha?.['HASH_ANTERIOR'] ?? '').trim(),
              linhasB: Number(nB?.['N']),
              escritaAntes: Number(antes?.['N']),
              depoisEncadeado: String(seguinte?.['HASH_ANTERIOR'] ?? '').trim() === r.hash,
            };
          },
          { confirmar: true },
        );
        const a = await segurando;

        expect(cancelamentos).toBeGreaterThanOrEqual(1);
        expect(b.ms).toBeGreaterThanOrEqual(1_000);
        expect(b.ms).toBeLessThan(10_000);
        // Sem lacuna nem elo duplicado: B encadeia sobre o último elo CONFIRMADO (o de A, ou a base se A desfez),
        // o INSERT cancelado não deixou linha (uma só com a correlação de B) e a escrita anterior sobreviveu.
        expect(b.anterior).toBe(aConfirma ? a.hash : base);
        expect(b.linhasB).toBe(1);
        expect(b.escritaAntes).toBe(1);
        expect(b.depoisEncadeado).toBe(true);
        // Depois do COMMIT de B: nada de B ficou; o elo de A só existe se A confirmou; a cadeia termina onde deve.
        expect(await contarCorrelacao(corrB)).toBe(0);
        expect(await contarCorrelacao(corrA)).toBe(aConfirma ? 1 : 0);
        expect(await ultimoElo()).toBe(aConfirma ? a.hash : base);
        // Conexão de volta ao pool limpa: nenhuma em uso, nenhuma espera, e a seguinte transação roda normalmente.
        const [estado] = pools.estados();
        expect(estado).toMatchObject({ emUso: 0, esperando: 0 });
        const [c] = await escreverReservado(
          pools,
          nucleo.config,
          ctx,
          (e) => e.consultar('SELECT 1 X FROM RDB$DATABASE'),
          {
            confirmar: false,
          },
        );
        expect(Number(c?.['X'])).toBe(1);
        console.log(
          `[${cod}] READ COMMITTED, A ${aConfirma ? 'confirmou' : 'desfez'} em ~1,5 s: B cancelado ${cancelamentos}x, ` +
            `gravou em ${Math.round(b.ms)} ms encadeado sobre ${aConfirma ? 'o elo de A' : 'a base'}, 1 linha, ` +
            `escrita anterior preservada, COMMIT ok; pool ${JSON.stringify({ abertas: estado?.abertas, livres: estado?.livres })}`,
        );
      },
      60_000,
    );
  }
});
