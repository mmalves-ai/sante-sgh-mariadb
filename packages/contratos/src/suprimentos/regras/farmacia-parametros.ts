// Parâmetros da integração prescrição × estoque (F3.6, 05-SUP linha 7): a regra que diz qual local atende a prescrição
// de cada escopo (centro de custo, setor ou unidade), em que momento e de que forma, e a grade de horários padrão de
// cada frequência. Regras puras: a API confere antes de gravar e a tela confere na hora, com as mesmas mensagens.
import { recusa, type RecusaSuprimentos } from './recusa.js';

export const TIPOS_INTEGRACAO = ['requisicao_automatica', 'dispensacao_direta', 'sem_integracao'] as const;
export const MOMENTOS_INTEGRACAO = [
  'na_prescricao',
  'na_liberacao_farmaceutica',
  'no_aprazamento',
  'antes_do_horario',
] as const;
export const FORMAS_DISPENSACAO = ['dose_individualizada', 'dose_unitaria', 'dose_coletiva', 'kit'] as const;

export interface RegraIntegracaoConferida {
  readonly centroCusto: number | null;
  readonly setor: number | null;
  readonly unidade: number | null;
  readonly grupo: number | null;
  readonly subgrupo: number | null;
  readonly item: number | null;
  readonly localAtendente: number;
  readonly localSubstituto: number | null;
  readonly tipoIntegracao: (typeof TIPOS_INTEGRACAO)[number];
  readonly momento: (typeof MOMENTOS_INTEGRACAO)[number];
  readonly antecedenciaMinutos: number | null;
  readonly geraManipulacao: boolean;
}

/** As recusas da regra de integração (vazio: pode gravar). */
export function conferirRegraIntegracao(r: RegraIntegracaoConferida): RecusaSuprimentos[] {
  const out: RecusaSuprimentos[] = [];
  if (r.centroCusto === null && r.setor === null && r.unidade === null)
    out.push(
      recusa('escopo-obrigatorio', 'Diga a quem a regra vale: centro de custo, setor ou unidade.', [
        'centroCusto',
        'setor',
        'unidade',
      ]),
    );
  if (r.localSubstituto !== null && r.localSubstituto === r.localAtendente)
    out.push(
      recusa('mesmo-local', 'O local substituto tem de ser outro que não o que atende.', ['localSubstituto']),
    );
  if (r.momento === 'antes_do_horario' && !(r.antecedenciaMinutos && r.antecedenciaMinutos > 0))
    out.push(
      recusa('antecedencia-obrigatoria', 'Antes do horário: informe a antecedência em minutos.', [
        'antecedenciaMinutos',
      ]),
    );
  if (r.momento !== 'antes_do_horario' && r.antecedenciaMinutos !== null)
    out.push(
      recusa('antecedencia-sem-uso', 'A antecedência só vale para o momento "antes do horário".', [
        'antecedenciaMinutos',
      ]),
    );
  if (r.item !== null && (r.grupo !== null || r.subgrupo !== null))
    out.push(
      recusa(
        'item-e-grupo',
        'A exceção por item não se combina com grupo ou subgrupo: escolha um dos dois.',
        ['item'],
      ),
    );
  if (r.subgrupo !== null && r.grupo === null)
    out.push(recusa('subgrupo-sem-grupo', 'Escolha o grupo do subgrupo.', ['grupo']));
  if (r.tipoIntegracao === 'sem_integracao' && r.geraManipulacao)
    out.push(
      recusa('manipulacao-sem-integracao', 'Sem integração não há requisição para gerar a manipulação.', [
        'geraManipulacao',
      ]),
    );
  return out;
}

/** A chave do escopo e dos filtros: duas regras ativas com a mesma chave e a mesma prioridade são ambíguas. */
export const chaveRegraIntegracao = (
  r: Pick<RegraIntegracaoConferida, 'centroCusto' | 'setor' | 'unidade' | 'grupo' | 'subgrupo' | 'item'> & {
    tipoItem: number | null;
    prioridade: number;
  },
): string =>
  [r.centroCusto, r.setor, r.unidade, r.tipoItem, r.grupo, r.subgrupo, r.item, r.prioridade]
    .map((x) => x ?? '-')
    .join('|');

export interface HorarioPadraoConferido {
  /** HH:MM */
  readonly hora: string;
  /** Dias da semana de 1 (domingo) a 7; vazio = todos. */
  readonly dias: readonly number[];
}

const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

/**
 * A grade de horários de uma frequência: ao menos um horário, até 48, sem horário repetido, dias de 1 a 7 sem
 * repetição e, quando a frequência diz quantas doses por dia, a grade tem esse número de horários.
 */
export function conferirHorariosPadrao(
  horarios: readonly HorarioPadraoConferido[],
  dosesPorDia: number | null,
): RecusaSuprimentos[] {
  const out: RecusaSuprimentos[] = [];
  if (horarios.length === 0) return [recusa('sem-horario', 'Informe ao menos um horário.', ['horarios'])];
  if (horarios.length > 48)
    out.push(recusa('horarios-demais', 'No máximo 48 horários por dia.', ['horarios']));
  horarios.forEach((h, i) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(h.hora))
      out.push(
        recusa('hora-invalida', `Horário ${i + 1}: use HH:MM, de 00:00 a 23:59.`, [`horarios.${i}.hora`]),
      );
    if (h.dias.some((d) => !Number.isInteger(d) || d < 1 || d > 7) || new Set(h.dias).size !== h.dias.length)
      out.push(
        recusa('dia-invalido', `Horário ${i + 1}: dias de 1 (domingo) a 7, sem repetir.`, [
          `horarios.${i}.dias`,
        ]),
      );
  });
  const vistos = new Set<number>();
  horarios.forEach((h, i) => {
    const m = minutos(h.hora);
    if (vistos.has(m))
      out.push(
        recusa('horario-repetido', `O horário ${h.hora} aparece mais de uma vez.`, [`horarios.${i}.hora`]),
      );
    vistos.add(m);
  });
  if (dosesPorDia !== null && dosesPorDia > 0 && horarios.length !== dosesPorDia)
    out.push(
      recusa(
        'doses-da-frequencia',
        `A frequência tem ${dosesPorDia} dose(s) por dia: a grade precisa desse número.`,
        ['horarios'],
      ),
    );
  return out;
}

/** O texto gravado dos dias (nulo = todos os dias). */
export const diasParaTexto = (dias: readonly number[]): string | null =>
  dias.length === 0 || dias.length === 7 ? null : [...dias].sort((a, b) => a - b).join(',');

export const diasDoTexto = (t: string | null): number[] =>
  t
    ? t
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((x) => Number.isInteger(x))
    : [];
