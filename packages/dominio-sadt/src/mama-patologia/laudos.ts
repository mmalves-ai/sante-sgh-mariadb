// Laudos estruturados de mamografia e de anatomia patológica (F7, 05-SADT linha 18). A regra é a mesma na tela
// (validação na hora) e no servidor (antes de gravar):
//   - mamografia: composição da mama e categoria final por mama no sistema padronizado de laudo mamário (categorias 0
//     a 6, com 4A, 4B e 4C; Colégio Brasileiro de Radiologia e Colégio Americano de Radiologia), achados por mama e
//     quadrante e a recomendação que decorre da categoria mais grave (a mesma tabela que o SISCAN, do INCA, usa no
//     resultado de mamografia). A categoria final da mama nunca é menos grave que a do achado mais grave dela;
//   - anatomia patológica (citopatologia, histopatologia, imuno-histoquímica, congelação, revisão de lâmina): amostras
//     identificadas, macroscopia e microscopia, adequabilidade da amostra no exame citológico, resultado, grau
//     histológico do tumor maligno e os achados estruturados (margens, invasão, linfonodos, receptores).
// Rascunho confere só a coerência do que foi preenchido; a liberação confere o laudo completo.
// Quem libera é o médico da sessão, com inscrição ativa no conselho (autoria: CFM e SBIS); o laudo liberado só muda por
// retificação com motivo, que o deixa no histórico e abre um laudo novo ligado a ele.

import { ehMedico, type VinculoProfissional } from '@sgh/contratos';

export const TIPOS_MAMOGRAFIA = ['rastreamento', 'diagnostica'] as const;
export const COMPOSICOES_MAMA = [
  'adiposa',
  'fibroglandular_esparsa',
  'heterogeneamente_densa',
  'extremamente_densa',
] as const;
export const RECOMENDACOES_MAMA = [
  'rotina',
  'controle_radiologico',
  'complementacao',
  'biopsia',
  'tratamento',
] as const;
export const LATERALIDADES_MAMA = ['direita', 'esquerda'] as const;
export const QUADRANTES_MAMA = [
  'superior_lateral',
  'superior_medial',
  'inferior_lateral',
  'inferior_medial',
  'central',
  'retroareolar',
  'prolongamento_axilar',
  'axila',
] as const;
export const TIPOS_ACHADO_MAMA = [
  'nodulo',
  'calcificacao',
  'assimetria',
  'assimetria_focal',
  'assimetria_global',
  'distorcao_arquitetural',
  'linfonodo',
  'implante',
  'dilatacao_ductal',
  'achado_benigno',
  'outro',
] as const;
export const FORMAS_ACHADO_MAMA = ['oval', 'redonda', 'irregular'] as const;
export const CONTORNOS_ACHADO_MAMA = [
  'circunscrito',
  'microlobulado',
  'obscurecido',
  'indistinto',
  'espiculado',
] as const;
export const DENSIDADES_ACHADO_MAMA = ['alta', 'igual', 'baixa', 'contendo_gordura'] as const;
export const DISTRIBUICOES_CALCIFICACAO = ['difusa', 'regional', 'agrupada', 'linear', 'segmentar'] as const;

