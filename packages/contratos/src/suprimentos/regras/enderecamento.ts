// Endereçamento do armazém e reserva para a separação (F8, 05-SUP linha 4). Regras puras: o endereço em níveis (área,
// rua, prédio, andar, posição) dentro do local, o vínculo do item com o endereço (um preferencial por local), a reserva
// do saldo livre por lote na requisição a atender (validade mais próxima primeiro, vencido de fora) e a baixa da
// reserva no atendimento. Nada aqui fala com o banco.
import { recusa, type RecusaSuprimentos } from './recusa.js';

export const TIPOS_NIVEL_ENDERECO = [
  'area',
  'rua',
  'corredor',
  'predio',
  'armario',
  'andar',
  'prateleira',
  'posicao',
  'gaveta',
] as const;
export type TipoNivelEndereco = (typeof TIPOS_NIVEL_ENDERECO)[number];

/** Código de um nível: letras maiúsculas, dígitos e no máximo 30 caracteres (vai impresso e na etiqueta). */
export const CODIGO_NIVEL_ENDERECO = /^[A-Z0-9]{1,30}$/;
export const NIVEL_MAXIMO_ENDERECO = 8;

export interface EnderecoSuperior {
  readonly id: number;
  readonly local: number;
  readonly nivel: number;
  readonly codigoCompleto: string;
  readonly ativo: boolean;
}

export interface EnderecoEntrada {
  readonly local: number;
  readonly superior?: number | null | undefined;
  readonly tipoNivel: TipoNivelEndereco;
  readonly codigo: string;
  readonly descricao?: string | null | undefined;
  readonly capacidade?: number | null | undefined;
}

/** O código como vai para o banco: sem espaços nas pontas e em maiúsculas (a tela aceita digitado em minúsculas). */
export const normalizarCodigoNivel = (codigo: string): string => codigo.trim().toUpperCase();

/** O endereço completo legível: o completo do superior e o código do nível, separados por hífen (ex.: A-03-02-B). */
export function codigoCompletoEndereco(
  superior: Pick<EnderecoSuperior, 'codigoCompleto'> | null,
  codigo: string,
): string {
  const c = normalizarCodigoNivel(codigo);
  return superior ? `${superior.codigoCompleto}-${c}` : c;
}

/** O nível do endereço novo: 1 sem superior, senão o do superior mais um. */
export const nivelDoEndereco = (superior: Pick<EnderecoSuperior, 'nivel'> | null): number =>
  superior ? superior.nivel + 1 : 1;

/**
 * Confere o endereço novo: código válido, tipo de nível conhecido, superior do mesmo local e ativo, no máximo 8
 * níveis, capacidade positiva e o endereço completo ainda livre no local.
 */
export function conferirEnderecoArmazem(
  e: EnderecoEntrada,
  superior: EnderecoSuperior | null,
  completosDoLocal: ReadonlySet<string>,
): RecusaSuprimentos[] {
  const rs: RecusaSuprimentos[] = [];
  const codigo = normalizarCodigoNivel(e.codigo);
  if (!CODIGO_NIVEL_ENDERECO.test(codigo))
    rs.push(
      recusa('endereco-codigo-invalido', 'Use só letras e números no código do nível (até 30).', ['codigo']),
    );
  if (!(TIPOS_NIVEL_ENDERECO as readonly string[]).includes(e.tipoNivel))
    rs.push(recusa('endereco-tipo-invalido', 'Escolha o tipo do nível do endereço.', ['tipoNivel']));
  if (e.superior && !superior)
    rs.push(recusa('endereco-superior-inexistente', 'O endereço de cima não existe.', ['superior']));
  if (superior) {
    if (superior.local !== e.local)
      rs.push(recusa('endereco-superior-outro-local', 'O endereço de cima é de outro local.', ['superior']));
    if (!superior.ativo)
      rs.push(recusa('endereco-superior-inativo', 'O endereço de cima está inativo.', ['superior']));
    if (superior.nivel >= NIVEL_MAXIMO_ENDERECO)
      rs.push(recusa('endereco-nivel-maximo', 'O endereço vai até 8 níveis.', ['superior']));
  }
  if (e.capacidade !== null && e.capacidade !== undefined && !(e.capacidade > 0))
    rs.push(
      recusa('endereco-capacidade-invalida', 'A capacidade, quando informada, é maior que zero.', [
        'capacidade',
      ]),
    );
  if (rs.length === 0 && completosDoLocal.has(codigoCompletoEndereco(superior, codigo)))
    rs.push(recusa('endereco-duplicado', 'Este endereço já existe no local.', ['codigo']));
  return rs;
}

