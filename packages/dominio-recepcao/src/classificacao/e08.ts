// A classificação no formulário de classificação do prontuário (modelo E08; ficha do M44, seção 5 e regra 7): o
// prontuário é um só, e o médico que abre o paciente pelo formulário continua vendo a classificação ali. As respostas
// vão pelo registro clínico do M22 (pep.registrarEvolucao), só nas perguntas ativas do modelo (14 de 25; ref 04 §2):
// queixa, sinais vitais, "Prioridade clínica" e observações. A cor vira a opção de "Prioridade clínica" pelo de-para
// da versão do protocolo (aprovado pela enfermagem) e só com índice já visto no perfil; cor sem opção equivalente
// grava só no novo e a tela avisa que o prontuário mostrará "sem prioridade".
// Os vínculos e índices não são fixos no código: saem do modelo convertido do estabelecimento (CampoRegistro do M22),
// achados pelo título da pergunta; o modelo sem uma das perguntas esperadas não recebe a classificação.
import type {
  CampoRegistro,
  ComorbidadeClassificacao,
  CorProtocolo,
  CorRisco,
  RespostaRegistro,
  SinaisClassificacao,
  ValorResposta,
} from '@sgh/contratos';
import { CORES_RISCO } from '@sgh/contratos';

/** Perguntas do formulário que a classificação preenche, pelo título normalizado (sem acento, minúsculas). */
export const PERGUNTAS_E08 = {
  queixa: 'queixa principal',
  pa: 'pa',
  fc: 'fc',
  temperatura: 'temperatura',
  fr: 'fr',
  glicemia: 'hgt',
  saturacao: 'saturacao',
  alergia: 'alergias',
  comorbidades: 'comorbidade previas',
  prioridade: 'prioridade clinica',
  observacoes: 'observacoes',
} as const;
export type PerguntaE08 = keyof typeof PERGUNTAS_E08;

/** As obrigatórias para gravar: sem elas o modelo do estabelecimento não é o esperado. */
const OBRIGATORIAS: readonly PerguntaE08[] = ['queixa', 'pa', 'fc', 'fr', 'saturacao', 'prioridade'];