/** Categoria final, recomendação e intervalo de seguimento (meses) da tabela padronizada. */
export const CATEGORIAS_MAMA = [
  { categoria: '0', recomendacao: 'complementacao', intervaloMeses: null, rotulo: 'Inconclusivo' },
  { categoria: '1', recomendacao: 'rotina', intervaloMeses: 12, rotulo: 'Negativo' },
  { categoria: '2', recomendacao: 'rotina', intervaloMeses: 12, rotulo: 'Achado benigno' },
  {
    categoria: '3',
    recomendacao: 'controle_radiologico',
    intervaloMeses: 6,
    rotulo: 'Provavelmente benigno',
  },
  { categoria: '4', recomendacao: 'biopsia', intervaloMeses: null, rotulo: 'Suspeito' },
  { categoria: '4A', recomendacao: 'biopsia', intervaloMeses: null, rotulo: 'Baixa suspeita' },
  { categoria: '4B', recomendacao: 'biopsia', intervaloMeses: null, rotulo: 'Suspeita intermediária' },
  { categoria: '4C', recomendacao: 'biopsia', intervaloMeses: null, rotulo: 'Alta suspeita' },
  { categoria: '5', recomendacao: 'biopsia', intervaloMeses: null, rotulo: 'Altamente suspeito' },
  { categoria: '6', recomendacao: 'tratamento', intervaloMeses: null, rotulo: 'Malignidade comprovada' },
] as const;
export type CategoriaMama = (typeof CATEGORIAS_MAMA)[number]['categoria'];

/** Ordem de gravidade para a categoria final (a mais grave prevalece): 1 < 2 < 3 < 6 < 0 < 4 < 4A < 4B < 4C < 5. */
const GRAVIDADE: readonly string[] = ['1', '2', '3', '6', '0', '4', '4A', '4B', '4C', '5'];

export const ehCategoriaMama = (v: string | null): v is CategoriaMama =>
  v !== null && CATEGORIAS_MAMA.some((c) => c.categoria === v);

export function gravidadeCategoria(c: string): number {
  return GRAVIDADE.indexOf(c);
}

/** A categoria mais grave da lista (vazia ou sem categoria válida: null). */
export function categoriaMaisGrave(lista: readonly (string | null)[]): CategoriaMama | null {
  let pior: CategoriaMama | null = null;
  for (const c of lista)
    if (ehCategoriaMama(c) && (pior === null || gravidadeCategoria(c) > gravidadeCategoria(pior))) pior = c;
  return pior;
}

/** A recomendação e o intervalo que decorrem da categoria (sugestão da tela e regra da liberação). */
export function condutaDaCategoria(
  c: string | null,
): { recomendacao: (typeof RECOMENDACOES_MAMA)[number]; intervaloMeses: number | null } | null {
  const k = CATEGORIAS_MAMA.find((x) => x.categoria === c);
  return k ? { recomendacao: k.recomendacao, intervaloMeses: k.intervaloMeses } : null;
}

export interface AchadoMama {
  readonly lateralidade: string;
  readonly quadrante: string | null;
  readonly tipo: string;
  readonly categoria: string | null;
  readonly tamanhoMm: number | null;
  readonly posicaoHoraria: number | null;
  readonly distanciaMamiloMm: number | null;
  readonly forma: string | null;
  readonly contorno: string | null;
  readonly densidade: string | null;
  readonly morfologiaCalcificacao: string | null;
  readonly distribuicaoCalcificacao: string | null;
  readonly correlacaoUltrassom: boolean;
  readonly descricao: string | null;
}

export interface LaudoMama {
  readonly tipoMamografia: string;
  readonly noduloPalpavel: boolean;
  readonly historicoFamiliar: boolean;
  readonly mamografiaAnterior: boolean;
  readonly mamografiaAnteriorAno: number | null;
  readonly composicaoDireita: string | null;
  readonly composicaoEsquerda: string | null;
  readonly categoriaDireita: string | null;
  readonly categoriaEsquerda: string | null;
  readonly recomendacao: string | null;
  readonly intervaloControleMeses: number | null;
  readonly conclusao: string | null;
  readonly laudista: number | null;
  readonly achados: readonly AchadoMama[];
}
export interface ProblemaLaudo {
  readonly campo: string;
  readonly mensagem: string;
}

export type ModoLaudo = 'rascunho' | 'liberar';

const vazio = (v: string | null | undefined) => v === null || v === undefined || v.trim() === '';
const em = (lista: readonly string[], v: string | null): boolean => v === null || lista.includes(v);
const foraDe = (v: number | null, min: number, max: number) =>
  v !== null && (!Number.isFinite(v) || v < min || v > max);

