// Regras das áreas e da escala da atenção domiciliar (C2-105, 03-PEP linha 143).
import { describe, expect, it } from 'vitest';
import {
  areaDoCep,
  conferirAreaDomiciliar,
  conferirEscalaDomiciliar,
  conferirProfissionalArea,
  diaSemanaEscala,
  escalaDaVisita,
  type EscalaVigente,
  gradeDoDia,
  normalizarCep,
} from './area-escala-domiciliar.js';

const campos = (p: readonly { campo: string }[]) => p.map((x) => x.campo);

describe('área da atenção domiciliar', () => {
  it('normaliza o CEP com hífen e recusa o que não tem 8 dígitos', () => {
    expect(normalizarCep('01000-000')).toBe('01000000');
    expect(normalizarCep('0100')).toBeNull();
    expect(normalizarCep(null)).toBeNull();
  });

  it('aceita a área com faixas separadas', () => {
    expect(
      conferirAreaDomiciliar({
        codigo: 'NORTE',
        descricao: 'Zona norte',
        faixas: [
          { cepInicial: '02000-000', cepFinal: '02999-999' },
          { cepInicial: '07000000', cepFinal: '07099999' },
        ],
        faixasOutrasAreas: [{ area: 'SUL', cepInicial: '04000000', cepFinal: '04999999' }],
      }),
    ).toEqual([]);
  });

  it('recusa código e descrição vazios, CEP inválido e faixa invertida', () => {
    const p = conferirAreaDomiciliar({
      codigo: ' ',
      descricao: 'a',
      faixas: [
        { cepInicial: '123', cepFinal: '02000000' },
        { cepInicial: '03000000', cepFinal: '02000000' },
      ],
      faixasOutrasAreas: [],
    });
    expect(campos(p)).toEqual(['codigo', 'descricao', 'faixas.0', 'faixas.1']);
  });

  it('recusa faixas sobrepostas na mesma área e com outra área ativa', () => {
    const p = conferirAreaDomiciliar({
      codigo: 'NORTE',
      descricao: 'Zona norte',
      faixas: [
        { cepInicial: '02000000', cepFinal: '02500000' },
        { cepInicial: '02400000', cepFinal: '02600000' },
        { cepInicial: '04100000', cepFinal: '04100999' },
      ],
      faixasOutrasAreas: [{ area: 'SUL', cepInicial: '04000000', cepFinal: '04999999' }],
    });
    expect(campos(p)).toEqual(['faixas.1', 'faixas.2']);
    expect(p[1]!.mensagem).toContain('área SUL');
  });

  it('acha a área do CEP pela faixa mais estreita', () => {
    const faixas = [
      { area: 1, cepInicial: '02000000', cepFinal: '02999999' },
      { area: 2, cepInicial: '02100000', cepFinal: '02100999' },
    ];
    expect(areaDoCep('02100-500', faixas)).toBe(2);
    expect(areaDoCep('02500000', faixas)).toBe(1);
    expect(areaDoCep('09000000', faixas)).toBeNull();
    expect(areaDoCep('x', faixas)).toBeNull();
  });
});

describe('profissional da área', () => {
  it('aceita o vínculo novo depois do anterior encerrado', () => {
    expect(
      conferirProfissionalArea({
        prioridade: 1,
        vigenciaInicio: '2026-12-01',
        vigenciaFim: null,
        outrosVinculos: [{ inicio: '2026-01-01', fim: '2026-11-30' }],
      }),
    ).toEqual([]);
  });

  it('recusa prioridade fora de 1 a 99, vigência invertida e vínculo sobreposto', () => {
    expect(
      campos(
        conferirProfissionalArea({
          prioridade: 0,
          vigenciaInicio: '2026-12-01',
          vigenciaFim: '2026-11-01',
          outrosVinculos: [],
        }),
      ),
    ).toEqual(['prioridade', 'vigenciaFim']);
    expect(
      campos(
        conferirProfissionalArea({
          prioridade: 2,
          vigenciaInicio: '2026-12-01',
          vigenciaFim: null,
          outrosVinculos: [{ inicio: '2026-01-01', fim: null }],
        }),
      ),
    ).toEqual(['vigenciaInicio']);
  });
});

