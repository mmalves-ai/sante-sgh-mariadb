// Implementação do driver sobre node-firebird-driver-native 3.7.1 + fbclient oficial (TEC-1, ADR 0010).
// Único arquivo do repositório que importa o driver Firebird (fronteira: só @sgh/legado o conhece).
// - charSetForNONE: a tabela CP1252 sem perda de cp1252.ts, registrada no iconv-lite 0.7.3 (o 'win1252'
//   do iconv-lite troca 5 bytes por U+FFFD; nunca o padrão 'utf8', que troca todo acento).
// - Linhas afetadas e LOCK TIMEOUT usam a API nativa por baixo do driver (ele não os expõe).
import { createRequire } from 'node:module';
import {
  type Attachment,
  type Client,
  type Statement,
  type Transaction,
  Blob as BlobFb,
  createNativeClient,
} from 'node-firebird-driver-native';
import { registrarCodificacaoNone } from './cp1252.js';
import {
  BIBLIOTECA_CLIENTE_PADRAO,
  type ComandoPreparado,
  type ConexaoFirebird,
  conferirSqlAscii,
  sqlCompativelComFirebird5,
  type DestinoConexao,
  type DriverFirebird,
  type Linha,
  type ModoTransacao,
  type OpcoesConsulta,
  type ResultadoConsulta,
  type TransacaoFirebird,
} from './driver.js';

// Peças internas do driver, usadas só para o que a API pública não oferece.
interface StatusAction {
  statusAction<T>(acao: (status: unknown) => Promise<T>): Promise<T>;
}
interface AnexoInterno {
  client: StatusAction;
  attachmentHandle: { startTransactionAsync(status: unknown, n: number, tpb: Uint8Array): Promise<unknown> };
  transactions: Set<unknown>;
}
interface ComandoInterno {
  statementHandle: { getAffectedRecordsAsync(status: unknown): Promise<number> };
}
const exigir = createRequire(import.meta.url);
const { TransactionImpl } = exigir('node-firebird-driver-native/dist/lib/transaction') as {
  TransactionImpl: new (anexo: unknown) => Transaction & { transactionHandle: unknown };
};

// Constantes do TPB (ibase.h).
const TPB = {
  version1: 1,
  concurrency: 2,
  wait: 6,
  nowait: 7,
  write: 9,
  read_committed: 15,
  rec_version: 17,
  lock_timeout: 21,
};

/**
 * TPB de escrita: READ COMMITTED RECORD_VERSION (padrão) ou SNAPSHOT (`instantaneo`, CONCURRENCY: a transação
 * vê o banco como estava quando começou; a captura de assinatura do M03 usa para que um COMMIT de outro
 * sistema na cópia compartilhada não apareça como efeito do cenário), WAIT com LOCK TIMEOUT em segundos.
 */
export function tpbEscrita(lockTimeoutSegundos: number, instantaneo = false, semEspera = false): Uint8Array {
  if (!Number.isInteger(lockTimeoutSegundos) || lockTimeoutSegundos < 1 || lockTimeoutSegundos > 60) {
    throw new Error('LOCK TIMEOUT inválido (de 1 a 60 segundos).');
  }
  const isolamento = instantaneo ? [TPB.concurrency] : [TPB.read_committed, TPB.rec_version];
  // M19: NO WAIT (fila concorrente): a trava ocupada falha na hora, sem LOCK TIMEOUT.
  if (semEspera) return Uint8Array.from([TPB.version1, TPB.write, TPB.nowait, ...isolamento]);
  const cabeca = [TPB.version1, TPB.write, TPB.wait, ...isolamento, TPB.lock_timeout, 4];
  const t = new Uint8Array(cabeca.length + 4);
  t.set(cabeca);
  new DataView(t.buffer).setInt32(cabeca.length, lockTimeoutSegundos, true);
  return t;
}

class TransacaoNativa implements TransacaoFirebird {
  private readonly anexo: Attachment;
  private readonly tr: Transaction;
  constructor(anexo: Attachment, tr: Transaction) {
    this.anexo = anexo;
    this.tr = tr;
  }

  async consultar(
    sql: string,
    parametros: readonly unknown[],
    opcoes: OpcoesConsulta,
  ): Promise<ResultadoConsulta> {
    conferirSqlAscii(sql);
    const rs = await this.anexo.executeQuery(this.tr, sqlCompativelComFirebird5(sql), [...parametros]);
    try {
      const linhas: Linha[] = [];
      const limite = opcoes.teto + 1;
      while (linhas.length < limite) {
        const lote = await rs.fetchAsObject<Linha>({ fetchSize: Math.min(200, limite - linhas.length) });
        if (lote.length === 0) break;
        linhas.push(...lote);
      }
      const estourou = linhas.length > opcoes.teto;
      return { linhas: estourou ? linhas.slice(0, opcoes.teto) : linhas, estourou };
    } finally {
      await rs.close();
    }
  }

  async executar(sql: string, parametros: readonly unknown[]): Promise<number> {
    conferirSqlAscii(sql);
    const st: Statement = await this.anexo.prepare(this.tr, sqlCompativelComFirebird5(sql));
    try {
      await st.execute(this.tr, [...parametros]);
      const interno = st as unknown as ComandoInterno;
      return await (this.anexo as unknown as AnexoInterno).client.statusAction((s) =>
        interno.statementHandle.getAffectedRecordsAsync(s),
      );
    } finally {
      await st.dispose();
    }
  }

  async executarRetornando(sql: string, parametros: readonly unknown[]): Promise<Linha> {
    conferirSqlAscii(sql);
    return this.anexo.executeSingletonAsObject<Linha>(this.tr, sqlCompativelComFirebird5(sql), [
      ...parametros,
    ]);
  }

