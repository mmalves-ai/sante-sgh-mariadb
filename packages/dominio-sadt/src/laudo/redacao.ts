// Redação do laudo de imagem e de métodos gráficos (F3.5, 05-SADT linha 16). O laudo nasce como rascunho (texto livre
// ou a partir de um modelo com campos variáveis), é assinado pelo médico habilitado e, depois de assinado, só muda por
// retificação com motivo: cada assinatura e cada retificação viram uma versão própria, e a anterior nunca é apagada.
// Regra pura, sem banco.
import { podeLaudar, type VinculoProfissional } from './habilitacao.js';

export class RecusaLaudo extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export type SituacaoLaudo =
  'rascunho' | 'aguardando_revisao' | 'assinado' | 'emitido' | 'retificado' | 'cancelado';

/** Situações em que o texto ainda é rascunho (muda sem versão). */
const EM_REDACAO: ReadonlySet<SituacaoLaudo> = new Set(['rascunho', 'aguardando_revisao']);
/** Situações de laudo assinado (oficial): só a retificação muda o texto. */
const ASSINADO: ReadonlySet<SituacaoLaudo> = new Set(['assinado', 'emitido', 'retificado']);

export type AcaoLaudo = 'salvar' | 'enviar_revisao' | 'assinar' | 'retificar';

/** A situação seguinte do laudo pela ação, ou a recusa com o motivo em português. */
export function situacaoDepois(atual: SituacaoLaudo | null, acao: AcaoLaudo): SituacaoLaudo {
  const a = atual ?? 'rascunho';
  if (a === 'cancelado') throw new RecusaLaudo('laudo-cancelado', 'O laudo foi cancelado e não pode mudar.');
  switch (acao) {
    case 'salvar':
      if (ASSINADO.has(a))
        throw new RecusaLaudo(
          'laudo-assinado',
          'O laudo já foi assinado: para mudar o texto, faça a retificação com o motivo.',
        );
      return a;
    case 'enviar_revisao':
      if (!EM_REDACAO.has(a))
        throw new RecusaLaudo('laudo-assinado', 'O laudo já foi assinado e não volta para revisão.');
      return 'aguardando_revisao';
    case 'assinar':
      if (!EM_REDACAO.has(a))
        throw new RecusaLaudo('laudo-ja-assinado', 'O laudo já está assinado; para mudar, retifique.');
      return 'assinado';
    case 'retificar':
      if (!ASSINADO.has(a))
        throw new RecusaLaudo(
          'laudo-nao-assinado',
          'Só o laudo assinado é retificado; o rascunho se corrige direto.',
        );
      return 'retificado';
  }
}

/** Texto mínimo de um laudo para assinar: sem texto não há laudo. */
export function conferirTextoParaAssinar(texto: string | null): void {
  if (!texto || texto.replace(/<[^>]*>/g, '').trim().length < 10)
    throw new RecusaLaudo('laudo-sem-texto', 'Escreva o laudo (ao menos 10 caracteres) antes de assinar.');
}

/** A retificação exige motivo: o do cadastro ou o texto livre (ao menos 10 caracteres). */
export function conferirMotivoRetificacao(motivoCadastro: number | null, motivoTexto: string | null): void {
  if (motivoCadastro === null && (motivoTexto ?? '').trim().length < 10)
    throw new RecusaLaudo(
      'retificacao-sem-motivo',
      'Diga o motivo da retificação (do cadastro ou com ao menos 10 caracteres).',
    );
}

/**
 * Quem assina ou retifica o laudo de imagem e de métodos gráficos: a regra única de quem lauda (`podeLaudar`, regra 8 do
 * M26, em @sgh/contratos), sem regra paralela. O laudo destes setores é privativo de médico (Lei 12.842/2013); o ato
 * dado à regra é o do setor (métodos gráficos ou imagem, que inclui a endoscopia e os demais laudos médicos).
 */
export function conferirAssinante(v: VinculoProfissional | null, tipoSetor: string): void {
  const ato = tipoSetor === 'metodos_graficos' ? ATO_METODOS_GRAFICOS : ATO_IMAGEM;
  const r = podeLaudar(ato, v);
  if (r.pode) return;
  const codigo = !v ? 'sem-vinculo' : !v.conselhoAtivo ? 'conselho-inativo' : 'laudo-privativo-medico';
  throw new RecusaLaudo(codigo, r.motivo ?? 'O vínculo da sessão não pode assinar este laudo.');
}
/** Atos do vocabulário do SADT usados para a regra única (ambos privativos de médico). */
const ATO_IMAGEM = 42;
const ATO_METODOS_GRAFICOS = 90;

/** Situações do exame em que ele já foi feito (há o que laudar). */
const REALIZADO: ReadonlySet<string> = new Set([
  'coletado',
  'em_analise',
  'resultado_digitado',
  'revisado',
  'liberado',
  'entregue',
]);

