// SBIS-16: cálculo do hash da trilha, encadeamento na mesma transação (cabeça travada) e fecho na virada do dia,
// sobre o banco dublê. A prova contra o MariaDB real fica em
// apps/api/src/modulos/administracao/sbis/porta-propria.int.spec.ts (cadeia íntegra, adulteração e dia sem fecho).
import { describe, expect, it } from 'vitest';
import { BancoDuble, CONFIG_TESTE } from './duble-banco.spec-util.js';
import { escreverTransacao, lerSomente } from './transacao.js';
import {
  type CamposCanonicosTrilha,
  HASH_GENESE,
  type LinhaTrilha,
  fecharDiasTrilha,
  gravarTrilha,
  hashLinhaTrilha,
  textoDataHoraTrilha,
  verificarDiaTrilha,
} from './trilha.js';

const CTX = { cliente: 'teste_duble', correlacao: 'trilha-spec' };
const QUANDO = new Date(Date.UTC(2026, 10, 20, 12, 0, 0, 7));
const BASE: CamposCanonicosTrilha = {
  estabelecimento: 3,
  usuario: 7,
  ocorridoEm: textoDataHoraTrilha(QUANDO),
  acao: 'inclusao',
  entidade: 'tipo_x',
  entidadeId: 100,
  dadosAntes: null,
  dadosDepois: '{"a":1}',
  motivo: null,
  enderecoIp: null,
  correlacao: 'c-1',
  cadeiaDia: '2026-11-20',
  hashAnterior: HASH_GENESE,
};
const LINHA: LinhaTrilha = {
  estabelecimento: 3,
  usuario: 7,
  acao: 'inclusao',
  entidade: 'tipo_x',
  entidadeId: 100,
  dadosDepois: { a: 1 },
  correlacao: 'c-1',
  ocorridoEm: QUANDO,
};

describe('hash da linha da trilha', () => {
  it('é SHA-256 em hex, determinístico, e número ou texto do mesmo id dão o mesmo hash', () => {
    const h = hashLinhaTrilha(BASE);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLinhaTrilha({ ...BASE })).toBe(h);
    expect(hashLinhaTrilha({ ...BASE, estabelecimento: '3', usuario: '7', entidadeId: '100' })).toBe(h);
    expect(textoDataHoraTrilha(QUANDO)).toBe('2026-11-20 12:00:00.007');
  });

  it('qualquer campo alterado (inclusive o elo anterior e o dia) muda o hash; nulo e texto vazio diferem', () => {
    const h = hashLinhaTrilha(BASE);
    const variantes: Partial<CamposCanonicosTrilha>[] = [
      { estabelecimento: null },
      { usuario: 8 },
      { ocorridoEm: '2026-11-20 12:00:00.008' },
      { acao: 'alteracao' },
      { entidade: 'tipo_y' },
      { entidadeId: 101 },
      { dadosAntes: '{}' },
      { dadosDepois: '{"a":2}' },
      { motivo: '' },
      { enderecoIp: '10.0.0.1' },
      { correlacao: 'c-2' },
      { cadeiaDia: '2026-11-21' },
      { hashAnterior: 'f'.repeat(64) },
    ];
    const hashes = variantes.map((v) => hashLinhaTrilha({ ...BASE, ...v }));
    expect(new Set([h, ...hashes]).size).toBe(variantes.length + 1);
  });
});

const cabeca = (x: Record<string, unknown>) => [
  {
    estabelecimento_id: 3,
    ultimo_hash: HASH_GENESE,
    ultimo_trilha_auditoria_id: null,
    dia_aberto: null,
    primeiro_trilha_auditoria_id_dia: null,
    hash_inicio_dia: null,
    quantidade_dia: 0,
    hoje: '2026-11-20',
    ...x,
  },
];

