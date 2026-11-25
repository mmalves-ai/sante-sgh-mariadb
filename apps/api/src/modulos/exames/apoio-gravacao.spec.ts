// F3.4 (04-INT 65, C1-021): o acesso total que o ApoioGravacao leva ao contexto da operação. Só a sessão do
// administrador da plataforma (ator 'plataforma', ADR 0022) leva `acessoTotal: true` ao executor; o usuário do cliente
// e a sessão "como" (ADR 0021, que age como o usuário alvo, mesmo aberta pela plataforma) seguem sem o indicador. Porta
// espiã: nada conecta a banco.
import type { ContextoOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { ApoioGravacao, type ContextoPortaM18, type PortaGravacaoM18 } from './apoio-gravacao.js';

interface Chamada {
  readonly operacao: string;
  readonly ctx: ContextoOperacao;
}

function portaEspia(destino: 'banco' | 'memoria' = 'banco') {
  const chamadas: Chamada[] = [];
  const porta: PortaGravacaoM18<never> = {
    destino,
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: async (_c, operacao, _entrada, ctx) => {
      chamadas.push({ operacao, ctx });
      return { resultado: { id: 1 }, repetida: false, trilha: null };
    },
    gravarSgh: async () => {
      throw new Error('não usado');
    },
  };
  return { porta, chamadas };
}

const trilhaNula: RegistradorTrilha = {
  registrar: async () => ({ id: 1 }) as never,
};

const CONTEXTO: ContextoPortaM18 = {
  cliente: 'cliente_teste',
  estabelecimento: 1,
  usuario: 7,
  correlacao: 'teste-apoio',
  rede: 'teste',
  hospital: 'H1',
} as ContextoPortaM18;

type Tipo = 'plataforma' | 'cliente' | 'como-plataforma' | 'como-suporte';

function sessao(tipo: Tipo): SessaoCadastro {
  const plataforma = tipo === 'plataforma';
  const como = tipo === 'como-plataforma' || tipo === 'como-suporte';
  const req = {
    headers: { 'idempotency-key': `apoio-${tipo}-0001` },
    ip: '127.0.0.1',
    method: 'POST',
    sgh: {
      sessao: {
        usuario: {
          id: plataforma ? 'plataforma:7' : '7',
          login: plataforma ? 'plataforma:adm' : 'usuario',
          ...(plataforma ? { ator: 'plataforma' } : {}),
        },
      },
    },
    ...(como
      ? {
          sghComo: {
            atorTipo: tipo === 'como-plataforma' ? 'plataforma' : 'suporte',
            rede: 'teste',
            hospital: 'H1',
            alvoLogin: 'usuario',
          },
        }
      : {}),
  } as unknown as RequisicaoAutorizada;
  return {
    req,
    hospital: 'H1',
    rede: 'teste',
    login: plataforma ? 'plataforma:adm' : 'usuario',
    porta: CONTEXTO as never,
    pode: () => true,
  };
}

const novoApoio = (porta: PortaGravacaoM18<never>) =>
  new ApoioGravacao<never>(
    { chave: 'adt', nome: 'a internação', operacoes: {}, semLiberacao: true },
    porta,
    trilhaNula,
    null,
    null,
  );

describe('ApoioGravacao.executar: o acesso total no contexto da operação', () => {
  it('a sessão da plataforma leva acessoTotal: true ao executor', async () => {
    const { porta, chamadas } = portaEspia();
    await novoApoio(porta).executar(sessao('plataforma'), 'internacao.transferirLeito', {}, 'ok');
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.operacao).toBe('internacao.transferirLeito');
    expect(chamadas[0]!.ctx.acessoTotal).toBe(true);
  });

  it('o usuário do cliente segue sem o indicador', async () => {
    const { porta, chamadas } = portaEspia();
    await novoApoio(porta).executar(sessao('cliente'), 'internacao.transferirLeito', {}, 'ok');
    expect(chamadas).toHaveLength(1);
    expect('acessoTotal' in chamadas[0]!.ctx).toBe(false);
  });

  it('a sessão "como" age como o alvo: sem o indicador, aberta pela plataforma ou pelo suporte', async () => {
    for (const tipo of ['como-plataforma', 'como-suporte'] as const) {
      const { porta, chamadas } = portaEspia();
      await novoApoio(porta).executar(sessao(tipo), 'internacao.transferirLeito', {}, 'ok');
      expect(chamadas).toHaveLength(1);
      expect('acessoTotal' in chamadas[0]!.ctx).toBe(false);
    }
  });

  it('a sessão "como" com a marca da plataforma na sessão (defesa) também fica sem o indicador', async () => {
    const s = sessao('como-plataforma');
    (s.req.sgh!.sessao.usuario as { ator?: string }).ator = 'plataforma';
    const { porta, chamadas } = portaEspia();
    await novoApoio(porta).executar(s, 'internacao.transferirLeito', {}, 'ok');
    expect('acessoTotal' in chamadas[0]!.ctx).toBe(false);
  });

  it('o contexto leva cliente, estabelecimento, usuário e a Idempotency-Key da sessão', async () => {
    const { porta, chamadas } = portaEspia();
    await novoApoio(porta).executar(sessao('plataforma'), 'internacao.transferirLeito', {}, 'ok', {
      reautenticadoEm: 123,
    });
    expect(chamadas[0]!.ctx).toMatchObject({
      cliente: 'cliente_teste',
      estabelecimento: 1,
      usuario: 7,
      chaveIdempotencia: 'apoio-plataforma-0001',
      reautenticadoEm: 123,
      acessoTotal: true,
    });
  });
});
