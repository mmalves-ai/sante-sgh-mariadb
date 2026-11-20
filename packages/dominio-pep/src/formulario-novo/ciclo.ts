// Ciclo de vida e imutabilidade do formulário novo (M45, etapa 1; regra 14; cap-11 §11.1 "Versionamento"):
// rascunho → revisão → publicado → aposentado. O publicado é imutável (`content_hash` = SHA-256 do JCS da
// definição); corrigir é publicar nova versão. Publicação só com a definição sem problema, os casos de teste verdes
// e a aprovação da comissão de prontuário por outra pessoa (quatro olhos). Puro: o serviço da API aplica.
import {
  type CasoFormularioNovo,
  type DefinicaoFormularioNovo,
  type EstadoFormularioNovo,
  jcs,
  sha256Hex,
} from '@sgh/contratos';
import { casosVerdes, executarCasos } from './avaliacao.js';
import { conferirDefinicao, type ProblemaDefinicao } from './definicao.js';

export const FORMATO_DEFINICAO_FORMULARIO_NOVO = 'sgh-formulario-novo/1';

/** Conteúdo canônico da definição (JCS, RFC 8785): a mesma definição dá o mesmo hash, em qualquer ordem de chaves. */
export function conteudoCanonicoFormularioNovo(def: DefinicaoFormularioNovo): string {
  return jcs({
    formato: FORMATO_DEFINICAO_FORMULARIO_NOVO,
    definicao: { ...def, especialidades: [...new Set(def.especialidades)].sort((a, b) => a - b) },
  });
}

export function contentHashFormularioNovo(def: DefinicaoFormularioNovo): Promise<string> {
  return sha256Hex(conteudoCanonicoFormularioNovo(def));
}

export type CodigoRecusaCiclo =
  | 'estado-invalido'
  | 'imutavel'
  | 'definicao-com-problema'
  | 'sem-casos'
  | 'casos-vermelhos'
  | 'sem-aprovacao'
  | 'aprovador-e-autor'
  | 'publicador-e-autor'
  | 'hash-divergente'
  | 'codigo-em-uso'
  | 'versao-concorrente';

export class ErroCicloFormularioNovo extends Error {
  override readonly name = 'ErroCicloFormularioNovo';
  readonly codigo: CodigoRecusaCiclo;
  readonly problemas: readonly ProblemaDefinicao[];
  constructor(codigo: CodigoRecusaCiclo, mensagem: string, problemas: readonly ProblemaDefinicao[] = []) {
    super(mensagem);
    this.codigo = codigo;
    this.problemas = problemas;
  }
}

export interface VersaoNoCiclo {
  readonly estado: EstadoFormularioNovo;
  readonly definicao: DefinicaoFormularioNovo;
  readonly casos: readonly CasoFormularioNovo[];
  /** Conta de quem escreveu a última alteração da definição. */
  readonly autor: string;
  /**
   * Todas as contas que salvaram alguma alteração desta versão (os eventos `salvo` da história), o autor incluído:
   * quem escreveu qualquer parte da versão não a aprova nem a publica (quatro olhos, D-APROV-45).
   */
  readonly autores: readonly string[];
  readonly aprovadoPor: string | null;
  readonly contentHash: string | null;
}

const recusa = (c: CodigoRecusaCiclo, m: string, p: readonly ProblemaDefinicao[] = []) =>
  new ErroCicloFormularioNovo(c, m, p);

/** Salvar é só no rascunho; publicado e aposentado são imutáveis (nova versão a partir deles). */
export function conferirSalvar(atual: Pick<VersaoNoCiclo, 'estado'> | null): void {
  if (atual === null || atual.estado === 'rascunho') return;
  if (atual.estado === 'publicado' || atual.estado === 'aposentado')
    throw recusa('imutavel', 'Versão publicada não se altera: crie uma nova versão a partir dela.');
  throw recusa('estado-invalido', 'Em revisão: devolva ao rascunho antes de alterar.');
}

function conferirConteudo(v: Pick<VersaoNoCiclo, 'definicao' | 'casos'>, hoje?: string): void {
  const problemas = conferirDefinicao(v.definicao);
  if (problemas.length > 0) throw recusa('definicao-com-problema', 'A definição tem problemas.', problemas);
  if (v.casos.length === 0) throw recusa('sem-casos', 'Inclua ao menos um caso de teste.');
  if (!casosVerdes(executarCasos(v.definicao, v.casos, hoje)))
    throw recusa('casos-vermelhos', 'Há caso de teste que não passa.');
}

export function conferirEnvioRevisao(v: VersaoNoCiclo, hoje?: string): void {
  if (v.estado !== 'rascunho') throw recusa('estado-invalido', 'Só o rascunho vai à revisão.');
  conferirConteudo(v, hoje);
}

/** A conta escreveu alguma parte da versão? (o último autor ou quem a salvou antes; sem diferenciar maiúsculas). */
export function escreveuAVersao(v: Pick<VersaoNoCiclo, 'autor' | 'autores'>, conta: string): boolean {
  const c = conta.trim().toUpperCase();
  return [v.autor, ...v.autores].some((a) => a.trim().toUpperCase() === c);
}

export function conferirDecisaoRevisao(v: VersaoNoCiclo, quemDecide: string): void {
  if (v.estado !== 'revisao')
    throw recusa('estado-invalido', 'Só a versão em revisão é aprovada ou devolvida.');
  if (escreveuAVersao(v, quemDecide))
    throw recusa('aprovador-e-autor', 'Quem escreveu a versão não a aprova.');
}

/**
 * Publicar: aprovada por outra pessoa, publicada por quem não escreveu a versão (quatro olhos, D-APROV-45), definição
 * sem problema, casos verdes e o hash que a tela mostrou.
 */
export async function conferirPublicacao(
  v: VersaoNoCiclo,
  contentHashEsperado: string,
  quemPublica: string,
  hoje?: string,
): Promise<string> {
  if (v.estado !== 'revisao') throw recusa('estado-invalido', 'Só a versão aprovada em revisão é publicada.');
  if (v.aprovadoPor === null) throw recusa('sem-aprovacao', 'Falta a aprovação da comissão de prontuário.');
  if (escreveuAVersao(v, v.aprovadoPor))
    throw recusa('aprovador-e-autor', 'Quem escreveu a versão não a aprova.');
  if (escreveuAVersao(v, quemPublica))
    throw recusa('publicador-e-autor', 'Quem escreveu a versão não a publica.');
  conferirConteudo(v, hoje);
  const hash = await contentHashFormularioNovo(v.definicao);
  if (hash !== contentHashEsperado)
    throw recusa(
      'hash-divergente',
      'A definição mudou depois de aberta: reabra e confira antes de publicar.',
    );
  return hash;
}

/** A versão publicada continua íntegra? (o hash guardado bate com a definição guardada). */
export async function publicadoIntegro(
  v: Pick<VersaoNoCiclo, 'definicao' | 'contentHash'>,
): Promise<boolean> {
  return v.contentHash !== null && (await contentHashFormularioNovo(v.definicao)) === v.contentHash;
}

export function conferirAposentadoria(v: Pick<VersaoNoCiclo, 'estado'>): void {
  if (v.estado !== 'publicado') throw recusa('estado-invalido', 'Só a versão publicada é aposentada.');
}

/** Próxima versão de um código: 1 + a maior existente (versões nunca reaproveitadas). */
export function proximaVersao(versoesDoCodigo: readonly number[]): number {
  return versoesDoCodigo.reduce((m, v) => Math.max(m, v), 0) + 1;
}
