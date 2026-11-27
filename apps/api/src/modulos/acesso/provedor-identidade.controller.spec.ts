// C2-010 (01-ADM L61): a volta do provedor de identidade no controller, com porta, entrada OpenID e sessão falsas.
// Prova o mapeamento das recusas (vínculo, token do provedor, estado vencido) e do segundo fator: a recusa da conta
// encerra o estado; o pedido do segundo fator o mantém (a pessoa informa o código e conclui sem voltar ao provedor).
import { describe, expect, it, vi } from 'vitest';
import type { Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ResolvedorRede } from '../../sessao/rede.js';
import { ErroSessao, type ServicoSessao } from '../../sessao/servico-sessao.js';
import { ErroEntradaOidc, type EntradaOidc } from './entrada-oidc.js';
import type { PortaProvedorIdentidadePropria } from './provedor-identidade-propria.js';
import { ProvedorIdentidadeController } from './provedor-identidade.controller.js';

const ESTADO = 'estado-sintetico-c2010-0001';
const PROVEDOR = { id: 7, codigo: 'diretorio' };

function montar(o: {
  resolver?: () => Promise<unknown>;
  entrar?: () => Promise<unknown>;
  concluir?: () => Promise<unknown>;
  pendente?: boolean;
}) {
  const encerrar = vi.fn();
  const oidc = {
    pendente: () => (o.pendente === false ? null : { provedor: 'diretorio', estabelecimento: 'pc' }),
    concluir: vi.fn(
      o.concluir ??
        (async () => ({ sujeito: 'sub-1', email: null, emailConfirmado: false, grupos: ['cn=enf'] })),
    ),
    encerrar,
  } as unknown as EntradaOidc;
  const porta = {
    provedorParaEntrada: async () => PROVEDOR,
    resolverEntrada: vi.fn(
      o.resolver ?? (async () => ({ login: 'conta.sintetica', vinculo: 1, novo: false })),
    ),
  } as unknown as PortaProvedorIdentidadePropria;
  const entrar = vi.fn(
    o.entrar ??
      (async () => ({
        idSessao: 'sessao-1',
        csrf: 'csrf-1',
        ttlSegundos: 600,
        sessao: { login: 'conta.sintetica' },
      })),
  );
  const servico = { entrarPorProvedorExterno: entrar } as unknown as ServicoSessao;
  const resolvedor = { resolver: () => 'rede-sintetica' } as unknown as ResolvedorRede;
  const c = new ProvedorIdentidadeController(
    { ambiente: 'dev' } as Configuracao,
    resolvedor,
    servico,
    porta,
    oidc,
  );
  const cabecalhos: Array<[string, unknown]> = [];
  const res = { header: (n: string, v: unknown) => cabecalhos.push([n, v]) };
  const req = { headers: { host: 'pc.exemplo.test' } } as never;
  const voltar = (corpo: Record<string, unknown> = { estado: ESTADO, codigo: 'codigo-do-provedor' }) =>
    c.retornoProvedor(corpo, req, res);
  return { voltar, encerrar, entrar, porta, cabecalhos };
}

async function problema(p: Promise<unknown>): Promise<ErroProblema> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroProblema) return e;
    throw e;
  }
  throw new Error('esperava uma recusa');
}

describe('ProvedorIdentidadeController: volta do provedor', () => {
  it('identidade ligada: abre a sessão com os cookies, passa os grupos à porta e encerra o estado', async () => {
    const m = montar({});
    const sessao = await m.voltar();
    expect(sessao).toEqual({ login: 'conta.sintetica' });
    expect(vi.mocked(m.porta.resolverEntrada).mock.calls[0]![2]).toMatchObject({ grupos: ['cn=enf'] });
    expect((m.entrar.mock.calls[0] as unknown[])[0]).toEqual({
      estabelecimento: 'pc',
      login: 'conta.sintetica',
      codigoSegundoFator: undefined,
    });
    expect(m.cabecalhos[0]![0]).toBe('set-cookie');
    expect(m.cabecalhos[0]![1]).toHaveLength(3);
    expect(m.encerrar).toHaveBeenCalledWith(ESTADO);
  });

  it('recusa da porta (sem vínculo): 401 com o código e o texto para a pessoa; estado encerrado; sem sessão', async () => {
    const m = montar({ resolver: async () => ({ recusa: 'sem-vinculo' }) });
    const e = await problema(m.voltar());
    expect(e.getStatus()).toBe(401);
    expect(e.tipo).toBe('nao-autenticado');
    expect(e.extras).toEqual({ codigo: 'sem-vinculo' });
    expect(e.detalhe).toMatch(/gestor de acessos/);
    expect(m.encerrar).toHaveBeenCalledWith(ESTADO);
    expect(m.entrar).not.toHaveBeenCalled();
  });

  it('segundo fator pedido pela política da conta: 401 com o código do segundo fator e o estado mantido', async () => {
    const m = montar({
      entrar: async () => {
        throw new ErroSessao('segundo-fator-necessario', 'Informe o código.', 'segundo-fator-codigo');
      },
    });
    const e = await problema(m.voltar());
    expect(e.getStatus()).toBe(401);
    expect(e.extras).toEqual({ codigo: 'segundo-fator-codigo' });
    expect(m.encerrar).not.toHaveBeenCalled();
  });

  it('bloqueio e excesso de tentativas da conta valem na entrada pelo provedor', async () => {
    const bloqueada = montar({
      entrar: async () => {
        throw new ErroSessao('sessao-bloqueada', 'Conta bloqueada.');
      },
    });
    expect((await problema(bloqueada.voltar())).getStatus()).toBe(423);
    const tentativas = montar({
      entrar: async () => {
        throw new ErroSessao('muitas-tentativas', 'Aguarde.');
      },
    });
    expect((await problema(tentativas.voltar())).getStatus()).toBe(429);
  });

  it('token recusado pelo provedor (assinatura, emissor ou nonce): 401 com o código da conferência', async () => {
    const m = montar({
      concluir: async () => {
        throw new ErroEntradaOidc('emissor-diferente', 'O emissor do token não confere.');
      },
    });
    const e = await problema(m.voltar());
    expect(e.getStatus()).toBe(401);
    expect(e.extras).toEqual({ codigo: 'emissor-diferente' });
    expect(m.entrar).not.toHaveBeenCalled();
  });

  it('estado vencido ou desconhecido: 401 estado-invalido; corpo fora do formato: 400', async () => {
    const vencido = montar({ pendente: false });
    expect((await problema(vencido.voltar())).extras).toEqual({ codigo: 'estado-invalido' });
    const m = montar({});
    expect((await problema(m.voltar({ estado: 'curto' }))).getStatus()).toBe(400);
  });
});
