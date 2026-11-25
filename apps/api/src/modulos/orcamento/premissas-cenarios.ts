// Premissas e cenários do orçamento empresarial (C1-125; ficha 07-FIN linha 129): as premissas da versão (inflação,
// reajustes, ocupação, volume, câmbio, tributo), o cadastro dos cenários (pessimista a otimista, com o ajuste) e a
// escolha do cenário da versão, com a projeção do resultado. As regras são de @sgh/dominio-financeiro
// (orcamento-premissas.ts); aqui a porta (própria no MariaDB em premissas-cenarios-propria.ts; memória sintética de
// dev/ci para o E2E) e o serviço que valida, confere a versão e monta a visão.
// Desenho próprio: a premissa e o cenário são validados na hora pela mesma regra que o servidor aplica; só a versão em
// elaboração recebe premissa e cenário (a aprovada fica como foi decidida); retirar a premissa é lógico (nunca apaga).
import {
  type CenarioOrcamentoEntrada,
  type FalhaCampoOrcamento,
  premissaEditavel,
  type PremissaOrcamentoEntrada,
  type ProjecaoCenarioOrcamento,
  projetarCenarioOrcamento,
  TENDENCIAS_CENARIO_ORCAMENTO,
  type TendenciaCenarioOrcamento,
  TIPOS_PREMISSA_ORCAMENTO,
  type TipoPremissaOrcamento,
  validarCenarioOrcamento,
  validarPremissaOrcamento,
} from '@sgh/dominio-financeiro';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro } from '../cadastro/comum.js';
import type { DestinoPorta } from '../cadastro/tipos.js';
import type { ContextoOrcamento, GravacaoOrcamento, PortaOrcamento } from './porta.js';
import type { SessaoOrcamento } from './servico.js';

export const PORTA_PREMISSAS_ORCAMENTO = Symbol('PORTA_PREMISSAS_ORCAMENTO');

export interface CenarioOrcamentoVisao {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly tendencia: TendenciaCenarioOrcamento;
  readonly ajusteCentesimos: number;
  readonly ativo: boolean;
  readonly versao: number;
}

export interface PremissaOrcamentoVisao {
  readonly id: number;
  readonly sequencia: number;
  readonly tipo: TipoPremissaOrcamento;
  readonly descricao: string;
  readonly percentualCentesimos: number | null;
  readonly valorNumerico: number | null;
  readonly valorTexto: string | null;
  readonly unidade: string | null;
  readonly justificativa: string | null;
  readonly versao: number;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
}

export interface PremissasDaVersao {
  readonly versaoId: number;
  /** A trava otimista da versão (a escolha do cenário vai por ela). */
  readonly versaoRegistro: number;
  readonly situacao: string;
  readonly editavel: boolean;
  readonly cenario: CenarioOrcamentoVisao | null;
  readonly projecao: ProjecaoCenarioOrcamento | null;
  readonly premissas: PremissaOrcamentoVisao[];
}

export interface CenarioParaGravar extends CenarioOrcamentoEntrada {
  readonly ativo: boolean;
}

export interface PortaPremissasOrcamento {
  readonly destino: DestinoPorta | 'indisponivel';
  cenarios(c: ContextoOrcamento): Promise<CenarioOrcamentoVisao[]>;
  criarCenario(c: ContextoOrcamento, x: CenarioParaGravar, g: GravacaoOrcamento): Promise<{ id: number }>;
  alterarCenario(
    c: ContextoOrcamento,
    id: number,
    versao: number,
    x: CenarioParaGravar,
    g: GravacaoOrcamento,
  ): Promise<{ versao: number }>;
  premissas(c: ContextoOrcamento, versaoId: number): Promise<PremissaOrcamentoVisao[]>;
  cenarioDaVersao(c: ContextoOrcamento, versaoId: number): Promise<number | null>;
  incluirPremissa(
    c: ContextoOrcamento,
    versaoId: number,
    x: PremissaOrcamentoEntrada,
    g: GravacaoOrcamento,
  ): Promise<{ id: number; sequencia: number }>;
  alterarPremissa(
    c: ContextoOrcamento,
    versaoId: number,
    id: number,
    versao: number,
    x: PremissaOrcamentoEntrada,
    g: GravacaoOrcamento,
  ): Promise<{ versao: number }>;
  retirarPremissa(
    c: ContextoOrcamento,
    versaoId: number,
    id: number,
    versao: number,
    g: GravacaoOrcamento,
  ): Promise<void>;
  escolherCenario(
    c: ContextoOrcamento,
    versaoId: number,
    versaoRegistro: number,
    cenarioId: number | null,
    g: GravacaoOrcamento,
  ): Promise<{ versao: number }>;
}

