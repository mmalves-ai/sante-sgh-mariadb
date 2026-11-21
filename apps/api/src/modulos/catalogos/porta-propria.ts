// Fonte própria dos catálogos oficiais (M13) sobre o banco MariaDB do cliente, pelo @sgh/nucleo:
//   - área de preparação: carga_catalogo (cabeçalho: arquivo por SHA-256, situação, totais, lotes, quem aprovou ou
//     encerrou) e carga_catalogo_linha (linha a linha: entidade, chave natural, valores antes e depois, resultado,
//     comparação e o lote em que o item é publicado). Gravação só pelo Executor (trilha, outbox e idempotência na
//     mesma transação), com a trava otimista pela coluna versao;
//   - consulta, edição no banco e histórico SIGTAP: pelas tabelas próprias do catálogo (consultas-proprias.ts);
//   - licença dos catálogos licenciados: licenca_catalogo (regra 7: só entra no estabelecimento que a comprova).
// A PUBLICAÇÃO nas tabelas do catálogo é do worker (lotes curtos na janela): a API só prepara, aprova e encerra.
// Melhoria: quem enviou, aprovou ou encerrou é o usuário (chave estrangeira), não um nome em texto.
// Melhoria: a decisão de aprovar é tomada sobre a carga relida com trava na transação, não sobre a leitura da tela.
// Melhoria: restrições no banco (situações, totais que fecham, lote só em linha válida, SHA-256 no formato).
// Melhoria: o leiaute de posições da base de CEP é o do produto (versionado no domínio), não uma tabela editável.
// Melhoria: a comparação de uma carga lê o banco pelo mapa entidade → tabela própria (leitura-propria.ts), só com os
//   campos que o modelo guarda no vocabulário do contrato; entidade sem mapa recusa a carga com o motivo (nunca uma
//   comparação que marcaria "alterado" por campo que o modelo guarda diferente).
// Melhoria: gravar exige quem grava resolvido no banco do cliente (sem usuário, 403; nunca aprovação sem aprovador), e
//   o banco confere que a carga aprovada tem o aprovador (CHECK pedido no DDL).
// Melhoria: idempotência pelo pedido (cabeçalho Idempotency-Key), não por chamada; a trilha leva IP, estação, recurso,
//   operação da tela e a chave natural do alvo.
import { type CodigoCatalogo, SITUACOES_CARGA_CATALOGO } from '@sgh/contratos';
import { LEIAUTE_CEP_PADRAO, type LeituraDoBanco, type SecaoLeiauteCep } from '@sgh/dominio-catalogo';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  errnoDe,
  type Leitor,
  type Linha,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import { consultaPropria, edicaoPropria, historicoProprio } from './consultas-proprias.js';
import { leituraPropria } from './leitura-propria.js';
import {
  type CargaDeCatalogo,
  type ConsultaCatalogo,
  type CtxCatalogos,
  ErroCargaCatalogo,
  type FonteCatalogos,
  type HistoricoSigtap,
  type LinhaDaCarga,
  type MudancaSituacaoCarga,
  type PreparoCargaCatalogo,
  type Trilha,
} from './fonte.js';

/** O que a fonte usa do NucleoProprio (os testes trocam). */
export interface NucleoCatalogos {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

/** Tabelas que a área de preparação usa (pedidas ao integrador; sem elas, o painel mostra "sem cargas"). */
export const TABELAS_CARGA = ['carga_catalogo', 'carga_catalogo_linha'] as const;
/** Linhas por INSERT de várias linhas (a carga de CEP tem centenas de milhares). */
const LINHAS_POR_INSERT = 500;
const TETO_CARGAS = 200;
const ER_TABELA_INEXISTENTE = 1146;

type Valor = string | number | null;

const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v === null || v === undefined ? '' : String(v);

function objeto(v: unknown): Record<string, Valor> | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && !Buffer.isBuffer(v)) return v as Record<string, Valor>;
  try {
    const o: unknown = JSON.parse(String(v));
    return o && typeof o === 'object' ? (o as Record<string, Valor>) : null;
  } catch {
    return null;
  }
}

