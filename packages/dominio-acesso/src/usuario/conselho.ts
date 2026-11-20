// W1-01 (parte 11d; mercado l): conferência do conselho no vínculo usuário–profissional e o bloqueio PARAMETRIZADO dos
// atos privativos (a categoria com conselho, que concede o perfil 'assistencial-com-conselho'). Puro: a API aplica ao
// calcular a autorização e a ficha do usuário mostra a mesma avaliação. A consulta automática ao conselho fica
// desligada (depende de convênio/credencial externa do dono): a conferência é manual, com data, fonte e quem conferiu.

export type SituacaoConselho = 'ativo' | 'inativo' | 'suspenso' | 'cancelado' | 'nao-localizado';

/**
 * Modo do bloqueio dos atos privativos (parâmetro acesso.conselho.bloqueioAtosPrivativos):
 * - desligado: a conferência só informa;
 * - irregular: bloqueia quando a última conferência diz que o registro não está ativo;
 * - irregular-ou-nao-conferido: bloqueia também sem conferência ou com a conferência vencida.
 */
export type ModoBloqueioConselho = 'desligado' | 'irregular' | 'irregular-ou-nao-conferido';
export const MODOS_BLOQUEIO_CONSELHO: readonly ModoBloqueioConselho[] = [
  'desligado',
  'irregular',
  'irregular-ou-nao-conferido',
];

export interface ParametrosConselho {
  readonly bloqueio: ModoBloqueioConselho;
  /** Dias de validade de uma conferência (depois, conta como não conferido). */
  readonly validadeDias: number;
  /** Consulta automática ao conselho: sempre false enquanto não houver o conector (dependência externa). */
  readonly consultaAutomatica: boolean;
}

export const PADRAO_CONSELHO: ParametrosConselho = {
  bloqueio: 'irregular',
  validadeDias: 365,
  consultaAutomatica: false,
};

export interface ConferenciaConselhoAvaliada {
  readonly situacao: SituacaoConselho;
  /** Dia da consulta à fonte (AAAA-MM-DD). */
  readonly conferidoEm: string;
}

export type EstadoRegistroConselho = 'regular' | 'irregular' | 'nao-conferido' | 'vencido';

export interface AvaliacaoRegistroConselho {
  readonly estado: EstadoRegistroConselho;
  /** O registro libera os atos privativos neste modo? */
  readonly libera: boolean;
  readonly motivo: string;
}

const diasEntre = (de: string, ate: string): number =>
  Math.floor((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);

/** Avalia um registro de conselho pela última conferência (hoje = AAAA-MM-DD no fuso do estabelecimento). */
export function avaliarRegistroConselho(
  conferencia: ConferenciaConselhoAvaliada | null,
  p: ParametrosConselho,
  hoje: string,
): AvaliacaoRegistroConselho {
  const estado: EstadoRegistroConselho = !conferencia
    ? 'nao-conferido'
    : conferencia.situacao !== 'ativo'
      ? 'irregular'
      : diasEntre(conferencia.conferidoEm, hoje) > p.validadeDias
        ? 'vencido'
        : 'regular';
  const bloqueia =
    p.bloqueio === 'irregular'
      ? estado === 'irregular'
      : p.bloqueio === 'irregular-ou-nao-conferido'
        ? estado !== 'regular'
        : false;
  const motivo =
    estado === 'regular'
      ? 'Registro ativo no conselho, conferido dentro do prazo.'
      : estado === 'irregular'
        ? `Registro ${conferencia?.situacao === 'nao-localizado' ? 'não localizado' : conferencia?.situacao} no conselho (conferido em ${conferencia?.conferidoEm}).`
        : estado === 'vencido'
          ? `Conferência de ${conferencia?.conferidoEm} vencida (validade de ${p.validadeDias} dias).`
          : 'Registro ainda não conferido no conselho.';
  return { estado, libera: !bloqueia, motivo };
}

export interface RegistroConselhoAvaliar {
  readonly registro: number;
  readonly conferencia: ConferenciaConselhoAvaliada | null;
}

/**
 * A categoria com conselho do usuário depois da conferência: com registro no papel ativo (concessão do legado) e ao
 * menos um registro que libera os atos privativos no modo do parâmetro. Sem registro, nada muda (já não tem conselho).
 */
export function conselhoEfetivo(
  temConselho: boolean,
  registros: readonly RegistroConselhoAvaliar[] | undefined,
  p: ParametrosConselho,
  hoje: string,
): { conselho: boolean; bloqueadoPorConferencia: boolean; motivo: string | null } {
  if (!temConselho || p.bloqueio === 'desligado' || registros === undefined)
    return { conselho: temConselho, bloqueadoPorConferencia: false, motivo: null };
  // Concessão com conselho mas nenhum registro lido (tabela ausente, leitura parcial): só o modo estrito bloqueia.
  const avaliados = registros.map((r) => avaliarRegistroConselho(r.conferencia, p, hoje));
  if (avaliados.length === 0) {
    const bloqueia = p.bloqueio === 'irregular-ou-nao-conferido';
    return {
      conselho: !bloqueia,
      bloqueadoPorConferencia: bloqueia,
      motivo: bloqueia ? 'Registro ainda não conferido no conselho.' : null,
    };
  }
  if (avaliados.some((a) => a.libera))
    return { conselho: true, bloqueadoPorConferencia: false, motivo: null };
  return { conselho: false, bloqueadoPorConferencia: true, motivo: avaliados[0]?.motivo ?? null };
}
