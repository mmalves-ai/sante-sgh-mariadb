// M59-F4, correção da revisão do M59.4 (achado 1): o limite de administradores (acesso.saneamento.administradoresMaximo)
// vale também na tela de Usuários. Pôr alguém no grupo de acesso total (trocar de grupo ou criar) e desbloquear quem
// está nele recusam com administradores-no-limite quando os ativos passariam do máximo, sem chamar a receita. O
// controlador direto, com a fonte falsa e o serviço do saneamento sobre a porta em memória (dados sintéticos).
import { describe, expect, it, vi } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import type { ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import { PortaSaneamentoMemoria } from '../acesso/saneamento/porta-memoria.js';
import { ServicoSaneamento } from '../acesso/saneamento/servico.js';
import type { FonteAdministracao } from './fonte.js';
import { UsuariosController } from './usuarios.controller.js';

const req = {
  headers: {},
  sgh: {
    sessao: {
      rede: 'rede-sint',
      estabelecimentoAtivo: 'pc',
      usuario: { login: 'SINT.GESTOR' },
      perfil: { perfil: 'gestor-acessos', complementares: [] },
      permissoes: ['acesso.usuario.editar', 'acesso.usuario.bloquear', 'acesso.usuario.criar'],
    },
  },
} as unknown as RequisicaoAutorizada;

const conta = (login: string, grupo: string, extra = {}) => ({
  login,
  idUsuario: 200 + login.length,
  nome: null,
  grupo,
  ativo: true,
  bloqueado: false,
  ultimoAcesso: '2026-10-20',
  ...extra,
});

function montar(maximo: number) {
  const porta = new PortaSaneamentoMemoria()
    .comGrupo('MASTER', [1, 2])
    .comGrupo('FATURAMENTO', [1])
    .comUsuario(conta('SINT.M1', 'MASTER'))
    .comUsuario(conta('SINT.M2', 'MASTER'))
    .comUsuario(conta('SINT.MB', 'MASTER', { bloqueado: true }))
    .comUsuario(conta('SINT.F', 'FATURAMENTO'));
  const saneamento = new ServicoSaneamento({
    porta,
    executor: null,
    administradoresMaximo: async () => maximo,
  });
  const executar = vi.fn(async () => ({}));
  const fonte = { destino: 'memoria', executar } as unknown as FonteAdministracao;
  const resolvedor = { idSessao: () => null } as unknown as ResolvedorSessao;
  const ctl = new UsuariosController(fonte, null, resolvedor, null, null, saneamento);
  return { ctl, executar };
}

async function codigo(p: Promise<unknown>): Promise<string | undefined> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  expect((e as ErroProblema).getStatus()).toBe(409);
  return (e as ErroProblema).extras.codigo;
}

describe('limite de administradores na tela de Usuários', () => {
  it('no limite: troca para o MASTER, criação no MASTER e desbloqueio de quem está nele recusam sem gravar', async () => {
    const { ctl, executar } = montar(2);
    expect(await codigo(ctl.grupo('SINT.F', { entrada: { grupo: 'MASTER' }, senha: 'x' }, req))).toBe(
      'administradores-no-limite',
    );
    expect(
      await codigo(ctl.criar({ entrada: { login: 'SINT.NOVO', grupo: 'MASTER' }, senha: 'x' }, req)),
    ).toBe('administradores-no-limite');
    expect(await codigo(ctl.bloqueio('SINT.MB', { bloquear: false, senha: 'x' }, req))).toBe(
      'administradores-no-limite',
    );
    expect(executar).not.toHaveBeenCalled();
  });

  it('com folga, ou fora do MASTER, a guarda passa e o pedido segue para a confirmação da senha', async () => {
    // Sem sessão real no unitário, a reautenticação responde 401: a guarda do limite não recusou antes dela.
    const status = async (p: Promise<unknown>) =>
      (
        (await p.then(
          () => null,
          (x: unknown) => x,
        )) as ErroProblema
      ).getStatus();
    const cheio = montar(2);
    expect(
      await status(cheio.ctl.grupo('SINT.M1', { entrada: { grupo: 'FATURAMENTO' }, senha: 'x' }, req)),
    ).toBe(401);
    expect(await status(cheio.ctl.bloqueio('SINT.F', { bloquear: false, senha: 'x' }, req))).toBe(401);
    const folga = montar(3);
    expect(await status(folga.ctl.grupo('SINT.F', { entrada: { grupo: 'MASTER' }, senha: 'x' }, req))).toBe(
      401,
    );
    expect(await status(folga.ctl.bloqueio('SINT.MB', { bloquear: false, senha: 'x' }, req))).toBe(401);
  });
});
