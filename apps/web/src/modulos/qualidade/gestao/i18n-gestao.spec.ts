// Textos da gestão da qualidade (M48, etapa 5): nenhum cita o sistema anterior nem tabela, nenhum usa caractere
// especial do vue-i18n, toda recusa tem texto, os estados do vocabulário têm texto e a tela dos envios diz que nenhum
// canal recebe envio automático.
import { CODIGOS_TIPO_ENVIO_REGULATORIO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { mensagensGestaoQualidade as M, RECUSAS_GESTAO } from './i18n-gestao.js';

function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}
const todos = [...textos(M), ...textos(RECUSAS_GESTAO)];

describe('textos da gestão da qualidade', () => {
  it('nenhum texto cita o sistema anterior nem nome de tabela', () => {
    expect(
      todos.filter(([, t]) => /SPDATA|legado|sistema atual|SGH_|RPMATRIZ|TBTPAUTORIDADE|GEANTIMI/i.test(t)),
    ).toEqual([]);
  });

  it('nenhum texto usa "|" nem "@" (plural e ligação do vue-i18n)', () => {
    expect(todos.filter(([, t]) => /[|@]/.test(t))).toEqual([]);
  });

  it('as situações da meta, as polaridades, os programas, os prazos da ouvidoria e as recusas têm texto', () => {
    expect(Object.keys(M.indicadores.situacaoMeta).sort()).toEqual([
      'fora-da-meta',
      'na-meta',
      'sem-meta',
      'sem-valor',
    ]);
    expect(Object.keys(M.indicadores.polaridade).sort()).toEqual([
      'faixa',
      'maior-melhor',
      'menor-melhor',
      'neutra',
    ]);
    expect(Object.keys(M.indicadores.programas).sort()).toEqual(['anahp', 'ona', 'pmQualiss']);
    expect(Object.keys(M.ouvidoria.prazoEstado).sort()).toEqual([
      'cumprido',
      'noPrazo',
      'respondidaComAtraso',
      'vencendo',
      'vencido',
    ]);
    expect(Object.values(RECUSAS_GESTAO).every((t) => t.length > 10)).toBe(true);
    expect(CODIGOS_TIPO_ENVIO_REGULATORIO.length).toBe(3);
  });

  it('as telas dizem as regras que o usuário precisa saber', () => {
    expect(M.envios.explicacao).toMatch(/Nenhum canal recebe envio automático/);
    expect(M.documentos.form.explicacao).toMatch(/tem de ser outra pessoa/);
    expect(M.ouvidoria.explicacao).toMatch(/10 dias úteis/);
    expect(M.ouvidoria.form.anonimaExplicacao).toMatch(/não guarda nome, contato nem paciente/);
  });
});
