// Regra 8 do M45 (etapa 4): a prescrição de enfermagem — as atividades das intervenções aprazadas pela grade da unidade,
// os horários do turno com o estado, a checagem (não feita exige motivo; o horário checado não se checa de novo), o
// estorno justificado (a checagem fica guardada; o horário volta a ser checável numa geração nova da chave) e o "se
// necessário" sem horário. Dados SINTÉTICOS.
import {
  type AtividadeSaeLida,
  type ChecagemCuidadoLida,
  type ProcessoSaeLido,
  TERMINOLOGIA_SAE_SINTETICA,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  chaveDoHorarioCuidado,
  checagemVigente,
  conferirChecagemCuidado,
  conferirEstornoCuidado,
  conferirPrescricaoCuidado,
  estadoDoCuidado,
  fimDaAtividade,
  geracaoDoHorario,
  previstosDaAtividade,
  proporHorariosCuidado,
} from './prescricao-enfermagem.js';

const AGORA = '2026-10-22T13:00';
const processo: ProcessoSaeLido = {
  id: 10,
  versao: 2,
  avaliacao: 'Avaliação sintética de teste do processo.',
  sistema: 'SINT',
  versaoTerminologia: 'SINT-2026.1',
  usuario: 'SINT.ENF.PLANTAO',
  em: '2026-10-22T08:00',
  registroProntuario: null,
  evolucoes: [],
  diagnosticos: [
    {
      id: 11,
      codigo: 'S-D01',
      descricao: 'x',
      caracteristicas: [],
      fatores: [],
      resultados: [],
      intervencoes: [
        { id: 15, codigo: 'S-I01', descricao: 'Prevenção de lesão por pressão', atividades: [] },
      ],
    },
  ],
};

const atividade = (extra: Partial<AtividadeSaeLida> = {}): AtividadeSaeLida => ({
  id: 20,
  codigo: 'S-A011',
  descricao: 'Mudar o decúbito',
  frequenciaDia: 4,
  horarios: ['00:00', '06:00', '12:00', '18:00'],
  inicio: '2026-10-22T08:00',
  fim: null,
  suspensa: null,
  usuario: 'SINT.ENF.PLANTAO',
  em: '2026-10-22T08:00',
  ...extra,
});

const checagem = (extra: Partial<ChecagemCuidadoLida> = {}): ChecagemCuidadoLida => ({
  id: 30,
  atividade: 20,
  previsto: '2026-10-22T12:00',
  feita: true,
  motivo: null,
  horaReal: '2026-10-22T12:05',
  origemOffline: false,
  categoria: 'tecnico',
  usuario: 'SINT.TECNICO.ENF',
  em: '2026-10-22T12:05',
  estorno: null,
  ...extra,
});

describe('aprazamento pela grade da unidade', () => {
  it('usa a grade para o número de vezes; sem ela, intervalos iguais do primeiro horário; "se necessário" sem horário', () => {
    const grade = new Map([[4, ['0600', '1200', '1800', '2400'.replace('24', '00')]]]);
    expect(proporHorariosCuidado(4, grade)).toEqual(['00:00', '06:00', '12:00', '18:00']);
    expect(proporHorariosCuidado(3, grade)).toEqual(['00:00', '08:00', '16:00']);
    expect(proporHorariosCuidado(2, { '2': ['10:00', '22:00'] })).toEqual(['10:00', '22:00']);
    expect(proporHorariosCuidado(2, {}, '09:00')).toEqual(['09:00', '21:00']);
    expect(proporHorariosCuidado(0, grade)).toEqual([]);
  });
});

