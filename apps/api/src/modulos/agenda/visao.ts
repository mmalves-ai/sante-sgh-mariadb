// Ponte de transição: monta, a partir dos tipos neutros da porta (tipos.ts), as "vistas" que as regras puras de
// @sgh/dominio-agenda ainda esperam (sinais de texto da situação na grade e da marcação). As horas já trafegam em
// "HH:MM", a duração da agenda em minutos e os sinais de sim ou não em booleano. Fica SÓ aqui, entre a porta e o
// serviço: a porta e o banco não conhecem estes sinais. Sai quando o domínio da agenda trocar os sinais de texto
// pela situação neutra (pedido registrado na saída do lote 01-04).
import { canalMarcacao, CANAIS_MARCACAO, type CanalMarcacao } from '@sgh/contratos';
import { duracaoEmHoras, normalizarHora } from '@sgh/dominio-agenda';
import type { ContextoAgenda, PortaAgenda } from './porta.js';
import type { Agenda, FaixaEscala, Horario, Marcacao, Relogio, SituacaoMarcacao, Vaga } from './tipos.js';

/** Hora digitada ou lida → "HH:MM" (recusa a inválida). */
export const horaIso = (h: string): string => normalizarHora(h);
/** Sem hora, ou meia-noite como "sem intervalo" da tela: null. */
export const horaIsoOuNull = (h: string | null | undefined): string | null => {
  if (!h) return null;
  const n = normalizarHora(h);
  return n === '00:00' ? null : n;
};
/** Minutos → duração em horas e minutos ("00:15"; "" sem duração). */
const duracaoTexto = (m: number | null | undefined): string => (m ? duracaoEmHoras(m) : '');

/** Sinal de texto da situação na grade (legenda que o domínio da agenda ainda usa). */
const SINAL_SITUACAO: Readonly<Record<SituacaoMarcacao, string>> = {
  marcada: '',
  confirmada: 'C',
  chegou: 'A',
  em_atendimento: 'A',
  realizada: 'S',
  falta: 'F',
  transferida: 'T',
};

export const canalDoCodigo = (codigo: string | null | undefined): CanalMarcacao =>
  canalMarcacao(codigo ?? '') ?? (CANAIS_MARCACAO.find((c) => c.codigo === 'nao-informado') as CanalMarcacao);

export interface RelogioVista {
  readonly hoje: string;
  /** O minuto corrente em "HH:MM" (o nome do campo segue o do relógio do domínio). */
  readonly hhmm: string;
}

export interface AgendaVista {
  readonly id: number;
  readonly nome: string;
  readonly crm: number;
  readonly ativa: boolean;
  readonly duracaoMinutos: number | null;
  readonly teleatendimento: boolean;
  readonly gradeInicio: string | null;
  readonly gradeFim: string | null;
  readonly convenios: number;
  readonly especialidades: number;
  readonly unidade: number | null;
  readonly tipo: number | null;
}

export interface LinhaEscalaVista {
  readonly semana: number;
  readonly duracaoMinutos: number | null;
  readonly horaInicio: string;
  readonly horaFim: string;
  readonly intervaloInicio: string | null;
  readonly intervaloFim: string | null;
}

export interface HorarioVista {
  readonly data: string;
  readonly hora: string;
  readonly paciente: string;
  readonly livre: string;
  readonly situacao: string;
  readonly tipo: string;
  readonly duracao: string;
  readonly convenio: number | null;
  readonly marcacao: number | null;
}

export interface MarcacaoVista {
  readonly id: number;
  readonly agenda: number | null;
  readonly nomeAgenda: string;
  readonly data: string;
  readonly hora: string;
  readonly paciente: string;
  readonly idPaciente: number | null;
  readonly prontuario: number | null;
  readonly convenio: number;
  readonly nomeConvenio: string | null;
  readonly retorno: boolean;
  readonly atendido: string;
  readonly situacaoHorario: string;
  readonly encaixe: boolean;
  readonly canal: string;
  readonly dataMarcacao: string | null;
  readonly usuario: string | null;
  readonly temSenha: boolean;
}

export interface VagaVista {
  readonly agenda: number;
  readonly nomeAgenda: string;
  readonly data: string;
  readonly hora: string;
}

export const relogioVista = (r: Relogio): RelogioVista => ({ hoje: r.hoje, hhmm: normalizarHora(r.hora) });

export const agendaVista = (a: Agenda): AgendaVista => ({
  id: a.id,
  nome: a.nome,
  crm: a.registroProfissional ?? 0,
  ativa: a.ativa,
  duracaoMinutos: a.duracaoMinutos,
  teleatendimento: a.teleatendimento,
  gradeInicio: a.gradeInicio,
  gradeFim: a.gradeFim,
  convenios: a.convenios,
  especialidades: a.especialidades,
  unidade: a.unidade,
  tipo: a.categoria,
});

