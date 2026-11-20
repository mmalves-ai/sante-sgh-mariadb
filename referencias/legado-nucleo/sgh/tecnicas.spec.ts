// Tabelas SGH_ técnicas (ficha do M04, campo 6): trilha com cadeia de hash (regra 9), outbox (regra 7),
// idempotência (regra 8) e chaves de liberação (regra 2). Dublê de banco; dados sintéticos.
import { describe, expect, it } from 'vitest';
import { escritorDuble } from '../duble-escritor.spec-util.js';
import { ErroOperacao } from '../erros-operacao.js';
import { ErroCancelamentoPendente, ErroEsperaCurta, type Escritor } from '../transacao.js';
import {
  conferirCarga,
  expurgarIdempotencia,
  gravarIdempotencia,
  gravarOutbox,
  gravarTrilha,
  HASH_INICIAL,
  hashTrilha,
  lerIdempotencia,
  lerLiberacoes,
  lerPendentesOutbox,
  liberacaoPermite,
  chaveEvento,
  type LinhaTrilha,
  marcarFalha,
  marcarPublicado,
  TENTATIVAS_ELO,
  verificarCadeia,
} from './tecnicas.js';

const linha: LinhaTrilha = {
  rede: 'rede-teste',
  hospital: 'pc',
  usuario: 'USUARIO.TESTE',
  evento: 'teste.evento',
  recurso: 'teste.recurso',
  operacao: 'teste.operar',
  tabelaAlvo: 'TABELA_X',
  idAlvo: '7',
  chaveNaturalAlvo: null,
  resultado: 'sucesso',
  estacao: null,
  correlacao: 'trace-1',
};

