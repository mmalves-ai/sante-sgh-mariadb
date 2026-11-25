// C2-006 (05-SADT linha 5): a avaliação na hora da restrição do exame no pedido do prontuário só mostra a restrição a
// quem pode ver o paciente. Dados SINTÉTICOS, portas simuladas; nada conecta a banco:
//   - o paciente vai na rota, e o filtro comum do paciente com acesso restrito o lê: sem liberação, 403 e o serviço
//     não é chamado (antes o atendimento ia só no corpo e o filtro não o via);
//   - com a restrição por vínculo do estabelecimento, sem vínculo assistencial: 403 `sem-vinculo`, tentativa na trilha,
//     serviço intocado; com vínculo, o serviço recebe o paciente da rota;
//   - o atendimento do corpo de outro paciente é recusado antes de qualquer leitura das regras.
import type { ExecutionContext } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { criarAbility, regrasDeAcesso, VinculoSintetico } from '@sgh/dominio-acesso';
import type { Leitor } from '@sgh/nucleo';
import { lastValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { AcessoRestritoProprio } from '../cadastro/acesso-restrito-proprio.js';
import { alvoDaRequisicao, InterceptadorAcessoRestrito } from '../cadastro/acesso-restrito.interceptor.js';
import { EstadoProntuario } from '../pep/sessao-prontuario.js';
import { restricoesDoProntuario, type ServicoPedidoSadt } from './aplicacao/pedido-propria.js';
import { PedidoProntuarioSadtController } from './pedido-prontuario.controller.js';

const PERMISSOES = ['pep.pedidoExame.criar'];
const CORPO = { atendimento: 5001, exames: [11], confirmado: true, justificativa: null };

function montar(restricaoVinculo: boolean) {
  const t = new RegistradorTrilhaMemoria();
  const avaliar = vi.fn(async () => ({
    restricoes: [],
    segue: true,
    codigo: null,
    motivo: null,
    pedeJustificativa: false,
    podeAutorizarExcecao: false,
  }));
  const ctrl = new PedidoProntuarioSadtController(
    { avaliarPedidoDoProntuario: avaliar } as unknown as ServicoPedidoSadt,
    t,
    new EstadoProntuario(),
    null,
    null,
    new VinculoSintetico([{ login: 'SINT.MEDICO', idPaciente: 1001, forma: 'equipe' }]),
    null,
  );
  const req = {
    headers: {},
    ip: '127.0.0.1',
    sgh: {
      real: true,
      permissao: 'pep.pedidoExame.criar',
      ability: criarAbility(regrasDeAcesso(PERMISSOES, null)),
      sessao: {
        usuario: { id: '1', nome: 'Médico sintético', login: 'SINT.MEDICO' },
        rede: 'rede-teste',
        estabelecimentos: [],
        estabelecimentoAtivo: 'aa',
        unidadeAtiva: null,
        permissoes: PERMISSOES,
        restricaoVinculo,
        sintetica: true,
        bloqueioInatividadeSegundos: 0,
        expiraEm: '',
      },
    },
  } as unknown as RequisicaoAutorizada;
  return { ctrl, req, t, avaliar };
}

const erro = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  return null;
};

describe('avaliação da restrição do exame no prontuário: paciente restrito e vínculo (C2-006)', () => {
  it('o paciente vai na rota e o filtro do paciente restrito recusa quem não está liberado', async () => {
    const caminho = Reflect.getMetadata(
      PATH_METADATA,
      PedidoProntuarioSadtController.prototype.avaliar,
    ) as string;
    expect(caminho).toBe('pedidos/avaliar-prontuario/:paciente');
    const url = '/api/sadt/pedidos/avaliar-prontuario/1003';
    expect(alvoDaRequisicao({ params: { paciente: '1003' } })).toMatchObject({ paciente: 1003 });
    const porta = {
      decidir: vi.fn(async () => ({ desfecho: 'quebra-de-vidro', marcas: [9] })),
      pacienteDoAtendimento: vi.fn(async () => null),
    } as unknown as AcessoRestritoProprio;
    const trilha = { registrar: vi.fn(async () => undefined) };
    const { ctrl, req, avaliar } = montar(false);
    const r = { ...req, originalUrl: url, url, params: { paciente: '1003' }, query: {}, body: CORPO };
    const ctx = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => r }),
    } as unknown as ExecutionContext;
    const proximo = { handle: () => of(ctrl.avaliar('1003', CORPO, req)) };
    const e = await erro(
      lastValueFrom(new InterceptadorAcessoRestrito(porta, trilha as never).intercept(ctx, proximo)),
    );
    expect(e).toMatchObject({ status: 403 });
    expect(porta.decidir).toHaveBeenCalledWith(expect.objectContaining({ paciente: 1003 }));
    expect(trilha.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ paciente: 1003, chaveNaturalAlvo: 'paciente-restrito:quebra-de-vidro' }),
    );
    expect(avaliar).not.toHaveBeenCalled();
  });

  it('com a restrição por vínculo, sem vínculo: 403 sem-vinculo, tentativa na trilha, serviço intocado', async () => {
    const { ctrl, req, t, avaliar } = montar(true);
    const e = await erro(ctrl.avaliar('1003', CORPO, req));
    expect(e).toBeInstanceOf(ErroProblema);
    expect(e).toMatchObject({ tipo: 'sem-vinculo' });
    expect(t.eventos.at(-1)).toMatchObject({ evento: 'acesso.permissao.negada', paciente: 1003 });
    expect(avaliar).not.toHaveBeenCalled();
  });

  it('com vínculo, o serviço recebe o paciente da rota', async () => {
    const { ctrl, req, avaliar } = montar(true);
    await expect(ctrl.avaliar('1001', CORPO, req)).resolves.toMatchObject({ segue: true });
    expect(avaliar).toHaveBeenCalledWith(expect.anything(), 1001, CORPO, false);
  });

  it('o atendimento de outro paciente é recusado antes de ler as regras', async () => {
    const uma = vi.fn(async () => ({ id: 5001, paciente_id: 2002 }));
    const todas = vi.fn(async () => []);
    const l = { uma, todas } as unknown as Leitor;
    await expect(
      restricoesDoProntuario(l, 1, {
        atendimento: 5001,
        paciente: 1001,
        exames: [11],
        confirmado: true,
        justificativa: null,
        podeAutorizarExcecao: false,
        usuario: null,
      }),
    ).rejects.toThrow(/não é do paciente aberto/);
    expect(uma).toHaveBeenCalledTimes(1);
    expect(todas).not.toHaveBeenCalled();
  });
});