function conferirAchadoMama(a: AchadoMama, i: number, modo: ModoLaudo): ProblemaLaudo[] {
  const p: ProblemaLaudo[] = [];
  const c = (campo: string, mensagem: string) =>
    p.push({ campo: `achados.${i}.${campo}`, mensagem: `Achado ${i + 1}: ${mensagem}` });
  if (!em(LATERALIDADES_MAMA, a.lateralidade) || vazio(a.lateralidade)) c('lateralidade', 'informe a mama.');
  if (!em(QUADRANTES_MAMA, a.quadrante)) c('quadrante', 'quadrante inválido.');
  if (!em(TIPOS_ACHADO_MAMA, a.tipo) || vazio(a.tipo)) c('tipo', 'tipo de achado inválido.');
  if (a.categoria !== null && !ehCategoriaMama(a.categoria)) c('categoria', 'categoria inválida.');
  if (foraDe(a.tamanhoMm, 0.1, 999)) c('tamanhoMm', 'o tamanho vai de 0,1 a 999 mm.');
  if (a.posicaoHoraria !== null && (!Number.isInteger(a.posicaoHoraria) || foraDe(a.posicaoHoraria, 1, 12)))
    c('posicaoHoraria', 'a posição vai de 1 a 12 horas.');
  if (foraDe(a.distanciaMamiloMm, 0, 999)) c('distanciaMamiloMm', 'a distância do mamilo vai de 0 a 999 mm.');
  if (!em(FORMAS_ACHADO_MAMA, a.forma)) c('forma', 'forma inválida.');
  if (!em(CONTORNOS_ACHADO_MAMA, a.contorno)) c('contorno', 'contorno inválido.');
  if (!em(DENSIDADES_ACHADO_MAMA, a.densidade)) c('densidade', 'densidade inválida.');
  if (!em(DISTRIBUICOES_CALCIFICACAO, a.distribuicaoCalcificacao))
    c('distribuicaoCalcificacao', 'distribuição inválida.');
  if (a.tipo !== 'nodulo' && (a.forma !== null || a.contorno !== null || a.densidade !== null))
    c('forma', 'forma, contorno e densidade descrevem só o nódulo.');
  if (a.tipo !== 'calcificacao' && (a.morfologiaCalcificacao !== null || a.distribuicaoCalcificacao !== null))
    c('morfologiaCalcificacao', 'morfologia e distribuição descrevem só a calcificação.');
  if (a.morfologiaCalcificacao && a.morfologiaCalcificacao.trim().length > 60)
    c('morfologiaCalcificacao', 'a morfologia tem no máximo 60 caracteres.');
  if (modo === 'liberar') {
    if (a.categoria === null) c('categoria', 'informe a categoria do achado.');
    if (a.tipo === 'nodulo') {
      if (a.forma === null) c('forma', 'o nódulo exige a forma.');
      if (a.contorno === null) c('contorno', 'o nódulo exige o contorno.');
      if (a.tamanhoMm === null) c('tamanhoMm', 'o nódulo exige o tamanho.');
    }
    if (a.tipo === 'calcificacao') {
      if (vazio(a.morfologiaCalcificacao)) c('morfologiaCalcificacao', 'a calcificação exige a morfologia.');
      if (a.distribuicaoCalcificacao === null)
        c('distribuicaoCalcificacao', 'a calcificação exige a distribuição.');
    }
    if (
      a.quadrante === null &&
      a.posicaoHoraria === null &&
      a.tipo !== 'implante' &&
      a.tipo !== 'assimetria_global'
    )
      c('quadrante', 'localize o achado pelo quadrante ou pela posição em horas.');
  }
  return p;
}

