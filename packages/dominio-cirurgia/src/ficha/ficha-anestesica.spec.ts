// M46 (etapa 1), regra 3: ficha anestésica conforme CFM 2.174/2017 — sinais a cada 5 minutos, marcos em ordem,
// lançamentos na janela, fluidos ao balanço uma vez só, passagem entre anestesistas e assinatura só pelo anestesista
// da cirurgia. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  anestesistasDaCirurgia,
  chaveBalanco,
  conferirLancamentos,
  conferirMarco,
  conferirPassagem,
  itensParaBalanco,
  janelaDaFicha,
  janelaDosSinais,
  lacunasDeSinais,
  linhaDeResponsabilidade,
  pendenciasDeAssinatura,
  responsavelAtual,
  situacaoDepoisDoMarco,
  totaisDaFicha,
  validarSinalFicha,
  type FluidoLancado,
  type SinalLancado,
} from './ficha-anestesica.js';
import { instanteDosMinutos, minutosDoInstante, somarAoInstante } from './instante.js';

const t = (hhmm: string) => `2026-10-24T${hhmm}`;
const sinaisCompletos = (hhmm: string): SinalLancado[] =>
  (['pas', 'pad', 'fc', 'spo2'] as const).map((tipo) => ({ tipo, momento: t(hhmm) }));

describe('instantes', () => {
  it('aceita T ou espaço e ignora os segundos', () => {
    expect(minutosDoInstante('2026-10-24T09:00:30')).toBe(minutosDoInstante('2026-10-24 09:00'));
    expect(instanteDosMinutos(minutosDoInstante(t('09:05')))).toBe(t('09:05'));
    expect(somarAoInstante(t('23:55'), 10)).toBe('2026-10-25T00:05');
  });
});

describe('sinais e grade de 5 minutos', () => {
  it('faixa plausível do sinal', () => {
    expect(validarSinalFicha('fc', 72)).toEqual({ ok: true });
    expect(validarSinalFicha('fc', 900)).toEqual({ ok: false, codigo: 'ficha-sinal-implausivel' });
    expect(validarSinalFicha('xyz', 1)).toEqual({ ok: false, codigo: 'ficha-sinal-implausivel' });
    expect(validarSinalFicha('spo2', Number.NaN)).toMatchObject({ ok: false });
  });
  it('sem lacuna quando cada fatia de 5 minutos tem os quatro obrigatórios', () => {
    const s = [...sinaisCompletos('09:00'), ...sinaisCompletos('09:05'), ...sinaisCompletos('09:12')];
    expect(lacunasDeSinais(s, { inicio: t('09:00'), fim: t('09:15') })).toEqual([]);
  });
  it('fatias vizinhas com os mesmos sinais em falta viram uma lacuna; a justificativa cobre a lacuna inteira', () => {
    const s = [
      ...sinaisCompletos('09:00'),
      { tipo: 'fc' as const, momento: t('09:06') },
      { tipo: 'fc' as const, momento: t('09:11') },
      ...sinaisCompletos('09:16'),
    ];
    const l = lacunasDeSinais(s, { inicio: t('09:00'), fim: t('09:18') });
    expect(l).toEqual([
      { inicio: t('09:05'), fim: t('09:15'), sinais: ['pas', 'pad', 'spo2'], justificada: false },
    ]);
    expect(
      lacunasDeSinais(s, { inicio: t('09:00'), fim: t('09:18') }, [
        { inicio: t('09:04'), fim: t('09:15') },
      ])[0]?.justificada,
    ).toBe(true);
    expect(
      lacunasDeSinais(s, { inicio: t('09:00'), fim: t('09:18') }, [
        { inicio: t('09:06'), fim: t('09:15') },
      ])[0]?.justificada,
    ).toBe(false);
  });
  it('a última fatia incompleta também é cobrada; conjuntos diferentes não se juntam', () => {
    const s = [...sinaisCompletos('09:00'), { tipo: 'fc' as const, momento: t('09:05') }];
    const l = lacunasDeSinais(s, { inicio: t('09:00'), fim: t('09:12') });
    expect(l.map((x) => [x.inicio, x.fim, x.sinais.length])).toEqual([
      [t('09:05'), t('09:10'), 3],
      [t('09:10'), t('09:12'), 4],
    ]);
  });
});

