// Decisão do dono (2026-11-20, b): a entrada do administrador da plataforma pelo serviço de sessão. Credencial do banco
// plataforma (aqui, uma fonte em memória), todas as permissões só no cliente desta API, troca obrigatória da senha
// inicial, reautenticação e troca pela senha da plataforma (nunca por uma conta do cliente). Sem banco e sem dado
// pessoal.
import { describe, expect, it } from 'vitest';
import { autorizacaoAcessoTotal } from '../autorizacao/servico-autorizacao.js';
import { ErroSessao } from './servico-sessao.js';
import { REDE, montar } from './teste.spec-util.js';
import type { EventoParaTrilha } from '../autorizacao/trilha.js';
import type { AutenticacaoPlataforma, FontePlataforma } from './tipos-acesso.js';

const SENHA_INICIAL = 'Inicial#2026x';
const NOVA = 'Trocada#2026y';

function fontePlataforma(opcoes: { trocaObrigatoria?: boolean; ativo?: boolean } = {}) {
  const estado = {
    senha: SENHA_INICIAL,
    troca: opcoes.trocaObrigatoria ?? true,
    gravados: [] as string[],
    ativo: opcoes.ativo ?? true,
    senhaEm: 1_000,
    eventos: [] as string[],
  };
  const fonte: FontePlataforma = {
    clientes: () => Promise.resolve(['cliente_a', 'cliente_b']),
    autenticar(login, senha, cliente): Promise<AutenticacaoPlataforma> {
      if (login !== 'dono' || senha !== estado.senha)
        return Promise.resolve({ desfecho: 'credencial-invalida' });
      if (!estado.ativo) return Promise.resolve({ desfecho: 'conta-impedida' });
      if (!['cliente_a', 'cliente_b'].includes(cliente))
        return Promise.resolve({ desfecho: 'cliente-indisponivel' });
      return Promise.resolve({
        desfecho: 'ok',
        ator: {
          tipo: 'plataforma',
          idAdministrador: 7,
          nomeExibicao: 'Dono',
          cliente,
          trocaObrigatoria: estado.troca,
          senhaAlteradaEm: estado.senhaEm,
        },
      });
    },
    conferir: (id, senha) => Promise.resolve(id === 7 && senha === estado.senha),
    gravarSenha(_id, resumo, _correlacao, cliente) {
      estado.gravados.push(resumo);
      estado.eventos.push(cliente);
      estado.troca = false;
      estado.senhaEm += 1;
      return Promise.resolve(estado.senhaEm);
    },
    situacao: (id) =>
      Promise.resolve(id === 7 ? { ativo: estado.ativo, senhaAlteradaEm: estado.senhaEm } : null),
  };
  return { fonte, estado };
}

function servicoCom(
  fonte: FontePlataforma | undefined,
  cliente: string | null = 'cliente_a',
  extra: { agora?: () => number; trilha?: EventoParaTrilha[] } = {},
) {
  const trilha = extra.trilha;
  return montar({
    ...(extra.agora ? { agora: extra.agora } : {}),
    config: {
      cliente,
      ...(fonte ? { plataforma: fonte } : {}),
      ...(trilha
        ? {
            trilha: {
              registrar: (e: EventoParaTrilha) => {
                trilha.push(e);
                return Promise.resolve({ sgh: '1', legado: null });
              },
            } as never,
          }
        : {}),
    },
  });
}

const entrada = (senha = SENHA_INICIAL, cliente?: string) => ({
  estabelecimento: 'aa',
  login: 'dono',
  senha,
  ...(cliente ? { cliente } : {}),
});

async function erroDe(p: Promise<unknown>): Promise<ErroSessao> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroSessao) return e;
    throw e;
  }
  throw new Error('esperava ErroSessao');
}