describe('SGH_TRILHA: só inclusão, cadeia de hash', () => {
  it('encadeia na última linha do estabelecimento (ou nos 64 zeros) e grava o hash da linha', async () => {
    const e = escritorDuble((c) => {
      if (c.sql.includes('FROM SGH_TRILHA')) return [];
      if (c.sql.includes('SGH_GEN_TRILHA')) return [{ ID: '1', H: '2026-10-20 10:00:00.0000' }];
      return 1;
    });
    const r = await gravarTrilha(e, linha);
    expect(r).toEqual({ id: '1', hash: hashTrilha('1', '2026-10-20 10:00:00.0000', linha, HASH_INICIAL) });
    const ins = e.comandos.find((c) => c.sql.includes('INSERT INTO SGH_TRILHA'));
    expect(ins?.parametros.slice(-2)).toEqual([HASH_INICIAL, r.hash]);
  });

  it('refaz o elo quando outra transação encadeou primeiro; desiste depois de algumas tentativas', async () => {
    let n = 0;
    const e = escritorDuble((c) => {
      if (c.sql.includes('FROM SGH_TRILHA')) return [{ HASH_LINHA: 'a'.repeat(64) }];
      if (c.sql.includes('SGH_GEN_TRILHA')) return [{ ID: String(++n), H: '2026-10-20 10:00:00.0000' }];
      if (c.sql.includes('INSERT INTO SGH_TRILHA'))
        throw new Error(
          'violation of PRIMARY or UNIQUE KEY constraint "SGH_UQ_TRILHA_ELO" on table "SGH_TRILHA"',
        );
      return 1;
    });
    // Esgotadas as tentativas: o 503 próprio da trilha (a ação não acontece), não o erro cru do banco.
    await expect(gravarTrilha(e, linha)).rejects.toMatchObject({
      problema: { status: 503, codigo: 'trilha-indisponivel' },
    });
    expect(n).toBe(TENTATIVAS_ELO);
    const outro = escritorDuble((c) => {
      if (c.sql.includes('INSERT INTO SGH_TRILHA')) throw new Error('connection lost');
      return c.sql.includes('SGH_GEN_TRILHA') ? [{ ID: '1', H: 'x' }] : [];
    });
    await expect(gravarTrilha(outro, linha)).rejects.toThrow('connection lost');
  });

  /** Escritor com espera curta: `segura(n)` diz se a n-ésima inclusão do elo encontra a trava presa. */
  function comEspera(
    segura: (n: number) => boolean,
    limites = { esperaMs: 100, tetoMs: 300 },
  ): Escritor & { inclusoes: number; esperas: number[]; anteriores: unknown[] } {
    let ids = 0;
    const base = escritorDuble((c) => {
      if (c.sql.includes('FROM SGH_TRILHA')) return [{ HASH_LINHA: 'b'.repeat(64) }];
      if (c.sql.includes('SGH_GEN_TRILHA')) return [{ ID: String(++ids), H: '2026-11-18 10:00:00.0000' }];
      return 1;
    });
    const r = {
      ...base,
      inclusoes: 0,
      esperas: [] as number[],
      anteriores: [] as unknown[],
      esperaCurta: {
        ...limites,
        async executar(_sql: string, p: readonly unknown[], ms: number) {
          r.inclusoes++;
          r.esperas.push(ms);
          r.anteriores.push(p.at(-2));
          if (segura(r.inclusoes)) {
            // A outra transação segura o elo: a espera curta corre o tempo inteiro e é cancelada.
            await new Promise((ok) => setTimeout(ok, ms));
            throw new ErroEsperaCurta('trava ocupada');
          }
          return 1;
        },
      },
    };
    return r;
  }

  it('elo preso por transação longa: desiste no teto (sem esperar LOCK TIMEOUT x tentativas) e não grava elo', async () => {
    const e = comEspera(() => true);
    const t0 = Date.now();
    const erro = await gravarTrilha(e, linha).catch((x: unknown) => x);
    const levou = Date.now() - t0;
    expect(erro).toBeInstanceOf(ErroOperacao);
    expect(erro).toMatchObject({ problema: { status: 503, codigo: 'trilha-indisponivel' } });
    expect(levou).toBeLessThan(300 + 150); // teto + folga do relógio, nunca ~25 s
    expect(e.inclusoes).toBeGreaterThanOrEqual(2); // refez o encadeamento dentro do teto
    // A espera começa curta (100 ms) e dobra a cada cancelamento, sempre dentro do que sobra do teto.
    expect(e.esperas[0]).toBe(100);
    expect(e.esperas.every((ms, i) => i === 0 || ms <= 2 * (e.esperas[i - 1] ?? 0))).toBe(true);
    expect(e.esperas.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(300 + 100);
  });

  it('elo liberado durante o teto: refaz sobre o último elo confirmado e grava UMA vez', async () => {
    const e = comEspera((n) => n === 1);
    const r = await gravarTrilha(e, linha);
    expect(e.inclusoes).toBe(2);
    expect(r.id).toBe('2'); // a primeira inclusão (id 1) foi desfeita pelo cancelamento; só a segunda vale
    expect(e.anteriores).toEqual(['b'.repeat(64), 'b'.repeat(64)]);
  });

  it('elo preso mais vezes que TENTATIVAS_ELO, mas liberado dentro do teto: grava (só o teto limita a espera)', async () => {
    const e = comEspera((n) => n <= TENTATIVAS_ELO + 1, { esperaMs: 10, tetoMs: 5_000 });
    const r = await gravarTrilha(e, linha);
    expect(e.inclusoes).toBe(TENTATIVAS_ELO + 2);
    expect(r.id).toBe(String(TENTATIVAS_ELO + 2));
    // Dobra a cada cancelamento (10, 20, 40, 80, 160, 320), com piso de 100 ms: INSERT só lento também ganha tempo.
    expect(e.esperas.slice(0, 6)).toEqual([100, 100, 100, 100, 160, 320]);
  });

  it('cancelamento que não deu para consumir: 503 na hora, sem refazer nem outro comando na transação', async () => {
    const e = comEspera(() => false);
    let consultas = 0;
    const comprometido = {
      ...e,
      consultar: async (...a: Parameters<Escritor['consultar']>) => {
        consultas++;
        return e.consultar(...a);
      },
      esperaCurta: {
        esperaMs: 100,
        tetoMs: 300,
        async executar() {
          e.inclusoes++;
          throw new ErroCancelamentoPendente('pendente');
        },
      },
    } as Escritor & { inclusoes: number };
    const erro = await gravarTrilha(comprometido, linha).catch((x: unknown) => x);
    expect(erro).toMatchObject({ problema: { status: 503, codigo: 'trilha-indisponivel' } });
    expect(e.inclusoes).toBe(1);
    expect(consultas).toBe(2); // só o SELECT do último elo e o do gerador da 1ª tentativa; nada depois
  });

  it('erro que não é disputa do elo sobe na hora, sem refazer', async () => {
    const e = comEspera(() => false);
    const falho = {
      ...e,
      esperaCurta: {
        esperaMs: 100,
        tetoMs: 300,
        async executar() {
          throw new Error('connection lost');
        },
      },
    };
    await expect(gravarTrilha(falho, linha)).rejects.toThrow('connection lost');
  });

  it('verificação da cadeia: fecha, acusa elo trocado e hash adulterado, pagina', async () => {
    const h1 = hashTrilha('1', 'T1', linha, HASH_INICIAL);
    const h2 = hashTrilha('2', 'T2', linha, h1);
    const bruta = (id: string, h: string, ant: string, hash: string) => ({
      ID: id,
      H: h,
      REDE: linha.rede,
      HOSPITAL: linha.hospital,
      USUARIO: linha.usuario,
      EVENTO: linha.evento,
      RECURSO: linha.recurso,
      OPERACAO: linha.operacao,
      TABELA_ALVO: linha.tabelaAlvo,
      ID_ALVO: linha.idAlvo,
      CHAVE_NATURAL_ALVO: null,
      RESULTADO: linha.resultado,
      ESTACAO: null,
      CORRELACAO: linha.correlacao,
      HASH_ANTERIOR: ant,
      HASH_LINHA: hash,
    });
    const paginar = (linhas: Record<string, unknown>[]) =>
      escritorDuble((c) => {
        const desde = Number(c.parametros[1]);
        return linhas.filter((l) => Number(l['ID']) > desde).slice(0, 1);
      });
    const boas = [bruta('1', 'T1', HASH_INICIAL, h1), bruta('2', 'T2', h1, h2)];
    expect(await verificarCadeia(paginar(boas), 'pc', 1)).toEqual({ linhas: 2, ok: true, quebraEm: null });
    const eloTrocado = [bruta('1', 'T1', HASH_INICIAL, h1), bruta('2', 'T2', 'b'.repeat(64), h2)];
    expect(await verificarCadeia(paginar(eloTrocado), 'pc', 1)).toEqual({
      linhas: 1,
      ok: false,
      quebraEm: '2',
    });
    const adulterada = [{ ...bruta('1', 'T1', HASH_INICIAL, h1), USUARIO: 'OUTRO' }];
    expect(await verificarCadeia(paginar(adulterada), 'pc', 1)).toMatchObject({ ok: false, quebraEm: '1' });
  });
});

describe('SGH_TRILHA do M06: origem, objeto, trilha do legado e dia da cadeia', () => {
  it('linha sem os campos do M06 tem o hash de antes; com eles (e o dia), o hash os inclui', () => {
    const v1 = hashTrilha('1', 'T', linha, HASH_INICIAL);
    expect(hashTrilha('1', 'T', { ...linha, origem: null, diferenca: '' }, HASH_INICIAL, null)).toBe(v1);
    const v2 = hashTrilha(
      '1',
      'T',
      { ...linha, idPaciente: 9, idTrilhaLegado: '77' },
      HASH_INICIAL,
      '2026-10-20',
    );
    expect(v2).not.toBe(v1);
    expect(
      hashTrilha('1', 'T', { ...linha, idPaciente: 10, idTrilhaLegado: '77' }, HASH_INICIAL, '2026-10-20'),
    ).not.toBe(v2);
  });

  it('grava as colunas do M06 com o dia do relógio do banco; a verificação do dia confere o trecho', async () => {
    const e = escritorDuble((c) => {
      if (c.sql.includes('FROM SGH_TRILHA')) return [];
      if (c.sql.includes('SGH_GEN_TRILHA')) return [{ ID: '1', H: 'T1', D: '2026-10-20' }];
      return 1;
    });
    const l = {
      ...linha,
      origem: 'SGH-WEB:1.2.3.4',
      idPaciente: 9,
      atendimento: 3,
      idTrilhaLegado: '77',
      diferenca: 'NOME',
    };
    const r = await gravarTrilha(e, l);
    const ins = e.comandos.find((c) => c.sql.includes('INSERT INTO SGH_TRILHA'));
    expect(ins?.sql).toMatch(/ORIGEM, ID_RICADPAC, REG, ID_TBCABTRILHA, DIFERENCA, DIA/);
    expect(ins?.parametros.slice(-8)).toEqual([
      'SGH-WEB:1.2.3.4',
      9,
      3,
      '77',
      'NOME',
      '2026-10-20',
      HASH_INICIAL,
      r.hash,
    ]);
    const linhaBruta = {
      ID: '1',
      H: 'T1',
      REDE: l.rede,
      HOSPITAL: l.hospital,
      USUARIO: l.usuario,
      EVENTO: l.evento,
      RECURSO: l.recurso,
      OPERACAO: l.operacao,
      TABELA_ALVO: l.tabelaAlvo,
      ID_ALVO: l.idAlvo,
      CHAVE_NATURAL_ALVO: null,
      RESULTADO: l.resultado,
      ESTACAO: null,
      CORRELACAO: l.correlacao,
      ORIGEM: l.origem,
      ID_RICADPAC: '9',
      REG: '3',
      ID_TBCABTRILHA: '77',
      DIFERENCA: 'NOME',
      DIA: '2026-10-20',
      HASH_ANTERIOR: HASH_INICIAL,
      HASH_LINHA: r.hash,
    };
    const leitor = escritorDuble((c) => (Number(c.parametros[1]) < 1 ? [linhaBruta] : []));
    expect(await verificarCadeia(leitor, 'pc', 10, { dia: '2026-10-20' })).toEqual({
      linhas: 1,
      ok: true,
      quebraEm: null,
    });
    expect(leitor.comandos[0]?.sql).toMatch(/AND DIA = /);
    const elo = escritorDuble((c) =>
      Number(c.parametros[1]) < 1 ? [{ ...linhaBruta, HASH_ANTERIOR: 'a'.repeat(64) }] : [],
    );
    expect(
      await verificarCadeia(elo, 'pc', 10, { dia: '2026-10-20', eloInicial: 'b'.repeat(64) }),
    ).toMatchObject({
      ok: false,
    });
  });
});

describe('SGH_OUTBOX', () => {
  it('carga só com IDs e códigos curtos', () => {
    expect(conferirCarga({ idPaciente: 7, hospital: 'pc' })).toBe('{"idPaciente":7,"hospital":"pc"}');
    expect(() => conferirCarga({ nome: 'MARIA DA SILVA' })).toThrow(/ID ou código/);
    expect(() => conferirCarga({ 'chave inválida': 1 })).toThrow(/chave inválida/);
    expect(() => conferirCarga({ x: Number.NaN })).toThrow();
    const grande = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`c${i}`, 'x'.repeat(40)]));
    expect(() => conferirCarga(grande)).toThrow(/grande demais/);
  });

  it('grava, lista pendentes por estabelecimento, marca publicado e falha com espera crescente', async () => {
    const e = escritorDuble((c) => {
      if (c.sql.includes('INSERT INTO SGH_OUTBOX')) return { ID: '3' };
      if (c.sql.includes('FROM SGH_OUTBOX'))
        return [
          {
            ID: '3',
            REDE: 'r',
            HOSPITAL: 'pc',
            TIPO: 't',
            CHAVE_EVENTO: 'k',
            CARGA: '{"id":1}',
            TENTATIVAS: 0,
          },
        ];
      return 1;
    });
    expect(
      await gravarOutbox(e, { rede: 'r', hospital: 'pc', tipo: 't', chave: 'k', carga: { id: 1 } }),
    ).toBe('3');
    expect(await lerPendentesOutbox(e, 'pc', 5000)).toEqual([
      { id: '3', rede: 'r', hospital: 'pc', tipo: 't', chave: 'k', carga: { id: 1 }, tentativas: 0 },
    ]);
    expect(e.comandos.at(-1)?.sql).toContain('FIRST 1000');
    expect(e.comandos.find((c) => c.sql.includes('INSERT INTO SGH_OUTBOX'))?.parametros[3]).toBe(
      chaveEvento('k'),
    );
    expect(await marcarPublicado(e, '3')).toBe(1);
    expect(await marcarFalha(e, '3', 0, 5, 2, 'erro')).toBe('pendente');
    expect(await marcarFalha(e, '3', 4, 5, 2, 'erro')).toBe('morto');
  });
});