/** Confere o laudo de mamografia; lista vazia: pode gravar (rascunho) ou liberar. */
export function conferirLaudoMama(l: LaudoMama, modo: ModoLaudo, anoAtual: number): ProblemaLaudo[] {
  const p: ProblemaLaudo[] = [];
  const c = (campo: string, mensagem: string) => p.push({ campo, mensagem });
  if (!em(TIPOS_MAMOGRAFIA, l.tipoMamografia) || vazio(l.tipoMamografia))
    c('tipoMamografia', 'Tipo de mamografia inválido.');
  if (!em(COMPOSICOES_MAMA, l.composicaoDireita))
    c('composicaoDireita', 'Composição da mama direita inválida.');
  if (!em(COMPOSICOES_MAMA, l.composicaoEsquerda))
    c('composicaoEsquerda', 'Composição da mama esquerda inválida.');
  if (l.categoriaDireita !== null && !ehCategoriaMama(l.categoriaDireita))
    c('categoriaDireita', 'Categoria da mama direita inválida.');
  if (l.categoriaEsquerda !== null && !ehCategoriaMama(l.categoriaEsquerda))
    c('categoriaEsquerda', 'Categoria da mama esquerda inválida.');
  if (!em(RECOMENDACOES_MAMA, l.recomendacao)) c('recomendacao', 'Recomendação inválida.');
  if (l.mamografiaAnteriorAno !== null) {
    if (!l.mamografiaAnterior)
      c('mamografiaAnteriorAno', 'O ano da mamografia anterior pede a marca de mamografia anterior.');
    else if (!Number.isInteger(l.mamografiaAnteriorAno) || foraDe(l.mamografiaAnteriorAno, 1960, anoAtual))
      c('mamografiaAnteriorAno', `O ano da mamografia anterior vai de 1960 a ${anoAtual}.`);
  }
  if (
    l.intervaloControleMeses !== null &&
    (!Number.isInteger(l.intervaloControleMeses) || foraDe(l.intervaloControleMeses, 1, 36))
  )
    c('intervaloControleMeses', 'O intervalo de controle vai de 1 a 36 meses.');
  if (l.conclusao && l.conclusao.length > 8000) c('conclusao', 'A conclusão tem no máximo 8.000 caracteres.');
  if (l.achados.length > 40) c('achados', 'No máximo 40 achados por laudo.');
  l.achados.forEach((a, i) => p.push(...conferirAchadoMama(a, i, modo)));
  // A categoria final da mama nunca é menos grave que a do achado mais grave dela.
  for (const lado of LATERALIDADES_MAMA) {
    const final = lado === 'direita' ? l.categoriaDireita : l.categoriaEsquerda;
    const pior = categoriaMaisGrave(l.achados.filter((a) => a.lateralidade === lado).map((a) => a.categoria));
    const campo = lado === 'direita' ? 'categoriaDireita' : 'categoriaEsquerda';
    if (ehCategoriaMama(final) && pior !== null && gravidadeCategoria(final) < gravidadeCategoria(pior))
      c(campo, `A categoria final da mama ${lado} (${final}) é menos grave que a do achado (${pior}).`);
    if (modo === 'liberar' && final === null && l.achados.some((a) => a.lateralidade === lado))
      c(campo, `A mama ${lado} tem achado: informe a categoria final dela.`);
  }
  if (modo === 'liberar') {
    if (l.categoriaDireita === null && l.categoriaEsquerda === null)
      c('categoriaDireita', 'Informe a categoria final de ao menos uma mama.');
    if (l.categoriaDireita !== null && l.composicaoDireita === null)
      c('composicaoDireita', 'Informe a composição da mama direita.');
    if (l.categoriaEsquerda !== null && l.composicaoEsquerda === null)
      c('composicaoEsquerda', 'Informe a composição da mama esquerda.');
    const esperada = condutaDaCategoria(categoriaMaisGrave([l.categoriaDireita, l.categoriaEsquerda]));
    if (l.recomendacao === null) c('recomendacao', 'Informe a recomendação.');
    else if (esperada && esperada.recomendacao !== l.recomendacao)
      c('recomendacao', `A categoria mais grave pede a recomendação "${esperada.recomendacao}".`);
    if (l.recomendacao === 'controle_radiologico' && l.intervaloControleMeses === null)
      c('intervaloControleMeses', 'O controle radiológico exige o intervalo em meses.');
    if (vazio(l.conclusao)) c('conclusao', 'Informe a conclusão do laudo.');
    if (l.laudista === null) c('laudista', 'Informe o médico que assina o laudo.');
  }
  return p;
}

