// Família acesso-ligacao (modulos-proprios-3): as fontes tardias, a montagem da ligação e o segundo fator por código no
// e-mail na entrada (usuário do cliente e administrador da plataforma), sem banco.
import { describe, expect, it } from 'vitest';
import { problemaDoAcessoEmail } from '../modulos/acesso/acesso-email-erros.js';
import { recusaEmailPelaPolitica } from '../modulos/acesso/acesso-email.controller.js';
import { ErroProblema } from '../problema.filter.js';
import type { ServicosAcessoEmail } from './acesso-email-proprio.js';
import {
  FontesAcessoTardias,
  SegundoFatorEmailTardio,
  type GanchoSegundoFatorEmail,
} from './acesso-email-tardio.js';
import { ErroCodigoEmail, type MetodoSegundoFator } from './codigo-email.js';
import { ErroRecuperacaoPlataforma } from './recuperacao-plataforma.js';
import { ErroSessao, type Desfecho2faSessao, type GanchoIdentidade } from './servico-sessao.js';
import { REDE, entrada, montar } from './teste.spec-util.js';
import type { AutenticacaoPlataforma, FontePlataforma } from './tipos-acesso.js';

function gancho(metodo: MetodoSegundoFator, codigoCerto = '123456') {
  const emitidos: string[] = [];
  const g: GanchoSegundoFatorEmail = {
    metodoUsuario: () => Promise.resolve(metodo),
    emitirUsuario: (_r, _e, login) => {
      emitidos.push(login);
      return Promise.resolve({ validadeMinutos: 5 });
    },
    conferirUsuario: (_r, _e, _l, c) => Promise.resolve(c === codigoCerto ? 'ok' : 'invalido'),
    metodoPlataforma: () => Promise.resolve(metodo),
    emitirPlataforma: (id) => {
      emitidos.push(`plataforma:${id}`);
      return Promise.resolve({ validadeMinutos: 5 });
    },
    conferirPlataforma: (_id, c) => Promise.resolve(c === codigoCerto ? 'ok' : 'esgotado'),
  };
  return { g, emitidos };
}

const SENHA_ADM = 'Inicial#2026x';
const plataforma: FontePlataforma = {
  clientes: () => Promise.resolve(['cliente_a']),
  autenticar: (login, senha, cliente): Promise<AutenticacaoPlataforma> =>
    Promise.resolve(
      login === 'dono' && senha === SENHA_ADM
        ? {
            desfecho: 'ok',
            ator: {
              tipo: 'plataforma',
              idAdministrador: 7,
              nomeExibicao: 'Dono',
              cliente,
              trocaObrigatoria: false,
              senhaAlteradaEm: 1,
            },
          }
        : { desfecho: 'credencial-invalida' },
    ),
  conferir: () => Promise.resolve(true),
  gravarSenha: () => Promise.resolve(2),
  situacao: () => Promise.resolve({ ativo: true, senhaAlteradaEm: 1 }),
};

describe('fontes tardias da entrada por e-mail', () => {
  it('a configuração delega à fonte ligada no momento da chamada; sem ligação, recusa', async () => {
    const f = new FontesAcessoTardias();
    const cfg = f.configuracao();
    await expect(cfg.valoresParametro('r', 'h')).rejects.toThrow(/não foi ligada/);
    expect(f.configuracaoLigada).toBe(false);
    f.ligarConfiguracao(
      () =>
        ({ valoresParametro: () => Promise.resolve([{ chave: 'x' }]) }) as unknown as ReturnType<
          FontesAcessoTardias['configuracao']
        >,
    );
    expect(f.configuracaoLigada).toBe(true);
    await expect(cfg.valoresParametro('r', 'h')).resolves.toEqual([{ chave: 'x' }]);
  });

  it('o id do estabelecimento vem da busca ligada (null antes dela)', () => {
    const f = new FontesAcessoTardias();
    expect(f.estabelecimento('aa')).toBeNull();
    f.ligarEstabelecimento((h) => (h === 'aa' ? 11 : null));
    expect(f.estabelecimento('aa')).toBe(11);
    expect(f.estabelecimento('zz')).toBeNull();
  });
});

