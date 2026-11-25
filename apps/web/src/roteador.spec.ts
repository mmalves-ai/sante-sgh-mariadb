// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { criarRoteador, rotas, rotasSemPermissao } from './roteador.js';

const sessao = (permissoes: string[]) => async () => ({
  usuario: { id: 's', nome: 'S' },
  rede: null,
  estabelecimentos: [],
  estabelecimentoAtivo: null,
  permissoes,
  sintetica: true,
  bloqueioInatividadeSegundos: 0,
});

describe('rotas e guarda de permissão', () => {
  it('toda rota tem meta.permissao (ou é pública por decisão explícita)', () => {
    expect(rotasSemPermissao(rotas(true))).toEqual([]);
    expect(rotas(false).some((r) => r.path === '/demonstracao')).toBe(false);
  });

  it('sem a permissão, vai para "sem permissão"; com ela, abre', async () => {
    const r = criarRoteador(sessao(['acesso.inicio.ler']), {
      historico: createMemoryHistory(),
      desenvolvimento: false,
    });
    await r.push('/preferencias');
    expect(r.currentRoute.value.name).toBe('sem-permissao');
    await r.push('/');
    expect(r.currentRoute.value.name).toBe('inicio');
    await r.push('/nao/existe');
    expect(r.currentRoute.value.name).toBe('nao-encontrada');
  });

  it('erro ao ler a sessão leva à porta de entrada (M05)', async () => {
    const r = criarRoteador(async () => Promise.reject(new Error('x')), {
      historico: createMemoryHistory(),
      temPlataforma: async () => false,
    });
    await r.push('/sobre');
    expect(r.currentRoute.value.name).toBe('entrar');
  });

  it('ADR 0021: 401 com a conta da plataforma aberta volta à conta de origem (não ao login do SPDATA)', async () => {
    const r = criarRoteador(async () => Promise.reject(new Error('401')), {
      historico: createMemoryHistory(),
      temPlataforma: async () => true,
    });
    await r.push('/inicio');
    expect(r.currentRoute.value.name).toBe('plataforma');
  });

  it('ADR 0021: as telas da conta da plataforma são públicas para a guarda do SPDATA', () => {
    const publicas = rotas(false)
      .filter((x) => String(x.path).startsWith('/plataforma'))
      .map((x) => [x.path, x.meta?.publica]);
    expect(publicas).toEqual([
      // Recuperação da senha do administrador da plataforma: pública (quem esqueceu a senha não tem sessão).
      ['/plataforma/recuperar-senha', true],
      ['/plataforma/entrar', true],
      ['/plataforma', true],
      ['/plataforma/suporte', true],
      ['/plataforma/convite', true],
      // O painel de clientes (onboarding) é do administrador da plataforma: exige a permissão, não é pública.
      ['/plataforma/clientes', undefined],
      // Carga e sincronismo: também da conta da plataforma (a tela confere a sessão; o servidor, cada rota).
      ['/plataforma/carga', true],
    ]);
  });
});
