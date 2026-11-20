// Crítica com janela recente ou senha (M59.2, correção da revisão: cadastrar o segundo fator exige a
// reautenticação recente, SBIS-07). Dublês sintéticos de sessão e resolvedor; nenhuma conexão.
import { describe, expect, it } from 'vitest';
import { ErroProblema } from '../problema.filter.js';
import { ErroSessao, type ServicoSessao } from '../sessao/servico-sessao.js';
import type { RequisicaoAutorizada } from './guarda.js';
import { exigirReautenticacaoOuSenha } from './reautenticacao.js';
import type { ResolvedorSessao } from './resolvedor-sessao.js';

const resolvedor = {
  idSessao: () => 'sessao-1',
  rede: () => 'rede-teste',
} as unknown as ResolvedorSessao;

function req(real = true, csrf = 'tok'): RequisicaoAutorizada {
  return {
    headers: { cookie: `sgh_csrf=tok`, 'x-csrf': csrf },
    sgh: { real },
  } as unknown as RequisicaoAutorizada;
}

function sessoes(recente: boolean, senhaCerta = 'Sintetico#2026') {
  const chamadas: string[] = [];
  const s = {
    csrfConfere: (_id: string, _rede: string | null, t: string) => Promise.resolve(t === 'tok'),
    exigirReautenticacaoRecente: () => {
      chamadas.push('recente');
      return recente
        ? Promise.resolve({})
        : Promise.reject(new ErroSessao('reautenticacao-necessaria', 'Confirme a sua senha para continuar.'));
    },
    reautenticar: (_id: string, _rede: string | null, senha: string) => {
      chamadas.push('senha');
      return senha === senhaCerta
        ? Promise.resolve({})
        : Promise.reject(new ErroSessao('credencial-invalida', 'x'));
    },
  } as unknown as ServicoSessao;
  return { s, chamadas };
}

async function tipo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    expect(e).toBeInstanceOf(ErroProblema);
    return `${(e as ErroProblema).getStatus()}`;
  }
}

describe('exigirReautenticacaoOuSenha', () => {
  it('sem senha e dentro da janela (o login recente conta): passa', async () => {
    const { s, chamadas } = sessoes(true);
    expect(await tipo(exigirReautenticacaoOuSenha(s, resolvedor, req(), undefined))).toBe('ok');
    expect(chamadas).toEqual(['recente']);
  });

  it('sem senha e fora da janela: 401 reautenticacao-necessaria (estação aberta ou cookie roubado)', async () => {
    const { s } = sessoes(false);
    expect(await tipo(exigirReautenticacaoOuSenha(s, resolvedor, req(), undefined))).toBe('401');
  });

  it('com a senha certa fora da janela: passa; com a errada: 401', async () => {
    const { s, chamadas } = sessoes(false);
    expect(await tipo(exigirReautenticacaoOuSenha(s, resolvedor, req(), 'Sintetico#2026'))).toBe('ok');
    expect(chamadas).toEqual(['senha']);
    expect(await tipo(exigirReautenticacaoOuSenha(s, resolvedor, req(), 'errada'))).toBe('401');
  });

  it('sem CSRF: 403; sessão sintética (sem login): 401; sem serviço de sessão: 401', async () => {
    const { s } = sessoes(true);
    expect(await tipo(exigirReautenticacaoOuSenha(s, resolvedor, req(true, 'outro'), undefined))).toBe('403');
    expect(await tipo(exigirReautenticacaoOuSenha(s, resolvedor, req(false), undefined))).toBe('401');
    expect(await tipo(exigirReautenticacaoOuSenha(null, resolvedor, req(), undefined))).toBe('401');
  });
});
