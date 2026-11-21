// Agenda de exames (ficha do M18, regras 1 a 4; ref 01 §2.1, §9.1 e §9.2; cap-05a §5.1; cap-10 §10.3). Regras puras,
// sem banco, medidas na cópia pc (só agregados):
//   - a categoria da agenda é a do ato do catálogo de exames (21 Endoscopia digestiva, 24 Ultrassonografia, 42
//     Outros; o catálogo do SADT conhece também 15, 16, 25, 26, 27 e o ato 90, Métodos gráficos, que não tem linha no
//     cadastro de atos e é rotulado aqui);
//   - a categoria da marcação é 90 quando o horário é do tipo 'O' (Outros: 4.593 de 4.594 nas agendas 42 e 587 numa
//     de ultrassom) e a categoria da agenda nos demais (21 e 24): a chave única da marcação inclui a categoria;
//   - o exame grava o horário E a marcação (com o prontuário): em 2026, todo horário ocupado tem a marcação; um
//     horário com situação 'C' e paciente vazio é resíduo do sistema anterior ('C' é Confirmado: X é Cancelado);
//   - o vínculo com o paciente é o prontuário (87% em 2026); o casamento por nome é só sugestão com confirmação;
//   - o comparecimento da marcação de exame é um sinal próprio (falso na marcação) e o procedimento fica zerado nas
//     duas linhas.
import { formatarHora } from './tempo.js';

export interface CategoriaExame {
  readonly codigo: number;
  readonly rotulo: string;
  /** O código existe no cadastro de atos (o ato 90 não existe: rótulo do produto). */
  readonly noCatalogo: boolean;
}

/** As categorias que as agendas de exame e o catálogo do SADT (ato do exame) usam. */
export const CATEGORIAS_EXAME: readonly CategoriaExame[] = [
  { codigo: 15, rotulo: 'Patologia clínica', noCatalogo: true },
  { codigo: 16, rotulo: 'Radiodiagnóstico', noCatalogo: true },
  { codigo: 21, rotulo: 'Endoscopia digestiva', noCatalogo: true },
  { codigo: 24, rotulo: 'Ultrassonografia', noCatalogo: true },
  { codigo: 25, rotulo: 'Tomografia computadorizada', noCatalogo: true },
  { codigo: 26, rotulo: 'Ressonância magnética', noCatalogo: true },
  { codigo: 27, rotulo: 'Ecocardiograma com Doppler', noCatalogo: true },
  { codigo: 42, rotulo: 'Outros', noCatalogo: true },
  { codigo: 90, rotulo: 'Métodos gráficos', noCatalogo: false },
];

export function categoriaExame(codigo: number | null | undefined): CategoriaExame | null {
  return CATEGORIAS_EXAME.find((c) => c.codigo === codigo) ?? null;
}

export function rotuloCategoria(codigo: number | null | undefined): string {
  return categoriaExame(codigo)?.rotulo ?? `Categoria ${codigo ?? 'não informada'}`;
}

/** O tipo de horário da agenda e da grade de exames (E, U e O vistos; o resto é recusado). */
export const TIPOS_HORARIO_EXAME = [
  { codigo: 'E', rotulo: 'Endoscopia' },
  { codigo: 'U', rotulo: 'Ultrassonografia' },
  { codigo: 'O', rotulo: 'Outros (métodos gráficos)' },
] as const;
export type TipoHorarioExame = (typeof TIPOS_HORARIO_EXAME)[number]['codigo'];

export function tipoHorarioValido(t: string): t is TipoHorarioExame {
  return TIPOS_HORARIO_EXAME.some((x) => x.codigo === t);
}

export function rotuloTipoHorario(t: string | null | undefined): string {
  return TIPOS_HORARIO_EXAME.find((x) => x.codigo === (t ?? '').trim())?.rotulo ?? 'Não informado';
}

/** O ato do horário do tipo 'O' (Outros) na marcação: Métodos gráficos. */
export const CATEGORIA_OUTROS = 90;

/** A categoria da marcação: 90 para o horário do tipo 'O'; senão a categoria da agenda. */
export function categoriaDaMarcacao(categoriaAgenda: number, exameDoHorario: string): number {
  return exameDoHorario.trim() === 'O' ? CATEGORIA_OUTROS : categoriaAgenda;
}

/** Situação do horário de exame: C é Confirmado; X é Cancelado (o sistema anterior usava C como cancelado). */
export const SITUACAO_CONFIRMADO = 'C';
export const SITUACAO_CANCELADO = 'X';

export interface HorarioExameLido {
  readonly data: string;
  readonly hora: string;
  readonly exame: string;
  readonly paciente: string;
  readonly livre: string;
  readonly situacao: string;
  readonly tipo: string;
  /** Há marcação no horário. */
  readonly temMarcacao: boolean;
}

export type EstadoHorarioExame =
  | 'vago'
  | 'bloqueado'
  | 'marcado'
  | 'confirmado'
  | 'realizado'
  | 'transferido'
  | 'marcacao-incompleta'
  | 'residuo-confirmado-sem-paciente'
  | 'outro';