const tabelaInexistente = (e: unknown): boolean => errnoDe(e) === ER_TABELA_INEXISTENTE;

// ── Leitura da área de preparação ──────────────────────────────────────────────────────────────────

const SELECT_CARGA = `SELECT c.id, c.catalogo, c.arquivo_nome, c.arquivo_sha256, c.arquivo_bytes, c.arquivo_guardado,
  c.situacao, c.edicao, c.total_linhas, c.linhas_validas, c.linhas_erro, c.itens_novos, c.itens_removidos,
  c.itens_alterados, c.itens_iguais, c.lotes_total, c.lotes_publicados, c.tamanho_lote, c.motivo, c.versao,
  c.criado_em, e.codigo AS estabelecimento, ur.login AS responsavel, COALESCE(ua.login, ue.login) AS aprovador
  FROM carga_catalogo c
  JOIN estabelecimento e ON e.id = c.estabelecimento_id
  LEFT JOIN usuario ur ON ur.id = c.criado_por
  LEFT JOIN usuario ua ON ua.id = c.aprovada_por_usuario_id
  LEFT JOIN usuario ue ON ue.id = c.encerrada_por_usuario_id`;

function cargaDaLinha(r: Linha): CargaDeCatalogo {
  const situacao = String(r['situacao']);
  return {
    id: num(r['id']),
    hospital: txt(r['estabelecimento']) ?? '',
    catalogo: txt(r['catalogo']) ?? '',
    arquivo: txt(r['arquivo_nome']) ?? '',
    sha256: txt(r['arquivo_sha256']) ?? '',
    bytes: num(r['arquivo_bytes']),
    situacao: (SITUACOES_CARGA_CATALOGO as readonly string[]).includes(situacao)
      ? (situacao as CargaDeCatalogo['situacao'])
      : 'falhou',
    edicao: txt(r['edicao']),
    responsavel: txt(r['responsavel']) ?? '',
    aprovador: txt(r['aprovador']),
    criadaEm: iso(r['criado_em']),
    totais: {
      linhas: num(r['total_linhas']),
      validas: num(r['linhas_validas']),
      erros: num(r['linhas_erro']),
      novos: num(r['itens_novos']),
      removidos: num(r['itens_removidos']),
      alterados: num(r['itens_alterados']),
      iguais: num(r['itens_iguais']),
    },
    lotes: {
      total: num(r['lotes_total']),
      publicados: num(r['lotes_publicados']),
      tamanho: num(r['tamanho_lote']),
    },
    motivo: txt(r['motivo']),
    arquivoGuardado: (txt(r['arquivo_guardado']) ?? '') !== '',
    versao: num(r['versao']),
  };
}

function linhaDaCarga(r: Linha): LinhaDaCarga {
  const comparacao = txt(r['comparacao']);
  return {
    linha: num(r['linha']),
    entidade: txt(r['entidade']) ?? '',
    chave: txt(r['chave']) ?? '',
    resultado: r['resultado'] === 'erro' ? 'erro' : 'valida',
    comparacao:
      comparacao === 'novo' || comparacao === 'removido' || comparacao === 'alterado' || comparacao === 'igual'
        ? comparacao
        : null,
    antes: objeto(r['valores_antes']),
    depois: objeto(r['valores']),
    motivo: txt(r['motivo']),
    lote: r['lote'] === null || r['lote'] === undefined ? null : num(r['lote']),
  };
}

// ── Entradas das operações (o que vai ao hash de idempotência) ───────────────────────────────────────

