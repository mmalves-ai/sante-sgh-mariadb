// Os textos do ponto não citam o sistema antigo nem tabela (ADR 0023), dizem que a marcação original nunca muda (regra
// 11) e que o arquivo com defeito fica inteiro em quarentena (regra 12).
import { describe, expect, it } from 'vitest';
import { mensagensPonto } from './i18n.js';

function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}

describe('textos do ponto', () => {
  it('nenhum texto cita o sistema antigo nem nome de tabela', () => {
    const achados = textos(mensagensPonto).filter(
      ([, t]) =>
        /spdata|legado|sistema atual|sistema antigo/i.test(t) ||
        /\bTB[A-Z]{3,}|\bP[EO][A-Z_]{3,}|SGH_/.test(t),
    );
    expect(achados).toEqual([]);
  });
  it('a marcação original nunca muda e a quarentena é do arquivo inteiro', () => {
    expect(mensagensPonto.ajustes.ajuda).toMatch(/nunca muda/);
    expect(mensagensPonto.importacao.ajuda).toMatch(/fica em quarentena e nenhuma marcação entra/);
  });
});
