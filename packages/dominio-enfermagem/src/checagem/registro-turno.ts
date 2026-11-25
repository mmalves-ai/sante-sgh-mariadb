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
  /** Hora prevista local "AAAA-MM-DDTHH:MM" (o que o enfermeiro lê no documento). */
  readonly previsto?: string | null;
  /** O item prescrito do horário (descrição da prescrição). */
  readonly item?: string | null;
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
    readonly codigo: 'horario-sem-paciente' | 'atendimento-com-dois-pacientes' | 'autor-nao-e-da-enfermagem',
    mensagem: string,
  ) {
    super(mensagem);
  }
}

const NOME_TURNO = { diurno: 'diurno', noturno: 'noturno' } as const;

/** A situação do horário por extenso, pela letra gravada no instante do fechamento. */
export const SITUACAO_DA_LETRA: Readonly<Record<string, string>> = {
  A: 'administrado',
  p: 'administrado em parte',
  N: 'não administrado',
  S: 'suspenso',
  P: 'pendente',
};

/** CBO de enfermagem: enfermeiro (2235) ou técnico e auxiliar de enfermagem (3222). */
const CBO_ENFERMAGEM = /^(2235|3222)/;

/**
 * O autor do registro do turno é da enfermagem (COFEN 736/2024: o registro de enfermagem é do enfermeiro ou do técnico
 * e auxiliar, cada um no que fez): recusa quem não tem ocupação de enfermagem.
 */
export function conferirAutorRegistroTurno(cbos: readonly string[]): void {
  if (!cbos.some((c) => CBO_ENFERMAGEM.test(c.replace(/\D/g, ''))))
    throw new RecusaRegistroTurno(
      'autor-nao-e-da-enfermagem',
      'O fechamento da checagem gera o registro de enfermagem no prontuário: só o profissional de enfermagem (enfermeiro, técnico ou auxiliar) o fecha.',
    );
}

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
          // A letra de cada horário no instante do fechamento: o documento se lê e se confere sem outra tabela.
          horarios: [...g]
            .sort((a, b) => (a.previsto ?? '').localeCompare(b.previsto ?? '') || a.id - b.id)
            .map((h) => ({
              horario: h.id,
              previsto: h.previsto ?? null,
              item: h.item ?? null,
              letra: h.letra,
              papel: h.papel,
              turno_anterior: h.anterior,
            })),
        },
      };
    });
}

const hora = (v: unknown): string => {
  const t = typeof v === 'string' ? v : '';
  return t.length >= 16 ? `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}` : 'sem hora';
};

/**
 * Os parágrafos legíveis do registro do turno a partir do conteúdo gravado no documento (o mesmo que tem o resumo
 * criptográfico): é o que a prévia mostra e o que o enfermeiro assina. Conteúdo que não é do registro do turno: null.
 */
export function paragrafosDoRegistroTurno(conteudo: unknown): string[] | null {
  if (!conteudo || typeof conteudo !== 'object') return null;
  const c = conteudo as Record<string, unknown>;
  if (c['tipo'] !== 'registro_checagem_turno') return null;
  const data = typeof c['data'] === 'string' ? c['data'].split('-').reverse().join('/') : '';
  const paragrafos = [
    `Checagem do turno ${String(c['turno'] ?? '')} de ${data}, unidade ${String(c['unidade'] ?? '')}.`,
    `Administrados: ${Number(c['administrados'] ?? 0)}; não administrados: ${Number(c['nao_administrados'] ?? 0)}; suspensos: ${Number(c['suspensos'] ?? 0)}; pendentes passados ao turno seguinte: ${Array.isArray(c['horarios_pendentes']) ? c['horarios_pendentes'].length : 0}.`,
  ];
  const horarios = Array.isArray(c['horarios']) ? (c['horarios'] as Record<string, unknown>[]) : [];
  for (const h of horarios) {
    const situacao = SITUACAO_DA_LETRA[String(h['letra'])] ?? String(h['letra']);
    const destino = h['papel'] === 'pendente' ? ' (passa ao turno seguinte)' : '';
    const anterior = h['turno_anterior'] === true ? ' (veio do turno anterior)' : '';
    paragrafos.push(
      `${hora(h['previsto'])} - ${String(h['item'] ?? `horário ${String(h['horario'])}`)}: ${situacao}${destino}${anterior}.`,
    );
  }
  if (typeof c['justificativa_pendencias'] === 'string' && c['justificativa_pendencias'])
    paragrafos.push(`Justificativa das pendências: ${c['justificativa_pendencias']}`);
  return paragrafos;
}
