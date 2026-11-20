// W0-05 (ficha EMTN completa): o volume pela via (checagem na enteral, balanço na parenteral, informado só sem a fonte),
// o volume da parenteral lido do balanço, o percentual diário e acumulado com as parcelas, o alerta de meta não atingida
// por 3 dias seguidos, a avaliação farmacêutica da NPT e a retificação só do volume informado; e as regras da correção
// do registro clínico (próprio autor, versão ativa).
import { describe, expect, it } from 'vitest';
import {
  alertaMetaNaoAtingida,
  conferirAvaliacaoNpt,
  conferirRetificacaoVolume,
  ErroCorrecao,
  ErroTerapia,
  exigirAtivo,
  exigirProprioAutor,
  progressoDaTerapia,
  volumeDoDiaPorVia,
  volumesParenteraisDoBalanco,
} from '../index.js';

describe('volume do dia pela via', () => {
  const vazio = { checado: null, balanco: null, informadoMl: null };
  it('a enteral lê a checagem; sem ela, o informado', () => {
    expect(volumeDoDiaPorVia('enteral', { ...vazio, checado: { volumeMl: 900 } })).toEqual({
      volumeMl: 900,
      origem: 'checagem',
    });
    expect(volumeDoDiaPorVia('enteral', { ...vazio, informadoMl: 700 })).toEqual({
      volumeMl: 700,
      origem: 'informado',
    });
  });
  it('a parenteral lê o balanço hídrico (sem digitação); sem lançamento, o informado; sem nenhum, recusa', () => {
    expect(
      volumeDoDiaPorVia('parenteral', {
        ...vazio,
        balanco: { volumeMl: 1500, lancamentos: 2 },
        informadoMl: 10,
      }),
    ).toEqual({ volumeMl: 1500, origem: 'balanco' });
    expect(
      volumeDoDiaPorVia('parenteral', {
        ...vazio,
        balanco: { volumeMl: 0, lancamentos: 0 },
        informadoMl: 800,
      }),
    ).toEqual({ volumeMl: 800, origem: 'informado' });
    expect(() => volumeDoDiaPorVia('parenteral', vazio)).toThrow(/balanço/);
  });
});

describe('volume da parenteral no balanço', () => {
  const grupos = [
    { codigo: 1, nome: 'Via oral' },
    { codigo: 2, nome: 'Nutrição parenteral' },
    { codigo: 3, nome: 'NPT periférica' },
  ];
  const l = (x: Partial<Parameters<typeof volumesParenteraisDoBalanco>[0][number]>) => ({
    sentido: 'ganho',
    origem: 'manual',
    grupo: 2,
    volumeMl: 100,
    horaReal: '2026-11-17T08:00',
    estornadoPor: null,
    ...x,
  });
  it('soma os ganhos dos grupos da NPT por dia; ignora outro grupo, perdas, estornados e estornos', () => {
    expect(
      volumesParenteraisDoBalanco(
        [
          l({ volumeMl: 500 }),
          l({ volumeMl: 250.25, grupo: 3, horaReal: '2026-11-17T20:00' }),
          l({ grupo: 1 }),
          l({ sentido: 'perda' }),
          l({ estornadoPor: 77 }),
          l({ origem: 'estorno' }),
          l({ volumeMl: 1000, horaReal: '2026-11-18T06:00' }),
        ],
        grupos,
      ),
    ).toEqual([
      { data: '2026-11-18', lancamentos: 1, volumeMl: 1000 },
      { data: '2026-11-17', lancamentos: 2, volumeMl: 750.3 },
    ]);
  });
});