describe('gravarTrilha encadeada', () => {
  it('trava a cabeça antes de gravar, grava o elo e avança a cabeça (primeiro elo do dia)', async () => {
    const b = new BancoDuble()
      .quando(/FROM trilha_cadeia/, cabeca({}))
      .quando(/ON DUPLICATE KEY/, { affectedRows: 0, insertId: 0 });
    const id = await escreverTransacao(b.fonte(), CONFIG_TESTE, CTX, (e) => gravarTrilha(e, LINHA));
    expect(id).toBe(100);
    const ordem = b.comandos.map((c) => c.sql.replace(/\s+/g, ' ').slice(0, 45));
    expect(ordem[0]).toMatch(/^INSERT INTO trilha_cadeia .*/);
    expect(b.comandos[0]?.sql).toMatch(/ON DUPLICATE KEY UPDATE/);
    expect(b.comandos[1]?.sql).toMatch(/FROM trilha_cadeia[\s\S]*FOR UPDATE$/);
    expect(b.comandos[2]?.sql).toMatch(/^INSERT INTO trilha_auditoria \(/);
    expect(b.comandos[3]?.sql).toMatch(/^UPDATE trilha_cadeia[\s\S]*quantidade_dia = 1/);
    expect(b.que(/trilha_auditoria_fecho/)).toEqual([]);
    const p = b.comandos[2]?.parametros ?? [];
    const esperado = hashLinhaTrilha(BASE);
    expect(p.slice(13)).toEqual(['2026-11-20', HASH_GENESE, esperado]);
    expect(b.comandos[3]?.parametros).toEqual([100, esperado, '2026-11-20', 100, HASH_GENESE, 3]);
  });

  it('no mesmo dia aberto: elo sobre o último hash e só soma na cabeça', async () => {
    const ultimo = 'a'.repeat(64);
    const b = new BancoDuble().quando(
      /FROM trilha_cadeia/,
      cabeca({
        ultimo_hash: ultimo,
        ultimo_trilha_auditoria_id: 99,
        dia_aberto: '2026-11-20',
        primeiro_trilha_auditoria_id_dia: 90,
        hash_inicio_dia: HASH_GENESE,
        quantidade_dia: 10,
      }),
    );
    await escreverTransacao(b.fonte(), CONFIG_TESTE, CTX, (e) => gravarTrilha(e, LINHA));
    const p = b.que(/^INSERT INTO trilha_auditoria \(/)[0]?.parametros ?? [];
    expect(p.slice(13)).toEqual(['2026-11-20', ultimo, hashLinhaTrilha({ ...BASE, hashAnterior: ultimo })]);
    expect(b.que(/^UPDATE trilha_cadeia/)[0]?.sql).toMatch(/quantidade_dia = quantidade_dia \+ 1/);
    expect(b.que(/trilha_auditoria_fecho/)).toEqual([]);
  });

  it('na virada do dia: grava o fecho do dia anterior na mesma transação e abre o dia novo', async () => {
    const ultimo = 'b'.repeat(64);
    const b = new BancoDuble().quando(
      /FROM trilha_cadeia/,
      cabeca({
        ultimo_hash: ultimo,
        ultimo_trilha_auditoria_id: 99,
        dia_aberto: '2026-11-19',
        primeiro_trilha_auditoria_id_dia: 90,
        hash_inicio_dia: HASH_GENESE,
        quantidade_dia: 10,
      }),
    );
    await escreverTransacao(b.fonte(), CONFIG_TESTE, CTX, (e) => gravarTrilha(e, LINHA));
    const [f] = b.que(/^INSERT INTO trilha_auditoria_fecho/);
    expect(f?.sql).toMatch(/WHERE NOT EXISTS/);
    expect(f?.parametros).toEqual([3, '2026-11-19', 90, 99, 10, ultimo, HASH_GENESE, 3, '2026-11-19']);
    const p = b.que(/^INSERT INTO trilha_auditoria \(/)[0]?.parametros ?? [];
    expect(p.slice(13, 15)).toEqual(['2026-11-20', ultimo]);
    expect(b.que(/^UPDATE trilha_cadeia/).at(-1)?.sql).toMatch(/quantidade_dia = 1/);
    expect(b.estados).toContain('confirmar');
  });

  it('relógio do banco atrasado não reabre um dia: fica o dia aberto', async () => {
    const b = new BancoDuble().quando(
      /FROM trilha_cadeia/,
      cabeca({
        dia_aberto: '2026-11-21',
        quantidade_dia: 1,
        ultimo_trilha_auditoria_id: 5,
        ultimo_hash: 'c'.repeat(64),
      }),
    );
    await escreverTransacao(b.fonte(), CONFIG_TESTE, CTX, (e) => gravarTrilha(e, LINHA));
    expect(b.que(/^INSERT INTO trilha_auditoria \(/)[0]?.parametros[13]).toBe('2026-11-21');
    expect(b.que(/trilha_auditoria_fecho/)).toEqual([]);
  });

  it('fecharDiasTrilha fecha só os dias abertos antes de hoje e devolve quantos gravou', async () => {
    const b = new BancoDuble()
      .quando(
        /FROM trilha_cadeia/,
        cabeca({
          dia_aberto: '2026-11-19',
          quantidade_dia: 2,
          ultimo_trilha_auditoria_id: 9,
          primeiro_trilha_auditoria_id_dia: 8,
          hash_inicio_dia: HASH_GENESE,
        }),
      )
      .quando(/^INSERT INTO trilha_auditoria_fecho/, { affectedRows: 0, insertId: 0 });
    const n = await escreverTransacao(b.fonte(), CONFIG_TESTE, CTX, (e) => fecharDiasTrilha(e));
    expect(n).toBe(0); // já fechado (idempotente): nada novo
    expect(b.comandos[0]?.sql).toMatch(/dia_aberto < UTC_DATE\(\)[\s\S]*FOR UPDATE$/);
    expect(b.que(/^UPDATE trilha_cadeia/)[0]?.sql).toMatch(/quantidade_dia = 0/);
  });
});

describe('verificarDiaTrilha', () => {
  const linhaBanco = (id: number, c: CamposCanonicosTrilha) => ({
    id,
    estabelecimento_id: c.estabelecimento,
    usuario_id: c.usuario,
    ocorrido: c.ocorridoEm,
    acao: c.acao,
    entidade: c.entidade,
    entidade_id: c.entidadeId,
    antes: c.dadosAntes,
    depois: c.dadosDepois,
    motivo: c.motivo,
    endereco_ip: c.enderecoIp,
    correlacao: c.correlacao,
    hash_anterior: c.hashAnterior,
    hash_linha: hashLinhaTrilha(c),
  });
  const c1 = BASE;
  const h1 = hashLinhaTrilha(c1);
  const c2 = { ...BASE, correlacao: 'c-2', hashAnterior: h1 };
  const h2 = hashLinhaTrilha(c2);
  const fecho = { primeiro: 1, ultimo: 2, quantidade: 2, fim: h2, inicio: HASH_GENESE };
  // Cabeça da cadeia sem dia aberto, com o último elo no fim do dia fechado (o dia verificado é o último fechado).
  const CAB_FECHADA = { primeiro: null, ultimo: 2, quantidade: 0, fim: h2, inicio: null, dia_aberto: null };
  interface Vizinhos {
    readonly anterior?: { fim: string; ultimo: number };
    readonly seguinte?: boolean;
    readonly fora?: number;
  }
  const verificar = (linhas: unknown[], f: unknown, cab: unknown = CAB_FECHADA, v: Vizinhos = {}) => {
    const b = new BancoDuble()
      .quando(/FROM trilha_auditoria\s/, linhas)
      .quando(/FROM trilha_auditoria_fecho/, f ? [f] : [])
      .quando(/dia < \?/, v.anterior ? [v.anterior] : [])
      .quando(/dia > \?/, v.seguinte ? [{ sim: 1 }] : [])
      .quando(/FROM trilha_cadeia/, cab ? [cab] : [])
      .quando(/cadeia_dia IS NULL/, [{ id: v.fora ?? null }]);
    return lerSomente(b.fonte(), CONFIG_TESTE, CTX, (l) => verificarDiaTrilha(l, 3, '2026-11-20'));
  };

  it('cadeia íntegra que confere com o fecho', async () => {
    expect(await verificar([linhaBanco(1, c1), linhaBanco(2, c2)], fecho)).toEqual({
      dia: '2026-11-20',
      linhas: 2,
      ok: true,
      quebraEm: null,
    });
  });

  it('dia aberto confere com a cabeça da cadeia', async () => {
    const aberta = { ...fecho, dia_aberto: '2026-11-20' };
    expect((await verificar([linhaBanco(1, c1), linhaBanco(2, c2)], null, aberta)).ok).toBe(true);
  });

  it('emenda no dia fechado anterior: fim dele igual ao início do dia e primeiro elo depois do último dele', async () => {
    const linhas = [linhaBanco(1, c1), linhaBanco(2, c2)];
    expect(
      (await verificar(linhas, fecho, CAB_FECHADA, { anterior: { fim: HASH_GENESE, ultimo: 0 } })).ok,
    ).toBe(true);
  });

  it('dia anterior sumido ou fecho trocado: o início não emenda no fim do dia fechado anterior', async () => {
    const linhas = [linhaBanco(1, c1), linhaBanco(2, c2)];
    const outro = { fim: 'f'.repeat(64), ultimo: 0 };
    expect(await verificar(linhas, fecho, CAB_FECHADA, { anterior: outro })).toMatchObject({
      ok: false,
      quebraEm: 'elo-entre-dias',
    });
    const antes = { fim: HASH_GENESE, ultimo: 5 }; // o dia anterior termina depois do primeiro elo deste
    expect((await verificar(linhas, fecho, CAB_FECHADA, { anterior: antes })).quebraEm).toBe(
      'elo-entre-dias',
    );
  });

  it('último dia fechado: a cabeça da cadeia tem de emendar nele (dia seguinte sumido ou cadeia trocada)', async () => {
    const linhas = [linhaBanco(1, c1), linhaBanco(2, c2)];
    const trocada = { ...CAB_FECHADA, fim: 'a'.repeat(64) };
    expect((await verificar(linhas, fecho, trocada)).quebraEm).toBe('elo-entre-dias');
    expect((await verificar(linhas, fecho, null)).quebraEm).toBe('elo-entre-dias');
    // Dia aberto seguinte: emenda pelo início dele.
    const abertaDepois = {
      ...CAB_FECHADA,
      quantidade: 1,
      inicio: h2,
      fim: 'b'.repeat(64),
      dia_aberto: '2026-11-21',
    };
    expect((await verificar(linhas, fecho, abertaDepois)).ok).toBe(true);
    // Há fecho seguinte: a emenda é provada no dia seguinte, não contra a cabeça.
    expect((await verificar(linhas, fecho, trocada, { seguinte: true })).ok).toBe(true);
  });

  it('linha do escopo fora da cadeia acima do marco do encadeamento: a prova aponta o id dela', async () => {
    expect(
      await verificar([linhaBanco(1, c1), linhaBanco(2, c2)], fecho, CAB_FECHADA, { fora: 77 }),
    ).toMatchObject({
      ok: false,
      quebraEm: '77',
    });
  });

  it('linha adulterada: aponta o id dela', async () => {
    const adulterada = { ...linhaBanco(2, c2), motivo: 'outro' };
    expect(await verificar([linhaBanco(1, c1), adulterada], fecho)).toMatchObject({
      ok: false,
      quebraEm: '2',
    });
  });

  it('linha apagada no meio: o elo seguinte não fecha', async () => {
    expect((await verificar([linhaBanco(2, c2)], fecho)).quebraEm).toBe('2');
  });

  it('última linha apagada: diverge do fecho', async () => {
    expect((await verificar([linhaBanco(1, c1)], fecho)).quebraEm).toBe('fecho-divergente');
  });

  it('dia com eventos e sem fecho nem dia aberto: sem-fecho; dia vazio: íntegro', async () => {
    expect(await verificar([linhaBanco(1, c1)], null)).toMatchObject({ ok: false, quebraEm: 'sem-fecho' });
    expect(await verificar([], null)).toEqual({ dia: '2026-11-20', linhas: 0, ok: true, quebraEm: null });
  });
});
