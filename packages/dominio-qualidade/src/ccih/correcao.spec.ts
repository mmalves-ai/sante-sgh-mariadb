// W0-04: correção do dispositivo por versão, competências que o registro toca e a recusa da competência fechada.
// Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  associacoesDesfeitas,
  autoriaDaCorrecao,
  competenciasDoIntervalo,
  competenciasFechadasTocadas,
  conferirCorrecaoDispositivo,
  conferirCorrecaoObservacao,
  MENSAGENS_CORRECAO_CCIH,
  podeFecharCompetencia,
} from './correcao.js';

const AGORA = '2026-11-18T10:00:00';
const atual = {
  tipo: 'cvc',
  sitio: 'subclávia direita',
  inseridoEm: '2026-11-10T08:00:00',
  retiradoEm: null,
};
const base = { atual, agora: AGORA, entrada: '2026-11-09', outrosAtivos: [] };

describe('correção do dispositivo', () => {
  it('corrige data, sítio e tipo; recusa o que não mudou, o futuro, a data antes da internação e o cancelado', () => {
    const novo = {
      tipo: 'cvc' as const,
      sitio: 'jugular interna',
      inseridoEm: '2026-11-10T07:00',
      retiradoEm: null,
    };
    expect(conferirCorrecaoDispositivo({ ...base, novo })).toBeNull();
    expect(
      conferirCorrecaoDispositivo({
        ...base,
        novo: { ...novo, sitio: atual.sitio, inseridoEm: atual.inseridoEm },
      }),
    ).toBe('sem-mudanca');
    expect(conferirCorrecaoDispositivo({ ...base, novo: { ...novo, inseridoEm: '2026-11-19T07:00' } })).toBe(
      'instante-futuro',
    );
    expect(conferirCorrecaoDispositivo({ ...base, novo: { ...novo, inseridoEm: '2026-11-08T07:00' } })).toBe(
      'antes-da-internacao',
    );
    expect(conferirCorrecaoDispositivo({ ...base, atual: { ...atual, canceladoEm: AGORA }, novo })).toBe(
      'registro-cancelado',
    );
  });
  it('a retirada só se corrige se já registrada, e nunca antes da inserção; a troca de tipo não duplica o ativo', () => {
    const novo = {
      tipo: 'cvc' as const,
      sitio: null,
      inseridoEm: '2026-11-10T08:00',
      retiradoEm: '2026-11-12T08:00',
    };
    expect(conferirCorrecaoDispositivo({ ...base, novo })).toBe('retirada-sem-registro');
    const retirado = { ...atual, retiradoEm: '2026-11-15T08:00:00' };
    expect(conferirCorrecaoDispositivo({ ...base, atual: retirado, novo })).toBeNull();
    expect(
      conferirCorrecaoDispositivo({
        ...base,
        atual: retirado,
        novo: { ...novo, retiradoEm: '2026-11-09T08:00' },
      }),
    ).toBe('antes-da-insercao');
    expect(
      conferirCorrecaoDispositivo({
        ...base,
        outrosAtivos: [{ tipo: 'sondaVesical' }],
        novo: { tipo: 'sondaVesical', sitio: null, inseridoEm: atual.inseridoEm, retiradoEm: null },
      }),
    ).toBe('dispositivo-ja-ativo');
  });
  it('a sessão estornada não se corrige', () => {
    expect(conferirCorrecaoObservacao({ estornadoEm: AGORA })).toBe('observacao-estornada');
    expect(conferirCorrecaoObservacao({ estornadoEm: null })).toBeNull();
    expect(MENSAGENS_CORRECAO_CCIH['competencia-fechada']).toMatch(/reabra a competência/);
  });
});

describe('competência fechada', () => {
  it('o dispositivo toca as competências da inserção até a retirada (ou até hoje)', () => {
    expect(competenciasDoIntervalo('2026-09-28T10:00', '2026-11-02T08:00', AGORA)).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
    expect(competenciasDoIntervalo('2026-12-30T10:00', null, '2027-01-02T08:00')).toEqual([
      '2026-12',
      '2027-01',
    ]);
  });
  it('as fechadas tocadas pelo antes e pelo depois, sem repetição e em ordem', () => {
    expect(
      competenciasFechadasTocadas(
        ['2026-10', '2026-09', '2026-10', '2026-11'],
        new Set(['2026-09', '2026-10']),
      ),
    ).toEqual(['2026-09', '2026-10']);
  });
  it('fecha as competências passadas e a do mês só no último dia', () => {
    expect(podeFecharCompetencia('2026-10', AGORA)).toBe(true);
    expect(podeFecharCompetencia('2026-11', AGORA)).toBe(false);
    expect(podeFecharCompetencia('2026-11', '2026-11-30T20:00:00')).toBe(true);
  });
});

describe('revisão do W0-04: autoria e associação da ficha de IRAS', () => {
  it('o autor corrige; o de outro só com a permissão (e aí com a senha); sem ela, recusa', () => {
    expect(autoriaDaCorrecao({ autor: 'SINT.ENF ', login: 'sint.enf', podeDeOutro: false })).toBe('autor');
    expect(autoriaDaCorrecao({ autor: 'SINT.ENF', login: 'SINT.CCIH', podeDeOutro: true })).toBe('outro');
    expect(autoriaDaCorrecao({ autor: 'SINT.ENF', login: 'SINT.ENF2', podeDeOutro: false })).toBe(
      'nao-e-autor',
    );
    expect(MENSAGENS_CORRECAO_CCIH['nao-e-autor']).toMatch(/Só quem fez o registro/);
  });

  it('a correção que tira o tipo do sítio, ou a cobertura da data, desfaz a associação da ficha', () => {
    const cvc = { id: 41, tipo: 'cvc', inseridoEm: '2026-10-29T10:00:00', retiradoEm: null };
    const fichas = [
      { id: 3, sitio: 'ipcs', dataInfeccao: '2026-11-01', dispositivo: 41 },
      { id: 4, sitio: 'itu', dataInfeccao: '2026-11-01', dispositivo: null },
    ];
    expect(associacoesDesfeitas({ dispositivo: cvc, outros: [], fichas })).toEqual([]);
    expect(
      associacoesDesfeitas({ dispositivo: { ...cvc, tipo: 'sondaVesical' }, outros: [], fichas }),
    ).toEqual([3]);
    expect(
      associacoesDesfeitas({
        dispositivo: { ...cvc, inseridoEm: '2026-11-01T08:00:00' },
        outros: [],
        fichas,
      }),
    ).toEqual([3]);
    expect(
      associacoesDesfeitas({
        dispositivo: { ...cvc, retiradoEm: '2026-10-30T08:00:00' },
        outros: [],
        fichas,
      }),
    ).toEqual([3]);
    // Outro CVC mais antigo passaria a ser o associado: também muda a associação.
    const antigo = { id: 40, tipo: 'cvc', inseridoEm: '2026-10-25T10:00:00', retiradoEm: null };
    expect(
      associacoesDesfeitas({
        dispositivo: { ...cvc, inseridoEm: '2026-10-29T09:00:00' },
        outros: [antigo],
        fichas,
      }),
    ).toEqual([3]);
  });
});
