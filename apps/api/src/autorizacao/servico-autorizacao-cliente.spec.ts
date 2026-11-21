// F2-L: um banco por cliente. O cache das permissões e as gerações levam o cliente na chave: dois clientes com a
// mesma rede, o mesmo estabelecimento e o mesmo login não dividem cache nem invalidação. E o acesso total vem só
// do ator da plataforma, no cliente escolhido. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { ArmazemMemoria } from '../sessao/armazem.js';
import type { AtorPlataforma } from '../sessao/tipos-acesso.js';
import {
  type DadosAutorizacao,
  ServicoAutorizacao,
  autorizacaoAcessoTotal,
  autorizacaoDoAtorPlataforma,
} from './servico-autorizacao.js';

const OPCAO_PEP = 5181;
const ESCOPOS = {
  unidades: [],
  locais: [],
  convenios: [],
  centrosCusto: [],
  locaisEstoque: [],
  contasBancarias: [],
  tiposAgenda: [],
  tiposProntuario: [],
};

function fonte(opcoes: () => number[]) {
  let leituras = 0;
  return {
    get leituras() {
      return leituras;
    },
    dadosDeAutorizacao: (): Promise<DadosAutorizacao> => {
      leituras++;
      return Promise.resolve({
        concessoes: {
          grupo: 'MEDICOS',
          opcoesGrupo: opcoes(),
          opcoesPapel: [],
          papeis: [4],
          flags: [],
          conselho: true,
        },
        escopos: ESCOPOS,
        restricaoVinculo: false,
        perfisConcedidos: [],
        mapaPerfis: [],
      });
    },
  };
}

describe('cache de permissões por cliente', () => {
  it('mesma rede, mesmo estabelecimento e mesmo login em dois clientes: um não vê o cache do outro', async () => {
    const t = 1_000_000;
    const armazem = new ArmazemMemoria(() => t);
    const fa = fonte(() => [OPCAO_PEP]);
    const fb = fonte(() => []);
    const a = new ServicoAutorizacao(fa, armazem, () => t, null, 'cliente_a');
    const b = new ServicoAutorizacao(fb, armazem, () => t, null, 'cliente_b');
    const pa = (await a.obter('rede', '1', 'ADMIN')).permissoes;
    const pb = (await b.obter('rede', '1', 'ADMIN')).permissoes;
    expect(pa).toContain('pep.movimentacoesEvolucao.ler');
    expect(pb).not.toContain('pep.movimentacoesEvolucao.ler');
    expect([fa.leituras, fb.leituras]).toEqual([1, 1]);
    // Em cache, cada um no seu.
    await a.obter('rede', '1', 'ADMIN');
    await b.obter('rede', '1', 'ADMIN');
    expect([fa.leituras, fb.leituras]).toEqual([1, 1]);
    // Invalidar o login no cliente B não derruba o cache do cliente A.
    await b.invalidar('rede', '1', 'ADMIN');
    await a.obter('rede', '1', 'ADMIN');
    await b.obter('rede', '1', 'ADMIN');
    expect([fa.leituras, fb.leituras]).toEqual([1, 2]);
    // Nem a invalidação do estabelecimento.
    await b.invalidarEstabelecimento('rede', '1');
    await a.obter('rede', '1', 'ADMIN');
    expect(fa.leituras).toBe(1);
  });
});

describe('ator da plataforma (decisão do dono 2026-11-20, b)', () => {
  const ator: AtorPlataforma = { tipo: 'plataforma', idAdministrador: 1, nomeExibicao: 'Admin', cliente: 'cliente_a' };

  it('recebe o acesso total no cliente escolhido no login', () => {
    expect(autorizacaoDoAtorPlataforma(ator, 'cliente_a', 5).permissoes).toEqual(
      autorizacaoAcessoTotal(5).permissoes,
    );
  });

  it('em outro cliente, recusa (falha fechada)', () => {
    expect(() => autorizacaoDoAtorPlataforma(ator, 'cliente_b', 5)).toThrow();
  });
});
