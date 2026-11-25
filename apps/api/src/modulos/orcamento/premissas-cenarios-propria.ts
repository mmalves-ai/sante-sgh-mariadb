// Porta PRÓPRIA das premissas e cenários do orçamento (C1-125) sobre o MariaDB do cliente, pelo @sgh/nucleo:
// premissa_orcamento (da versão), cenario_orcamento (cadastro da rede) e versao_orcamento.cenario_orcamento_id (a
// escolha da versão). Toda gravação vai pelo Executor, com a trilha, o outbox e a idempotência na mesma transação; a
// premissa só muda com a versão em elaboração (relida e travada na transação) e a retirada é lógica
// (excluido_em/excluido_por), nunca DELETE. A leitura da premissa filtra o estabelecimento da sessão.
import type { PremissaOrcamentoEntrada } from '@sgh/dominio-financeiro';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  restricaoUnicaViolada,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoOrcamento, GravacaoOrcamento } from './porta.js';
import type { NucleoOrcamento } from './porta-propria.js';
import type {
  CenarioOrcamentoVisao,
  CenarioParaGravar,
  PortaPremissasOrcamento,
  PremissaOrcamentoVisao,
} from './premissas-cenarios.js';

const TETO_CENARIOS = 500;
const TETO_PREMISSAS = 1000;

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};
const inteiro = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const centesimos = (v: unknown): number | null =>
  v === null || v === undefined ? null : Math.round(Number(v) * 100);
const instanteIso = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString();
  const t = texto(v);
  return t ? new Date(`${t.replace(' ', 'T')}Z`).toISOString() : '';
};

const premissaZ = z.object({
  tipo: z.string(),
  descricao: z.string(),
  percentualCentesimos: z.number().int().nullable(),
  valorNumerico: z.number().nullable(),
  valorTexto: z.string().nullable(),
  unidade: z.string().nullable(),
  justificativa: z.string().nullable(),
});
const colunasPremissa = (x: z.infer<typeof premissaZ>) => ({
  tipo: x.tipo,
  descricao: x.descricao.slice(0, 150),
  percentual: x.percentualCentesimos === null ? null : (x.percentualCentesimos / 100).toFixed(4),
  valor_numerico: x.valorNumerico === null ? null : x.valorNumerico.toFixed(4),
  valor_texto: x.valorTexto,
  unidade: x.unidade,
  justificativa: x.justificativa,
});

const cenarioZ = z.object({
  codigo: z.string().min(1).max(30),
  descricao: z.string().min(3).max(150),
  tendencia: z.string(),
  ajusteCentesimos: z.number().int(),
  ativo: z.boolean(),
});
const colunasCenario = (x: z.infer<typeof cenarioZ>) => ({
  codigo: x.codigo,
  descricao: x.descricao,
  tendencia: x.tendencia,
  percentual_ajuste: (x.ajusteCentesimos / 100).toFixed(4),
  ativo: x.ativo,
});

const naoEncontrada = () =>
  new ErroOperacao(
    404,
    'nao-encontrado',
    'Orçamento não encontrado',
    'A versão não existe neste estabelecimento.',
  );
const desatualizado = () =>
  recusa(
    'desatualizado',
    'O orçamento mudou depois que você abriu (outra pessoa gravou, aprovou ou descartou). Abra de novo para ver a versão atual.',
  );

/** Relê e trava a versão do estabelecimento do contexto; só a em elaboração segue. */
async function travarVersaoAberta(tx: TxOperacao, id: number): Promise<{ versao: number }> {
  const [v] = await tx.consultarParaAtualizar<{ situacao: unknown; versao: unknown }>(
    'SELECT situacao, versao FROM versao_orcamento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [id, tx.contexto.estabelecimento],
  );
  if (!v) throw naoEncontrada();
  if (v.situacao !== 'rascunho') throw desatualizado();
  return { versao: inteiro(v.versao) };
}

