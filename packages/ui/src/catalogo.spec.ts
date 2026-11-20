import { describe, expect, it } from 'vitest';
import { HISTORIAS } from '../catalogo/historias.js';
import * as ui from './componentes.js';

describe('catálogo visual', () => {
  it('há história para cada componente de domínio exportado (Sante*)', () => {
    const componentes = Object.keys(ui).filter((n) => n.startsWith('Sante'));
    const cobertos = new Set(HISTORIAS.map((h) => h.componente));
    expect(componentes.filter((c) => !cobertos.has(c))).toEqual([]);
    expect(new Set(HISTORIAS.map((h) => h.id)).size).toBe(HISTORIAS.length);
  });

  it('cabeçalho do paciente tem uma história para cada estado de alergia (regra 11)', () => {
    expect(HISTORIAS.filter((h) => h.componente === 'SanteCabecalhoPaciente').map((h) => h.id)).toEqual([
      'paciente-nao-avaliadas',
      'paciente-alergias',
      'paciente-nega',
    ]);
  });
});
