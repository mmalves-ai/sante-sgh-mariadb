// Fila `zpl` idempotente (regra 10 da ficha do M09; cap-09 §9.10): mesma chave de idempotência = um
// trabalho só, mesmo com o clique repetido ou a nova tentativa da rede. A reserva da chave é atômica no
// armazém (Valkey `SET NX PX` na API; memória nos testes) e expira depois da janela de idempotência. Se o
// envio à fila falhar depois da reserva, a reserva é desfeita (só se ainda for desta chamada): a nova
// tentativa com a mesma chave cria o trabalho, em vez de receber `novo:false` por 24 h sem nada impresso.

export interface TrabalhoZpl {
  readonly chaveIdempotencia: string;
  /** Código da rede e do estabelecimento (ARQ-2: fila com o código da rede). */
  readonly rede: string;
  readonly estabelecimento: string;
  readonly estacao: string;
  readonly modelo:
    | 'pulseira'
    | 'etiqueta-amostra'
    | 'etiqueta-prontuario'
    | 'etiqueta-leito'
    | 'etiqueta-dose'
    | 'etiqueta-bandeja'
    | 'etiqueta-lactario';
  readonly zpl: string;
}

export interface ArmazemIdempotencia {
  /** Grava a chave se ainda não existir; devolve true se esta chamada criou a reserva. */
  reservar(chave: string, valor: string, validadeMs: number): Promise<boolean>;
  ler(chave: string): Promise<string | null>;
  /** Apaga a reserva se o valor ainda for `valor` (comparar e apagar, atômico no Valkey). */
  liberar(chave: string, valor: string): Promise<void>;
}

export interface DestinoFila {
  enviar(trabalho: TrabalhoZpl & { readonly id: string }): Promise<void>;
}

export const JANELA_IDEMPOTENCIA_MS = 24 * 60 * 60 * 1000;

export interface ResultadoEnfileiramento {
  readonly id: string;
  /** false: a chave já existia; nenhum trabalho novo foi criado. */
  readonly novo: boolean;
}

export function chaveFila(t: Pick<TrabalhoZpl, 'rede' | 'estabelecimento' | 'chaveIdempotencia'>): string {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(t.chaveIdempotencia)) {
    throw new Error('Idempotency-Key inválida (8 a 128 caracteres: letras, dígitos, . _ : -).');
  }
  if (!t.rede || !t.estabelecimento)
    throw new Error('Rede e estabelecimento são obrigatórios na chave da fila.');
  return `sgh:${t.rede}:${t.estabelecimento}:zpl:${t.chaveIdempotencia}`;
}

export async function enfileirarZpl(
  trabalho: TrabalhoZpl,
  armazem: ArmazemIdempotencia,
  destino: DestinoFila,
  novoId: () => string,
): Promise<ResultadoEnfileiramento> {
  const chave = chaveFila(trabalho);
  const id = novoId();
  const criou = await armazem.reservar(chave, id, JANELA_IDEMPOTENCIA_MS);
  if (!criou) {
    const existente = await armazem.ler(chave);
    return { id: existente ?? id, novo: false };
  }
  try {
    await destino.enviar({ ...trabalho, id });
  } catch (e) {
    await armazem.liberar(chave, id).catch(() => undefined);
    throw e;
  }
  return { id, novo: true };
}

/** Armazém em memória (testes e dev sem Valkey). */
export class ArmazemMemoria implements ArmazemIdempotencia {
  private readonly dados = new Map<string, { valor: string; expira: number }>();
  private readonly agora: () => number;
  constructor(agora: () => number = Date.now) {
    this.agora = agora;
  }
  async reservar(chave: string, valor: string, validadeMs: number): Promise<boolean> {
    const atual = this.dados.get(chave);
    if (atual && atual.expira > this.agora()) return false;
    this.dados.set(chave, { valor, expira: this.agora() + validadeMs });
    return true;
  }
  async ler(chave: string): Promise<string | null> {
    const atual = this.dados.get(chave);
    return atual && atual.expira > this.agora() ? atual.valor : null;
  }
  async liberar(chave: string, valor: string): Promise<void> {
    if (this.dados.get(chave)?.valor === valor) this.dados.delete(chave);
  }
}
