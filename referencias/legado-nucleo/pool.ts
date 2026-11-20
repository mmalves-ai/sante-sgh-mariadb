// Pool por estabelecimento (ARQ-1; cap-10 §10.9): um por código da lista ESTABELECIMENTOS, teto pequeno
// por estabelecimento e teto somado por rede (ARQ-2). A conexão é marcada com o código do seu
// estabelecimento e nunca serve a outro: nenhuma transação cruza bancos.
import { PREFIXO_PAPEL_MODULO_BANCO } from '@sgh/contratos';
import type { Ambiente } from './arquivo-ambiente.js';
import { type ConfiguracaoNucleo, conferirUsuarioFirebird } from './configuracao.js';
import type { ConexaoFirebird, DriverFirebird } from './driver.js';
import {
  buscarEstabelecimento,
  lerContasDeModulo,
  type ContaModulo,
  type Estabelecimento,
} from './estabelecimentos.js';

export class ErroPool extends Error {
  override readonly name = 'ErroPool';
}

/** Conexão emprestada: sabe de qual estabelecimento é. */
export interface ConexaoEmprestada {
  readonly estabelecimento: string;
  readonly conexao: ConexaoFirebird;
}

export interface EstadoPool {
  readonly estabelecimento: string;
  readonly abertas: number;
  readonly livres: number;
  readonly emUso: number;
  readonly esperando: number;
  /** Exceção de dev da conta SYSDBA em uso (pendência DP-15). */
  readonly sysdbaDev: boolean;
  /** M59-F1: sufixo do módulo quando o pool é o da conta do módulo (senão, a conta única). */
  readonly modulo?: string;
}

interface Espera {
  resolver(c: ConexaoEmprestada): void;
  rejeitar(e: Error): void;
  temporizador: ReturnType<typeof setTimeout>;
}

/** Contador das conexões abertas da rede (teto por rede). */
class LimiteRede {
  abertas = 0;
  readonly teto: number;
  private readonly pendentes: (() => void)[] = [];
  constructor(teto: number) {
    this.teto = teto;
  }
  reservar(): boolean {
    if (this.abertas >= this.teto) return false;
    this.abertas++;
    return true;
  }
  liberar(): void {
    this.abertas--;
    this.acordar();
  }
  /** Passa a vaga ao próximo estabelecimento que espera por ela. */
  acordar(): void {
    this.pendentes.shift()?.();
  }
  aguardarVaga(acordar: () => void): void {
    this.pendentes.push(acordar);
  }
  temPendentes(): boolean {
    return this.pendentes.length > 0;
  }
}

/** Variável de sessão que identifica as conexões do novo no MON$CONTEXT_VARIABLES (coletor do M09). */
export const VARIAVEL_SISTEMA = 'SGH_SISTEMA';

/** `sgh:<rede>:<estabelecimento>:<processo>` (SGH_PROCESSO: api, worker, ferramenta…). */
export function marcaDoSistema(rede: string, estabelecimento: string, env: Ambiente): string {
  // Só o simulador de carga do legado do M09 troca a marca (para o coletor contá-lo como "spdata-simulado"),
  // e só com AMBIENTE=dev explícito: fora do dev, uma configuração errada esconderia o novo do alerta de transação longa.
  const fixa = env['SGH_MARCA_CONEXAO']?.trim();
  if (fixa) {
    if (env['AMBIENTE']?.trim() !== 'dev' || !/^legado-simulado[\w:-]*$/.test(fixa)) {
      throw new ErroPool('SGH_MARCA_CONEXAO: só "legado-simulado…" e só em AMBIENTE=dev.');
    }
    return fixa.slice(0, 80);
  }
  const processo = (env['SGH_PROCESSO'] ?? 'sgh').trim().replace(/[^a-z0-9-]/gi, '') || 'sgh';
  return `sgh:${rede}:${estabelecimento}:${processo}`.slice(0, 80);
}

/**
 * Marca a conexão recém-aberta com RDB$SET_CONTEXT (variável de sessão, não grava nada no banco) para o
 * coletor MON$ separar as conexões do novo das do SPDATA e da sante-api. Falha na marca não derruba a
 * conexão (o coletor a conta em "outros").
 */
export async function marcarConexao(c: ConexaoFirebird, marca: string): Promise<void> {
  try {
    const tr = await c.iniciar({ tipo: 'leitura' });
    try {
      await tr.consultar(
        `SELECT RDB$SET_CONTEXT('USER_SESSION', '${VARIAVEL_SISTEMA}', ?) X FROM RDB$DATABASE`,
        [marca],
        {
          teto: 1,
        },
      );
    } finally {
      await tr.desfazer();
    }
  } catch {
    // sem marca: a conexão segue válida
  }
}

/**
 * Papel SQL da conexão (M04): toda conta que não é SYSDBA conecta com SGH_APLICACAO, que recebe os
 * privilégios das tabelas SGH_ pelos scripts (em SGH_TRILHA, só SELECT e INSERT). Papel não concedido à
 * conta não dá erro no Firebird 3: a conexão segue sem os privilégios dele.
 */
