// Comuns da avaliação de desempenho (W0-06, parte 5d): a escala de notas digitada, as passagens de situação do ciclo
// que a tela oferece e as mudanças campo a campo de uma correção (o valor anterior e o novo, para o histórico).
import type { CicloAvaliacaoResposta, CorrecaoResposta, PdiResposta } from '@sgh/contratos';

/** A nota máxima da escala do ciclo: inteiro de 2 a 10; null fora disso. */
export function notaMaxDe(texto: string): number | null {
  const t = texto.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n >= 2 && n <= 10 ? n : null;
}

type SituacaoCiclo = CicloAvaliacaoResposta['situacao'];
/** O aberto se encerra ou se cancela; o encerrado e o cancelado se reabrem (sempre com motivo). */
export const passagensDoCiclo = (s: SituacaoCiclo): SituacaoCiclo[] =>
  s === 'aberto' ? ['encerrado', 'cancelado'] : ['aberto'];

/** As mudanças campo a campo de uma correção (a versão não conta), já formatadas por `txt`. */
export function mudancasDaCorrecao(
  c: CorrecaoResposta,
  txt: (v: unknown, campo: string) => string,
): Array<{ campo: string; antes: string; depois: string }> {
  const an: Record<string, unknown> = { ...c.antes };
  const de: Record<string, unknown> = { ...c.depois };
  return [...new Set([...Object.keys(an), ...Object.keys(de)])]
    .filter((k) => k !== 'versao' && JSON.stringify(an[k] ?? null) !== JSON.stringify(de[k] ?? null))
    .map((k) => ({ campo: k, antes: txt(an[k], k), depois: txt(de[k], k) }));
}

/** As notas da escala do ciclo (1 a `max`) como opções do combo; o vazio é "sem nota". */
export const opcoesNota = (max: number, semNota: string): Array<{ valor: string; rotulo: string }> => [
  { valor: '', rotulo: semNota },
  ...Array.from({ length: max }, (_, i) => ({ valor: String(i + 1), rotulo: String(i + 1) })),
];

/** O formulário das notas (uma linha por competência) a partir das notas lidas da avaliação. */
export interface LinhaNota {
  competencia: number;
  nome: string;
  nota: string;
  comentario: string;
}
export const linhasDasNotas = (
  ns: ReadonlyArray<{ competencia: number; nome: string; nota: number | null; comentario: string | null }>,
): LinhaNota[] =>
  ns.map((n) => ({
    competencia: n.competencia,
    nome: n.nome,
    nota: n.nota === null ? '' : String(n.nota),
    comentario: n.comentario ?? '',
  }));

/** O corpo das notas para gravar: nota vazia vira null; comentário vazio vira null. */
export const notasParaGravar = (
  ls: readonly LinhaNota[],
): Array<{ competencia: number; nota: number | null; comentario: string | null }> =>
  ls.map((l) => ({
    competencia: l.competencia,
    nota: l.nota === '' ? null : Number(l.nota),
    comentario: l.comentario.trim() === '' ? null : l.comentario.trim(),
  }));

/** Quantas competências ainda estão sem nota (a finalização exige todas). */
export const semNota = (ls: readonly LinhaNota[]): number => ls.filter((l) => l.nota === '').length;

/** O formulário difere das notas gravadas (a finalização pede gravar antes). */
export const notasMudaram = (
  ls: readonly LinhaNota[],
  parecer: string,
  gravadas: ReadonlyArray<{ competencia: number; nota: number | null; comentario: string | null }>,
  parecerGravado: string | null,
): boolean =>
  parecer.trim() !== (parecerGravado ?? '').trim() ||
  JSON.stringify(notasParaGravar(ls)) !==
    JSON.stringify(
      gravadas.map((n) => ({ competencia: n.competencia, nota: n.nota, comentario: n.comentario ?? null })),
    );

/** Os marcos que o ciclo aceita: o de experiência pede 45 ou 90 dias; o periódico, nenhum. */
export const marcosDoCiclo = (tipo: CicloAvaliacaoResposta['tipo']): Array<45 | 90> =>
  tipo === 'experiencia' ? [45, 90] : [];

/** O formulário da ação do PDI na ficha do colaborador (competência, curso e avaliação são opcionais). */
export interface FormPdi {
  acao: string;
  prazo: string | null;
  competencia: number | null;
  curso: number | null;
  avaliacao: number | null;
}
export const formPdiVazio = (): FormPdi => ({
  acao: '',
  prazo: null,
  competencia: null,
  curso: null,
  avaliacao: null,
});
export const formDoPdi = (p: PdiResposta): FormPdi => ({
  acao: p.acao,
  prazo: p.prazo,
  competencia: p.competencia,
  curso: p.curso,
  avaliacao: p.avaliacao,
});
/** Os dados do PDI para gravar (a ação aparada; o prazo vazio fica '' para a validação recusar). */
export const dadosDoPdi = (f: FormPdi) => ({
  acao: f.acao.trim(),
  prazo: f.prazo ?? '',
  competencia: f.competencia,
  curso: f.curso,
  avaliacao: f.avaliacao,
});
/** A data sugerida para concluir a ação: a conclusão do curso, se houver; senão, hoje. */
export const conclusaoSugerida = (p: PdiResposta, hoje: string): string =>
  p.cursoConcluidoEm !== null && p.cursoConcluidoEm <= hoje ? p.cursoConcluidoEm.slice(0, 10) : hoje;
/** A ação aberta com o prazo vencido (o painel destaca). */
export const pdiAtrasado = (p: PdiResposta, hoje: string): boolean =>
  p.situacao === 'aberta' && p.prazo < hoje;

/** Texto opcional para gravar: em branco vira null (a observação da ciência própria). */
export const textoOuNulo = (s: string): string | null => (s.trim() === '' ? null : s.trim());
