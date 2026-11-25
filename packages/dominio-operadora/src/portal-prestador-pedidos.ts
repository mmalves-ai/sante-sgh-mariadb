// F7 (08-SGO linha 113, C2-074): o portal do prestador credenciado além da autorização e das contas — o pedido de
// credenciamento e de alteração do próprio cadastro (pedido_web_prestador), os avisos publicados à rede
// (aviso_portal_prestador) e as regras de arquivo aceito por tipo de prestador (regra_arquivo_prestador). Regras puras:
// nada de banco nem de I/O. O pedido nunca altera o cadastro sozinho: a operadora analisa e decide (aprovar ou recusar
// com motivo), e o pedido fica guardado com a decisão. O aviso nunca é apagado: sai do ar por inativação.
import { cnpjValido, cpfValido } from './documentos.js';

export const TIPOS_PEDIDO_WEB_PRESTADOR = [
  'credenciamento',
  'alteracao_cadastral',
  'endereco',
  'especialidade',
  'qualificacao',
] as const;
export type TipoPedidoWebPrestador = (typeof TIPOS_PEDIDO_WEB_PRESTADOR)[number];

export const SITUACOES_PEDIDO_WEB_PRESTADOR = [
  'recebido',
  'em_analise',
  'aprovado',
  'recusado',
  'cancelado',
] as const;
export type SituacaoPedidoWebPrestador = (typeof SITUACOES_PEDIDO_WEB_PRESTADOR)[number];

export type AcaoPedidoWebPrestador = 'analisar' | 'aprovar' | 'recusar' | 'cancelar';

export interface PedidoWebPrestadorEntrada {
  readonly tipo: TipoPedidoWebPrestador;
  /** O prestador já credenciado (da sessão do portal); nulo só no pedido de credenciamento. */
  readonly prestador: number | null;
  readonly pessoa: 'fisica' | 'juridica';
  readonly nome: string;
  readonly cpf: string | null;
  readonly cnpj: string | null;
  readonly conselho: {
    readonly classe: number | null;
    readonly numero: string | null;
    readonly uf: number | null;
  };
  readonly cnes: string | null;
  readonly banco: {
    readonly banco: number | null;
    readonly agencia: string | null;
    readonly conta: string | null;
  };
  readonly email: string | null;
  readonly cep: string | null;
  /** O que muda (endereço, especialidade, qualificação), conferido na análise. */
  readonly detalhes: Readonly<Record<string, unknown>> | null;
}