describe('SGH_IDEMPOTENCIA', () => {
  it('lê o resultado guardado, grava e expurga', async () => {
    const vazio = escritorDuble(() => []);
    expect(await lerIdempotencia(vazio, 'k', 'op', 'pc')).toBeNull();
    const cheio = escritorDuble(() => [{ HASH_ENTRADA: 'h ', RESULTADO: '{"id":1}' }]);
    expect(await lerIdempotencia(cheio, 'k', 'op', 'pc')).toEqual({
      hashEntrada: 'h',
      resultado: { id: 1 },
      usuario: null,
    });
    const comUsuario = escritorDuble(() => [{ HASH_ENTRADA: 'h', RESULTADO: '{}', USUARIO: 'ANA ' }]);
    expect((await lerIdempotencia(comUsuario, 'k', 'op', 'pc'))?.usuario).toBe('ANA');
    const e = escritorDuble(() => 4);
    await gravarIdempotencia(e, {
      chave: 'k',
      operacao: 'op',
      hospital: 'pc',
      hashEntrada: 'h',
      resultado: '{}',
      usuario: 'U',
    });
    expect(await expurgarIdempotencia(e, 30)).toBe(4);
    expect(e.comandos.at(-1)?.parametros).toEqual([-30]);
    await expect(expurgarIdempotencia(e, 0)).rejects.toThrow();
  });
});

