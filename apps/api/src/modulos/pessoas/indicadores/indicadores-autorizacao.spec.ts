// A autorização e o isolamento do painel de indicadores de pessoas SEM depender do módulo "pessoas" estar registrado
// (os testes HTTP ficam pulados até lá): a guarda real (GuardaPermissao) sobre os handlers reais do controlador e o
// controlador sobre a porta em memória. Prova: sem `pessoas.indicadores.ler` é 403 (e a negação vai à trilha), sem
// sessão é 401, e outro estabelecimento na query é 403 `fora-do-estabelecimento`. Dados sintéticos.
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ESCOPOS_SEM_RESTRICAO, type Sessao } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { GuardaPermissao, type RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import type { ResolvedorSessao } from '../../../autorizacao/resolvedor-sessao.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { criarAbility, regrasDeAcesso } from '@sgh/dominio-acesso';
import { IndicadoresPessoasController } from './indicadores.controller.js';
import { PortaIndicadoresPessoasMemoria } from './porta-indicadores-memoria.js';
import { PERMISSOES_INDICADORES_PESSOAS } from './servico-indicadores.js';

const sessao = (permissoes: string[]) =>
  ({
    id: 'sessao-sintetica',
    bloqueada: false,
    permissoes,
    escopos: { ...ESCOPOS_SEM_RESTRICAO },
    estabelecimentoAtivo: 'aa',
    rede: 'rede-sintetica',
    usuario: { id: 'u1', login: 'SINT.RH', nome: 'SINTETICO' },
  }) as unknown as Sessao;

function guarda(s: Sessao | null) {
  const resolvedor = {
    resolver: async () => (s ? { sessao: s, real: true } : null),
    csrfConfere: async () => true,
  } as unknown as ResolvedorSessao;
  const trilha = new RegistradorTrilhaMemoria();
  return { g: new GuardaPermissao(new Reflector(), resolvedor, trilha), trilha };
}

const contexto = (handler: (...a: never[]) => unknown, req: Partial<RequisicaoAutorizada>) =>
  ({
    getHandler: () => handler,
    getClass: () => IndicadoresPessoasController,
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

const status = async (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e: { getStatus?: () => number }) => e.getStatus?.() ?? 500,
  );

const H = IndicadoresPessoasController.prototype;
const ROTAS = [H.apoio, H.painel];

describe('painel de indicadores de pessoas: autorização e isolamento (sem o módulo registrado)', () => {
  it('as duas rotas exigem pessoas.indicadores.ler', async () => {
    expect(PERMISSOES_INDICADORES_PESSOAS.ler).toBe('pessoas.indicadores.ler');
    for (const rota of ROTAS) {
      const { g } = guarda(sessao(['pessoas.indicadores.ler']));
      expect(
        await g.canActivate(contexto(rota, { method: 'GET', url: '/api/pessoas/indicadores', headers: {} })),
      ).toBe(true);
    }
  });

  it('sem a permissão é 403 (outra permissão de pessoas não serve) e a negação vai à trilha; sem sessão é 401', async () => {
    for (const rota of ROTAS) {
      for (const perms of [[], ['pessoas.colaborador.ler'], ['pep.atendimento.ler']]) {
        const { g, trilha } = guarda(sessao(perms));
        expect(
          await status(
            g.canActivate(contexto(rota, { method: 'GET', url: '/api/pessoas/indicadores', headers: {} })),
          ),
        ).toBe(403);
        expect(trilha.eventos.length).toBeGreaterThan(0);
      }
      expect(
        await status(guarda(null).g.canActivate(contexto(rota, { method: 'GET', url: '/x', headers: {} }))),
      ).toBe(401);
    }
  });

  it('outro estabelecimento na query é 403 fora-do-estabelecimento; o da sessão lê', async () => {
    const porta = new PortaIndicadoresPessoasMemoria();
    porta.semear('aa', {
      vinculos: [{ setor: 20, nomeSetor: 'UTI', admissao: '2020-01-01', desligamento: null }],
    });
    const c = new IndicadoresPessoasController(porta, null);
    const s = sessao(['pessoas.indicadores.ler']);
    const req = {
      method: 'GET',
      url: '/api/pessoas/indicadores',
      headers: {},
      sgh: {
        sessao: s,
        real: true,
        ability: criarAbility(regrasDeAcesso(s.permissoes, s.escopos)),
        permissao: 'pessoas.indicadores.ler',
      },
    } as unknown as RequisicaoAutorizada;
    const erro = await c
      .painel({ inicio: '2026-01-01', fim: '2026-03-31', hospital: 'zz' }, req)
      .catch((e) => e);
    expect(erro.getStatus()).toBe(403);
    expect([erro.tipo, erro.extras.codigo]).toEqual(['sem-permissao', 'fora-do-estabelecimento']);
    const ok = await c.painel({ inicio: '2026-01-01', fim: '2026-03-31', hospital: 'aa' }, req);
    expect(ok.hospital).toBe('aa');
  });
});