describe('regra 8: prescrever os cuidados do processo vigente', () => {
  const conferir = (a: Parameters<typeof conferirPrescricaoCuidado>[0], versaoVista = 2) =>
    conferirPrescricaoCuidado(a, {
      processo,
      versaoVista,
      terminologia: TERMINOLOGIA_SAE_SINTETICA,
      agora: AGORA,
    });
  const a0 = {
    intervencao: 15,
    codigo: 'S-A011',
    descricao: 'Mudar o decúbito',
    frequenciaDia: 4,
    horarios: ['18:00', '06:00', '12:00', '00:00'],
    inicio: null,
    fim: null,
  };

  it('confere e devolve os horários em ordem, com o início agora', () => {
    expect(conferir([a0])).toEqual({
      ok: true,
      atividades: [{ ...a0, horarios: ['00:00', '06:00', '12:00', '18:00'], inicio: AGORA, fim: null }],
    });
    expect(conferir([{ ...a0, codigo: null, descricao: 'Atividade própria do enfermeiro' }]).ok).toBe(true);
  });

  it('recusa sem processo, de outra versão, intervenção de outro processo e atividade de outra intervenção', () => {
    expect(
      conferirPrescricaoCuidado([a0], {
        processo: null,
        versaoVista: 2,
        terminologia: TERMINOLOGIA_SAE_SINTETICA,
        agora: AGORA,
      }),
    ).toMatchObject({ codigo: 'sem-processo' });
    expect(conferir([a0], 1)).toMatchObject({ codigo: 'sae-mudou' });
    expect(conferir([{ ...a0, intervencao: 99 }])).toMatchObject({ codigo: 'intervencao-de-outro-processo' });
    expect(conferir([{ ...a0, codigo: 'S-A031' }])).toMatchObject({ codigo: 'termo-desconhecido' });
  });

  it('os horários seguem a frequência; "se necessário" sem horário; o início e o fim na vigência', () => {
    expect(conferir([{ ...a0, horarios: ['06:00', '06:00', '12:00', '18:00'] }])).toMatchObject({
      codigo: 'horario-repetido',
    });
    expect(conferir([{ ...a0, horarios: ['06:00'] }])).toMatchObject({ codigo: 'horarios-da-frequencia' });
    expect(conferir([{ ...a0, frequenciaDia: 0 }])).toMatchObject({ codigo: 'se-necessario-com-horario' });
    expect(conferir([{ ...a0, frequenciaDia: 0, horarios: [] }]).ok).toBe(true);
    expect(conferir([{ ...a0, inicio: '2026-10-20T08:00' }])).toMatchObject({ codigo: 'inicio-fora' });
    expect(conferir([{ ...a0, inicio: '2026-11-22T08:00' }])).toMatchObject({ codigo: 'inicio-fora' });
    expect(conferir([{ ...a0, fim: '2026-10-22T12:00' }])).toMatchObject({ codigo: 'fim-antes' });
    expect(conferir([{ ...a0, inicio: '2026-10-23T08:00', fim: '2026-10-22T20:00' }])).toMatchObject({
      codigo: 'fim-antes',
    });
  });
});

describe('os horários do turno e o estado', () => {
  it('os previstos no intervalo, dentro da vigência (início, fim, suspensão ou revisão)', () => {
    const a = atividade();
    expect(previstosDaAtividade(a, null, '2026-10-22T07:00', '2026-10-22T19:00')).toEqual([
      '2026-10-22T12:00',
      '2026-10-22T18:00',
    ]);
    expect(previstosDaAtividade(a, null, '2026-10-22T19:00', '2026-10-23T07:00')).toEqual([
      '2026-10-23T00:00',
      '2026-10-23T06:00',
    ]);
    expect(previstosDaAtividade(a, '2026-10-22T15:00', '2026-10-22T07:00', '2026-10-22T19:00')).toEqual([
      '2026-10-22T12:00',
    ]);
    expect(
      previstosDaAtividade(atividade({ frequenciaDia: 0, horarios: [] }), null, AGORA, '2026-10-23T00:00'),
    ).toEqual([]);
  });

  it('o fim da atividade é o primeiro entre o fim prescrito, a suspensão e a revisão do processo', () => {
    expect(fimDaAtividade(atividade(), null)).toBeNull();
    expect(
      fimDaAtividade(
        atividade({
          fim: '2026-10-24T08:00',
          suspensa: { motivo: 'm', usuario: 'u', em: '2026-10-23T09:00' },
        }),
        '2026-10-23T10:00',
      ),
    ).toBe('2026-10-23T09:00');
    expect(fimDaAtividade(atividade(), '2026-10-22T20:00:00')).toBe('2026-10-22T20:00');
  });

  it('feita, não feita, a checar e atrasada (fora da tolerância de uma hora)', () => {
    expect(estadoDoCuidado('2026-10-22T12:00', AGORA, { feita: true })).toBe('feita');
    expect(estadoDoCuidado('2026-10-22T12:00', AGORA, { feita: false })).toBe('naoFeita');
    expect(estadoDoCuidado('2026-10-22T12:00', AGORA, null)).toBe('pendente');
    expect(estadoDoCuidado('2026-10-22T11:59', AGORA, null)).toBe('atrasada');
    expect(estadoDoCuidado('2026-10-22T18:00', AGORA, null)).toBe('pendente');
  });
});

