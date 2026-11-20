// Regra 17 (NR32-01; NR-7): ASO admissional, periódico, retorno, mudança de função, monitoração e demissional; apto ou
// inapto; o próximo exame pela periodicidade; o alerta de ASO vencido e a vencer; só inclusão (a retificação).
import { CONCLUSAO_APTO, CONCLUSAO_INAPTO, naturezaAso } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { type AsoLido, asosEmVigor, conferirAso, proximoAso, situacaoAso, somarMeses } from './aso.js';
import { pendenciasDoAso } from './pendencias.js';

const aso = (
  id: number,
  tipo: number,
  data: string,
  proximo: string | null,
  extra: Partial<AsoLido> = {},
): AsoLido => ({
  id,
  tipo,
  data,
  conclusao: CONCLUSAO_APTO,
  proximo,
  retifica: null,
  ...extra,
});
const base = {
  tipo: 1,
  data: '2026-10-20',
  conclusao: CONCLUSAO_APTO,
  restricoes: null,
  proximo: null,
  exames: [] as { data: string }[],
};
const ctx = {
  hoje: '2026-10-26',
  admissao: '2025-01-10',
  desligamento: null,
  anteriores: [aso(1, 0, '2025-01-05', '2026-01-05')],
  retifica: null,
};

describe('natureza do ASO pelo domínio de tipos', () => {
  it('os 6 códigos do pc (o demissional é 8; o 9 do eSocial também vale) e o desconhecido', () => {
    expect([0, 1, 2, 3, 4, 8, 9, 7].map(naturezaAso)).toEqual([
      'admissional',
      'periodico',
      'retorno',
      'mudanca-funcao',
      'monitoracao',
      'demissional',
      'demissional',
      'outro',
    ]);
  });
});

describe('próximo exame e soma de meses', () => {
  it('12 meses por padrão; o fim de mês vira o último dia do mês de destino', () => {
    expect(proximoAso('2026-01-31', 'periodico')).toBe('2027-01-31');
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(somarMeses('2024-01-31', 1)).toBe('2024-02-29');
    expect(somarMeses('2026-11-15', 2)).toBe('2027-01-15');
  });
  it('o demissional não tem próximo; o informado vale se não passar da periodicidade', () => {
    expect(proximoAso('2026-10-20', 'demissional')).toBeNull();
    expect(proximoAso('2026-10-20', 'periodico', 12, '2027-04-20')).toBe('2027-04-20');
    expect(proximoAso('2026-10-20', 'periodico', 12, '2028-01-01')).toBe('2027-10-20');
    expect(proximoAso('2026-10-20', 'periodico', 6)).toBe('2027-04-20');
  });
});

describe('conferência do ASO (regra 17)', () => {
  it('periódico depois do admissional passa', () => {
    expect(conferirAso(base, ctx)).toBeNull();
  });
  it('data futura recusada', () => {
    expect(conferirAso({ ...base, data: '2026-10-27' }, ctx)?.codigo).toBe('aso-futuro');
  });
  it('exame de mais de 90 dias antes da admissão recusado (vínculo errado)', () => {
    expect(conferirAso({ ...base, tipo: 0, data: '2024-09-01' }, { ...ctx, anteriores: [] })?.codigo).toBe(
      'aso-antes-admissao',
    );
  });
  it('o primeiro ASO tem de ser o admissional, e só um admissional por vínculo', () => {
    expect(conferirAso(base, { ...ctx, anteriores: [] })?.codigo).toBe('sem-admissional');
    expect(conferirAso({ ...base, tipo: 0 }, ctx)?.codigo).toBe('admissional-repetido');
    // A retificação do próprio admissional passa.
    expect(conferirAso({ ...base, tipo: 0, data: '2025-01-06' }, { ...ctx, retifica: 1 })).toBeNull();
  });
  it('inapto sem a orientação do médico recusado; com ela, passa', () => {
    expect(conferirAso({ ...base, conclusao: CONCLUSAO_INAPTO }, ctx)?.codigo).toBe('inapto-sem-motivo');
    expect(
      conferirAso({ ...base, conclusao: CONCLUSAO_INAPTO, restricoes: 'Afastar de área com ruído.' }, ctx),
    ).toBeNull();
  });
  it('demissional sem próximo; próximo depois da data; exame complementar até a data do ASO', () => {
    expect(conferirAso({ ...base, tipo: 8, proximo: '2027-10-20' }, ctx)?.codigo).toBe(
      'demissional-com-proximo',
    );
    expect(conferirAso({ ...base, proximo: '2026-10-20' }, ctx)?.codigo).toBe('proximo-antes');
    expect(conferirAso({ ...base, exames: [{ data: '2026-10-21' }] }, ctx)?.codigo).toBe(
      'exame-depois-do-aso',
    );
    expect(conferirAso({ ...base, exames: [{ data: '2026-10-01' }] }, ctx)).toBeNull();
  });
  it('vínculo desligado só recebe o demissional depois do desligamento', () => {
    const d = { ...ctx, desligamento: '2026-10-10' };
    expect(conferirAso(base, d)?.codigo).toBe('vinculo-desligado');
    expect(conferirAso({ ...base, tipo: 8 }, d)).toBeNull();
  });
});