/** Inativar um endereço: só sem endereço ativo abaixo e sem item ligado a ele. */
export function conferirInativacaoEndereco(filhosAtivos: number, itensLigados: number): RecusaSuprimentos[] {
  const rs: RecusaSuprimentos[] = [];
  if (filhosAtivos > 0)
    rs.push(recusa('endereco-com-filhos', 'Inative antes os endereços abaixo deste.', ['ativo']));
  if (itensLigados > 0)
    rs.push(recusa('endereco-com-itens', 'Retire antes os itens ligados a este endereço.', ['ativo']));
  return rs;
}

/** Ligar o item ao endereço: o endereço ativo e desbloqueado, o item ativo, a quantidade máxima positiva. */
export function conferirVinculoEndereco(
  endereco: { readonly ativo: boolean; readonly bloqueado: boolean } | null,
  itemAtivo: boolean | null,
  quantidadeMaxima: number | null,
): RecusaSuprimentos[] {
  const rs: RecusaSuprimentos[] = [];
  if (!endereco) rs.push(recusa('endereco-inexistente', 'O endereço não existe.', ['endereco']));
  else if (!endereco.ativo || endereco.bloqueado)
    rs.push(recusa('endereco-indisponivel', 'O endereço está inativo ou bloqueado.', ['endereco']));
  if (itemAtivo === null) rs.push(recusa('item-inexistente', 'O item não existe no cadastro.', ['insumo']));
  else if (!itemAtivo) rs.push(recusa('item-inativo', 'O item está inativo.', ['insumo']));
  if (quantidadeMaxima !== null && !(quantidadeMaxima > 0))
    rs.push(
      recusa('quantidade-maxima-invalida', 'A quantidade máxima, quando informada, é maior que zero.', [
        'quantidadeMaxima',
      ]),
    );
  return rs;
}

// ---------------------------------------------------------------- reserva para a separação

export interface ItemAReservar {
  readonly itemRequisicao: number;
  readonly insumo: number;
  readonly unidade: number;
  /** Solicitada menos atendida menos cancelada. */
  readonly aSeparar: number;
  /** O que já está reservado e ativo para este item (a reserva repetida só completa a diferença). */
  readonly jaReservado: number;
  readonly controlaLote: boolean;
}

export interface LoteLivre {
  readonly lote: number;
  readonly saldoLote: number;
  readonly validade: string;
  /** Quantidade menos a reservada no local (o livre de verdade). */
  readonly livre: number;
}

export interface ReservaPlanejada {
  readonly itemRequisicao: number;
  readonly insumo: number;
  readonly unidade: number;
  readonly lote: number | null;
  readonly saldoLote: number | null;
  readonly quantidade: number;
}

export interface PlanoReserva {
  readonly reservas: readonly ReservaPlanejada[];
  /** O que não coube no saldo livre, por item da requisição. */
  readonly faltas: readonly {
    readonly itemRequisicao: number;
    readonly insumo: number;
    readonly falta: number;
  }[];
}

const q4 = (x: number) => Math.round(x * 10_000) / 10_000;

/**
 * O plano da reserva: para cada item, o que falta reservar (a separar menos o já reservado). Item com lote reserva
 * dos lotes livres pela validade mais próxima (vencido e sem livre de fora); item sem lote reserva do livre do local.
 * O que o livre não cobre vira falta (não reserva parcial escondida: a falta vai para a tela).
 */
