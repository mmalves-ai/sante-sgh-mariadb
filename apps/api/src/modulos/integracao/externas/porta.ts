// Central de integrações externas (decisão 53): a porta da configuração por cliente. Duas implementações:
// - PortaIntegracoesExternasPropria: o banco do cliente (configuracao_integracao_externa), pelo Executor (trilha e
//   idempotência na mesma transação). A credencial nunca entra na entrada do executor: vai só ao cofre, dentro da
//   transação que registra que ela foi guardada;
// - PortaIntegracoesExternasMemoria: a fonte sintética de dev/ci e os testes (mesmas regras, nada em disco).
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  type TxOperacao,
} from '@sgh/nucleo';
import { MODOS_INTEGRACAO_EXTERNA, type ModoIntegracaoExterna } from '@sgh/contratos';
import { z } from 'zod';

export interface LinhaIntegracaoExterna {
  readonly integracao: string;
  readonly modo: ModoIntegracaoExterna;
  readonly parametros: Readonly<Record<string, string>>;
  readonly versao: number;
  readonly alteradoEm: Date | null;
  readonly alteradoPor: string | null;
  readonly modoAlteradoEm: Date | null;
  readonly ultimaFalhaEm: Date | null;
  readonly ultimaFalha: string | null;
}

/** Quem grava: a sessão (estabelecimento e login), a correlação e a chave de idempotência do pedido. */
export interface GravacaoIntegracaoExterna {
  readonly hospital: string;
  readonly login: string;
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
  /** Instante da reautenticação (senha de novo), exigida pelas operações críticas. */
  readonly reautenticadoEm?: number;
}

export interface PortaIntegracoesExternas {
  readonly destino: 'banco' | 'memoria';
  ler(): Promise<LinhaIntegracaoExterna[]>;
  gravarParametros(
    c: GravacaoIntegracaoExterna,
    integracao: string,
    referencia: string,
    parametros: Readonly<Record<string, string>>,
  ): Promise<void>;
  /** Registra (trilha) que a credencial do campo foi guardada; `guardar` grava o valor no cofre na mesma transação. */
  registrarCredencial(
    c: GravacaoIntegracaoExterna,
    integracao: string,
    referencia: string,
    campo: string,
    guardar: () => Promise<void>,
  ): Promise<void>;
  definirModo(
    c: GravacaoIntegracaoExterna,
    integracao: string,
    referencia: string,
    modo: ModoIntegracaoExterna,
    justificativa: string,
  ): Promise<void>;
  /** O adaptador registra a falha do real (sem dado de pessoa nem segredo no motivo). */
  registrarFalha(integracao: string, referencia: string, motivo: string): Promise<void>;
}

const T = 'configuracao_integracao_externa';
const num = (v: unknown) => Number(v);
const data = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(String(v)) : null);
function parametrosDe(v: unknown): Record<string, string> {
  if (v === null || v === undefined) return {};
  const o = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, String(x)]));
}

const esquemaParametros = z.object({
  integracao: z.string(),
  referencia: z.string(),
  parametros: z.record(z.string(), z.string()),
});
const esquemaCredencial = z.object({ integracao: z.string(), referencia: z.string(), campo: z.string() });
const esquemaModo = z.object({
  integracao: z.string(),
  referencia: z.string(),
  modo: z.enum(MODOS_INTEGRACAO_EXTERNA),
  justificativa: z.string(),
});
const esquemaFalha = z.object({ integracao: z.string(), referencia: z.string(), motivo: z.string() });

type NucleoIntegracao = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

export class PortaIntegracoesExternasPropria implements PortaIntegracoesExternas {
  readonly destino = 'banco' as const;
  private executorCache: Executor | null = null;
  private get executor(): Executor {
    return (this.executorCache ??= this.nucleo.criarExecutor());
  }