export function normalizarTitulo(t: string): string {
  return t
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CampoE08 {
  readonly vinculo: number;
  readonly tipo: CampoRegistro['tipo'];
  readonly opcoes: CampoRegistro['opcoes'];
}

export type MapaE08 = Readonly<Partial<Record<PerguntaE08, CampoE08>>>;

function folhas(campos: readonly CampoRegistro[]): CampoRegistro[] {
  return campos.flatMap((c) => (c.itens.length > 0 ? [c, ...folhas(c.itens)] : [c]));
}

/** As perguntas da classificação no modelo convertido (a primeira com o título; seções e sem campo ignoradas). */
export function mapaDoModeloE08(campos: readonly CampoRegistro[]): { mapa: MapaE08; faltam: PerguntaE08[] } {
  const mapa: Partial<Record<PerguntaE08, CampoE08>> = {};
  const todos = folhas(campos).filter((c) => c.tipo !== 'secao' && c.tipo !== 'sem-campo');
  for (const [chave, titulo] of Object.entries(PERGUNTAS_E08) as [PerguntaE08, string][]) {
    const c = todos.find((x) => normalizarTitulo(x.titulo) === titulo);
    if (c) mapa[chave] = { vinculo: c.vinculo, tipo: c.tipo, opcoes: c.opcoes };
  }
  return { mapa, faltam: OBRIGATORIAS.filter((k) => !mapa[k]) };
}

/** A cor reconhecida no texto da opção ("Urgente- Amarelo" → amarelo); null se nenhuma ou mais de uma. */
export function corDoTextoDaOpcao(texto: string): CorRisco | null {
  const t = normalizarTitulo(texto);
  const achadas = CORES_RISCO.filter((c) => new RegExp(`\\b${c.codigo}\\b`).test(t));
  return achadas.length === 1 ? achadas[0]!.codigo : null;
}

/**
 * Proposta de de-para cor → índice da opção pelo texto das opções do modelo (a enfermagem aprova na versão do
 * protocolo; só os índices já vistos no perfil entram). Cor sem opção reconhecida fica null.
 */
export function proporDeParaE08(
  prioridade: CampoE08 | undefined,
  indicesVistos: ReadonlySet<number>,
): Record<CorRisco, number | null> {
  const r = Object.fromEntries(CORES_RISCO.map((c) => [c.codigo, null])) as Record<CorRisco, number | null>;
  for (const o of prioridade?.opcoes ?? []) {
    const cor = corDoTextoDaOpcao(o.texto);
    if (cor && indicesVistos.has(o.indice) && r[cor] === null) r[cor] = o.indice;
  }
  return r;
}

export interface EntradaE08 {
  readonly cor: CorRisco;
  /** O de-para da versão do protocolo (opcaoE08 por cor). */
  readonly cores: readonly Pick<CorProtocolo, 'cor' | 'opcaoE08'>[];
  readonly sinais: SinaisClassificacao;
  readonly queixa: string;
  readonly observacoes: string | null;
  /** Alergia relatada (Sim/Não); a lista de alergias fica no cadastro de alergias do PEP. */
  readonly alergia?: 'sim' | 'nao' | null;
  readonly comorbidades?: readonly ComorbidadeClassificacao[];
}

export type ResultadoE08 =
  | {
      readonly situacao: 'respostas';
      readonly respostas: RespostaRegistro[];
      /** A cor tem opção vista no perfil (false: grava o formulário sem prioridade e a tela avisa). */
      readonly comPrioridade: boolean;
    }
  | { readonly situacao: 'modelo-diferente'; readonly faltam: readonly PerguntaE08[] };

const decimal = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

function valorNumerico(campo: CampoE08, v: number): ValorResposta {
  return campo.tipo === 'quantidade' ? { tipo: 'numero', valor: v } : { tipo: 'texto', texto: decimal(v) };
}

/**
 * As respostas do formulário para a classificação. Pergunta opcional sem valor (a glicemia não medida) não vai:
 * o cenário de assinatura `e08-sem-glicemia` prova que o formulário fica como o do enfermeiro que não a mediu.
 */
export function respostasE08(
  entrada: EntradaE08,
  mapa: MapaE08,
  indicesVistos: ReadonlySet<number>,
  faltam: readonly PerguntaE08[] = [],
): ResultadoE08 {
  if (faltam.length > 0) return { situacao: 'modelo-diferente', faltam };
  const r: RespostaRegistro[] = [];
  const add = (k: PerguntaE08, valor: ValorResposta | null) => {
    const c = mapa[k];
    if (c && valor) r.push({ vinculo: c.vinculo, valor, autopreenchido: false, confirmado: false });
  };
  const s = entrada.sinais;
  add('queixa', { tipo: 'texto', texto: entrada.queixa });
  add('pa', s.pas !== null && s.pad !== null ? { tipo: 'texto', texto: `${s.pas}/${s.pad}` } : null);
  for (const k of ['fc', 'temperatura', 'fr', 'glicemia', 'saturacao'] as const) {
    const v = s[k];
    const c = mapa[k];
    add(k, v !== null && c ? valorNumerico(c, v) : null);
  }
  const alergia = mapa.alergia?.opcoes.find((o) => normalizarTitulo(o.texto) === entrada.alergia);
  add('alergia', alergia ? { tipo: 'escolha', indice: alergia.indice } : null);
  const marcadas = (mapa.comorbidades?.opcoes ?? [])
    .filter((o) => (entrada.comorbidades ?? []).some((c) => normalizarTitulo(o.texto) === c))
    .map((o) => o.indice);
  add('comorbidades', marcadas.length > 0 ? { tipo: 'multipla', indices: marcadas } : null);
  const indice = entrada.cores.find((c) => c.cor === entrada.cor)?.opcaoE08 ?? null;
  const prioridade = mapa.prioridade;
  const valido =
    indice !== null &&
    indicesVistos.has(indice) &&
    (prioridade?.opcoes.some((o) => o.indice === indice) ?? false);
  add('prioridade', valido ? { tipo: 'escolha', indice: indice } : null);
  add(
    'observacoes',
    entrada.observacoes?.trim() ? { tipo: 'texto', texto: entrada.observacoes.trim() } : null,
  );
  return { situacao: 'respostas', respostas: r, comPrioridade: valido };
}