describe('escala da atenção domiciliar', () => {
  const turno = {
    diaSemana: 2,
    horaInicio: '08:00',
    horaFim: '12:00',
    vigenciaInicio: '2026-12-01',
    vigenciaFim: null,
    quantidade: 4,
    profissionalNaArea: true,
    outrosTurnos: [],
  };

  it('aceita o turno válido e o turno colado no outro', () => {
    expect(conferirEscalaDomiciliar(turno)).toEqual([]);
    expect(
      conferirEscalaDomiciliar({
        ...turno,
        outrosTurnos: [{ ...turno, horaInicio: '12:00', horaFim: '18:00' }],
      }),
    ).toEqual([]);
  });

  it('recusa dia, turno invertido, quantidade e vigência inválidos', () => {
    expect(
      campos(
        conferirEscalaDomiciliar({
          ...turno,
          diaSemana: 8,
          horaInicio: '12:00',
          horaFim: '08:00',
          quantidade: 0,
          vigenciaFim: '2026-01-01',
        }),
      ),
    ).toEqual(['diaSemana', 'horaFim', 'quantidade', 'vigenciaFim']);
    expect(campos(conferirEscalaDomiciliar({ ...turno, horaInicio: '8h' }))).toEqual(['horaInicio']);
  });

  it('recusa o profissional fora da área e o turno sobreposto com vigência cruzada', () => {
    expect(campos(conferirEscalaDomiciliar({ ...turno, profissionalNaArea: false }))).toEqual([
      'profissional',
    ]);
    const p = conferirEscalaDomiciliar({
      ...turno,
      outrosTurnos: [{ ...turno, horaInicio: '11:00', horaFim: '14:00', vigenciaInicio: '2026-06-01' }],
    });
    expect(campos(p)).toEqual(['horaInicio']);
    expect(p[0]!.mensagem).toContain('11:00 às 14:00');
    // Mesmo horário, mas a vigência do outro acabou antes: aceita.
    expect(
      conferirEscalaDomiciliar({
        ...turno,
        outrosTurnos: [{ ...turno, vigenciaInicio: '2026-01-01', vigenciaFim: '2026-11-30' }],
      }),
    ).toEqual([]);
  });

  it('dá o dia da semana da escala (1 = domingo)', () => {
    expect(diaSemanaEscala('2026-11-29')).toBe(1); // domingo
    expect(diaSemanaEscala('2026-12-01')).toBe(3); // terça
    expect(diaSemanaEscala('2026-12-05')).toBe(7); // sábado
  });

  const escalas: EscalaVigente[] = [
    {
      id: 1,
      profissional: 10,
      tipoChamado: null,
      diaSemana: 3,
      horaInicio: '08:00',
      horaFim: '12:00',
      vigenciaInicio: '2026-12-01',
      vigenciaFim: null,
      quantidade: 2,
      permiteExtra: false,
      ativo: true,
    },
    {
      id: 2,
      profissional: 10,
      tipoChamado: 5,
      diaSemana: 3,
      horaInicio: '08:00',
      horaFim: '10:00',
      vigenciaInicio: '2026-12-01',
      vigenciaFim: null,
      quantidade: 1,
      permiteExtra: true,
      ativo: true,
    },
  ];

  it('liga a visita ao turno, prefere o turno do tipo e marca o extra quando lota', () => {
    const base = { escalas, profissional: 10, dataLocal: '2026-12-01', horaLocal: '09:00' };
    expect(escalaDaVisita({ ...base, tipoChamado: 7, ocupadas: () => 0 })).toEqual({
      escala: 1,
      extra: false,
      problemas: [],
    });
    expect(escalaDaVisita({ ...base, tipoChamado: 5, ocupadas: () => 0 })).toMatchObject({
      escala: 2,
      extra: false,
    });
    expect(escalaDaVisita({ ...base, tipoChamado: 5, ocupadas: () => 1 })).toMatchObject({
      escala: 2,
      extra: true,
    });
  });

  it('recusa o turno lotado sem extra e deixa sem escala a visita fora da grade', () => {
    const base = { escalas, profissional: 10, dataLocal: '2026-12-01', tipoChamado: 7 };
    const lotado = escalaDaVisita({ ...base, horaLocal: '11:00', ocupadas: () => 2 });
    expect(lotado.escala).toBe(1);
    expect(campos(lotado.problemas)).toEqual(['quando']);
    expect(escalaDaVisita({ ...base, horaLocal: '12:00', ocupadas: () => 0 })).toEqual({
      escala: null,
      extra: false,
      problemas: [],
    });
    expect(
      escalaDaVisita({ ...base, dataLocal: '2026-11-24', horaLocal: '09:00', ocupadas: () => 0 }).escala,
    ).toBeNull(); // antes da vigência
  });

  it('monta a grade do dia com as vagas livres', () => {
    const g = gradeDoDia(escalas, '2026-12-01', (id) => (id === 1 ? 3 : 0));
    expect(g.map((x) => [x.id, x.ocupadas, x.livres])).toEqual([
      [1, 3, 0],
      [2, 0, 1],
    ]);
    expect(gradeDoDia(escalas, '2026-12-02', () => 0)).toEqual([]);
  });
});
