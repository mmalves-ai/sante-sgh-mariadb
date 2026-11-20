// Fila da recepção na página inicial (ficha do M27, seção 4 e regra 5; cap-03 §3.5; Anexo A §A.1): as senhas na fila
// pela prioridade legal (TBGRUPOPRIORIDADE; Lei 13.466/2017) com a espera, as chegadas do dia (as marcações da agenda e
// se o paciente já chegou) e as guias aguardando autorização do convênio, a mais antiga primeiro. Teto de 300 linhas no
// total. Só leitura: chamar, registrar a chegada e abrir o atendimento são as telas do M19 e do M20.
import { chamavel, TETO_WORKLIST_RECEPCAO, type WorklistRecepcao } from '@sgh/contratos';
import {
  descricaoDoGrupo,
  esperaEmMinutos,
  ordenarGuiasPendentes,
  ordenarSenhasDaWorklist,
} from '@sgh/dominio-recepcao';
import { type GuiaPendenteLida, guiasAguardandoAutorizacao, type NucleoLegado } from '@sgh/legado';
import type { PortaAgenda } from '../../agenda/public-api.js';
import { portaIndisponivel } from '../../exames/public-api.js';
import type { ContextoRecepcao, PortaRecepcao } from '../porta.js';

/** A leitura própria da fila (as guias); as senhas e as chegadas vêm das portas do M19 e do M17. */
export interface PortaGuias {
  guias(c: ContextoRecepcao, dia: string): Promise<{ guias: GuiaPendenteLida[]; cortada: boolean }>;
}

export function portaGuiasLegado(nucleo: NucleoLegado): PortaGuias {
  return {
    guias: (c, dia) =>
      nucleo.lerSomente({ rede: c.rede, hospital: c.hospital, traceId: 'worklist-recepcao' }, (l) =>
        guiasAguardandoAutorizacao(l, dia),
      ),
  };
}

/** Memória: uma guia sintética aguardando autorização (paciente e convênio fictícios). */
export const portaGuiasMemoria: PortaGuias = {
  async guias(_c, dia) {
    return {
      guias: [
        {
          reg: 990001,
          paciente: 'PACIENTE SINTÉTICO DA GUIA',
          convenio: 'CONVÊNIO SINTÉTICO',
          abertoEm: `${dia}T07:30:00.000`,
        },
      ],
      cortada: false,
    };
  },
};

export function portaGuiasIndisponivel(): PortaGuias {
  return portaIndisponivel<PortaGuias>(new Set(['guias']));
}

export class ServicoWorklistRecepcao {
  constructor(
    private readonly recepcao: PortaRecepcao,
    private readonly agenda: PortaAgenda | null,
    private readonly guias: PortaGuias,
  ) {}

  async fila(c: ContextoRecepcao, f: { recepcao: number | null }): Promise<WorklistRecepcao> {
    const { hoje, agora } = await this.recepcao.relogio(c);
    const [senhas, marcacoes, guias] = await Promise.all([
      this.recepcao.senhasDoDia(c, { recepcao: f.recepcao }),
      this.agenda ? this.agenda.marcacoesDoDia(c, hoje).catch(() => ({ itens: [], truncado: false })) : null,
      this.guias.guias(c, hoje),
    ]);
    const naFila = ordenarSenhasDaWorklist(
      senhas.senhas.filter(chamavel).map((s) => ({
        id: s.id,
        senha: s.texto,
        prioridade: (['0', '1', '2'].includes(s.prioridade.trim()) ? s.prioridade.trim() : '2') as
          '0' | '1' | '2',
        grupo: s.grupo,
        grupoDescricao: descricaoDoGrupo(s.prioridade, s.grupo),
        emitidaEm: s.emitidaEm,
        esperaMinutos: esperaEmMinutos(s.emitidaEm, agora),
        situacao: 'aguardando',
        gerador: s.servico,
      })),
    );
    const chegadas = (marcacoes?.itens ?? [])
      .filter((m) => m.paciente.trim() !== '')
      .map((m) => ({
        marcacao: m.id,
        hora: m.hora,
        paciente: m.paciente,
        agenda: m.nomeAgenda,
        chegou: m.temSenha || m.atendido.trim() === 'S',
      }))
      .sort((a, b) => a.hora.localeCompare(b.hora) || a.marcacao - b.marcacao);
    const pendentes = ordenarGuiasPendentes(
      guias.guias.map((g) => ({ ...g, esperaMinutos: esperaEmMinutos(g.abertoEm, agora) })),
    );
    // Teto de 300 linhas no total: senhas primeiro (a fila legal), depois as guias e as chegadas.
    let resta = TETO_WORKLIST_RECEPCAO;
    const cortar = <T>(xs: readonly T[]): T[] => {
      const r = xs.slice(0, Math.max(0, resta));
      resta -= r.length;
      return r;
    };
    const s = cortar(naFila);
    const g = cortar(pendentes);
    const ch = cortar(chegadas);
    return {
      senhas: s,
      guias: g,
      chegadas: ch,
      teto: TETO_WORKLIST_RECEPCAO,
      cortada:
        senhas.cortada ||
        guias.cortada ||
        (marcacoes?.truncado ?? false) ||
        s.length + g.length + ch.length < naFila.length + pendentes.length + chegadas.length,
      geradaEm: agora,
    };
  }
}
