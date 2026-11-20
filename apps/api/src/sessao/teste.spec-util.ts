// Utilidades dos testes da sessão (M05): ambiente sintético (sem banco, sem dado pessoal) e o serviço
// montado sobre a fonte sintética e o armazém em memória.
import { ArmazemMemoria, type ArmazemSessao } from './armazem.js';
import type { FonteAcesso } from './fonte-acesso.js';
import { ServicoSessao, type ConfigServicoSessao } from './servico-sessao.js';
import { FonteAcessoSintetica } from '../modulos/acesso/fonte-sintetica.js';

export const REDE = 'rede-teste';
export const SENHA = 'Sintetico#2026';

export const envTeste = {
  AMBIENTE: 'ci',
  PRODUTO_NOME: 'Produto de teste',
  REDE_PADRAO: REDE,
  ESTABELECIMENTOS: 'aa,bb',
  FB_AA_HOST: '127.0.0.1',
  FB_AA_PORTA: '1',
  FB_AA_BANCO: '/x/aa.fdb',
  FB_AA_USUARIO: 'U',
  FB_AA_NOME: 'Estabelecimento A (teste)',
  FB_BB_HOST: '127.0.0.1',
  FB_BB_PORTA: '2',
  FB_BB_BANCO: '/x/bb.fdb',
  FB_BB_USUARIO: 'U',
  FB_BB_NOME: 'Estabelecimento B (teste)',
};

export function montar(
  opcoes: {
    agora?: () => number;
    fonte?: FonteAcesso;
    armazem?: ArmazemSessao;
    config?: ConfigServicoSessao;
  } = {},
): { servico: ServicoSessao; fonte: FonteAcesso; armazem: ArmazemSessao } {
  const agora = opcoes.agora ?? (() => Date.now());
  const fonte = opcoes.fonte ?? new FonteAcessoSintetica(envTeste);
  const armazem = opcoes.armazem ?? new ArmazemMemoria(agora);
  return { servico: new ServicoSessao(fonte, armazem, agora, opcoes.config), fonte, armazem };
}

export const entrada = (login: string, senha: string = SENHA, estabelecimento = 'aa') => ({
  estabelecimento,
  login,
  senha,
});
