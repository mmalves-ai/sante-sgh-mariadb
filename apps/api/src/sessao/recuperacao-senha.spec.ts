// W1-01 (parte 7): "Esqueci a senha". Resposta idêntica para conta existente e inexistente, token de uso único que
// vence no prazo, limite de pedidos por hora, senha provisória pela redefinição com a troca obrigatória no próximo
// acesso, e a chave desligada esconde o botão. Nada de senha, token ou resumo na trilha nem no aviso.
import { describe, expect, it } from 'vitest';
import { RESPOSTA_RECUPERACAO_SENHA } from '@sgh/contratos';
import { RegistradorTrilhaMemoria } from '../autorizacao/trilha.js';
import { portaSenhaMemoria } from '../modulos/acesso/senha/porta-senha.js';
import { ArmazemMemoria } from './armazem.js';
import {
  CHAVE_RECUPERACAO_SENHA,
  envioRecuperacaoMemoria,
  PEDIDOS_POR_CONTA_HORA,
  ServicoRecuperacaoSenha,
  VALIDADE_TOKEN_RECUPERACAO_SEG,
} from './recuperacao-senha.js';
import type { GanchoIdentidade } from './servico-sessao.js';
import { REDE, montar } from './teste.spec-util.js';

const ORIGEM = { estacao: 'SGH-WEB:teste', correlacao: 'teste-recuperacao' };

const configuracao = (ligada: boolean) =>
  ({
    chaves: async () => [
      { chave: CHAVE_RECUPERACAO_SENHA, tipo: 'recurso', escopo: 'hospital', valor: '*', ligada },
    ],
    prerequisitos: async () => [
      {
        recurso: CHAVE_RECUPERACAO_SENHA,
        tipo: 'aprovacao',
        situacao: 'dispensado',
        validade: null,
        evidencia: 'teste',
        alteradoPor: 'SINT.ADMIN',
        alteradoEm: '2026-11-18T00:00:00.000Z',
      },
    ],
    valoresParametro: async () => [],
  }) as never;

function cenario(o: { ligada?: boolean; existe?: (e: string, l: string) => boolean; envio?: boolean } = {}) {
  let agora = Date.parse('2026-11-18T12:00:00Z');
  const relogio = () => agora;
  const armazem = new ArmazemMemoria(relogio);
  const regravadas: { login: string; origem: string | undefined }[] = [];
  const identidade: GanchoIdentidade = {
    autenticar: async () => ({ tipo: 'legado' as const }),
    regravar: async (a, _senha, origem) => {
      regravadas.push({ login: a.login, origem });
      return true;
    },
    segundoFatorNoLogin: async () => ({
      tipo: 'entrar' as const,
      info: { cadastrado: false, disponivel: true, exigencia: 'opcional' as const, prazoAdesaoAte: null },
    }),
  };
  const gravadas: { login: string; tipo: string | undefined; autor: string }[] = [];
  const base = portaSenhaMemoria();
  const { servico } = montar({
    agora: relogio,
    armazem,
    config: {
      trocaSenhaPeloNovo: true,
      identidade,
      senhaLegado: {
        combinacao: base.combinacao,
        reuso: (h, l, s, d) => base.reuso(h, l, s, d),
        async gravar(h, l, s, ctx, tipo) {
          gravadas.push({ login: l, tipo, autor: ctx.usuarioLegado ?? '' });
          await base.gravar(h, l, s, ctx, tipo);
          return 77;
        },
      },
    },
  });
  const envio = envioRecuperacaoMemoria(o.existe ?? ((_e, l) => l === 'SINT.USUARIO'));
  const trilha = new RegistradorTrilhaMemoria();
  const avisos: unknown[] = [];
  const rec = new ServicoRecuperacaoSenha(
    servico,
    armazem,
    configuracao(o.ligada ?? true),
    o.envio === false ? null : envio,
    trilha,
    (m, c) => avisos.push({ m, c }),
  );
  return {
    rec,
    envio,
    trilha,
    gravadas,
    regravadas,
    avisos,
    avancar: (seg: number) => {
      agora += seg * 1000;
    },
  };
}

async function erro(p: Promise<unknown>): Promise<{ status: number; detalhe: string }> {
  try {
    await p;
  } catch (e) {
    const x = e as { status?: number; getStatus?: () => number; message?: string; detail?: string };
    return { status: x.getStatus?.() ?? x.status ?? 0, detalhe: x.detail ?? x.message ?? '' };
  }
  throw new Error('esperava recusa');
}

