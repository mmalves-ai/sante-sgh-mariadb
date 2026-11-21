// Porta própria do painel de indicadores de pessoas com núcleo dublê (sem banco): a conversão das linhas (decimais em
// texto, datas como Date, setor nulo = sem lotação), a ausência pela apuração diária (atraso, falta e falta abonada),
// o setor pela lotação na data do fato (transferência e rateio), cada fonte na sua transação de leitura, a fonte que
// falha vira aviso sem derrubar as outras, o SQL parametrizado (nenhum valor do recorte no texto), os limites do
// acidente no fuso do estabelecimento, o estabelecimento obrigatório e o "hoje" no fuso. Dados sintéticos.
import type { Leitor } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import type { ContextoIndicadores } from './porta-indicadores.js';
import {
  CONSELHO_ENFERMAGEM,
  dataNoFuso,
  diaSeguinte,
  type NucleoIndicadores,
  PortaIndicadoresPessoasPropria,
  SEM_LOTACAO,
} from './porta-indicadores-propria.js';

const UTI = { setor: 20, nomeSetor: 'UTI' };
const CLI = { setor: 30, nomeSetor: 'Clínica' };
type Chamada = { sql: string; params: readonly unknown[] };
type Linhas = Record<string, unknown>[];

/** Vínculo 1: UTI até 14/02, Clínica depois (transferido). Vínculo 2: sem lotação (cadastro sem setor). */
const LOTACOES: Linhas = [
  {
    vinculo: 1,
    setor: 20,
    inicio: new Date('2025-01-01T00:00:00Z'),
    fim: '2026-02-14',
    percentual: '100.0000',
  },
  { vinculo: 1, setor: 30, inicio: '2026-02-15', fim: null, percentual: '100.0000' },
  { vinculo: 3, setor: 20, inicio: '2025-01-01', fim: null, percentual: '50.0000' },
  { vinculo: 3, setor: 30, inicio: '2025-01-01', fim: null, percentual: '50.0000' },
];

function respostas(sql: string): Linhas {
  if (sql.includes('FROM lotacao')) return LOTACOES;
  if (sql.includes('AND ativo')) return [{ id: 20, nome: 'UTI' }];
  if (sql.includes('FROM setor_funcional WHERE'))
    return [
      { id: 20, nome: 'UTI' },
      { id: 30, nome: 'Clínica' },
    ];
  if (sql.includes('FROM presenca_treinamento'))
    return [
      { vinculo: 1, setor_atual: 30, data: '2026-01-20', minutos: '90' },
      { vinculo: 1, setor_atual: 30, data: '2026-03-10', minutos: '60' },
    ];
  if (sql.includes('FROM apuracao_ponto_item'))
    return [
      { fechamento: 11, natureza: 'falta', destino: 'descontado', minutos: '45' }, // atraso
      { fechamento: 11, natureza: 'falta', destino: 'abonado', minutos: '480' }, // falta abonada
      { fechamento: 11, natureza: 'falta', destino: 'informativo', minutos: '999' },
      { fechamento: 11, natureza: 'extra', destino: 'folha', minutos: '600' },
      { fechamento: 12, natureza: 'falta', destino: 'descontado', minutos: '120' },
    ];
  if (sql.includes('FROM fechamento_ponto f\n'))
    return [
      // Janeiro, com apuração diária: previstas 200 h; ausência 45 + 480 min = 8,75 h.
      {
        fechamento: 11,
        vinculo: 1,
        setor_atual: 30,
        data: new Date('2026-01-01T00:00:00Z'),
        trabalhadas: '195.0000',
        extras: '4.0000',
        faltas: '8.0000',
        enfermagem: 1,
        dias_apurados: 22,
        minutos_previstos: '12000',
      },
      // Março, depois da transferência: vai à Clínica; 2 h de ausência.
      {
        fechamento: 12,
        vinculo: 1,
        setor_atual: 30,
        data: '2026-03-01',
        trabalhadas: '100.0000',
        extras: '0',
        faltas: '2.0000',
        enfermagem: 1,
        dias_apurados: 10,
        minutos_previstos: '6120',
      },
      // Sem apuração diária: estimada (160 − 10 + 8,5).
      {
        fechamento: 13,
        vinculo: 2,
        setor_atual: null,
        data: '2026-02-01',
        trabalhadas: '160.0000',
        extras: '10.0000',
        faltas: '8.5000',
        enfermagem: 0,
        dias_apurados: 0,
        minutos_previstos: 0,
      },
    ];
  if (sql.includes('FROM vinculo_trabalho v\n'))
    return [
      { vinculo: 1, setor_atual: 30, admissao: new Date('2025-01-01T00:00:00Z'), desligamento: null },
      { vinculo: 2, setor_atual: null, admissao: '2025-02-01', desligamento: '2026-02-10' },
    ];
  if (sql.includes('FROM calculo_folha_item'))
    return [{ calculo: 1, vinculo: 3, setor_atual: 20, ano: 2026, mes: 2, valor: '250.50' }];
  if (sql.includes('FROM comunicacao_acidente'))
    return [
      { vinculo: 1, setor_atual: 30, em: new Date('2026-02-15T02:30:00Z'), afastou: 1 }, // 14/02 23:30 local: UTI
      { vinculo: 1, setor_atual: 30, em: '2026-03-01 12:00:00.000', afastou: 0 },
    ];
  if (sql.includes('FROM fechamento_censo')) return [{ setor: 20, nome_setor: 'UTI', pacientes_dia: '70' }];
  if (sql.includes('FROM dimensionamento_enfermagem'))
    return [
      {
        setor: 20,
        nome_setor: 'UTI',
        minimos: 0,
        intermediarios: 1,
        alta_dependencia: 0,
        semi_intensivos: 0,
        intensivos: 5,
      },
    ];
  return [];
}

