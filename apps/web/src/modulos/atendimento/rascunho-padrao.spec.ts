import { describe, expect, it } from 'vitest';
import { recarregarRascunho } from './rascunho-padrao.js';

const valores = (...a: Parameters<typeof recarregarRascunho>) => recarregarRascunho(...a).valores;

const lido = (v: Record<string, number | null>) => Object.entries(v).map(([campo, id]) => ({ campo, id }));

describe('releitura dos valores habituais na tela', () => {
  it('primeira carga: vale o que veio do servidor', () => {
    expect(valores({}, lido({ unidade: 1, convenio: null }), undefined)).toEqual({
      unidade: '1',
      convenio: '',
    });
  });

  it('gravar o estabelecimento não apaga a escolha pessoal pendente', () => {
    // Pessoal lido vazio; a pessoa escolheu o centro de custo e ainda não gravou; a releitura traz o pessoal vazio.
    const antes = lido({ unidade: null, centroCusto: null });
    const naTela = { unidade: '', centroCusto: '300600' };
    expect(valores(naTela, lido({ unidade: null, centroCusto: null }), antes)).toEqual({
      unidade: '',
      centroCusto: '300600',
    });
  });

  it('o escopo gravado mostra o valor gravado; o campo não mexido recebe o que outra estação gravou', () => {
    const antes = lido({ unidade: null, convenio: null, especialidade: 5 });
    const naTela = { unidade: '1', convenio: '', especialidade: '5' };
    expect(valores(naTela, lido({ unidade: 1, convenio: 320, especialidade: 5 }), antes)).toEqual({
      unidade: '1',
      convenio: '320',
      especialidade: '5',
    });
  });

  it('limpar um valor gravado é mudança pendente e fica vazio', () => {
    const antes = lido({ unidade: 1 });
    expect(valores({ unidade: '' }, lido({ unidade: 1 }), antes)).toEqual({ unidade: '' });
  });

  it('campo novo na releitura recebe o valor do servidor', () => {
    expect(valores({}, lido({ plano: 7 }), [])).toEqual({ plano: '7' });
  });

  it('conflito: a pessoa mudou e outra estação gravou outro valor no mesmo campo; vale o gravado, com aviso', () => {
    // Lido: convênio 10. A pessoa escolheu 20 e não gravou; outra estação gravou 30. A gravação foi recusada pela versão.
    const antes = lido({ convenio: 10, unidade: 1 });
    const r = recarregarRascunho({ convenio: '20', unidade: '2' }, lido({ convenio: 30, unidade: 1 }), antes);
    expect(r.valores).toEqual({ convenio: '30', unidade: '2' });
    expect(r.conflitos).toEqual([{ campo: 'convenio', naTela: '20', gravado: '30' }]);
  });

  it('conflito ao limpar: a pessoa limpou e outra estação gravou outro valor', () => {
    const r = recarregarRascunho({ convenio: '' }, lido({ convenio: 30 }), lido({ convenio: 10 }));
    expect(r.valores).toEqual({ convenio: '30' });
    expect(r.conflitos).toEqual([{ campo: 'convenio', naTela: '', gravado: '30' }]);
  });

  it('sem conflito quando a outra gravação chegou ao mesmo valor da tela', () => {
    const r = recarregarRascunho({ convenio: '20' }, lido({ convenio: 20 }), lido({ convenio: 10 }));
    expect(r).toEqual({ valores: { convenio: '20' }, conflitos: [] });
  });

  it('a mudança pendente sem conflito não gera aviso', () => {
    const r = recarregarRascunho(
      { centroCusto: '300600' },
      lido({ centroCusto: null }),
      lido({ centroCusto: null }),
    );
    expect(r.conflitos).toEqual([]);
  });
});
