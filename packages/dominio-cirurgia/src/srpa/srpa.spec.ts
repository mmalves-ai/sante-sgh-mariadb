// M46 (etapa 1), regra 4: SRPA — Aldrete-Kroulik na admissão, a cada 15 minutos e na alta; alta só pela regra
// versionada. Dados sintéticos.
import { REGRA_ALTA_SRPA_V1 } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  algumItemZero,
  avaliacaoVencida,
  buracosDaSerie,
  conferirAvaliacao,
  impedimentosDaAlta,
  proximaAvaliacaoAte,
  totalAldrete,
  type AvaliacaoSrpa,
  type PedidoDeAlta,
} from './srpa.js';

const t = (hhmm: string) => `2026-10-24T${hhmm}`;
const plena = { atividade: 2, respiracao: 2, circulacao: 2, consciencia: 2, saturacao: 2 };
const av = (
  momento: AvaliacaoSrpa['momento'],
  hhmm: string,
  extra: Partial<AvaliacaoSrpa> = {},
): AvaliacaoSrpa => ({
  momento,
  em: t(hhmm),
  aldrete: { ...plena, atividade: 1 },
  dor: 2,
  nvpo: 0,
  ...extra,
});
const serie = [av('admissao', '11:00'), av('avaliacao', '11:15'), av('avaliacao', '11:30')];
const alta = (hhmm: string, extra: Partial<PedidoDeAlta> = {}): PedidoDeAlta => ({
  em: t(hhmm),
  aldrete: plena,
  dor: 1,
  nvpo: 0,
  destino: 'unidade',
  motivoDestino: null,
  ...extra,
});

describe('índice de Aldrete-Kroulik', () => {
  it('soma de 0 a 10 e item zerado', () => {
    expect(totalAldrete(plena)).toBe(10);
    expect(totalAldrete({ ...plena, consciencia: 0, saturacao: 1 })).toBe(7);
    expect(algumItemZero(plena)).toBe(false);
    expect(algumItemZero({ ...plena, respiracao: 0 })).toBe(true);
  });
});

describe('série de avaliações', () => {
  it('admissão primeiro, uma só, em ordem e nada depois da alta', () => {
    expect(conferirAvaliacao([], { momento: 'admissao', em: t('11:00') })).toEqual({ ok: true });
    expect(conferirAvaliacao([], { momento: 'avaliacao', em: t('11:00') })).toEqual({
      ok: false,
      codigo: 'srpa-sem-admissao',
    });
    expect(conferirAvaliacao(serie, { momento: 'admissao', em: t('11:40') })).toMatchObject({
      codigo: 'srpa-fora-de-ordem',
    });
    expect(conferirAvaliacao(serie, { momento: 'avaliacao', em: t('11:20') })).toMatchObject({
      codigo: 'srpa-fora-de-ordem',
    });
    expect(
      conferirAvaliacao([...serie, av('alta', '11:45')], { momento: 'avaliacao', em: t('12:00') }),
    ).toMatchObject({ codigo: 'srpa-ja-com-alta' });
  });
  it('a próxima vence 15 minutos depois da última; buracos acima de 15 minutos', () => {
    expect(proximaAvaliacaoAte([])).toBeNull();
    expect(proximaAvaliacaoAte(serie)).toBe(t('11:45'));
    expect(proximaAvaliacaoAte([...serie, av('alta', '11:40')])).toBeNull();
    expect(avaliacaoVencida(serie, t('11:45'))).toBe(false);
    expect(avaliacaoVencida(serie, t('11:46'))).toBe(true);
    expect(avaliacaoVencida([], t('11:46'))).toBe(false);
    expect(buracosDaSerie(serie)).toBe(0);
    expect(buracosDaSerie([av('admissao', '11:00'), av('avaliacao', '11:20')])).toBe(1);
  });
});

describe('alta pela regra versionada (v1)', () => {
  it('índice 10, dor 1, sem vômito, 40 minutos: pode', () => {
    expect(impedimentosDaAlta(serie, alta('11:40'))).toEqual([]);
  });
  it('cada critério da regra impede a alta', () => {
    expect(
      impedimentosDaAlta(
        [av('admissao', '11:00'), av('avaliacao', '11:10')],
        alta('11:20', { aldrete: { ...plena, atividade: 0, consciencia: 1 }, dor: 5, nvpo: 2 }),
      ),
    ).toEqual([
      'srpa-indice-insuficiente',
      'srpa-item-zero',
      'srpa-dor-alta',
      'srpa-vomito',
      'srpa-permanencia-curta',
    ]);
    expect(impedimentosDaAlta(serie, alta('12:00'))).toEqual(['srpa-avaliacao-vencida']);
  });
  it('UTI dispensa o índice, mas exige o motivo; sem admissão ou já com alta, o motivo da ordem', () => {
    const ruim = { aldrete: { ...plena, respiracao: 0 }, dor: 8, destino: 'uti' as const };
    expect(impedimentosDaAlta(serie, alta('11:40', { ...ruim, motivoDestino: null }))).toEqual([
      'srpa-motivo-obrigatorio',
    ]);
    expect(
      impedimentosDaAlta(serie, alta('11:40', { ...ruim, motivoDestino: 'Instabilidade hemodinâmica' })),
    ).toEqual([]);
    expect(impedimentosDaAlta([], alta('11:40'))).toEqual(['srpa-sem-admissao']);
    expect(impedimentosDaAlta([...serie, av('alta', '11:40')], alta('11:50'))).toEqual(['srpa-ja-com-alta']);
  });
  it('outra versão da regra muda o resultado sem mudar o código', () => {
    const v2 = {
      ...REGRA_ALTA_SRPA_V1,
      versao: 2,
      aldreteMinimo: 8,
      nenhumItemZero: false,
      permanenciaMinimaMin: 0,
    };
    const a = alta('11:20', { aldrete: { ...plena, atividade: 0 } });
    const curta = [av('admissao', '11:00'), av('avaliacao', '11:10')];
    expect(impedimentosDaAlta(curta, a)).toContain('srpa-indice-insuficiente');
    expect(impedimentosDaAlta(curta, a, v2)).toEqual([]);
  });
});