/** Alertas do laudo de mamografia (avisos, não impedem a gravação). */
export function alertasLaudoMama(
  l: Pick<
    LaudoMama,
    | 'tipoMamografia'
    | 'noduloPalpavel'
    | 'composicaoDireita'
    | 'composicaoEsquerda'
    | 'categoriaDireita'
    | 'categoriaEsquerda'
  >,
): string[] {
  const a: string[] = [];
  const pior = categoriaMaisGrave([l.categoriaDireita, l.categoriaEsquerda]);
  if (pior !== null && gravidadeCategoria(pior) >= gravidadeCategoria('4'))
    a.push(`Categoria ${pior}: achado suspeito, a paciente precisa de biópsia (acompanhar o seguimento).`);
  if (pior === '0') a.push('Categoria 0: o exame é inconclusivo e pede avaliação complementar.');
  if (l.tipoMamografia === 'rastreamento' && l.noduloPalpavel)
    a.push('Nódulo palpável em exame de rastreamento: o indicado é a mamografia diagnóstica.');
  if (l.composicaoDireita === 'extremamente_densa' || l.composicaoEsquerda === 'extremamente_densa')
    a.push(
      'Mama extremamente densa: a sensibilidade da mamografia é menor; considere complementar com ultrassom.',
    );
  return a;
}

// ── Anatomia patológica ─────────────────────────────────────────────────────────────────────────────────────

export const TIPOS_EXAME_ANATOMOPATOLOGICO = [
  'citopatologia',
  'histopatologia',
  'imuno_histoquimica',
  'congelacao',
  'revisao_lamina',
] as const;
export const ADEQUABILIDADES_AMOSTRA = ['satisfatoria', 'insatisfatoria', 'limitada'] as const;
export const RESULTADOS_ANATOMOPATOLOGICO = [
  'negativo',
  'benigno',
  'atipico',
  'suspeito',
  'maligno',
  'indeterminado',
] as const;
export const TIPOS_AMOSTRA_ANATOMOPATOLOGICA = [
  'peca',
  'fragmento',
  'bloco',
  'lamina',
  'esfregaco',
  'liquido',
] as const;
export const MARGENS_CIRURGICAS = ['livres', 'exiguas', 'comprometidas', 'nao_avaliaveis'] as const;
export const HER2_ESCORES = ['0', '1+', '2+', '3+'] as const;

export interface AmostraAnatomopatologica {
  readonly tipo: string;
  readonly identificacao: string;
  readonly descricao: string | null;
  readonly quantidadeFragmentos: number | null;
  readonly dimensoes: string | null;
  readonly fixador: string | null;
  readonly coloracao: string | null;
}

/** Achados estruturados do formulário (vão em dados_estruturados). */
export interface DadosEstruturadosAnatomopatologico {
  readonly margens?: string | null;
  readonly tamanhoTumorMm?: number | null;
  readonly invasaoAngiolinfatica?: boolean | null;
  readonly invasaoPerineural?: boolean | null;
  readonly linfonodosExaminados?: number | null;
  readonly linfonodosComprometidos?: number | null;
  readonly receptorEstrogenioPercentual?: number | null;
  readonly receptorProgesteronaPercentual?: number | null;
  readonly her2?: string | null;
  readonly ki67Percentual?: number | null;
}

