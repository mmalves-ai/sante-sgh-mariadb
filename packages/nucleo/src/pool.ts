// Pools do MariaDB, um por banco de cliente, resolvidos pela plataforma (plataforma.cliente.banco_nome) e guardados
// em cache. Datas em UTC (ADR 0002: DATETIME(3) sempre em UTC); BIGINT como number com conferência de faixa;
// DECIMAL como texto (dinheiro sem perda). Nesta fase só o servidor "local" (o mesmo da plataforma).
import * as mariadb from 'mariadb';
import { type ConfiguracaoNucleo, FORMATO_NOME_BANCO } from './configuracao.js';
import { FORMATO_CLIENTE } from './contexto.js';
import { ErroClienteDesconhecido, ErroConfiguracao } from './erros.js';
import type { ConexaoBanco, FonteConexoes } from './transacao.js';

export const FORMATO_BANCO_CLIENTE = /^cliente_[a-z][a-z0-9_]{1,39}$/;

export interface InfoCliente {
  readonly codigo: string;
  readonly banco: string;
  readonly situacao: string;
}

export interface EstadoPool {
  readonly banco: string;
  readonly ativas: number;
  readonly ociosas: number;
  readonly total: number;
}

/** Fábrica do pool (o driver real; os testes podem trocar). */
export type CriarPool = (opcoes: mariadb.PoolConfig) => mariadb.Pool;

/** Opções do driver para um banco (sem log: a senha está aqui). */
export function opcoesDoPool(config: ConfiguracaoNucleo, banco: string): mariadb.PoolConfig {
  if (!FORMATO_NOME_BANCO.test(banco)) throw new ErroConfiguracao('Nome de banco inválido.');
  return {
    host: config.host,
    port: config.porta,
    user: config.usuario,
    password: config.senha,
    database: banco,
    connectionLimit: config.tetoPorBanco,
    acquireTimeout: config.esperaConexaoMs,
    timezone: 'Z',
    bigIntAsNumber: true,
    insertIdAsNumber: true,
    decimalAsNumber: false,
    checkNumberRange: true,
    multipleStatements: false,
    charset: 'utf8mb4',
    // O processo (api, worker, api-k6...) marca a conexão: o coletor de transações do k6 separa a carga por ele.
    connectAttributes: { program_name: process.env['SGH_PROCESSO'] ?? 'sgh' },
    initSql: [
      "SET time_zone = '+00:00'",
      `SET SESSION innodb_lock_wait_timeout = ${config.esperaTravaSegundos}`,
    ],
  };
}

/** Conexão do driver no formato que o Leitor e o Escritor usam. */
export function conexaoDoDriver(c: mariadb.PoolConnection): ConexaoBanco {
  return {
    consultar: (sql, parametros, tempoMaximoMs) =>
      c.query(tempoMaximoMs === undefined ? sql : { sql, timeout: tempoMaximoMs }, [...parametros]),
    iniciar: () => c.beginTransaction(),
    iniciarSomenteLeitura: async () => {
      await c.query('START TRANSACTION READ ONLY');
    },
    confirmar: () => c.commit(),
    desfazer: () => c.rollback(),
    devolver: async (descartar) => {
      if (descartar) c.destroy();
      else await c.release();
    },
  };
}

export class PoolsPorCliente {
  private plataforma: mariadb.Pool | null = null;
  private readonly pools = new Map<string, mariadb.Pool>();
  private readonly clientes = new Map<string, Promise<InfoCliente>>();
  private encerrado = false;

  private readonly config: ConfiguracaoNucleo;
  private readonly criarPool: CriarPool;

  // Campos explícitos (sem propriedade de parâmetro): o node com remoção de tipos e o erasableSyntaxOnly das
  // ferramentas recusam a forma abreviada.
  constructor(config: ConfiguracaoNucleo, criarPool: CriarPool = mariadb.createPool) {
    this.config = config;
    this.criarPool = criarPool;
  }

