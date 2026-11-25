// Cadastro do procedimento cirúrgico (F3.4, 04-CC linha 91): o que a agenda, o mapa, a taxa de sala e os indicadores do
// bloco leem de cada procedimento (grupo, porte, especialidade, natureza, caráter e anestesia sugeridos, duração média,
// tempo de preparo da sala e as exigências do agendamento). Regras puras: a mesma validação roda na tela (na hora) e na
// porta (antes do banco). O procedimento nunca é apagado: sai de uso e volta, porque agendamentos, atos e textos
// padrão já gravados apontam para ele.

/** Naturezas do procedimento (as mesmas do CHECK ck_procedimento_cirurgico_natureza). */
export const NATUREZAS_PROCEDIMENTO_CIRURGICO = [
  'diagnostica',
  'terapeutica',
  'diagnostica_terapeutica',
  'estetica',
  'reparadora',
] as const;
export type NaturezaProcedimentoCirurgico = (typeof NATUREZAS_PROCEDIMENTO_CIRURGICO)[number];

/** Limites do cadastro: um dia de sala para a duração média e quatro horas para o preparo da sala. */
export const DURACAO_MAXIMA_PROCEDIMENTO_MINUTOS = 1440;
export const PREPARO_SALA_MAXIMO_MINUTOS = 240;

export interface EntradaProcedimentoCirurgico {
  readonly codigo: string;
  readonly descricao: string;
  readonly mnemonico?: string | null;
  readonly natureza: string;
  readonly grupo: number | null;
  readonly porte: number | null;
  readonly especialidade: number | null;
  readonly carater?: number | null;
  readonly duracaoMediaMinutos?: number | null;
  readonly tempoPreparoSalaMinutos?: number | null;
  readonly obstetrico?: boolean;
  readonly hemodinamica?: boolean;
}

export interface ProblemaProcedimentoCirurgico {
  readonly campo: string;
  readonly mensagem: string;
}

const CODIGO = /^[A-Z0-9][A-Z0-9._/-]*$/;

/** O código como fica gravado: sem espaços nas pontas e em maiúsculas (a busca e o mapa usam o mesmo formato). */
export function normalizarCodigoProcedimento(codigo: string): string {
  return codigo.trim().toUpperCase();
}

const inteiroEntre = (v: number | null | undefined, min: number, max: number) =>
  v === null || v === undefined || (Number.isInteger(v) && v >= min && v <= max);

/**
 * Os problemas do cadastro (vazio = pode gravar). Porte e especialidade são exigidos: sem eles a agenda não estima o
 * tempo, a taxa de sala não se calcula e o indicador do bloco perde o procedimento.
 */
export function validarProcedimentoCirurgico(
  e: EntradaProcedimentoCirurgico,
): ProblemaProcedimentoCirurgico[] {
  const p: ProblemaProcedimentoCirurgico[] = [];
  const codigo = normalizarCodigoProcedimento(e.codigo ?? '');
  if (!codigo) p.push({ campo: 'codigo', mensagem: 'Informe o código do procedimento.' });
  else if (codigo.length > 30) p.push({ campo: 'codigo', mensagem: 'O código tem no máximo 30 caracteres.' });
  else if (!CODIGO.test(codigo))
    p.push({
      campo: 'codigo',
      mensagem: 'O código usa só letras, números, ponto, barra, hífen e sublinhado, sem espaços.',
    });
  const descricao = (e.descricao ?? '').trim();
  if (descricao.length < 3)
    p.push({ campo: 'descricao', mensagem: 'A descrição precisa de pelo menos 3 caracteres.' });
  else if (descricao.length > 150)
    p.push({ campo: 'descricao', mensagem: 'A descrição tem no máximo 150 caracteres.' });
  const mnemonico = (e.mnemonico ?? '').trim();
  if (mnemonico.length > 15)
    p.push({ campo: 'mnemonico', mensagem: 'A abreviação tem no máximo 15 caracteres.' });
  if (!(NATUREZAS_PROCEDIMENTO_CIRURGICO as readonly string[]).includes(e.natureza))
    p.push({ campo: 'natureza', mensagem: 'Escolha a natureza do procedimento.' });
  if (e.porte === null) p.push({ campo: 'porte', mensagem: 'Escolha o porte do procedimento.' });
  if (e.especialidade === null)
    p.push({ campo: 'especialidade', mensagem: 'Escolha a especialidade principal do procedimento.' });
  if (!inteiroEntre(e.duracaoMediaMinutos, 1, DURACAO_MAXIMA_PROCEDIMENTO_MINUTOS))
    p.push({
      campo: 'duracaoMediaMinutos',
      mensagem: `A duração média vai de 1 a ${DURACAO_MAXIMA_PROCEDIMENTO_MINUTOS} minutos.`,
    });
  if (!inteiroEntre(e.tempoPreparoSalaMinutos, 0, PREPARO_SALA_MAXIMO_MINUTOS))
    p.push({
      campo: 'tempoPreparoSalaMinutos',
      mensagem: `O preparo da sala vai de 0 a ${PREPARO_SALA_MAXIMO_MINUTOS} minutos.`,
    });
  if (e.obstetrico && e.hemodinamica)
    p.push({
      campo: 'hemodinamica',
      mensagem: 'Um procedimento não é obstétrico e de hemodinâmica ao mesmo tempo: marque só um.',
    });
  return p;
}

/**
 * A duração que a tela sugere: a média do próprio procedimento quando já existe; senão, a de referência do porte
 * escolhido; senão, nenhuma.
 */
export function duracaoSugeridaProcedimento(
  duracaoMedia: number | null | undefined,
  referenciaDoPorte: number | null | undefined,
): number | null {
  if (duracaoMedia && duracaoMedia > 0) return duracaoMedia;
  if (referenciaDoPorte && referenciaDoPorte > 0) return referenciaDoPorte;
  return null;
}
