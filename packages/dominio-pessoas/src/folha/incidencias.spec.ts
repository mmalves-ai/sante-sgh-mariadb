// Conferência das incidências da rubrica contra os códigos do eSocial (M53, etapa F1). Rubricas sintéticas.
import { INCIDENCIAS_RUBRICA_FOLHA, type RubricaFolha } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { codigoEsocialEhBase, conferirIncidenciasRubrica, conferirRubricas } from './incidencias.js';

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
