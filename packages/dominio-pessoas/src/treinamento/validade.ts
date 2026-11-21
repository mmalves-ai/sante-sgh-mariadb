// Treinamentos e capacitações, fatia F6 (M52.6; ficha, regra 20; RDC 63/2011 art. 32 a 34 (RDC63-05); NR-32 32.2.4.9
// (NR32-04)): o catálogo de cursos com a carga mínima, a validade e o público obrigatório (todos, por unidade ou por
// função), as turmas (conteúdo, carga, instrutor, período) e a participação de cada colaborador (presença,
// aproveitamento, conclusão). A situação de cada curso obrigatório para o colaborador sai da última conclusão aprovada:
// válido, a vencer (dentro do alerta), vencido ou pendente (nunca concluído). O domínio nunca lê o relógio: o "hoje"
// vem de quem chama.
import { diasEntre } from '../datas.js';
import { somarMeses } from '../sesmt/aso.js';
import { chaveFuncao } from '../sesmt/epi.js';
import { type RecusaSesmt, recusaSesmt } from '../sesmt/recusa.js';

/** Alerta padrão de vencimento do treinamento, em dias (parâmetro `pessoas.treinamento.alertaDias`). */
export const ALERTA_TREINAMENTO_DIAS = 30;
/** Validade máxima aceita para um curso (10 anos). */
export const VALIDADE_MAXIMA_MESES = 120;

export type SituacaoTreinamento = 'valido' | 'aVencer' | 'vencido' | 'pendente';

export interface AlvoCurso {
  readonly tipo: 'unidade' | 'funcao';
  /** Código da unidade assistencial ou a chave da função (`chaveFuncao`). */
  readonly valor: string;
}

export interface CursoLido {
  readonly id: number;
  readonly obrigatorio: boolean;
  readonly validadeMeses: number;
  readonly cargaMinimaMin: number;
  readonly ativo: boolean;
  readonly alvos: readonly AlvoCurso[];
}

export interface ColaboradorDoTreinamento {
  readonly unidade: number | null;
  readonly funcao: string | null;
  readonly cargo: string;
  readonly admissao: string;
  readonly desligamento: string | null;
}

export interface ConclusaoLida {
  readonly curso: number;
  readonly conclusao: string;
  readonly validoAte: string | null;
}

/** A validade de uma conclusão: a data + a validade do curso; sem validade (0), vale para sempre (null). */
export function validadeAte(conclusao: string, validadeMeses: number): string | null {
  return validadeMeses > 0 ? somarMeses(conclusao, validadeMeses) : null;
}

/** A chave da função do colaborador (a função quando houver; senão o cargo), como no mapa de riscos do SESMT. */
export function funcaoDoColaborador(c: Pick<ColaboradorDoTreinamento, 'funcao' | 'cargo'>): string {
  return chaveFuncao(c.funcao?.trim() ? c.funcao : c.cargo);
}

/** O curso alcança o colaborador: sem alvo, todos; senão a unidade OU a função do colaborador está entre os alvos. */
export function cursoAlcanca(
  curso: Pick<CursoLido, 'alvos'>,
  c: Pick<ColaboradorDoTreinamento, 'unidade' | 'funcao' | 'cargo'>,
): boolean {
  if (curso.alvos.length === 0) return true;
  const funcao = funcaoDoColaborador(c);
  return curso.alvos.some((a) =>
    a.tipo === 'unidade' ? c.unidade !== null && a.valor === String(c.unidade) : a.valor === funcao,
  );
}

export interface SituacaoCurso {
  readonly situacao: SituacaoTreinamento;
  readonly ultimaConclusao: string | null;
  readonly validoAte: string | null;
  /** Dias até o vencimento (negativo: vencido há tantos dias); null sem validade ou pendente. */
  readonly dias: number | null;
}

/** A conclusão que vale: a de validade mais longa (a sem validade vence todas); no empate, a mais recente. */
export function conclusaoQueVale(cs: readonly ConclusaoLida[]): ConclusaoLida | null {
  let melhor: ConclusaoLida | null = null;
  for (const c of cs) {
    if (!melhor) {
      melhor = c;
      continue;
    }
    const a = c.validoAte ?? '9999-12-31';
    const b = melhor.validoAte ?? '9999-12-31';
    if (a > b || (a === b && c.conclusao > melhor.conclusao)) melhor = c;
  }
  return melhor;
}