const valor = z.union([z.string().max(4000), z.number(), z.null()]);
const contagem = z.number().int().min(0);
const esquemaLinha = z.object({
  linha: z.number().int().min(1),
  entidade: z.string().regex(/^[a-z][A-Za-z0-9]{1,39}$/),
  chave: z.string().min(1).max(200),
  resultado: z.enum(['valida', 'erro']),
  comparacao: z.enum(['novo', 'removido', 'alterado', 'igual']).nullable(),
  antes: z.record(z.string(), valor).nullable(),
  depois: z.record(z.string(), valor).nullable(),
  motivo: z.string().max(500).nullable(),
  lote: z.number().int().min(1).nullable(),
});
const esquemaPreparo = z.object({
  catalogo: z.string().regex(/^[a-z][A-Za-z0-9]{1,29}$/),
  arquivo: z.string().min(1).max(200),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: contagem,
  arquivoGuardado: z.string().max(200).nullable(),
  situacao: z.enum(['comparada', 'rejeitada']),
  edicao: z.string().max(12).nullable(),
  motivo: z.string().max(500).nullable(),
  totais: z.object({
    linhas: contagem,
    validas: contagem,
    erros: contagem,
    novos: contagem,
    removidos: contagem,
    alterados: contagem,
    iguais: contagem,
  }),
  lotes: z.object({ total: contagem, tamanho: contagem }),
  linhas: z.array(esquemaLinha),
  evento: z.string().max(80),
});
type EntradaPreparo = z.infer<typeof esquemaPreparo>;

const esquemaMudanca = z.object({
  id: z.number().int().min(1),
  versao: z.number().int().min(1),
  de: z.array(z.enum(SITUACOES_CARGA_CATALOGO)).min(1),
  para: z.enum(['aprovada', 'rejeitada', 'cancelada', 'falhou']),
  motivo: z.string().trim().max(500).nullable(),
  evento: z.string().max(80),
});
type EntradaMudanca = z.infer<typeof esquemaMudanca>;

const json = (v: Readonly<Record<string, Valor>> | null): string | null => (v ? JSON.stringify(v) : null);

async function inserirLinhas(tx: TxOperacao, carga: number, linhas: EntradaPreparo['linhas']): Promise<void> {
  const agora = new Date();
  for (let i = 0; i < linhas.length; i += LINHAS_POR_INSERT) {
    const parte = linhas.slice(i, i + LINHAS_POR_INSERT);
    const p: unknown[] = [];
    for (const l of parte)
      p.push(
        carga,
        l.linha,
        l.entidade,
        l.chave,
        l.resultado,
        l.comparacao,
        json(l.depois),
        json(l.antes),
        l.motivo,
        l.lote,
        agora,
        tx.contexto.usuario,
      );
    await tx.executar(
      `INSERT INTO carga_catalogo_linha (carga_catalogo_id, linha, entidade, chave, resultado, comparacao, valores,
         valores_antes, motivo, lote, criado_em, criado_por, versao)
       VALUES ${parte.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)').join(', ')}`,
      p,
    );
  }
}

/** O que a trilha leva da tela além do que o Executor já grava (fora da entrada: não entra no hash da idempotência). */
interface DadosTrilha {
  readonly estacao: string | null;
  readonly recurso: string;
  readonly operacaoTela: string;
  readonly chaveNaturalAlvo: string | null;
}

const dadosTrilha = (t: Trilha): DadosTrilha => ({
  estacao: t.estacao,
  recurso: t.recurso,
  operacaoTela: t.operacao,
  chaveNaturalAlvo: t.chaveNaturalAlvo,
});