describe('SGH_CFG_LIBERACAO', () => {
  it('lê as chaves e decide pela pessoa, pelo setor e pelo estabelecimento (a mais específica vence)', async () => {
    const e = escritorDuble(() => [
      { ESCOPO: 'hospital ', VALOR: '*', LIGADA: true },
      { ESCOPO: 'pessoa', VALOR: 'BLOQUEADA', LIGADA: false },
      { ESCOPO: 'setor', VALOR: 'UTI', LIGADA: 0 },
    ]);
    const chaves = await lerLiberacoes(e, 'pc', 'op');
    expect(chaves[0]).toEqual({ escopo: 'hospital', valor: '*', ligada: true });
    expect(liberacaoPermite(chaves, 'QUALQUER', undefined)).toBe(true);
    expect(liberacaoPermite(chaves, 'BLOQUEADA', undefined)).toBe(false);
    expect(liberacaoPermite(chaves, 'QUALQUER', 'UTI')).toBe(false);
    expect(liberacaoPermite([], 'QUALQUER', 'UTI')).toBe(false);
    expect(liberacaoPermite([{ escopo: 'pessoa', valor: 'ANA', ligada: true }], 'ANA', undefined)).toBe(true);
  });

  it('chave do estabelecimento desligada recusa sempre, mesmo com a chave da pessoa ou do setor ligada (recolher)', () => {
    const chaves = [
      { escopo: 'hospital', valor: '*', ligada: false },
      { escopo: 'pessoa', valor: 'ANA', ligada: true },
      { escopo: 'setor', valor: 'RECEPCAO', ligada: true },
    ] as const;
    expect(liberacaoPermite(chaves, 'ANA', undefined)).toBe(false);
    expect(liberacaoPermite(chaves, 'OUTRA', 'RECEPCAO')).toBe(false);
  });
});

describe('SGH_OUTBOX: ordem entre ciclos e chave do evento', () => {
  const linha = (id: string, espera: 0 | 1) => ({
    ID: id,
    REDE: 'r',
    HOSPITAL: 'pc',
    TIPO: 't',
    CHAVE_EVENTO: `k${id}`,
    CARGA: '{}',
    TENTATIVAS: espera,
    EM_ESPERA: espera,
  });
  it('para no primeiro pendente em espera (os de ID maior não passam na frente)', async () => {
    const e = escritorDuble(() => [linha('1', 0), linha('2', 1), linha('3', 0)]);
    expect((await lerPendentesOutbox(e, 'pc')).map((p) => p.id)).toEqual(['1']);
    const todos = escritorDuble(() => [linha('5', 1), linha('6', 0)]);
    expect(await lerPendentesOutbox(todos, 'pc')).toEqual([]);
  });
  it('chave de tamanho fixo (64 hex), distinta para composições longas que só diferem no fim', () => {
    const base = `hs1234567:${'operacao.nomeMuitoLongoDeOperacao'}:${'k'.repeat(80)}`;
    const a = chaveEvento(`${base}:0`);
    const b = chaveEvento(`${base}:1`);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
