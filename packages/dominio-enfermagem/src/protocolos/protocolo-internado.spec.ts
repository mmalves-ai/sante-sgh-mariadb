// W0-03, mercado M3: as regras dos protocolos gerenciados no internado (sem banco). Dados sintéticos.
import { esquemaIncluirProtocoloInternado } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  indicadoresPorOrigem,
  localDaUnidade,
  problemaDaInclusaoInternado,
  sugestoesPeloNews2,
  tempoZeroDoInternado,
  type EscoreParaProtocolo,
  type ProtocoloParaIndicador,
} from './protocolo-internado.js';

const AGORA = '2031-02-10T12:00';
const e = (o: Partial<EscoreParaProtocolo>): EscoreParaProtocolo => ({
  id: 1,
  atendimento: 100,
  escala: 'news2',
  total: 6,
  em: '2031-02-10T10:00',
  estornado: false,
  ...o,
});

describe('W0-03, M3: local e sugestão pelo NEWS2', () => {
  it('a UTI vem do parâmetro das unidades; o resto é internação', () => {
    expect(localDaUnidade('uti1', ['UTI1', 'UCO'])).toBe('uti');
    expect(localDaUnidade('CLM', ['UTI1'])).toBe('internacao');
    expect(localDaUnidade(null, ['UTI1'])).toBe('internacao');
  });

  it('sugere o mais recente por atendimento, no limiar, válido e sem sepse aberta', () => {
    const s = sugestoesPeloNews2(
      [
        e({ id: 1, em: '2031-02-10T08:00' }),
        e({ id: 2, em: '2031-02-10T09:00', total: 5 }),
        e({ id: 3, atendimento: 200, total: 4 }),
        e({ id: 4, atendimento: 300, estornado: true }),
        e({ id: 5, atendimento: 400, escala: 'braden', total: 9 }),
        e({ id: 6, atendimento: 500, total: 7 }),
      ],
      new Set([500]),
      5,
    );
    expect(s.map((x) => x.id)).toEqual([2]);
  });
});

describe('W0-03, M3: inclusão conferida', () => {
  const base = { atendimento: 100, limiar: 5, agora: AGORA, jaAberto: false } as const;
  it('pelo NEWS2: confere atendimento, escala, estorno e limiar', () => {
    expect(
      problemaDaInclusaoInternado({ ...base, origem: 'news2', escore: e({}), reconhecidoEm: null }),
    ).toBeNull();
    expect(
      problemaDaInclusaoInternado({
        ...base,
        origem: 'news2',
        escore: e({ atendimento: 9 }),
        reconhecidoEm: null,
      }),
    ).toBe('escore-de-outro-atendimento');
    expect(
      problemaDaInclusaoInternado({
        ...base,
        origem: 'news2',
        escore: e({ escala: 'morse' }),
        reconhecidoEm: null,
      }),
    ).toBe('escore-nao-e-news2');
    expect(
      problemaDaInclusaoInternado({
        ...base,
        origem: 'news2',
        escore: e({ estornado: true }),
        reconhecidoEm: null,
      }),
    ).toBe('escore-estornado');
    expect(
      problemaDaInclusaoInternado({ ...base, origem: 'news2', escore: e({ total: 4 }), reconhecidoEm: null }),
    ).toBe('escore-abaixo-do-limiar');
  });
  it('por suspeita: a hora nunca no futuro nem além de 24 h; um aberto por tipo', () => {
    const s = { ...base, origem: 'suspeita' as const, escore: null };
    expect(problemaDaInclusaoInternado({ ...s, reconhecidoEm: '2031-02-10T11:30' })).toBeNull();
    expect(problemaDaInclusaoInternado({ ...s, reconhecidoEm: '2031-02-10T12:01' })).toBe(
      'reconhecimento-no-futuro',
    );
    expect(problemaDaInclusaoInternado({ ...s, reconhecidoEm: '2031-02-09T11:59' })).toBe(
      'reconhecimento-antigo',
    );
    expect(problemaDaInclusaoInternado({ ...s, reconhecidoEm: '2031-02-10T11:30', jaAberto: true })).toBe(
      'protocolo-ja-aberto',
    );
  });
  it('o tempo zero é a hora do alerta ou a do reconhecimento', () => {
    expect(tempoZeroDoInternado('news2', '2031-02-10T10:00', null, AGORA)).toBe('2031-02-10T10:00');
    expect(tempoZeroDoInternado('suspeita', null, '2031-02-10T11:30', AGORA)).toBe('2031-02-10T11:30');
    expect(tempoZeroDoInternado('suspeita', null, null, AGORA)).toBe(AGORA);
  });
  it('o contrato pede o escore no NEWS2 (só sepse) e a hora na suspeita', () => {
    const ok = { atendimento: 100, versao: 3, criterios: ['suspeita-infeccao'] };
    expect(
      esquemaIncluirProtocoloInternado.safeParse({ ...ok, tipo: 'sepse', origem: 'news2', escore: 7 })
        .success,
    ).toBe(true);
    expect(
      esquemaIncluirProtocoloInternado.safeParse({ ...ok, tipo: 'sepse', origem: 'news2' }).success,
    ).toBe(false);
    expect(
      esquemaIncluirProtocoloInternado.safeParse({ ...ok, tipo: 'tev', origem: 'news2', escore: 7 }).success,
    ).toBe(false);
    expect(
      esquemaIncluirProtocoloInternado.safeParse({ ...ok, tipo: 'avc', origem: 'suspeita' }).success,
    ).toBe(false);
    expect(
      esquemaIncluirProtocoloInternado.safeParse({
        ...ok,
        tipo: 'avc',
        origem: 'suspeita',
        reconhecidoEm: '2031-02-10T11:30',
      }).success,
    ).toBe(true);
  });
});

