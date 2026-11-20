// M44: o editor estruturado do protocolo (regra por condições ↔ JSON Logic, diferença da vigente). Dados SINTÉTICOS.
import { describe, expect, it } from 'vitest';
import {
  codigoDoTitulo,
  condicoesDaRegra,
  diferencaDoProtocolo,
  regraDasCondicoes,
} from './editor-protocolo.js';
import { PROTOCOLO_SINTETICO } from './protocolo-sintetico.js';
import { problemasDaRegra, regraSatisfeita } from './regra.js';

describe('editor estruturado do protocolo', () => {
  it('as condições geram o JSON Logic que o motor avalia, e voltam a ser condições', () => {
    expect(regraDasCondicoes({ juncao: 'and', condicoes: [] })).toBeNull();
    const uma = regraDasCondicoes({
      juncao: 'and',
      condicoes: [{ variavel: 'saturacao', operador: '<', valor: 92 }],
    });
    expect(uma).toEqual({ '<': [{ var: 'saturacao' }, 92] });
    const duas = regraDasCondicoes({
      juncao: 'or',
      condicoes: [
        { variavel: 'fc', operador: '>', valor: 120 },
        { variavel: 'pas', operador: '<=', valor: 90 },
      ],
    });
    expect(problemasDaRegra(duas)).toEqual([]);
    expect(regraSatisfeita(duas, { fc: 90, pas: 85 })).toBe(true);
    expect(regraSatisfeita(duas, { fc: 90, pas: 120 })).toBe(false);
    expect(condicoesDaRegra(duas)).toEqual({
      juncao: 'or',
      condicoes: [
        { variavel: 'fc', operador: '>', valor: 120 },
        { variavel: 'pas', operador: '<=', valor: 90 },
      ],
    });
    expect(condicoesDaRegra(null)).toEqual({ juncao: 'and', condicoes: [] });
    expect(condicoesDaRegra(uma)).toEqual({
      juncao: 'and',
      condicoes: [{ variavel: 'saturacao', operador: '<', valor: 92 }],
    });
    // Toda regra do protocolo de teste é editável por condições.
    for (const d of PROTOCOLO_SINTETICO.discriminadores)
      expect(condicoesDaRegra(d.regra)).not.toBe('avancada');
  });

  it('a regra fora da forma simples fica avançada (só a visão avançada a edita)', () => {
    expect(condicoesDaRegra({ '!': { '<': [{ var: 'fc' }, 50] } })).toBe('avancada');
    expect(condicoesDaRegra({ in: [{ var: 'dor' }, [6, 7]] })).toBe('avancada');
    expect(condicoesDaRegra({ and: [{ or: [{ '<': [{ var: 'fc' }, 50] }] }] })).toBe('avancada');
    expect(condicoesDaRegra({ '<': [{ var: 'desconhecida' }, 1] })).toBe('avancada');
    expect(condicoesDaRegra({ '<': [{ var: 'fc' }, 'x'] })).toBe('avancada');
    expect(condicoesDaRegra({ and: [] })).toBe('avancada');
    expect(condicoesDaRegra(true)).toBe('avancada');
  });

  it('a diferença em relação à vigente: geral, cor, fluxograma e discriminador', () => {
    const p = PROTOCOLO_SINTETICO;
    expect(diferencaDoProtocolo(p, p)).toEqual([]);
    const novo = {
      ...p,
      nome: 'Outro nome',
      cores: p.cores.map((c) => (c.cor === 'amarelo' ? { ...c, tempoAlvoMin: c.tempoAlvoMin + 10 } : c)),
      fluxogramas: [...p.fluxogramas.slice(1), { codigo: 'cefaleia', titulo: 'Cefaleia' }],
      discriminadores: [
        ...p.discriminadores
          .filter((d) => d.fluxograma !== p.fluxogramas[0]!.codigo)
          .map((d, i) => (i === 0 ? { ...d, regra: { '<': [{ var: 'fc' }, 40] } } : d)),
        {
          codigo: 'rigidez',
          fluxograma: 'cefaleia',
          titulo: 'Rigidez de nuca',
          cor: 'laranja' as const,
          regra: null,
          sugereProtocolo: null,
        },
      ],
    };
    const d = diferencaDoProtocolo(p, novo);
    expect(d.find((x) => x.parte === 'geral')).toMatchObject({ acao: 'alterado', campos: ['nome'] });
    expect(d.find((x) => x.parte === 'cor')).toMatchObject({ codigo: 'amarelo', campos: ['tempoAlvoMin'] });
    expect(
      d
        .filter((x) => x.parte === 'fluxograma')
        .map((x) => x.acao)
        .sort(),
    ).toEqual(['incluido', 'removido']);
    expect(
      d.some((x) => x.parte === 'discriminador' && x.acao === 'alterado' && x.campos.includes('regra')),
    ).toBe(true);
    expect(
      d.some((x) => x.parte === 'discriminador' && x.acao === 'incluido' && x.codigo === 'cefaleia/rigidez'),
    ).toBe(true);
    expect(d.some((x) => x.parte === 'discriminador' && x.acao === 'removido')).toBe(true);
    // Sem vigente: tudo incluído, nada de geral.
    const tudo = diferencaDoProtocolo(null, p);
    expect(tudo.every((x) => x.acao === 'incluido')).toBe(true);
    expect(tudo).toHaveLength(p.cores.length + p.fluxogramas.length + p.discriminadores.length);
  });

  it('o código sai do título, sem acento e sem repetir', () => {
    expect(codigoDoTitulo('Dor torácica')).toBe('dor-toracica');
    expect(codigoDoTitulo('Dor torácica', new Set(['dor-toracica']))).toBe('dor-toracica-2');
    expect(codigoDoTitulo('1 Febre')).toBe('febre');
    expect(codigoDoTitulo('!!')).toBe('item');
    expect(codigoDoTitulo('a')).toBe('ax');
  });
});