export interface LaudoAnatomopatologico {
  readonly tipoExame: string;
  readonly coletaEm: string | null;
  readonly recebidoEm: string | null;
  readonly dadosClinicos: string | null;
  readonly macroscopia: string | null;
  readonly microscopia: string | null;
  readonly diagnostico: string | null;
  readonly conclusao: string | null;
  readonly grauHistologico: number | null;
  readonly adequabilidade: string | null;
  readonly resultado: string | null;
  readonly patologista: number | null;
  readonly dados: DadosEstruturadosAnatomopatologico;
  readonly amostras: readonly AmostraAnatomopatologica[];
}

const instante = (v: string | null) => (v ? Date.parse(v) : Number.NaN);

/** Confere o laudo anatomopatológico; lista vazia: pode gravar (rascunho) ou liberar. */
export function conferirLaudoAnatomopatologico(l: LaudoAnatomopatologico, modo: ModoLaudo): ProblemaLaudo[] {
  const p: ProblemaLaudo[] = [];
  const c = (campo: string, mensagem: string) => p.push({ campo, mensagem });
  if (!em(TIPOS_EXAME_ANATOMOPATOLOGICO, l.tipoExame) || vazio(l.tipoExame))
    c('tipoExame', 'Tipo de exame inválido.');
  if (!em(ADEQUABILIDADES_AMOSTRA, l.adequabilidade)) c('adequabilidade', 'Adequabilidade inválida.');
  if (!em(RESULTADOS_ANATOMOPATOLOGICO, l.resultado)) c('resultado', 'Resultado inválido.');
  if (l.coletaEm && Number.isNaN(instante(l.coletaEm))) c('coletaEm', 'Data da coleta inválida.');
  if (l.recebidoEm && Number.isNaN(instante(l.recebidoEm))) c('recebidoEm', 'Data do recebimento inválida.');
  if (l.coletaEm && l.recebidoEm && instante(l.recebidoEm) < instante(l.coletaEm))
    c('recebidoEm', 'O recebimento no laboratório não pode ser antes da coleta.');
  const d = l.dados;
  if (!em(MARGENS_CIRURGICAS, d.margens ?? null)) c('dados.margens', 'Margem inválida.');
  if (!em(HER2_ESCORES, d.her2 ?? null)) c('dados.her2', 'O escore HER2 vai de 0 a 3+.');
  for (const k of [
    'receptorEstrogenioPercentual',
    'receptorProgesteronaPercentual',
    'ki67Percentual',
  ] as const)
    if (foraDe(d[k] ?? null, 0, 100)) c(`dados.${k}`, 'O percentual vai de 0 a 100.');
  if (foraDe(d.tamanhoTumorMm ?? null, 0.1, 9999))
    c('dados.tamanhoTumorMm', 'O tamanho do tumor vai de 0,1 a 9.999 mm.');
  const ex = d.linfonodosExaminados ?? null;
  const cp = d.linfonodosComprometidos ?? null;
  if (foraDe(ex, 0, 500) || (ex !== null && !Number.isInteger(ex)))
    c('dados.linfonodosExaminados', 'Linfonodos examinados: número inteiro de 0 a 500.');
  if (foraDe(cp, 0, 500) || (cp !== null && !Number.isInteger(cp)))
    c('dados.linfonodosComprometidos', 'Linfonodos comprometidos: número inteiro de 0 a 500.');
  if (cp !== null && (ex === null || cp > ex))
    c('dados.linfonodosComprometidos', 'Os linfonodos comprometidos não passam dos examinados.');
  if (l.amostras.length > 60) c('amostras', 'No máximo 60 amostras por laudo.');
  const vistas = new Set<string>();
  l.amostras.forEach((a, i) => {
    const ca = (campo: string, m: string) => c(`amostras.${i}.${campo}`, `Amostra ${i + 1}: ${m}`);
    if (!em(TIPOS_AMOSTRA_ANATOMOPATOLOGICA, a.tipo) || vazio(a.tipo)) ca('tipo', 'tipo inválido.');
    const id = a.identificacao.trim().toUpperCase();
    if (!id || id.length > 30) ca('identificacao', 'identificação de 1 a 30 caracteres.');
    else if (vistas.has(id)) ca('identificacao', `a identificação ${id} está repetida.`);
    vistas.add(id);
    if (
      a.quantidadeFragmentos !== null &&
      (!Number.isInteger(a.quantidadeFragmentos) || foraDe(a.quantidadeFragmentos, 1, 999))
    )
      ca('quantidadeFragmentos', 'fragmentos de 1 a 999.');
  });
  if (modo === 'liberar') {
    if (l.patologista === null) c('patologista', 'Informe o patologista que assina o laudo.');
    if (vazio(l.diagnostico)) c('diagnostico', 'Informe o diagnóstico.');
    if (l.resultado === null) c('resultado', 'Informe o resultado.');
    if (l.amostras.length === 0) c('amostras', 'Registre ao menos uma amostra recebida.');
    if (l.recebidoEm === null) c('recebidoEm', 'Informe quando a amostra chegou ao laboratório.');
    if (l.tipoExame === 'citopatologia' && l.adequabilidade === null)
      c('adequabilidade', 'O exame citológico exige a adequabilidade da amostra.');
    if (l.adequabilidade === 'insatisfatoria' && l.resultado !== null && l.resultado !== 'indeterminado')
      c('resultado', 'Amostra insatisfatória só admite o resultado indeterminado.');
    if (l.tipoExame === 'histopatologia' || l.tipoExame === 'congelacao') {
      if (vazio(l.macroscopia)) c('macroscopia', 'Informe a macroscopia.');
      if (vazio(l.microscopia)) c('microscopia', 'Informe a microscopia.');
    }
    if (l.tipoExame === 'histopatologia' && l.resultado === 'maligno' && l.grauHistologico === null)
      c(
        'grauHistologico',
        'O tumor maligno exige o grau histológico (use "não avaliável" quando for o caso).',
      );
  }
  return p;
}

