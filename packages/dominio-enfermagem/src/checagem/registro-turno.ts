// Registro do fechamento da checagem do turno no prontuário de cada paciente (03-PEP L113): o fechamento do setor
// vira, por atendimento, um documento de enfermagem com o que foi administrado, não administrado, suspenso e o que
// ficou pendente para o turno seguinte (com a justificativa de quem fechou). É o registro do turno por paciente que o
// enfermeiro assina (COFEN 736/2024, registro de enfermagem; CFM 1.638/2002 e SBIS, prontuário eletrônico).
// Puro: a porta própria lê a composição gravada e grava o documento com o conteúdo e o resumo calculados aqui.

/** Um horário da composição do fechamento, com o paciente. */
export interface HorarioDoRegistro {
  readonly id: number;
  readonly atendimento: number;
  readonly paciente: number;
  /** Letra da situação no instante do fechamento (A, p, N, S, P…), a mesma do resumo do fechamento. */
  readonly letra: string;
  readonly papel: 'travado' | 'pendente';
  /** O horário é de um turno anterior e chegou pendente a este. */
  readonly anterior: boolean;
}

export interface CabecalhoRegistroTurno {
  readonly data: string;
  readonly turno: 'diurno' | 'noturno';
  readonly unidade: string;
  readonly justificativa: string | null;
}

export interface RegistroTurnoPaciente {
  readonly atendimento: number;
  readonly paciente: number;
  readonly titulo: string;
  readonly administrados: number;
  readonly naoAdministrados: number;
  readonly suspensos: number;
  readonly travados: readonly number[];
  readonly pendentes: readonly number[];
  readonly pendentesAnteriores: readonly number[];
  /** Conteúdo estruturado do documento (sem texto livre além da justificativa de pendências). */
  readonly conteudo: Readonly<Record<string, unknown>>;
}

export class RecusaRegistroTurno extends Error {
  constructor(
    readonly codigo: 'horario-sem-paciente' | 'atendimento-com-dois-pacientes',
    mensagem: string,
  ) {
    super(mensagem);
  }
}

const NOME_TURNO = { diurno: 'diurno', noturno: 'noturno' } as const;

/**
 * Agrupa a composição do fechamento por atendimento (um documento por paciente), em ordem de atendimento. Um horário
 * sem paciente ou um atendimento com dois pacientes é recusado: o documento nunca pode ir ao prontuário errado.
 */
export function registrosDoTurno(
  horarios: readonly HorarioDoRegistro[],
  c: CabecalhoRegistroTurno,
): RegistroTurnoPaciente[] {
  const grupos = new Map<number, HorarioDoRegistro[]>();
  for (const h of horarios) {
    if (!(h.atendimento > 0) || !(h.paciente > 0))
      throw new RecusaRegistroTurno(
        'horario-sem-paciente',
        `O horário ${h.id} não tem atendimento e paciente.`,
      );
    const g = grupos.get(h.atendimento) ?? [];
    if (g.length > 0 && g[0]!.paciente !== h.paciente)
      throw new RecusaRegistroTurno(
        'atendimento-com-dois-pacientes',
        `O atendimento ${h.atendimento} aparece com dois pacientes no fechamento.`,
      );
    g.push(h);
    grupos.set(h.atendimento, g);
  }
  const titulo = `Registro de checagem do turno ${NOME_TURNO[c.turno]} de ${c.data.split('-').reverse().join('/')}`;
  return [...grupos.entries()]
    .sort(([a], [b]) => a - b)
    .map(([atendimento, g]) => {
      const travados = g.filter((h) => h.papel === 'travado').map((h) => h.id);
      const pend = g.filter((h) => h.papel === 'pendente');
      const pendentes = pend.map((h) => h.id);
      const pendentesAnteriores = pend.filter((h) => h.anterior).map((h) => h.id);
      const conta = (f: (l: string) => boolean) =>
        g.filter((h) => h.papel === 'travado' && f(h.letra)).length;
      const administrados = conta((l) => l === 'A' || l === 'p');
      const naoAdministrados = conta((l) => l === 'N');
      const suspensos = conta((l) => l === 'S');
      return {
        atendimento,
        paciente: g[0]!.paciente,
        titulo,
        administrados,
        naoAdministrados,
        suspensos,
        travados,
        pendentes,
        pendentesAnteriores,
        conteudo: {
          tipo: 'registro_checagem_turno',
          data: c.data,
          turno: c.turno,
          unidade: c.unidade,
          administrados,
          nao_administrados: naoAdministrados,
          suspensos,
          horarios_travados: travados,
          horarios_pendentes: pendentes,
          pendentes_de_turno_anterior: pendentesAnteriores,
          justificativa_pendencias: pendentes.length > 0 ? (c.justificativa ?? '').trim() || null : null,
        },
      };
    });
}
