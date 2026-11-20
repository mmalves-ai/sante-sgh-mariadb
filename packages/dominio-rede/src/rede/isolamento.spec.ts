// Isolamento da rede (M57, regra 12; ARQ-1, ARQ-2): sem o código da rede, falha; rede de outra hospedagem, falha; par
// com estabelecimento fora da lista configurada, falha. A lista vem da configuração, nunca fixa.
import { describe, expect, it } from 'vitest';
import { conferirParNaRede, ErroIsolamentoRede, estabelecimentosDaRede } from './isolamento.js';

describe('isolamento da rede', () => {
  it('consulta sem o código da rede falha', () => {
    for (const redeSessao of [null, undefined, '', '  '])
      expect(() =>
        estabelecimentosDaRede({ redeSessao, redeConfigurada: 'santa', estabelecimentos: ['pc'] }),
      ).toThrow(expect.objectContaining({ codigo: 'rede-ausente' }));
  });

  it('rede diferente da configurada falha', () => {
    expect(() =>
      estabelecimentosDaRede({ redeSessao: 'outra', redeConfigurada: 'santa', estabelecimentos: ['pc'] }),
    ).toThrow(ErroIsolamentoRede);
  });

  it('a lista é a configurada (sem repetição, em ordem), com qualquer número de estabelecimentos', () => {
    expect(
      estabelecimentosDaRede({
        redeSessao: 'santa',
        redeConfigurada: 'santa',
        estabelecimentos: ['pc', 'hs', 'pc', 'x1'],
      }),
    ).toEqual(['hs', 'pc', 'x1']);
  });

  it('par com estabelecimento fora da rede falha', () => {
    expect(() => conferirParNaRede('hs:1|pc:2', ['hs', 'pc'])).not.toThrow();
    expect(() => conferirParNaRede('pc:2|zz:1', ['hs', 'pc'])).toThrow(
      expect.objectContaining({ codigo: 'fora-da-rede' }),
    );
  });
});
