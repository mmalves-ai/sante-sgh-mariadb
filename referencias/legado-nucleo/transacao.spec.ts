// Regra 5 (unitário): leitura em READ ONLY, teto de linhas, cancelamento ao estourar o tempo e conexão
// de volta ao pool. A prova sobre o banco está em transacao.int.spec.ts.
import { describe, expect, it } from 'vitest';
import { CONFIGURACAO_PADRAO } from './configuracao.js';
import {
  ambienteFicticio,
  criarDubleDriver,
  type ModoCancelamentoDuble,
  type Responder,
} from './duble-driver.spec-util.js';
import { lerEstabelecimentos } from './estabelecimentos.js';
import { PoolsDaRede } from './pool.js';
import {
  ErroCancelamentoPendente,
  ErroEsperaCurta,
  ErroLeitura,
  ErroTempoEsgotado,
  ErroTetoLinhas,
  escreverReservado,
  lerSomente,
} from './transacao.js';

const ctx = { rede: 'rede-teste', hospital: 'pc', traceId: 't' };

function montar(responder: Responder, cancelamento?: ModoCancelamentoDuble) {
  const env = ambienteFicticio(['pc', 'hs']);
  const driver = criarDubleDriver(responder, cancelamento ? { cancelamento } : {});
  const config = { ...CONFIGURACAO_PADRAO, tempoConsultaMs: 50, tetoLinhas: 3 };
  return {
    driver,
    config,
    pools: new PoolsDaRede('rede-teste', lerEstabelecimentos(env), driver, config, env),
  };
}

