// Conferência das incidências da rubrica contra os códigos do eSocial (M53, etapa F1). Rubricas sintéticas.
import { INCIDENCIAS_RUBRICA_FOLHA, type RubricaFolha } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  codigoEsocialEhBase,
  conferirIncidenciasRubrica,
  conferirRubricas,
  marcasTributoRubrica,
} from './incidencias.js';

function rubrica(extra: Partial<RubricaFolha> = {}): RubricaFolha {
  const incidencias = Object.fromEntries(
    INCIDENCIAS_RUBRICA_FOLHA.map((i) => [i, false]),
  ) as RubricaFolha['incidencias'];
  return {
    id: 1,
    empresa: 1,
    codigo: 1,
    descricao: 'Rubrica sintética',
    tipo: 'provento',
    referencia: 'valor',
    percentual: 0,
    prioridade: null,
    ativa: true,
    vigencia: { inicio: null, fim: null },
    usos: ['mensal'],
    incidencias,
    esocial: { inss: null, irrf: null, fgts: null, sindical: null },
    natureza: 1000,
    ...extra,
  };
}
const com = (r: RubricaFolha, i: Partial<RubricaFolha['incidencias']>): RubricaFolha => ({
  ...r,
  incidencias: { ...r.incidencias, ...i },
});

describe('código do eSocial é base?', () => {
  it('INSS', () => {
    expect(codigoEsocialEhBase('inss', '00')).toBe(false);
    expect(codigoEsocialEhBase('inss', '11')).toBe(true);
    expect(codigoEsocialEhBase('inss', '26')).toBe(true);
    expect(codigoEsocialEhBase('inss', '31')).toBe(false);
    expect(codigoEsocialEhBase('inss', '51')).toBe(false);
    expect(codigoEsocialEhBase('inss', '92')).toBe(true);
    expect(codigoEsocialEhBase('inss', '77')).toBeNull();
  });
  it('IRRF, FGTS e sindical', () => {
    expect(codigoEsocialEhBase('irrf', '09')).toBe(false);
    expect(codigoEsocialEhBase('irrf', '13')).toBe(true);
    expect(codigoEsocialEhBase('irrf', '41')).toBe(false);
    expect(codigoEsocialEhBase('irrf', '20')).toBeNull();
    expect(codigoEsocialEhBase('fgts', '00')).toBe(false);
    expect(codigoEsocialEhBase('fgts', '21')).toBe(true);
    expect(codigoEsocialEhBase('fgts', '92')).toBe(true);
    expect(codigoEsocialEhBase('fgts', '50')).toBeNull();
    expect(codigoEsocialEhBase('sindical', '11')).toBe(true);
    expect(codigoEsocialEhBase('sindical', '31')).toBe(false);
    expect(codigoEsocialEhBase('sindical', '20')).toBeNull();
  });
  it('código que não é número fica fora dos grupos', () => {
    expect(codigoEsocialEhBase('inss', 'x1')).toBeNull();
    expect(codigoEsocialEhBase('inss', ' 11 ')).toBe(true);
  });
});

describe('conferência da rubrica', () => {
  it('letra e código coerentes: nada a acusar', () => {
    const r = com(rubrica({ esocial: { inss: '11', irrf: '11', fgts: '11', sindical: '00' } }), {
      inss: true,
      irrf: true,
      fgts: true,
    });
    expect(conferirIncidenciasRubrica(r)).toEqual([]);
  });
  it('incide sem base no eSocial, e base no eSocial sem incidência', () => {
    const r = com(rubrica({ esocial: { inss: '00', irrf: '11', fgts: null, sindical: null } }), {
      inss: true,
    });
    expect(conferirIncidenciasRubrica(r)).toEqual([
      { rubrica: 1, codigo: 'incide-sem-base-esocial', tributo: 'inss' },
      { rubrica: 1, codigo: 'base-esocial-sem-incidencia', tributo: 'irrf' },
    ]);
  });
  it('incide e não tem código (menos sindical); base de cálculo e informativa não pedem código', () => {
    const r = com(rubrica(), { inss: true, contribuicaoSindical: true });
    expect(conferirIncidenciasRubrica(r)).toEqual([
      { rubrica: 1, codigo: 'sem-codigo-esocial', tributo: 'inss' },
    ]);
    expect(conferirIncidenciasRubrica({ ...r, tipo: 'base', natureza: null })).toEqual([]);
    expect(conferirIncidenciasRubrica({ ...r, tipo: 'informativa', natureza: null })).toEqual([]);
  });
  it('o desconto do próprio tributo (contribuição descontada) não acusa "incide sem base"', () => {
    const r = com(
      rubrica({ tipo: 'desconto', esocial: { inss: '31', irrf: null, fgts: null, sindical: null } }),
      {
        inss: true,
      },
    );
    expect(conferirIncidenciasRubrica(r)).toEqual([]);
  });
  it('código fora dos grupos conhecidos não acusa', () => {
    const r = com(rubrica({ esocial: { inss: '77', irrf: null, fgts: null, sindical: null } }), {
      inss: true,
    });
    expect(conferirIncidenciasRubrica(r)).toEqual([]);
  });
  it('ativa sem natureza do eSocial e vigência invertida', () => {
    const r = rubrica({ natureza: null, vigencia: { inicio: '2025-06-01', fim: '2025-01-01' } });
    expect(conferirIncidenciasRubrica(r).map((x) => x.codigo)).toEqual([
      'sem-natureza-esocial',
      'vigencia-invertida',
    ]);
    expect(conferirIncidenciasRubrica({ ...r, ativa: false, vigencia: { inicio: null, fim: null } })).toEqual(
      [],
    );
  });
  it('conferirRubricas junta na ordem das rubricas', () => {
    const a = rubrica({ id: 7, natureza: null });
    const b = com(rubrica({ id: 8 }), { fgts: true });
    expect(conferirRubricas([a, b]).map((x) => [x.rubrica, x.codigo])).toEqual([
      [7, 'sem-natureza-esocial'],
      [8, 'sem-codigo-esocial'],
    ]);
  });
});

