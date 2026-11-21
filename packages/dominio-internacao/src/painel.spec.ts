// Regra 1: ocupado = o leito marca a internação (como o legado), conferido com as internações em aberto; a
// diferença vira aviso. Regra 4: a terapia intensiva destacada (pelo trecho; sem trecho, pela acomodação).
import { describe, expect, it } from 'vitest';
import { em } from './massa.spec-util.js';
import { leitoAtivoPainel, montarPainel } from './painel.js';
import { leituras } from './painel.spec-util.js';

const op = {
  intensivas: [3, 7],
  agora: em('2026-10-21', '10:00'),
  lidoEm: '2026-10-21T13:00:00.000Z',
  dadosAte: '2026-10-21T13:00:00.000Z',
  destino: 'memoria' as const,
};

describe('painel de leitos', () => {
  const p = montarPainel(leituras(), op);

  it('grade por bloco e acomodação, com totais; bloco sem leito não aparece', () => {
    expect(p.blocos.map((b) => b.bloco)).toEqual(['1', '2', '7']);
    expect(p.blocos[0]?.acomodacoes[0]?.leitos.map((l) => l.situacao)).toEqual([
      'ocupado',
      'livre',
      'inativo',
    ]);
    expect(p.totais).toMatchObject({
      leitos: 6,
      ativos: 5,
      inativos: 1,
      ocupados: 4,
      livres: 1,
      ocupacao: 80,
    });
    expect(p.totais.intensivos).toMatchObject({ leitos: 2, ocupados: 2 });
    expect(p.blocos[2]).toMatchObject({
      nome: '7',
      acomodacoes: [{ nome: 'X', tipo: null, intensiva: false }],
    });
  });

  it('o cartão: iniciais, idade, sexo, dias e convênio; terapia intensiva pelo tipo', () => {
    const c1 = p.blocos[0]?.acomodacoes[0]?.leitos[0]?.cartao;
    expect(c1).toEqual({
      internacao: 501,
      iniciais: 'MSO',
      idade: 76,
      sexo: 'F',
      diasInternacao: 10,
      convenio: 'CONVÊNIO SINTÉTICO',
      tipoTrecho: { id: 1, nome: 'Enfermaria' },
      intensivo: false,
    });
    const c2 = p.blocos[1]?.acomodacoes[0]?.leitos[0]?.cartao;
    expect(c2).toMatchObject({
      idade: null,
      sexo: null,
      convenio: null,
      tipoTrecho: { id: 3 },
      intensivo: true,
    });
    const c3 = p.blocos[2]?.acomodacoes[0]?.leitos[0]?.cartao;
    expect(c3).toMatchObject({
      iniciais: 'ABCDEFGH',
      sexo: 'M',
      convenio: null,
      intensivo: true,
      tipoTrecho: { nome: 'Tipo 7' },
    });
  });

  it('as diferenças entre o leito e a internação viram avisos', () => {
    expect(p.avisos.map((a) => [a.tipo, a.chave])).toEqual([
      ['leito-inativo-ocupado', '2/UTI/02'],
      ['leito-ocupado-sem-internacao', '2/UTI/02'],
      ['leito-com-outra-internacao', '7/X/01'],
      ['internacao-sem-leito-ocupado', '504'],
    ]);
  });

  it('sem leito ativo, a ocupação é nula; situação vazia conta como ativa', () => {
    const l = leituras();
    const vazio = montarPainel({ ...l, leitos: [], abertas: [] }, op);
    expect(vazio.totais.ocupacao).toBeNull();
    expect(leitoAtivoPainel('')).toBe(true);
    expect(leitoAtivoPainel(null)).toBe(true);
    expect(leitoAtivoPainel('I ')).toBe(false);
  });
});