export function papelDaConta(usuario: string): string | null {
  return usuario.trim().toUpperCase() === 'SYSDBA' ? null : 'SGH_APLICACAO';
}

/** O estabelecimento com a conta do módulo no lugar da conta única (a senha segue não enumerável). */
function estabelecimentoDaConta(est: Estabelecimento, conta: ContaModulo): Estabelecimento {
  const e = {
    codigo: est.codigo,
    nome: est.nome,
    host: est.host,
    porta: est.porta,
    banco: est.banco,
    usuario: conta.usuario,
  };
  Object.defineProperty(e, 'senha', { value: conta.senha, enumerable: false });
  return Object.freeze(e) as Estabelecimento;
}

export class PoolEstabelecimento {
  readonly estabelecimento: Estabelecimento;
  readonly sysdbaDev: boolean;
  private readonly driver: DriverFirebird;
  private readonly config: ConfiguracaoNucleo;
  private readonly rede: LimiteRede;
  private readonly livres: ConexaoFirebird[] = [];
  private readonly emUso = new Set<ConexaoFirebird>();
  private readonly esperas: Espera[] = [];
  private abrindo = 0;
  private encerrado = false;
  /** Marca da conexão no banco (USER_SESSION.SGH_SISTEMA), lida pelo coletor MON$ do M09. */
  readonly marca: string | null;
  /** M59-F1: papel SQL da conexão (SGH_APLICACAO na conta única; SGH_MOD_<MODULO> na conta do módulo). */
  readonly papel: string | null;
  /** M59-F1: sufixo do módulo da conta (null na conta única). */
  readonly modulo: string | null;

  constructor(
    est: Estabelecimento,
    driver: DriverFirebird,
    config: ConfiguracaoNucleo,
    rede: LimiteRede,
    env: Ambiente,
    marca: string | null = null,
    contaModulo: ContaModulo | null = null,
  ) {
    this.sysdbaDev = conferirUsuarioFirebird(est, env);
    this.estabelecimento = contaModulo ? estabelecimentoDaConta(est, contaModulo) : est;
    this.driver = driver;
    this.config = config;
    this.rede = rede;
    this.marca = marca;
    this.modulo = contaModulo?.sufixo ?? null;
    this.papel = contaModulo
      ? `${PREFIXO_PAPEL_MODULO_BANCO}${contaModulo.sufixo}`
      : papelDaConta(est.usuario);
  }

  get codigo(): string {
    return this.estabelecimento.codigo;
  }

  estado(): EstadoPool {
    return {
      estabelecimento: this.codigo,
      abertas: this.livres.length + this.emUso.size + this.abrindo,
      livres: this.livres.length,
      emUso: this.emUso.size,
      esperando: this.esperas.length,
      sysdbaDev: this.sysdbaDev,
      ...(this.modulo ? { modulo: this.modulo } : {}),
    };
  }

  private emprestar(c: ConexaoFirebird): ConexaoEmprestada {
    this.emUso.add(c);
    return { estabelecimento: this.codigo, conexao: c };
  }

  async obter(): Promise<ConexaoEmprestada> {
    if (this.encerrado) throw new ErroPool(`Pool do estabelecimento "${this.codigo}" encerrado.`);
    while (this.livres.length > 0) {
      const c = this.livres.pop() as ConexaoFirebird;
      if (c.valida) return this.emprestar(c);
      this.rede.liberar();
    }
    if (this.estado().abertas < this.config.tetoPorEstabelecimento && this.rede.reservar()) {
      return this.emprestar(await this.abrir());
    }
    return this.esperar();
  }

  private async abrir(): Promise<ConexaoFirebird> {
    this.abrindo++;
    try {
      const e = this.estabelecimento;
      const c = await this.driver.conectar({
        host: e.host,
        porta: e.porta,
        banco: e.banco,
        usuario: e.usuario,
        senha: e.senha,
        ...(this.papel ? { papel: this.papel } : {}),
      });
      if (this.marca) await marcarConexao(c, this.marca);
      return c;
    } catch (erro) {
      this.rede.liberar();
      throw erro;
    } finally {
      this.abrindo--;
    }
  }

  private esperar(): Promise<ConexaoEmprestada> {
    return new Promise((resolver, rejeitar) => {
      const espera: Espera = {
        resolver,
        rejeitar,
        temporizador: setTimeout(() => {
          const i = this.esperas.indexOf(espera);
          if (i >= 0) this.esperas.splice(i, 1);
          rejeitar(
            new ErroPool(`Sem conexão livre para "${this.codigo}" em ${this.config.esperaConexaoMs} ms.`),
          );
        }, this.config.esperaConexaoMs),
      };
      this.esperas.push(espera);
      // Teto da rede: quando outro estabelecimento liberar uma vaga, abre aqui.
      if (this.estado().abertas < this.config.tetoPorEstabelecimento) {
        this.rede.aguardarVaga(() => this.atenderComVagaDaRede());
      }
    });
  }

