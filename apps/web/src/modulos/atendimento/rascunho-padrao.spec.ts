import { describe, expect, it } from 'vitest';
import { recarregarRascunho } from './rascunho-padrao.js';

const lido = (v: Record<string, number | null>) => Object.entries(v).map(([campo, id]) => ({ campo, id }));

describe('releitura dos valores habituais na tela', () => {
  it('primeira carga: vale o que veio do servidor', () => {
    expect(recarregarRascunho({}, lido({ unidade: 1, convenio: null }), undefined)).toEqual({
      unidade: '1',
      convenio: '',
    });
  });

  it('gravar o estabelecimento não apaga a escolha pessoal pendente', () => {
    // Pessoal lido vazio; a pessoa escolheu o centro de custo e ainda não gravou; a releitura traz o pessoal vazio.
    const antes = lido({ unidade: null, centroCusto: null });
    const naTela = { unidade: '', centroCusto: '300600' };
    expect(recarregarRascunho(naTela, lido({ unidade: null, centroCusto: null }), antes)).toEqual({
      unidade: '',
      centroCusto: '300600',
    });
  });

  it('o escopo gravado mostra o valor gravado; o campo não mexido recebe o que outra estação gravou', () => {
    const antes = lido({ unidade: null, convenio: null, especialidade: 5 });
    const naTela = { unidade: '1', convenio: '', especialidade: '5' };
    expect(recarregarRascunho(naTela, lido({ unidade: 1, convenio: 320, especialidade: 5 }), antes)).toEqual({
      unidade: '1',
      convenio: '320',
      especialidade: '5',
    });
  });

  it('limpar um valor gravado é mudança pendente e fica vazio', () => {
    const antes = lido({ unidade: 1 });
    expect(recarregarRascunho({ unidade: '' }, lido({ unidade: 1 }), antes)).toEqual({ unidade: '' });
  });

  it('campo novo na releitura recebe o valor do servidor', () => {
    expect(recarregarRascunho({}, lido({ plano: 7 }), [])).toEqual({ plano: '7' });
  });
});
