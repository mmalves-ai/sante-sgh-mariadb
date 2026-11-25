import { describe, expect, it } from 'vitest';
import {
  recusaAlteracaoFicha,
  recusaCorrecaoExtra,
  recusaEstornoExtra,
  recusaVersaoDaFicha,
  valorNaQuantidade,
} from './correcao-ficha.js';

describe('correção da ficha e do procedimento extra', () => {
  it('a versão lida tem de ser a gravada', () => {
    expect(recusaVersaoDaFicha('v3', 3)).toBeNull();
    expect(recusaVersaoDaFicha('3', 3)).toBeNull();
    expect(recusaVersaoDaFicha('v2', 3)?.codigo).toBe('conflito-versao');
    expect(recusaVersaoDaFicha('x', 3)?.codigo).toBe('conflito-versao');
  });

  it('estorno: só do extra existente e com a conta aberta', () => {
    expect(recusaEstornoExtra({ existe: true, contaAceita: true })).toBeNull();
    expect(recusaEstornoExtra({ existe: false, contaAceita: true })?.codigo).toBe('procedimento-inexistente');
    expect(recusaEstornoExtra({ existe: true, contaAceita: false })?.codigo).toBe('conta-fechada');
  });

  const fatos = {
    existe: true,
    contaAceita: true,
    quantidadeAtual: 2,
    dataAtual: '2026-11-20',
    dataAtendimento: '2026-11-20',
    hoje: '2026-11-24',
  };
  it('correção: data entre a do atendimento e hoje, e algo tem de mudar', () => {
    expect(recusaCorrecaoExtra(fatos, { quantidade: 3 })).toBeNull();
    expect(recusaCorrecaoExtra(fatos, { data: '2026-11-22' })).toBeNull();
    expect(recusaCorrecaoExtra(fatos, { data: '2026-11-19' })?.codigo).toBe('data-fora-do-atendimento');
    expect(recusaCorrecaoExtra(fatos, { data: '2026-11-25' })?.codigo).toBe('data-fora-do-atendimento');
    expect(recusaCorrecaoExtra(fatos, { quantidade: 2, data: '2026-11-20' })?.codigo).toBe('nada-a-corrigir');
    expect(recusaCorrecaoExtra({ ...fatos, contaAceita: false }, { quantidade: 3 })?.codigo).toBe(
      'conta-fechada',
    );
  });

  it('o valor acompanha a quantidade, em centavos', () => {
    expect(valorNaQuantidade(80, 1, 3)).toBe(240);
    expect(valorNaQuantidade(100, 3, 1)).toBe(33.33);
    expect(valorNaQuantidade(10, 0, 2)).toBe(0);
  });

  it('ficha: nada a alterar recusa; convênio com conta vai ao faturamento', () => {
    expect(recusaAlteracaoFicha({ mudaAlgo: false, mudaConvenio: false, temConta: true })?.codigo).toBe(
      'nada-a-alterar',
    );
    expect(recusaAlteracaoFicha({ mudaAlgo: true, mudaConvenio: true, temConta: true })?.codigo).toBe(
      'troca-de-conta',
    );
    expect(recusaAlteracaoFicha({ mudaAlgo: true, mudaConvenio: true, temConta: false })).toBeNull();
    expect(recusaAlteracaoFicha({ mudaAlgo: true, mudaConvenio: false, temConta: true })).toBeNull();
  });
});