function nucleo(falhar: string | null = null, fuso: string | null = 'America/Sao_Paulo') {
  const chamadas: Chamada[] = [];
  let transacoes = 0;
  const leitor = {
    cliente: 'sintetico',
    consultar: async (sql: string, params: readonly unknown[] = []) => {
      chamadas.push({ sql, params });
      if (falhar && sql.includes(falhar)) throw new Error('tabela fora');
      return respostas(sql);
    },
    uma: async (sql: string, params: readonly unknown[] = []) => {
      chamadas.push({ sql, params });
      return { fuso_horario: fuso };
    },
  } as unknown as Leitor;
  const n: NucleoIndicadores = {
    lerSomente: (async (_c: unknown, fn: (l: Leitor) => Promise<unknown>) => {
      transacoes += 1;
      return fn(leitor);
    }) as NucleoIndicadores['lerSomente'],
  };
  return { n, chamadas, transacoes: () => transacoes };
}

const C: ContextoIndicadores = {
  cliente: 'sintetico',
  estabelecimento: 7,
  usuario: 3,
  correlacao: 'teste-indicadores',
  rede: 'rede-sintetica',
  hospital: 'aa',
};
const R = { inicio: '2026-01-15', fim: '2026-03-31', hospital: 'aa', setor: null };
const h = { hospital: 'aa' };
const porSetor = <T extends { setor: number | null }>(xs: readonly T[]) =>
  [...xs].sort((a, b) => Number(a.setor ?? -1) - Number(b.setor ?? -1));