describe('lerSomente', () => {
  it('abre transação de leitura e devolve a conexão ao pool', async () => {
    const { pools, config, driver } = montar(() => [{ N: 1 }]);
    const r = await lerSomente(pools, config, ctx, (l) => l.consultar('SELECT 1 N FROM RDB$DATABASE'));
    expect(r).toEqual([{ N: 1 }]);
    // A 1ª transação é a marca da conexão nova (RDB$SET_CONTEXT, coletor MON$ do M09).
    expect(driver.modos).toEqual([{ tipo: 'leitura' }, { tipo: 'leitura' }]);
    expect(pools.para('pc').estado()).toMatchObject({ livres: 1, emUso: 0 });
  });

  it('passar do teto de linhas é erro (pagine no servidor)', async () => {
    const { pools, config } = montar(() => [{}, {}, {}, {}]);
    await expect(lerSomente(pools, config, ctx, (l) => l.consultar('SELECT X FROM T'))).rejects.toThrow(
      ErroTetoLinhas,
    );
    const ok = await lerSomente(pools, config, ctx, (l) => l.consultar('SELECT X FROM T', [], { teto: 10 }));
    expect(ok).toHaveLength(4);
  });

  it('consulta acima do tempo é cancelada pelo driver e a conexão volta ao pool', async () => {
    const { pools, config, driver } = montar((sql) =>
      sql.includes('LENTA') ? new Promise(() => undefined) : [{ OK: 1 }],
    );
    await expect(lerSomente(pools, config, ctx, (l) => l.consultar('SELECT LENTA FROM T'))).rejects.toThrow(
      ErroTempoEsgotado,
    );
    expect(driver.conexoes[0]?.cancelamentos).toBe(1);
    expect(pools.para('pc').estado()).toMatchObject({ livres: 1, emUso: 0 });
    const r = await lerSomente(pools, config, ctx, (l) => l.consultar('SELECT 1 FROM T'));
    expect(r).toEqual([{ OK: 1 }]);
    expect(driver.conexoes).toHaveLength(1);
  });

  it('pedido de cancelamento que chega depois do fim da consulta: a conexão é descartada', async () => {
    const { pools, config, driver } = montar((sql) =>
      sql.includes('TARDIA') ? new Promise((r) => setTimeout(() => r([{ OK: 1 }]), 120)) : [{ OK: 1 }],
    );
    await lerSomente(pools, config, ctx, (l) => l.consultar('SELECT 1 FROM T'));
    const primeira = driver.conexoes[0];
    if (!primeira) throw new Error('sem conexão');
    // O servidor recebe o pedido mas a consulta já está terminando: nada é rejeitado agora.
    primeira.cancelar = async () => {
      primeira.cancelamentos++;
    };
    const r = await lerSomente(pools, config, ctx, (l) => l.consultar('SELECT TARDIA FROM T'));
    expect(r).toEqual([{ OK: 1 }]);
    expect(primeira.cancelamentos).toBe(1);
    expect(primeira.fechada).toBe(true); // não volta ao pool com o pedido pendente
    await lerSomente(pools, config, ctx, (l) => l.consultar('SELECT 1 FROM T'));
    expect(driver.conexoes).toHaveLength(2);
  });

  it('caminho de leitura recusa generator, procedimento e bloco PSQL', async () => {
    const { pools, config } = montar(() => [{ OK: 1 }]);
    for (const sql of [
      'SELECT GEN_ID(GEN_IDRICADPAC, 1) FROM RDB$DATABASE',
      'SELECT gen_id( G ,-1) FROM RDB$DATABASE',
      'SELECT NEXT VALUE FOR G FROM RDB$DATABASE',
      'EXECUTE PROCEDURE P',
      'EXECUTE BLOCK AS BEGIN END',
    ]) {
      await expect(lerSomente(pools, config, ctx, (l) => l.consultar(sql))).rejects.toThrow(
        /Leitura recusada/,
      );
    }
    // Ler o valor atual (passo 0) é leitura; o bloco só com a exceção explícita (prova do 409).
    await expect(
      lerSomente(pools, config, ctx, (l) => l.consultar('SELECT GEN_ID(G, 0) FROM RDB$DATABASE')),
    ).resolves.toHaveLength(1);
    await expect(
      lerSomente(pools, config, ctx, (l) =>
        l.consultar('EXECUTE BLOCK RETURNS (X INTEGER) AS BEGIN SUSPEND; END', [], { permitirBloco: true }),
      ),
    ).resolves.toHaveLength(1);
    await expect(
      lerSomente(pools, config, ctx, (l) => l.consultar('EXECUTE PROCEDURE P', [], { permitirBloco: true })),
    ).rejects.toThrow(/EXECUTE PROCEDURE/);
  });

  it('erro de cancelamento sem estouro de tempo também vira tempo esgotado', async () => {
    const { pools, config } = montar(() => {
      throw new Error('operation was cancelled');
    });
    await expect(lerSomente(pools, config, ctx, (l) => l.consultar('SELECT 1 FROM T'))).rejects.toThrow(
      ErroTempoEsgotado,
    );
  });

  it('outros erros sobem como vieram', async () => {
    const { pools, config } = montar(() => {
      throw new Error('Dynamic SQL Error');
    });
    await expect(lerSomente(pools, config, ctx, (l) => l.consultar('SELECT 1 FROM T'))).rejects.toThrow(
      /Dynamic SQL/,
    );
  });

  it('contexto de outra rede ou sem rede é recusado', async () => {
    const { pools, config } = montar(() => []);
    await expect(lerSomente(pools, config, { ...ctx, rede: 'outra-rede' }, async () => 1)).rejects.toThrow(
      ErroLeitura,
    );
    await expect(lerSomente(pools, config, { ...ctx, rede: '' }, async () => 1)).rejects.toThrow(/rede/);
  });

  it('a sessão hs nunca recebe conexão do pc', async () => {
    const { pools, config, driver } = montar(() => [{ OK: 1 }]);
    await lerSomente(pools, config, ctx, (l) => l.consultar('SELECT 1 FROM T'));
    await lerSomente(pools, config, { ...ctx, hospital: 'hs' }, async (l) => {
      expect(l.hospital).toBe('hs');
      return l.consultar('SELECT 1 FROM T');
    });
    expect(driver.conexoes.map((c) => c.destino.banco)).toEqual([
      '/var/lib/firebird/data/pc.fdb',
      '/var/lib/firebird/data/hs.fdb',
    ]);
  });

  it('conexão quebrada durante a leitura é descartada', async () => {
    const { pools, config, driver } = montar(() => [{ OK: 1 }]);
    await lerSomente(pools, config, ctx, async (l) => {
      await l.consultar('SELECT 1 FROM T');
      driver.conexoes[0]?.quebrar();
    });
    expect(pools.para('pc').estado().abertas).toBe(0);
  });

  it('M59-F1: a consulta com o módulo usa a conta e o papel do módulo configurado; sem conta, a conta única', async () => {
    const env = ambienteFicticio(['pc'], {
      FB_PC_MOD_CADASTRO_PACIENTE_USUARIO: 'SGH_APP_CADASTRO_PACIENTE',
      FB_PC_MOD_CADASTRO_PACIENTE_SENHA: '<senha-ficticia>',
    });
    const driver = criarDubleDriver(() => [{ OK: 1 }]);
    const config = { ...CONFIGURACAO_PADRAO, tempoConsultaMs: 50, tetoLinhas: 3 };
    const pools = new PoolsDaRede('rede-teste', lerEstabelecimentos(env), driver, config, env);
    await lerSomente(pools, config, { ...ctx, modulo: 'cadastro-paciente' }, (l) =>
      l.consultar('SELECT 1 FROM T'),
    );
    await lerSomente(pools, config, { ...ctx, modulo: 'pep' }, (l) => l.consultar('SELECT 1 FROM T'));
    await lerSomente(pools, config, ctx, (l) => l.consultar('SELECT 1 FROM T'));
    expect(driver.conexoes.map((c) => [c.destino.usuario, c.destino.papel])).toEqual([
      ['SGH_APP_CADASTRO_PACIENTE', 'SGH_MOD_CADASTRO_PACIENTE'],
      [expect.not.stringMatching(/^SGH_APP_/), 'SGH_APLICACAO'],
    ]);
  });

  it('lê BLOB pelo leitor', async () => {
    const { pools, config } = montar(() => []);
    const b = await lerSomente(pools, config, ctx, (l) => l.lerBlob('abc'));
    expect(b.toString('latin1')).toBe('abc');
  });
});