describe('esqueci a senha (W1-01, parte 7)', () => {
  it('responde igual para conta existente e inexistente; só a existente recebe o token', async () => {
    const c = cenario();
    const a = await c.rec.pedir(REDE, { estabelecimento: 'aa', login: 'SINT.USUARIO' }, '10.0.0.1', ORIGEM);
    const b = await c.rec.pedir(REDE, { estabelecimento: 'aa', login: 'NAO.EXISTE' }, '10.0.0.1', ORIGEM);
    expect(a).toEqual(b);
    expect(a).toEqual({ mensagem: RESPOSTA_RECUPERACAO_SENHA });
    await c.rec.aguardarEnvios();
    expect(c.envio.enviadas.map((m) => m.login)).toEqual(['SINT.USUARIO']);
    expect(c.envio.enviadas[0]?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(c.envio.enviadas[0]?.validadeMinutos).toBe(15);
  });

  it('o token vira a senha provisória pela redefinição, uma vez só, com troca obrigatória no próximo acesso', async () => {
    const c = cenario();
    await c.rec.pedir(REDE, { estabelecimento: 'aa', login: 'SINT.USUARIO' }, '10.0.0.1', ORIGEM);
    await c.rec.aguardarEnvios();
    const token = c.envio.enviadas[0]!.token;
    const r = await c.rec.usar(REDE, token, ORIGEM);
    expect(r.trocaObrigatoria).toBe(true);
    expect(r.senhaProvisoria.length).toBeGreaterThanOrEqual(8);
    expect(c.gravadas).toEqual([{ login: 'SINT.USUARIO', tipo: 'redefinicao', autor: 'SINT.USUARIO' }]);
    expect(c.regravadas).toEqual([{ login: 'SINT.USUARIO', origem: 'senha-provisoria' }]);
    expect((await erro(c.rec.usar(REDE, token, ORIGEM))).status).toBe(400);
    expect(c.gravadas).toHaveLength(1);
  });

  it('o token vence no prazo', async () => {
    const c = cenario();
    await c.rec.pedir(REDE, { estabelecimento: 'aa', login: 'SINT.USUARIO' }, '10.0.0.1', ORIGEM);
    await c.rec.aguardarEnvios();
    c.avancar(VALIDADE_TOKEN_RECUPERACAO_SEG + 1);
    const e = await erro(c.rec.usar(REDE, c.envio.enviadas[0]!.token, ORIGEM));
    expect(e.status).toBe(400);
    expect(c.gravadas).toHaveLength(0);
  });

  it('um pedido novo invalida o token anterior da mesma conta', async () => {
    const c = cenario();
    await c.rec.pedir(REDE, { estabelecimento: 'aa', login: 'SINT.USUARIO' }, '10.0.0.1', ORIGEM);
    await c.rec.aguardarEnvios();
    await c.rec.pedir(REDE, { estabelecimento: 'aa', login: 'SINT.USUARIO' }, '10.0.0.1', ORIGEM);
    await c.rec.aguardarEnvios();
    const [primeiro, segundo] = c.envio.enviadas;
    expect((await erro(c.rec.usar(REDE, primeiro!.token, ORIGEM))).status).toBe(400);
    expect((await c.rec.usar(REDE, segundo!.token, ORIGEM)).trocaObrigatoria).toBe(true);
  });

  it('limite de pedidos por hora: a mesma recusa para conta existente e inexistente; passa depois da hora', async () => {
    const c = cenario();
    for (const login of ['SINT.USUARIO', 'NAO.EXISTE']) {
      for (let i = 0; i < PEDIDOS_POR_CONTA_HORA; i++)
        await c.rec.pedir(REDE, { estabelecimento: 'aa', login }, '10.0.0.2', ORIGEM);
      const e = await erro(c.rec.pedir(REDE, { estabelecimento: 'aa', login }, '10.0.0.2', ORIGEM));
      expect(e.status).toBe(429);
    }
    c.avancar(3601);
    await expect(
      c.rec.pedir(REDE, { estabelecimento: 'aa', login: 'SINT.USUARIO' }, '10.0.0.2', ORIGEM),
    ).resolves.toEqual({ mensagem: RESPOSTA_RECUPERACAO_SENHA });
  });

  it('a chave desligada ou sem servidor de envio: o botão some e o pedido é recusado igual para todos', async () => {
    for (const c of [cenario({ ligada: false }), cenario({ envio: false })]) {
      expect(await c.rec.disponivel(REDE, 'aa')).toEqual({ disponivel: false });
      const a = await erro(c.rec.pedir(REDE, { estabelecimento: 'aa', login: 'SINT.USUARIO' }, null, ORIGEM));
      const b = await erro(c.rec.pedir(REDE, { estabelecimento: 'aa', login: 'NAO.EXISTE' }, null, ORIGEM));
      expect(a).toEqual(b);
      expect(a.status).toBe(409);
    }
    expect(await cenario().rec.disponivel(REDE, 'aa')).toEqual({ disponivel: true });
  });

  it('a trilha leva só o login e o resultado: nenhum token, senha ou resumo', async () => {
    const c = cenario();
    await c.rec.pedir(REDE, { estabelecimento: 'aa', login: 'SINT.USUARIO' }, '10.0.0.1', ORIGEM);
    await c.rec.pedir(REDE, { estabelecimento: 'aa', login: 'NAO.EXISTE' }, '10.0.0.1', ORIGEM);
    await c.rec.aguardarEnvios();
    const token = c.envio.enviadas[0]!.token;
    const { senhaProvisoria } = await c.rec.usar(REDE, token, ORIGEM);
    const texto = JSON.stringify([c.trilha.eventos, c.avisos]);
    expect(texto).not.toContain(token);
    expect(texto).not.toContain(senhaProvisoria);
    expect(c.trilha.eventos.map((e) => [e.evento, e.usuario, e.resultado])).toEqual([
      ['acesso.senha.recuperacao-pedida', 'SINT.USUARIO', 'sucesso'],
      ['acesso.senha.recuperacao-pedida', 'NAO.EXISTE', 'falha'],
    ]);
  });
});
