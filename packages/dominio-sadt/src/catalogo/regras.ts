// Manutenção do catálogo de exames do diagnóstico (F3.5, linhas 1 a 3 da análise 05-SADT): o exame (laboratório,
// imagem, métodos gráficos), onde é feito, o material, o preparo, a lateralidade, os exames ligados, os analitos do
// exame, a faixa de referência com versão e a fórmula de cálculo. Regras puras: a porta só grava o que passa aqui.
// Desenho próprio:
//   - a faixa de referência nunca é alterada nem apagada: a nova vigência encerra a anterior do mesmo estrato (sexo,
//     idade, material, método e condição) na véspera, e o resultado já gravado segue com a faixa que usou;
//   - a nova faixa não pode começar antes da que está em vigor (nada retroativo sobre laudo já emitido);
//   - o crítico fica fora da faixa normal, e o absurdo fora do crítico (validação na hora, antes de gravar);
//   - a fórmula é conferida na hora: só números, operadores, parênteses, funções conhecidas e as variáveis declaradas;
//   - o exame ligado não pode fechar ciclo (A lança B, B lança A), e cada exame tem um setor e um material padrão.

export const TIPOS_SERVICO_EXAME = [
  'laboratorio',
  'imagem',
  'metodo_grafico',
  'anatomia_patologica',
  'hemoterapia',
  'outro',
] as const;
export type TipoServicoExame = (typeof TIPOS_SERVICO_EXAME)[number];

export const LADOS_EXAME = ['direito', 'esquerdo', 'bilateral'] as const;
export type LadoExame = (typeof LADOS_EXAME)[number];

export const CONDICOES_FAIXA = [
  'nenhuma',
  'gestante',
  'jejum',
  'pos_prandial',
  'pos_menopausa',
  'pre_menopausa',
] as const;
export type CondicaoFaixa = (typeof CONDICOES_FAIXA)[number];

/** Uma falha de validação: o campo e a mensagem para a tela. */
export interface FalhaCatalogo {
  readonly campo: string;
  readonly mensagem: string;
}

export interface ExameCatalogo {
  readonly codigo: string;
  readonly sigla: string;
  readonly nome: string;
  readonly tipoServico: string;
  readonly modalidadeImagemId: number | null;
  readonly idadeMinimaDias: number | null;
  readonly idadeMaximaDias: number | null;
  readonly limiteSolicitacoes: number | null;
  readonly periodoLimiteDias: number | null;
  readonly custoUnitario: number | null;
}

/** O exame que pode ser gravado: códigos, tipo, modalidade da imagem, faixa etária e limite de pedidos. */
export function validarExame(e: ExameCatalogo): FalhaCatalogo[] {
  const f: FalhaCatalogo[] = [];
  if (!/^[A-Za-z0-9._-]{1,30}$/.test(e.codigo.trim()))
    f.push({ campo: 'codigo', mensagem: 'Código de 1 a 30 letras, números, ponto, hífen ou sublinhado.' });
  if (!/^[A-Za-z0-9]{1,10}$/.test(e.sigla.trim()))
    f.push({ campo: 'sigla', mensagem: 'Sigla de 1 a 10 letras ou números.' });
  if (e.nome.trim().length < 2 || e.nome.trim().length > 150)
    f.push({ campo: 'nome', mensagem: 'Nome de 2 a 150 caracteres.' });
  if (!(TIPOS_SERVICO_EXAME as readonly string[]).includes(e.tipoServico))
    f.push({ campo: 'tipoServico', mensagem: 'Tipo de serviço desconhecido.' });
  if (e.tipoServico === 'imagem' && e.modalidadeImagemId === null)
    f.push({ campo: 'modalidadeImagemId', mensagem: 'O exame de imagem precisa da modalidade.' });
  if (e.idadeMinimaDias !== null && e.idadeMaximaDias !== null && e.idadeMinimaDias > e.idadeMaximaDias)
    f.push({ campo: 'idadeMaximaDias', mensagem: 'A idade máxima é menor que a mínima.' });
  if ((e.limiteSolicitacoes === null) !== (e.periodoLimiteDias === null))
    f.push({
      campo: 'periodoLimiteDias',
      mensagem: 'O limite de pedidos e o período em dias vão juntos (ou nenhum dos dois).',
    });
  if (e.custoUnitario !== null && e.custoUnitario < 0)
    f.push({ campo: 'custoUnitario', mensagem: 'O custo não pode ser negativo.' });
  return f;
}

/** Ao marcar um vínculo como padrão, os outros padrões ativos do mesmo exame deixam de ser (um padrão só). */
export function padroesADesmarcar(
  vinculos: readonly { readonly id: number; readonly padrao: boolean; readonly ativo: boolean }[],
  novoPadraoId: number | null,
): number[] {
  return vinculos.filter((v) => v.padrao && v.ativo && v.id !== novoPadraoId).map((v) => v.id);
}