  async lerBlob(blob: unknown): Promise<Buffer> {
    if (!(blob instanceof BlobFb)) throw new Error('Valor não é BLOB.');
    const fluxo = await this.anexo.openBlob(this.tr, blob);
    try {
      const tamanho = await fluxo.length;
      const buf = Buffer.alloc(tamanho);
      let lido = 0;
      while (lido < tamanho) {
        const n = await fluxo.read(buf.subarray(lido));
        if (n <= 0) break;
        lido += n;
      }
      return buf.subarray(0, lido);
    } finally {
      await fluxo.close();
    }
  }

  async percorrer(
    sql: string,
    parametros: readonly unknown[],
    tamanhoLote: number,
    aoLote: (linhas: Linha[]) => Promise<void>,
  ): Promise<number> {
    conferirSqlAscii(sql);
    const rs = await this.anexo.executeQuery(this.tr, sqlCompativelComFirebird5(sql), [...parametros]);
    let total = 0;
    try {
      for (;;) {
        const lote = await rs.fetchAsObject<Linha>({ fetchSize: tamanhoLote });
        if (lote.length === 0) break;
        total += lote.length;
        await aoLote(lote);
      }
      return total;
    } finally {
      await rs.close();
    }
  }

  async preparar(sql: string): Promise<ComandoPreparado> {
    conferirSqlAscii(sql);
    const st: Statement = await this.anexo.prepare(this.tr, sqlCompativelComFirebird5(sql));
    const tr = this.tr;
    return {
      executar: async (parametros) => {
        await st.execute(tr, [...parametros]);
      },
      liberar: () => st.dispose(),
    };
  }

  confirmar(): Promise<void> {
    return this.tr.commit();
  }

  desfazer(): Promise<void> {
    return this.tr.isValid ? this.tr.rollback() : Promise.resolve();
  }
}

class ConexaoNativa implements ConexaoFirebird {
  private readonly anexo: Attachment;
  constructor(anexo: Attachment) {
    this.anexo = anexo;
  }

  get valida(): boolean {
    return this.anexo.isValid;
  }

  async iniciar(modo: ModoTransacao): Promise<TransacaoFirebird> {
    if (modo.tipo === 'leitura') {
      const tr = await this.anexo.startTransaction({
        accessMode: 'READ_ONLY',
        isolation: 'READ_COMMITTED' as never,
        readCommittedMode: 'RECORD_VERSION',
      });
      return new TransacaoNativa(this.anexo, tr);
    }
    const interno = this.anexo as unknown as AnexoInterno;
    const tpb = tpbEscrita(modo.lockTimeoutSegundos, modo.instantaneo === true, modo.semEspera === true);
    const tr = new TransactionImpl(this.anexo);
    tr.transactionHandle = await interno.client.statusAction((s) =>
      interno.attachmentHandle.startTransactionAsync(s, tpb.length, tpb),
    );
    interno.transactions.add(tr);
    return new TransacaoNativa(this.anexo, tr);
  }

  async cancelar(): Promise<void> {
    await this.anexo.cancelOperation(false);
  }

  async fechar(): Promise<void> {
    if (this.anexo.isValid) await this.anexo.disconnect();
  }
}

export interface OpcoesDriverNativo {
  /** Caminho da libfbclient (FB_CLIENTE_BIBLIOTECA); padrão: libfbclient.so.2 do sistema. */
  readonly biblioteca?: string;
}

/**
 * Um cliente nativo por biblioteca no processo, com contagem de uso e referência forte (ADR 0010, M09).
 * O node-firebird-native-api 3.3.0 formata a mensagem de todo erro do Firebird com o primeiro Master da sua
 * tabela global, que não é limpa quando um cliente sem dispose é coletado pelo GC: o próximo erro cai com
 * SIGSEGV no thread do libuv (`formatStatus`). Com o cliente compartilhado e guardado aqui, nenhum driver
 * esquecido sem `encerrar()` deixa Master pendurado; o dispose só acontece quando o último driver encerra.
 */
const clientes = new Map<string, { cliente: Client; usos: number }>();

function tomarCliente(biblioteca: string): Client {
  const c = clientes.get(biblioteca);
  if (c) {
    c.usos++;
    return c.cliente;
  }
  const cliente = createNativeClient(biblioteca);
  clientes.set(biblioteca, { cliente, usos: 1 });
  return cliente;
}

async function soltarCliente(biblioteca: string): Promise<void> {
  const c = clientes.get(biblioteca);
  if (!c) return;
  if (--c.usos > 0) return;
  clientes.delete(biblioteca);
  await c.cliente.dispose();
}

/** Clientes nativos vivos no processo (prova do compartilhamento). */
export function clientesNativosAbertos(): number {
  return clientes.size;
}

export function criarDriverNativo(opcoes: OpcoesDriverNativo = {}): DriverFirebird {
  const charSetForNONE = registrarCodificacaoNone();
  const biblioteca = opcoes.biblioteca ?? BIBLIOTECA_CLIENTE_PADRAO;
  let cliente: Client | null = null;
  const obterCliente = (): Client => (cliente ??= tomarCliente(biblioteca));
  return {
    nome: 'node-firebird-driver-native',
    async conectar(d: DestinoConexao): Promise<ConexaoFirebird> {
      const anexo = await obterCliente().connect(`inet://${d.host}:${d.porta}/${d.banco}`, {
        username: d.usuario,
        password: d.senha,
        ...(d.papel ? { role: d.papel } : {}),
        charSetForNONE,
      });
      await anexo.enableCancellation(true);
      return new ConexaoNativa(anexo);
    },
    async encerrar(): Promise<void> {
      if (cliente) await soltarCliente(biblioteca);
      cliente = null;
    },
  };
}