const opPreparar = (t: DadosTrilha) => definirOperacao({
  nome: 'catalogo.carga.preparar',
  tabelas: [...TABELAS_CARGA],
  entrada: esquemaPreparo,
  acao: 'inclusao',
  async gravar(tx, e: EntradaPreparo, ctx) {
    const agora = new Date();
    const id = await tx.incluir('carga_catalogo', {
      estabelecimento_id: ctx.estabelecimento,
      catalogo: e.catalogo,
      arquivo_nome: e.arquivo,
      arquivo_sha256: e.sha256,
      arquivo_bytes: e.bytes,
      arquivo_guardado: e.arquivoGuardado,
      situacao: e.situacao,
      edicao: e.edicao,
      total_linhas: e.totais.linhas,
      linhas_validas: e.totais.validas,
      linhas_erro: e.totais.erros,
      itens_novos: e.totais.novos,
      itens_removidos: e.totais.removidos,
      itens_alterados: e.totais.alterados,
      itens_iguais: e.totais.iguais,
      lotes_total: e.lotes.total,
      tamanho_lote: e.lotes.tamanho,
      motivo: e.motivo,
      // A carga rejeitada na preparação (erro de arquivo) nasce encerrada, por quem enviou.
      ...(e.situacao === 'rejeitada' ? { encerrada_em: agora, encerrada_por_usuario_id: ctx.usuario } : {}),
    });
    await inserirLinhas(tx, id, e.linhas);
    return { id, linhas: e.linhas.length };
  },
  alvo: (_e, r) => ({ tabela: 'carga_catalogo', id: Number(r.id) }),
  trilha: (e) => ({
    motivo: e.motivo,
    dados: { evento: e.evento, catalogo: e.catalogo, situacao: e.situacao, linhas: e.linhas.length, ...t },
  }),
});

const opMudarSituacao = (t: DadosTrilha) => definirOperacao({
  nome: 'catalogo.carga.situacao',
  tabelas: ['carga_catalogo'],
  entrada: esquemaMudanca,
  acao: 'alteracao',
  travar: (e: EntradaMudanca) => ({
    tabela: 'carga_catalogo',
    id: e.id,
    versaoEsperada: e.versao,
    colunas: ['situacao', 'estabelecimento_id'],
  }),
  async conferir(_tx, e: EntradaMudanca, ctx, relido) {
    // Carga de outro estabelecimento: a mesma resposta de "não existe" (nada se revela).
    if (!relido || Number(relido['estabelecimento_id']) !== ctx.estabelecimento)
      throw recusa('carga-inexistente', 'Carga não encontrada neste estabelecimento.');
    if (!(e.de as readonly string[]).includes(String(relido['situacao'])))
      throw recusa('situacao-invalida', 'A carga não está numa situação que permita esta ação.');
  },
  async gravar(tx, e: EntradaMudanca, ctx) {
    const agora = new Date();
    const versao = await tx.alterar('carga_catalogo', e.id, e.versao, {
      situacao: e.para,
      ...(e.motivo ? { motivo: e.motivo } : {}),
      ...(e.para === 'aprovada'
        ? { aprovada_em: agora, aprovada_por_usuario_id: ctx.usuario }
        : { encerrada_em: agora, encerrada_por_usuario_id: ctx.usuario }),
    });
    return { id: e.id, versao, situacao: e.para };
  },
  alvo: (e) => ({ tabela: 'carga_catalogo', id: e.id }),
  trilha: (e) => ({ motivo: e.motivo, dados: { evento: e.evento, para: e.para, ...t } }),
});