/** A premissa viva da versão (a trava otimista vem pela `versao` que a tela leu). */
async function premissaDaVersao(tx: TxOperacao, versaoId: number, id: number): Promise<void> {
  const p = await tx.uma(
    'SELECT id FROM premissa_orcamento WHERE id = ? AND versao_orcamento_id = ? AND excluido_em IS NULL',
    [id, versaoId],
  );
  if (!p)
    throw new ErroOperacao(
      404,
      'nao-encontrado',
      'Premissa não encontrada',
      'A premissa não existe nesta versão.',
    );
}

const opIncluirPremissa = definirOperacao({
  nome: 'orcamento.premissa.incluir',
  tabelas: ['premissa_orcamento'],
  entrada: z.object({ versaoId: z.number().int().positive(), premissa: premissaZ, dados: z.unknown() }),
  async gravar(tx, x) {
    await travarVersaoAberta(tx, x.versaoId);
    const m = await tx.uma<{ m: unknown }>(
      'SELECT COALESCE(MAX(sequencia), 0) AS m FROM premissa_orcamento WHERE versao_orcamento_id = ?',
      [x.versaoId],
    );
    const sequencia = inteiro(m?.m) + 1;
    if (sequencia > 65_535) throw recusa('limite', 'A versão já tem o número máximo de premissas.');
    const id = await tx.incluir('premissa_orcamento', {
      versao_orcamento_id: x.versaoId,
      sequencia,
      ...colunasPremissa(x.premissa),
    });
    return { id, sequencia };
  },
  alvo: (_x, r) => ({ tabela: 'premissa_orcamento', id: r.id }),
  trilha: (x) => ({ acao: 'inclusao', dados: { tela: x.dados ?? null, tipo: x.premissa.tipo } }),
});

const opAlterarPremissa = definirOperacao({
  nome: 'orcamento.premissa.alterar',
  tabelas: ['premissa_orcamento'],
  entrada: z.object({
    versaoId: z.number().int().positive(),
    id: z.number().int().positive(),
    versao: z.number().int().min(0),
    premissa: premissaZ,
    dados: z.unknown(),
  }),
  async gravar(tx, x) {
    await travarVersaoAberta(tx, x.versaoId);
    await premissaDaVersao(tx, x.versaoId, x.id);
    const versao = await tx.alterar('premissa_orcamento', x.id, x.versao, colunasPremissa(x.premissa));
    return { versao };
  },
  alvo: (x) => ({ tabela: 'premissa_orcamento', id: x.id }),
  trilha: (x) => ({ acao: 'alteracao', dados: { tela: x.dados ?? null, tipo: x.premissa.tipo } }),
});

const opRetirarPremissa = definirOperacao({
  nome: 'orcamento.premissa.retirar',
  tabelas: ['premissa_orcamento'],
  entrada: z.object({
    versaoId: z.number().int().positive(),
    id: z.number().int().positive(),
    versao: z.number().int().min(0),
    dados: z.unknown(),
  }),
  async gravar(tx, x) {
    await travarVersaoAberta(tx, x.versaoId);
    await premissaDaVersao(tx, x.versaoId, x.id);
    const versao = await tx.alterar('premissa_orcamento', x.id, x.versao, {
      excluido_em: new Date(),
      excluido_por: tx.contexto.usuario,
    });
    return { versao };
  },
  alvo: (x) => ({ tabela: 'premissa_orcamento', id: x.id }),
  trilha: (x) => ({ acao: 'alteracao', dados: { tela: x.dados ?? null, retirada: true } }),
});

const opCriarCenario = definirOperacao({
  nome: 'orcamento.cenario.incluir',
  tabelas: ['cenario_orcamento'],
  entrada: z.object({ cenario: cenarioZ, dados: z.unknown() }),
  async gravar(tx, x) {
    const o = await tx.uma<{ o: unknown }>('SELECT COALESCE(MAX(ordem), 0) AS o FROM cenario_orcamento', []);
    try {
      const id = await tx.incluir('cenario_orcamento', {
        ...colunasCenario(x.cenario),
        ordem: Math.min(inteiro(o?.o) + 1, 65_535),
      });
      return { id };
    } catch (e) {
      if (restricaoUnicaViolada(e)) throw recusa('codigo-repetido', 'Já existe um cenário com este código.');
      throw e;
    }
  },
  alvo: (_x, r) => ({ tabela: 'cenario_orcamento', id: r.id }),
  trilha: (x) => ({ acao: 'inclusao', dados: { tela: x.dados ?? null, codigo: x.cenario.codigo } }),
});