  constructor(
    private readonly nucleo: NucleoIntegracao,
    private readonly cliente: string,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  /** A linha da integração, criada no modo simulador quando ainda não existe (travada para a gravação). */
  private async linha(tx: TxOperacao, integracao: string, referencia: string) {
    const r = await tx.uma(`SELECT id, versao FROM ${T} WHERE integracao = ? FOR UPDATE`, [integracao]);
    if (r) return { id: num(r['id']), versao: num(r['versao']) };
    const id = await tx.incluir(T, {
      integracao,
      modo: 'simulador',
      parametros: null,
      referencia_cofre: referencia,
      origem: 'sistema',
    });
    return { id, versao: 1 };
  }

  private readonly opParametros = definirOperacao<z.infer<typeof esquemaParametros>, { id: number }>({
    nome: 'integracao_externa.parametros_gravar',
    tabelas: [T],
    entrada: esquemaParametros,
    gravar: async (tx, e) => {
      const l = await this.linha(tx, e.integracao, e.referencia);
      await tx.alterar(T, l.id, l.versao, { parametros: JSON.stringify(e.parametros) });
      return { id: l.id };
    },
    alvo: (_e, r) => ({ tabela: T, id: r.id }),
  });

  private readonly opModo = definirOperacao<z.infer<typeof esquemaModo>, { id: number }>({
    nome: 'integracao_externa.modo_definir',
    tabelas: [T],
    entrada: esquemaModo,
    critica: true,
    gravar: async (tx, e, ctx) => {
      const l = await this.linha(tx, e.integracao, e.referencia);
      await tx.alterar(T, l.id, l.versao, {
        modo: e.modo,
        modo_alterado_em: this.agora(),
        modo_alterado_por: ctx.usuario ?? null,
      });
      return { id: l.id };
    },
    alvo: (_e, r) => ({ tabela: T, id: r.id }),
    trilha: (e) => ({ motivo: e.justificativa }),
  });

  private readonly opFalha = definirOperacao<z.infer<typeof esquemaFalha>, { id: number }>({
    nome: 'integracao_externa.falha_registrar',
    tabelas: [T],
    entrada: esquemaFalha,
    gravar: async (tx, e) => {
      const l = await this.linha(tx, e.integracao, e.referencia);
      await tx.alterar(T, l.id, l.versao, {
        ultima_falha_em: this.agora(),
        ultima_falha: e.motivo.slice(0, 500),
      });
      return { id: l.id };
    },
    alvo: (_e, r) => ({ tabela: T, id: r.id }),
  });

  private async quem(l: Leitor, hospital: string) {
    const e = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
      hospital,
    ]);
    if (!e)
      throw new ErroOperacao(
        403,
        'estabelecimento-desconhecido',
        'Estabelecimento',
        'O estabelecimento da sessão não existe no cliente.',
      );
    return num(e['id']);
  }

  private async contexto(c: GravacaoIntegracaoExterna): Promise<ContextoOperacao> {
    const q = await this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'integracao.externas' },
      async (l) => {
        const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [c.login]);
        return { estabelecimento: await this.quem(l, c.hospital), usuario: u ? num(u['id']) : null };
      },
    );
    return {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
      ...(c.reautenticadoEm !== undefined ? { reautenticadoEm: c.reautenticadoEm } : {}),
    };
  }

  async ler(): Promise<LinhaIntegracaoExterna[]> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'integracao.externas' }, async (l) =>
      (
        await l.consultar(
          `SELECT c.integracao, c.modo, c.parametros, c.versao, c.alterado_em, c.modo_alterado_em,
                  c.ultima_falha_em, c.ultima_falha, u.login AS alterado_por_login
             FROM ${T} c LEFT JOIN usuario u ON u.id = COALESCE(c.alterado_por, c.criado_por)
            ORDER BY c.integracao`,
          [],
          { teto: 200 },
        )
      ).map((x) => ({
        integracao: String(x['integracao']),
        modo: String(x['modo']) === 'real' ? ('real' as const) : ('simulador' as const),
        parametros: parametrosDe(x['parametros']),
        versao: num(x['versao']),
        alteradoEm: data(x['alterado_em']),
        alteradoPor: x['alterado_por_login'] == null ? null : String(x['alterado_por_login']),
        modoAlteradoEm: data(x['modo_alterado_em']),
        ultimaFalhaEm: data(x['ultima_falha_em']),
        ultimaFalha: x['ultima_falha'] == null ? null : String(x['ultima_falha']),
      })),
    );
  }

  async gravarParametros(
    c: GravacaoIntegracaoExterna,
    integracao: string,
    referencia: string,
    parametros: Readonly<Record<string, string>>,
  ) {
    await this.executor.executar(
      this.opParametros,
      this.cliente,
      { integracao, referencia, parametros },
      await this.contexto(c),
    );
  }

  async registrarCredencial(
    c: GravacaoIntegracaoExterna,
    integracao: string,
    referencia: string,
    campo: string,
    guardar: () => Promise<void>,
  ) {
    // Operação montada a cada pedido: o valor fica só no fecho (nunca na entrada, na trilha nem na idempotência).
    const op = definirOperacao<z.infer<typeof esquemaCredencial>, { id: number }>({
      nome: 'integracao_externa.credencial_guardar',
      tabelas: [T],
      entrada: esquemaCredencial,
      critica: true,
      gravar: async (tx, e) => {
        const l = await this.linha(tx, e.integracao, e.referencia);
        // Credencial nova: a falha anterior do real deixa de valer.
        await tx.alterar(T, l.id, l.versao, { ultima_falha_em: null, ultima_falha: null });
        await guardar();
        return { id: l.id };
      },
      alvo: (_e, r) => ({ tabela: T, id: r.id }),
      trilha: (e) => ({ dados: { campo: e.campo } }),
    });
    await this.executor.executar(op, this.cliente, { integracao, referencia, campo }, await this.contexto(c));
  }

  async definirModo(
    c: GravacaoIntegracaoExterna,
    integracao: string,
    referencia: string,
    modo: ModoIntegracaoExterna,
    justificativa: string,
  ) {
    await this.executor.executar(
      this.opModo,
      this.cliente,
      { integracao, referencia, modo, justificativa },
      await this.contexto(c),
    );
  }

  async registrarFalha(integracao: string, referencia: string, motivo: string) {
    const instante = this.agora();
    await this.executor.executar(
      this.opFalha,
      this.cliente,
      { integracao, referencia, motivo },
      {
        cliente: this.cliente,
        estabelecimento: null,
        usuario: null,
        correlacao: `integracao-externa-falha-${integracao}`.slice(0, 64),
        chaveIdempotencia: `falha-${integracao}-${instante.getTime()}`.slice(0, 80),
      },
    );
  }
}

