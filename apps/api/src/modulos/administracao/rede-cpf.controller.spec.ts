// W1-01 (parte 11c): painel da rede por CPF e "bloquear em todos". O controlador direto com uma fonte falsa de três
// estabelecimentos (um deles fora do ar) e com a fonte em memória (um banco só).
import { describe, expect, it } from 'vitest';
import type { ContaRedeLegado } from '@sgh/legado';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import type { ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import type { LeitorGestores } from '../acesso/ultimo-gestor.js';
import type { FonteAdministracao } from './fonte.js';
import {
  estadoM10Sintetico,
  fonteAdministracaoMemoria,
  reiniciarEstadoM10Sintetico,
} from './fonte-memoria.js';
import { chaveDoItem, RedeCpfController } from './rede-cpf.controller.js';

const CPF = '52998224725';

function requisicao(login = 'SINT.GESTOR', perfil = 'gestor-acessos', hospital = 'pc'): RequisicaoAutorizada {
  return {
    headers: { cookie: 'sgh_csrf=c1', 'x-csrf': 'c1', 'idempotency-key': 'pedido-rede-0001' },
    sgh: {
      real: true,
      sessao: {
        rede: 'rede-sint',
        estabelecimentoAtivo: hospital,
        usuario: { login },
        perfil: { perfil, complementares: [] },
        permissoes: ['acesso.usuario.ler', 'acesso.usuario.bloquear'],
      },
    },
  } as unknown as RequisicaoAutorizada;
}
const resolvedor = { idSessao: () => 's1', rede: () => 'rede-sint' } as unknown as ResolvedorSessao;

function servico() {
  const revogadas: string[] = [];
  const s = {
    csrfConfere: async () => true,
    reautenticar: async (_id: string, _r: string, senha: string) => {
      if (senha !== 'certa') throw new Error('senha');
    },
    revogarSessoesDoUsuario: async (_r: string, h: string, login: string) => {
      revogadas.push(`${h}:${login}`);
    },
  } as unknown as ServicoSessao;
  return { s, revogadas };
}

const conta = (login: string, extra: Partial<ContaRedeLegado> = {}): ContaRedeLegado => ({
  login,
  nome: 'Ana',
  grupo: 'MEDICOS',
  ativo: true,
  bloqueado: false,
  perfis: [],
  ...extra,
});

function fonteRede(contas: Record<string, ContaRedeLegado[] | 'fora'>) {
  const executadas: { op: string; hospital: string; login: string; chave: string }[] = [];
  const fonte = {
    destino: 'legado',
    redeDoAcesso: () => ({
      rede: 'rede-sint',
      estabelecimentos: [
        { codigo: 'pc', nome: 'Hospital PC' },
        { codigo: 'hb', nome: 'Hospital HB' },
        { codigo: 'hc', nome: 'Hospital HC' },
      ],
    }),
    fichaUsuario: async (_c: unknown, login: string) =>
      login === 'ANA' ? { login, cpf: CPF } : login === 'SEMCPF' ? { login, cpf: null } : null,
    contasDoCpf: async (c: { hospital: string }, cpf: string) => {
      expect(cpf).toBe(CPF);
      const x = contas[c.hospital] ?? [];
      if (x === 'fora') throw new ErroProblema('indisponivel', 503, 'fora');
      return x;
    },
    executar: async (op: string, e: { login: string }, ctx: { hospital: string; idempotencyKey: string }) => {
      executadas.push({ op, hospital: ctx.hospital, login: e.login, chave: ctx.idempotencyKey });
      return {};
    },
  } as unknown as FonteAdministracao;
  return { fonte, executadas };
}

describe('painel da rede por CPF (W1-01, parte 11c)', () => {
  it('lê banco a banco: contas, grupo e perfis por estabelecimento; o CPF não volta; banco fora fica indisponível', async () => {
    const { fonte } = fonteRede({
      pc: [conta('ANA', { perfis: ['medico'] })],
      hb: [conta('ANA.HB', { grupo: 'ENFERMAGEM' }), conta('ANA2', { bloqueado: true })],
      hc: 'fora',
    });
    const ctl = new RedeCpfController(fonte, null, resolvedor);
    const p = await ctl.painel({ login: 'ana' }, requisicao());
    expect(p.estabelecimentos.map((e) => [e.codigo, e.situacao, e.contas.length])).toEqual([
      ['pc', 'lido', 1],
      ['hb', 'lido', 2],
      ['hc', 'indisponivel', 0],
    ]);
    expect(p.estabelecimentos[0]!.contas[0]!.perfis).toEqual(['medico']);
    expect(p.totalContas).toBe(3);
    expect(p.aBloquear).toBe(2);
    expect(JSON.stringify(p)).not.toContain(CPF);
    // Pelo CPF digitado (com máscara) dá o mesmo.
    const q = await ctl.painel({ cpf: '529.982.247-25' }, requisicao());
    expect(q.totalContas).toBe(3);
  });

  it('recusas: CPF e login juntos (400), login sem CPF (409), login inexistente (404), rede de outra hospedagem (403)', async () => {
    const { fonte } = fonteRede({});
    const ctl = new RedeCpfController(fonte, null, resolvedor);
    const st = async (corpo: unknown, req = requisicao()) =>
      ((await ctl.painel(corpo, req).catch((e: unknown) => e)) as ErroProblema).getStatus();
    expect(await st({ cpf: CPF, login: 'ANA' })).toBe(400);
    expect(await st({})).toBe(400);
    expect(await st({ login: 'SEMCPF' })).toBe(409);
    expect(await st({ login: 'NINGUEM' })).toBe(404);
    const outra = requisicao();
    (outra.sgh!.sessao as unknown as { rede: string }).rede = 'outra-rede';
    expect(await st({ cpf: CPF }, outra)).toBe(403);
    expect(await st({ cpf: CPF }, requisicao('SINT.GESTOR', 'gestor-acessos', 'zz'))).toBe(403);
  });
});

describe('"bloquear em todos" (W1-01, parte 11c)', () => {
  it('bloqueia pelo executor em cada estabelecimento, derruba as sessões e relata o que ficou de fora', async () => {
    const { fonte, executadas } = fonteRede({
      pc: [conta('ANA')],
      hb: [conta('ANA.HB'), conta('ANA2', { bloqueado: true }), conta('ANA3', { ativo: false })],
      hc: 'fora',
    });
    const { s, revogadas } = servico();
    const ctl = new RedeCpfController(fonte, s, resolvedor);
    const r = await ctl.bloquear(
      { login: 'ANA', motivo: 'Desligamento confirmado pelo RH', senha: 'certa' },
      requisicao(),
    );
    expect(executadas.map((x) => `${x.op}@${x.hospital}:${x.login}`)).toEqual([
      'acesso.bloquearUsuario@pc:ANA',
      'acesso.bloquearUsuario@hb:ANA.HB',
    ]);
    // Uma chave de idempotência por conta (a do pedido não se repete entre as receitas do lote).
    expect(new Set(executadas.map((x) => x.chave)).size).toBe(2);
    expect(executadas[0]!.chave).toBe(chaveDoItem('pedido-rede-0001', 'pc', 'ANA'));
    expect(revogadas).toEqual(['pc:ANA', 'hb:ANA.HB']);
    expect(r.bloqueados).toBe(2);
    expect(r.resultados.map((x) => `${x.estabelecimento}:${x.login ?? '-'}:${x.resultado}`)).toEqual([
      'pc:ANA:bloqueado',
      'hb:ANA.HB:bloqueado',
      'hb:ANA2:ja-bloqueado',
      'hb:ANA3:inativo',
      'hc:-:indisponivel',
    ]);
  });

  it('a si mesmo, auditor, sem senha, sem motivo e último gestor: recusados', async () => {
    const { fonte, executadas } = fonteRede({ pc: [conta('ANA')], hb: [conta('ANA.HB')] });
    const { s } = servico();
    const ctl = new RedeCpfController(fonte, s, resolvedor);
    const corpo = { cpf: CPF, motivo: 'Desligamento confirmado pelo RH', senha: 'certa' };
    const st = async (c: unknown, req: RequisicaoAutorizada) =>
      ((await ctl.bloquear(c, req).catch((e: unknown) => e)) as ErroProblema).getStatus();
    expect(await st(corpo, requisicao('ANA'))).toBe(409);
    expect(await st(corpo, requisicao('SINT.AUDITOR', 'auditor'))).toBe(409);
    expect(await st({ ...corpo, senha: undefined }, requisicao())).toBe(401);
    expect(await st({ ...corpo, senha: 'errada' }, requisicao())).toBe(401);
    expect(await st({ ...corpo, motivo: 'curto' }, requisicao())).toBe(400);
    expect(executadas).toHaveLength(0);

    // Último gestor de acessos ativo do hb: aquela conta é recusada, as outras seguem.
    const gestores = {
      gestoresAcesso: async (_r: string, h: string) =>
        h === 'hb' ? [{ login: 'ANA.HB', grupo: 'MASTER', papelGestor: false, concessoes: [] }] : [],
    } as unknown as LeitorGestores;
    const com = new RedeCpfController(fonte, s, resolvedor, gestores);
    const r = await com.bloquear(corpo, requisicao());
    expect(r.resultados.map((x) => `${x.estabelecimento}:${x.resultado}`)).toEqual([
      'pc:bloqueado',
      'hb:recusado',
    ]);
    expect(r.resultados[1]!.detalhe).toMatch(/gestor/i);
  });

  it('conta de aparelho fica de fora; fonte em memória bloqueia de verdade no estabelecimento da sessão', async () => {
    const { fonte } = fonteRede({ pc: [conta('TV1', { grupo: 'PAINEIS' })] });
    const { s } = servico();
    const r = await new RedeCpfController(fonte, s, resolvedor).bloquear(
      { cpf: CPF, motivo: 'Desligamento confirmado pelo RH', senha: 'certa' },
      requisicao(),
    );
    expect(r.resultados[0]!.resultado).toBe('recusado');

    reiniciarEstadoM10Sintetico();
    const mem = fonteAdministracaoMemoria({ registrar: async () => undefined } as never, {} as never, 'dev');
    const ctl = new RedeCpfController(mem, s, resolvedor);
    const [a, b] = [...estadoM10Sintetico().usuarios.values()].filter(
      (u) => u.ativo && u.login !== 'SINT.GESTOR' && !u.login.includes('GESTOR'),
    );
    a!.cpf = CPF;
    b!.cpf = CPF;
    const p = await ctl.painel({ cpf: CPF }, requisicao());
    expect(p.destino).toBe('memoria');
    expect(p.estabelecimentos).toHaveLength(1);
    expect(p.estabelecimentos[0]!.contas.map((c) => c.login).sort()).toEqual([a!.login, b!.login].sort());
    reiniciarEstadoM10Sintetico();
  });
});
