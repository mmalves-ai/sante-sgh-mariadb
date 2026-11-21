// Correção do M24 (D-VINC-24): as listas gerais da prescrição (fichas de antimicrobiano da farmácia clínica e as que
// vencem no turno) obedecem à restrição por vínculo do estabelecimento — com ela ligada, só os pacientes com vínculo
// do login; sem ela, a fila do estabelecimento. Pelo controlador, com a porta da prescrição EM MEMÓRIA (sintética).
import { criarAbility, regrasDeAcesso, VinculoSintetico } from '@sgh/dominio-acesso';
import { describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import type { ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { PrescricaoController } from './prescricao.controller.js';
import { PortaPrescricaoMemoria } from './prescricao-porta-memoria.js';
import { ServicoPrescricao } from './prescricao-servico.js';
import { EstadoProntuario } from './sessao-prontuario.js';

const PERMISSOES = ['pep.antimicrobiano.ler', 'pep.prescricao.ler'];
const C = { cliente: 'teste', estabelecimento: null, usuario: null, correlacao: 'teste', rede: 'rede-teste', hospital: 'aa' };

function montar(restricao: boolean) {
  const t = new RegistradorTrilhaMemoria();
  const porta = new PortaPrescricaoMemoria(t);
  const ctrl = new PrescricaoController(
    new ServicoPrescricao(porta),
    new EstadoProntuario(),
    new PortaCadastroMemoria(),
    {} as ResolvedorSessao,
    null,
    fonteConfiguracaoMemoria(t, {
      chavesIniciais: chavesIniciaisSinteticas,
      prerequisitosIniciais: prerequisitosIniciaisSinteticos,
    }),
    null,
    t,
    null,
    new VinculoSintetico([{ login: 'SINT.FARMACIA', idPaciente: 1001, forma: 'equipe' }]),
    null,
    null,
  );
  const req = () =>
    ({
      headers: {},
      ip: '127.0.0.1',
      sgh: {
        real: false,
        permissao: 'pep.antimicrobiano.ler',
        ability: criarAbility(regrasDeAcesso(PERMISSOES, null)),
        sessao: {
          usuario: { id: '1', nome: 'Farmácia sintética', login: 'SINT.FARMACIA' },
          rede: C.rede,
          estabelecimentos: [],
          estabelecimentoAtivo: C.hospital,
          unidadeAtiva: null,
          permissoes: PERMISSOES,
          restricaoVinculo: restricao,
          sintetica: true,
          bloqueioInatividadeSegundos: 0,
          expiraEm: '',
        },
      },
    }) as unknown as RequisicaoAutorizada;
  return { ctrl, porta, req };
}

const ficha = (paciente: number) => ({
  paciente,
  atendimento: paciente * 10 + 1,
  produto: 502,
  prescricao: null,
  item: null,
  indicacao: 'Infecção SINTETICO',
  sitio: 'Pulmão',
  tipo: 'empirico' as const,
  culturaColhida: false,
  diaTratamento: 1,
  duracaoDias: null,
});

describe('listas gerais da prescrição e a restrição por vínculo (D-VINC-24)', () => {
  it('fichas de antimicrobiano sem paciente: com a restrição, só os pacientes com vínculo', async () => {
    for (const restricao of [false, true]) {
      const m = montar(restricao);
      await m.porta.registrarFicha(C, 'SINT.FARMACIA', ficha(1001));
      await m.porta.registrarFicha(C, 'SINT.FARMACIA', ficha(1003));
      const r = await m.ctrl.antimicrobianos(undefined, m.req());
      expect(r.map((f) => f.paciente).sort()).toEqual(restricao ? [1001] : [1001, 1003]);
    }
  });

  it('as que vencem no turno: com a restrição, nenhuma de paciente sem vínculo', async () => {
    const m = montar(true);
    const r = await m.ctrl.aRenovar('24', undefined, m.req());
    expect(r.every((x) => x.paciente === 1001)).toBe(true);
  });
});