describe('marcos e janela', () => {
  it('em ordem, sem repetir', () => {
    const m = { entradaSala: t('08:50'), inicioAnestesia: t('09:00') };
    expect(conferirMarco(m, 'inicioCirurgia', t('09:20'))).toEqual({ ok: true });
    expect(conferirMarco(m, 'inicioAnestesia', t('09:01'))).toEqual({
      ok: false,
      codigo: 'ficha-marco-repetido',
    });
    expect(conferirMarco(m, 'inicioCirurgia', t('08:55'))).toEqual({
      ok: false,
      codigo: 'ficha-marco-fora-de-ordem',
    });
    expect(conferirMarco({ fimCirurgia: t('10:00') }, 'inicioCirurgia', t('10:30'))).toMatchObject({
      ok: false,
    });
  });
  it('janela da ficha e dos sinais', () => {
    expect(janelaDaFicha({})).toEqual({ inicio: null, fim: null });
    expect(janelaDaFicha({ inicioAnestesia: t('09:00'), saidaSala: t('11:00') }).fim).toBe(
      minutosDoInstante(t('11:00')),
    );
    expect(janelaDosSinais({}, t('10:00'))).toBeNull();
    expect(janelaDosSinais({ inicioAnestesia: t('09:00') }, t('10:00'))).toEqual({
      inicio: t('09:00'),
      fim: t('10:00'),
    });
    expect(janelaDosSinais({ inicioAnestesia: t('09:00'), fimAnestesia: t('09:40') }, t('10:00'))?.fim).toBe(
      t('09:40'),
    );
  });
  it('fim da anestesia encerra a ficha; assinada não muda', () => {
    expect(situacaoDepoisDoMarco('aberta', 'fimAnestesia')).toBe('encerrada');
    expect(situacaoDepoisDoMarco('aberta', 'inicioCirurgia')).toBe('aberta');
    expect(situacaoDepoisDoMarco('assinada', 'fimAnestesia')).toBe('assinada');
  });
});

describe('lançamentos', () => {
  const marcos = { entradaSala: t('08:50'), saidaSala: t('11:00') };
  it('dentro da janela e plausíveis', () => {
    expect(
      conferirLancamentos('aberta', marcos, [
        { parte: 'sinal', momento: t('09:00'), tipo: 'fc', valor: 70 },
        { parte: 'medicamento', momento: t('09:01') },
      ]),
    ).toEqual({ ok: true });
  });
  it('fora da janela, fim antes do início, sinal implausível e ficha encerrada ou assinada', () => {
    expect(conferirLancamentos('aberta', marcos, [{ parte: 'gas', momento: t('08:00') }])).toEqual({
      ok: false,
      codigo: 'ficha-fora-da-janela',
      indice: 0,
    });
    expect(conferirLancamentos('aberta', marcos, [{ parte: 'gas', momento: t('11:30') }])).toMatchObject({
      codigo: 'ficha-fora-da-janela',
    });
    expect(
      conferirLancamentos('aberta', marcos, [
        { parte: 'medicamento', momento: t('09:00') },
        { parte: 'gas', momento: t('09:30'), fim: t('09:10') },
      ]),
    ).toMatchObject({ codigo: 'ficha-fora-da-janela', indice: 1 });
    expect(
      conferirLancamentos('aberta', {}, [{ parte: 'sinal', momento: t('09:00'), tipo: 'fc' }]),
    ).toMatchObject({
      codigo: 'ficha-sinal-implausivel',
      indice: 0,
    });
    expect(conferirLancamentos('encerrada', marcos, [])).toMatchObject({
      codigo: 'ficha-encerrada',
      indice: -1,
    });
    expect(conferirLancamentos('assinada', marcos, [])).toMatchObject({ codigo: 'ficha-assinada' });
  });
});

