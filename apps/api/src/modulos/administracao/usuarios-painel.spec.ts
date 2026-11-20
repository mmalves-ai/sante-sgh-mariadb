// M43, regra 4 no bloqueio da tela de usuários (revisão corrigida): falha fechada. A ficha do usuário, os aparelhos ou
// o relógio do banco que não se leram recusam o bloqueio (503) sem gravar nada; o relógio do processo nunca substitui o
// do banco. O controlador direto, com fonte e recepção falsas (nada conecta a banco).
import { describe, expect, it, vi } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import type { ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { PortaRecepcao } from '../recepcao/public-api.js';
import type { FonteAdministracao } from './fonte.js';
import { UsuariosController } from './usuarios.controller.js';

const req = {
  headers: {},
  sgh: {
    sessao: {
      rede: 'rede-sint',
      estabelecimentoAtivo: 'aa',
      usuario: { login: 'SINT.GESTOR' },
      perfil: { perfil: 'gestor-acessos', complementares: [] },
      permissoes: ['acesso.usuario.bloquear'],
    },
  },
} as unknown as RequisicaoAutorizada;

function montar(o: {
  ficha?: () => Promise<unknown>;
  dispositivos?: () => Promise<unknown[]>;
  relogio?: () => Promise<{ hoje: string; agora: string }>;
  semRecepcao?: boolean;
}) {
  const executar = vi.fn(async () => ({}));
  const fonte = {
    destino: 'memoria',
    fichaUsuario: vi.fn(o.ficha ?? (async () => ({ login: 'SINT.TV', grupo: 'PAINEIS' }))),
    executar,
  } as unknown as FonteAdministracao;
  const recepcao = o.semRecepcao
    ? null
    : ({
        dispositivos: vi.fn(o.dispositivos ?? (async () => [])),
        relogio: vi.fn(o.relogio ?? (async () => ({ hoje: '2027-01-10', agora: '2027-01-10T12:00:00' }))),
      } as unknown as PortaRecepcao);
  const ctl = new UsuariosController(fonte, null, {} as ResolvedorSessao, recepcao, null);
  return { ctl, executar };
}

async function erroDo(p: Promise<unknown>): Promise<ErroProblema> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  return e as ErroProblema;
}

describe('regra 4 no bloqueio: falha fechada', () => {
  it('a leitura da ficha que falha recusa com 503 e não grava', async () => {
    const { ctl, executar } = montar({
      ficha: async () => {
        throw new Error('tempo esgotado na cópia');
      },
    });
    const e = await erroDo(ctl.bloqueio('SINT.TV', { bloquear: true, senha: 'x' }, req));
    expect(e.getStatus()).toBe(503);
    expect(executar).not.toHaveBeenCalled();
  });

  it('o relógio do banco que falha recusa (sem trocar pelo relógio do processo)', async () => {
    const { ctl, executar } = montar({
      relogio: async () => {
        throw new Error('relógio ilegível');
      },
    });
    expect((await erroDo(ctl.bloqueio('SINT.TV', { bloquear: true, senha: 'x' }, req))).getStatus()).toBe(
      503,
    );
    expect(executar).not.toHaveBeenCalled();
  });

  it('os aparelhos que não se leram, ou sem a porta dos aparelhos, recusam', async () => {
    const a = montar({
      dispositivos: async () => {
        throw new Error('porta fora');
      },
    });
    expect((await erroDo(a.ctl.bloqueio('SINT.TV', { bloquear: true, senha: 'x' }, req))).getStatus()).toBe(
      503,
    );
    const b = montar({ semRecepcao: true });
    expect((await erroDo(b.ctl.bloqueio('SINT.TV', { bloquear: true, senha: 'x' }, req))).getStatus()).toBe(
      503,
    );
    expect(a.executar).not.toHaveBeenCalled();
    expect(b.executar).not.toHaveBeenCalled();
  });

  it('lido e sem aparelho conferido: 409 login-de-painel-em-uso', async () => {
    const { ctl, executar } = montar({});
    const e = await erroDo(ctl.bloqueio('SINT.TV', { bloquear: true, senha: 'x' }, req));
    expect(e.getStatus()).toBe(409);
    expect(executar).not.toHaveBeenCalled();
  });
});