  private poolDo(banco: string): mariadb.Pool {
    if (this.encerrado) throw new ErroConfiguracao('Pools encerrados.');
    let p = this.pools.get(banco);
    if (!p) {
      p = this.criarPool(opcoesDoPool(this.config, banco));
      this.pools.set(banco, p);
    }
    return p;
  }

  private poolDaPlataforma(): mariadb.Pool {
    if (this.encerrado) throw new ErroConfiguracao('Pools encerrados.');
    this.plataforma ??= this.criarPool({
      ...opcoesDoPool(this.config, this.config.bancoPlataforma),
      connectionLimit: 2,
    });
    return this.plataforma;
  }

  /** O banco do cliente, pela plataforma (com cache; erro não fica em cache). */
  resolverCliente(codigo: string): Promise<InfoCliente> {
    if (!FORMATO_CLIENTE.test(codigo))
      return Promise.reject(new ErroClienteDesconhecido('Código de cliente inválido.'));
    let p = this.clientes.get(codigo);
    if (!p) {
      p = this.buscarCliente(codigo);
      this.clientes.set(codigo, p);
      p.catch(() => this.clientes.delete(codigo));
    }
    return p;
  }

  private async buscarCliente(codigo: string): Promise<InfoCliente> {
    const linhas = (await this.poolDaPlataforma().query(
      'SELECT codigo, banco_nome, banco_servidor, situacao FROM cliente WHERE codigo = ?',
      [codigo],
    )) as { codigo: string; banco_nome: string; banco_servidor: string; situacao: string }[];
    const l = linhas[0];
    if (!l) throw new ErroClienteDesconhecido(`Cliente "${codigo}" não registrado na plataforma.`);
    if (l.situacao === 'encerrado') throw new ErroClienteDesconhecido(`Cliente "${codigo}" encerrado.`);
    if (l.banco_servidor !== 'local')
      throw new ErroConfiguracao(`Cliente "${codigo}": só o servidor "local" é atendido nesta versão.`);
    if (!FORMATO_BANCO_CLIENTE.test(l.banco_nome))
      throw new ErroConfiguracao(`Cliente "${codigo}": nome de banco fora do padrão cliente_<codigo>.`);
    return { codigo: l.codigo, banco: l.banco_nome, situacao: l.situacao };
  }

  /** Fonte das conexões do banco do cliente. */
  async fonte(codigo: string): Promise<FonteConexoes> {
    const info = await this.resolverCliente(codigo);
    const pool = this.poolDo(info.banco);
    return {
      cliente: info.codigo,
      banco: info.banco,
      obter: async () => conexaoDoDriver(await pool.getConnection()),
    };
  }

  /**
   * Fonte das conexões do banco plataforma (credencial do administrador da plataforma e lista de clientes; decisão
   * do dono 2026-11-20, b). O "cliente" desta fonte é o nome do banco plataforma: nenhum contexto de cliente a usa.
   */
  fontePlataforma(): FonteConexoes {
    const pool = this.poolDaPlataforma();
    const banco = this.config.bancoPlataforma;
    return { cliente: banco, banco, obter: async () => conexaoDoDriver(await pool.getConnection()) };
  }

  /** Esquece o cliente (mudou de banco ou de situação): a próxima chamada relê a plataforma. */
  esquecer(codigo: string): void {
    this.clientes.delete(codigo);
  }

  /** A plataforma responde? */
  async plataformaResponde(): Promise<boolean> {
    try {
      await this.poolDaPlataforma().query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  estados(): EstadoPool[] {
    return [...this.pools.entries()].map(([banco, p]) => ({
      banco,
      ativas: p.activeConnections(),
      ociosas: p.idleConnections(),
      total: p.totalConnections(),
    }));
  }

  async encerrar(): Promise<void> {
    this.encerrado = true;
    const todos = [...this.pools.values(), ...(this.plataforma ? [this.plataforma] : [])];
    this.pools.clear();
    this.plataforma = null;
    this.clientes.clear();
    await Promise.allSettled(todos.map((p) => p.end()));
  }
}
