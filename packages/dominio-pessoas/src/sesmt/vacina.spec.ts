// Regra 17 (vacinas; NR-32 32.2.4.17): lote vencido recusado, esquema da hepatite B e da dupla adulto, anti-HBs
// pendente ou abaixo de 10 mUI/mL, reforço de 10 anos, só inclusão.
import { describe, expect, it } from 'vitest';
import { DOSES_VACINA_SESMT, VACINAS_SESMT } from '@sgh/contratos';
import {
  codigoNoDominio,
  conferirVacina,
  type RegistroVacinaLido,
  situacaoVacinas,
  vacinasEmVigor,
} from './vacina.js';

const dose = (
  id: number,
  vacina: string,
  d: RegistroVacinaLido['dose'],
  data: string,
  extra: Partial<RegistroVacinaLido> = {},
): RegistroVacinaLido => ({
  id,
  registro: 'dose',
  vacina,
  dose: d,
  data,
  antiHbs: null,
  retifica: null,
  ...extra,
});
const anti = (id: number, data: string, valor: number): RegistroVacinaLido => ({
  id,
  registro: 'anti-hbs',
  vacina: 'hepatite-b',
  dose: null,
  data,
  antiHbs: valor,
  retifica: null,
});
const HOJE = '2026-10-26';
const situacao = (rs: RegistroVacinaLido[], v: string) =>
  situacaoVacinas(rs, HOJE).find((s) => s.vacina === v)!;

describe('conferência da vacina', () => {
  const e = {
    registro: 'dose' as const,
    vacina: 'hepatite-b' as const,
    dose: '1' as const,
    data: '2026-10-01',
    validadeLote: '2027-01-01',
    antiHbs: null,
  };
  it('passa; data futura e lote vencido na aplicação recusados', () => {
    expect(conferirVacina(e, HOJE, [])).toBeNull();
    expect(conferirVacina({ ...e, data: '2026-10-27' }, HOJE, [])?.codigo).toBe('data-futura');
    expect(conferirVacina({ ...e, validadeLote: '2026-09-30' }, HOJE, [])?.codigo).toBe('lote-vencido');
    expect(conferirVacina({ ...e, validadeLote: null }, HOJE, [])?.codigo).toBe('lote-vencido');
    expect(conferirVacina({ ...e, dose: null }, HOJE, [])?.codigo).toBe('dose-ausente');
  });
  it('dose além do esquema e dose repetida recusadas (a retificação passa)', () => {
    expect(conferirVacina({ ...e, vacina: 'triplice-viral', dose: '3' }, HOJE, [])?.codigo).toBe(
      'dose-alem-do-esquema',
    );
    const ja = [dose(5, 'hepatite-b', '1', '2026-09-01')];
    expect(conferirVacina(e, HOJE, ja)?.codigo).toBe('dose-repetida');
    expect(conferirVacina(e, HOJE, ja, 5)).toBeNull();
    expect(conferirVacina({ ...e, dose: 'reforco' }, HOJE, ja)).toBeNull();
  });
  it('anti-HBs só da hepatite B e com valor', () => {
    const a = { ...e, registro: 'anti-hbs' as const, dose: null, validadeLote: null, antiHbs: 12 };
    expect(conferirVacina(a, HOJE, [])).toBeNull();
    expect(conferirVacina({ ...a, vacina: 'dupla-adulto' }, HOJE, [])?.codigo).toBe('anti-hbs-outra-vacina');
    expect(conferirVacina({ ...a, antiHbs: null }, HOJE, [])?.codigo).toBe('anti-hbs-sem-valor');
  });
});

