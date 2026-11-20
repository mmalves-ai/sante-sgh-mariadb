// Política de assinatura por tipo de documento, conselho e destino (M49; regras 3 e 6; DOC-04; Lei 14.063/2020,
// art. 13; DP-22). A política cadastrada escolhe o nível; o PISO LEGAL do código nunca é rebaixado por cadastro:
// receita de controle especial e atestado que sai do hospital exigem ICP-Brasil, e prescrição e atestado, quando ICP,
// exigem carimbo do tempo (AD-RT). Sem política cadastrada, vale a assinatura avançada que o novo já faz (M23).
import {
  NIVEIS_ASSINATURA,
  type DestinoDocumento,
  type ExigenciaAssinatura,
  type FormatoAssinatura,
  type MotivoRecusaAssinatura,
  type NivelAssinatura,
  type PoliticaAssinaturaIcp,
  type TipoDocumentoPolitica,
} from '@sgh/contratos';

export interface RegraPoliticaAssinatura {
  readonly id: number;
  readonly tipoDocumento: TipoDocumentoPolitica;
  /** null: vale para qualquer conselho. */
  readonly conselho: string | null;
  readonly destino: DestinoDocumento;
  readonly nivel: NivelAssinatura;
  readonly politicaIcp: PoliticaAssinaturaIcp | null;
  readonly formato: FormatoAssinatura;
}

export interface DocumentoParaPolitica {
  readonly tipo: TipoDocumentoPolitica;
  /** Sigla do conselho do autor (CRM, COREN...); null se o autor não tem conselho. */
  readonly conselho: string | null;
  readonly destino: DestinoDocumento;
}

interface Piso {
  readonly nivel: NivelAssinatura;
  readonly politicaIcp: PoliticaAssinaturaIcp | null;
}

const ordemNivel = (n: NivelAssinatura) => NIVEIS_ASSINATURA.indexOf(n);
const ordemPolitica = (p: PoliticaAssinaturaIcp | null) => (p === null ? 0 : p === 'AD-RB' ? 1 : 2);

/** Tipos em que a assinatura ICP leva carimbo do tempo no mínimo (regra 3: prescrição e atestado). */
const EXIGEM_CARIMBO: ReadonlySet<TipoDocumentoPolitica> = new Set([
  'prescricao',
  'receita',
  'receita-controlada',
  'receita-antimicrobiano',
  'atestado',
]);

/**
 * Piso legal (regra 6): receita de controle especial (sempre sai do hospital) e atestado que sai do hospital, ICP-Brasil
 * AD-RT. O resto: avançada (o que o M23 já grava).
 */
export function pisoLegal(d: Pick<DocumentoParaPolitica, 'tipo' | 'destino'>): Piso {
  if (d.tipo === 'receita-controlada' || (d.tipo === 'atestado' && d.destino === 'externo'))
    return { nivel: 'icp-brasil', politicaIcp: 'AD-RT' };
  return { nivel: 'eletronica-avancada', politicaIcp: null };
}

/** A regra cadastrada mais específica que casa: conselho exato antes de "qualquer conselho". */
export function regraQueVale(
  regras: readonly RegraPoliticaAssinatura[],
  d: DocumentoParaPolitica,
): RegraPoliticaAssinatura | null {
  const casam = regras.filter(
    (r) =>
      r.tipoDocumento === d.tipo &&
      r.destino === d.destino &&
      (r.conselho === null || (d.conselho !== null && r.conselho === d.conselho)),
  );
  return casam.find((r) => r.conselho !== null) ?? casam.find((r) => r.conselho === null) ?? null;
}

function maisForte(a: Piso, b: Piso): Piso {
  const nivel = ordemNivel(a.nivel) >= ordemNivel(b.nivel) ? a.nivel : b.nivel;
  if (nivel !== 'icp-brasil') return { nivel, politicaIcp: null };
  const pa = a.nivel === 'icp-brasil' ? a.politicaIcp : null;
  const pb = b.nivel === 'icp-brasil' ? b.politicaIcp : null;
  const politica = ordemPolitica(pa) >= ordemPolitica(pb) ? pa : pb;
  return { nivel, politicaIcp: politica ?? 'AD-RB' };
}

/** O que o documento exige: a regra cadastrada, nunca abaixo do piso legal; ICP de prescrição e atestado com AD-RT. */
export function resolverExigencia(
  regras: readonly RegraPoliticaAssinatura[],
  d: DocumentoParaPolitica,
): ExigenciaAssinatura {
  const regra = regraQueVale(regras, d);
  let alvo = maisForte(pisoLegal(d), regra ?? pisoLegal(d));
  if (alvo.nivel === 'icp-brasil' && EXIGEM_CARIMBO.has(d.tipo))
    alvo = { nivel: 'icp-brasil', politicaIcp: 'AD-RT' };
  return {
    nivel: alvo.nivel,
    politicaIcp: alvo.politicaIcp,
    formato: regra?.formato ?? 'pades',
    carimboDoTempo: alvo.politicaIcp === 'AD-RT',
    origem: regra ? { politica: regra.id } : 'piso-legal',
  };
}

/** A assinatura feita atende à exigência? */
export function atendeExigencia(
  feita: Piso,
  exigida: Pick<ExigenciaAssinatura, 'nivel' | 'politicaIcp'>,
):
  | { ok: true }
  | { ok: false; motivo: Extract<MotivoRecusaAssinatura, 'nivel-insuficiente' | 'politica-insuficiente'> } {
  if (ordemNivel(feita.nivel) < ordemNivel(exigida.nivel)) return { ok: false, motivo: 'nivel-insuficiente' };
  if (exigida.nivel === 'icp-brasil' && ordemPolitica(feita.politicaIcp) < ordemPolitica(exigida.politicaIcp))
    return { ok: false, motivo: 'politica-insuficiente' };
  return { ok: true };
}

/**
 * Antes de gravar uma regra (`documento.definirPoliticaAssinatura`): recusa a que fica abaixo do piso legal (a tela diz
 * o mínimo) e a ICP sem AD-RT para os tipos que exigem carimbo.
 */
export function conferirRegraPolitica(
  r: Omit<RegraPoliticaAssinatura, 'id'>,
): { ok: true } | { ok: false; minimo: Piso } {
  const piso = pisoLegal({ tipo: r.tipoDocumento, destino: r.destino });
  const minimo =
    r.nivel === 'icp-brasil' && EXIGEM_CARIMBO.has(r.tipoDocumento)
      ? ({ nivel: 'icp-brasil', politicaIcp: 'AD-RT' } as const)
      : piso;
  return atendeExigencia({ nivel: r.nivel, politicaIcp: r.politicaIcp }, minimo).ok
    ? { ok: true }
    : { ok: false, minimo };
}
