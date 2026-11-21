// M59-F2 no serviço de sessão: a credencial forte confere antes do legado e decide; a senha do legado que confere é
// regravada; o segundo fator confere na entrada (código, adesão, recusa) e a tentativa só é apagada depois dele.
// Fonte sintética (M05) e um gancho de identidade de teste: nada de banco, senha sintética.
import { describe, expect, it } from 'vitest';
import { ErroSessao, type GanchoIdentidade } from './servico-sessao.js';
import { REDE, SENHA, entrada, montar } from './teste.spec-util.js';

type Ganchos = Partial<GanchoIdentidade>;

function gancho(g: Ganchos = {}) {
  const chamadas: string[] = [];
  const identidade: GanchoIdentidade = {
    autenticar: g.autenticar ?? (async () => ({ tipo: 'legado' as const })),
    regravar:
      g.regravar ??
      (async (a) => {
        chamadas.push(`regravar:${a.login}:${a.hospital}`);
        return true;
      }),
    segundoFatorNoLogin:
      g.segundoFatorNoLogin ??
      (async () => ({
        tipo: 'entrar' as const,
        info: { cadastrado: false, disponivel: true, exigencia: 'opcional' as const, prazoAdesaoAte: null },
      })),
  };
  return { identidade, chamadas };
}

describe('credencial forte no login (regra 2)', () => {
  it('a senha do legado conferiu: entra e regrava', async () => {
    const { identidade, chamadas } = gancho();
    const { servico } = montar({ config: { identidade } });
    const r = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    expect(r.sessao.usuario.login).toBe('SINT.USUARIO');
    expect(chamadas).toEqual(['regravar:SINT.USUARIO:aa']);
    expect(r.sessao.segundoFator).toEqual({
      cadastrado: false,
      disponivel: true,
      exigencia: 'opcional',
      prazoAdesaoAte: null,
    });
  });

  it('a forte decide: inválida recusa mesmo com a senha do legado certa; válida não regrava', async () => {
    const recusa = gancho({ autenticar: async () => ({ tipo: 'forte-invalida' }) });
    const a = montar({ config: { identidade: recusa.identidade } });
    await expect(a.servico.entrar(entrada('SINT.USUARIO'), REDE)).rejects.toMatchObject({
      tipo: 'credencial-invalida',
    });
    expect(recusa.chamadas).toEqual([]);

    const ok = gancho({
      autenticar: async () => ({
        tipo: 'forte-ok',
        conta: {
          login: 'SINT.USUARIO',
          id: 9001,
          nomeExibicao: 'Usuario Sintetico',
          ativo: true,
          bloqueado: false,
          senhaAlteradaEm: null,
        },
      }),
    });
    const b = montar({ config: { identidade: ok.identidade } });
    const r = await b.servico.entrar(entrada('SINT.USUARIO', 'qualquer-forte'), REDE);
    expect(r.sessao.usuario.login).toBe('SINT.USUARIO');
    expect(ok.chamadas).toEqual([]);
  });

  it('a reautenticação também passa pela forte', async () => {
    let forte = false;
    const g = gancho({
      autenticar: async () => (forte ? { tipo: 'forte-invalida' } : { tipo: 'legado' }),
    });
    const { servico } = montar({ config: { identidade: g.identidade } });
    const r = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    forte = true;
    await expect(servico.reautenticar(r.idSessao, REDE, SENHA)).rejects.toMatchObject({
      tipo: 'credencial-invalida',
    });
  });
});

describe('segundo fator na entrada (regra 3)', () => {
  it('código necessário, inválido e cadastro obrigatório: recusa com o código da extensão', async () => {
    for (const [tipo, codigo] of [
      ['codigo-necessario', 'segundo-fator-codigo'],
      ['codigo-invalido', 'segundo-fator-invalido'],
      ['cadastro-obrigatorio', 'segundo-fator-cadastro'],
    ] as const) {
      const g = gancho({ segundoFatorNoLogin: async () => ({ tipo }) });
      const { servico } = montar({ config: { identidade: g.identidade } });
      const e = await servico.entrar(entrada('SINT.USUARIO'), REDE).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ErroSessao);
      expect(e).toMatchObject({ tipo: 'segundo-fator-necessario', codigo });
      // Sem sessão aberta, nada regravado.
      expect(g.chamadas).toEqual([]);
    }
  });

  it('o código vai ao gancho com o perfil e o grupo da sessão; a tentativa só é apagada depois', async () => {
    const vistos: unknown[] = [];
    let falhar = true;
    const g = gancho({
      segundoFatorNoLogin: async (h, conta, alcance, codigo) => {
        vistos.push({ h, login: conta.login, alcance: typeof alcance.perfil, codigo });
        return falhar
          ? { tipo: 'codigo-invalido' }
          : {
              tipo: 'entrar',
              info: { cadastrado: true, disponivel: true, exigencia: 'adesao', prazoAdesaoAte: '2026-11-07' },
            };
      },
    });
    const { servico, armazem } = montar({ config: { identidade: g.identidade } });
    await expect(
      servico.entrar({ ...entrada('SINT.USUARIO'), codigoSegundoFator: '123456' }, REDE),
    ).rejects.toMatchObject({ codigo: 'segundo-fator-invalido' });
    const chaves = await (armazem as unknown as { chaves?: () => Promise<string[]> }).chaves?.();
    if (chaves) expect(chaves.some((c) => c.includes('SINT.USUARIO'))).toBe(true);
    falhar = false;
    const r = await servico.entrar({ ...entrada('SINT.USUARIO'), codigoSegundoFator: '654321' }, REDE);
    expect(r.sessao.segundoFator).toMatchObject({
      cadastrado: true,
      exigencia: 'adesao',
      prazoAdesaoAte: '2026-11-07',
    });
    expect(vistos).toEqual([
      { h: 'aa', login: 'SINT.USUARIO', alcance: 'object', codigo: '123456' },
      { h: 'aa', login: 'SINT.USUARIO', alcance: 'object', codigo: '654321' },
    ]);
  });
});
