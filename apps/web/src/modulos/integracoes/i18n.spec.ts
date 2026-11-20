// Os textos das integrações não mostram chave técnica de parâmetro (ex.: `integracao.halaiEndereco`) ao usuário:
// a tela aponta para os Parâmetros do sistema pelo link (correção da revisão do M34).
import { describe, expect, it } from 'vitest';
import { mensagensIntegracoes } from './i18n.js';

function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}

describe('textos das integrações', () => {
  it('nenhum texto expõe a chave técnica de um parâmetro (modulo.chaveCamelCase)', () => {
    const chaves = textos(mensagensIntegracoes).filter(([, t]) =>
      /\b(?:integracao|relatorio|sadt)\.[a-z]+[A-Z][A-Za-z]*\b/.test(t),
    );
    expect(chaves).toEqual([]);
  });

  it('sem endereço da Hal-AI, o texto diz "não configurado" e o link leva aos parâmetros', () => {
    expect(mensagensIntegracoes.mensagens.semEndereco).toBe('não configurado');
    expect(mensagensIntegracoes.mensagens.configurarEndereco).toMatch(/parâmetros do sistema/i);
  });
});