const opAlterarCenario = definirOperacao({
  nome: 'orcamento.cenario.alterar',
  tabelas: ['cenario_orcamento'],
  entrada: z.object({
    id: z.number().int().positive(),
    versao: z.number().int().min(0),
    cenario: cenarioZ,
    dados: z.unknown(),
  }),
  async gravar(tx, x) {
    try {
      const versao = await tx.alterar('cenario_orcamento', x.id, x.versao, colunasCenario(x.cenario));
      return { versao };
    } catch (e) {
      if (restricaoUnicaViolada(e)) throw recusa('codigo-repetido', 'Já existe um cenário com este código.');
      throw e;
    }
  },
  alvo: (x) => ({ tabela: 'cenario_orcamento', id: x.id }),
  trilha: (x) => ({ acao: 'alteracao', dados: { tela: x.dados ?? null, codigo: x.cenario.codigo } }),
});

const opEscolherCenario = definirOperacao({
  nome: 'orcamento.versao.cenario',
  tabelas: ['versao_orcamento'],
  entrada: z.object({
    versaoId: z.number().int().positive(),
    versao: z.number().int().min(0),
    cenario: z.number().int().positive().nullable(),
    dados: z.unknown(),
  }),
  async gravar(tx, x) {
    await travarVersaoAberta(tx, x.versaoId);
    if (x.cenario !== null) {
      const c = await tx.uma('SELECT id FROM cenario_orcamento WHERE id = ? AND ativo = TRUE', [x.cenario]);
      if (!c) throw recusa('cenario-inativo', 'Escolha um cenário ativo.');
    }
    const versao = await tx.alterar('versao_orcamento', x.versaoId, x.versao, {
      cenario_orcamento_id: x.cenario,
    });
    return { versao };
  },
  alvo: (x) => ({ tabela: 'versao_orcamento', id: x.versaoId }),
  trilha: (x) => ({ acao: 'alteracao', dados: { tela: x.dados ?? null, cenario: x.cenario } }),
});

function cenarioDaLinha(x: Record<string, unknown>): CenarioOrcamentoVisao {
  return {
    id: inteiro(x['id']),
    codigo: texto(x['codigo']) ?? '',
    descricao: texto(x['descricao']) ?? '',
    tendencia: String(x['tendencia']) as CenarioOrcamentoVisao['tendencia'],
    ajusteCentesimos: centesimos(x['percentual_ajuste']) ?? 0,
    ativo: Boolean(Number(x['ativo'])),
    versao: inteiro(x['versao']),
  };
}

function premissaDaLinha(x: Record<string, unknown>): PremissaOrcamentoVisao {
  return {
    id: inteiro(x['id']),
    sequencia: inteiro(x['sequencia']),
    tipo: String(x['tipo']) as PremissaOrcamentoVisao['tipo'],
    descricao: texto(x['descricao']) ?? '',
    percentualCentesimos: centesimos(x['percentual']),
    valorNumerico: x['valor_numerico'] == null ? null : Number(x['valor_numerico']),
    valorTexto: texto(x['valor_texto']),
    unidade: texto(x['unidade']),
    justificativa: texto(x['justificativa']),
    versao: inteiro(x['versao']),
    alteradoPor: texto(x['login']) ?? '',
    alteradoEm: instanteIso(x['em']),
  };
}

