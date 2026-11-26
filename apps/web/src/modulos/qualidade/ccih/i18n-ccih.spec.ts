// Textos da CCIH (M48, etapa 3): nenhum cita o sistema anterior nem tabela, nenhum usa caractere especial do
// vue-i18n, toda recusa da API tem texto e toda tela da navegação tem rótulo.
import { describe, expect, it } from 'vitest';
import { mensagensCcih, RECUSAS_CCIH } from './i18n-ccih.js';

function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}

const todos = [...textos(mensagensCcih), ...textos(RECUSAS_CCIH)];

describe('textos da CCIH', () => {
  it('nenhum texto cita o sistema anterior nem nome de tabela', () => {
    expect(
      todos.filter(([, t]) =>
        /SPDATA|legado|sistema atual|SGH_|RICADINT|PRPRESC|SILANEXA|GEANTIMI|GELANSAI/i.test(t),
      ),
    ).toEqual([]);
  });

  it('nenhum texto usa "|" nem "@" (plural e ligação do vue-i18n)', () => {
    expect(todos.filter(([, t]) => /[|@]/.test(t))).toEqual([]);
  });

  it('as telas da navegação e as origens da precaução têm texto', () => {
    expect(Object.keys(mensagensCcih.telas).sort()).toEqual([
      'antimicrobianos',
      'auditoriaAntimicrobiano',
      'culturas',
      'iras',
      'maosSurtos',
      'notificacao',
      'precaucoes',
      'vigilancia',
    ]);
    expect(Object.keys(mensagensCcih.precaucoes.origens).sort()).toEqual(['manual', 'microbiologia']);
  });

  it('o alerta ao prescritor diz que a prescrição não é suspensa', () => {
    expect(mensagensCcih.alerta.explicacao).toMatch(/segue valendo/);
    expect(mensagensCcih.antimicrobianos.explicacao).toMatch(/nunca suspende/);
  });
});
