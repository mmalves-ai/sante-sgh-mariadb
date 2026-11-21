// W1-01 (parte 2b): acesso.redefinirSenha pelo serviço de sessão. O gestor (reautenticado pelo controller) dá ao
// usuário uma senha PROVISÓRIA gerada pelo servidor: cumpre a política, vai à porta só como resumo argon2id pela
// operação acesso.redefinir-senha, com o gestor como autor; a credencial forte é regravada com origem senha-provisoria e as
// sessões do usuário caem. No login, a credencial provisória obriga a troca ('senha-provisoria').
import { describe, expect, it } from 'vitest';
import { avaliarSenhaNova, conferirSenha, gerarSenhaProvisoria, politicaEfetiva } from '@sgh/dominio-acesso';
import {
  type ContextoSenha,
  type PortaSenha,
  portaSenhaMemoria,
  resumoArgon2id,
  type TipoGravacaoSenha,
} from '../modulos/acesso/senha/porta-senha.js';
import type { GanchoIdentidade } from './servico-sessao.js';
import { REDE, entrada, montar } from './teste.spec-util.js';

const GESTOR = { rede: REDE, estabelecimento: 'aa', login: 'SINT.GESTOR' };
const ORIGEM = { estacao: 'SGH-WEB:teste', correlacao: 'teste-redefinir' };

function portaEspia() {
  const base = portaSenhaMemoria();
  const gravadas: { login: string; resumo: string; ctx: ContextoSenha; tipo?: TipoGravacaoSenha }[] = [];
  const porta: PortaSenha = {
    reuso: (h, l, s, d) => base.reuso(h, l, s, d),
    async gravar(h, l, s, ctx, tipo) {
      gravadas.push({ login: l, resumo: s, ctx, ...(tipo ? { tipo } : {}) });
      await base.gravar(h, l, s, ctx, tipo);
      return 9001;
    },
  };
  return { porta, gravadas };
}

function identidadeEspia(provisoria = false) {
  const regravadas: { login: string; origem: string | undefined; senha: string }[] = [];
  const identidade: GanchoIdentidade = {
    autenticar: async () =>
      provisoria
        ? {
            tipo: 'forte-ok' as const,
            provisoria: true,
            conta: {
              login: 'SINT.USUARIO',
              id: 9001,
              nomeExibicao: 'Usuario Sintetico',
              ativo: true,
              bloqueado: false,
              senhaAlteradaEm: new Date(),
            },
          }
        : { tipo: 'legado' as const },
    regravar: async (a, senha, origem) => {
      regravadas.push({ login: a.login, origem, senha });
      return true;
    },
    segundoFatorNoLogin: async () => ({
      tipo: 'entrar' as const,
      info: { cadastrado: false, disponivel: true, exigencia: 'opcional' as const, prazoAdesaoAte: null },
    }),
  };
  return { identidade, regravadas };
}

describe('redefinição de senha pelo gestor (acesso.redefinir-senha)', () => {
  it('gera a provisória pela política, grava pela operação de redefinição com o gestor como autor e derruba as sessões', async () => {
    const { porta, gravadas } = portaEspia();
    const { identidade, regravadas } = identidadeEspia();
    const { servico } = montar({ config: { senha: porta, identidade } });
    const aberta = await servico.entrar(entrada('SINT.USUARIO'), REDE);

    const r = await servico.redefinirSenha(GESTOR, 'SINT.USUARIO', ORIGEM, Date.now());
    expect(r.trocaObrigatoria).toBe(true);
    const politica = politicaEfetiva({
      minimoCaracteres: null,
      exigeLetra: true,
      exigeNumero: true,
      exigeEspecial: false,
      exigeMinuscula: false,
      exigeMaiuscula: false,
      periodoTrocaDias: null,
      periodoReutilizacaoDias: null,
    });
    expect(avaliarSenhaNova(r.senhaProvisoria, 'SINT.USUARIO', politica)).toEqual([]);
    expect(r.senhaProvisoria.length).toBeGreaterThanOrEqual(12);

    expect(gravadas).toHaveLength(1);
    const g = gravadas[0]!;
    expect(g.tipo).toBe('redefinicao');
    expect(g.login).toBe('SINT.USUARIO');
    expect(g.ctx.autor).toBe('SINT.GESTOR');
    expect(resumoArgon2id(g.resumo)).toBe(true);
    expect(await conferirSenha(r.senhaProvisoria, g.resumo)).toBe(true);
    // Varredura: a senha provisória nunca chega ao contexto da gravação (que vai à trilha).
    expect(JSON.stringify(g.ctx)).not.toContain(r.senhaProvisoria);

    // O login regravou a da fonte (primeiro-login); a redefinição regrava a provisória.
    expect(regravadas.at(-1)).toEqual({
      login: 'SINT.USUARIO',
      origem: 'senha-provisoria',
      senha: r.senhaProvisoria,
    });
    // A sessão aberta do usuário caiu (a senha anterior deixou de valer).
    expect(await servico.ler(aberta.idSessao, REDE)).toBeNull();
  });

  it('a própria senha não se redefine; sem a porta, indisponível; nada gravado', async () => {
    const { porta, gravadas } = portaEspia();
    const ligado = montar({ config: { senha: porta } }).servico;
    await expect(ligado.redefinirSenha(GESTOR, 'SINT.GESTOR', ORIGEM, Date.now())).rejects.toMatchObject({
      tipo: 'troca-indisponivel',
    });
    const semPorta = montar({ config: {} }).servico;
    await expect(semPorta.redefinirSenha(GESTOR, 'SINT.USUARIO', ORIGEM, Date.now())).rejects.toMatchObject({
      tipo: 'troca-indisponivel',
    });
    expect(gravadas).toHaveLength(0);
  });

  it('no login, a credencial provisória obriga a troca (senha-provisoria)', async () => {
    const { porta } = portaEspia();
    const { identidade } = identidadeEspia(true);
    const { servico } = montar({ config: { senha: porta, identidade } });
    const r = await servico.entrar(entrada('SINT.USUARIO', 'Provisoria#77x'), REDE);
    expect(r.sessao.trocaSenha).toBe('senha-provisoria');
  });

  it('gerarSenhaProvisoria: uma de cada classe, sem caracteres ambíguos, nunca derivada do login, tamanho da política', () => {
    const p = politicaEfetiva({
      minimoCaracteres: 16,
      exigeLetra: true,
      exigeNumero: true,
      exigeEspecial: true,
      exigeMinuscula: true,
      exigeMaiuscula: true,
      periodoTrocaDias: null,
      periodoReutilizacaoDias: null,
    });
    let i = 0;
    const seq = (n: number) => (i++ * 7) % n;
    const s = gerarSenhaProvisoria(p, 'SINT.USUARIO', seq);
    expect(s).toHaveLength(16);
    expect(avaliarSenhaNova(s, 'SINT.USUARIO', p)).toEqual([]);
    expect(s).not.toMatch(/[Il0O1]/);
  });
});