/**
 * Estado do horário de exame para a tela. Vaga = PACIENTE vazio, sem situação, livre e normal. "Marcação incompleta"
 * = ocupado sem marcação (o que o sistema anterior grava hoje); "confirmado sem paciente" = 'C' com PACIENTE vazio (o
 * cancelamento da sante-api).
 */
export function estadoDoHorarioExame(h: HorarioExameLido): EstadoHorarioExame {
  const pac = h.paciente.trim();
  const sit = h.situacao.trim();
  if (pac === '') {
    if (sit === SITUACAO_CONFIRMADO) return 'residuo-confirmado-sem-paciente';
    if (h.livre === 'N') return 'bloqueado';
    return sit === '' && h.tipo !== 'E' ? 'vago' : 'outro';
  }
  if (!h.temMarcacao) return 'marcacao-incompleta';
  if (sit === '') return 'marcado';
  if (sit === SITUACAO_CONFIRMADO) return 'confirmado';
  if (sit === 'S') return 'realizado';
  if (sit === 'T') return 'transferido';
  return 'outro';
}

export const ROTULOS_ESTADO_EXAME: Readonly<Record<EstadoHorarioExame, string>> = {
  vago: 'Vago',
  bloqueado: 'Bloqueado',
  marcado: 'Marcado',
  confirmado: 'Confirmado',
  realizado: 'Realizado',
  transferido: 'Transferido (remarcado)',
  'marcacao-incompleta': 'Marcação incompleta (sem os dados do paciente)',
  'residuo-confirmado-sem-paciente': 'Confirmado sem paciente (resíduo de cancelamento)',
  outro: 'Outra situação',
};

/** O horário aceita marcação nova (vaga pública; encaixe e bloqueado nunca). */
export function aceitaMarcacao(h: HorarioExameLido): boolean {
  return estadoDoHorarioExame(h) === 'vago';
}

export interface ResiduoExame {
  /** Horários 'C' com PACIENTE vazio (cancelamento da sante-api). */
  readonly confirmadosSemPaciente: number;
  /** Horários ocupados sem a marcação. */
  readonly ocupadosSemMarcacao: number;
  readonly total: number;
}

export function contarResiduo(horarios: readonly HorarioExameLido[]): ResiduoExame {
  let c = 0;
  let o = 0;
  for (const h of horarios) {
    const e = estadoDoHorarioExame(h);
    if (e === 'residuo-confirmado-sem-paciente') c++;
    else if (e === 'marcacao-incompleta') o++;
  }
  return { confirmadosSemPaciente: c, ocupadosSemMarcacao: o, total: c + o };
}

/** Vínculo da marcação com o cadastro: pelo prontuário; o nome igual é só sugestão a confirmar (regra 3). */
export type VinculoExame =
  | { readonly tipo: 'prontuario'; readonly prontuario: number }
  | { readonly tipo: 'sugestao-por-nome'; readonly candidatos: number }
  | { readonly tipo: 'sem-vinculo' };

export function vinculoDaMarcacao(pront: number, candidatosPorNome: number): VinculoExame {
  if (pront > 0) return { tipo: 'prontuario', prontuario: pront };
  if (candidatosPorNome > 0) return { tipo: 'sugestao-por-nome', candidatos: candidatosPorNome };
  return { tipo: 'sem-vinculo' };
}

/**
 * Cobertura por exame do novo (SGH_AGE_COBERTURA_EXAME): linhas sem convênio dizem quais exames a agenda faz;
 * linhas com convênio restringem quem cobre o exame nesta agenda. Sem linha nenhuma do exame, vale a lista de
 * convênios da agenda (o que o outro sistema também usa).
 */
export interface LinhaCoberturaExame {
  readonly exame: number;
  readonly convenio: number | null;
}

export type AvaliacaoCoberturaExame =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly codigo: 'exame-nao-feito' | 'convenio-nao-cobre-exame';
      readonly texto: string;
    };

export function avaliarCoberturaExame(
  linhas: readonly LinhaCoberturaExame[],
  exame: number | null,
  convenio: number,
): AvaliacaoCoberturaExame {
  if (exame === null || linhas.length === 0) return { ok: true };
  const feitos = new Set(linhas.map((l) => l.exame));
  if (!feitos.has(exame))
    return { ok: false, codigo: 'exame-nao-feito', texto: 'Esta agenda não faz o exame escolhido.' };
  const restritos = linhas.filter((l) => l.exame === exame && l.convenio !== null).map((l) => l.convenio);
  if (restritos.length > 0 && !restritos.includes(convenio))
    return {
      ok: false,
      codigo: 'convenio-nao-cobre-exame',
      texto: 'O convênio não cobre este exame nesta agenda: escolha outro convênio ou outra agenda.',
    };
  return { ok: true };
}

/** Legenda curta do horário para listas ("07:40 · Ultrassonografia"). */
export function legendaHorarioExame(h: Pick<HorarioExameLido, 'hora' | 'exame'>): string {
  return `${formatarHora(h.hora)} · ${rotuloTipoHorario(h.exame)}`;
}