describe('percentual diário e acumulado', () => {
  const meta = { metaKcal: 2000, metaProteinaG: 100 };
  const a = (data: string, kcal: number, ptn: number, em = `${data}T10:00`) => ({
    data,
    em,
    kcalAtingida: kcal,
    proteinaAtingidaG: ptn,
    meta,
  });
  it('cada dia com a sua meta e o acumulado com as parcelas (soma atingida / soma da meta)', () => {
    const p = progressoDaTerapia(
      [a('2026-11-16', 1000, 50), a('2026-11-15', 1500, 60), a('2026-11-17', 2000, 100)],
      80,
    );
    expect(p.map((x) => x.data)).toEqual(['2026-11-15', '2026-11-16', '2026-11-17']);
    expect(p[0]).toMatchObject({
      pctKcal: 75,
      pctProteina: 60,
      acumuladoPctKcal: 75,
      abaixoDoAdequado: true,
    });
    // 1500 + 1000 = 2500 de 4000 kcal: 62,5%; 60 + 50 = 110 de 200 g: 55%.
    expect(p[1]).toMatchObject({
      acumuladoKcalAtingida: 2500,
      acumuladoKcalMeta: 4000,
      acumuladoPctKcal: 62.5,
      acumuladoPtnAtingidaG: 110,
      acumuladoPtnMetaG: 200,
      acumuladoPctProteina: 55,
    });
    // 4500 de 6000 kcal: 75%; 210 de 300 g: 70%.
    expect(p[2]).toMatchObject({
      pctKcal: 100,
      acumuladoPctKcal: 75,
      acumuladoPctProteina: 70,
      abaixoDoAdequado: false,
    });
  });
  it('a meta nova vale nos dias dela; dois ativos no mesmo dia: o mais recente', () => {
    const p = progressoDaTerapia(
      [
        { ...a('2026-11-15', 1000, 50), meta: { metaKcal: 1000, metaProteinaG: 50 } },
        a('2026-11-16', 1000, 50, '2026-11-16T09:00'),
        a('2026-11-16', 1800, 90, '2026-11-16T15:00'),
      ],
      80,
    );
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ pctKcal: 100, kcalMeta: 1000 });
    expect(p[1]).toMatchObject({ kcalAtingida: 1800, acumuladoKcalMeta: 3000, acumuladoPctKcal: 93.3 });
  });
});

describe('revisão: a enteral e a NPT complementar no mesmo dia', () => {
  const ent = { metaKcal: 1500, metaProteinaG: 60, via: 'enteral' };
  const npt = { metaKcal: 500, metaProteinaG: 30, via: 'parenteral' };
  const dia = (data: string, em: string, kcal: number, ptn: number, meta: typeof ent) => ({
    data,
    em,
    kcalAtingida: kcal,
    proteinaAtingidaG: ptn,
    meta,
  });
  it('em qualquer ordem, o dia soma as duas vias (nenhuma é descartada) e mostra as parcelas', () => {
    const e = dia('2026-11-16', '2026-11-16T10:00', 1200, 48, ent);
    const n = dia('2026-11-16', '2026-11-16T11:00', 500, 30, npt);
    for (const ordem of [
      [e, n],
      [n, e],
    ]) {
      const [p] = progressoDaTerapia(ordem, 80);
      // (1200 + 500) de (1500 + 500) kcal = 85%; (48 + 30) de (60 + 30) g = 86,7%.
      expect(p).toMatchObject({
        kcalMeta: 2000,
        kcalAtingida: 1700,
        pctKcal: 85,
        ptnMetaG: 90,
        ptnAtingidaG: 78,
        pctProteina: 86.7,
        acumuladoPctKcal: 85,
        abaixoDoAdequado: false,
      });
      expect(p!.vias).toEqual([
        { via: 'enteral', kcalMeta: 1500, kcalAtingida: 1200, ptnMetaG: 60, ptnAtingidaG: 48 },
        { via: 'parenteral', kcalMeta: 500, kcalAtingida: 500, ptnMetaG: 30, ptnAtingidaG: 30 },
      ]);
    }
  });
  it('três dias assim não acendem o alerta falso; na mesma via, o mais recente do dia vale', () => {
    const dias = ['2026-11-15', '2026-11-16', '2026-11-17'];
    const p = progressoDaTerapia(
      dias.flatMap((d) => [
        dia(d, `${d}T11:00`, 500, 30, npt),
        dia(d, `${d}T09:00`, 600, 20, ent),
        dia(d, `${d}T10:00`, 1200, 48, ent),
      ]),
      80,
    );
    expect(p.map((x) => x.pctKcal)).toEqual([85, 85, 85]);
    expect(alertaMetaNaoAtingida(p)).toBeNull();
  });
});

