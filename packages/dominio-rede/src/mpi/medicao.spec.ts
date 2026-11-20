// Medição só em agregados (M57, seção 10): contagens por destino e por faixa; 1 a 4 vira "<5".
import { describe, expect, it } from 'vitest';
import type { DecisaoPar } from './automatico.js';
import { contagemSegura, resumirPareamento } from './medicao.js';

const d = (destino: DecisaoPar['destino'], pontuacao = 0): DecisaoPar => ({
  destino,
  pontuacao,
  criterios: [],
  divergencias: [],
  motivo: '',
});

describe('medição', () => {
  it('conta por destino e a fila por faixa', () => {
    const r = resumirPareamento([
      d('vincular_automatico', 90),
      d('fila', 90),
      d('fila', 72),
      d('fila', 55),
      d('fila', 40),
      d('descartar', 10),
      d('fila_duplicidade_local'),
      d('inelegivel'),
      d('ja_decidido', 90),
    ]);
    expect(r).toEqual({
      pares: 9,
      automaticos: 1,
      naFila: 4,
      descartados: 1,
      duplicadosLocais: 1,
      inelegiveis: 1,
      jaDecididos: 1,
      filaPorFaixa: { alta: 1, media: 1, baixa: 2 },
    });
  });

  it('contagem segura', () => {
    expect(contagemSegura(0)).toBe('0');
    expect(contagemSegura(1)).toBe('<5');
    expect(contagemSegura(4)).toBe('<5');
    expect(contagemSegura(5)).toBe('5');
  });
});
