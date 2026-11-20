// A prescrição de enfermagem (M45, etapa 4; regra 8; cap-05b §5.8 "Prescrição de enfermagem"): as intervenções do
// processo viram atividades com a frequência e os horários aprazados pela mesma grade de horários-padrão da unidade
// (a da medicação, M25) e checadas na mesma linha do tempo do turno. A atividade não feita exige motivo; a checagem não
// se apaga (o estorno é justificado e o horário volta a ser checável, numa geração nova da chave do horário). "Se
// necessário" (frequência 0) não tem horário: cada checagem é um ato na hora real.
import {
  type AtividadeCuidadoEntrada,
  type AtividadeSaeLida,
  type ChecagemCuidadoLida,
  type EstadoCuidado,
  type ProcessoSaeLido,
  type TerminologiaSae,
  TOLERANCIA_CUIDADO_MIN,
} from '@sgh/contratos';
import { deMinutos, diferencaMinutos, minutos, minutosDoDia, somarMinutos } from '../tempo.js';
import type { RecusaSae } from './processo.js';

const recusa = (codigo: string, mensagem: string, campo?: string): RecusaSae => ({
  ok: false,
  codigo,
  mensagem,
  ...(campo ? { campo } : {}),
});

const hhmm = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/**
 * A proposta dos horários da atividade: a grade de horários-padrão da unidade para o número de vezes ao dia (HHMM ou
 * HH:mm, na ordem do cadastro); sem grade para esse número, a partir do primeiro horário (padrão 08:00) em intervalos
 * iguais. "Se necessário" (0): nenhum.
 */
export function proporHorariosCuidado(
  frequenciaDia: number,
  grade: ReadonlyMap<number, readonly string[]> | Readonly<Record<string, readonly string[]>>,
  primeiro = '08:00',
): string[] {
  if (frequenciaDia <= 0) return [];
  const daGrade: readonly string[] | undefined =
    grade instanceof Map
      ? (grade as ReadonlyMap<number, readonly string[]>).get(frequenciaDia)
      : (grade as Readonly<Record<string, readonly string[]>>)[String(frequenciaDia)];
  if (daGrade && daGrade.length === frequenciaDia)
    return [...new Set(daGrade.map((h: string) => hhmm(minutosDoDia(h))))].sort();
  const ini = minutosDoDia(primeiro);
  const passo = Math.floor(1440 / frequenciaDia);
  return [...new Set(Array.from({ length: frequenciaDia }, (_, k) => hhmm((ini + k * passo) % 1440)))].sort();
}

export interface AtividadePlanejada {
  readonly intervencao: number;
  readonly codigo: string | null;
  readonly descricao: string;
  readonly frequenciaDia: number;
  readonly horarios: readonly string[];
  readonly inicio: string;
  readonly fim: string | null;
}

/**
 * Confere as atividades a prescrever contra o processo vigente: a intervenção é do processo; a atividade com código é
 * da intervenção na terminologia; os horários são um por vez do dia, sem repetir; o "se necessário" não tem horário; o
 * início vai de 24 horas atrás a 7 dias à frente; o fim, depois do início.
 */
