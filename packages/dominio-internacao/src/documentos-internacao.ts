// F3.4 (04-INT linha 69): quais documentos da internação (fichas, termos, guias) saem para esta internação. A regra
// liga um modelo a um momento (admissão, prorrogação, transferência, alta) e, se quiser, a um convênio, uma
// especialidade e uma modalidade; o que fica vazio vale para todos. Para cada modelo vale a regra MAIS específica que
// casa (a do convênio + especialidade vence a só do convênio, que vence a geral); o próprio modelo ainda filtra por
// especialidade e faixa de idade do paciente. Sem regra que case, o modelo não sai. A lista sai na ordem da regra e,
// no empate, pelo título. Pura: sem banco.

export const MOMENTOS_DOCUMENTO_INTERNACAO = ['admissao', 'prorrogacao', 'transferencia', 'alta'] as const;
export type MomentoDocumentoInternacao = (typeof MOMENTOS_DOCUMENTO_INTERNACAO)[number];
/**
 * O momento do MODELO (CHECK do banco): é o valor padrão da regra nova desse modelo. `sob_demanda` quer dizer que o
 * modelo não tem momento próprio: sai quando alguém o escolhe na tela de impressos (ativo, da especialidade e da faixa
 * de idade da internação), além dos que as regras mandam.
 */
export const MOMENTOS_MODELO_DOCUMENTO = ['admissao', 'alta', 'transferencia', 'sob_demanda'] as const;
export type MomentoModeloDocumento = (typeof MOMENTOS_MODELO_DOCUMENTO)[number];

export interface ModeloDocumentoInternacao {
  readonly id: number;
  readonly titulo: string;
  readonly ativo: boolean;
  /** Nulo: todas as especialidades. */
  readonly especialidade: number | null;
  readonly idadeMinima: number | null;
  readonly idadeMaxima: number | null;
  /** O momento do modelo (padrão da regra; `sob_demanda`: escolhido na hora). Ausente: sem momento próprio. */
  readonly momento?: string;
  /** As cópias do modelo (padrão da regra e do documento sob demanda). */
  readonly copias?: number;
}

export interface RegraDocumentoInternacao {
  readonly id: number;
  readonly modelo: number;
  readonly momento: MomentoDocumentoInternacao;
  /** Nulos: valem para todos. */
  readonly convenio: number | null;
  readonly especialidade: number | null;
  readonly modalidade: number | null;
  readonly obrigatorio: boolean;
  readonly selecionadoPorPadrao: boolean;
  readonly copias: number;
  readonly ordem: number;
  readonly ativo: boolean;
}

export interface InternacaoParaDocumentos {
  readonly convenio: number;
  readonly especialidade: number;
  readonly modalidade: number;
  /** Idade em anos na data de referência; nula quando o nascimento é desconhecido. */
  readonly idade: number | null;
}

export interface DocumentoDaInternacao {
  readonly modelo: number;
  readonly titulo: string;
  readonly regra: number;
  readonly copias: number;
  readonly obrigatorio: boolean;
  readonly selecionado: boolean;
  /** Verdadeiro: não veio de regra, é um modelo sob demanda (regra 0, desmarcado). */
  readonly sobDemanda?: boolean;
}

const casa = (filtro: number | null, valor: number) => filtro === null || filtro === valor;
const especificidade = (r: RegraDocumentoInternacao) =>
  (r.convenio === null ? 0 : 4) + (r.especialidade === null ? 0 : 2) + (r.modalidade === null ? 0 : 1);

/** O modelo serve a esta internação pela especialidade e pela faixa de idade dele. */
export function modeloServe(m: ModeloDocumentoInternacao, i: InternacaoParaDocumentos): boolean {
  if (!m.ativo || !casa(m.especialidade, i.especialidade)) return false;
  if (m.idadeMinima === null && m.idadeMaxima === null) return true;
  // Faixa de idade sem nascimento conhecido: não presume, o modelo não sai.
  if (i.idade === null) return false;
  return (
    (m.idadeMinima === null || i.idade >= m.idadeMinima) &&
    (m.idadeMaxima === null || i.idade <= m.idadeMaxima)
  );
}