describe('alerta de meta não atingida', () => {
  const p = (data: string, abaixo: boolean) =>
    progressoDaTerapia(
      [
        {
          data,
          em: `${data}T10:00`,
          kcalAtingida: abaixo ? 500 : 2000,
          proteinaAtingidaG: 100,
          meta: { metaKcal: 2000, metaProteinaG: 100 },
        },
      ],
      80,
    )[0]!;
  it('3 dias seguidos abaixo do adequado até o último dia acendem o alerta', () => {
    const al = alertaMetaNaoAtingida([p('2026-11-15', true), p('2026-11-16', true), p('2026-11-17', true)]);
    expect(al).toMatchObject({ dias: 3, desde: '2026-11-15', ate: '2026-11-17' });
    expect(al?.mensagem).toMatch(/3 dias seguidos \(15\/11 a 17\/11\)/);
  });
  it('2 dias, um dia bom no meio, um dia sem acompanhamento ou o último dia bom: sem alerta', () => {
    expect(alertaMetaNaoAtingida([p('2026-11-16', true), p('2026-11-17', true)])).toBeNull();
    expect(
      alertaMetaNaoAtingida([p('2026-11-15', true), p('2026-11-16', false), p('2026-11-17', true)]),
    ).toBeNull();
    expect(
      alertaMetaNaoAtingida([p('2026-11-13', true), p('2026-11-14', true), p('2026-11-16', true)]),
    ).toBeNull();
    expect(
      alertaMetaNaoAtingida([
        p('2026-11-14', true),
        p('2026-11-15', true),
        p('2026-11-16', true),
        p('2026-11-17', false),
      ]),
    ).toBeNull();
  });
  it('o número de dias vem do parâmetro', () => {
    expect(alertaMetaNaoAtingida([p('2026-11-16', true), p('2026-11-17', true)], 2)?.dias).toBe(2);
  });
});

describe('avaliação farmacêutica da NPT', () => {
  const base = {
    parecer: 'adequada' as const,
    acesso: 'central' as const,
    osmolaridade: 1400,
    estabilidade: true,
    compatibilidade: true,
  };
  it('central acima de 900 mOsm/L é adequada; periférico acima de 900 não', () => {
    expect(() => conferirAvaliacaoNpt(base)).not.toThrow();
    expect(() => conferirAvaliacaoNpt({ ...base, acesso: 'periferico' })).toThrow(/periférico/);
    expect(() => conferirAvaliacaoNpt({ ...base, acesso: 'periferico', osmolaridade: 850 })).not.toThrow();
  });
  it('adequada exige estabilidade e compatibilidade; ajustar e inadequada exigem a observação', () => {
    expect(() => conferirAvaliacaoNpt({ ...base, estabilidade: false })).toThrow(ErroTerapia);
    expect(() => conferirAvaliacaoNpt({ ...base, parecer: 'ajustar' })).toThrow(/observação/);
    expect(() =>
      conferirAvaliacaoNpt({ ...base, parecer: 'inadequada', observacao: 'Cálcio e fosfato precipitam.' }),
    ).not.toThrow();
  });
});

describe('correção do registro clínico', () => {
  it('só o volume informado à mão se retifica', () => {
    expect(() => conferirRetificacaoVolume('informado')).not.toThrow();
    expect(() => conferirRetificacaoVolume('checagem')).toThrow(/checagem/);
    expect(() => conferirRetificacaoVolume('balanco')).toThrow(/balanço/);
  });
  it('só o próprio autor corrige (403); a versão inativa não se corrige de novo (409)', () => {
    expect(() => exigirProprioAutor({ por: 'SINT.NUTRI ' }, 'sint.nutri', 'A triagem')).not.toThrow();
    try {
      exigirProprioAutor({ por: 'SINT.NUTRI' }, 'SINT.OUTRA', 'A triagem');
      expect.unreachable();
    } catch (x) {
      expect(x).toBeInstanceOf(ErroCorrecao);
      expect((x as ErroCorrecao).status).toBe(403);
    }
    expect(() => exigirAtivo({ correcao: null })).not.toThrow();
    expect(() =>
      exigirAtivo({
        correcao: { acao: 'estorno', idNovo: null, motivo: 'Erro', por: 'X', em: '2026-11-18T10:00' },
      }),
    ).toThrow(/inativo/);
  });
});
