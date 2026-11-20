// Regra 4 do M45: reavaliação de Braden e Morse na admissão, diária e na mudança de quadro; os cuidados preventivos do
// paciente em risco são aceitos ou recusados com motivo.
import { describe, expect, it } from 'vitest';
import {
  chaveProgramada,
  conferirCuidados,
  cuidadosSugeridos,
  cumpridasPelaAvaliacao,
  programacaoPorMudancaDeQuadro,
  reavaliacoesDoPaciente,
  somarHoras,
  type ReavaliacaoGravada,
} from './reavaliacao.js';
import { REGRAS_PADRAO } from './regras.js';

const AGORA = '2026-10-25T10:00:00';
const base = { paciente: 1, intervaloHoras: 24, agora: AGORA, gravadas: [] as ReavaliacaoGravada[] };

describe('reavaliações calculadas', () => {
  it('sem avaliação na internação: a da admissão, vencida depois do intervalo', () => {
    const r = reavaliacoesDoPaciente({ ...base, internadoEm: '2026-10-24T08:00', avaliacoes: [] });
    expect(r.map((x) => [x.escala, x.motivo, x.vencida, x.calculada])).toEqual([
      ['braden', 'admissao', true, true],
      ['morse', 'admissao', true, true],
    ]);
    const nova = reavaliacoesDoPaciente({ ...base, internadoEm: '2026-10-25T08:00', avaliacoes: [] });
    expect(nova.every((x) => !x.vencida && x.prazoEm === '2026-10-26T08:00:00')).toBe(true);
  });
  it('com avaliação (escore ou formulário): a diária conta da última', () => {
    const r = reavaliacoesDoPaciente({
      ...base,
      internadoEm: '2026-10-20T08:00:00',
      avaliacoes: [
        { escala: 'braden', quando: '2026-10-24T09:00:00', origem: 'formulario' },
        { escala: 'braden', quando: '2026-10-24T11:00:00', origem: 'escore' },
        { escala: 'morse', quando: '2026-10-25T09:30', origem: 'escore' },
      ],
    });
    const braden = r.find((x) => x.escala === 'braden')!;
    expect(braden).toMatchObject({ motivo: 'diaria', devidaEm: '2026-10-25T11:00:00', vencida: false });
    const morse = r.find((x) => x.escala === 'morse')!;
    expect(morse).toMatchObject({ motivo: 'diaria', devidaEm: '2026-10-26T09:30:00' });
    // A avaliação de antes da internação não vale para esta internação: volta a da admissão.
    const outra = reavaliacoesDoPaciente({
      ...base,
      internadoEm: '2026-10-25T07:00:00',
      avaliacoes: [{ escala: 'braden', quando: '2026-10-20T07:00:00', origem: 'escore' }],
    });
    expect(outra.find((x) => x.escala === 'braden')?.motivo).toBe('admissao');
  });
  it('a programada (mudança de quadro) fica pendente até uma avaliação posterior; vencida passado o prazo', () => {
    const g: ReavaliacaoGravada = {
      id: 9,
      escala: 'morse',
      motivo: 'mudanca-quadro',
      devidaEm: '2026-10-25T06:00:00',
      prazoEm: '2026-10-25T09:00:00',
      situacao: 'pendente',
      cumpridaEm: null,
      cumpridaPor: null,
    };
    const pendente = reavaliacoesDoPaciente({ ...base, internadoEm: null, avaliacoes: [], gravadas: [g] });
    expect(pendente.find((x) => x.id === 9)).toMatchObject({ situacao: 'pendente', vencida: true });
    const cumprida = reavaliacoesDoPaciente({
      ...base,
      internadoEm: null,
      gravadas: [g],
      avaliacoes: [{ escala: 'morse', quando: '2026-10-25T07:00:00', origem: 'formulario' }],
    });
    expect(cumprida.find((x) => x.id === 9)).toMatchObject({
      situacao: 'cumprida',
      vencida: false,
      cumpridaPor: 'formulario',
    });
    // A admissão programada à mão substitui a calculada.
    const adm = reavaliacoesDoPaciente({
      ...base,
      internadoEm: '2026-10-25T07:00:00',
      avaliacoes: [],
      gravadas: [{ ...g, id: 10, escala: 'braden', motivo: 'admissao', prazoEm: '2026-10-25T19:00:00' }],
    });
    expect(adm.filter((x) => x.escala === 'braden')).toHaveLength(1);
    expect(cumpridasPelaAvaliacao([g], 'morse', '2026-10-25T07:00')).toEqual([9]);
    expect(cumpridasPelaAvaliacao([g], 'morse', '2026-10-25T05:00')).toEqual([]);
    expect(cumpridasPelaAvaliacao([g], 'braden', '2026-10-25T07:00')).toEqual([]);
  });
  it('NEWS2 de 5 ou mais programa Braden e Morse (mudança de quadro), no prazo de até 12 horas', () => {
    expect(programacaoPorMudancaDeQuadro(4, 1, AGORA, 24)).toEqual([]);
    const p = programacaoPorMudancaDeQuadro(5, 77, '2026-10-25T10:00', 24);
    expect(p.map((x) => [x.escala, x.chave, x.prazoEm])).toEqual([
      ['braden', 'quadro:news2:77', '2026-10-25T22:00:00'],
      ['morse', 'quadro:news2:77', '2026-10-25T22:00:00'],
    ]);
    expect(programacaoPorMudancaDeQuadro(7, 1, AGORA, 6)[0]?.prazoEm).toBe('2026-10-25T16:00:00');
    expect(chaveProgramada('mudanca-quadro', '2026-10-25T10:00:30')).toBe('mudanca-quadro:2026-10-25T10:00');
    expect(somarHoras('2026-12-31T23:30', 1)).toBe('2027-01-01T00:30:00');
  });
});

