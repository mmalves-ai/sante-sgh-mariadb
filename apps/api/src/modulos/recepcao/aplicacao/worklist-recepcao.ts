// Fila da recepção na página inicial (ficha do M27, seção 4 e regra 5; cap-03 §3.5; Anexo A §A.1): as senhas na fila
// pela prioridade legal (grupos de prioridade legal; Lei 13.466/2017) com a espera, as chegadas do dia (as marcações da agenda e
// se o paciente já chegou) e as guias aguardando autorização do convênio, a mais antiga primeiro. Teto de 300 linhas no
// total. Só leitura: chamar, registrar a chegada e abrir o atendimento são as telas do M19 e do M20.
import { chamavel, TETO_WORKLIST_RECEPCAO, type WorklistRecepcao } from '@sgh/contratos';
import {
  descricaoDoGrupo,
  esperaEmMinutos,
  ordenarGuiasPendentes,
  ordenarSenhasDaWorklist,
} from '@sgh/dominio-recepcao';
import type { ContextoNucleo, Leitor } from '@sgh/nucleo';
import type { PortaAgenda } from '../../agenda/public-api.js';
import { portaIndisponivel } from '../../exames/public-api.js';
import { estabelecimentoPorCodigo, horaCivil, num, txt } from '../banco.js';
import type { ContextoRecepcao, PortaRecepcao } from '../porta.js';
import { senhaNaTela } from '../codigos-senha.js';
import type { GuiaPendente } from '../tipos.js';

/** A leitura própria da fila (as guias); as senhas e as chegadas vêm das portas do M19 e do M17. */
export interface PortaGuias {
  guias(c: ContextoRecepcao, dia: string): Promise<{ guias: GuiaPendente[]; cortada: boolean }>;
}

/** Teto das guias pendentes na fila. */
const TETO_GUIAS = 300;

/**
 * Leitura própria das guias aguardando autorização: os atendimentos do dia do estabelecimento cuja fonte pagadora
 * principal exige guia ou senha e ainda sem a senha de autorização. A mais antiga primeiro.
 * Melhoria: a exigência vem do cadastro da fonte pagadora (exige_guia) e a autorização da cobertura do atendimento.
 */
export function portaGuiasPropria(
  nucleo: { lerSomente<T>(contexto: Partial<ContextoNucleo>, fn: (l: Leitor) => Promise<T>): Promise<T> },
  cliente: string,
): PortaGuias {
  return {
    guias: (c, dia) =>
      nucleo.lerSomente({ cliente, correlacao: 'worklist-recepcao' }, async (l) => {
        const est = await estabelecimentoPorCodigo(l, c.hospital);
        const ls = await l.consultar(
          `SELECT a.id, a.entrada_em, pf.nome, f.nome AS fonte
             FROM atendimento a JOIN cobertura_atendimento ca ON ca.atendimento_id = a.id AND ca.ordem = 1 AND ca.excluido_em IS NULL
             JOIN fonte_pagadora f ON f.id = ca.fonte_pagadora_id
             JOIN paciente p ON p.id = a.paciente_id JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.situacao <> 'cancelado'
              AND a.entrada_em >= ? AND a.entrada_em < ?
              AND f.exige_guia = TRUE AND (ca.senha_autorizacao IS NULL OR TRIM(ca.senha_autorizacao) = '')
            ORDER BY a.entrada_em, a.id LIMIT ${TETO_GUIAS + 1}`,
          [est.id, ...janelaDoDia(dia, est.fuso)],
          { teto: TETO_GUIAS + 1 },
        );
        return {
          guias: ls.slice(0, TETO_GUIAS).map((x) => ({
            reg: num(x['id']),
            paciente: txt(x['nome']),
            convenio: txt(x['fonte']),
            abertoEm: horaCivil(x['entrada_em'] as Date, est.fuso),
          })),
          cortada: ls.length > TETO_GUIAS,
        };
      }),
  };
}

/** Início e fim (UTC) do dia civil no fuso do estabelecimento. */
function janelaDoDia(dia: string, fuso: string): [Date, Date] {
  const meiaNoite = (d: string) => {
    const base = Date.parse(`${d}T00:00:00Z`);
    const visto = Date.parse(`${horaCivil(new Date(base), fuso)}Z`);
    return new Date(base + (base - visto));
  };
  const amanha = new Date(Date.parse(`${dia}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return [meiaNoite(dia), meiaNoite(amanha)];
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
      senhas.senhas
        .map((s) => ({ ...s, ...senhaNaTela(s) }))
        .filter(chamavel)
        .map((s) => ({
          id: s.id,
          senha: s.texto,
          prioridade: (['0', '1', '2'].includes(s.prioridade) ? s.prioridade : '2') as '0' | '1' | '2',
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
        chegou: ['chegou', 'em_atendimento', 'realizada'].includes(m.situacao),
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