/** Os documentos que saem para a internação no momento, um por modelo, pela regra mais específica que casa. */
export function documentosDaInternacao(
  momento: MomentoDocumentoInternacao,
  internacao: InternacaoParaDocumentos,
  modelos: readonly ModeloDocumentoInternacao[],
  regras: readonly RegraDocumentoInternacao[],
): DocumentoDaInternacao[] {
  const porModelo = new Map(modelos.map((m) => [m.id, m]));
  const escolhida = new Map<number, RegraDocumentoInternacao>();
  for (const r of regras) {
    if (!r.ativo || r.momento !== momento) continue;
    if (!casa(r.convenio, internacao.convenio)) continue;
    if (!casa(r.especialidade, internacao.especialidade)) continue;
    if (!casa(r.modalidade, internacao.modalidade)) continue;
    const m = porModelo.get(r.modelo);
    if (!m || !modeloServe(m, internacao)) continue;
    const atual = escolhida.get(r.modelo);
    if (
      !atual ||
      especificidade(r) > especificidade(atual) ||
      (especificidade(r) === especificidade(atual) && r.id < atual.id)
    )
      escolhida.set(r.modelo, r);
  }
  return [...escolhida.values()]
    .map((r) => ({ r, m: porModelo.get(r.modelo)! }))
    .sort((a, b) => a.r.ordem - b.r.ordem || a.m.titulo.localeCompare(b.m.titulo, 'pt-BR') || a.m.id - b.m.id)
    .map(({ r, m }) => ({
      modelo: m.id,
      titulo: m.titulo,
      regra: r.id,
      copias: r.copias,
      // O obrigatório sai sempre marcado: não se desmarca o que a admissão exige.
      obrigatorio: r.obrigatorio,
      selecionado: r.obrigatorio || r.selecionadoPorPadrao,
    }));
}

/**
 * Os modelos sob demanda que servem à internação e que nenhuma regra já mandou: a tela de impressos oferece,
 * desmarcados, com as cópias do modelo.
 */
export function modelosSobDemanda(
  internacao: InternacaoParaDocumentos,
  modelos: readonly ModeloDocumentoInternacao[],
  jaEscolhidos: readonly DocumentoDaInternacao[],
): DocumentoDaInternacao[] {
  const ja = new Set(jaEscolhidos.map((d) => d.modelo));
  return modelos
    .filter((m) => m.momento === 'sob_demanda' && !ja.has(m.id) && modeloServe(m, internacao))
    .sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR') || a.id - b.id)
    .map((m) => ({
      modelo: m.id,
      titulo: m.titulo,
      regra: 0,
      copias: m.copias ?? 1,
      obrigatorio: false,
      selecionado: false,
      sobDemanda: true,
    }));
}

/** O momento padrão da regra nova pelo momento do modelo (sob demanda: admissão). */
export function momentoPadraoDaRegra(momentoModelo: string | null | undefined): MomentoDocumentoInternacao {
  return (MOMENTOS_DOCUMENTO_INTERNACAO as readonly string[]).includes(momentoModelo ?? '')
    ? (momentoModelo as MomentoDocumentoInternacao)
    : 'admissao';
}

/** Os obrigatórios da lista que ainda não foram emitidos (a tela avisa antes de sair). */
export function obrigatoriosPendentes(
  documentos: readonly DocumentoDaInternacao[],
  emitidos: ReadonlySet<number>,
): DocumentoDaInternacao[] {
  return documentos.filter((d) => d.obrigatorio && !emitidos.has(d.modelo));
}

/**
 * Os campos variáveis do modelo, escritos entre chaves no texto (`{paciente}`). Lista fechada: o modelo com marcador
 * fora dela é recusado na hora, e na emissão cada marcador recebe o dado da internação.
 */