describe('escreverReservado (M04)', () => {
  it('abre transação de escrita com o LOCK TIMEOUT configurado e desfaz quando não confirma', async () => {
    const { pools, config, driver } = montar(() => []);
    const n = await escreverReservado(
      pools,
      config,
      ctx,
      (e) => e.executar('UPDATE T SET A = A WHERE 1 = 0'),
      {
        confirmar: false,
      },
    );
    expect(n).toBe(1);
    expect(driver.modos).toEqual([
      { tipo: 'leitura' }, // marca da conexão nova (M09)
      { tipo: 'escrita', lockTimeoutSegundos: config.lockTimeoutSegundos },
    ]);
    expect(pools.para('pc').estado().livres).toBe(1);
  });

  it('confirma quando pedido e recusa contexto de outra rede', async () => {
    const { pools, config } = montar(() => []);
    await expect(escreverReservado(pools, config, ctx, async () => 'ok', { confirmar: true })).resolves.toBe(
      'ok',
    );
    await expect(
      escreverReservado(pools, config, { ...ctx, rede: 'outra-rede' }, async () => 'x', { confirmar: false }),
    ).rejects.toThrow(/outra rede/);
  });
});

describe('espera curta do elo da trilha (18/11/2026)', () => {
  it('trava presa além da espera: cancela só o comando, ErroEsperaCurta, conexão descartada ao fim', async () => {
    const { pools, config, driver } = montar((sql) =>
      sql.includes('PRESO') ? new Promise(() => undefined) : [],
    );
    const t0 = Date.now();
    const erro = await escreverReservado(
      pools,
      config,
      ctx,
      async (e) => {
        expect(e.esperaCurta).toMatchObject({
          esperaMs: config.esperaEloTrilhaMs,
          tetoMs: config.tetoEloTrilhaMs,
        });
        return e.esperaCurta?.executar('INSERT INTO SGH_TRILHA (PRESO) VALUES (1)', [], 80);
      },
      { confirmar: false },
    ).catch((x: unknown) => x);
    expect(erro).toBeInstanceOf(ErroEsperaCurta);
    expect(Date.now() - t0).toBeLessThan(1_000); // nunca o LOCK TIMEOUT de 5 s
    expect(driver.conexoes[0]?.cancelamentos).toBe(1);
    expect(pools.para('pc').estado()).toMatchObject({ emUso: 0 });
  });

  it('trava livre: o comando passa sem cancelamento e a conexão volta ao pool', async () => {
    const { pools, config, driver } = montar(() => []);
    const n = await escreverReservado(
      pools,
      config,
      ctx,
      async (e) => e.esperaCurta?.executar('INSERT INTO SGH_TRILHA (A) VALUES (1)', [], 500),
      { confirmar: true },
    );
    expect(n).toBe(1);
    expect(driver.conexoes[0]?.cancelamentos).toBe(0);
    expect(pools.para('pc').estado()).toMatchObject({ livres: 1, emUso: 0 });
  });
});