describe('situação do ASO e o alerta (regra 17)', () => {
  it('sem ASO, válido, a vencer na janela de 30 dias, vencido', () => {
    expect(situacaoAso([], '2026-10-26').situacao).toBe('sem-aso');
    expect(situacaoAso([aso(1, 0, '2026-01-05', '2027-01-05')], '2026-10-26').situacao).toBe('valido');
    const aVencer = situacaoAso([aso(1, 0, '2025-11-10', '2026-11-10')], '2026-10-26');
    expect([aVencer.situacao, aVencer.diasParaVencer]).toEqual(['a-vencer', 15]);
    const vencido = situacaoAso([aso(1, 0, '2025-01-05', '2026-01-05')], '2026-10-26');
    expect([vencido.situacao, vencido.diasParaVencer]).toEqual(['vencido', -294]);
  });
  it('o demissional encerra o acompanhamento', () => {
    expect(
      situacaoAso([aso(2, 8, '2026-10-01', null), aso(1, 0, '2025-01-05', '2026-01-05')], '2026-10-26')
        .situacao,
    ).toBe('encerrado');
  });
  it('o retificado sai da conta; o que retifica vale', () => {
    const asos = [
      aso(1, 0, '2025-01-05', '2026-01-05'),
      aso(3, 0, '2025-01-06', '2027-01-06', { retifica: 1 }),
    ];
    expect(asosEmVigor(asos).map((a) => a.id)).toEqual([3]);
    expect(situacaoAso(asos, '2026-10-26').situacao).toBe('valido');
  });
  it('mesma data: o registro mais novo primeiro', () => {
    expect(
      asosEmVigor([aso(1, 0, '2025-01-05', null), aso(2, 1, '2025-01-05', null)]).map((a) => a.id),
    ).toEqual([2, 1]);
  });
  it('as pendências do ASO: sem ASO, vencido, a vencer, inapto; desligado não tem pendência', () => {
    expect(pendenciasDoAso(situacaoAso([], '2026-10-26'), true)).toEqual(['sem-aso']);
    const inaptoVencido = situacaoAso(
      [aso(1, 0, '2025-01-05', '2026-01-05', { conclusao: CONCLUSAO_INAPTO })],
      '2026-10-26',
    );
    expect(pendenciasDoAso(inaptoVencido, true)).toEqual(['aso-vencido', 'inapto']);
    expect(pendenciasDoAso(situacaoAso([aso(1, 0, '2025-11-10', '2026-11-10')], '2026-10-26'), true)).toEqual(
      ['aso-a-vencer'],
    );
    expect(pendenciasDoAso(situacaoAso([], '2026-10-26'), false)).toEqual([]);
  });
});