  private atenderComVagaDaRede(): void {
    const espera = this.esperas.shift();
    if (!espera) {
      this.rede.acordar(); // a espera daqui já venceu: a vaga vai para o próximo
      return;
    }
    if (!this.rede.reservar()) {
      this.esperas.unshift(espera);
      this.rede.aguardarVaga(() => this.atenderComVagaDaRede());
      return;
    }
    clearTimeout(espera.temporizador);
    this.abrir().then(
      (c) => espera.resolver(this.emprestar(c)),
      (e: unknown) => espera.rejeitar(e instanceof Error ? e : new ErroPool(String(e))),
    );
  }

  /** Devolve a conexão. `descartar`: fecha (ex.: conexão quebrada). */
  async devolver(emprestada: ConexaoEmprestada, descartar = false): Promise<void> {
    if (emprestada.estabelecimento !== this.codigo || !this.emUso.has(emprestada.conexao)) {
      throw new ErroPool('Conexão devolvida ao pool de outro estabelecimento.');
    }
    const c = emprestada.conexao;
    this.emUso.delete(c);
    if (descartar || !c.valida || this.encerrado) {
      await this.fecharUma(c);
      this.repor();
      return;
    }
    const espera = this.esperas.shift();
    if (espera) {
      clearTimeout(espera.temporizador);
      espera.resolver(this.emprestar(c));
      return;
    }
    if (this.rede.temPendentes()) {
      // Outro estabelecimento da rede espera vaga: esta conexão ociosa cede a vaga.
      await this.fecharUma(c);
      return;
    }
    this.livres.push(c);
  }

  /** Depois de fechar uma conexão, quem espera aqui pode abrir outra. */
  private repor(): void {
    if (this.esperas.length > 0) this.atenderComVagaDaRede();
  }

  private async fecharUma(c: ConexaoFirebird): Promise<void> {
    try {
      await c.fechar();
    } catch {
      // conexão já caída: nada a fazer
    } finally {
      this.rede.liberar();
    }
  }

  async encerrar(): Promise<void> {
    this.encerrado = true;
    for (const e of this.esperas.splice(0)) {
      clearTimeout(e.temporizador);
      e.rejeitar(new ErroPool(`Pool do estabelecimento "${this.codigo}" encerrado.`));
    }
    await Promise.all(this.livres.splice(0).map((c) => this.fecharUma(c)));
  }
}

/** Os pools de uma rede: um por estabelecimento configurado. */
export class PoolsDaRede {
  readonly rede: string;
  private readonly pools = new Map<string, PoolEstabelecimento>();
  /** M59-F1: pools das contas por módulo, por estabelecimento e sufixo do módulo. */
  private readonly porModulo = new Map<string, Map<string, PoolEstabelecimento>>();
  private readonly lista: readonly Estabelecimento[];

  constructor(
    rede: string,
    estabelecimentos: readonly Estabelecimento[],
    driver: DriverFirebird,
    config: ConfiguracaoNucleo,
    env: Ambiente,
  ) {
    this.rede = rede;
    this.lista = estabelecimentos;
    const limite = new LimiteRede(config.tetoPorRede);
    for (const est of estabelecimentos) {
      const marca = marcaDoSistema(rede, est.codigo, env);
      this.pools.set(est.codigo, new PoolEstabelecimento(est, driver, config, limite, env, marca));
      const mods = new Map<string, PoolEstabelecimento>();
      for (const conta of lerContasDeModulo(est.codigo, env)) {
        mods.set(conta.sufixo, new PoolEstabelecimento(est, driver, config, limite, env, marca, conta));
      }
      if (mods.size > 0) this.porModulo.set(est.codigo, mods);
    }
  }

  get codigos(): string[] {
    return [...this.pools.keys()];
  }

  /**
   * Pool do estabelecimento da sessão. Código fora da configuração é erro (nunca cai em outro banco). Com o módulo
   * (M59-F1, `sufixoModuloBanco`): o pool da conta do módulo, se a TI já a configurou; senão, o da conta única.
   */
  para(codigo: string, sufixoModulo?: string | null): PoolEstabelecimento {
    const pool = this.pools.get(codigo);
    if (!pool) {
      buscarEstabelecimento(this.lista, codigo); // lança a mensagem padrão com os códigos configurados
      throw new ErroPool(`Estabelecimento "${codigo}" sem pool.`);
    }
    if (sufixoModulo) return this.porModulo.get(codigo)?.get(sufixoModulo) ?? pool;
    return pool;
  }

  /** Sufixos dos módulos com conta própria no estabelecimento (M59-F1). */
  modulosComConta(codigo: string): string[] {
    return [...(this.porModulo.get(codigo)?.keys() ?? [])].sort();
  }

  private todos(): PoolEstabelecimento[] {
    return [...this.pools.values(), ...[...this.porModulo.values()].flatMap((m) => [...m.values()])];
  }

  estados(): EstadoPool[] {
    return this.todos().map((p) => p.estado());
  }

  async encerrar(): Promise<void> {
    await Promise.all(this.todos().map((p) => p.encerrar()));
  }
}
