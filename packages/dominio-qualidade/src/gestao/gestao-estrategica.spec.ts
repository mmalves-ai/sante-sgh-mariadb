import { describe, expect, it } from 'vitest';
import {
  analiseNoPeriodo,
  desempenhoObjetivo,
  mudarSituacaoAcao,
  mudarSituacaoIniciativa,
  mudarSituacaoReuniao,
  progressoIniciativa,
  totalHoras,
  validarAcao,
  validarApontamento,
  validarDeliberacao,
  validarMapa,
  validarObjetivo,
  validarPresenca,
} from './gestao-estrategica.js';

describe('gestão estratégica: mapa e objetivos', () => {
  it('vigência do mapa', () => {
    expect(validarMapa({ vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31' })).toEqual([]);
    expect(validarMapa({ vigenciaInicio: '2026-02-01', vigenciaFim: '2026-01-31' })).toEqual([
      'mapa-vigencia',
    ]);
  });

  it('indicadores do objetivo: sem repetir e pesos todos ou nenhum, somando 100', () => {
    expect(validarObjetivo([{ indicador: 1 }, { indicador: 2 }])).toEqual([]);
    expect(validarObjetivo([{ indicador: 1 }, { indicador: 1 }])).toEqual(['objetivo-indicador-repetido']);
    expect(validarObjetivo([{ indicador: 1, peso: 50 }, { indicador: 2 }])).toEqual([
      'objetivo-peso-incompleto',
    ]);
    expect(
      validarObjetivo([
        { indicador: 1, peso: 50 },
        { indicador: 2, peso: 40 },
      ]),
    ).toEqual(['objetivo-peso-soma']);
    expect(
      validarObjetivo([
        { indicador: 1, peso: 60 },
        { indicador: 2, peso: 40 },
      ]),
    ).toEqual([]);
  });

  it('farol do objetivo pela última apuração, ponderado', () => {
    expect(desempenhoObjetivo([])).toMatchObject({ farol: 'sem_dado', percentualNaMeta: null });
    expect(
      desempenhoObjetivo([
        { situacaoMeta: 'na_meta' },
        { situacaoMeta: 'na_meta' },
        { situacaoMeta: 'sem_valor' },
      ]),
    ).toEqual({ farol: 'verde', percentualNaMeta: 100, naMeta: 2, foraDaMeta: 0, semResultado: 1 });
    expect(
      desempenhoObjetivo([
        { situacaoMeta: 'na_meta', peso: 60 },
        { situacaoMeta: 'fora_da_meta', peso: 40 },
      ]),
    ).toMatchObject({ farol: 'amarelo', percentualNaMeta: 60 });
    expect(
      desempenhoObjetivo([
        { situacaoMeta: 'na_meta', peso: 30 },
        { situacaoMeta: 'fora_da_meta', peso: 70 },
      ]),
    ).toMatchObject({ farol: 'vermelho', percentualNaMeta: 30 });
  });
});

describe('gestão estratégica: iniciativas, ações e horas', () => {
  const ini = {
    inicioPrevisto: '2026-01-01',
    terminoPrevisto: '2026-06-30',
    situacao: 'em_andamento' as const,
  };

  it('situação da iniciativa: transições e conclusão só com ações fechadas', () => {
    expect(
      mudarSituacaoIniciativa({ situacao: 'planejada', inicioReal: null }, 'em_andamento', [], '2026-02-01'),
    ).toEqual({ ok: true, inicioReal: '2026-02-01', terminoReal: null, progresso: null });
    expect(
      mudarSituacaoIniciativa({ situacao: 'planejada', inicioReal: null }, 'concluida', [], '2026-02-01'),
    ).toEqual({ ok: false, recusa: 'iniciativa-transicao' });
    expect(
      mudarSituacaoIniciativa(
        { situacao: 'em_andamento', inicioReal: '2026-02-01' },
        'concluida',
        [{ situacao: 'concluida' }, { situacao: 'pendente' }],
        '2026-03-01',
      ),
    ).toEqual({ ok: false, recusa: 'iniciativa-acoes-abertas' });
    expect(
      mudarSituacaoIniciativa(
        { situacao: 'em_andamento', inicioReal: '2026-02-01' },
        'concluida',
        [{ situacao: 'concluida' }, { situacao: 'cancelada' }],
        '2026-03-01',
      ),
    ).toEqual({ ok: true, inicioReal: '2026-02-01', terminoReal: '2026-03-01', progresso: 100 });
    expect(
      mudarSituacaoIniciativa({ situacao: 'cancelada', inicioReal: null }, 'em_andamento', [], 'x'),
    ).toMatchObject({
      ok: false,
    });
  });

  it('ação dentro do período da iniciativa aberta', () => {
    expect(validarAcao({ inicioPrevisto: '2026-02-01', terminoPrevisto: '2026-02-28' }, ini)).toEqual([]);
    expect(validarAcao({ inicioPrevisto: '2026-02-01', terminoPrevisto: '2026-01-28' }, ini)).toEqual([
      'acao-periodo',
    ]);
    expect(validarAcao({ inicioPrevisto: '2026-06-01', terminoPrevisto: '2026-07-31' }, ini)).toEqual([
      'acao-fora-da-iniciativa',
    ]);
    expect(
      validarAcao(
        { inicioPrevisto: '2026-02-01', terminoPrevisto: '2026-02-28' },
        { ...ini, situacao: 'concluida' },
      ),
    ).toEqual(['iniciativa-encerrada']);
  });

  it('situação da ação com datas reais e progresso', () => {
    expect(
      mudarSituacaoAcao({ situacao: 'pendente', inicioReal: null, progresso: 0 }, 'em_andamento', 40, 'D'),
    ).toEqual({ ok: true, inicioReal: 'D', terminoReal: null, progresso: 40 });
    expect(
      mudarSituacaoAcao({ situacao: 'em_andamento', inicioReal: 'A', progresso: 40 }, 'concluida', null, 'D'),
    ).toEqual({ ok: true, inicioReal: 'A', terminoReal: 'D', progresso: 100 });
    expect(
      mudarSituacaoAcao(
        { situacao: 'em_andamento', inicioReal: 'A', progresso: 40 },
        'em_andamento',
        100,
        'D',
      ),
    ).toMatchObject({ progresso: 99 });
    expect(
      mudarSituacaoAcao({ situacao: 'cancelada', inicioReal: null, progresso: 0 }, 'pendente', null, 'D'),
    ).toEqual({
      ok: false,
      recusa: 'acao-transicao',
    });
  });

  it('progresso da iniciativa ponderado pela duração, sem as canceladas', () => {
    expect(progressoIniciativa([])).toBe(0);
    expect(
      progressoIniciativa([
        {
          situacao: 'concluida',
          progresso: 0,
          duracaoPrevistaMinutos: 300,
          inicioPrevisto: 'a',
          terminoPrevisto: 'a',
        },
        {
          situacao: 'em_andamento',
          progresso: 50,
          duracaoPrevistaMinutos: 100,
          inicioPrevisto: 'a',
          terminoPrevisto: 'a',
        },
        {
          situacao: 'cancelada',
          progresso: 0,
          duracaoPrevistaMinutos: 9999,
          inicioPrevisto: 'a',
          terminoPrevisto: 'a',
        },
      ]),
    ).toBe(87.5);
    expect(
      progressoIniciativa([
        {
          situacao: 'pendente',
          progresso: 0,
          duracaoPrevistaMinutos: null,
          inicioPrevisto: '2026-01-01',
          terminoPrevisto: '2026-01-03',
        },
        {
          situacao: 'concluida',
          progresso: 0,
          duracaoPrevistaMinutos: null,
          inicioPrevisto: '2026-01-01',
          terminoPrevisto: '2026-01-01',
        },
      ]),
    ).toBe(25);
  });

  it('apontamento de horas', () => {
    const base = {
      dataTrabalho: '2026-02-10',
      minutos: 120,
      hoje: '2026-02-11',
      minutosJaApontadosNoDia: 0,
      acao: { situacao: 'em_andamento' as const, inicioPrevisto: '2026-02-01' },
      iniciativa: 'em_andamento' as const,
    };
    expect(validarApontamento(base)).toEqual([]);
    expect(validarApontamento({ ...base, minutos: 0 })).toEqual(['apontamento-duracao']);
    expect(validarApontamento({ ...base, dataTrabalho: '2026-02-12' })).toEqual(['apontamento-futuro']);
    expect(validarApontamento({ ...base, dataTrabalho: '2026-01-31' })).toEqual([
      'apontamento-antes-do-inicio',
    ]);
    expect(validarApontamento({ ...base, minutosJaApontadosNoDia: 1400 })).toEqual([
      'apontamento-dia-excedido',
    ]);
    expect(validarApontamento({ ...base, acao: { ...base.acao, situacao: 'cancelada' } })).toEqual([
      'apontamento-acao-fechada',
    ]);
    expect(validarApontamento({ ...base, iniciativa: 'concluida' })).toEqual(['iniciativa-encerrada']);
    expect(
      totalHoras([
        { pessoa: 'b', minutos: 30 },
        { pessoa: 'a', minutos: 60 },
        { pessoa: 'b', minutos: 45 },
      ]),
    ).toEqual({
      total: 135,
      porPessoa: [
        { pessoa: 'b', minutos: 75 },
        { pessoa: 'a', minutos: 60 },
      ],
    });
  });
});

describe('gestão estratégica: reunião de análise crítica', () => {
  it('situação da reunião: realizada com presente, encerrada com ata e presenças marcadas', () => {
    expect(mudarSituacaoReuniao('agendada', 'realizada', { ata: null, presencas: ['convocado'] })).toEqual([
      'reuniao-sem-presente',
    ]);
    expect(
      mudarSituacaoReuniao('agendada', 'realizada', { ata: null, presencas: ['presente', 'convocado'] }),
    ).toEqual([]);
    expect(
      mudarSituacaoReuniao('realizada', 'encerrada', { ata: ' ', presencas: ['presente', 'convocado'] }),
    ).toEqual(['reuniao-sem-ata', 'reuniao-presenca-pendente']);
    expect(
      mudarSituacaoReuniao('realizada', 'encerrada', { ata: 'Ata', presencas: ['presente', 'ausente'] }),
    ).toEqual([]);
    expect(mudarSituacaoReuniao('encerrada', 'realizada', { ata: 'Ata', presencas: ['presente'] })).toEqual([
      'reuniao-transicao',
    ]);
    expect(mudarSituacaoReuniao('agendada', 'encerrada', { ata: 'Ata', presencas: ['presente'] })).toEqual([
      'reuniao-transicao',
    ]);
  });

  it('presença, pauta pelo período e prazo da deliberação', () => {
    expect(validarPresenca({ presenca: 'ausencia_justificada', justificativa: null })).toEqual([
      'reuniao-justificativa-ausencia',
    ]);
    expect(validarPresenca({ presenca: 'ausente', justificativa: null })).toEqual([]);
    const r = { competenciaInicio: '2026-01-01', competenciaFim: '2026-03-01' };
    expect(analiseNoPeriodo('2026-03-01', r)).toBe(true);
    expect(analiseNoPeriodo('2026-04-01', r)).toBe(false);
    expect(validarDeliberacao({ prazo: '2026-04-01' }, '2026-04-10T10:00:00')).toEqual(['deliberacao-prazo']);
    expect(validarDeliberacao({ prazo: null }, '2026-04-10')).toEqual([]);
  });
});