describe('segundo fator por código no e-mail na entrada do usuário', () => {
  it('sem código: envia e pede o código do e-mail; com o código certo, entra', async () => {
    const { g, emitidos } = gancho('email');
    const { servico } = montar({ config: { segundoFatorEmail: g } });
    await expect(servico.entrar(entrada('SINT.USUARIO'), REDE)).rejects.toMatchObject({
      tipo: 'segundo-fator-necessario',
      codigo: 'segundo-fator-email',
    });
    expect(emitidos).toEqual(['SINT.USUARIO']);
    const r = await servico.entrar({ ...entrada('SINT.USUARIO'), codigoSegundoFator: '123456' }, REDE);
    expect(r.sessao.usuario.login).toBe('SINT.USUARIO');
  });

  it('código errado: recusa como segundo fator inválido', async () => {
    const { g } = gancho('email');
    const { servico } = montar({ config: { segundoFatorEmail: g } });
    await expect(
      servico.entrar({ ...entrada('SINT.USUARIO'), codigoSegundoFator: '000000' }, REDE),
    ).rejects.toMatchObject({ codigo: 'segundo-fator-invalido' });
  });

  it('quem escolheu o aplicativo entra como antes (nenhum e-mail enviado)', async () => {
    const { g, emitidos } = gancho('aplicativo');
    const { servico } = montar({ config: { segundoFatorEmail: g } });
    const r = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    expect(r.sessao.usuario.login).toBe('SINT.USUARIO');
    expect(emitidos).toEqual([]);
  });

  it('envio acima do limite vira muitas tentativas; conta sem e-mail, pedido claro', async () => {
    const base = gancho('email').g;
    for (const [codigo, tipo, cod] of [
      ['muitos-envios', 'muitas-tentativas', 'segundo-fator-email-envios'],
      ['sem-email', 'segundo-fator-necessario', 'segundo-fator-sem-email'],
    ] as const) {
      const g = { ...base, emitirUsuario: () => Promise.reject(new ErroCodigoEmail(codigo)) };
      const { servico } = montar({ config: { segundoFatorEmail: g } });
      const e = await servico.entrar(entrada('SINT.USUARIO'), REDE).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ErroSessao);
      expect(e).toMatchObject({ tipo, codigo: cod });
    }
  });
});

describe('segundo fator por código no e-mail na entrada da plataforma', () => {
  const ent = { estabelecimento: 'aa', login: 'dono', senha: SENHA_ADM };

  it('pede o código, recusa o vencido e entra com o certo', async () => {
    const { g, emitidos } = gancho('email');
    const { servico } = montar({ config: { segundoFatorEmail: g, plataforma, cliente: 'cliente_a' } });
    await expect(servico.entrarPlataforma(ent, REDE)).rejects.toMatchObject({
      codigo: 'segundo-fator-email',
    });
    expect(emitidos).toEqual(['plataforma:7']);
    await expect(
      servico.entrarPlataforma({ ...ent, codigoSegundoFator: '999999' }, REDE),
    ).rejects.toMatchObject({ codigo: 'segundo-fator-email-esgotado' });
    const r = await servico.entrarPlataforma({ ...ent, codigoSegundoFator: '123456' }, REDE);
    expect(r.sessao.usuario.login).toBe('plataforma:dono');
  });
});

describe('recusas da entrada por e-mail em Problem Details', () => {
  it('método não escolhido: 409; muitos envios: 429; recusa da plataforma com o status dela', () => {
    const p = problemaDoAcessoEmail(new ErroCodigoEmail('metodo-nao-escolhido'));
    expect(p).toBeInstanceOf(ErroProblema);
    expect(p?.getStatus()).toBe(409);
    expect(p?.extras).toMatchObject({ codigo: 'metodo-nao-escolhido' });
    expect(problemaDoAcessoEmail(new ErroCodigoEmail('muitos-envios'))?.getStatus()).toBe(429);
    expect(
      problemaDoAcessoEmail(new ErroRecuperacaoPlataforma('token-invalido', 400, 'x'))?.getStatus(),
    ).toBe(400);
    expect(problemaDoAcessoEmail(new Error('outro'))).toBeNull();
  });
});

describe('segundo fator por e-mail falha fechado', () => {
  /** Serviços ligados com a preferência gravada e, opcionalmente, sem o envio (sem SMTP). */
  function tardio(metodo: MetodoSegundoFator, comEnvio: boolean) {
    const emitidos: string[] = [];
    const t = new SegundoFatorEmailTardio();
    t.ligar({
      preferencia: { metodo: () => Promise.resolve(metodo) },
      codigoUsuario: comEnvio
        ? {
            emitir: (_r: string, _e: string, l: string) => {
              emitidos.push(l);
              return Promise.resolve({ validadeMinutos: 5 });
            },
            conferir: () => Promise.resolve('ok'),
          }
        : null,
      recuperacaoPlataforma: null,
    } as unknown as ServicosAcessoEmail);
    return { t, emitidos };
  }

  it('quem escolheu o e-mail e o envio não existe é recusado (503), nunca levado ao aplicativo', async () => {
    const { t } = tardio('email', false);
    const { servico } = montar({ config: { segundoFatorEmail: t } });
    await expect(servico.entrar(entrada('SINT.USUARIO'), REDE)).rejects.toMatchObject({
      tipo: 'indisponivel',
    });
  });

  it('gancho passado à sessão e ainda não ligado: a entrada recusa (503)', async () => {
    const { servico } = montar({ config: { segundoFatorEmail: new SegundoFatorEmailTardio() } });
    await expect(servico.entrar(entrada('SINT.USUARIO'), REDE)).rejects.toMatchObject({
      tipo: 'indisponivel',
    });
    const plat = montar({
      config: { segundoFatorEmail: new SegundoFatorEmailTardio(), plataforma, cliente: 'cliente_a' },
    });
    await expect(
      plat.servico.entrarPlataforma({ estabelecimento: 'aa', login: 'dono', senha: SENHA_ADM }, REDE),
    ).rejects.toMatchObject({ tipo: 'indisponivel' });
  });

  it('sem envio, quem usa o aplicativo entra como antes; com envio, o e-mail escolhido pede o código', async () => {
    const semEnvio = tardio('aplicativo', false);
    const a = montar({ config: { segundoFatorEmail: semEnvio.t } });
    expect((await a.servico.entrar(entrada('SINT.USUARIO'), REDE)).sessao.usuario.login).toBe('SINT.USUARIO');
    const comEnvio = tardio('email', true);
    const b = montar({ config: { segundoFatorEmail: comEnvio.t } });
    await expect(b.servico.entrar(entrada('SINT.USUARIO'), REDE)).rejects.toMatchObject({
      codigo: 'segundo-fator-email',
    });
    expect(comEnvio.emitidos).toEqual(['SINT.USUARIO']);
  });
});

