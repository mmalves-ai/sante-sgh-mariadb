import { describe, expect, it } from 'vitest';
import {
  concluidasPorTurno,
  motivoBloqueioLoginPainel,
  substituicoesDosDispositivos,
  avaliarLoginsDePainel,
  type DecisaoSemGrupo,
  ehAtivo,
  ehSemGrupo,
  loginsDePainelResolvidos,
  revisarSemGrupo,
  type UsuarioLido,
} from './usuarios-restantes.js';

const u = (
  login: string,
  grupo: string | null,
  status = 'T',
  bloqueado: string | null = 'F',
): UsuarioLido => ({
  login,
  grupo,
  status,
  bloqueado,
});

describe('critério de ativo (M37) e sem grupo (regra 5)', () => {
  it('ativo é STATUS T e não bloqueado; bloqueado nulo é livre', () => {
    expect(ehAtivo(u('A', 'X'))).toBe(true);
    expect(ehAtivo(u('A', 'X', 'T', null))).toBe(true);
    expect(ehAtivo(u('A', 'X', 'F'))).toBe(false);
    expect(ehAtivo(u('A', 'X', 'T', 'T'))).toBe(false);
  });

  it('"SEM GRUPO", vazio e nulo contam como sem grupo', () => {
    expect([ehSemGrupo('SEM GRUPO'), ehSemGrupo(' sem grupo '), ehSemGrupo(''), ehSemGrupo(null)]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(ehSemGrupo('ENFERMAGEM')).toBe(false);
  });
});

describe('revisão dos sem grupo', () => {
  const usuarios = [
    u('B', 'SEM GRUPO'),
    u('A', null),
    u('C', 'SEM GRUPO', 'T', 'T'),
    u('D', 'ENFERMAGEM'),
    u('E', 'SEM GRUPO'),
    u('F', 'SEM GRUPO'),
  ];
  it('pendentes, a executar e recusas, com as parcelas', () => {
    const decisoes = new Map<string, DecisaoSemGrupo>([
      ['a', { tipo: 'atribuir-grupo', grupo: 'enfermagem' }],
      ['B', { tipo: 'bloquear' }],
      ['E', { tipo: 'atribuir-grupo', grupo: 'PAINEIS' }],
      ['F', { tipo: 'atribuir-grupo', grupo: 'INEXISTENTE' }],
      ['D', { tipo: 'bloquear' }],
    ]);
    const r = revisarSemGrupo(usuarios, decisoes, ['ENFERMAGEM', 'PAINEIS']);
    expect(r.pendentes).toEqual([]);
    expect(r.aExecutar.map((x) => x.login)).toEqual(['A', 'B']);
    expect(r.recusadas).toEqual([
      { login: 'E', motivo: 'grupo de destino não é de trabalho' },
      { login: 'F', motivo: 'grupo de destino inexistente ou inativo' },
      { login: 'D', motivo: 'não é usuário ativo sem grupo' },
    ]);
    expect(r.parcelas).toEqual({ semGrupo: 3, nulo: 1, loginVazio: 0 });
  });

  it('login vazio fica pendente e nenhuma decisão age sobre ele', () => {
    const r = revisarSemGrupo([u('', 'SEM GRUPO')], new Map([['', { tipo: 'bloquear' } as const]]), []);
    expect(r.pendentes).toEqual(['']);
    expect(r.aExecutar).toEqual([]);
    expect(r.parcelas.loginVazio).toBe(1);
  });

  it('sem decisão fica pendente (a lista tem de ficar vazia ao fim)', () => {
    expect(revisarSemGrupo(usuarios, new Map(), []).pendentes).toEqual(['A', 'B', 'E', 'F']);
  });
});

describe('regra 4: logins de painel viram dispositivos', () => {
  const agora = '2027-01-15T12:00:00Z';
  const disp = [
    { id: 1, hospital: 'pc', tipo: 'paineltv' as const, validoAte: '2027-12-31T00:00:00Z', revogadoEm: null },
    {
      id: 2,
      hospital: 'pc',
      tipo: 'painel' as const,
      validoAte: '2027-12-31T00:00:00Z',
      revogadoEm: '2027-01-10T00:00:00Z',
    },
    { id: 3, hospital: 'hs', tipo: 'totem' as const, validoAte: '2027-12-31T00:00:00Z', revogadoEm: null },
  ];
  const sub = (login: string, dispositivo: number) => ({
    login,
    dispositivo,
    conferidoEm: '2027-01-12',
    papel: 'ti' as const,
  });
  it('só bloqueia com o token do mesmo hospital, válido e conferido', () => {
    const r = avaliarLoginsDePainel(
      [
        u('TV1', 'PAINEIS'),
        u('TV2', 'PAINEIS'),
        u('TV3', 'PAINEIS'),
        u('TV4', 'PAINEIS'),
        u('TV5', 'PAINEIS', 'T', 'T'),
        u('TV6', 'PAINEIS', 'T', 'T'),
        u('ANA', 'ENFERMAGEM'),
      ],
      [sub('tv1', 1), sub('TV2', 2), sub('TV3', 3), sub('TV6', 1)],
      disp,
      'pc',
      agora,
    );
    expect(r.map((x) => [x.login, x.situacao])).toEqual([
      ['TV1', 'pode-bloquear'],
      ['TV2', 'dispositivo-invalido'],
      ['TV3', 'dispositivo-invalido'],
      ['TV4', 'sem-substituicao'],
      ['TV5', 'bloqueado-sem-substituicao'],
      ['TV6', 'bloqueado'],
    ]);
    expect(loginsDePainelResolvidos(r)).toBe(false);
    expect(loginsDePainelResolvidos(r.filter((x) => ['TV4', 'TV5', 'TV6'].includes(x.login)))).toBe(true);
  });

  it('token vencido não libera o bloqueio', () => {
    const [x] = avaliarLoginsDePainel(
      [u('TV1', 'PAINEIS')],
      [sub('TV1', 1)],
      disp,
      'pc',
      '2028-01-01T00:00:00Z',
    );
    expect(x!.situacao).toBe('dispositivo-invalido');
  });
});

describe('substituições pelos aparelhos (regra 4; D-PAINEL-43)', () => {
  const agora = '2027-01-10T12:00:00';
  it('uma por login: a do aparelho conferido e válido; o revogado só sem outro; o registro completa', () => {
    const r = substituicoesDosDispositivos(
      [
        {
          id: 1,
          loginSubstituido: 'TV01',
          conferidoEm: '2027-01-02 10:00:00',
          revogadoEm: '2027-01-05 10:00:00',
          validoAte: '2028-01-01T00:00:00',
        },
        {
          id: 2,
          loginSubstituido: 'tv01',
          conferidoEm: '2027-01-06 10:00:00',
          revogadoEm: null,
          validoAte: '2028-01-01T00:00:00',
        },
        {
          id: 3,
          loginSubstituido: 'TV02',
          conferidoEm: '2027-01-03 09:00:00',
          revogadoEm: '2027-01-04 10:00:00',
          validoAte: '2028-01-01T00:00:00',
        },
        {
          id: 4,
          loginSubstituido: 'TV03',
          conferidoEm: null,
          revogadoEm: null,
          validoAte: '2028-01-01T00:00:00',
        },
        {
          id: 5,
          loginSubstituido: null,
          conferidoEm: '2027-01-03 09:00:00',
          revogadoEm: null,
          validoAte: '2028-01-01T00:00:00',
        },
      ],
      agora,
      [
        { login: 'TV02', dispositivo: 9, conferidoEm: '2027-01-01', papel: 'ti' },
        { login: 'TV04', dispositivo: 8, conferidoEm: '2027-01-01', papel: 'ti' },
      ],
    );
    expect(r).toEqual([
      { login: 'tv01', dispositivo: 2, conferidoEm: '2027-01-06', papel: 'ti' },
      { login: 'TV02', dispositivo: 3, conferidoEm: '2027-01-03', papel: 'ti' },
      { login: 'TV04', dispositivo: 8, conferidoEm: '2027-01-01', papel: 'ti' },
    ]);
  });
});

describe('bloqueio do login de painel na tela de usuários (regra 4)', () => {
  const agora = '2027-01-10T12:00:00';
  const d = (
    x: Partial<{
      id: number;
      hospital: string;
      loginSubstituido: string | null;
      conferidoEm: string | null;
      revogadoEm: string | null;
      validoAte: string;
    }>,
  ) => ({
    id: 1,
    hospital: 'pc',
    tipo: 'painel',
    loginSubstituido: 'TV01',
    conferidoEm: '2027-01-02 10:00:00',
    revogadoEm: null,
    validoAte: '2028-01-01T00:00:00',
    ...x,
  });
  it('pode com o aparelho válido e conferido; recusa sem aparelho, revogado ou de outro estabelecimento', () => {
    expect(motivoBloqueioLoginPainel('TV01', [d({})], 'pc', agora)).toBeNull();
    expect(motivoBloqueioLoginPainel('TV01', [], 'pc', agora)).toMatch(/ainda é o da TV/);
    expect(motivoBloqueioLoginPainel('TV01', [d({ conferidoEm: null })], 'pc', agora)).toMatch(
      /ainda é o da TV/,
    );
    expect(
      motivoBloqueioLoginPainel('TV01', [d({ revogadoEm: '2027-01-05 00:00:00' })], 'pc', agora),
    ).toMatch(/revogado ou fora da validade/);
    expect(motivoBloqueioLoginPainel('TV01', [d({ hospital: 'hs' })], 'pc', agora)).toMatch(/revogado/);
    expect(motivoBloqueioLoginPainel('TV01', [d({ validoAte: '2027-01-01T00:00:00' })], 'pc', agora)).toMatch(
      /fora da validade/,
    );
  });
  it('a substituição do registro versionado vale no bloqueio como na revisão (mesma fonte); o aparelho segue exigido', () => {
    const semVinculo = d({ loginSubstituido: null, conferidoEm: null });
    const reg = [{ login: 'TV01', dispositivo: 1, conferidoEm: '2027-01-03', papel: 'ti' as const }];
    expect(motivoBloqueioLoginPainel('TV01', [semVinculo], 'pc', agora)).toMatch(/ainda é o da TV/);
    expect(motivoBloqueioLoginPainel('TV01', [semVinculo], 'pc', agora, reg)).toBeNull();
    const [rev] = avaliarLoginsDePainel(
      [u('TV01', 'PAINEIS')],
      substituicoesDosDispositivos([semVinculo], agora, reg),
      [{ id: 1, hospital: 'pc', tipo: 'painel', validoAte: semVinculo.validoAte, revogadoEm: null }],
      'pc',
      agora,
    );
    expect(rev?.situacao).toBe('pode-bloquear');
    // O registro não dispensa o aparelho: revogado ou inexistente, recusa.
    expect(
      motivoBloqueioLoginPainel(
        'TV01',
        [{ ...semVinculo, revogadoEm: '2027-01-05 00:00:00' }],
        'pc',
        agora,
        reg,
      ),
    ).toMatch(/revogado/);
    expect(motivoBloqueioLoginPainel('TV01', [], 'pc', agora, reg)).toMatch(/revogado/);
  });
});

describe('regra 6: trilhas concluídas por turno', () => {
  it('conta pessoas aprovadas por turno da turma; refazer não conta; sem turno vai a não informado', () => {
    expect(
      concluidasPorTurno([
        { login: 'a', turno: 'noite', resultado: 'aprovado' },
        { login: 'A', turno: 'noite', resultado: 'aprovado' },
        { login: 'b', turno: 'fim-de-semana', resultado: 'aprovado' },
        { login: 'c', turno: 'manha', resultado: 'refazer' },
        { login: 'd', turno: null, resultado: 'aprovado' },
        { login: 'e', turno: 'madrugada', resultado: 'aprovado' },
      ]),
    ).toEqual([
      { turno: 'manha', pessoas: 0 },
      { turno: 'tarde', pessoas: 0 },
      { turno: 'noite', pessoas: 1 },
      { turno: 'fim-de-semana', pessoas: 1 },
      { turno: 'nao-informado', pessoas: 2 },
    ]);
  });
});
