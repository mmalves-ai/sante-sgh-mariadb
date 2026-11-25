// 02-REC linha 33 (C2-005): regras puras do cadastro dos locais de atendimento (consultório, sala, ponto de
// atendimento de uma recepção) e dos encaminhamentos permitidos entre eles. O hospital monta pela tela onde a senha
// é atendida e para onde cada local pode mandar o paciente; o guichê só encaminha aos destinos gravados aqui.
// Nada é apagado: o local sai de uso desativado (com motivo), e só sem guichê aberto nem senha de hoje em aberto
// nele; o destino retirado da lista fica marcado como excluído, com a trilha.
import { type RecusaEstrutura, semAcento } from './estrutura.js';

const recusar = (campo: string, codigo: string, mensagem: string): RecusaEstrutura => ({
  campo,
  codigo,
  mensagem,
});

/** Máximo de destinos de encaminhamento por local (uma lista que a tela consegue mostrar). */
export const LIMITE_DESTINOS = 50;

export interface LocalProposto {
  readonly codigo: string;
  readonly descricao: string;
  /** O local encaminha o paciente a outros locais (a lista de destinos só vale com isto ligado). */
  readonly permiteEncaminhamento: boolean;
  /** O local é o marco do cálculo do tempo de espera nos indicadores. */
  readonly baseTempoEspera: boolean;
  /** O local participa do fluxo de reavaliação médica. */
  readonly reavaliacaoMedica: boolean;
  /** Canal de áudio da chamada no painel; null: o padrão do painel. */
  readonly canalAudio: string | null;
}

export interface LocalExistente {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  /** Recepção do local (o nome só não se repete dentro da mesma recepção). */
  readonly ponto: number;
}

/** Recusas da inclusão ou da alteração de um local (`id`: o local alterado; null na inclusão). */
export function recusasDoLocal(
  l: LocalProposto,
  ponto: { readonly id: number; readonly ativo: boolean },
  existentes: readonly LocalExistente[],
  id: number | null = null,
): RecusaEstrutura[] {
  const r: RecusaEstrutura[] = [];
  const outros = existentes.filter((x) => x.id !== id);
  if (!ponto.ativo && id === null)
    r.push(
      recusar('ponto', 'ponto-inativo', 'A recepção está desativada: reative-a antes de incluir locais.'),
    );
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/.test(l.codigo))
    r.push(
      recusar('codigo', 'codigo-invalido', 'O código tem de 1 a 30 letras, números, ponto, hífen ou traço.'),
    );
  else if (outros.some((x) => semAcento(x.codigo) === semAcento(l.codigo)))
    r.push(recusar('codigo', 'codigo-repetido', 'Já existe um local de atendimento com este código.'));
  const d = l.descricao.trim();
  if (d.length < 3 || d.length > 150)
    r.push(recusar('descricao', 'descricao-invalida', 'O nome do local tem de 3 a 150 caracteres.'));
  else if (outros.some((x) => x.ponto === ponto.id && semAcento(x.descricao) === semAcento(d)))
    r.push(recusar('descricao', 'descricao-repetida', 'Já existe um local com este nome nesta recepção.'));
  if (l.canalAudio !== null && (l.canalAudio.trim().length < 1 || l.canalAudio.trim().length > 40))
    r.push(recusar('canalAudio', 'canal-invalido', 'O canal de áudio tem até 40 caracteres.'));
  return r;
}

/** Código sugerido para o local novo, pelo nome (único entre os usados no estabelecimento). */
export function codigoDeLocalSugerido(descricao: string, usados: readonly string[]): string {
  const base =
    semAcento(descricao)
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'LOCAL';
  const tem = (c: string) => usados.some((u) => semAcento(u) === c);
  if (!tem(base)) return base;
  for (let n = 2; n < 1000; n++) if (!tem(`${base}-${n}`)) return `${base}-${n}`;
  return base;
}

export interface DestinoPossivel {
  readonly id: number;
  readonly ativo: boolean;
}

/**
 * Recusas da lista de destinos de encaminhamento de um local. `locais`: os locais do estabelecimento (o destino tem
 * de ser um deles e estar ativo, a não ser que já fosse destino antes: o destino desativado depois continua na
 * lista até alguém retirá-lo).
 */
export function recusasDosDestinos(
  origem: { readonly id: number; readonly permiteEncaminhamento: boolean },
  destinos: readonly number[],
  locais: readonly DestinoPossivel[],
  atuais: readonly number[] = [],
): RecusaEstrutura[] {
  const r: RecusaEstrutura[] = [];
  if (destinos.length > 0 && !origem.permiteEncaminhamento)
    r.push(
      recusar(
        'destinos',
        'local-nao-encaminha',
        'Este local não encaminha: ligue "encaminha a outros locais" antes de escolher os destinos.',
      ),
    );
  if (new Set(destinos).size !== destinos.length)
    r.push(recusar('destinos', 'destino-repetido', 'Um destino aparece mais de uma vez na lista.'));
  if (destinos.length > LIMITE_DESTINOS)
    r.push(
      recusar('destinos', 'destinos-demais', `Um local encaminha a no máximo ${LIMITE_DESTINOS} locais.`),
    );
  if (destinos.includes(origem.id))
    r.push(recusar('destinos', 'destino-proprio', 'O local não encaminha para ele mesmo.'));
  for (const d of destinos) {
    if (d === origem.id) continue;
    const l = locais.find((x) => x.id === d);
    if (!l) {
      r.push(
        recusar('destinos', 'destino-inexistente', 'Um dos destinos não é local deste estabelecimento.'),
      );
      break;
    }
    if (!l.ativo && !atuais.includes(d)) {
      r.push(recusar('destinos', 'destino-inativo', 'Um dos destinos está desativado.'));
      break;
    }
  }
  return r;
}

/** O que muda na lista de destinos: os que entram e os que saem (a gravação só toca nestes). */
export function diferencaDestinos(
  atuais: readonly number[],
  novos: readonly number[],
): { readonly entram: number[]; readonly saem: number[] } {
  return {
    entram: novos.filter((d) => !atuais.includes(d)),
    saem: atuais.filter((d) => !novos.includes(d)),
  };
}

/** O que impede desativar o local agora (null: pode). */
export function bloqueioDesativarLocal(uso: {
  readonly guichesAbertos: number;
  readonly senhasEmAberto: number;
}): RecusaEstrutura | null {
  if (uso.guichesAbertos > 0)
    return recusar('ativo', 'guiche-aberto', 'Há guichê aberto neste local: feche-o antes de desativar.');
  if (uso.senhasEmAberto > 0)
    return recusar(
      'ativo',
      'senha-em-aberto',
      `Há ${uso.senhasEmAberto} senha(s) de hoje neste local ainda sem conclusão: conclua ou encaminhe antes de desativar.`,
    );
  return null;
}