export const MARCADORES_DOCUMENTO_INTERNACAO = [
  'paciente',
  'nome_social',
  'prontuario',
  'nascimento',
  'idade',
  'convenio',
  'leito',
  'medico',
  'internacao',
  'data_entrada',
  'hora_entrada',
  'data_emissao',
] as const;
export type MarcadorDocumento = (typeof MARCADORES_DOCUMENTO_INTERNACAO)[number];
const MARCADOR = /\{([a-z_]+)\}/g;

/** Os marcadores do texto que não estão na lista fechada (sem repetição, na ordem em que aparecem). */
export function marcadoresDesconhecidos(texto: string): string[] {
  const fora = new Set<string>();
  for (const [, nome] of texto.matchAll(MARCADOR))
    if (!(MARCADORES_DOCUMENTO_INTERNACAO as readonly string[]).includes(nome!)) fora.add(nome!);
  return [...fora];
}

/** Preenche os marcadores com os dados da internação; o dado ausente sai como "não informado". */
export function preencherMarcadores(
  texto: string,
  valores: Partial<Record<MarcadorDocumento, string | null>>,
): string {
  return texto.replace(MARCADOR, (todo, nome: string) => {
    if (!(MARCADORES_DOCUMENTO_INTERNACAO as readonly string[]).includes(nome)) return todo;
    const v = valores[nome as MarcadorDocumento];
    return v === null || v === undefined || v === '' ? 'não informado' : v;
  });
}

export interface ProblemaDocumento {
  readonly campo: string;
  readonly mensagem: string;
}

/** Validação na hora do modelo (a tela mostra ao lado do campo; a API recusa com 400). */
export function validarModeloDocumento(m: {
  codigo: string;
  titulo: string;
  conteudo: string | null;
  idadeMinima: number | null;
  idadeMaxima: number | null;
  copias: number;
}): ProblemaDocumento[] {
  const p: ProblemaDocumento[] = [];
  if (!m.codigo.trim()) p.push({ campo: 'codigo', mensagem: 'Informe o código do modelo.' });
  if (m.codigo.length > 30) p.push({ campo: 'codigo', mensagem: 'O código tem no máximo 30 caracteres.' });
  if (!m.titulo.trim()) p.push({ campo: 'titulo', mensagem: 'Informe o título do documento.' });
  if (!m.conteudo?.trim()) p.push({ campo: 'conteudo', mensagem: 'Escreva o texto do documento.' });
  const fora = marcadoresDesconhecidos(m.conteudo ?? '');
  if (fora.length)
    p.push({
      campo: 'conteudo',
      mensagem: `Campo desconhecido no texto: ${fora.map((f) => `{${f}}`).join(', ')}. Use: ${MARCADORES_DOCUMENTO_INTERNACAO.map((f) => `{${f}}`).join(', ')}.`,
    });
  if (m.idadeMinima !== null && m.idadeMaxima !== null && m.idadeMaxima < m.idadeMinima)
    p.push({ campo: 'idadeMaxima', mensagem: 'A idade máxima não pode ser menor que a mínima.' });
  if (!Number.isInteger(m.copias) || m.copias < 1 || m.copias > 20)
    p.push({ campo: 'copias', mensagem: 'As cópias vão de 1 a 20.' });
  return p;
}

/** Validação na hora da regra. */
export function validarRegraDocumento(r: { momento: string; copias: number }): ProblemaDocumento[] {
  const p: ProblemaDocumento[] = [];
  if (!(MOMENTOS_DOCUMENTO_INTERNACAO as readonly string[]).includes(r.momento))
    p.push({
      campo: 'momento',
      mensagem: 'Escolha o momento: admissão, prorrogação, transferência ou alta.',
    });
  if (!Number.isInteger(r.copias) || r.copias < 1 || r.copias > 20)
    p.push({ campo: 'copias', mensagem: 'As cópias vão de 1 a 20.' });
  return p;
}
