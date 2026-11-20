import { QueryClient } from '@tanstack/vue-query';
import { describe, expect, it } from 'vitest';
import { CHAVE_SESSAO, aposTrocar, permissoesEfetivas } from './sessao.js';

describe('troca de estabelecimento (regra 13)', () => {
  it('limpa todo o cache do TanStack Query e guarda só a sessão nova (mesma consulta, dado novo)', () => {
    const cliente = new QueryClient();
    cliente.setQueryData(['qualquer', 'dado', 'do', 'banco', 'anterior'], { x: 1 });
    cliente.setQueryData(CHAVE_SESSAO, { estabelecimentoAtivo: 'aa' });
    const consultaDaSessao = cliente.getQueryCache().find({ queryKey: CHAVE_SESSAO });
    const nova = {
      usuario: { id: 's', nome: 'Sintético' },
      rede: null,
      estabelecimentos: [{ codigo: 'bb', nome: 'B' }],
      estabelecimentoAtivo: 'bb',
      permissoes: [],
      sintetica: true,
      bloqueioInatividadeSegundos: 0,
    };
    aposTrocar(cliente, nova);
    expect(cliente.getQueryData(['qualquer', 'dado', 'do', 'banco', 'anterior'])).toBeUndefined();
    expect(cliente.getQueryData(CHAVE_SESSAO)).toEqual(nova);
    expect(cliente.getQueryCache().getAll()).toHaveLength(1);
    expect(cliente.getQueryCache().find({ queryKey: CHAVE_SESSAO })).toBe(consultaDaSessao);
  });
});

describe('chave de liberação do prontuário (M15, ficha seção 12)', () => {
  it('desligada: tira a permissão do prontuário (menu, paleta e guarda escondem); ligada ou sem resposta: mantém', () => {
    const da = ['pep.prontuario.ler', 'auditoria.acessos.ler', 'cadastro.paciente.ler'];
    expect([...permissoesEfetivas(da, { prontuario: true })].sort()).toEqual([
      'auditoria.acessos.ler',
      'cadastro.paciente.ler',
    ]);
    expect(permissoesEfetivas(da, { prontuario: false }).has('pep.prontuario.ler')).toBe(true);
  });
});