describe('fluidos, perdas e balanço', () => {
  const itens: FluidoLancado[] = [
    { id: 1, parte: 'fluido', tipo: 'cristaloide', volumeMl: 1000, momento: t('09:00'), fim: t('10:00') },
    { id: 2, parte: 'fluido', tipo: 'concentrado-hemacias', volumeMl: 300, momento: t('09:30'), fim: null },
    { id: 3, parte: 'perda', tipo: 'sangramento', volumeMl: 400, momento: t('09:40'), fim: null },
  ];
  it('totais com hemocomponentes à parte', () => {
    expect(totaisDaFicha(itens)).toEqual({ ganhosMl: 1300, perdasMl: 400, hemocomponentesMl: 300 });
  });
  it('vai ao balanço o que ainda não foi; a mesma chave nunca duas vezes', () => {
    const todos = itensParaBalanco(7, itens, new Set());
    expect(todos.map((i) => [i.chave, i.direcao, i.hemocomponente])).toEqual([
      ['cc-fa:7:1', 'ganho', false],
      ['cc-fa:7:2', 'ganho', true],
      ['cc-fa:7:3', 'perda', false],
    ]);
    expect(
      itensParaBalanco(7, itens, new Set([chaveBalanco(7, 1), chaveBalanco(7, 3)])).map((i) => i.chave),
    ).toEqual(['cc-fa:7:2']);
  });
});

describe('passagem entre anestesistas', () => {
  const linha = linhaDeResponsabilidade({ anestesista: 10, de: t('09:00') }, [
    { de: 20, para: 30, momento: t('11:00') },
    { de: 10, para: 20, momento: t('10:00') },
  ]);
  it('a linha em ordem, cada trecho fechado pela passagem seguinte', () => {
    expect(linha).toEqual([
      { anestesista: 10, de: t('09:00'), ate: t('10:00') },
      { anestesista: 20, de: t('10:00'), ate: t('11:00') },
      { anestesista: 30, de: t('11:00'), ate: null },
    ]);
    expect(responsavelAtual(linha)).toBe(30);
    expect(responsavelAtual([])).toBeNull();
  });
  it('só o responsável do momento passa, para outro, e não antes de assumir', () => {
    expect(conferirPassagem(linha, 30, 10, t('12:00'))).toEqual({ ok: true });
    expect(conferirPassagem(linha, 20, 10, t('12:00'))).toEqual({
      ok: false,
      codigo: 'ficha-passagem-nao-responsavel',
    });
    expect(conferirPassagem(linha, 30, 30, t('12:00'))).toMatchObject({
      codigo: 'ficha-passagem-mesmo-anestesista',
    });
    expect(conferirPassagem(linha, 30, 10, t('10:30'))).toMatchObject({
      codigo: 'ficha-passagem-fora-de-ordem',
    });
    expect(conferirPassagem([], 30, 10, t('10:30'))).toMatchObject({
      codigo: 'ficha-passagem-nao-responsavel',
    });
  });
});

describe('assinatura (só o anestesista da cirurgia)', () => {
  const anest = anestesistasDaCirurgia({
    agendado: 10,
    equipe: [
      { profissional: 40, funcao: 6 },
      { profissional: 50, funcao: 1 },
    ],
    funcaoAnestesista: 6,
    responsaveis: [{ anestesista: 20, de: t('10:00'), ate: null }],
  });
  it('agendado, equipe com a função de anestesista e quem teve a responsabilidade', () => {
    expect([...anest].sort()).toEqual([10, 20, 40]);
    expect(
      anestesistasDaCirurgia({
        agendado: null,
        equipe: [{ profissional: 40, funcao: 6 }],
        funcaoAnestesista: null,
        responsaveis: [],
      }).size,
    ).toBe(0);
  });
  it('pronta para assinar; ou as pendências na ordem', () => {
    const pronta = {
      situacao: 'encerrada' as const,
      marcos: { fimAnestesia: t('11:00') },
      lacunas: [],
      abertos: 0,
    };
    expect(pendenciasDeAssinatura(pronta, 20, anest)).toEqual([]);
    expect(
      pendenciasDeAssinatura(
        {
          situacao: 'assinada',
          marcos: {},
          lacunas: [{ inicio: t('09:00'), fim: t('09:05'), sinais: ['fc'], justificada: false }],
          abertos: 1,
        },
        50,
        anest,
      ),
    ).toEqual([
      'ficha-assinada',
      'ficha-sem-fim-anestesia',
      'ficha-lacuna-sinais',
      'ficha-gas-sem-fim',
      'ficha-nao-e-anestesista',
    ]);
    expect(
      pendenciasDeAssinatura(
        { ...pronta, lacunas: [{ inicio: t('09:00'), fim: t('09:05'), sinais: ['fc'], justificada: true }] },
        null,
        anest,
      ),
    ).toEqual(['ficha-nao-e-anestesista']);
  });
});
