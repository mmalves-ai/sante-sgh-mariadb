// Rastreio de amostra (ficha do M26, regra 3; cap-05b §5.10 "Identificação" e "Rastreio"): a amostra tem código único e
// dois identificadores do paciente (nome completo e data de nascimento); a coleta do internado exige a leitura da
// pulseira (meta 1 de segurança do paciente); a etiqueta sai na hora da coleta. As passagens (coletada, em transporte,
// recebida, em análise, rejeitada com motivo e recoleta) ficam só no novo, com hora e responsável de cada uma.
import type { EstadoAmostra } from '@sgh/contratos';

const ALFABETO = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Dígito verificador (módulo 34 sobre o alfabeto sem I e O, à prova de troca de dois caracteres vizinhos). */
export function digitoVerificador(base: string): string {
  let soma = 0;
  const t = base.toUpperCase();
  for (let i = 0; i < t.length; i++) {
    const v = ALFABETO.indexOf(t[i]!);
    if (v < 0) throw new Error('Código de amostra com caractere inválido.');
    soma += v * (t.length - i + 1);
  }
  return ALFABETO[soma % ALFABETO.length]!;
}

/**
 * O código único da amostra: prefixo do estabelecimento (2), o ID da amostra em base 34 (7, com zeros) e o dígito.
 * Vai no código de barras da etiqueta (Code 128) e é o que o leitor confere no recebimento.
 */
export function codigoDaAmostra(prefixo: string, id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('ID de amostra inválido.');
  const p = prefixo
    .toUpperCase()
    .replace(/[^0-9A-HJ-NP-Z]/g, '')
    .padEnd(2, 'X')
    .slice(0, 2);
  let n = id;
  let b = '';
  while (n > 0) {
    b = ALFABETO[n % ALFABETO.length]! + b;
    n = Math.floor(n / ALFABETO.length);
  }
  const base = `${p}${b.padStart(7, '0')}`;
  return `${base}${digitoVerificador(base)}`;
}

/** O código lido pelo leitor confere (formato e dígito). */
export function codigoValido(codigo: string): boolean {
  const c = codigo.trim().toUpperCase();
  if (!/^[0-9A-HJ-NP-Z]{10}$/.test(c)) return false;
  return digitoVerificador(c.slice(0, 9)) === c[9];
}

/** Passagens permitidas (a recoleta gera uma amostra nova; a rejeitada só vai à recoleta). */
const TRANSICOES: Readonly<Record<EstadoAmostra, readonly EstadoAmostra[]>> = {
  aguardandoColeta: ['coletada'],
  coletada: ['emTransporte', 'recebida', 'rejeitada'],
  emTransporte: ['recebida', 'rejeitada'],
  recebida: ['emAnalise', 'rejeitada'],
  emAnalise: ['rejeitada'],
  rejeitada: ['recoleta'],
  recoleta: [],
};

export function podeMudar(
  de: EstadoAmostra,
  para: EstadoAmostra,
): { readonly pode: boolean; readonly motivo: string | null } {
  if (TRANSICOES[de].includes(para)) return { pode: true, motivo: null };
  if (de === para) return { pode: false, motivo: 'A amostra já está nesse estado.' };
  if (de === 'recoleta') return { pode: false, motivo: 'A amostra foi substituída pela recoleta.' };
  return { pode: false, motivo: 'Passagem de estado não permitida para a amostra.' };
}

/**
 * Passagem pedida no rastreio (leitor ou lista do dia). A recoleta nunca é só uma troca de estado: ela nasce do pedido de
 * recoleta com o motivo do cadastro, que rejeita a original e cria a nova coleta numerada (`conferirRecoleta`). Pedir
 * "recoleta" pelo rastreio é recusado com o código `recoleta-pelo-pedido`, para a amostra não ficar sem a nova coleta.
 */
export function conferirPassagemDoRastreio(
  de: EstadoAmostra,
  para: EstadoAmostra,
): { readonly pode: boolean; readonly motivo: string | null; readonly codigo: string | null } {
  if (para === 'recoleta' && de !== 'recoleta')
    return {
      pode: false,
      motivo:
        'A recoleta é pedida com o motivo do cadastro, pelo pedido de recoleta, que cria a nova coleta.',
      codigo: 'recoleta-pelo-pedido',
    };
  const p = podeMudar(de, para);
  return { ...p, codigo: p.pode ? null : 'amostra-transicao' };
}

/** A amostra coletada e ainda não substituída aceita o pedido de recoleta (a original é rejeitada junto, se não estiver). */
export const aceitaPedidoDeRecoleta = (de: EstadoAmostra): boolean =>
  de !== 'aguardandoColeta' && de !== 'recoleta';

/** A coleta exige a pulseira no internado e os dois identificadores conferidos sempre (regra 3). */
export function conferirColeta(c: {
  readonly internado: boolean;
  readonly pulseiraLida: string | null | undefined;
  readonly pulseiraEsperada: string | null;
  readonly identificadoresConferidos: boolean;
}): { readonly pode: boolean; readonly motivo: string | null } {
  if (!c.identificadoresConferidos)
    return { pode: false, motivo: 'Confira o nome completo e a data de nascimento com o paciente.' };
  if (c.internado) {
    const lida = (c.pulseiraLida ?? '').trim();
    if (!lida) return { pode: false, motivo: 'Leia a pulseira do paciente internado antes de coletar.' };
    if (c.pulseiraEsperada !== null && lida !== c.pulseiraEsperada)
      return { pode: false, motivo: 'A pulseira lida não é do paciente deste exame.' };
  }
  return { pode: true, motivo: null };
}

/**
 * Agrupa os exames da coleta pelo recipiente (o tubo certo por exame; coleta agrupada por recipiente): um grupo por
 * paciente e recipiente (sem recipiente no cadastro, um grupo por exame).
 */
export function gruposDeColeta<
  T extends { readonly paciente: number; readonly recipiente: number | null; readonly id: number },
>(exames: readonly T[]): T[][] {
  const m = new Map<string, T[]>();
  for (const e of exames) {
    const k = e.recipiente === null ? `${e.paciente}|exame:${e.id}` : `${e.paciente}|${e.recipiente}`;
    m.set(k, [...(m.get(k) ?? []), e]);
  }
  return [...m.values()];
}