/** O exame ligado (secundário, correlacionado ou incluído): nunca ele mesmo e nunca fechando ciclo. */
export function validarExameLigado(
  exameId: number,
  ligadoId: number,
  ligacoesAtivas: readonly { readonly de: number; readonly para: number }[],
): FalhaCatalogo[] {
  if (exameId === ligadoId)
    return [{ campo: 'secundarioExameId', mensagem: 'O exame não pode ser ligado a ele mesmo.' }];
  // Há caminho do ligado até o exame? Então a nova ligação fecharia um ciclo.
  const vistos = new Set<number>();
  const fila = [ligadoId];
  while (fila.length) {
    const atual = fila.shift() as number;
    if (atual === exameId)
      return [
        {
          campo: 'secundarioExameId',
          mensagem: 'A ligação fecharia um ciclo: o exame escolhido já leva a este.',
        },
      ];
    if (vistos.has(atual)) continue;
    vistos.add(atual);
    for (const l of ligacoesAtivas) if (l.de === atual) fila.push(l.para);
  }
  return [];
}

export interface LimitesFaixa {
  readonly referenciaMinima: number | null;
  readonly referenciaMaxima: number | null;
  readonly alertaMinimo: number | null;
  readonly alertaMaximo: number | null;
  readonly criticoMinimo: number | null;
  readonly criticoMaximo: number | null;
  readonly absurdoMinimo: number | null;
  readonly absurdoMaximo: number | null;
}

export interface EstratoFaixa {
  readonly sexoId: number | null;
  readonly idadeMinimaDias: number | null;
  readonly idadeMaximaDias: number | null;
  readonly materialBiologicoId: number | null;
  readonly metodoAnaliticoId: number | null;
  readonly condicao: string;
}

export interface FaixaNova extends LimitesFaixa, EstratoFaixa {
  readonly referenciaTexto: string | null;
  /** AAAA-MM-DD. */
  readonly vigenciaInicio: string;
}