/**
 * O laudo só se redige e assina para o exame realizado: o pedido ainda não feito (solicitado, autorizado, agendado) e o
 * cancelado ou recusado são recusados. A marca de realização (`realizadoEm`) basta mesmo se a situação ficou atrás.
 */
export function conferirExameParaLaudo(situacao: string, realizadoEm: string | null): void {
  if (situacao === 'cancelado' || situacao === 'recusado')
    throw new RecusaLaudo('exame-cancelado', 'O exame foi cancelado ou recusado: não há laudo a escrever.');
  if (!REALIZADO.has(situacao) && !realizadoEm)
    throw new RecusaLaudo(
      'exame-nao-realizado',
      'O exame ainda não foi realizado: registre a realização antes de laudar.',
    );
}

/**
 * A data de referência do exame (AAAA-MM-DD), que escolhe a faixa vigente e a idade do paciente: a da realização, senão
 * a da coleta, senão a do pedido. O laudo redigido ou retificado dias depois continua avaliado pelo dia do exame.
 */
export function dataDoExame(realizado: string | null, coletado: string | null, pedido: string): string {
  return (realizado ?? coletado ?? pedido).slice(0, 10);
}

/**
 * Quem retifica o laudo assinado: o próprio laudista da versão vigente, ou o responsável vigente do setor pelos laudos
 * (coordenação: assina, revisa ou é responsável técnico). Outro médico, mesmo habilitado, não muda o laudo de um colega.
 */
export function conferirRetificador(
  laudistaAtual: number | null,
  profissional: number,
  responsavelDoSetor: boolean,
): void {
  if (laudistaAtual !== null && laudistaAtual !== profissional && !responsavelDoSetor)
    throw new RecusaLaudo(
      'retificacao-de-outro-laudista',
      'Só o médico que assinou o laudo, ou o responsável do setor pelos laudos, pode retificá-lo.',
    );
}

/**
 * Quem altera um modelo de laudo: o modelo pessoal só pelo dono (nem vira modelo do estabelecimento, nem muda de dono);
 * o modelo do estabelecimento, por quem tem a permissão da tela.
 */
export function conferirDonoDoModelo(donoAtual: number | null, profissional: number | null): void {
  if (donoAtual !== null && donoAtual !== profissional)
    throw new RecusaLaudo(
      'modelo-de-outro-profissional',
      'Este modelo é pessoal de outro médico e não pode ser alterado.',
    );
}

/** O número da próxima versão (a primeira assinatura é a 1). */
export function proximaVersao(versoes: readonly number[]): number {
  return versoes.length === 0 ? 1 : Math.max(...versoes) + 1;
}

/** Campos variáveis do modelo: `{{nome}}` no texto. */
const CAMPO = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

/**
 * Aplica o modelo de laudo: troca cada `{{campo}}` pelo valor dado (as medidas do laudo estruturado, o nome do exame) e
 * devolve os campos que ficaram sem valor, que a tela destaca para o médico completar. Nada é inventado: o campo sem
 * valor fica marcado como `[campo]` no texto.
 */
export function aplicarModelo(
  modelo: string,
  valores: Readonly<Record<string, string | number | null | undefined>>,
): { texto: string; faltam: string[] } {
  const faltam: string[] = [];
  const texto = modelo.replace(CAMPO, (_t, campo: string) => {
    const v = valores[campo];
    if (v === null || v === undefined || v === '') {
      if (!faltam.includes(campo)) faltam.push(campo);
      return `[${campo}]`;
    }
    return String(v);
  });
  return { texto, faltam };
}

/** Os campos variáveis de um modelo, na ordem em que aparecem (sem repetir). */
export function camposDoModelo(modelo: string): string[] {
  const r: string[] = [];
  for (const m of modelo.matchAll(CAMPO)) if (!r.includes(m[1]!)) r.push(m[1]!);
  return r;
}

/** O modelo que a tela sugere primeiro: o do próprio médico para o exame, depois o do exame, depois o do setor. */
export function ordenarModelos<
  T extends { exame: number | null; setor: number | null; profissional: number | null; nome: string },
>(modelos: readonly T[], alvo: { exame: number; setor: number; profissional: number | null }): T[] {
  const peso = (m: T) =>
    (m.profissional !== null && m.profissional === alvo.profissional ? 0 : m.profissional === null ? 1 : 9) *
      10 +
    (m.exame === alvo.exame
      ? 0
      : m.exame === null
        ? m.setor === alvo.setor || m.setor === null
          ? 1
          : 9
        : 9);
  return modelos
    .filter((m) => peso(m) < 90 && (m.exame === null || m.exame === alvo.exame))
    .filter((m) => m.setor === null || m.setor === alvo.setor)
    .filter((m) => m.profissional === null || m.profissional === alvo.profissional)
    .sort((a, b) => peso(a) - peso(b) || a.nome.localeCompare(b.nome, 'pt-BR'));
}