describe('regra 8: a checagem e o estorno', () => {
  const conferir = (
    e: Partial<Parameters<typeof conferirChecagemCuidado>[0]>,
    cs: ChecagemCuidadoLida[] = [],
    a = atividade(),
  ) =>
    conferirChecagemCuidado(
      { previsto: '2026-10-22T12:00', feita: true, motivo: null, horaReal: null, ...e },
      { atividade: a, fim: fimDaAtividade(a, null), agora: AGORA, checagens: cs },
    );

  it('o horário aprazado, feito; a hora real é a do banco sem a do aparelho', () => {
    expect(conferir({})).toEqual({ ok: true, previsto: '2026-10-22T12:00', horaReal: AGORA, motivo: null });
    expect(conferir({ horaReal: '2026-10-22T12:10' })).toMatchObject({ horaReal: '2026-10-22T12:10' });
  });

  it('não feita exige o motivo; o horário já checado recusa; depois do estorno, volta a ser checável', () => {
    expect(conferir({ feita: false })).toMatchObject({ codigo: 'motivo-obrigatorio' });
    expect(conferir({ feita: false, motivo: 'abc' })).toMatchObject({ codigo: 'motivo-obrigatorio' });
    expect(conferir({ feita: false, motivo: 'paciente no exame' })).toMatchObject({
      ok: true,
      motivo: 'paciente no exame',
    });
    expect(conferir({}, [checagem()])).toMatchObject({ codigo: 'ja-checado' });
    const estornada = checagem({ estorno: { id: 31, motivo: 'checado no paciente errado', usuario: 'u' } });
    expect(conferir({}, [estornada]).ok).toBe(true);
    expect(geracaoDoHorario([estornada, checagem({ id: 32 })], 20, '2026-10-22T12:00')).toBe(1);
    expect(chaveDoHorarioCuidado('pc', 20, '2026-10-22T12:00', 1)).toBe('pc:20:202610221200:1');
    expect(checagemVigente([estornada, checagem({ id: 32 })], 20, '2026-10-22T12:00')?.id).toBe(32);
  });

  it('recusa o horário não aprazado, fora da vigência, antes da hora e a hora real no futuro', () => {
    expect(conferir({ previsto: '2026-10-22T13:00' })).toMatchObject({ codigo: 'horario-nao-aprazado' });
    expect(conferir({ previsto: '2026-10-22T06:00' })).toMatchObject({ codigo: 'fora-da-vigencia' });
    expect(conferir({ previsto: '2026-10-23T00:00' })).toMatchObject({ codigo: 'antes-da-hora' });
    expect(conferir({ horaReal: '2026-10-22T14:00' })).toMatchObject({ codigo: 'hora-futura' });
    const suspensa = atividade({ suspensa: { motivo: 'm', usuario: 'u', em: '2026-10-22T11:00' } });
    expect(conferir({}, [], suspensa)).toMatchObject({ codigo: 'fora-da-vigencia' });
  });

  it('"se necessário": qualquer hora na vigência, cada ato um horário', () => {
    const sn = atividade({ frequenciaDia: 0, horarios: [] });
    expect(conferir({ previsto: '2026-10-22T12:37' }, [], sn).ok).toBe(true);
  });

  it('o estorno: a checagem do atendimento, uma vez só', () => {
    expect(conferirEstornoCuidado(null, 1)).toMatchObject({ codigo: 'nao-encontrado' });
    expect(conferirEstornoCuidado({ ...checagem(), atendimento: 2 }, 1)).toMatchObject({
      codigo: 'nao-encontrado',
    });
    expect(conferirEstornoCuidado({ ...checagem(), atendimento: 1 }, 1)).toEqual({ ok: true });
    expect(
      conferirEstornoCuidado(
        { ...checagem({ estorno: { id: 1, motivo: 'm', usuario: 'u' } }), atendimento: 1 },
        1,
      ),
    ).toMatchObject({ codigo: 'ja-estornado' });
  });
});