// ── Entradas (Zod) ─────────────────────────────────────────────────────────────────────────────────────────────────

const textoOpcional = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined || v === null || v.trim() === '' ? null : v.trim()));

export const esquemaPremissaOrcamento = z.object({
  tipo: z.enum(TIPOS_PREMISSA_ORCAMENTO),
  descricao: z.string().max(150),
  percentualCentesimos: z.number().int().nullable().optional().default(null),
  valorNumerico: z.number().finite().nullable().optional().default(null),
  valorTexto: textoOpcional(100),
  unidade: textoOpcional(20),
  justificativa: textoOpcional(2000),
});
export const esquemaAlterarPremissa = esquemaPremissaOrcamento.extend({ versao: z.number().int().min(0) });
export const esquemaRetirarPremissa = z.object({ versao: z.number().int().min(0) });
export const esquemaCenarioOrcamento = z.object({
  codigo: z.string().max(30),
  descricao: z.string().max(150),
  tendencia: z.enum(TENDENCIAS_CENARIO_ORCAMENTO),
  ajusteCentesimos: z.number().int(),
  ativo: z.boolean().optional().default(true),
});
export const esquemaAlterarCenario = esquemaCenarioOrcamento.extend({ versao: z.number().int().min(0) });
export const esquemaEscolherCenario = z.object({
  versao: z.number().int().min(0),
  cenario: z.number().int().positive().nullable(),
});

function invalido(campos: readonly FalhaCampoOrcamento[]): ErroProblema {
  return new ErroProblema(
    'entrada-invalida',
    400,
    'Dados inválidos',
    campos[0]?.mensagem ?? 'Confira os campos.',
    {
      campos: [...new Set(campos.map((f) => f.campo))],
    },
  );
}

function entrada<T>(esquema: z.ZodType<T>, corpo: unknown): T {
  const r = esquema.safeParse(corpo);
  if (!r.success)
    throw invalido(r.error.issues.map((i) => ({ campo: i.path.map(String).join('.'), mensagem: i.message })));
  return r.data;
}

const naoEncontrada = () =>
  new ErroProblema(
    'nao-encontrado',
    404,
    'Orçamento não encontrado',
    'A versão não existe neste estabelecimento.',
  );
const fechada = () =>
  new ErroProblema(
    'recusa-de-negocio',
    409,
    'Versão fechada',
    'Só a versão em elaboração recebe premissas e cenário: a aprovada, substituída ou descartada fica como foi decidida.',
    { codigo: 'versao-fechada' },
  );

/** Converte a recusa do Executor (ErroOperacao) no problema HTTP. */
async function gravando<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw problemaDoCadastro(e);
  }
}

export interface EventosPremissas {
  readonly premissa: string;
  readonly cenario: string;
}

/** A orquestração: valida pela regra do domínio, confere a versão e monta a visão com a projeção. */
export class ServicoPremissasOrcamento {
  constructor(
    private readonly orcamento: PortaOrcamento,
    private readonly porta: PortaPremissasOrcamento,
    private readonly codigoEditar: string,
  ) {}

  private gravacao(s: SessaoOrcamento, evento: string, operacao: string, tabela: string, id: number | null) {
    return {
      login: s.login,
      chaveIdempotencia: s.chaveIdempotencia,
      trilha: s.trilha(evento, operacao, tabela, id),
    };
  }

  private async versaoAberta(s: SessaoOrcamento, id: number) {
    const v = await this.orcamento.versao(s.porta, id);
    if (!v) throw naoEncontrada();
    if (!premissaEditavel(v.situacao)) throw fechada();
    return v;
  }

  cenarios(s: SessaoOrcamento): Promise<CenarioOrcamentoVisao[]> {
    return this.porta.cenarios(s.porta);
  }

  async daVersao(s: SessaoOrcamento, id: number): Promise<PremissasDaVersao> {
    const v = await this.orcamento.versao(s.porta, id);
    if (!v) throw naoEncontrada();
    const [premissas, cenarioId, cenarios] = await Promise.all([
      this.porta.premissas(s.porta, id),
      this.porta.cenarioDaVersao(s.porta, id),
      this.porta.cenarios(s.porta),
    ]);
    const cenario = cenarioId === null ? null : (cenarios.find((x) => x.id === cenarioId) ?? null);
    return {
      versaoId: id,
      versaoRegistro: v.versao,
      situacao: v.situacao,
      editavel: premissaEditavel(v.situacao) && s.pode(this.codigoEditar),
      cenario,
      projecao: cenario ? projetarCenarioOrcamento(v.totaisPorNatureza, cenario.ajusteCentesimos) : null,
      premissas,
    };
  }

