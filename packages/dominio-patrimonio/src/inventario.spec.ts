// Regra 13 do M54 (inventário): cada leitura classificada; a divergência registrada, nada corrigido sozinho.
import { describe, expect, it } from 'vitest';
import {
  type BemParaInventario,
  lerResumoGravado,
  resultadoDaLeitura,
  resumoDoInventario,
  resumoParaGravar,
  TETO_NAO_ENCONTRADOS_GUARDADOS,
} from './inventario.js';

const bem = (id: number, extra: Partial<BemParaInventario> = {}): BemParaInventario => ({
  id,
  plaqueta: `PC${String(id).padStart(6, '0')}`,
  descricao: `Bem ${id}`,
  centro: 10,
  situacao: 'ativo',
  ...extra,
});

describe('regra 13: leitura do inventário', () => {
  it('classifica a leitura', () => {
    const lidos = new Set([3]);
    expect(resultadoDaLeitura(bem(1), 10, lidos)).toBe('conforme');
    expect(resultadoDaLeitura(bem(1), 20, lidos)).toBe('outro-local');
    expect(resultadoDaLeitura(null, 10, lidos)).toBe('nao-cadastrado');
    expect(resultadoDaLeitura(bem(3), 10, lidos)).toBe('repetida');
    expect(resultadoDaLeitura(bem(4, { situacao: 'baixado' }), 10, lidos)).toBe('baixado');
    expect(resultadoDaLeitura(bem(5, { situacao: 'emprestado' }), 10, lidos)).toBe('emprestado');
  });

  it('o resumo conta cada resultado e lista os esperados não encontrados (sem corrigir nada)', () => {
    const esperados = [bem(1), bem(2), bem(3)];
    const r = resumoDoInventario(esperados, [
      { bem: 1, resultado: 'conforme' },
      { bem: 1, resultado: 'repetida' },
      { bem: 3, resultado: 'outro-local' },
      { bem: null, resultado: 'nao-cadastrado' },
    ]);
    expect(r).toEqual({
      esperados: 3,
      leituras: 4,
      porResultado: {
        conforme: 1,
        'outro-local': 1,
        'nao-cadastrado': 1,
        baixado: 0,
        emprestado: 0,
        repetida: 1,
      },
      naoEncontrados: [{ bem: 2, plaqueta: 'PC000002', descricao: 'Bem 2', centro: 10 }],
      naoEncontradosTotal: 1,
      listaCompleta: true,
    });
    const gravado = resumoParaGravar(r);
    expect(gravado.length).toBeLessThanOrEqual(2000);
    expect(lerResumoGravado(gravado)).toEqual({
      ...r,
      naoEncontrados: [{ bem: 2, plaqueta: 'PC000002', descricao: '', centro: 0 }],
    });
  });

  it('o resumo gravado corta a lista longa e marca incompleta (a contagem fica inteira)', () => {
    const esperados = Array.from({ length: 400 }, (_, i) =>
      bem(1_000_000 + i, { plaqueta: `PLAQUETA-LONGA-${i}` }),
    );
    const r = resumoDoInventario(esperados, []);
    const g = resumoParaGravar(r);
    expect(g.length).toBeLessThanOrEqual(2000);
    const lido = lerResumoGravado(g);
    expect(lido?.naoEncontradosTotal).toBe(400);
    expect(lido?.listaCompleta).toBe(false);
    expect(lido?.naoEncontrados.length).toBeLessThan(TETO_NAO_ENCONTRADOS_GUARDADOS);
    expect(lerResumoGravado(null)).toBeNull();
    expect(lerResumoGravado('{')).toBeNull();
  });
});