/** Alertas do laudo anatomopatológico (avisos, não impedem a gravação). */
export function alertasLaudoAnatomopatologico(
  l: Pick<LaudoAnatomopatologico, 'resultado' | 'adequabilidade' | 'dados'>,
): string[] {
  const a: string[] = [];
  if (l.resultado === 'maligno')
    a.push('Resultado maligno: comunique o médico solicitante (resultado crítico) e registre o aviso.');
  if (l.resultado === 'suspeito') a.push('Resultado suspeito: indique a investigação complementar.');
  if (l.dados.margens === 'comprometidas') a.push('Margem cirúrgica comprometida.');
  if (l.adequabilidade === 'insatisfatoria') a.push('Amostra insatisfatória: a coleta precisa ser repetida.');
  return a;
}

/** A amostra mudou (o campo a campo que a tela grava). */
export function amostraMudou(a: AmostraAnatomopatologica, b: AmostraAnatomopatologica): boolean {
  const k = ['tipo', 'descricao', 'quantidadeFragmentos', 'dimensoes', 'fixador', 'coloracao'] as const;
  return (
    a.identificacao.trim().toUpperCase() !== b.identificacao.trim().toUpperCase() ||
    k.some((x) => a[x] !== b[x])
  );
}

/** O achado mudou (o mudado fica no histórico e o novo entra com a sequência seguinte). */
export function achadoMamaMudou(a: AchadoMama, b: AchadoMama): boolean {
  return (Object.keys(b) as (keyof AchadoMama)[]).some((k) => a[k] !== b[k]);
}

/**
 * A ficha do resultado de mamografia no formato de campos do SISCAN (INCA): para a digitação ou a transmissão ao
 * sistema do SUS. Mama sem categoria fica "não avaliada".
 */