/** Fonte sintética (dev/ci sem banco) e testes: as mesmas gravações, em memória. */
export class PortaIntegracoesExternasMemoria implements PortaIntegracoesExternas {
  readonly destino = 'memoria' as const;
  private readonly linhas = new Map<string, LinhaIntegracaoExterna>();
  constructor(private readonly agora: () => Date = () => new Date()) {}

  private alterar(c: { login: string } | null, integracao: string, mudanca: Partial<LinhaIntegracaoExterna>) {
    const atual: LinhaIntegracaoExterna = this.linhas.get(integracao) ?? {
      integracao,
      modo: 'simulador',
      parametros: {},
      versao: 0,
      alteradoEm: null,
      alteradoPor: null,
      modoAlteradoEm: null,
      ultimaFalhaEm: null,
      ultimaFalha: null,
    };
    this.linhas.set(integracao, {
      ...atual,
      ...mudanca,
      versao: atual.versao + 1,
      alteradoEm: this.agora(),
      alteradoPor: c?.login ?? atual.alteradoPor,
    });
  }

  async ler() {
    return [...this.linhas.values()].sort((a, b) => a.integracao.localeCompare(b.integracao));
  }
  async gravarParametros(
    c: GravacaoIntegracaoExterna,
    integracao: string,
    _r: string,
    parametros: Readonly<Record<string, string>>,
  ) {
    this.alterar(c, integracao, { parametros: { ...parametros } });
  }
  async registrarCredencial(
    c: GravacaoIntegracaoExterna,
    integracao: string,
    _r: string,
    _campo: string,
    guardar: () => Promise<void>,
  ) {
    await guardar();
    this.alterar(c, integracao, { ultimaFalhaEm: null, ultimaFalha: null });
  }
  async definirModo(
    c: GravacaoIntegracaoExterna,
    integracao: string,
    _r: string,
    modo: ModoIntegracaoExterna,
  ) {
    this.alterar(c, integracao, { modo, modoAlteradoEm: this.agora() });
  }
  async registrarFalha(integracao: string, _r: string, motivo: string) {
    this.alterar(null, integracao, { ultimaFalhaEm: this.agora(), ultimaFalha: motivo.slice(0, 500) });
  }
}
