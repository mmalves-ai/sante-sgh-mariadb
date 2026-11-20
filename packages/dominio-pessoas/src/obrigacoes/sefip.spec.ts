// M53-F7: o SEFIP.RE (registros de 360 posições, ordem, movimentação do desligado, pendências e catálogo). Sintéticos.
import { describe, expect, it } from 'vitest';
import { CNPJ, ficha } from '../esocial/fixtures-esocial.spec-util.js';
import { catalogos, empresa, NIS, trab } from './fixtures-obrigacoes.spec-util.js';
import { campoDaLinha, tamanhoDoLeiaute } from './leiaute-fixo.js';
import {
  type EntradaSefip,
  LEIAUTE_SEFIP_84,
  montarSefip,
  noCatalogo,
  pendenciasSefip,
  vencimentoFgtsSefip,
} from './sefip.js';
import type { RemuneracaoObrigacao } from './tipos.js';

const rem = (vinculo: number, over: Partial<RemuneracaoObrigacao> = {}): RemuneracaoObrigacao => ({
  vinculo,
  remuneracao: 300_000,
  remuneracaoDecimo: 0,
  fgts: 24_000,
  rescisorio: 0,
  ...over,
});

const entrada = (over: Partial<EntradaSefip> = {}): EntradaSefip => ({
  competencia: '2019-02',
  empresa,
  trabalhadores: [
    trab({ vinculo: 2, ficha: { ...ficha, nis: '22222222222' } }),
    trab({
      vinculo: 1,
      desligamento: '2019-02-20',
      modalidadeRescisao: 'sem-justa-causa',
      ficha: { ...ficha, nis: NIS },
    }),
  ],
  remuneracoes: new Map([
    [1, rem(1, { rescisorio: 9_600, remuneracaoDecimo: 25_000 })],
    [2, rem(2)],
  ]),
  catalogos,
  recolhimento: null,
  ...over,
});

describe('leiaute SEFIP 8.4', () => {
  it('cada registro com 360 posições', () => {
    for (const l of Object.values(LEIAUTE_SEFIP_84)) expect(tamanhoDoLeiaute(l)).toBe(360);
  });

  it('00, 10, 30 por NIS com o 32 do desligado logo depois, e 90; CRLF', () => {
    const a = montarSefip(entrada());
    expect(a.nomeArquivo).toBe('SEFIP.RE');
    const linhas = a.conteudo.split('\r\n').filter(Boolean);
    expect(a.linhas).toBe(6);
    expect(linhas.map((l) => l.slice(0, 2))).toEqual(['00', '10', '30', '32', '30', '90']);
    for (const l of linhas) {
      expect(l).toHaveLength(360);
      expect(l.endsWith('*')).toBe(true);
    }
    const L = LEIAUTE_SEFIP_84;
    expect(campoDaLinha(L['00'], linhas[0]!, 'competencia')).toBe('201902');
    expect(campoDaLinha(L['00'], linhas[0]!, 'indicadorFgts')).toBe('1');
    expect(campoDaLinha(L['10'], linhas[1]!, 'inscricao')).toBe(CNPJ);
    expect(campoDaLinha(L['10'], linhas[1]!, 'aliquotaRat')).toBe('30');
    expect(campoDaLinha(L['10'], linhas[1]!, 'codigoGps')).toBe('2100');
    expect(campoDaLinha(L['30'], linhas[2]!, 'nis')).toBe(NIS);
    expect(campoDaLinha(L['30'], linhas[2]!, 'categoria')).toBe('01');
    expect(campoDaLinha(L['30'], linhas[2]!, 'remuneracao')).toBe('000000000300000');
    expect(campoDaLinha(L['30'], linhas[2]!, 'remuneracao13')).toBe('000000000025000');
    expect(campoDaLinha(L['30'], linhas[2]!, 'cbo')).toBe('002235');
    expect(campoDaLinha(L['30'], linhas[2]!, 'nome').trim()).toBe('COLABORADORA SINTETICA');
    expect(campoDaLinha(L['32'], linhas[3]!, 'movimentacao')).toBe('I1');
    expect(campoDaLinha(L['32'], linhas[3]!, 'dataMovimentacao')).toBe('20022019');
    expect(campoDaLinha(L['32'], linhas[3]!, 'recolheFgts')).toBe('S');
    expect(campoDaLinha(L['30'], linhas[4]!, 'nis')).toBe('22222222222');
  });

  it('recolhimento em atraso: indicador 2 com a data; vencimento no dia 7 do mês seguinte', () => {
    expect(vencimentoFgtsSefip('2019-02')).toBe('2019-03-07');
    expect(vencimentoFgtsSefip('2019-12')).toBe('2020-01-07');
    const linhas = montarSefip(entrada({ recolhimento: '2019-03-20' })).conteudo.split('\r\n');
    expect(campoDaLinha(LEIAUTE_SEFIP_84['00'], linhas[0]!, 'indicadorFgts')).toBe('2');
    expect(campoDaLinha(LEIAUTE_SEFIP_84['00'], linhas[0]!, 'dataFgts')).toBe('20032019');
    const semRem = montarSefip(entrada({ remuneracoes: new Map() })).conteudo.split('\r\n');
    expect(campoDaLinha(LEIAUTE_SEFIP_84['30'], semRem[2]!, 'remuneracao')).toBe('0'.repeat(15));
    expect(campoDaLinha(LEIAUTE_SEFIP_84['32'], semRem[3]!, 'recolheFgts')).toBe('N');
  });
});

describe('pendências da SEFIP', () => {
  it('sem pendência no caso completo', () => {
    expect(pendenciasSefip(entrada())).toEqual([]);
  });

  it('ficha, NIS, CBO, categoria e movimentação sem correspondência, código fora do catálogo', () => {
    const ps = pendenciasSefip(
      entrada({
        trabalhadores: [
          trab({ vinculo: 1, ficha: null }),
          trab({ vinculo: 2, ficha: { ...ficha, nis: null, cboCargo: null } }),
          trab({ vinculo: 3, ficha: { ...ficha, nis: NIS, categoria: '901' } }),
          trab({ vinculo: 4, ficha: { ...ficha, nis: NIS, categoria: '103' } }),
          trab({ vinculo: 5, desligamento: '2019-02-01', modalidadeRescisao: null }),
          trab({ vinculo: 6, desligamento: '2019-02-01', modalidadeRescisao: 'falecimento' }),
        ],
        catalogos: { ...catalogos, categoriasSefip: new Set(['1']), movimentacoesSefip: new Set(['I1']) },
      }),
    );
    expect(ps.map((p) => [p.codigo, p.vinculos])).toEqual([
      ['sem-ficha', [1]],
      ['sem-nis', [2]],
      ['sem-cbo', [2]],
      ['categoria-sem-correspondencia', [3, 5]],
      ['codigo-fora-do-catalogo', [4, 6]],
    ]);
  });

  it('o catálogo do banco traz os numéricos sem zero à esquerda', () => {
    expect(noCatalogo(new Set(['7']), '07')).toBe(true);
    expect(noCatalogo(new Set(['I1']), 'I1')).toBe(true);
    expect(noCatalogo(new Set(['7']), 'H')).toBe(false);
  });
});