describe('cancelamento da espera curta na mesma janela da resposta (revisão 18/11/2026)', () => {
  // O servidor responde ao INSERT em 60 ms; o temporizador da espera (20 ms) já disparou: o pedido de cancelamento
  // não derruba o INSERT respondido e fica armado no anexo ('pendente') ou some ('perdido').
  const respondeDepois =
    (falha?: string): Responder =>
    (sql) =>
      sql.startsWith('INSERT INTO SGH_TRILHA')
        ? new Promise((ok, erro) => setTimeout(() => (falha ? erro(new Error(falha)) : ok([])), 60))
        : [];
  const UNICA = 'violation of PRIMARY or UNIQUE KEY constraint "SGH_UQ_TRILHA_ELO" on table "SGH_TRILHA"';

  it('sucesso junto do cancelamento: o pedido é consumido antes de seguir; outbox e COMMIT passam; conexão limpa', async () => {
    const { pools, config, driver } = montar(respondeDepois(), 'pendente');
    const r = await escreverReservado(
      pools,
      config,
      ctx,
      async (e) => {
        const n = await e.esperaCurta?.executar('INSERT INTO SGH_TRILHA (A) VALUES (1)', [], 20);
        // Próximos comandos da MESMA transação (sem a correção, o primeiro recebia isc_cancelled).
        await e.executar('INSERT INTO SGH_OUTBOX (A) VALUES (1)');
        await e.consultar('SELECT 1 FROM SGH_IDEMPOTENCIA');
        return n;
      },
      { confirmar: true },
    );
    expect(r).toBe(1); // o elo gravado vale: nada é refeito nem desfeito
    expect(driver.conexoes[0]?.cancelamentos).toBe(1);
    expect(pools.para('pc').estado()).toMatchObject({ livres: 1, emUso: 0 }); // consumido: volta ao pool
  });

  it('única violada junto do cancelamento: sobe o erro ORIGINAL (disputa) e o SELECT seguinte não recebe isc_cancelled', async () => {
    const { pools, config } = montar(respondeDepois(UNICA), 'pendente');
    const erros: unknown[] = [];
    await escreverReservado(
      pools,
      config,
      ctx,
      async (e) => {
        await e.esperaCurta?.executar('INSERT INTO SGH_TRILHA (A) VALUES (1)', [], 20).catch((x: unknown) => {
          erros.push(x);
        });
        return e.consultar('SELECT FIRST 1 HASH_LINHA FROM SGH_TRILHA');
      },
      { confirmar: true },
    );
    expect(erros).toHaveLength(1);
    expect(erros[0]).not.toBeInstanceOf(ErroEsperaCurta);
    expect(String((erros[0] as Error).message)).toMatch(/SGH_UQ_TRILHA_ELO/);
  });

  it('pedido que não deu para consumir: ErroCancelamentoPendente, transação desfeita e conexão descartada', async () => {
    const { pools, config, driver } = montar(respondeDepois(), 'perdido');
    let confirmou = false;
    const erro = await escreverReservado(
      pools,
      config,
      ctx,
      async (e) => {
        await e.esperaCurta?.executar('INSERT INTO SGH_TRILHA (A) VALUES (1)', [], 20);
        confirmou = true; // nunca: nenhum comando depois do pedido incerto
      },
      { confirmar: true },
    ).catch((x: unknown) => x);
    expect(erro).toBeInstanceOf(ErroCancelamentoPendente);
    expect(confirmou).toBe(false);
    expect(driver.conexoes[0]?.fechada).toBe(true);
    expect(pools.para('pc').estado()).toMatchObject({ livres: 0, emUso: 0 });
  });

  it('erro que não é de trava, de cancelamento nem de conexão, com o pedido consumido: sobe o erro original', async () => {
    const { pools, config } = montar(respondeDepois('arithmetic exception, numeric overflow'), 'pendente');
    const erro = await escreverReservado(
      pools,
      config,
      ctx,
      (e) => e.esperaCurta!.executar('INSERT INTO SGH_TRILHA (A) VALUES (1)', [], 20),
      { confirmar: false },
    ).catch((x: unknown) => x);
    expect(erro).not.toBeInstanceOf(ErroEsperaCurta);
    expect(erro).not.toBeInstanceOf(ErroCancelamentoPendente);
    expect(String((erro as Error).message)).toMatch(/numeric overflow/);
    expect(pools.para('pc').estado()).toMatchObject({ livres: 1, emUso: 0 }); // consumido: conexão limpa
  });

  // Conexão realmente morta (revisão da trilha-elo): a consulta inócua NÃO consome o pedido (falha com erro de
  // conexão, não isc_cancelled). O dublê no modo 'perdido' não derruba nada; o responder faz a conexão "cair".
  const QUEDA = 'Error reading data from the connection.';
  const conexaoCai =
    (insertFalha: boolean): Responder =>
    (sql) =>
      sql.startsWith('INSERT INTO SGH_TRILHA')
        ? new Promise((ok, erro) => setTimeout(() => (insertFalha ? erro(new Error(QUEDA)) : ok([])), 60))
        : sql === 'SELECT 1 FROM RDB$DATABASE'
          ? Promise.reject(new Error(QUEDA))
          : [];

  it('conexão caída depois do temporizador: sobe o erro de conexão ORIGINAL (não 503 de trilha) e a conexão é descartada', async () => {
    const { pools, config, driver } = montar(conexaoCai(true), 'perdido');
    const erro = await escreverReservado(
      pools,
      config,
      ctx,
      (e) => e.esperaCurta!.executar('INSERT INTO SGH_TRILHA (A) VALUES (1)', [], 20),
      { confirmar: true },
    ).catch((x: unknown) => x);
    expect(erro).not.toBeInstanceOf(ErroCancelamentoPendente);
    expect(erro).not.toBeInstanceOf(ErroEsperaCurta);
    expect((erro as Error).message).toBe(QUEDA);
    expect(driver.conexoes[0]?.fechada).toBe(true);
    expect(pools.para('pc').estado()).toMatchObject({ livres: 0, emUso: 0 });
  });

  it('INSERT respondido e conexão caída na consulta inócua: sobe o erro de conexão, sem COMMIT, conexão descartada', async () => {
    const { pools, config, driver } = montar(conexaoCai(false), 'perdido');
    let seguiu = false;
    const erro = await escreverReservado(
      pools,
      config,
      ctx,
      async (e) => {
        await e.esperaCurta!.executar('INSERT INTO SGH_TRILHA (A) VALUES (1)', [], 20);
        seguiu = true;
      },
      { confirmar: true },
    ).catch((x: unknown) => x);
    expect(erro).not.toBeInstanceOf(ErroCancelamentoPendente);
    expect((erro as Error).message).toBe(QUEDA);
    expect(seguiu).toBe(false);
    expect(driver.conexoes[0]?.fechada).toBe(true);
  });
});

describe('conexão perdida no meio da leitura', () => {
  it('não volta ao pool', async () => {
    const { pools, config } = montar(() => {
      throw new Error('connection shutdown');
    });
    await expect(lerSomente(pools, config, ctx, (l) => l.consultar('SELECT 1 FROM T'))).rejects.toThrow(
      /shutdown/,
    );
    expect(pools.para('pc').estado().abertas).toBe(0);
    await expect(
      escreverReservado(pools, config, ctx, (e) => e.consultar('SELECT 1 FROM T'), { confirmar: false }),
    ).rejects.toThrow(/shutdown/);
    expect(pools.para('pc').estado().abertas).toBe(0);
  });
});