  async criarCenario(s: SessaoOrcamento, corpo: unknown, ev: EventosPremissas): Promise<{ id: number }> {
    const x = entrada(esquemaCenarioOrcamento, corpo);
    const f = validarCenarioOrcamento(x);
    if (f.length) throw invalido(f);
    return gravando(() =>
      this.porta.criarCenario(
        s.porta,
        { ...x, codigo: x.codigo.trim().toUpperCase(), descricao: x.descricao.trim() },
        this.gravacao(s, ev.cenario, 'incluir', 'cenario_orcamento', null),
      ),
    );
  }

  async alterarCenario(s: SessaoOrcamento, id: number, corpo: unknown, ev: EventosPremissas) {
    const x = entrada(esquemaAlterarCenario, corpo);
    const f = validarCenarioOrcamento(x);
    if (f.length) throw invalido(f);
    return gravando(() =>
      this.porta.alterarCenario(
        s.porta,
        id,
        x.versao,
        { ...x, codigo: x.codigo.trim().toUpperCase(), descricao: x.descricao.trim() },
        this.gravacao(s, ev.cenario, 'alterar', 'cenario_orcamento', id),
      ),
    );
  }

  async incluirPremissa(s: SessaoOrcamento, versaoId: number, corpo: unknown, ev: EventosPremissas) {
    const x = entrada(esquemaPremissaOrcamento, corpo);
    const f = validarPremissaOrcamento(x);
    if (f.length) throw invalido(f);
    await this.versaoAberta(s, versaoId);
    return gravando(() =>
      this.porta.incluirPremissa(
        s.porta,
        versaoId,
        { ...x, descricao: x.descricao.trim() },
        this.gravacao(s, ev.premissa, 'incluir', 'premissa_orcamento', null),
      ),
    );
  }

  async alterarPremissa(
    s: SessaoOrcamento,
    versaoId: number,
    id: number,
    corpo: unknown,
    ev: EventosPremissas,
  ) {
    const x = entrada(esquemaAlterarPremissa, corpo);
    const f = validarPremissaOrcamento(x);
    if (f.length) throw invalido(f);
    await this.versaoAberta(s, versaoId);
    return gravando(() =>
      this.porta.alterarPremissa(
        s.porta,
        versaoId,
        id,
        x.versao,
        { ...x, descricao: x.descricao.trim() },
        this.gravacao(s, ev.premissa, 'alterar', 'premissa_orcamento', id),
      ),
    );
  }

  async retirarPremissa(
    s: SessaoOrcamento,
    versaoId: number,
    id: number,
    corpo: unknown,
    ev: EventosPremissas,
  ) {
    const x = entrada(esquemaRetirarPremissa, corpo);
    await this.versaoAberta(s, versaoId);
    await gravando(() =>
      this.porta.retirarPremissa(
        s.porta,
        versaoId,
        id,
        x.versao,
        this.gravacao(s, ev.premissa, 'retirar', 'premissa_orcamento', id),
      ),
    );
  }

  async escolherCenario(s: SessaoOrcamento, versaoId: number, corpo: unknown, ev: EventosPremissas) {
    const x = entrada(esquemaEscolherCenario, corpo);
    await this.versaoAberta(s, versaoId);
    if (x.cenario !== null) {
      const c = (await this.porta.cenarios(s.porta)).find((k) => k.id === x.cenario);
      if (!c || !c.ativo) throw invalido([{ campo: 'cenario', mensagem: 'Escolha um cenário ativo.' }]);
    }
    return gravando(() =>
      this.porta.escolherCenario(
        s.porta,
        versaoId,
        x.versao,
        x.cenario,
        this.gravacao(s, ev.cenario, 'escolher', 'versao_orcamento', versaoId),
      ),
    );
  }
}

// ── Porta em memória (sessão sintética de dev/ci e E2E) ─────────────────────────────────────────────────────────────

const conflito = () =>
  new ErroProblema(
    'conflito-de-versao',
    409,
    'Registro alterado',
    'O registro mudou depois que você abriu. Abra de novo para ver o atual.',
    { codigo: 'conflito-versao' },
  );