/** A situação do curso para o colaborador, a partir das conclusões aprovadas dele naquele curso. */
export function situacaoCurso(
  conclusoes: readonly ConclusaoLida[],
  hoje: string,
  alertaDias: number = ALERTA_TREINAMENTO_DIAS,
): SituacaoCurso {
  const c = conclusaoQueVale(conclusoes);
  if (!c) return { situacao: 'pendente', ultimaConclusao: null, validoAte: null, dias: null };
  if (c.validoAte === null)
    return { situacao: 'valido', ultimaConclusao: c.conclusao, validoAte: null, dias: null };
  const dias = diasEntre(hoje, c.validoAte);
  const situacao: SituacaoTreinamento = dias < 0 ? 'vencido' : dias <= alertaDias ? 'aVencer' : 'valido';
  return { situacao, ultimaConclusao: c.conclusao, validoAte: c.validoAte, dias };
}

export interface PendenciaTreinamento {
  readonly curso: number;
  readonly situacao: Exclude<SituacaoTreinamento, 'valido'>;
  readonly validoAte: string | null;
  readonly dias: number | null;
}

/**
 * As pendências do colaborador nos cursos OBRIGATÓRIOS e ativos que o alcançam (regra 20; NR32-04: a capacitação antes
 * do início das atividades e de forma continuada): a vencer, vencido ou pendente.
 */
export function pendenciasTreinamento(
  cursos: readonly CursoLido[],
  conclusoes: readonly ConclusaoLida[],
  c: ColaboradorDoTreinamento,
  hoje: string,
  alertaDias: number = ALERTA_TREINAMENTO_DIAS,
): PendenciaTreinamento[] {
  const r: PendenciaTreinamento[] = [];
  for (const k of cursos) {
    if (!k.ativo || !k.obrigatorio || !cursoAlcanca(k, c)) continue;
    const s = situacaoCurso(
      conclusoes.filter((x) => x.curso === k.id),
      hoje,
      alertaDias,
    );
    if (s.situacao !== 'valido')
      r.push({ curso: k.id, situacao: s.situacao, validoAte: s.validoAte, dias: s.dias });
  }
  return r;
}

export interface EntradaCurso {
  readonly cargaMinimaMin: number;
  readonly validadeMeses: number;
  readonly obrigatorio: boolean;
  readonly alvos: readonly AlvoCurso[];
}

/** O curso: carga mínima positiva, validade de 0 a 120 meses, alvos sem repetição. */
export function conferirCurso(e: EntradaCurso): RecusaSesmt | null {
  if (!(e.cargaMinimaMin > 0))
    return recusaSesmt('carga-invalida', 'Informe a carga horária mínima do curso.', 'cargaMinimaMin');
  if (e.validadeMeses < 0 || e.validadeMeses > VALIDADE_MAXIMA_MESES)
    return recusaSesmt(
      'validade-invalida',
      `A validade vai de 0 (sem vencimento) a ${VALIDADE_MAXIMA_MESES} meses.`,
      'validadeMeses',
    );
  const chaves = e.alvos.map((a) => `${a.tipo}:${a.valor}`);
  if (new Set(chaves).size !== chaves.length)
    return recusaSesmt('alvo-repetido', 'O mesmo público aparece duas vezes no curso.', 'alvos');
  return null;
}

export interface EntradaTurma {
  readonly inicio: string;
  readonly fim: string;
  readonly cargaMin: number;
  readonly instrutor: string;
}

/** A turma: período coerente, carga não menor que a mínima do curso, curso ativo, início até um ano adiante. */
export function conferirTurma(
  e: EntradaTurma,
  curso: Pick<CursoLido, 'cargaMinimaMin' | 'ativo'>,
  hoje: string,
): RecusaSesmt | null {
  if (!curso.ativo) return recusaSesmt('curso-inativo', 'O curso está inativo: reative-o antes.', 'curso');
  if (e.fim < e.inicio) return recusaSesmt('periodo-invalido', 'O fim da turma vem antes do início.', 'fim');
  if (diasEntre(hoje, e.inicio) > 366)
    return recusaSesmt('inicio-distante', 'O início fica a mais de um ano: confira a data.', 'inicio');
  if (e.cargaMin < curso.cargaMinimaMin)
    return recusaSesmt(
      'carga-insuficiente',
      `A carga da turma é menor que a mínima do curso (${curso.cargaMinimaMin} min).`,
      'cargaMin',
    );
  if (e.instrutor.trim().length < 3)
    return recusaSesmt('instrutor-obrigatorio', 'Informe o instrutor.', 'instrutor');
  return null;
}

