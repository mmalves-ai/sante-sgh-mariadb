// Unidade da porta própria da fila do médico com um dublê do núcleo (sem banco): o SQL filtra o estabelecimento e a
// exclusão lógica, as listas de ids são validadas, as datas saem no fuso do estabelecimento e a regra da prescrição a
// renovar é a do domínio (vencemNoTurno), fora do SQL: o mesmo cenário dá a mesma resposta pela porta e pelo domínio.
import type { Leitor } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { vencemNoTurno } from '@sgh/dominio-pep';
import { idsValidos, instanteDoLocal, PortaWorklistPropria } from './worklist-porta-propria.js';

type Linha = Record<string, unknown>;
interface Chamada {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function duble(
  o: { est?: Linha | null; internacao?: Linha[]; resultado?: Linha[]; prescricao?: Linha[] } = {},
) {
  const chamadas: Chamada[] = [];
  const contextos: unknown[] = [];
  const leitor = {
    cliente: 'teste',
    consultar: async (sql: string, params: readonly unknown[] = []) => {
      chamadas.push({ sql, params });
      if (/FROM internacao/.test(sql)) return o.internacao ?? [];
      if (/FROM resultado_exame/.test(sql)) return o.resultado ?? [];
      if (/FROM prescricao/.test(sql)) return o.prescricao ?? [];
      throw new Error(`consulta inesperada: ${sql}`);
    },
    uma: async (sql: string, params: readonly unknown[] = []) => {
      chamadas.push({ sql, params });
      return o.est === undefined ? { id: 7, fuso_horario: 'America/Sao_Paulo' } : o.est;
    },
  } as unknown as Leitor;
  const nucleo = {
    lerSomente: async <T>(c: unknown, fn: (l: Leitor) => Promise<T>) => {
      contextos.push(c);
      return fn(leitor);
    },
  };
  return { porta: new PortaWorklistPropria(nucleo, 'cliente-config'), chamadas, contextos };
}

const C = {
  cliente: '',
  estabelecimento: null,
  usuario: null,
  correlacao: 'cor-1',
  rede: 'rede-teste',
  hospital: 'aa',
};
const DESDE = new Date('2026-11-20T00:00:00Z');

describe('PortaWorklistPropria (dublê do núcleo)', () => {
  it('estabelecimento pelo código sem id no contexto, pelo id com ele; cliente da configuração quando a sessão não traz', async () => {
    const d = duble();
    await d.porta.leituras(C, { login: 'm', pacientes: [], internacoes: [], desde: DESDE });
    expect(d.chamadas[0]).toEqual({
      sql: 'SELECT id, fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
      params: ['aa'],
    });
    expect(d.contextos[0]).toEqual({ cliente: 'cliente-config', correlacao: 'cor-1' });
    // Listas vazias: só a leitura do estabelecimento.
    expect(d.chamadas).toHaveLength(1);
    const d2 = duble();
    await d2.porta.leituras(
      { ...C, cliente: 'outro', estabelecimento: 9 },
      { login: 'm', pacientes: [], internacoes: [], desde: DESDE },
    );
    expect(d2.chamadas[0]?.sql).toContain('WHERE id = ?');
    expect(d2.chamadas[0]?.params).toEqual([9]);
    expect(d2.contextos[0]).toEqual({ cliente: 'outro', correlacao: 'cor-1' });
  });

  it('previsões e resultados: estabelecimento e exclusão lógica no SQL, ids validados, data no fuso e corte da janela', async () => {
    const d = duble({
      internacao: [{ id: 5, previsao: '2026-12-01' }],
      resultado: [
        { id: 11, paciente_id: 1, liberado_em: new Date('2026-11-20T15:00:00Z') },
        // 02:30 UTC de 20/11 é 23:30 de 19/11 em São Paulo: antes da janela.
        { id: 12, paciente_id: 1, liberado_em: new Date('2026-11-20T02:30:00Z') },
      ],
    });
    const r = await d.porta.leituras(C, {
      login: 'm',
      pacientes: [1, 1, 0, -3, 2.5, 2],
      internacoes: [5, 5],
      desde: DESDE,
    });
    expect(r).toEqual({
      previsoesAlta: [{ internacao: 5, previsao: '2026-12-01' }],
      resultados: [{ paciente: 1, exame: 11, liberadoEm: '2026-11-20', vistoPeloMedico: false }],
    });
    const [, internacao, resultado] = d.chamadas;
    expect(internacao?.sql).toMatch(/estabelecimento_id = \?.*excluido_em IS NULL/s);
    expect(internacao?.params).toEqual([7, 5]);
    expect(resultado?.sql).toMatch(/q\.estabelecimento_id = \?/);
    expect(resultado?.sql).toMatch(/r\.excluido_em IS NULL/);
    expect(resultado?.sql).toMatch(/i\.excluido_em IS NULL/);
    expect(resultado?.sql).toMatch(/q\.excluido_em IS NULL/);
    expect(resultado?.params).toEqual([7, 1, 2, new Date('2026-11-19T00:00:00Z')]);
  });

  it('a renovar: janela da hora civil convertida para o instante; a seguinte tira da lista; fim na hora civil', async () => {
    const d = duble({
      prescricao: [
        {
          id: 1,
          atendimento_id: 10,
          situacao: 'vigente',
          vigencia_inicio_em: new Date('2026-11-20T16:00:00Z'),
          vigencia_fim_em: new Date('2026-11-21T15:00:00Z'),
        },
        {
          id: 2,
          atendimento_id: 20,
          situacao: 'vigente',
          vigencia_inicio_em: new Date('2026-11-20T16:00:00Z'),
          vigencia_fim_em: new Date('2026-11-21T14:00:00Z'),
        },
        {
          id: 3,
          atendimento_id: 20,
          situacao: 'futura',
          vigencia_inicio_em: new Date('2026-11-21T14:00:00Z'),
          vigencia_fim_em: new Date('2026-11-22T14:00:00Z'),
        },
        {
          id: 4,
          atendimento_id: 30,
          situacao: 'suspensa',
          vigencia_inicio_em: new Date('2026-11-20T16:00:00Z'),
          vigencia_fim_em: new Date('2026-11-21T15:00:00Z'),
        },
      ],
    });
    const r = await d.porta.aRenovar(C, [10, 20, 30, 10], '2026-11-21T10:00:00', '2026-11-21T16:00:00');
    expect(r).toEqual([{ atendimento: 10, fim: '2026-11-21T12:00:00' }]);
    const q = d.chamadas[1]!;
    expect(q.sql).toMatch(/estabelecimento_id = \?.*excluido_em IS NULL AND tipo = 'medica'/s);
    expect(q.params).toEqual([7, 10, 20, 30, new Date('2026-11-21T13:00:00Z')]);
    expect(await duble().porta.aRenovar(C, [0, -1], '2026-11-21T10:00:00', '2026-11-21T16:00:00')).toEqual(
      [],
    );
  });

  it('recusas: estabelecimento inexistente (404) e hora fora do formato (422)', async () => {
    await expect(
      duble({ est: null }).porta.leituras(C, { login: 'm', pacientes: [1], internacoes: [], desde: DESDE }),
    ).rejects.toMatchObject({ problema: { status: 404, codigo: 'estabelecimento-inexistente' } });
    await expect(duble().porta.aRenovar(C, [1], '21/11/2026', '2026-11-21T16:00:00')).rejects.toMatchObject({
      problema: { status: 422 },
    });
  });
});

describe('regras de apoio', () => {
  it('instanteDoLocal: hora civil → instante (com e sem segundos), no fuso dado', () => {
    expect(instanteDoLocal('2026-11-21T10:00:00', 'America/Sao_Paulo').toISOString()).toBe(
      '2026-11-21T13:00:00.000Z',
    );
    expect(instanteDoLocal('2026-07-01T00:30', 'America/Manaus').toISOString()).toBe(
      '2026-07-01T04:30:00.000Z',
    );
    expect(instanteDoLocal('2026-11-21T10:00:00', 'UTC').toISOString()).toBe('2026-11-21T10:00:00.000Z');
  });

  it('idsValidos: inteiros positivos, sem repetição, no teto', () => {
    expect(idsValidos([3, 3, 0, -1, 1.5, Number.NaN, 4])).toEqual([3, 4]);
    expect(idsValidos(Array.from({ length: 900 }, (_, i) => i + 1))).toHaveLength(500);
  });

  it('a renovar pela regra do domínio: a seguinte no fim, 1 ms ou 1 min depois cobre; porta e domínio concordam', async () => {
    // Hora civil de São Paulo (UTC−3): 12:00 local = 15:00Z. Janela 10:00 a 16:00 local.
    const z = (h: string) => new Date(`2026-11-21T${h}Z`);
    const linha = (id: number, atendimento: number, situacao: string, i: Date, f: Date) => ({
      id,
      atendimento_id: atendimento,
      situacao,
      vigencia_inicio_em: i,
      vigencia_fim_em: f,
    });
    const ontem = new Date('2026-11-20T15:00:00Z');
    const amanha = new Date('2026-11-22T15:00:00Z');
    const prescricao = [
      linha(1, 1, 'vigente', ontem, z('15:00:00.000')), // sem seguinte: a renovar
      linha(2, 2, 'vigente', ontem, z('15:00:00.000')),
      linha(3, 2, 'futura', z('15:00:00.000'), amanha), // início igual ao fim: cobre
      linha(4, 3, 'vigente', ontem, z('14:59:59.999')),
      linha(5, 3, 'futura', z('15:00:00.000'), amanha), // 1 ms depois do fim: cobre
      linha(6, 4, 'vigente', ontem, z('15:00:00.000')),
      linha(7, 4, 'futura', z('15:01:00.000'), amanha), // 1 min depois do fim: cobre
      linha(8, 5, 'vigente', ontem, z('20:00:00.000')), // fora da janela
      linha(9, 6, 'vigente', ontem, z('12:00:00.000')), // já venceu (09:00 local)
      linha(10, 7, 'vigente', ontem, z('15:00:30.500')),
      linha(11, 7, 'futura', z('15:00:30.500'), amanha), // início igual ao fim fora do minuto cheio: cobre
    ];
    const r = await duble({ prescricao }).porta.aRenovar(
      C,
      [1, 2, 3, 4, 5, 6, 7],
      '2026-11-21T10:00:00',
      '2026-11-21T16:00:00',
    );
    expect(r).toEqual([{ atendimento: 1, fim: '2026-11-21T12:00:00' }]);
    // O mesmo cenário no formato do domínio (minuto inclusivo, hora civil), como a prescrição o usa.
    const d = (id: number, atendimento: number, inicio: string, fim: string) => ({
      id,
      atendimento,
      vigencia: { inicio, fim },
      suspensa: false,
    });
    const dominio = vencemNoTurno(
      [
        d(1, 1, '2026-11-20T12:00', '2026-11-21T11:59'),
        d(2, 2, '2026-11-20T12:00', '2026-11-21T11:59'),
        d(3, 2, '2026-11-21T12:00', '2026-11-22T11:59'),
        d(4, 3, '2026-11-20T12:00', '2026-11-21T11:59'),
        d(5, 3, '2026-11-21T12:00', '2026-11-22T11:59'),
        d(6, 4, '2026-11-20T12:00', '2026-11-21T11:59'),
        d(7, 4, '2026-11-21T12:01', '2026-11-22T11:59'),
        d(8, 5, '2026-11-20T12:00', '2026-11-21T16:59'),
        d(9, 6, '2026-11-20T12:00', '2026-11-21T08:59'),
        d(10, 7, '2026-11-20T12:00', '2026-11-21T12:00'),
        d(11, 7, '2026-11-21T12:01', '2026-11-22T11:59'),
      ],
      '2026-11-21T10:00',
      '2026-11-21T16:00',
    );
    expect(dominio.map((x) => x.atendimento)).toEqual(r.map((x) => x.atendimento));
  });
});