describe('PortaIndicadoresPessoasPropria (núcleo dublê)', () => {
  it('monta a base com as sete fontes e o apoio, cada leitura na sua transação, convertendo as linhas', async () => {
    const d = nucleo();
    const p = new PortaIndicadoresPessoasPropria(d.n);
    expect(p.destino).toBe('banco');
    const { base, indisponiveis } = await p.base(C, R);
    expect(indisponiveis).toEqual([]);
    expect(d.transacoes()).toBe(8);
    // Vínculo 1 no fim do período está na Clínica (transferido); o 2, desligado, sem lotação.
    expect(base.vinculos).toEqual([
      { ...h, ...CLI, admissao: '2025-01-01', desligamento: null },
      { ...h, setor: null, nomeSetor: SEM_LOTACAO, admissao: '2025-02-01', desligamento: '2026-02-10' },
    ]);
    expect(porSetor(base.ponto)).toEqual([
      {
        ...h,
        setor: null,
        nomeSetor: SEM_LOTACAO,
        horasPrevistas: 158.5,
        horasTrabalhadas: 160,
        horasAusencia: 8.5,
        horasExtras: 10,
        horasEnfermagem: 0,
      },
      // Janeiro na UTI (lotação na competência): ausência = atraso 45 min + falta abonada 480 min.
      {
        ...h,
        ...UTI,
        horasPrevistas: 200,
        horasTrabalhadas: 195,
        horasAusencia: 8.75,
        horasExtras: 4,
        horasEnfermagem: 195,
      },
      {
        ...h,
        ...CLI,
        horasPrevistas: 102,
        horasTrabalhadas: 100,
        horasAusencia: 2,
        horasExtras: 0,
        horasEnfermagem: 100,
      },
    ]);
    // Vínculo 3 com duas lotações simultâneas de 50%: o valor é rateado.
    expect(porSetor(base.folhaHorasExtras)).toEqual([
      { ...h, ...UTI, valorCent: 12_525 },
      { ...h, ...CLI, valorCent: 12_525 },
    ]);
    expect(porSetor(base.treinamento)).toEqual([
      { ...h, ...UTI, horas: 1.5 },
      { ...h, ...CLI, horas: 1 },
    ]);
    // 23:30 local de 14/02 (02:30Z de 15/02) ainda é UTI; o de março é da Clínica.
    expect(porSetor(base.acidentes)).toEqual([
      { ...h, ...UTI, quantidade: 1, comAfastamento: 1 },
      { ...h, ...CLI, quantidade: 1, comAfastamento: 0 },
    ]);
    expect(base.censo).toEqual([{ ...h, ...UTI, pacientesDia: 70 }]);
    expect(base.dimensionamento[0]).toMatchObject({
      ...h,
      ...UTI,
      pacientes: { intensivos: 5, intermediarios: 1 },
    });
  });

  it('o setor pedido recorta as fontes depois da lotação na data', async () => {
    const d = nucleo();
    const { base } = await new PortaIndicadoresPessoasPropria(d.n).base(C, { ...R, setor: 20 });
    expect(base.vinculos).toEqual([]);
    expect(base.ponto.map((x) => x.setor)).toEqual([20]);
    expect(base.folhaHorasExtras).toEqual([{ ...h, ...UTI, valorCent: 12_525 }]);
    expect(base.acidentes.map((x) => x.quantidade)).toEqual([1]);
  });

  it('o SQL é só SELECT e parametrizado; o acidente usa o período civil no fuso do estabelecimento', async () => {
    const d = nucleo();
    await new PortaIndicadoresPessoasPropria(d.n).base(C, { ...R, setor: 20 });
    for (const c of d.chamadas) {
      expect(c.sql).toMatch(/^\s*SELECT/i);
      expect(c.sql).not.toMatch(/2026|'aa'/);
      expect(c.params).toContain(7);
    }
    const ponto = d.chamadas.find((c) => c.sql.includes('FROM fechamento_ponto f\n'))!;
    expect(ponto.params).toEqual([
      CONSELHO_ENFERMAGEM,
      7,
      7,
      '2026-01-01',
      '2026-03-31',
      7,
      '2026-01-01',
      '2026-03-31',
    ]);
    const folha = d.chamadas.find((c) => c.sql.includes('FROM calculo_folha_item'))!;
    expect(folha.params).toEqual([7, 202601, 202603]);
    const acidente = d.chamadas.find((c) => c.sql.includes('FROM comunicacao_acidente'))!;
    expect(acidente.params).toEqual([7, new Date('2026-01-15T03:00:00Z'), new Date('2026-04-01T03:00:00Z')]);
  });

  it('a fonte que falha vem vazia e com o motivo; sem o apoio de lotação, as fontes por vínculo ficam indisponíveis', async () => {
    const d = nucleo('FROM comunicacao_acidente');
    const { base, indisponiveis } = await new PortaIndicadoresPessoasPropria(d.n).base(C, R);
    expect(base.acidentes).toEqual([]);
    expect(base.vinculos).toHaveLength(2);
    expect(indisponiveis).toEqual([{ fonte: 'sesmt', motivo: expect.stringContaining('tabela fora') }]);
    const d2 = nucleo('FROM lotacao');
    const r2 = await new PortaIndicadoresPessoasPropria(d2.n).base(C, R);
    expect(r2.indisponiveis.map((x) => x.fonte)).toEqual([
      'cadastro',
      'ponto',
      'folha',
      'treinamento',
      'sesmt',
    ]);
    expect(r2.base.censo).toHaveLength(1);
  });

  it('sem estabelecimento na sessão, recusa sem ler', async () => {
    const d = nucleo();
    const p = new PortaIndicadoresPessoasPropria(d.n);
    await expect(p.base({ ...C, estabelecimento: null }, R)).rejects.toThrow(/estabelecimento/);
    await expect(p.setores({ ...C, estabelecimento: null })).rejects.toThrow(/estabelecimento/);
    expect(d.transacoes()).toBe(0);
  });

  it('setores do estabelecimento e hoje no fuso do estabelecimento', async () => {
    const d = nucleo(null, 'America/Sao_Paulo');
    // 02:00 UTC de 2 de abril ainda é 1º de abril em São Paulo.
    const p = new PortaIndicadoresPessoasPropria(d.n, () => new Date('2026-04-02T02:00:00Z'));
    expect(await p.setores(C)).toEqual([{ codigo: 20, rotulo: 'UTI' }]);
    expect(await p.hoje(C)).toBe('2026-04-01');
    expect(dataNoFuso(new Date('2026-04-02T02:00:00Z'), 'Fuso/Inexistente')).toBe('2026-04-01');
    expect(diaSeguinte('2026-12-31')).toBe('2027-01-01');
  });
});