export class PortaPremissasOrcamentoPropria implements PortaPremissasOrcamento {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoOrcamento,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoOrcamento, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'orcamento' }, fn);
  }

  private async estabelecimento(c: ContextoOrcamento, l: Leitor): Promise<number> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const x = await l.uma<{ id: unknown }>(
      'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
      [c.hospital],
    );
    if (!x)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Estabelecimento desconhecido',
        'O estabelecimento da sessão não existe.',
      );
    return inteiro(x.id);
  }

  private async gravar<S>(
    c: ContextoOrcamento,
    op: Parameters<Executor['executar']>[0],
    entrada: Record<string, unknown>,
    g: GravacaoOrcamento,
  ): Promise<S> {
    const est = await this.ler(c, (l) => this.estabelecimento(c, l));
    const contexto: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: c.usuario,
      correlacao: g.trilha.correlacao ?? c.correlacao,
      chaveIdempotencia: g.chaveIdempotencia,
    };
    const r = await this.executor.executar(
      op,
      this.cliente,
      { ...entrada, dados: g.trilha.dadosDepois },
      contexto,
    );
    return r.resultado as S;
  }

  cenarios(c: ContextoOrcamento): Promise<CenarioOrcamentoVisao[]> {
    return this.ler(c, async (l) => {
      const ls = await l.consultar(
        `SELECT id, codigo, descricao, tendencia, percentual_ajuste, ativo, versao FROM cenario_orcamento
          ORDER BY ordem, codigo LIMIT ${TETO_CENARIOS}`,
        [],
        { teto: TETO_CENARIOS },
      );
      return ls.map(cenarioDaLinha);
    });
  }

  criarCenario(c: ContextoOrcamento, x: CenarioParaGravar, g: GravacaoOrcamento): Promise<{ id: number }> {
    return this.gravar(c, opCriarCenario, { cenario: x }, g);
  }

  alterarCenario(
    c: ContextoOrcamento,
    id: number,
    versao: number,
    x: CenarioParaGravar,
    g: GravacaoOrcamento,
  ): Promise<{ versao: number }> {
    return this.gravar(c, opAlterarCenario, { id, versao, cenario: x }, g);
  }

  premissas(c: ContextoOrcamento, versaoId: number): Promise<PremissaOrcamentoVisao[]> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const ls = await l.consultar(
        `SELECT p.id, p.sequencia, p.tipo, p.descricao, p.percentual, p.valor_numerico, p.valor_texto, p.unidade,
                p.justificativa, p.versao, COALESCE(p.alterado_em, p.criado_em) AS em, u.login
           FROM premissa_orcamento p
           JOIN versao_orcamento v ON v.id = p.versao_orcamento_id
           LEFT JOIN usuario u ON u.id = COALESCE(p.alterado_por, p.criado_por)
          WHERE p.versao_orcamento_id = ? AND v.estabelecimento_id = ? AND v.excluido_em IS NULL
            AND p.excluido_em IS NULL
          ORDER BY p.sequencia LIMIT ${TETO_PREMISSAS}`,
        [versaoId, est],
        { teto: TETO_PREMISSAS },
      );
      return ls.map(premissaDaLinha);
    });
  }

  cenarioDaVersao(c: ContextoOrcamento, versaoId: number): Promise<number | null> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const x = await l.uma<{ c: unknown }>(
        'SELECT cenario_orcamento_id AS c FROM versao_orcamento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [versaoId, est],
      );
      return x?.c == null ? null : inteiro(x.c);
    });
  }

  incluirPremissa(
    c: ContextoOrcamento,
    versaoId: number,
    x: PremissaOrcamentoEntrada,
    g: GravacaoOrcamento,
  ): Promise<{ id: number; sequencia: number }> {
    return this.gravar(c, opIncluirPremissa, { versaoId, premissa: x }, g);
  }

  alterarPremissa(
    c: ContextoOrcamento,
    versaoId: number,
    id: number,
    versao: number,
    x: PremissaOrcamentoEntrada,
    g: GravacaoOrcamento,
  ): Promise<{ versao: number }> {
    return this.gravar(c, opAlterarPremissa, { versaoId, id, versao, premissa: x }, g);
  }

  async retirarPremissa(
    c: ContextoOrcamento,
    versaoId: number,
    id: number,
    versao: number,
    g: GravacaoOrcamento,
  ): Promise<void> {
    await this.gravar(c, opRetirarPremissa, { versaoId, id, versao }, g);
  }

  escolherCenario(
    c: ContextoOrcamento,
    versaoId: number,
    versaoRegistro: number,
    cenarioId: number | null,
    g: GravacaoOrcamento,
  ): Promise<{ versao: number }> {
    return this.gravar(c, opEscolherCenario, { versaoId, versao: versaoRegistro, cenario: cenarioId }, g);
  }
}
