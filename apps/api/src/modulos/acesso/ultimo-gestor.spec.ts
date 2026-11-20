// W1-01 (parte 3c): a guarda do último gestor de acessos ativo nos dois controladores, com a fonte falsa dos
// gestores. Recusa (409 ultimo-gestor-acessos) sem chamar a receita; com outro gestor, segue para a senha (401 no
// unitário, sem sessão real); sem conseguir ler, 503 (falha fechada). Mais a fonte em memória (estado sintético).
import type { GestorAcessoLido } from '@sgh/legado';
import { describe, expect, it, vi } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import type { ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { FonteAdministracao } from '../administracao/fonte.js';
import { UsuariosController } from '../administracao/usuarios.controller.js';
import { GestaoAcessoController } from './gestao.controller.js';
import { type FonteGestao, fonteGestaoMemoria } from './gestao-fonte.js';
import { exigirGestorRestante } from './ultimo-gestor.js';

const req = {
  headers: { 'idempotency-key': 'chave-ultimo-gestor-1' },
  sgh: {
    sessao: {
      rede: 'rede-sint',
      estabelecimentoAtivo: 'pc',
      usuario: { login: 'SINT.PLATAFORMA' },
      perfil: { perfil: 'administrador-sistema', complementares: [] },
      permissoes: ['acesso.usuario.editar', 'acesso.usuario.bloquear', 'acesso.perfil.gerir'],
    },
  },
} as unknown as RequisicaoAutorizada;

const UM: GestorAcessoLido[] = [
  { login: 'ANA', grupo: 'MEDICOS', papelGestor: true, concessoes: ['7'] },
  { login: 'BETO', grupo: 'MASTER', papelGestor: false, concessoes: [] },
];

function montar(gestores: GestorAcessoLido[] | Error) {
  const leitor = vi.fn(async () => {
    if (gestores instanceof Error) throw gestores;
    return gestores;
  });
  const executar = vi.fn(async () => ({}));
  const revogarPerfil = vi.fn(async () => ({ login: 'ANA' }));
  const resolvedor = { idSessao: () => null } as unknown as ResolvedorSessao;
  const admin = {
    destino: 'memoria',
    executar,
    fichaUsuario: async (_c: unknown, login: string) => ({ login, grupo: 'MASTER' }),
  } as unknown as FonteAdministracao;
  const usuarios = new UsuariosController(admin, null, resolvedor, null, null, null, {
    gestoresAcesso: leitor,
  });
  const fonteGestao = {
    destino: 'memoria',
    gestoresAcesso: leitor,
    executar,
    revogarPerfil,
    receita: () => ({ estado: 'verde', ligada: true, motivo: null }),
  } as unknown as FonteGestao;
  const gestao = new GestaoAcessoController(fonteGestao, null, resolvedor);
  return { usuarios, gestao, executar, revogarPerfil };
}

async function erro(p: Promise<unknown>): Promise<ErroProblema> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  return e as ErroProblema;
}

describe('último gestor de acessos ativo (W1-01, parte 3c)', () => {
  it('bloquear, tirar do acesso total, retirar o papel 0 ou o perfil do último gestor: 409 sem gravar', async () => {
    // Só BETO (MASTER) é gestor: bloquear ou tirar do MASTER zera.
    const so = montar([UM[1]!]);
    for (const p of [
      () => so.usuarios.bloqueio('BETO', { bloquear: true, senha: 'x' }, req),
      () => so.usuarios.grupo('BETO', { entrada: { grupo: 'FATURAMENTO' }, senha: 'x' }, req),
      () =>
        so.gestao.legado(
          'acesso.trocarGrupoUsuario',
          { entrada: { login: 'BETO', grupo: 'FATURAMENTO' }, senha: 'x' },
          req,
        ),
    ]) {
      const e = await erro(p());
      expect(e.getStatus()).toBe(409);
      expect(e.extras.codigo).toBe('ultimo-gestor-acessos');
      expect(e.detalhe).toMatch(/último gestor de acessos ativo/);
    }
    // Só ANA (papel 0 e concessão 7): retirar uma das duas fontes passa; a única restante, não.
    const ana = montar([{ login: 'ANA', grupo: 'MEDICOS', papelGestor: true, concessoes: [] }]);
    expect(
      (
        await erro(
          ana.gestao.legado(
            'acesso.revogarPapelUsuario',
            { entrada: { login: 'ANA', papel: 0 }, senha: 'x' },
            req,
          ),
        )
      ).extras.codigo,
    ).toBe('ultimo-gestor-acessos');
    const perfil = montar([{ login: 'ANA', grupo: 'MEDICOS', papelGestor: false, concessoes: ['7'] }]);
    expect(
      (await erro(perfil.gestao.revogarPerfil('7', { motivo: 'saiu do setor', senha: 'x' }, req))).extras
        .codigo,
    ).toBe('ultimo-gestor-acessos');
    for (const m of [so, ana, perfil]) {
      expect(m.executar).not.toHaveBeenCalled();
      expect(m.revogarPerfil).not.toHaveBeenCalled();
    }
  });

  it('com outro gestor ativo, a guarda passa e o pedido segue para a confirmação da senha', async () => {
    const m = montar(UM);
    const status = async (p: Promise<unknown>) => (await erro(p)).getStatus();
    expect(await status(m.usuarios.bloqueio('BETO', { bloquear: true, senha: 'x' }, req))).toBe(401);
    expect(
      await status(m.usuarios.grupo('BETO', { entrada: { grupo: 'FATURAMENTO' }, senha: 'x' }, req)),
    ).toBe(401);
    expect(await status(m.gestao.revogarPerfil('7', { motivo: 'saiu do setor', senha: 'x' }, req))).toBe(401);
    expect(
      await status(
        m.gestao.legado(
          'acesso.revogarPapelUsuario',
          { entrada: { login: 'ANA', papel: 0 }, senha: 'x' },
          req,
        ),
      ),
    ).toBe(401);
  });

  it('sem ler os gestores, recusa com 503 (falha fechada); sem a fonte, não se aplica', async () => {
    const m = montar(new Error('banco fora'));
    expect((await erro(m.usuarios.bloqueio('BETO', { bloquear: true, senha: 'x' }, req))).getStatus()).toBe(
      503,
    );
    await expect(
      exigirGestorRestante(null, 'r', 'pc', { tipo: 'bloquear', login: 'X' }),
    ).resolves.toBeUndefined();
  });

  it('fonte em memória: gestores sintéticos ativos (papel 0, MASTER ou concessão vigente), sem bloqueados', async () => {
    const f = fonteGestaoMemoria({ registrar: async () => undefined } as never, {} as never, 'dev');
    const g = await f.gestoresAcesso('rede-sint', 'pc');
    const gestor = g.find((x) => x.login === 'SINT.GESTOR');
    expect(gestor?.papelGestor).toBe(true);
    expect(g.some((x) => x.grupo === 'MASTER')).toBe(true);
    expect(g.some((x) => x.login === 'SINT.BLOQUEADO')).toBe(false);
    expect(g.every((x) => x.papelGestor || x.concessoes.length > 0 || /MASTER/i.test(x.grupo ?? ''))).toBe(
      true,
    );
  });
});
