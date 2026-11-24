import { describe, expect, it } from 'vitest';
import {
  avaliarAnaliseCultura,
  type CondutaCultura,
  type CulturaParaAnalise,
  type EntradaAnaliseCultura,
  laudoRetificadoDepois,
  MENSAGENS_ANALISE_CULTURA,
  MENSAGENS_PENDENCIA_CULTURA,
  pendenciasDaAnalise,
} from './analise-cultura.js';

const cultura = (o: Partial<CulturaParaAnalise> = {}): CulturaParaAnalise => ({
  crescimento: 'com_crescimento',
  situacao: 'final',
  isolados: [{ id: 10, multirresistente: false }],
  ...o,
});
const entrada = (o: Partial<EntradaAnaliseCultura> = {}): EntradaAnaliseCultura => ({
  classificacao: 'colonizacao',
  isolado: null,
  conduta: 1,
  condutaDescricao: null,
  precaucaoIndicada: false,
  prescritorOrientado: false,
  casoInfeccao: null,
  ...o,
});
const conduta = (o: Partial<CondutaCultura> = {}): CondutaCultura => ({
  id: 1,
  ativo: true,
  classificacaoAplicavel: null,
  abreCaso: false,
  indicaPrecaucao: false,
  exigeResposta: false,
  ...o,
});
const recusa = (r: ReturnType<typeof avaliarAnaliseCultura>) => (r.ok ? null : r.recusa);

describe('análise da cultura positiva', () => {
  it('recusa a classificação fora do vocabulário e a cultura sem crescimento', () => {
    expect(recusa(avaliarAnaliseCultura(entrada({ classificacao: 'outra' }), cultura(), conduta()))).toBe(
      'classificacao-invalida',
    );
    expect(
      recusa(avaliarAnaliseCultura(entrada(), cultura({ crescimento: 'sem_crescimento' }), conduta())),
    ).toBe('cultura-sem-crescimento');
  });

  it('assume o único germe e exige a escolha quando há mais de um', () => {
    const r = avaliarAnaliseCultura(entrada(), cultura(), conduta());
    expect(r.ok && r.analise.isolado).toBe(10);
    const dois = cultura({
      isolados: [
        { id: 10, multirresistente: false },
        { id: 11, multirresistente: false },
      ],
    });
    expect(recusa(avaliarAnaliseCultura(entrada(), dois, conduta()))).toBe('isolado-obrigatorio');
    expect(recusa(avaliarAnaliseCultura(entrada({ isolado: 99 }), dois, conduta()))).toBe(
      'isolado-de-outra-cultura',
    );
  });

  it('confere a conduta: ativa, da classificação, com descrição quando não há cadastro, prescritor orientado', () => {
    expect(recusa(avaliarAnaliseCultura(entrada(), cultura(), conduta({ ativo: false })))).toBe(
      'conduta-inativa',
    );
    expect(
      recusa(avaliarAnaliseCultura(entrada(), cultura(), conduta({ classificacaoAplicavel: 'infeccao' }))),
    ).toBe('conduta-de-outra-classificacao');
    expect(recusa(avaliarAnaliseCultura(entrada({ conduta: null }), cultura(), null))).toBe(
      'conduta-sem-descricao',
    );
    expect(
      avaliarAnaliseCultura(entrada({ conduta: null, condutaDescricao: 'Descartada' }), cultura(), null).ok,
    ).toBe(true);
    expect(recusa(avaliarAnaliseCultura(entrada(), cultura(), conduta({ exigeResposta: true })))).toBe(
      'prescritor-nao-orientado',
    );
    expect(recusa(avaliarAnaliseCultura(entrada({ casoInfeccao: 5 }), cultura(), conduta()))).toBe(
      'caso-so-em-infeccao',
    );
    for (const m of Object.values(MENSAGENS_ANALISE_CULTURA)) expect(m.length).toBeGreaterThan(10);
  });

  it('herda a precaução da conduta e do germe multirresistente e aponta a ficha de IRAS a abrir', () => {
    const mr = cultura({ isolados: [{ id: 10, multirresistente: true }], situacao: 'retificado' });
    const r = avaliarAnaliseCultura(entrada({ classificacao: 'infeccao' }), mr, conduta({ abreCaso: true }));
    expect(r.ok && r.analise).toEqual({
      classificacao: 'infeccao',
      isolado: 10,
      precaucaoIndicada: true,
      prescritorOrientado: false,
      pendencias: ['abrir-ficha-iras', 'aplicar-precaucao'],
    });
    const contaminada = avaliarAnaliseCultura(entrada({ classificacao: 'contaminacao' }), mr, conduta());
    expect(contaminada.ok && contaminada.analise.precaucaoIndicada).toBe(false);
    const comCaso = avaliarAnaliseCultura(
      entrada({ classificacao: 'infeccao', casoInfeccao: 7 }),
      cultura(),
      conduta({ indicaPrecaucao: true }),
    );
    expect(comCaso.ok && comCaso.analise.pendencias).toEqual(['aplicar-precaucao']);
  });

  it('o laudo retificado na hora da análise não marca nada; a precaução ativa do paciente fecha a pendência', () => {
    const r = avaliarAnaliseCultura(
      entrada({ classificacao: 'colonizacao', precaucaoIndicada: true }),
      cultura({ situacao: 'retificado' }),
      conduta(),
      { precaucaoAtiva: true },
    );
    expect(r.ok && r.analise.pendencias).toEqual([]);
  });

  it('recalcula as pendências na leitura: ficha de IRAS, precaução e laudo retificado depois', () => {
    const base = {
      classificacao: 'infeccao' as const,
      casoInfeccao: null,
      condutaAbreCaso: null,
      precaucaoIndicada: true,
      precaucaoAtiva: false,
      laudoMudouDepois: true,
    };
    expect(pendenciasDaAnalise(base)).toEqual([
      'abrir-ficha-iras',
      'aplicar-precaucao',
      'rever-laudo-retificado',
    ]);
    expect(
      pendenciasDaAnalise({ ...base, condutaAbreCaso: false, precaucaoAtiva: true, laudoMudouDepois: false }),
    ).toEqual([]);
    expect(
      pendenciasDaAnalise({ ...base, casoInfeccao: 3, precaucaoAtiva: true, laudoMudouDepois: false }),
    ).toEqual([]);
    expect(
      pendenciasDaAnalise({
        ...base,
        classificacao: 'colonizacao',
        precaucaoIndicada: false,
        laudoMudouDepois: false,
      }),
    ).toEqual([]);
    for (const m of Object.values(MENSAGENS_PENDENCIA_CULTURA)) expect(m.length).toBeGreaterThan(10);
  });

  it('o laudo conta como retificado depois só quando a retificação é posterior à última revisão', () => {
    const t = '2026-11-24T10:00:00.000Z';
    expect(laudoRetificadoDepois(t, { situacao: 'retificado', alteradaEm: '2026-11-24T10:00:01.000Z' })).toBe(
      true,
    );
    expect(laudoRetificadoDepois(t, { situacao: 'retificado', alteradaEm: '2026-11-24T09:59:59.000Z' })).toBe(
      false,
    );
    expect(laudoRetificadoDepois(t, { situacao: 'final', alteradaEm: '2026-11-24T11:00:00.000Z' })).toBe(
      false,
    );
    expect(laudoRetificadoDepois(t, { situacao: 'retificado', alteradaEm: null })).toBe(false);
  });
});