describe('marcas de tributo da rubrica pelo código do eSocial', () => {
  const sem = { inss: null, irrf: null, fgts: null, sindical: null, pis: null };
  it('base mensal: INSS 11, IRRF 11, FGTS 11; usada nas férias, o INSS das férias também', () => {
    const m = marcasTributoRubrica({ ...sem, inss: '11', irrf: '11', fgts: '11' }, { ferias: true });
    expect(m).toMatchObject({
      inss: true,
      irrf: true,
      fgts: true,
      inss13: false,
      irrf13: false,
      fgts13: false,
      inssFerias: true,
      irrfFerias: false,
    });
  });
  it('IRRF 09 e 31 em diante não são base de nada; INSS 31 e 51 também não', () => {
    for (const c of ['09', '31', '41', '51', '63', '79']) {
      const m = marcasTributoRubrica({ ...sem, irrf: c }, { ferias: true });
      expect([c, m.irrf, m.irrf13, m.irrfFerias]).toEqual([c, false, false, false]);
    }
    for (const c of ['31', '35', '51']) {
      const m = marcasTributoRubrica({ ...sem, inss: c }, { ferias: true });
      expect([c, m.inss, m.inss13, m.inssFerias]).toEqual([c, false, false, false]);
    }
  });
  it('12 é a base do 13º (não a mensal) nos três tributos; INSS 14 é 13º do empregador; IRRF 14 (PLR) não é 13º', () => {
    const m = marcasTributoRubrica({ ...sem, inss: '12', irrf: '12', fgts: '12' }, { ferias: false });
    expect(m).toMatchObject({
      inss: false,
      irrf: false,
      fgts: false,
      inss13: true,
      irrf13: true,
      fgts13: true,
    });
    expect(marcasTributoRubrica({ ...sem, inss: '14' }, { ferias: false })).toMatchObject({
      inss: false,
      inss13: true,
    });
    expect(marcasTributoRubrica({ ...sem, irrf: '14' }, { ferias: false })).toMatchObject({
      irrf: false,
      irrf13: false,
      irrfFerias: false,
    });
  });
  it('IRRF 13 é a base das férias; FGTS 21 (aviso indenizado) é mensal; PIS e sindical pelo código', () => {
    expect(marcasTributoRubrica({ ...sem, irrf: '13' }, { ferias: true })).toMatchObject({
      irrf: false,
      irrfFerias: true,
    });
    expect(marcasTributoRubrica({ ...sem, fgts: '21' }, { ferias: false })).toMatchObject({
      fgts: true,
      fgts13: false,
    });
    expect(marcasTributoRubrica({ ...sem, pis: '11', sindical: '11' }, { ferias: false })).toMatchObject({
      pis: true,
      contribuicaoSindical: true,
    });
    expect(marcasTributoRubrica({ ...sem, pis: '00', sindical: '31' }, { ferias: false })).toMatchObject({
      pis: false,
      contribuicaoSindical: false,
    });
  });
  it('sem código ou com código desconhecido: nenhuma marca', () => {
    expect(Object.values(marcasTributoRubrica(sem, { ferias: true })).every((x) => x === false)).toBe(true);
    expect(
      Object.values(marcasTributoRubrica({ ...sem, inss: '77', irrf: 'X' }, { ferias: true })).every(
        (x) => x === false,
      ),
    ).toBe(true);
  });
});