describe('entrada do administrador da plataforma (decisão b)', () => {
  it('entra no cliente desta API com o catálogo inteiro e só para trocar a senha inicial', async () => {
    const { fonte } = fontePlataforma();
    const { servico } = servicoCom(fonte);
    const r = await servico.entrarPlataforma(entrada(), REDE);
    expect(r.sessao.trocaSenha).toBe('senha-provisoria');
    expect(r.sessao.trocaSenhaPeloNovo).toBe(true);
    expect([...r.sessao.permissoes].sort()).toEqual([...autorizacaoAcessoTotal(0).permissoes].sort());
    // A sessão relida continua com tudo (a autorização vem da marca da plataforma, não de uma conta do cliente).
    const lida = await servico.ler(r.idSessao, REDE);
    expect(lida?.registro.plataforma).toEqual({
      idAdministrador: 7,
      cliente: 'cliente_a',
      senhaAlteradaEm: 1_000,
    });
    expect(lida?.registro.login).toBe('plataforma:dono');
    // Não é usuário do cliente: o id não é numérico e a sessão diz o ator.
    expect(lida?.sessao.usuario.ator).toBe('plataforma');
    expect(lida?.sessao.usuario.id).toBe('plataforma:7');
    expect(Number.isInteger(Number(lida?.sessao.usuario.id))).toBe(false);
    expect(lida?.sessao.permissoes.length).toBe(autorizacaoAcessoTotal(0).permissoes.length);
  });

  it('sem escolha, o cliente é o único desta API; outro cliente é recusado', async () => {
    const { fonte } = fontePlataforma({ trocaObrigatoria: false });
    const { servico } = servicoCom(fonte);
    expect(
      (await servico.entrarPlataforma(entrada(SENHA_INICIAL, 'cliente_a'), REDE)).sessao.trocaSenha,
    ).toBe(null);
    expect((await erroDe(servico.entrarPlataforma(entrada(SENHA_INICIAL, 'cliente_b'), REDE))).tipo).toBe(
      'estabelecimento-invalido',
    );
    expect((await erroDe(servico.entrarPlataforma(entrada(SENHA_INICIAL, 'cliente_x'), REDE))).tipo).toBe(
      'estabelecimento-invalido',
    );
  });

  it('senha errada e conta impedida dão a mesma resposta; as tentativas são contadas', async () => {
    const { fonte } = fontePlataforma();
    const { servico } = servicoCom(fonte);
    // A porta fecha depois do limite de tentativas da política do estabelecimento (mesma regra da entrada comum).
    const tipos: string[] = [];
    for (let i = 0; i < 30 && !tipos.includes('muitas-tentativas'); i++)
      tipos.push((await erroDe(servico.entrarPlataforma(entrada('Errada#2026'), REDE))).tipo);
    expect(tipos.at(-1)).toBe('muitas-tentativas');
    expect(new Set(tipos.slice(0, -1))).toEqual(new Set(['credencial-invalida']));
    expect((await erroDe(servico.entrarPlataforma(entrada(), REDE))).tipo).toBe('muitas-tentativas');
    const impedida = servicoCom(fontePlataforma({ ativo: false }).fonte).servico;
    expect((await erroDe(impedida.entrarPlataforma(entrada(), REDE))).tipo).toBe('credencial-invalida');
  });

  it('sem a fonte da plataforma ou sem o cliente da API: indisponível (falha fechada)', async () => {
    expect((await erroDe(servicoCom(undefined).servico.entrarPlataforma(entrada(), REDE))).tipo).toBe(
      'indisponivel',
    );
    const { fonte } = fontePlataforma();
    expect((await erroDe(servicoCom(fonte, null).servico.entrarPlataforma(entrada(), REDE))).tipo).toBe(
      'indisponivel',
    );
  });

  it('troca a senha na plataforma (argon2id) e reautentica pela senha da plataforma', async () => {
    const { fonte, estado } = fontePlataforma();
    const { servico } = servicoCom(fonte);
    const r = await servico.entrarPlataforma(entrada(), REDE);
    expect(
      (await erroDe(servico.trocarSenha(r.idSessao, REDE, { senhaAtual: 'Errada#2026', senhaNova: NOVA })))
        .tipo,
    ).toBe('credencial-invalida');
    expect(
      (await erroDe(servico.trocarSenha(r.idSessao, REDE, { senhaAtual: SENHA_INICIAL, senhaNova: 'curta' })))
        .tipo,
    ).toBe('senha-recusada');
    const s = await servico.trocarSenha(r.idSessao, REDE, { senhaAtual: SENHA_INICIAL, senhaNova: NOVA });
    expect(s.trocaSenha).toBe(null);
    expect(estado.gravados).toHaveLength(1);
    expect(estado.gravados[0]).toMatch(/^\$argon2id\$/);
    expect(estado.gravados[0]).not.toContain(NOVA);
    estado.senha = NOVA;
    expect((await erroDe(servico.reautenticar(r.idSessao, REDE, SENHA_INICIAL))).tipo).toBe(
      'credencial-invalida',
    );
    expect((await servico.reautenticar(r.idSessao, REDE, NOVA)).permissoes.length).toBe(
      autorizacaoAcessoTotal(0).permissoes.length,
    );
  });

  it('a conta do cliente com o mesmo login não herda nada da plataforma', async () => {
    const { fonte } = fontePlataforma({ trocaObrigatoria: false });
    const { servico } = servicoCom(fonte);
    // 'dono' não existe na fonte sintética do cliente: a entrada comum não cai na plataforma.
    expect(
      (await erroDe(servico.entrar({ estabelecimento: 'aa', login: 'dono', senha: SENHA_INICIAL }, REDE)))
        .tipo,
    ).toBe('credencial-invalida');
  });

  it('login fora de ASCII (invisível, acento) é recusado antes de contar ou consultar', async () => {
    const { fonte } = fontePlataforma({ trocaObrigatoria: false });
    let chamadas = 0;
    const contando: FontePlataforma = {
      ...fonte,
      autenticar: (...a) => {
        chamadas++;
        return fonte.autenticar(...a);
      },
    };
    const { servico } = servicoCom(contando);
    for (const login of ['do\u00adno', 'do\u200bno', 'dóno', 'plataforma:dono'])
      expect((await erroDe(servico.entrarPlataforma({ ...entrada(), login }, REDE))).tipo).toBe(
        'credencial-invalida',
      );
    expect(chamadas).toBe(0);
    // Maiúsculas viram minúsculas (o mesmo login, a mesma chave).
    expect((await servico.entrarPlataforma({ ...entrada(), login: 'DONO' }, REDE)).sessao.usuario.login).toBe(
      'plataforma:dono',
    );
  });

  it('administrador desativado ou com outra senha: a sessão aberta cai na releitura (cache de 3 min)', async () => {
    let t = 1_000_000;
    const { fonte, estado } = fontePlataforma({ trocaObrigatoria: false });
    const { servico } = servicoCom(fonte, 'cliente_a', { agora: () => t });
    const r = await servico.entrarPlataforma(entrada(), REDE);
    expect(await servico.ler(r.idSessao, REDE)).not.toBe(null); // relê e guarda no cache
    estado.ativo = false;
    expect(await servico.ler(r.idSessao, REDE)).not.toBe(null); // ainda no cache
    t += 181_000;
    expect(await servico.ler(r.idSessao, REDE)).toBe(null);
    estado.ativo = true;
    const r2 = await servico.entrarPlataforma(entrada(), REDE);
    estado.senhaEm += 5; // redefinida em outro lugar (semeador, outra API)
    t += 181_000;
    expect(await servico.ler(r2.idSessao, REDE)).toBe(null);
  });

  it('um usuário do cliente nunca alcança as chaves da plataforma (":" recusado)', async () => {
    const { fonte } = fontePlataforma({ trocaObrigatoria: false });
    const { servico } = servicoCom(fonte);
    const r = await servico.entrarPlataforma(entrada(), REDE);
    expect(
      (await erroDe(servico.entrar({ estabelecimento: 'aa', login: 'plataforma:dono', senha: 'x' }, REDE)))
        .tipo,
    ).toBe('credencial-invalida');
    // A gestão do cliente (ficha e bloqueio do usuário) não lista nem derruba a sessão do administrador.
    expect(await servico.sessoesDoUsuario(REDE, 'aa', 'plataforma:dono')).toEqual([]);
    await servico.revogarSessoesDoUsuario(REDE, 'aa', 'plataforma:dono');
    expect(await servico.ler(r.idSessao, REDE)).not.toBe(null);
  });

  it('troca de senha: trilha, evento no banco plataforma e as outras sessões do administrador encerradas', async () => {
    const trilha: EventoParaTrilha[] = [];
    const { fonte, estado } = fontePlataforma({ trocaObrigatoria: false });
    const { servico } = servicoCom(fonte, 'cliente_a', { trilha });
    const outra = await servico.entrarPlataforma(entrada(), REDE);
    const r = await servico.entrarPlataforma(entrada(), REDE);
    await servico.trocarSenha(r.idSessao, REDE, { senhaAtual: SENHA_INICIAL, senhaNova: NOVA });
    expect(estado.eventos).toEqual(['cliente_a']);
    const ev = trilha.find((e) => e.evento === 'plataforma.senha.trocada');
    expect(ev).toMatchObject({
      usuario: 'plataforma:dono',
      chaveNaturalAlvo: 'plataforma:7',
      resultado: 'sucesso',
    });
    expect(JSON.stringify(trilha)).not.toContain(NOVA);
    expect(await servico.ler(outra.idSessao, REDE)).toBe(null);
    expect(await servico.ler(r.idSessao, REDE)).not.toBe(null);
  });
});