export class FonteCatalogosPropria implements FonteCatalogos {
  readonly destino = 'banco' as const;
  readonly gravacao = { permitida: true, motivo: null };
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoCatalogos,
    readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: CtxCatalogos, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.traceId || 'catalogos' }, fn);
  }

  /** Id do estabelecimento ativo pelo código da sessão (404 quando não existe ou foi excluído). */
  private async estabelecimento(l: Leitor, hospital: string): Promise<number> {
    const e = await l.uma<{ id: number }>(
      'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
      [hospital],
    );
    if (!e) throw new ErroProblema('nao-encontrado', 404, 'Estabelecimento não encontrado');
    return Number(e.id);
  }

  /**
   * Contexto da gravação: estabelecimento e usuário resolvidos no banco do cliente, idempotência pela chave do pedido
   * e o IP de origem. Quem grava tem de existir no cliente (o administrador da plataforma entra com credencial própria
   * e não tem usuário aqui): sem ele, a gravação é recusada, nunca feita sem autor.
   */
  private contexto(c: CtxCatalogos, t: Trilha): Promise<ContextoOperacao> {
    return this.ler(c, async (l) => {
      const estabelecimento = await this.estabelecimento(l, c.hospital);
      const u = await l.uma<{ id: number }>(
        'SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL',
        [t.usuario],
      );
      if (!u)
        throw new ErroProblema(
          'sem-permissao',
          403,
          'Usuário sem cadastro neste cliente',
          'A carga de catálogo é gravada com quem a fez: entre com um usuário cadastrado neste cliente.',
          { codigo: 'usuario-sem-cadastro' },
        );
      return {
        cliente: this.cliente,
        estabelecimento,
        usuario: Number(u.id),
        correlacao: (t.correlacao || c.traceId || 'catalogos').slice(0, 64),
        chaveIdempotencia: t.idempotencia,
        ...(t.enderecoIp ? { enderecoIp: t.enderecoIp } : {}),
      };
    });
  }

  leituraDoBanco(c: CtxCatalogos, catalogo: CodigoCatalogo): LeituraDoBanco {
    return leituraPropria(catalogo, (fn) => this.ler(c, fn));
  }

  async leiauteCep(): Promise<SecaoLeiauteCep[]> {
    return LEIAUTE_CEP_PADRAO.map((s) => ({ ...s, campos: { ...s.campos } }));
  }

  /** O produto é o responsável por todos os catálogos no banco próprio (nenhum outro sistema grava neles). */
  async responsavel(): Promise<'novo'> {
    return 'novo';
  }

  async contrato(c: CtxCatalogos, catalogo: CodigoCatalogo): Promise<boolean> {
    try {
      return await this.ler(c, async (l) => {
        const est = await this.estabelecimento(l, c.hospital);
        const r = await l.uma(
          `SELECT id FROM licenca_catalogo WHERE estabelecimento_id = ? AND catalogo = ? AND excluido_em IS NULL
            AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE) LIMIT 1`,
          [est, catalogo],
        );
        return r !== null;
      });
    } catch (e) {
      // Sem a tabela das licenças (pedida ao integrador): falha fechada, nenhuma licença vigente.
      if (tabelaInexistente(e)) return false;
      throw e;
    }
  }

  edicao(c: CtxCatalogos, catalogo: CodigoCatalogo) {
    return this.ler(c, (l) => edicaoPropria(l, catalogo));
  }

  async cargas(c: CtxCatalogos, catalogo: string | null): Promise<CargaDeCatalogo[] | null> {
    try {
      return await this.ler(c, async (l) => {
        const est = await this.estabelecimento(l, c.hospital);
        const linhas = await l.consultar(
          `${SELECT_CARGA} WHERE c.estabelecimento_id = ?${catalogo ? ' AND c.catalogo = ?' : ''}
            ORDER BY c.id DESC LIMIT ${TETO_CARGAS}`,
          catalogo ? [est, catalogo] : [est],
          { teto: TETO_CARGAS },
        );
        return linhas.map(cargaDaLinha);
      });
    } catch (e) {
      // A área de preparação ainda não existe no banco do cliente: o painel mostra "sem cargas".
      if (tabelaInexistente(e)) return null;
      throw e;
    }
  }

  carga(c: CtxCatalogos, id: number): Promise<CargaDeCatalogo | null> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(l, c.hospital);
      const r = await l.uma(`${SELECT_CARGA} WHERE c.estabelecimento_id = ? AND c.id = ?`, [est, id]);
      return r ? cargaDaLinha(r) : null;
    });
  }

  linhas(
    c: CtxCatalogos,
    id: number,
    f: { pagina: number; porPagina: number; comparacao?: string | null; resultado?: string | null },
  ): Promise<{ itens: LinhaDaCarga[]; total: number }> {
    const porPagina = Math.max(1, Math.min(500, Math.trunc(f.porPagina)));
    const pagina = Math.max(0, Math.trunc(f.pagina));
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(l, c.hospital);
      const w = ['x.carga_catalogo_id = ?', 'c.estabelecimento_id = ?'];
      const p: unknown[] = [id, est];
      if (f.comparacao) {
        w.push('x.comparacao = ?');
        p.push(f.comparacao);
      }
      if (f.resultado) {
        w.push('x.resultado = ?');
        p.push(f.resultado);
      }
      const de = `FROM carga_catalogo_linha x JOIN carga_catalogo c ON c.id = x.carga_catalogo_id WHERE ${w.join(' AND ')}`;
      const t = await l.uma<{ n: number }>(`SELECT COUNT(*) AS n ${de}`, p);
      const linhas = await l.consultar(
        `SELECT x.linha, x.entidade, x.chave, x.valores, x.valores_antes, x.resultado, x.comparacao, x.motivo, x.lote
           ${de} ORDER BY x.linha LIMIT ${porPagina} OFFSET ${pagina * porPagina}`,
        p,
        { teto: porPagina },
      );
      return { itens: linhas.map(linhaDaCarga), total: num(t?.n) };
    });
  }

  async publicadaComHash(c: CtxCatalogos, catalogo: string, sha256: string): Promise<number | null> {
    try {
      return await this.ler(c, async (l) => {
        const est = await this.estabelecimento(l, c.hospital);
        const r = await l.uma<{ id: number }>(
          `SELECT id FROM carga_catalogo WHERE estabelecimento_id = ? AND catalogo = ? AND arquivo_sha256 = ?
             AND situacao = 'publicada' ORDER BY id DESC LIMIT 1`,
          [est, catalogo, sha256],
        );
        return r ? Number(r.id) : null;
      });
    } catch (e) {
      if (tabelaInexistente(e)) return null;
      throw e;
    }
  }

  async gravarCarga(c: CtxCatalogos, nova: PreparoCargaCatalogo, trilha: Trilha): Promise<{ id: number }> {
    const ctx = await this.contexto(c, trilha);
    const s = await this.executor.executar(
      opPreparar(dadosTrilha(trilha)),
      this.cliente,
      {
        catalogo: nova.catalogo,
        arquivo: nova.arquivo,
        sha256: nova.sha256,
        bytes: nova.bytes,
        arquivoGuardado: nova.arquivoGuardado,
        situacao: nova.situacao,
        edicao: nova.edicao,
        motivo: nova.motivo,
        totais: nova.totais,
        lotes: nova.lotes,
        linhas: nova.linhas.map((l) => ({ ...l })),
        evento: trilha.evento,
      },
      ctx,
    );
    return { id: Number(s.resultado.id) };
  }

  async mudarSituacao(c: CtxCatalogos, m: MudancaSituacaoCarga, trilha: Trilha): Promise<void> {
    const ctx = await this.contexto(c, trilha);
    try {
      await this.executor.executar(
        opMudarSituacao(dadosTrilha(trilha)),
        this.cliente,
        { id: m.id, versao: m.versao, de: [...m.de], para: m.para, motivo: m.motivo, evento: trilha.evento },
        ctx,
      );
    } catch (e) {
      if (e instanceof ErroOperacao) {
        const codigo = e.problema.codigo;
        if (codigo === 'conflito-versao')
          throw new ErroCargaCatalogo('conflito-concorrente', 'A carga mudou desde a leitura. Releia.');
        if (codigo === 'situacao-invalida') throw new ErroCargaCatalogo('situacao-invalida', e.problema.detail);
        if (codigo === 'carga-inexistente' || codigo === 'registro-inexistente')
          throw new ErroProblema('nao-encontrado', 404, 'Carga não encontrada');
      }
      throw e;
    }
  }

  consultar(
    c: CtxCatalogos,
    entidade: string,
    f: { busca: string | null; pagina: number; porPagina: number; competencia?: string | null },
  ): Promise<ConsultaCatalogo | null> {
    return this.ler(c, (l) => consultaPropria(l, entidade, f));
  }

  historico(c: CtxCatalogos, procedimento: string): Promise<HistoricoSigtap | null> {
    return this.ler(c, (l) => historicoProprio(l, procedimento));
  }
}
