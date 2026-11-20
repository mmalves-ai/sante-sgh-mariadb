// Verificador público de documentos (M49, etapa 3; regra 9; cap-07 §7.6; cap-12 §12.4): as regras puras da consulta
// pelo código do QR. Mostra só tipo, datas, profissional (conselho) e o resultado da validação; nunca conteúdo clínico
// nem dado do paciente. A origem da consulta é guardada só MASCARADA (IPv4 /24, IPv6 /48) e o limite de taxa é por
// origem e por minuto (contra varredura de códigos).
import { createHash } from 'node:crypto';

export type SituacaoVerificacaoPublica =
  'valida' | 'invalida' | 'indeterminada' | 'pendente' | 'suspenso' | 'nao-encontrado';

/** O código opaco do QR: 16 a 64 caracteres do alfabeto base64url (o mesmo do urlVerificador). */
export const formatoCodigoVerificador = (codigo: string): boolean => /^[A-Za-z0-9_-]{16,64}$/.test(codigo);

/** Os oito grupos do IPv6 (com o "::" expandido); null quando não é IPv6. */
function expandirV6(s: string): string[] | null {
  if (!s.includes(':')) return null;
  const partes = s.split('::');
  if (partes.length > 2) return null;
  const esq = partes[0] ? partes[0].split(':') : [];
  const dir = partes.length === 2 && partes[1] ? partes[1].split(':') : [];
  const faltam = partes.length === 2 ? 8 - esq.length - dir.length : 0;
  if (faltam < 0) return null;
  const tudo = [...esq, ...Array<string>(faltam).fill('0'), ...dir];
  if (tudo.length !== 8 || tudo.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return tudo;
}

/**
 * A origem só mascarada para guardar (política de retenção): IPv4 → a.b.c.0, IPv6 → os três primeiros grupos (/48)
 * com "::", IPv4 mapeado em IPv6 (::ffff:a.b.c.d) → como IPv4. Qualquer outra coisa: "desconhecida".
 */
export function mascararOrigem(ip: string | null | undefined): string {
  const bruto = (ip ?? '').trim();
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(bruto);
  if (v4) {
    const partes = v4.slice(1, 4).map(Number);
    if (partes.some((p) => p > 255) || Number(v4[4]) > 255) return 'desconhecida';
    return `${partes.join('.')}.0`;
  }
  const v6 = expandirV6(bruto);
  if (v6)
    return `${v6
      .slice(0, 3)
      .map((g) => parseInt(g, 16).toString(16))
      .join(':')}::`;
  return 'desconhecida';
}

/**
 * A origem que conta para o limite de taxa: IPv4 (e IPv4 mapeado em IPv6) pelo endereço completo; IPv6 pelo prefixo
 * /64 (a sub-rede que um provedor entrega a um só cliente: trocar de endereço dentro dela não zera o contador);
 * qualquer outra coisa, como veio (aparada).
 */
export function origemDaTaxa(ip: string | null | undefined): string {
  const bruto = (ip ?? '').trim();
  const v4 = /^(?:::ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(bruto);
  if (v4) return v4[1]!;
  const v6 = expandirV6(bruto);
  if (v6)
    return `${v6
      .slice(0, 4)
      .map((g) => parseInt(g, 16).toString(16))
      .join(':')}::/64`;
  return bruto;
}

/** A chave do limite de taxa: resumo da origem da taxa (IPv4 inteiro, IPv6 /64; nunca guardado) e o minuto. */
export function chaveTaxaVerificador(ip: string | null | undefined, agora: Date): string {
  const resumo = createHash('sha256')
    .update(`verificador:${origemDaTaxa(ip)}`)
    .digest('hex')
    .slice(0, 32);
  return `${resumo}:${minutoDe(agora)}`;
}

const minutoDe = (agora: Date): number => Math.floor(agora.getTime() / 60_000);

/** A chave do teto global por minuto (todas as origens juntas): acima dele, nenhuma consulta grava nada. */
export const chaveTetoGlobalVerificador = (agora: Date): string => `global:${minutoDe(agora)}`;

export interface DocumentoParaVerificar {
  readonly suspenso: boolean;
  readonly assinatura: { readonly estado: 'pendente' | 'assinada' | 'falha' } | null;
  readonly validacao: { readonly resultado: 'valida' | 'invalida' | 'indeterminada' } | null;
}

/**
 * A situação mostrada: sem documento ou sem assinatura (a prévia que nunca foi assinada), "não encontrado"; documento
 * suspenso depois de assinado, "suspenso"; assinatura pendente (revogação ou carimbo fora do ar, regra 5), "em
 * processamento"; assinatura em falha, "inválida"; assinada: o resultado da validação mais recente no servidor (sem
 * nenhuma, "indeterminada").
 */
export function situacaoDaVerificacao(d: DocumentoParaVerificar | null): SituacaoVerificacaoPublica {
  if (!d?.assinatura) return 'nao-encontrado';
  if (d.suspenso) return 'suspenso';
  if (d.assinatura.estado === 'pendente') return 'pendente';
  if (d.assinatura.estado === 'falha') return 'invalida';
  return d.validacao?.resultado ?? 'indeterminada';
}

/** O resultado gravado em SGH_DOC_VERIFICACAO (o suspenso grava a validação: o documento foi achado). */
export function resultadoParaGravar(
  s: SituacaoVerificacaoPublica,
  d: DocumentoParaVerificar | null,
): 'valida' | 'invalida' | 'indeterminada' | 'pendente' | 'nao-encontrado' {
  if (s !== 'suspenso') return s;
  return d?.validacao?.resultado ?? 'indeterminada';
}

/** Dentro do limite: a consulta de número `n` no minuto (1 é a primeira) não passa do limite por minuto. */
export const dentroDoLimite = (n: number, limitePorMinuto: number): boolean =>
  n <= Math.max(1, Math.floor(limitePorMinuto));

/** A primeira consulta barrada do minuto grava uma linha só (a varredura não vira carga no banco). */
export const primeiraBarrada = (n: number, limitePorMinuto: number): boolean =>
  n === Math.max(1, Math.floor(limitePorMinuto)) + 1;
