// Divergência entre os índices dos bancos (M57, regra 4): queda entre as duas gravações, desfazer pela metade e pessoa
// diferente; o reparo grava o espelho da mudança mais recente e, rodado de novo, não acha nada.
import { describe, expect, it } from 'vitest';
import { compararIndices, planejarReparo } from './divergencia.js';
import { espelho, type VinculoIndice } from './indice.js';
import { linha, PESSOA_2 } from './indice.spec-util.js';

const EST = ['hs', 'pc'];
const mapa = (pc: VinculoIndice[], hs: VinculoIndice[]) =>
  new Map<string, VinculoIndice[]>([
    ['pc', pc],
    ['hs', hs],
  ]);

function aplicar(m: Map<string, VinculoIndice[]>, linhas: VinculoIndice[]): Map<string, VinculoIndice[]> {
  const r = new Map([...m].map(([k, v]) => [k, [...v]]));
  for (const l of linhas) {
    const lista = (r.get(l.estabelecimento) ?? []).filter((x) => x.chave !== l.chave);
    lista.push(l);
    r.set(l.estabelecimento, lista);
  }
  return r;
}

describe('divergência', () => {
  it('índices iguais: 0 divergência', () => {
    expect(compararIndices(EST, mapa([linha()], [espelho(linha())]))).toEqual([]);
  });

  it('queda entre as duas gravações: ausente em um banco; o reparo grava o espelho e zera a divergência', () => {
    const m = mapa([linha()], []);
    const d = compararIndices(EST, m);
    expect(d).toEqual([
      {
        chave: 'hs:909|pc:101',
        tipo: 'ausente_em_um_banco',
        porBanco: [
          { estabelecimento: 'hs', situacao: null, pessoa: null },
          { estabelecimento: 'pc', situacao: 'ativo', pessoa: linha().pessoa },
        ],
      },
    ]);
    const r = planejarReparo(d, m);
    expect(r.manuais).toEqual([]);
    expect(r.planos).toHaveLength(1);
    expect(r.planos[0]!.bancos.map((b) => b.estabelecimento)).toEqual(['hs']);
    const gravadas = r.planos.flatMap((p) =>
      p.bancos.flatMap((b) => b.escritas.flatMap((e) => (e.tabela === 'SGH_REDE_VINCULO' ? [e.linha] : []))),
    );
    expect(compararIndices(EST, aplicar(m, gravadas))).toEqual([]);
  });

  it('situação diferente: prevalece a mudança mais recente (o desfazer depois do vínculo)', () => {
    const desfeita = linha({
      situacao: 'desfeito',
      desfeitoEm: '2026-10-24T12:00:00.000Z',
      desfeitoPor: 'X',
    });
    const m = mapa([desfeita], [espelho(linha())]);
    const d = compararIndices(EST, m);
    expect(d.map((x) => x.tipo)).toEqual(['situacao_diferente']);
    const r = planejarReparo(d, m);
    const alvo = r.planos[0]!.bancos[0]!;
    expect(alvo.estabelecimento).toBe('hs');
    const v = alvo.escritas.find((e) => e.tabela === 'SGH_REDE_VINCULO');
    expect(v && v.tabela === 'SGH_REDE_VINCULO' && v.linha.situacao).toBe('desfeito');
  });

  it('pessoa diferente: não repara sozinho, vai para revisão humana', () => {
    const m = mapa([linha()], [espelho(linha({ pessoa: PESSOA_2 }))]);
    const d = compararIndices(EST, m);
    expect(d.map((x) => x.tipo)).toEqual(['pessoa_diferente']);
    expect(planejarReparo(d, m)).toEqual({ planos: [], manuais: ['hs:909|pc:101'] });
  });

  it('ignora banco e par fora da rede, e linha guardada no banco errado', () => {
    const fora = linha({ chave: 'pc:101|zz:3', estabelecimentoRemoto: 'zz', idRemoto: 3 });
    const m = new Map<string, VinculoIndice[]>([
      ['pc', [fora, linha({ estabelecimento: 'hs' })]],
      ['zz', [espelho(fora)]],
    ]);
    expect(compararIndices(EST, m)).toEqual([]);
  });
});
