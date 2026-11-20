// Regra 2 do M51: SIGTAP da competência do atendimento, nunca a vigente hoje. Catálogo sintético.
import { describe, expect, it } from 'vitest';
import { ATRIBUTOS_LIVRES, procedimento } from './massa.spec-util.js';
import {
  atributosNaCompetencia,
  idadeEmMeses,
  idadeLegadoEmMeses,
  incompatibilidades,
  limiteIdade,
  procedimentoVigenteNaCompetencia,
  sexoSigtap,
  valorNaCompetencia,
} from './sigtap-competencia.js';

const p = procedimento(1, '0301010072', {
  competenciaInicial: 201001,
  competenciaFinal: 202512,
  atuais: { ...ATRIBUTOS_LIVRES, complexidade: 'atual' },
});
const h = (competencia: number, complexidade: string) => ({
  competencia,
  atributos: { ...ATRIBUTOS_LIVRES, complexidade },
});

describe('SIGTAP por competência (regra 2)', () => {
  it('vigência do procedimento pelas competências inicial e final (0 é sem limite)', () => {
    expect(procedimentoVigenteNaCompetencia(p, '200912')).toBe(false);
    expect(procedimentoVigenteNaCompetencia(p, '201001')).toBe(true);
    expect(procedimentoVigenteNaCompetencia(p, '202512')).toBe(true);
    expect(procedimentoVigenteNaCompetencia(p, '202601')).toBe(false);
    expect(procedimentoVigenteNaCompetencia(procedimento(2, 'x'), '209912')).toBe(true);
    expect(atributosNaCompetencia(p, [], '202601')).toBeNull();
  });

  it('sem retrato ou depois do último: vale o atual', () => {
    expect(atributosNaCompetencia(p, [], '202509')).toEqual({ fonte: 'atual', atributos: p.atuais });
    expect(atributosNaCompetencia(p, [h(201311, 'r1311'), h(0, 'zero')], '202509')?.fonte).toBe('atual');
  });

  it('até o último retrato: o maior retrato ≤ competência (mudança no meio da série)', () => {
    const hist = [h(201101, 'r1101'), h(201311, 'r1311'), h(201201, 'r1201')];
    expect(atributosNaCompetencia(p, hist, '201206')).toEqual({
      fonte: 'historico',
      atributos: hist[2]!.atributos,
    });
    expect(atributosNaCompetencia(p, hist, '201311')?.atributos.complexidade).toBe('r1311');
    expect(atributosNaCompetencia(p, hist, '201101')?.atributos.complexidade).toBe('r1101');
  });

  it('antes do primeiro retrato: o primeiro, marcado aproximado', () => {
    const hist = [h(201311, 'r1311'), h(201201, 'r1201')];
    expect(atributosNaCompetencia(p, hist, '201006')).toEqual({
      fonte: 'historico-aproximado',
      atributos: hist[1]!.atributos,
    });
  });

  it('valor vigente no primeiro dia da competência', () => {
    const v = (data: string, sh: number) => ({
      data,
      servicoHospitalar: sh,
      servicoProfissional: 0,
      sadt: 0,
      ambulatorial: 0,
    });
    const valores = [v('2025-01-01', 10), v('2025-09-01', 20), v('2025-09-15', 30), v('1899-12-30', 1)];
    expect(valorNaCompetencia(valores, '202508')?.servicoHospitalar).toBe(10);
    expect(valorNaCompetencia(valores, '202509')?.servicoHospitalar).toBe(20);
    expect(valorNaCompetencia(valores, '202510')?.servicoHospitalar).toBe(30);
    expect(valorNaCompetencia(valores, '202412')).toBeNull();
  });

  it('limites, sexo e idade em meses', () => {
    expect(limiteIdade(9999)).toBeNull();
    expect(limiteIdade(-1)).toBeNull();
    expect(limiteIdade(null)).toBeNull();
    expect(limiteIdade(120)).toBe(120);
    expect(idadeLegadoEmMeses(110)).toBe(1320);
    expect(idadeLegadoEmMeses(9999)).toBeNull();
    expect(sexoSigtap('f')).toBe('F');
    expect(sexoSigtap('I')).toBe('ambos');
    expect(sexoSigtap(null)).toBe('ambos');
    expect(idadeEmMeses('2000-05-10', '2025-05-09')).toBe(299);
    expect(idadeEmMeses('2000-05-10', '2025-05-10')).toBe(300);
    expect(idadeEmMeses('2025-05-10', '2025-01-01')).toBeNull();
    expect(idadeEmMeses('1899-12-30', '2025-01-01')).toBeNull();
    expect(idadeEmMeses('x', '2025-01-01')).toBeNull();
  });

  it('incompatibilidades de sexo, idade e quantidade', () => {
    const a = {
      ...ATRIBUTOS_LIVRES,
      sexo: 'F' as const,
      idadeMinimaMeses: 120,
      idadeMaximaMeses: 720,
      quantidadeMaxima: 1,
    };
    expect(incompatibilidades(a, { sexo: 'F', idadeMeses: 300 }, 1)).toEqual([]);
    expect(incompatibilidades(a, { sexo: 'M', idadeMeses: 100 }, 2)).toEqual([
      'sexo-incompativel',
      'idade-incompativel',
      'quantidade-acima-do-maximo',
    ]);
    expect(incompatibilidades(a, { sexo: null, idadeMeses: null }, 1)).toEqual([]);
    expect(incompatibilidades(a, { sexo: 'F', idadeMeses: 800 }, 1)).toEqual(['idade-incompativel']);
    expect(incompatibilidades(ATRIBUTOS_LIVRES, { sexo: 'M', idadeMeses: 1 }, 99)).toEqual([]);
  });
});