describe('o código no e-mail não cumpre a exigência do aplicativo do perfil', () => {
  function identidade(previa: Desfecho2faSessao): GanchoIdentidade {
    return {
      autenticar: async () => ({ tipo: 'legado' as const }),
      regravar: async () => true,
      segundoFatorNoLogin: async (_e, _c, _a, codigo) =>
        codigo === '654321'
          ? {
              tipo: 'entrar',
              info: { cadastrado: true, disponivel: true, exigencia: 'obrigatorio', prazoAdesaoAte: null },
            }
          : codigo && previa.tipo === 'codigo-necessario'
            ? { tipo: 'codigo-invalido' }
            : previa,
    };
  }

  it('perfil obrigatório sem o aplicativo: recusa pelo cadastro, sem enviar e-mail', async () => {
    const { g, emitidos } = gancho('email');
    const { servico } = montar({
      config: { segundoFatorEmail: g, identidade: identidade({ tipo: 'cadastro-obrigatorio' }) },
    });
    await expect(servico.entrar(entrada('SINT.USUARIO'), REDE)).rejects.toMatchObject({
      codigo: 'segundo-fator-cadastro',
    });
    // Nem com um código do e-mail ele entra.
    await expect(
      servico.entrar({ ...entrada('SINT.USUARIO'), codigoSegundoFator: '123456' }, REDE),
    ).rejects.toMatchObject({ codigo: 'segundo-fator-cadastro' });
    expect(emitidos).toEqual([]);
  });

  it('aplicativo ativo: pede o código do aplicativo e só ele entra (o e-mail não o substitui)', async () => {
    const { g, emitidos } = gancho('email');
    const { servico } = montar({
      config: { segundoFatorEmail: g, identidade: identidade({ tipo: 'codigo-necessario' }) },
    });
    await expect(servico.entrar(entrada('SINT.USUARIO'), REDE)).rejects.toMatchObject({
      codigo: 'segundo-fator-codigo',
    });
    await expect(
      servico.entrar({ ...entrada('SINT.USUARIO'), codigoSegundoFator: '123456' }, REDE),
    ).rejects.toMatchObject({ codigo: 'segundo-fator-invalido' });
    expect(emitidos).toEqual([]);
    const r = await servico.entrar({ ...entrada('SINT.USUARIO'), codigoSegundoFator: '654321' }, REDE);
    expect(r.sessao.usuario.login).toBe('SINT.USUARIO');
  });

  it('política opcional ou no prazo de adesão: o e-mail vale e a sessão leva a situação da política', async () => {
    const info = {
      cadastrado: false,
      disponivel: true,
      exigencia: 'adesao' as const,
      prazoAdesaoAte: '2026-12-31',
    };
    const { g, emitidos } = gancho('email');
    const { servico } = montar({
      config: { segundoFatorEmail: g, identidade: identidade({ tipo: 'entrar', info }) },
    });
    await expect(servico.entrar(entrada('SINT.USUARIO'), REDE)).rejects.toMatchObject({
      codigo: 'segundo-fator-email',
    });
    expect(emitidos).toEqual(['SINT.USUARIO']);
    const r = await servico.entrar({ ...entrada('SINT.USUARIO'), codigoSegundoFator: '123456' }, REDE);
    expect(r.sessao.segundoFator).toMatchObject({ exigencia: 'adesao', cadastrado: false });
  });

  it('a escolha do e-mail é recusada quando o perfil exige o aplicativo ou ele já está cadastrado', () => {
    const sf = (exigencia: 'opcional' | 'adesao' | 'obrigatorio', cadastrado: boolean) => ({
      segundoFator: { cadastrado, disponivel: true, exigencia, prazoAdesaoAte: null },
    });
    expect(recusaEmailPelaPolitica({})).toBeNull();
    expect(recusaEmailPelaPolitica(sf('opcional', false))).toBeNull();
    expect(recusaEmailPelaPolitica(sf('adesao', false))).toMatch(/exige o código do aplicativo/);
    expect(recusaEmailPelaPolitica(sf('obrigatorio', true))).toMatch(/exige/);
    expect(recusaEmailPelaPolitica(sf('opcional', true))).toMatch(/já usa o aplicativo/);
  });
});