export function conferirPrescricaoCuidado(
  atividades: readonly AtividadeCuidadoEntrada[],
  o: {
    readonly processo: ProcessoSaeLido | null;
    readonly versaoVista: number;
    readonly terminologia: TerminologiaSae;
    readonly agora: string;
  },
): { ok: true; atividades: AtividadePlanejada[] } | RecusaSae {
  const p = o.processo;
  if (!p) return recusa('sem-processo', 'Registre o processo de enfermagem antes de prescrever os cuidados.');
  if (o.versaoVista !== p.versao)
    return recusa(
      'sae-mudou',
      'O processo de enfermagem mudou depois da leitura: confira e prescreva de novo.',
    );
  const intervencoes = new Map(p.diagnosticos.flatMap((d) => d.intervencoes).map((i) => [i.id, i]));
  const saida: AtividadePlanejada[] = [];
  const agora = o.agora.slice(0, 16);
  for (const [k, a] of atividades.entries()) {
    const campo = `atividades.${k}`;
    const iv = intervencoes.get(a.intervencao);
    if (!iv)
      return recusa('intervencao-de-outro-processo', 'A intervenção não é do processo vigente.', campo);
    if (a.codigo !== null) {
      const t = o.terminologia.intervencoes.find((x) => x.codigo === iv.codigo);
      if (!t || !t.atividades.some((x) => x.codigo === a.codigo))
        return recusa(
          'termo-desconhecido',
          `A atividade ${a.codigo} não é da intervenção "${iv.descricao}".`,
          campo,
        );
    }
    const horarios = [...a.horarios].map((h) => h.slice(0, 5)).sort();
    if (new Set(horarios).size !== horarios.length)
      return recusa('horario-repetido', 'O mesmo horário entrou duas vezes.', `${campo}.horarios`);
    if (a.frequenciaDia === 0 && horarios.length > 0)
      return recusa(
        'se-necessario-com-horario',
        'A atividade "se necessário" não tem horário aprazado.',
        `${campo}.horarios`,
      );
    if (a.frequenciaDia > 0 && horarios.length !== a.frequenciaDia)
      return recusa(
        'horarios-da-frequencia',
        `A frequência de ${a.frequenciaDia} vez(es) ao dia pede ${a.frequenciaDia} horário(s) aprazado(s).`,
        `${campo}.horarios`,
      );
    const inicio = (a.inicio ?? agora).slice(0, 16);
    if (diferencaMinutos(inicio, agora) > 24 * 60 || diferencaMinutos(agora, inicio) > 7 * 24 * 60)
      return recusa(
        'inicio-fora',
        'O início da atividade vai de 24 horas atrás a 7 dias à frente.',
        `${campo}.inicio`,
      );
    const fim = a.fim ? a.fim.slice(0, 16) : null;
    if (fim !== null && fim <= inicio)
      return recusa('fim-antes', 'O fim da atividade é depois do início.', `${campo}.fim`);
    if (fim !== null && fim <= agora)
      return recusa('fim-antes', 'O fim da atividade já passou.', `${campo}.fim`);
    saida.push({
      intervencao: iv.id,
      codigo: a.codigo,
      descricao: a.descricao,
      frequenciaDia: a.frequenciaDia,
      horarios,
      inicio,
      fim,
    });
  }
  return { ok: true, atividades: saida };
}

/**
 * Até quando a atividade vale: o fim prescrito, a suspensão ou a revisão do processo (a versão nova substitui a
 * vigente: as atividades da anterior param na hora da revisão), o que vier primeiro.
 */
export function fimDaAtividade(a: AtividadeSaeLida, revisadoEm: string | null): string | null {
  const fins = [a.fim, a.suspensa?.em ?? null, revisadoEm]
    .filter((x): x is string => !!x)
    .map((x) => x.slice(0, 16));
  return fins.length ? fins.sort()[0]! : null;
}

/** Os horários previstos da atividade no intervalo [de, ate), dentro da vigência. "Se necessário": nenhum. */
export function previstosDaAtividade(
  a: Pick<AtividadeSaeLida, 'frequenciaDia' | 'horarios' | 'inicio'>,
  fim: string | null,
  de: string,
  ate: string,
): string[] {
  if (a.frequenciaDia === 0 || a.horarios.length === 0) return [];
  const ini = a.inicio.slice(0, 16);
  const d0 = minutos(`${de.slice(0, 10)}T00:00`) - 1440;
  const d1 = minutos(ate.slice(0, 16));
  const saida: string[] = [];
  for (let dia = d0; dia <= d1; dia += 1440)
    for (const h of a.horarios) {
      const t = deMinutos(dia + minutosDoDia(h));
      if (t >= de.slice(0, 16) && t < ate.slice(0, 16) && t >= ini && (fim === null || t < fim))
        saida.push(t);
    }
  return [...new Set(saida)].sort();
}

/** A checagem vigente do horário (a última não estornada). */
export function checagemVigente(
  checagens: readonly ChecagemCuidadoLida[],
  atividade: number,
  previsto: string,
): ChecagemCuidadoLida | null {
  return (
    checagens
      .filter(
        (c) =>
          c.atividade === atividade &&
          c.previsto.slice(0, 16) === previsto.slice(0, 16) &&
          c.estorno === null,
      )
      .sort((x, y) => y.id - x.id)[0] ?? null
  );
}