describe('W0-03, M3: indicadores por origem (numerador e denominador)', () => {
  const p = (o: Partial<ProtocoloParaIndicador>): ProtocoloParaIndicador => ({
    local: 'internacao',
    tipo: 'sepse',
    pelaNews2: false,
    metas: ['lactato', 'hemoculturas', 'antibiotico'],
    eventos: [],
    inativo: false,
    ...o,
  });
  const cumpridas = (...c: string[]) => c.map((codigo) => ({ tipo: 'meta', codigo, situacao: 'cumprida' }));
  const enc = (situacao: string) => ({ tipo: 'encerramento', codigo: 'encerramento', situacao });

  it('separa PA, internação e UTI, com a linha "todos" e sem as inativadas', () => {
    const r = indicadoresPorOrigem([
      p({ local: 'pa', eventos: [...cumpridas('lactato', 'hemoculturas', 'antibiotico'), enc('concluido')] }),
      p({
        pelaNews2: true,
        eventos: [
          ...cumpridas('lactato', 'hemoculturas'),
          { tipo: 'meta', codigo: 'antibiotico', situacao: 'perdida' },
          enc('concluido'),
        ],
      }),
      p({ pelaNews2: true, eventos: cumpridas('lactato') }),
      p({
        tipo: 'tev',
        metas: ['avaliacao-medica', 'profilaxia'],
        eventos: [...cumpridas('avaliacao-medica', 'profilaxia'), enc('concluido')],
      }),
      p({ local: 'uti', eventos: [...cumpridas('lactato', 'hemoculturas', 'antibiotico'), enc('obito')] }),
      p({ local: 'uti', inativo: true, eventos: cumpridas('lactato') }),
    ]);
    expect(r.map((x) => `${x.local}:${x.tipo}`)).toEqual([
      'pa:todos',
      'pa:sepse',
      'internacao:todos',
      'internacao:sepse',
      'internacao:tev',
      'uti:todos',
      'uti:sepse',
    ]);
    const intSepse = r.find((x) => x.local === 'internacao' && x.tipo === 'sepse')!;
    // 2 inclusões, ambas pelo NEWS2; metas 3 cumpridas de 4 registradas = 75%; 0 pacote completo de 1 encerrada.
    expect(intSepse).toMatchObject({
      inclusoes: 2,
      pelaNews2: 2,
      metasCumpridas: 3,
      metasRegistradas: 4,
      adesaoPercentual: 75,
      pacoteCompleto: 0,
      encerradas: 1,
      pacotePercentual: 0,
    });
    const intTodos = r.find((x) => x.local === 'internacao' && x.tipo === 'todos')!;
    expect(intTodos).toMatchObject({
      inclusoes: 3,
      metasCumpridas: 5,
      metasRegistradas: 6,
      encerradas: 2,
      pacoteCompleto: 1,
    });
    expect(intTodos.adesaoPercentual).toBe(83.3);
    const uti = r.find((x) => x.local === 'uti' && x.tipo === 'todos')!;
    expect(uti).toMatchObject({
      inclusoes: 1,
      obitos: 1,
      pacoteCompleto: 1,
      encerradas: 1,
      pacotePercentual: 100,
    });
  });

  it('sem registro, o percentual é nulo (nunca zero inventado)', () => {
    const [todos] = indicadoresPorOrigem([p({})]);
    expect(todos).toMatchObject({
      metasRegistradas: 0,
      adesaoPercentual: null,
      encerradas: 0,
      pacotePercentual: null,
    });
  });
});
