// W1-01 (parte 2b): acesso.redefinirSenha pelo serviço de sessão. O gestor (reautenticado pelo controller) dá ao
// usuário uma senha PROVISÓRIA gerada pelo servidor: cumpre a política, vai à porta só como resumo e sal pela receita
// acesso.redefinirSenha, com o gestor como operador; a credencial forte é regravada com origem senha-provisoria e as
// sessões do usuário caem. No login, a credencial provisória obriga a troca ('senha-provisoria').
import { describe, expect, it } from 'vitest';
import { type ContextoOperacao, type SenhaLegado, verificarSenha } from '@sgh/legado';
import { avaliarSenhaNova, gerarSenhaProvisoria, politicaEfetiva } from '@sgh/dominio-acesso';
import {
  type PortaSenhaLegado,
  portaSenhaMemoria,
  type TipoGravacaoSenha,
} from '../modulos/acesso/senha/porta-senha.js';
import type { GanchoIdentidade } from './servico-sessao.js';
import { REDE, entrada, montar } from './teste.spec-util.js';

const GESTOR = { rede: REDE, estabelecimento: 'aa', login: 'SINT.GESTOR' };
const ORIGEM = { estacao: 'SGH-WEB:teste', correlacao: 'teste-redefinir' };

function portaEspia() {
  const base = portaSenhaMemoria();
  const gravadas: { login: string; senha: SenhaLegado; ctx: ContextoOperacao; tipo?: TipoGravacaoSenha }[] =
    [];
  const porta: PortaSenhaLegado = {
    combinacao: base.combinacao,
    reuso: (h, l, s, d) => base.reuso(h, l, s, d),
    async gravar(h, l, s, ctx, tipo) {
      gravadas.push({ login: l, senha: s, ctx, ...(tipo ? { tipo } : {}) });
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
              grupo: null,
              senhaPresente: true,
              criptografada: true,
              comSalt: true,
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

describe('redefinição de senha pelo gestor (acesso.redefinirSenha)', () => {
  it('gera a provisória pela política, grava pela receita de redefinição com o gestor como operador e derruba as sessões', async () => {
    const { porta, gravadas } = portaEspia();
    const { identidade, regravadas } = identidadeEspia();
    const { servico } = montar({ config: { trocaSenhaPeloNovo: true, senhaLegado: porta, identidade } });
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
    expect(g.ctx.usuarioLegado).toBe('SINT.GESTOR');
    expect(g.senha.resumo).toMatch(/^[0-9A-F]{40}$/);
    expect(g.senha.sal).toMatch(/^[0-9A-Z]{20}$/);
    expect(
      verificarSenha(
        r.senhaProvisoria,
        { senha: g.senha.resumo, salt: g.senha.sal, criptografada: true },
        porta.combinacao!,
      ).confere,
    ).toBe(true);
    // Varredura: a senha provisória nunca chega ao contexto da receita (que vai à trilha).
    expect(JSON.stringify(g.ctx)).not.toContain(r.senhaProvisoria);

    // O login regravou a do legado (primeiro-login); a redefinição regrava a provisória.
    expect(regravadas.at(-1)).toEqual({
      login: 'SINT.USUARIO',
      origem: 'senha-provisoria',
      senha: r.senhaProvisoria,
    });
    // A sessão aberta do usuário caiu (a senha anterior deixou de valer).
    expect(await servico.ler(aberta.idSessao, REDE)).toBeNull();
  });

  it('a própria senha não se redefine; sem a chave ou sem a porta, indisponível; nada gravado', async () => {
    const { porta, gravadas } = portaEspia();
    const ligado = montar({ config: { trocaSenhaPeloNovo: true, senhaLegado: porta } }).servico;
    await expect(ligado.redefinirSenha(GESTOR, 'SINT.GESTOR', ORIGEM, Date.now())).rejects.toMatchObject({
      tipo: 'troca-indisponivel',
    });
    const desligado = montar({ config: { trocaSenhaPeloNovo: false, senhaLegado: porta } }).servico;
    await expect(desligado.redefinirSenha(GESTOR, 'SINT.USUARIO', ORIGEM, Date.now())).rejects.toMatchObject({
      tipo: 'troca-indisponivel',
    });
    const semPorta = montar({ config: { trocaSenhaPeloNovo: true } }).servico;
    await expect(semPorta.redefinirSenha(GESTOR, 'SINT.USUARIO', ORIGEM, Date.now())).rejects.toMatchObject({
      tipo: 'troca-indisponivel',
    });
    expect(gravadas).toHaveLength(0);
  });

  it('no login, a credencial provisória obriga a troca (senha-provisoria)', async () => {
    const { porta } = portaEspia();
    const { identidade } = identidadeEspia(true);
    const { servico } = montar({ config: { trocaSenhaPeloNovo: true, senhaLegado: porta, identidade } });
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