export function fichaSiscanMamografia(l: LaudoMama & { readonly liberadoEm: string | null }) {
  const mama = (lado: 'direita' | 'esquerda') => {
    const cat = lado === 'direita' ? l.categoriaDireita : l.categoriaEsquerda;
    const achados = l.achados.filter((a) => a.lateralidade === lado);
    return {
      avaliada: cat !== null,
      composicao: lado === 'direita' ? l.composicaoDireita : l.composicaoEsquerda,
      categoria: cat,
      nodulos: achados.filter((a) => a.tipo === 'nodulo').length,
      microcalcificacoes: achados.filter((a) => a.tipo === 'calcificacao').length,
      assimetrias: achados.filter((a) => a.tipo.startsWith('assimetria')).length,
      distorcaoArquitetural: achados.some((a) => a.tipo === 'distorcao_arquitetural'),
      linfonodoAxilar: achados.some((a) => a.tipo === 'linfonodo'),
    };
  };
  return {
    indicacao: l.tipoMamografia === 'rastreamento' ? 'rastreamento' : 'diagnostica',
    noduloPalpavel: l.noduloPalpavel,
    riscoElevadoHistoricoFamiliar: l.historicoFamiliar,
    mamografiaAnterior: l.mamografiaAnterior,
    mamografiaAnteriorAno: l.mamografiaAnteriorAno,
    direita: mama('direita'),
    esquerda: mama('esquerda'),
    recomendacao: l.recomendacao,
    intervaloControleMeses: l.intervaloControleMeses,
    liberadoEm: l.liberadoEm,
  };
}

/**
 * Quem assina o laudo de mamografia ou o anatomopatológico é o profissional da sessão: médico (CBO da família 225),
 * com a inscrição no conselho ativa. Se o rascunho indica outro profissional, a liberação é recusada (ninguém assina
 * pelo outro). `campo` é o da tela ('laudista' ou 'patologista').
 */
export interface AutorLaudo extends VinculoProfissional {
  readonly profissional: number;
}

export function conferirAutorLaudo(
  v: AutorLaudo | null,
  indicado: number | null,
  campo: 'laudista' | 'patologista',
): ProblemaLaudo[] {
  if (!v)
    return [
      { campo, mensagem: 'A sua conta não tem vínculo com profissional: só o médico do laudo o libera.' },
    ];
  if (!ehMedico(v.cbo))
    return [{ campo, mensagem: 'O laudo é privativo de médico: a sua ocupação não o assina.' }];
  if (!v.conselhoAtivo)
    return [
      { campo, mensagem: 'A sua inscrição no conselho não está ativa: o laudo não pode ser assinado.' },
    ];
  if (indicado !== null && indicado !== v.profissional)
    return [{ campo, mensagem: 'O laudo indica outro médico: só ele o libera, ou troque para você.' }];
  return [];
}

/** Motivo da retificação: ao menos 10 caracteres. */
export const MOTIVO_RETIFICACAO_MINIMO = 10;

/** Só o laudo liberado se retifica, e com motivo; o retificado fica no histórico e o novo nasce em rascunho. */
export function conferirRetificacaoEspecializado(situacao: string, motivo: string | null): ProblemaLaudo[] {
  const p: ProblemaLaudo[] = [];
  if (situacao !== 'liberado')
    p.push({ campo: 'situacao', mensagem: 'Só o laudo liberado se retifica; o rascunho se corrige direto.' });
  if ((motivo ?? '').trim().length < MOTIVO_RETIFICACAO_MINIMO)
    p.push({
      campo: 'motivo',
      mensagem: `Diga o motivo da retificação (ao menos ${MOTIVO_RETIFICACAO_MINIMO} caracteres).`,
    });
  return p;
}

/** Número do laudo anatomopatológico retificado: o mesmo número com a ordem da retificação (AP-12 → AP-12-R1). */
export function numeroRetificacao(numero: string, ordem: number): string {
  return `${numero.replace(/-R\d+$/, '')}-R${ordem}`;
}