describe('cuidados preventivos (regra 4)', () => {
  const risco = REGRAS_PADRAO.braden.faixas.find((f) => f.codigo === 'alto')!;
  const semRisco = REGRAS_PADRAO.braden.faixas.find((f) => f.codigo === 'semRisco')!;
  it('só no risco de Braden e Morse', () => {
    expect(cuidadosSugeridos('braden', risco).length).toBe(5);
    expect(cuidadosSugeridos('braden', semRisco)).toEqual([]);
    expect(cuidadosSugeridos('glasgow', risco)).toEqual([]);
    expect(cuidadosSugeridos('morse', { ...risco, codigo: 'alto' }).map((c) => c.codigo)).toContain(
      'pulseiraRisco',
    );
  });
  it('cada sugerido decidido; a recusa com motivo; nada fora da lista', () => {
    const s = cuidadosSugeridos('braden', risco);
    const todos = s.map((c) => ({ codigo: c.codigo, decisao: 'aceito' as const }));
    expect(conferirCuidados(s, todos)).toMatchObject({ ok: true });
    expect(conferirCuidados(s, todos.slice(1))).toMatchObject({ ok: false, codigo: 'cuidado-sem-decisao' });
    expect(
      conferirCuidados(s, [...todos.slice(1), { codigo: todos[0]!.codigo, decisao: 'recusado' as const }]),
    ).toMatchObject({ ok: false, codigo: 'recusa-sem-motivo' });
    expect(
      conferirCuidados(s, [
        ...todos.slice(1),
        {
          codigo: todos[0]!.codigo,
          decisao: 'recusado' as const,
          motivo: 'Paciente já em colchão pneumático',
        },
      ]),
    ).toMatchObject({ ok: true });
    expect(conferirCuidados(s, [...todos, { codigo: 'outro', decisao: 'aceito' as const }])).toMatchObject({
      ok: false,
      codigo: 'cuidado-desconhecido',
    });
    expect(conferirCuidados([], [])).toMatchObject({ ok: true });
  });
});