export interface FaixaVigente extends EstratoFaixa {
  readonly id: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

const menorOuIgual = (a: number | null, b: number | null) => a === null || b === null || a <= b;

/** Os limites da faixa: cada par em ordem; o alerta dentro do crítico; o crítico fora da faixa normal. */
export function validarLimitesFaixa(
  f: LimitesFaixa & { readonly referenciaTexto?: string | null },
): FalhaCatalogo[] {
  const r: FalhaCatalogo[] = [];
  const par = (a: number | null, b: number | null, campo: string, nome: string) => {
    if (!menorOuIgual(a, b)) r.push({ campo, mensagem: `O ${nome} mínimo é maior que o máximo.` });
  };
  par(f.referenciaMinima, f.referenciaMaxima, 'referenciaMaxima', 'valor de referência');
  par(f.alertaMinimo, f.alertaMaximo, 'alertaMaximo', 'alerta');
  par(f.criticoMinimo, f.criticoMaximo, 'criticoMaximo', 'crítico');
  par(f.absurdoMinimo, f.absurdoMaximo, 'absurdoMaximo', 'absurdo');
  if (!menorOuIgual(f.criticoMinimo, f.referenciaMinima))
    r.push({ campo: 'criticoMinimo', mensagem: 'O crítico mínimo fica abaixo do mínimo da referência.' });
  if (!menorOuIgual(f.referenciaMaxima, f.criticoMaximo))
    r.push({ campo: 'criticoMaximo', mensagem: 'O crítico máximo fica acima do máximo da referência.' });
  if (!menorOuIgual(f.absurdoMinimo, f.criticoMinimo))
    r.push({ campo: 'absurdoMinimo', mensagem: 'O absurdo mínimo fica abaixo do crítico mínimo.' });
  if (!menorOuIgual(f.criticoMaximo, f.absurdoMaximo))
    r.push({ campo: 'absurdoMaximo', mensagem: 'O absurdo máximo fica acima do crítico máximo.' });
  const semNumero = f.referenciaMinima === null && f.referenciaMaxima === null;
  if (semNumero && !(f.referenciaTexto ?? '').trim())
    r.push({
      campo: 'referenciaTexto',
      mensagem: 'Informe a faixa (mínimo, máximo) ou o texto da referência.',
    });
  return r;
}

const idadesSeCruzam = (a: EstratoFaixa, b: EstratoFaixa) =>
  (a.idadeMinimaDias ?? 0) <= (b.idadeMaximaDias ?? Number.MAX_SAFE_INTEGER) &&
  (b.idadeMinimaDias ?? 0) <= (a.idadeMaximaDias ?? Number.MAX_SAFE_INTEGER);

/** Mesmo estrato: mesmo sexo, material, método e condição, e as idades se cruzam (as duas valeriam para o paciente). */
export function mesmoEstrato(a: EstratoFaixa, b: EstratoFaixa): boolean {
  return (
    a.sexoId === b.sexoId &&
    a.materialBiologicoId === b.materialBiologicoId &&
    a.metodoAnaliticoId === b.metodoAnaliticoId &&
    a.condicao === b.condicao &&
    idadesSeCruzam(a, b)
  );
}

/** O dia anterior (AAAA-MM-DD). */
export function vespera(dia: string): string {
  const d = new Date(`${dia.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface PlanoNovaVersaoFaixa {
  readonly falhas: readonly FalhaCatalogo[];
  /** As faixas em vigor do mesmo estrato que se encerram na véspera da nova (nunca apagadas). */
  readonly encerrar: readonly { readonly id: number; readonly vigenciaFim: string }[];
}

/**
 * A nova versão da faixa: valida os limites e encerra, na véspera do início da nova, as faixas em vigor do mesmo
 * estrato. Recusa a nova que começaria no mesmo dia ou antes de uma em vigor do estrato (laudo já emitido com ela
 * mudaria de referência) e a que começaria antes de hoje.
 */
export function planejarNovaVersaoFaixa(
  nova: FaixaNova,
  vigentes: readonly FaixaVigente[],
  hoje: string,
): PlanoNovaVersaoFaixa {
  const falhas: FalhaCatalogo[] = [...validarLimitesFaixa(nova)];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nova.vigenciaInicio))
    falhas.push({ campo: 'vigenciaInicio', mensagem: 'Data de início inválida.' });
  else if (nova.vigenciaInicio < hoje)
    falhas.push({
      campo: 'vigenciaInicio',
      mensagem: 'A nova faixa começa hoje ou depois (nada retroativo).',
    });
  if (!(CONDICOES_FAIXA as readonly string[]).includes(nova.condicao))
    falhas.push({ campo: 'condicao', mensagem: 'Condição desconhecida.' });
  if (!menorOuIgual(nova.idadeMinimaDias, nova.idadeMaximaDias))
    falhas.push({ campo: 'idadeMaximaDias', mensagem: 'A idade máxima é menor que a mínima.' });
  const encerrar: { id: number; vigenciaFim: string }[] = [];
  for (const v of vigentes) {
    if (!mesmoEstrato(v, nova)) continue;
    if (v.vigenciaFim !== null && v.vigenciaFim < nova.vigenciaInicio) continue;
    if (v.vigenciaInicio >= nova.vigenciaInicio) {
      falhas.push({
        campo: 'vigenciaInicio',
        mensagem: `Já há faixa deste estrato começando em ${v.vigenciaInicio}: a nova começa depois dela.`,
      });
      continue;
    }
    encerrar.push({ id: v.id, vigenciaFim: vespera(nova.vigenciaInicio) });
  }
  return { falhas, encerrar: falhas.length ? [] : encerrar };
}

export const FUNCOES_FORMULA = ['raiz', 'log', 'ln', 'abs', 'min', 'max', 'arred', 'pot'] as const;

/** Os identificadores usados na expressão (sem as funções). */
export function variaveisDaExpressao(expressao: string): string[] {
  const ids = expressao.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  return [...new Set(ids.filter((i) => !(FUNCOES_FORMULA as readonly string[]).includes(i.toLowerCase())))];
}

/**
 * A fórmula conferida na hora: caracteres permitidos, parênteses equilibrados, operadores entre operandos e todas as
 * variáveis declaradas (e nenhuma declarada sem uso).
 */
export function validarFormula(expressao: string, declaradas: readonly string[]): FalhaCatalogo[] {
  const f: FalhaCatalogo[] = [];
  const e = expressao.trim();
  if (!e) return [{ campo: 'expressao', mensagem: 'Informe a expressão.' }];
  if (!/^[A-Za-z0-9_.,+\-*/^()\s]+$/.test(e))
    f.push({ campo: 'expressao', mensagem: 'Use só números, variáveis, + - * / ^, vírgula e parênteses.' });
  let nivel = 0;
  for (const ch of e) {
    if (ch === '(') nivel++;
    if (ch === ')') nivel--;
    if (nivel < 0) break;
  }
  if (nivel !== 0) f.push({ campo: 'expressao', mensagem: 'Parênteses desequilibrados.' });
  const compacta = e.replace(/\s+/g, '');
  if (/[+*/^]{2,}|[+\-*/^]$|^[*/^]|\(\)|\([*/^]/.test(compacta))
    f.push({ campo: 'expressao', mensagem: 'Operador sem operando.' });
  const usadas = variaveisDaExpressao(e);
  const faltam = usadas.filter((u) => !declaradas.includes(u));
  if (faltam.length)
    f.push({ campo: 'variaveis', mensagem: `Variáveis sem declaração: ${faltam.join(', ')}.` });
  const sobram = declaradas.filter((d) => !usadas.includes(d));
  if (sobram.length)
    f.push({ campo: 'variaveis', mensagem: `Variáveis declaradas sem uso: ${sobram.join(', ')}.` });
  if (new Set(declaradas).size !== declaradas.length)
    f.push({ campo: 'variaveis', mensagem: 'Variável declarada duas vezes.' });
  return f;
}
