// Textos da notificação compulsória (M48, etapa 4): nenhum cita o sistema anterior nem tabela, nenhum usa caractere
// especial do vue-i18n, toda recusa tem texto e as partes da tela têm rótulo.
import { describe, expect, it } from 'vitest';
import { mensagensAgravos, RECUSAS_AGRAVO } from './i18n-agravo.js';

function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}

const todos = [...textos(mensagensAgravos), ...textos(RECUSAS_AGRAVO)];

describe('textos da notificação compulsória', () => {
  it('nenhum texto cita o sistema anterior nem nome de tabela', () => {
    expect(
      todos.filter(([, t]) =>
        /SPDATA|legado|sistema atual|SGH_|TBCID10|PRAGRAVO|HTCID|SILANEXA|ATCABECATEND|RICADINT/i.test(t),
      ),
    ).toEqual([]);
  });

  it('nenhum texto usa "|" nem "@" (plural e ligação do vue-i18n)', () => {
    expect(todos.filter(([, t]) => /[|@]/.test(t))).toEqual([]);
  });

  it('as abas e os estados do prazo têm texto; toda recusa da API tem texto', () => {
    expect(Object.keys(mensagensAgravos.abas).sort()).toEqual(['casos', 'fila', 'lista', 'rotulo']);
    expect(Object.keys(mensagensAgravos.prazo).sort()).toEqual([
      'cumprido',
      'naoSeAplica',
      'titulo',
      'venceEm',
      'vencidoHa',
    ]);
    expect(Object.values(RECUSAS_AGRAVO).every((t) => t.length > 10)).toBe(true);
  });

  it('a tela diz que quem decide abrir o caso é a vigilância e que o Sinan não recebe envio automático', () => {
    expect(mensagensAgravos.explicacao).toMatch(/Quem decide abrir o caso é a vigilância/);
    expect(mensagensAgravos.notificar.explicacao).toMatch(/não recebe envio automático/);
  });
});