export interface ProblemaPortalPrestador {
  readonly codigo: string;
  readonly campo: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const algum = (...v: readonly unknown[]) => v.some((x) => x !== null && x !== undefined && x !== '');
const todos = (...v: readonly unknown[]) => v.every((x) => x !== null && x !== undefined && x !== '');

/**
 * A conferência do pedido antes de gravar (validação na hora na tela, a mesma no servidor). O pedido de alteração é
 * sempre do prestador da sessão; o de credenciamento nunca aponta prestador. O documento segue a pessoa, com o dígito
 * conferido; conselho e conta bancária vêm completos ou não vêm; CNES com 7 dígitos (CNES), CEP com 8.
 */
export function problemasDoPedidoWeb(p: PedidoWebPrestadorEntrada): ProblemaPortalPrestador[] {
  const r: ProblemaPortalPrestador[] = [];
  if (p.tipo === 'credenciamento' && p.prestador !== null)
    r.push({ codigo: 'credenciamento-de-credenciado', campo: 'tipo' });
  if (p.tipo !== 'credenciamento' && p.prestador === null)
    r.push({ codigo: 'alteracao-sem-prestador', campo: 'tipo' });
  if (!p.nome.trim()) r.push({ codigo: 'nome-obrigatorio', campo: 'nome' });
  if (p.pessoa === 'fisica') {
    if (p.cnpj) r.push({ codigo: 'documento-da-outra-pessoa', campo: 'cnpj' });
    if (!cpfValido(p.cpf)) r.push({ codigo: 'cpf-invalido', campo: 'cpf' });
  } else {
    if (p.cpf) r.push({ codigo: 'documento-da-outra-pessoa', campo: 'cpf' });
    if (!cnpjValido(p.cnpj)) r.push({ codigo: 'cnpj-invalido', campo: 'cnpj' });
  }
  const c = p.conselho;
  if (algum(c.classe, c.numero, c.uf) && !todos(c.classe, c.numero, c.uf))
    r.push({ codigo: 'conselho-incompleto', campo: 'conselho' });
  if (p.tipo === 'credenciamento' && p.pessoa === 'fisica' && !todos(c.classe, c.numero, c.uf))
    r.push({ codigo: 'conselho-obrigatorio', campo: 'conselho' });
  if (p.pessoa === 'juridica' && p.tipo === 'credenciamento' && !p.cnes)
    r.push({ codigo: 'cnes-obrigatorio', campo: 'cnes' });
  if (p.cnes && !/^\d{7}$/.test(p.cnes)) r.push({ codigo: 'cnes-invalido', campo: 'cnes' });
  const b = p.banco;
  if (algum(b.banco, b.agencia, b.conta) && !todos(b.banco, b.agencia, b.conta))
    r.push({ codigo: 'conta-bancaria-incompleta', campo: 'banco' });
  if (p.email && !EMAIL.test(p.email)) r.push({ codigo: 'email-invalido', campo: 'email' });
  if (p.tipo === 'credenciamento' && !p.email) r.push({ codigo: 'email-obrigatorio', campo: 'email' });
  if (p.cep && !/^\d{8}$/.test(p.cep)) r.push({ codigo: 'cep-invalido', campo: 'cep' });
  if ((p.tipo === 'endereco' || p.tipo === 'especialidade' || p.tipo === 'qualificacao') && !p.detalhes)
    r.push({ codigo: 'detalhes-obrigatorios', campo: 'detalhes' });
  return r;
}

const TRANSICOES: Readonly<
  Record<AcaoPedidoWebPrestador, readonly [readonly SituacaoPedidoWebPrestador[], SituacaoPedidoWebPrestador]>
> = {
  analisar: [['recebido'], 'em_analise'],
  aprovar: [['recebido', 'em_analise'], 'aprovado'],
  recusar: [['recebido', 'em_analise'], 'recusado'],
  cancelar: [['recebido', 'em_analise'], 'cancelado'],
};

/**
 * A situação nova do pedido pela ação, ou o problema. Decidido não volta; a recusa exige motivo (o prestador lê no
 * portal); quem decide não é o prestador (o portal só cancela o próprio pedido ainda não decidido).
 */
export function proximaSituacaoPedidoWeb(
  atual: SituacaoPedidoWebPrestador,
  acao: AcaoPedidoWebPrestador,
  motivo: string | null,
): { situacao: SituacaoPedidoWebPrestador } | { problema: ProblemaPortalPrestador } {
  const [de, para] = TRANSICOES[acao];
  if (!de.includes(atual)) return { problema: { codigo: 'pedido-ja-decidido', campo: 'situacao' } };
  if (acao === 'recusar' && !motivo?.trim())
    return { problema: { codigo: 'recusa-sem-motivo', campo: 'motivo' } };
  return { situacao: para };
}

// ── Avisos do portal ─────────────────────────────────────────────────────────────────────────────

export const TIPOS_AVISO_PORTAL = ['noticia', 'comunicado', 'documento', 'link'] as const;
export type TipoAvisoPortal = (typeof TIPOS_AVISO_PORTAL)[number];

export interface AvisoPortalEntrada {
  readonly tipo: TipoAvisoPortal;
  readonly titulo: string;
  readonly conteudo: string;
  readonly documento: number | null;
  readonly link: string | null;
  readonly exibirDe: string;
  readonly exibirAte: string | null;
  readonly tipoPrestador: number | null;
  readonly prestador: number | null;
}

/** O aviso antes de publicar: o documento e o link conforme o tipo, link só https, período em ordem, público único. */
export function problemasDoAvisoPortal(a: AvisoPortalEntrada): ProblemaPortalPrestador[] {
  const r: ProblemaPortalPrestador[] = [];
  if (!a.titulo.trim()) r.push({ codigo: 'titulo-obrigatorio', campo: 'titulo' });
  if (!a.conteudo.trim()) r.push({ codigo: 'conteudo-obrigatorio', campo: 'conteudo' });
  if (a.tipo === 'documento' && a.documento === null)
    r.push({ codigo: 'documento-obrigatorio', campo: 'documento' });
  if (a.tipo === 'link' && !a.link) r.push({ codigo: 'link-obrigatorio', campo: 'link' });
  if (a.link && !/^https:\/\/[^\s]+$/.test(a.link)) r.push({ codigo: 'link-inseguro', campo: 'link' });
  if (a.exibirAte !== null && a.exibirAte < a.exibirDe)
    r.push({ codigo: 'periodo-invertido', campo: 'exibirAte' });
  if (a.tipoPrestador !== null && a.prestador !== null)
    r.push({ codigo: 'publico-duplo', campo: 'prestador' });
  return r;
}

export interface AvisoPortalLido {
  readonly id: number;
  readonly ativo: boolean;
  readonly publico: string;
  readonly tipoPrestador: number | null;
  readonly prestador: number | null;
  readonly exibirDe: string;
  readonly exibirAte: string | null;
  readonly destaque: boolean;
}

/**
 * Os avisos que o prestador vê agora: ativos, no período, para a rede (prestadores ou todos) e para ele (sem recorte,
 * do tipo dele ou dele mesmo). Os em destaque primeiro; depois do mais novo.
 */
export function avisosDoPrestador<T extends AvisoPortalLido>(
  avisos: readonly T[],
  alvo: { readonly prestador: number; readonly tipoPrestador: number | null },
  agora: string,
): T[] {
  return avisos
    .filter(
      (a) =>
        a.ativo &&
        (a.publico === 'prestadores' || a.publico === 'todos') &&
        a.exibirDe <= agora &&
        (a.exibirAte === null || a.exibirAte >= agora) &&
        (a.prestador === null || a.prestador === alvo.prestador) &&
        (a.tipoPrestador === null || a.tipoPrestador === alvo.tipoPrestador),
    )
    .sort(
      (x, y) =>
        Number(y.destaque) - Number(x.destaque) ||
        (x.exibirDe < y.exibirDe ? 1 : x.exibirDe > y.exibirDe ? -1 : 0),
    );
}

// ── Regras de arquivo por tipo de prestador ──────────────────────────────────────────────────────

export interface RegraArquivoPrestador {
  readonly id: number;
  readonly descricao: string;
  readonly tipoPrestador: number | null;
  readonly natureza: 'fisica' | 'juridica' | null;
  readonly obrigatorio: boolean;
  readonly extensoes: string | null;
  readonly tamanhoMaximoKb: number | null;
  readonly ativo: boolean;
}

/** As regras que valem para o prestador: ativas, do tipo dele (ou de todos) e da natureza dele (ou das duas). */
export function regrasDoPrestador<T extends RegraArquivoPrestador>(
  regras: readonly T[],
  alvo: { readonly tipoPrestador: number | null; readonly natureza: 'fisica' | 'juridica' },
): T[] {
  return regras.filter(
    (r) =>
      r.ativo &&
      (r.tipoPrestador === null || r.tipoPrestador === alvo.tipoPrestador) &&
      (r.natureza === null || r.natureza === alvo.natureza),
  );
}

/** O arquivo contra a regra: a extensão entre as aceitas e o tamanho dentro do teto. */
export function problemasDoArquivo(
  regra: RegraArquivoPrestador,
  arquivo: { readonly nome: string; readonly bytes: number },
): ProblemaPortalPrestador[] {
  const r: ProblemaPortalPrestador[] = [];
  const ext = /\.([a-z0-9]{1,10})$/i.exec(arquivo.nome)?.[1]?.toLowerCase() ?? '';
  const aceitas = (regra.extensoes ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean);
  if (aceitas.length && !aceitas.includes(ext)) r.push({ codigo: 'extensao-nao-aceita', campo: 'arquivo' });
  if (arquivo.bytes <= 0) r.push({ codigo: 'arquivo-vazio', campo: 'arquivo' });
  if (regra.tamanhoMaximoKb !== null && arquivo.bytes > regra.tamanhoMaximoKb * 1024)
    r.push({ codigo: 'arquivo-grande', campo: 'arquivo' });
  return r;
}

/** As regras obrigatórias ainda sem arquivo aceito (o que falta o prestador enviar). */
export function documentosPendentes<T extends RegraArquivoPrestador>(
  regras: readonly T[],
  enviadas: ReadonlySet<number>,
): T[] {
  return regras.filter((r) => r.obrigatorio && !enviadas.has(r.id));
}
