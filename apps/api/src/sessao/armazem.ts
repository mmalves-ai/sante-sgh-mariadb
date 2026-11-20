// Armazém de sessões no servidor (ficha do M05): nada no navegador além do cookie. Interface com chaves já
// prefixadas pela rede (ARQ-2) pelo chamador. Duas implementações: memória (testes e dev sem Valkey) e
// Valkey (produção/dev). Guarda JSON pequeno (sem senha, sem hash) com expiração.
export interface ArmazemSessao {
  obter(chave: string): Promise<string | null>;
  gravar(chave: string, valor: string, ttlSegundos: number): Promise<void>;
  apagar(chave: string): Promise<void>;
  /** Lê e apaga numa operação só (GETDEL no Valkey): de dois pedidos simultâneos, só um recebe o valor. */
  consumir(chave: string): Promise<string | null>;
  /** Incrementa um contador (tentativas da porta) e devolve o novo valor, com expiração na primeira vez. */
  incrementar(chave: string, ttlSegundos: number): Promise<number>;
  encerrar(): Promise<void>;
}

interface Entrada {
  valor: string;
  expiraEm: number;
}

/** Em memória, para testes e para dev sem Valkey no ar. Não compartilha entre processos. */
export class ArmazemMemoria implements ArmazemSessao {
  private readonly mapa = new Map<string, Entrada>();
  constructor(private readonly agora: () => number = () => Date.now()) {}

  private vivo(chave: string): Entrada | null {
    const e = this.mapa.get(chave);
    if (!e) return null;
    if (e.expiraEm <= this.agora()) {
      this.mapa.delete(chave);
      return null;
    }
    return e;
  }

  obter(chave: string): Promise<string | null> {
    return Promise.resolve(this.vivo(chave)?.valor ?? null);
  }
  gravar(chave: string, valor: string, ttlSegundos: number): Promise<void> {
    this.mapa.set(chave, { valor, expiraEm: this.agora() + ttlSegundos * 1000 });
    return Promise.resolve();
  }
  apagar(chave: string): Promise<void> {
    this.mapa.delete(chave);
    return Promise.resolve();
  }
  consumir(chave: string): Promise<string | null> {
    // Síncrono entre a leitura e a remoção: nenhum outro pedido se intercala no laço de eventos.
    const valor = this.vivo(chave)?.valor ?? null;
    this.mapa.delete(chave);
    return Promise.resolve(valor);
  }
  incrementar(chave: string, ttlSegundos: number): Promise<number> {
    const e = this.vivo(chave);
    const n = (e ? Number(e.valor) : 0) + 1;
    this.mapa.set(chave, { valor: String(n), expiraEm: e?.expiraEm ?? this.agora() + ttlSegundos * 1000 });
    return Promise.resolve(n);
  }
  encerrar(): Promise<void> {
    this.mapa.clear();
    return Promise.resolve();
  }
}
