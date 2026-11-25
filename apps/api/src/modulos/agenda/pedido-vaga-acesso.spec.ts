// 02-AGE linha 53: o pedido de vaga é parte do prontuário, e as rotas conferem o vínculo assistencial com o paciente
// como as vizinhas do PEP (AcessoPacientePep). Dados SINTÉTICOS, porta simulada; nada conecta a banco:
//   - restrição ligada, sem vínculo: GET e POST dão 403 `sem-vinculo`, a tentativa vai à trilha e a porta não é chamada;
//   - com vínculo: a leitura vai à trilha (primeira leitura do paciente na sessão) e a porta responde;
//   - restrição desligada: passa sem conferir vínculo.
import { criarAbility, regrasDeAcesso, VinculoSintetico } from '@sgh/dominio-acesso';
import { describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { EstadoProntuario } from '../pep/sessao-prontuario.js';
import type { PedidosVagaPropria } from './pedido-vaga.js';
import { PedidosVagaController } from './pedido-vaga.controller.js';

const PERMISSOES = ['pep.pedidoVaga.ler', 'pep.pedidoVaga.criar'];

function montar(restricao: boolean) {
  const t = new RegistradorTrilhaMemoria();
  const chamadas: string[] = [];
  const porta = {
    doPaciente: async (_c: unknown, p: number) => {
      chamadas.push(`ler:${p}`);
      return { pedidos: [], especialidades: [], itens: [], solicitante: null };
    },
    incluir: async (_c: unknown, e: { paciente: number }) => {
      chamadas.push(`incluir:${e.paciente}`);
      return { resultado: { id: 1, itens: 1 }, repetida: false };
    },
  } as unknown as PedidosVagaPropria;
  const ctrl = new PedidosVagaController(
    t,
    porta,
    new EstadoProntuario(),
    null,
    null,
    new VinculoSintetico([{ login: 'SINT.MEDICO', idPaciente: 1001, forma: 'equipe' }]),
    null,
  );
  const req = {
    headers: { 'idempotency-key': 'c116-acesso-0001' },
    ip: '127.0.0.1',
    sgh: {
      real: true,
      permissao: 'pep.pedidoVaga.ler',
      ability: criarAbility(regrasDeAcesso(PERMISSOES, null)),
      sessao: {
        usuario: { id: '1', nome: 'Médico sintético', login: 'SINT.MEDICO' },
        rede: 'rede-teste',
        estabelecimentos: [],
        estabelecimentoAtivo: 'aa',
        unidadeAtiva: null,
        permissoes: PERMISSOES,
        restricaoVinculo: restricao,
        sintetica: true,
        bloqueioInatividadeSegundos: 0,
        expiraEm: '',
      },
    },
  } as unknown as RequisicaoAutorizada;
  return { ctrl, req, t, chamadas };
}

const erro = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as ErroProblema;
  }
  return null;
};

const pedido = (paciente: number) => ({ paciente, especialidade: 3, itens: [{ itemAgendavel: 7 }] });

describe('pedido de vaga: vínculo assistencial com o paciente (02-AGE 53)', () => {
  it('restrição ligada, sem vínculo: 403 sem-vinculo na leitura e no pedido, tentativa na trilha, porta intocada', async () => {
    const { ctrl, req, t, chamadas } = montar(true);
    const l = await erro(ctrl.doPaciente('1003', req));
    expect(l).toBeInstanceOf(ErroProblema);
    expect(l).toMatchObject({ tipo: 'sem-vinculo' });
    expect(t.eventos.at(-1)).toMatchObject({ evento: 'acesso.permissao.negada', paciente: 1003 });
    const g = await erro(ctrl.incluir(pedido(1003), req));
    expect(g).toMatchObject({ tipo: 'sem-vinculo' });
    expect(chamadas).toEqual([]);
  });

  it('com vínculo: a leitura vai à trilha e a porta responde; o pedido segue para a porta', async () => {
    const { ctrl, req, t, chamadas } = montar(true);
    const antes = t.eventos.length;
    await ctrl.doPaciente('1001', req);
    expect(t.eventos.length).toBeGreaterThan(antes);
    expect(t.eventos.some((e) => e.paciente === 1001 && e.resultado !== 'falha')).toBe(true);
    await ctrl.incluir(pedido(1001), req);
    expect(chamadas).toEqual(['ler:1001', 'incluir:1001']);
  });

  it('restrição desligada: passa sem conferir vínculo', async () => {
    const { ctrl, req, chamadas } = montar(false);
    await ctrl.doPaciente('1003', req);
    await ctrl.incluir(pedido(1003), req);
    expect(chamadas).toEqual(['ler:1003', 'incluir:1003']);
  });
});