describe('situação e pendências NR-32', () => {
  it('hepatite B: incompleta, anti-HBs pendente, abaixo do protetor, imune', () => {
    const d3 = [dose(1, 'hepatite-b', '1', '2026-01-01'), dose(2, 'hepatite-b', '2', '2026-02-01')];
    expect(situacao(d3, 'hepatite-b').pendencias).toEqual(['hepatite-b-incompleta']);
    const completo = [...d3, dose(3, 'hepatite-b', '3', '2026-07-01')];
    expect(situacao(completo, 'hepatite-b').pendencias).toEqual(['anti-hbs-pendente']);
    // O anti-HBs anterior à última dose não conta.
    expect(situacao([...completo, anti(4, '2026-06-01', 50)], 'hepatite-b').pendencias).toEqual([
      'anti-hbs-pendente',
    ]);
    expect(situacao([...completo, anti(4, '2026-08-01', 8)], 'hepatite-b').pendencias).toEqual([
      'anti-hbs-nao-protetor',
    ]);
    const imune = situacao([...completo, anti(4, '2026-08-01', 120)], 'hepatite-b');
    expect([imune.completo, imune.antiHbs, imune.pendencias]).toEqual([true, 120, []]);
  });
  it('dupla adulto: incompleta, reforço de 10 anos vencido, em dia', () => {
    const tres = [
      dose(1, 'dupla-adulto', '1', '2010-01-01'),
      dose(2, 'dupla-adulto', '2', '2010-03-01'),
      dose(3, 'dupla-adulto', '3', '2010-09-01'),
    ];
    expect(situacao(tres.slice(0, 2), 'dupla-adulto').pendencias).toEqual(['dupla-incompleta']);
    const s = situacao(tres, 'dupla-adulto');
    expect([s.reforcoAte, s.pendencias]).toEqual(['2020-09-01', ['dupla-reforco']]);
    expect(
      situacao([...tres, dose(4, 'dupla-adulto', 'reforco', '2021-05-01')], 'dupla-adulto').pendencias,
    ).toEqual([]);
  });
  it('vacinas sem esquema fixo e dose única; as demais não geram pendência', () => {
    expect(situacao([dose(1, 'influenza', 'unica', '2026-04-01')], 'influenza').completo).toBe(true);
    expect(situacao([dose(1, 'febre-amarela', 'unica', '2020-04-01')], 'febre-amarela').completo).toBe(true);
    expect(situacao([], 'varicela').pendencias).toEqual([]);
  });
  it('o retificado sai da conta', () => {
    const rs = [
      dose(1, 'hepatite-b', '1', '2026-01-01'),
      dose(2, 'hepatite-b', '1', '2026-01-02', { retifica: 1 }),
    ];
    expect(vacinasEmVigor(rs).map((r) => r.id)).toEqual([2]);
    expect(situacao(rs, 'hepatite-b').doses).toBe(1);
  });
});

describe('D-VAC-525: o código do domínio de vacinas e de doses pela descrição lida', () => {
  const vacinas = [
    { codigo: 4, rotulo: 'Anti-sarampo' },
    { codigo: 6, rotulo: 'Dupla adulto' },
    { codigo: 7, rotulo: 'Outras' },
    { codigo: 9, rotulo: 'Hepatite B (recombinante)' },
  ];
  const doses = [
    { codigo: 1, rotulo: '1ª dose' },
    { codigo: 2, rotulo: '2º Dose' },
    { codigo: 3, rotulo: 'Terceira dose' },
  ];
  it('casa pela descrição, sem acento e sem pontuação', () => {
    expect(codigoNoDominio(vacinas, VACINAS_SESMT['hepatite-b'].termos)).toBe(9);
    expect(codigoNoDominio(vacinas, VACINAS_SESMT['dupla-adulto'].termos)).toBe(6);
    expect(codigoNoDominio(vacinas, VACINAS_SESMT['triplice-viral'].termos)).toBe(4);
    expect(codigoNoDominio(doses, DOSES_VACINA_SESMT['1'].termos)).toBe(1);
    expect(codigoNoDominio(doses, DOSES_VACINA_SESMT['2'].termos)).toBe(2);
    expect(codigoNoDominio(doses, DOSES_VACINA_SESMT['3'].termos)).toBe(3);
  });
  it('sem casamento ou com casamento ambíguo o código fica vazio (nunca "outras")', () => {
    expect(codigoNoDominio(vacinas, VACINAS_SESMT.influenza.termos)).toBeNull();
    expect(codigoNoDominio(doses, DOSES_VACINA_SESMT.reforco.termos)).toBeNull();
    expect(
      codigoNoDominio(
        [...vacinas, { codigo: 10, rotulo: 'Hepatite B - reforço' }],
        VACINAS_SESMT['hepatite-b'].termos,
      ),
    ).toBeNull();
    expect(codigoNoDominio([], VACINAS_SESMT['hepatite-b'].termos)).toBeNull();
  });
});