/** O estado do horário no turno: feita ou não feita pela checagem; sem ela, a checar ou atrasada (fora da tolerância). */
export function estadoDoCuidado(
  previsto: string,
  agora: string,
  checagem: Pick<ChecagemCuidadoLida, 'feita'> | null,
): EstadoCuidado {
  if (checagem) return checagem.feita ? 'feita' : 'naoFeita';
  return diferencaMinutos(previsto.slice(0, 16), agora.slice(0, 16)) > TOLERANCIA_CUIDADO_MIN
    ? 'atrasada'
    : 'pendente';
}

/**
 * Regra 8: confere a checagem do horário — a atividade vigente; o horário é um dos previstos (no "se necessário",
 * qualquer hora dentro da vigência); não se checa com mais de uma hora de antecedência; não feita exige o motivo; o
 * horário já checado (sem estorno) recusa.
 */
export function conferirChecagemCuidado(
  e: {
    readonly previsto: string;
    readonly feita: boolean;
    readonly motivo: string | null;
    readonly horaReal: string | null;
  },
  o: {
    readonly atividade: AtividadeSaeLida;
    readonly fim: string | null;
    readonly agora: string;
    readonly checagens: readonly ChecagemCuidadoLida[];
  },
): { ok: true; previsto: string; horaReal: string; motivo: string | null } | RecusaSae {
  const agora = o.agora.slice(0, 16);
  const previsto = e.previsto.slice(0, 16);
  const horaReal = (e.horaReal ?? agora).slice(0, 16);
  const a = o.atividade;
  if (horaReal > agora) return recusa('hora-futura', 'A hora real do ato é depois de agora.', 'horaReal');
  if (previsto < a.inicio.slice(0, 16) || (o.fim !== null && previsto >= o.fim))
    return recusa(
      'fora-da-vigencia',
      'O horário está fora da vigência da atividade (suspensa, revisada ou encerrada).',
      'previsto',
    );
  if (a.frequenciaDia > 0) {
    const dia = previstosDaAtividade(a, o.fim, somarMinutos(previsto, -1), somarMinutos(previsto, 1));
    if (!dia.includes(previsto))
      return recusa('horario-nao-aprazado', 'O horário não é um dos aprazados da atividade.', 'previsto');
  }
  if (diferencaMinutos(agora, previsto) > TOLERANCIA_CUIDADO_MIN)
    return recusa('antes-da-hora', 'O horário ainda não chegou (até uma hora antes).', 'previsto');
  const motivo = e.motivo?.trim() || null;
  if (!e.feita && (!motivo || motivo.length < 5))
    return recusa(
      'motivo-obrigatorio',
      'Atividade não feita exige o motivo (5 caracteres ou mais).',
      'motivo',
    );
  if (checagemVigente(o.checagens, a.id, previsto))
    return recusa(
      'ja-checado',
      'Este horário já foi checado: para corrigir, estorne a checagem com a justificativa.',
    );
  return { ok: true, previsto, horaReal, motivo };
}

/** A geração da chave do horário: o número de estornos já feitos naquele horário (cada estorno abre uma nova). */
export function geracaoDoHorario(
  checagens: readonly ChecagemCuidadoLida[],
  atividade: number,
  previsto: string,
): number {
  return checagens.filter(
    (c) =>
      c.atividade === atividade && c.previsto.slice(0, 16) === previsto.slice(0, 16) && c.estorno !== null,
  ).length;
}

/** A chave do horário (uma checagem por geração): estabelecimento:atividade:AAAAMMDDHHmm:geração. */
export function chaveDoHorarioCuidado(
  hospital: string,
  atividade: number,
  previsto: string,
  geracao: number,
): string {
  return `${hospital}:${atividade}:${previsto.slice(0, 16).replace(/\D/g, '')}:${geracao}`;
}

/** O estorno: a checagem existe, é do atendimento e ainda não foi estornada (uma vez só). */
export function conferirEstornoCuidado(
  c: (ChecagemCuidadoLida & { readonly atendimento: number }) | null,
  atendimento: number,
): { ok: true } | RecusaSae {
  if (!c || c.atendimento !== atendimento)
    return recusa('nao-encontrado', 'Checagem não encontrada neste atendimento.');
  if (c.estorno) return recusa('ja-estornado', 'Esta checagem já foi estornada.');
  return { ok: true };
}