export class PortaPremissasOrcamentoMemoria implements PortaPremissasOrcamento {
  readonly destino = 'memoria' as const;
  private readonly lista: CenarioOrcamentoVisao[] = [
    {
      id: 1,
      codigo: 'BASE',
      descricao: 'Cenário base',
      tendencia: 'base',
      ajusteCentesimos: 0,
      ativo: true,
      versao: 1,
    },
  ];
  private readonly porVersao = new Map<number, PremissaOrcamentoVisao[]>();
  private readonly retiradas = new Set<number>();
  private readonly escolhido = new Map<number, number | null>();
  private proximo = 1;

  cenarios(): Promise<CenarioOrcamentoVisao[]> {
    return Promise.resolve([...this.lista].sort((a, b) => a.codigo.localeCompare(b.codigo)));
  }
  criarCenario(_c: ContextoOrcamento, x: CenarioParaGravar): Promise<{ id: number }> {
    if (this.lista.some((k) => k.codigo === x.codigo))
      return Promise.reject(
        new ErroProblema(
          'recusa-de-negocio',
          409,
          'Código repetido',
          'Já existe um cenário com este código.',
          {
            codigo: 'codigo-repetido',
          },
        ),
      );
    const id = this.lista.length + 1;
    this.lista.push({ id, ...x, versao: 1 });
    return Promise.resolve({ id });
  }
  alterarCenario(_c: ContextoOrcamento, id: number, versao: number, x: CenarioParaGravar) {
    const i = this.lista.findIndex((k) => k.id === id);
    const atual = this.lista[i];
    if (!atual || atual.versao !== versao) return Promise.reject(conflito());
    this.lista[i] = { id, ...x, versao: versao + 1 };
    return Promise.resolve({ versao: versao + 1 });
  }
  premissas(_c: ContextoOrcamento, versaoId: number): Promise<PremissaOrcamentoVisao[]> {
    return Promise.resolve((this.porVersao.get(versaoId) ?? []).filter((p) => !this.retiradas.has(p.id)));
  }
  cenarioDaVersao(_c: ContextoOrcamento, versaoId: number): Promise<number | null> {
    return Promise.resolve(this.escolhido.get(versaoId) ?? null);
  }
  incluirPremissa(
    _c: ContextoOrcamento,
    versaoId: number,
    x: PremissaOrcamentoEntrada,
    g: GravacaoOrcamento,
  ) {
    const l = this.porVersao.get(versaoId) ?? [];
    const id = this.proximo++;
    const sequencia = l.length + 1;
    l.push({ id, sequencia, ...x, versao: 1, alteradoPor: g.login, alteradoEm: new Date().toISOString() });
    this.porVersao.set(versaoId, l);
    return Promise.resolve({ id, sequencia });
  }
  alterarPremissa(
    _c: ContextoOrcamento,
    versaoId: number,
    id: number,
    versao: number,
    x: PremissaOrcamentoEntrada,
    g: GravacaoOrcamento,
  ) {
    const l = this.porVersao.get(versaoId) ?? [];
    const i = l.findIndex((p) => p.id === id && !this.retiradas.has(p.id));
    const atual = l[i];
    if (!atual || atual.versao !== versao) return Promise.reject(conflito());
    l[i] = { ...atual, ...x, versao: versao + 1, alteradoPor: g.login, alteradoEm: new Date().toISOString() };
    return Promise.resolve({ versao: versao + 1 });
  }
  retirarPremissa(_c: ContextoOrcamento, versaoId: number, id: number, versao: number): Promise<void> {
    const atual = (this.porVersao.get(versaoId) ?? []).find((p) => p.id === id && !this.retiradas.has(p.id));
    if (!atual || atual.versao !== versao) return Promise.reject(conflito());
    this.retiradas.add(id);
    return Promise.resolve();
  }
  escolherCenario(_c: ContextoOrcamento, versaoId: number, versaoRegistro: number, cenarioId: number | null) {
    this.escolhido.set(versaoId, cenarioId);
    return Promise.resolve({ versao: versaoRegistro });
  }
}

export function portaPremissasIndisponivel(): PortaPremissasOrcamento {
  const recusa = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
      ),
    );
  return {
    destino: 'indisponivel',
    cenarios: recusa,
    criarCenario: recusa,
    alterarCenario: recusa,
    premissas: recusa,
    cenarioDaVersao: recusa,
    incluirPremissa: recusa,
    alterarPremissa: recusa,
    retirarPremissa: recusa,
    escolherCenario: recusa,
  };
}