export type PresencaTreinamento = 'inscrito' | 'presente' | 'ausente';
export type AproveitamentoTreinamento = 'aprovado' | 'reprovado' | 'sem-avaliacao';

export interface EntradaParticipacao {
  readonly presenca: PresencaTreinamento;
  readonly aproveitamento: AproveitamentoTreinamento | null;
  readonly conclusao: string | null;
}

export interface TurmaDaParticipacao {
  readonly inicio: string;
  readonly fim: string;
  readonly situacao: 'aberta' | 'encerrada' | 'cancelada';
}

/**
 * A participação: só na turma aberta; o colaborador ativo no início da turma; o ausente não conclui; o aprovado
 * (ou "sem avaliação", que conta como concluído) tem a data de conclusão dentro da turma e nunca no futuro.
 */
export function conferirParticipacao(
  e: EntradaParticipacao,
  t: TurmaDaParticipacao,
  c: Pick<ColaboradorDoTreinamento, 'admissao' | 'desligamento'>,
  hoje: string,
): RecusaSesmt | null {
  if (t.situacao !== 'aberta')
    return recusaSesmt(
      t.situacao === 'cancelada' ? 'turma-cancelada' : 'turma-encerrada',
      t.situacao === 'cancelada'
        ? 'A turma foi cancelada.'
        : 'A turma está encerrada: a lista de presença não muda mais.',
      'treinamento',
    );
  if (c.desligamento !== null && c.desligamento < t.inicio)
    return recusaSesmt(
      'colaborador-desligado',
      'O colaborador foi desligado antes do início da turma.',
      'vinculo',
    );
  if (e.presenca === 'ausente' && e.aproveitamento !== null && e.aproveitamento !== 'reprovado')
    return recusaSesmt('ausente-nao-conclui', 'Quem faltou não conclui o treinamento.', 'aproveitamento');
  const conclui = e.aproveitamento === 'aprovado' || e.aproveitamento === 'sem-avaliacao';
  if (conclui && e.presenca !== 'presente')
    return recusaSesmt('presenca-obrigatoria', 'Registre a presença antes da conclusão.', 'presenca');
  if (conclui && e.conclusao === null)
    return recusaSesmt('conclusao-obrigatoria', 'Informe a data de conclusão.', 'conclusao');
  if (e.conclusao !== null) {
    if (e.conclusao < t.inicio)
      return recusaSesmt('conclusao-fora', 'A conclusão vem antes do início da turma.', 'conclusao');
    if (e.conclusao > hoje)
      return recusaSesmt('conclusao-futura', 'A conclusão não pode ficar no futuro.', 'conclusao');
    if (diasEntre(t.fim, e.conclusao) > 60)
      return recusaSesmt(
        'conclusao-fora',
        'A conclusão fica mais de 60 dias depois do fim da turma: confira a data.',
        'conclusao',
      );
  }
  return null;
}

/** A participação conta como conclusão válida (para a situação e a validade)? */
export function participacaoConclui(p: {
  readonly presenca: PresencaTreinamento;
  readonly aproveitamento: AproveitamentoTreinamento | null;
  readonly conclusao: string | null;
}): boolean {
  return (
    p.presenca === 'presente' &&
    p.conclusao !== null &&
    (p.aproveitamento === 'aprovado' || p.aproveitamento === 'sem-avaliacao')
  );
}

/** Encerrar a turma: só aberta, sem inscrito pendente (todo participante com presença registrada). */
export function conferirEncerramentoTurma(
  t: Pick<TurmaDaParticipacao, 'situacao'>,
  participantes: readonly { presenca: PresencaTreinamento }[],
): RecusaSesmt | null {
  if (t.situacao !== 'aberta')
    return recusaSesmt('turma-encerrada', 'A turma já está encerrada ou cancelada.', 'treinamento');
  if (participantes.length === 0)
    return recusaSesmt('turma-vazia', 'A turma não tem participante: cancele em vez de encerrar.', null);
  if (participantes.some((p) => p.presenca === 'inscrito'))
    return recusaSesmt(
      'presenca-pendente',
      'Há participante sem presença registrada: registre presente ou ausente antes de encerrar.',
      null,
    );
  return null;
}