export function planejarReservaSeparacao(
  itens: readonly ItemAReservar[],
  lotes: ReadonlyMap<number, readonly LoteLivre[]>,
  livreSemLote: ReadonlyMap<number, number>,
  hoje: string,
): PlanoReserva {
  const reservas: ReservaPlanejada[] = [];
  const faltas: { itemRequisicao: number; insumo: number; falta: number }[] = [];
  const usadoLote = new Map<number, number>();
  const usadoLocal = new Map<number, number>();
  for (const it of itens) {
    let resta = q4(it.aSeparar - it.jaReservado);
    if (resta <= 0) continue;
    if (it.controlaLote) {
      const validos = [...(lotes.get(it.insumo) ?? [])]
        .filter((l) => l.validade >= hoje)
        .sort((a, b) => a.validade.localeCompare(b.validade) || a.lote - b.lote);
      for (const l of validos) {
        if (resta <= 0) break;
        const livre = q4(l.livre - (usadoLote.get(l.saldoLote) ?? 0));
        if (livre <= 0) continue;
        const tira = Math.min(resta, livre);
        usadoLote.set(l.saldoLote, q4((usadoLote.get(l.saldoLote) ?? 0) + tira));
        reservas.push({
          itemRequisicao: it.itemRequisicao,
          insumo: it.insumo,
          unidade: it.unidade,
          lote: l.lote,
          saldoLote: l.saldoLote,
          quantidade: q4(tira),
        });
        resta = q4(resta - tira);
      }
    } else {
      const livre = q4((livreSemLote.get(it.insumo) ?? 0) - (usadoLocal.get(it.insumo) ?? 0));
      const tira = Math.max(0, Math.min(resta, livre));
      if (tira > 0) {
        usadoLocal.set(it.insumo, q4((usadoLocal.get(it.insumo) ?? 0) + tira));
        reservas.push({
          itemRequisicao: it.itemRequisicao,
          insumo: it.insumo,
          unidade: it.unidade,
          lote: null,
          saldoLote: null,
          quantidade: q4(tira),
        });
        resta = q4(resta - tira);
      }
    }
    if (resta > 0) faltas.push({ itemRequisicao: it.itemRequisicao, insumo: it.insumo, falta: resta });
  }
  return { reservas, faltas };
}

export interface ReservaAtiva {
  readonly id: number;
  readonly reservada: number;
  readonly atendida: number;
  readonly liberada: number;
}

export interface BaixaReserva {
  readonly id: number;
  /** Quanto desta reserva passa a atendido agora. */
  readonly atender: number;
  /** Quanto volta ao saldo livre sem atendimento. */
  readonly liberar: number;
  readonly situacao: 'ativa' | 'atendida' | 'liberada';
}

/**
 * A baixa das reservas do item no atendimento: a quantidade atendida consome as reservas na ordem; com o item
 * completo (ou na liberação, `atendida` = 0 e `encerrar`), o resto volta ao livre. Reserva toda consumida fica
 * atendida; a que só devolveu fica liberada; a mista fica atendida (o atendido manda).
 */
export function baixaDasReservas(
  reservas: readonly ReservaAtiva[],
  atendida: number,
  encerrar: boolean,
): BaixaReserva[] {
  const saida: BaixaReserva[] = [];
  let resta = q4(Math.max(0, atendida));
  for (const r of reservas) {
    const aberto = q4(r.reservada - r.atendida - r.liberada);
    if (aberto <= 0) continue;
    const atender = q4(Math.min(aberto, resta));
    resta = q4(resta - atender);
    const liberar = encerrar ? q4(aberto - atender) : 0;
    if (atender === 0 && liberar === 0) continue;
    const fechada = q4(aberto - atender - liberar) <= 0;
    saida.push({
      id: r.id,
      atender,
      liberar,
      situacao: !fechada ? 'ativa' : r.atendida + atender > 0 ? 'atendida' : 'liberada',
    });
  }
  return saida;
}