export const linhaEscalaVista = (f: FaixaEscala, duracaoAgenda: number | null = null): LinhaEscalaVista => ({
  semana: f.diaSemana,
  duracaoMinutos: f.duracaoMinutos ?? duracaoAgenda,
  horaInicio: horaIso(f.inicio),
  horaFim: horaIso(f.fim),
  intervaloInicio: f.intervaloInicio && f.intervaloFim ? horaIsoOuNull(f.intervaloInicio) : null,
  intervaloFim: f.intervaloInicio && f.intervaloFim ? horaIsoOuNull(f.intervaloFim) : null,
});

export const horarioVista = (h: Horario): HorarioVista => ({
  data: h.data,
  hora: horaIso(h.hora),
  paciente: h.paciente ?? '',
  livre: h.bloqueado ? 'N' : 'S',
  situacao: h.situacao ? SINAL_SITUACAO[h.situacao] : '',
  tipo: h.encaixe ? 'E' : '',
  duracao: duracaoTexto(h.duracaoMinutos),
  convenio: h.convenio,
  marcacao: h.marcacao,
});

export const marcacaoVista = (m: Marcacao): MarcacaoVista => ({
  id: m.id,
  agenda: m.agenda,
  nomeAgenda: m.nomeAgenda,
  data: m.data,
  hora: horaIso(m.hora),
  paciente: m.paciente,
  idPaciente: m.idPaciente,
  prontuario: m.prontuario,
  convenio: m.convenio,
  nomeConvenio: m.nomeConvenio,
  retorno: m.retorno,
  atendido: m.situacao === 'realizada' ? 'S' : 'N',
  situacaoHorario: SINAL_SITUACAO[m.situacao],
  encaixe: m.encaixe,
  canal: m.canal,
  dataMarcacao: m.marcadaEm,
  usuario: m.marcadaPor,
  temSenha: m.situacao === 'chegou' || m.situacao === 'em_atendimento',
});

export const vagaVista = (v: Vaga): VagaVista => ({ ...v, hora: horaIso(v.hora) });

/** As leituras que o serviço e os controladores consomem como vistas (as demais vão direto à porta). */
export class LeituraAgenda {
  constructor(private readonly porta: PortaAgenda) {}

  async relogio(c: ContextoAgenda): Promise<RelogioVista> {
    return relogioVista(await this.porta.relogio(c));
  }
  async agendas(c: ContextoAgenda): Promise<AgendaVista[]> {
    return (await this.porta.agendas(c)).map(agendaVista);
  }
  async agenda(c: ContextoAgenda, id: number): Promise<AgendaVista | null> {
    const a = await this.porta.agenda(c, id);
    return a ? agendaVista(a) : null;
  }
  async escala(
    c: ContextoAgenda,
    a: Pick<AgendaVista, 'id' | 'duracaoMinutos'>,
  ): Promise<LinhaEscalaVista[]> {
    return (await this.porta.escala(c, a.id)).map((f) => linhaEscalaVista(f, a.duracaoMinutos));
  }
  async horarios(c: ContextoAgenda, agenda: number, de: string, ate: string) {
    const r = await this.porta.horarios(c, agenda, de, ate);
    return { itens: r.itens.map(horarioVista), truncado: r.truncado };
  }
  async horasMarcadas(c: ContextoAgenda, agenda: number, data: string): Promise<string[]> {
    return (await this.porta.horasMarcadas(c, agenda, data)).map(horaIso);
  }
  async marcacoesDaJanela(c: ContextoAgenda, agenda: number, de: string, ate: string) {
    const r = await this.porta.marcacoesDaJanela(c, agenda, de, ate);
    return { itens: r.itens.map(marcacaoVista), truncado: r.truncado };
  }
  async marcacoesDoDia(c: ContextoAgenda, data: string) {
    const r = await this.porta.marcacoesDoDia(c, data);
    return { itens: r.itens.map(marcacaoVista), truncado: r.truncado };
  }
  async marcacao(c: ContextoAgenda, id: number) {
    const r = await this.porta.marcacao(c, id);
    return r
      ? {
          marcacao: marcacaoVista(r.marcacao),
          contato: {
            telefone: r.contato.telefone ?? '',
            celular: r.contato.celular ?? '',
            observacao: r.contato.observacao,
          },
        }
      : null;
  }
  async marcacoesDoPaciente(c: ContextoAgenda, id: number) {
    const r = await this.porta.marcacoesDoPaciente(c, id);
    return { itens: r.itens.map(marcacaoVista), truncado: r.truncado, preCadastros: r.preCadastros };
  }
  async vagas(c: ContextoAgenda, f: { agendas: readonly number[] | null; de: string; ate: string }) {
    const r = await this.porta.vagas(c, f);
    return { itens: r.itens.map(vagaVista), truncado: r.truncado };
  }
  async proximasVagas(c: ContextoAgenda, agendas: readonly number[], depoisDe: string, ate: string) {
    return (await this.porta.proximasVagas(c, agendas, depoisDe, ate)).map(vagaVista);
  }
}
