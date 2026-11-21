// Porta PRÓPRIA do publicador de catálogos (M13) sobre o banco do cliente (MariaDB, @sgh/nucleo): lê a área de
// preparação (carga_catalogo, carga_catalogo_linha) do estabelecimento e publica cada lote por uma operação do
// Executor: os itens nas tabelas próprias (escrita-catalogo.ts) e o lote confirmado na carga, com a trilha e a
// idempotência na mesma transação. Leitura somente leitura; toda leitura filtra o estabelecimento resolvido pelo código.
// A publicação grava em nome de quem aprovou a carga (usuario.id; a aprovação exige aprovador no banco).
// Melhoria: a operação relê a carga com trava e confere estabelecimento, situação, o lote seguinte ao confirmado e o
//   total de lotes antes de gravar (lote fora de ordem ou repetido é recusado; a repetição com a mesma chave devolve o
//   resultado da primeira, sem gravar de novo).
// Melhoria: o contrato de dados do catálogo licenciado é conferido NA transação, pela regra do domínio
//   (decidirPublicacao) sobre licenca_catalogo vigente no estabelecimento.
// Melhoria: a falha grava quem encerrou (o aprovador) e quando (ck_carga_catalogo_encerrada).
// Pendente (pedido de DDL do lote 05-13): a marca da sessão "como" da aprovação não tem coluna em carga_catalogo;
//   até lá a carga é lida sem a marca (como: null) e a publicação vai à trilha só com o aprovador.
import {
  definicaoCatalogo,
  type DefinicaoCatalogo,
  esquemaLoteCatalogo,
  type LoteCatalogo,
  type SituacaoCargaCatalogo,
} from '@sgh/contratos';
import { decidirPublicacao, JANELA_PADRAO, proximoLote } from '@sgh/dominio-catalogo';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  type Linha,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { entidadesSemEscrita, escreverItem, tabelasDaEscrita } from './escrita-catalogo.js';
import type { CargaAPublicar, LinhaDoLote, PortaPublicacaoCatalogo, ValorLinhaCatalogo } from './publicador.js';

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoPublicacao {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

const TETO_CARGAS = 50;
const TETO_ITENS = 1000;

const COLUNAS_CARGA = `c.id, c.catalogo, c.situacao, c.edicao, c.arquivo_sha256, c.lotes_total, c.lotes_publicados,
  c.versao, c.aprovada_por_usuario_id, u.login AS aprovador
  FROM carga_catalogo c LEFT JOIN usuario u ON u.id = c.aprovada_por_usuario_id`;

const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function paraCarga(r: Linha): CargaAPublicar {
  return {
    id: Number(r['id']),
    catalogo: String(r['catalogo']),
    situacao: String(r['situacao']),
    edicao: txt(r['edicao']),
    sha256: String(r['arquivo_sha256']),
    lotes: { total: Number(r['lotes_total']), publicados: Number(r['lotes_publicados']) },
    versao: Number(r['versao']),
    aprovadorId: r['aprovada_por_usuario_id'] === null ? null : Number(r['aprovada_por_usuario_id']),
    aprovador: txt(r['aprovador']),
    como: null,
  };
}

function objeto(v: unknown): Record<string, ValorLinhaCatalogo> | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && !Buffer.isBuffer(v)) return v as Record<string, ValorLinhaCatalogo>;
  try {
    const o: unknown = JSON.parse(String(v));
    return o && typeof o === 'object' ? (o as Record<string, ValorLinhaCatalogo>) : null;
  } catch {
    return null;
  }
}

async function contratoVigente(tx: TxOperacao, estabelecimento: number, catalogo: string): Promise<boolean> {
  const r = await tx.uma(
    `SELECT id FROM licenca_catalogo
      WHERE estabelecimento_id = ? AND catalogo = ? AND excluido_em IS NULL
        AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
      LIMIT 1`,
    [estabelecimento, catalogo],
  );
  return r !== null;
}

const esquemaPublicacao = z.object({ versao: z.number().int().min(1), lote: esquemaLoteCatalogo });
type EntradaPublicacao = z.infer<typeof esquemaPublicacao>;

const esquemaFalha = z.object({
  id: z.number().int().min(1),
  versao: z.number().int().min(1),
  motivo: z.string().trim().min(1).max(500),
});
type EntradaFalha = z.infer<typeof esquemaFalha>;

const EM_PUBLICACAO = ['aprovada', 'publicando'];

function opPublicarLote(def: DefinicaoCatalogo) {
  return definirOperacao({
    nome: 'catalogo.carga.publicar-lote',
    tabelas: ['carga_catalogo', ...tabelasDaEscrita(def.entidades.map((e) => e.codigo))],
    entrada: esquemaPublicacao,
    acao: 'alteracao',
    travar: (e: EntradaPublicacao) => ({
      tabela: 'carga_catalogo',
      id: e.lote.carga,
      versaoEsperada: e.versao,
      colunas: ['estabelecimento_id', 'catalogo', 'situacao', 'lotes_total', 'lotes_publicados'],
    }),
    async conferir(tx, e: EntradaPublicacao, ctx, relido) {
      // Carga de outro estabelecimento: a mesma resposta de "não existe" (nada se revela).
      if (!relido || Number(relido['estabelecimento_id']) !== ctx.estabelecimento)
        throw recusa('carga-inexistente', 'Carga não encontrada neste estabelecimento.');
      if (String(relido['catalogo']) !== def.codigo)
        throw recusa('carga-inexistente', 'Carga não encontrada neste estabelecimento.');
      const situacao = String(relido['situacao']);
      if (!EM_PUBLICACAO.includes(situacao))
        throw recusa('situacao-invalida', 'Só a carga aprovada ou em publicação recebe lotes.');
      const total = Number(relido['lotes_total']);
      if (e.lote.lotes !== total || proximoLote(total, Number(relido['lotes_publicados'])) !== e.lote.lote)
        throw recusa('lote-fora-de-ordem', 'O lote não é o seguinte ao último confirmado: a publicação retoma pelo certo.');
      const decisao = decidirPublicacao({
        situacao: situacao as SituacaoCargaCatalogo,
        responsavel: 'novo',
        exigeContrato: def.exigeContrato,
        contratoVigente: def.exigeContrato ? await contratoVigente(tx, Number(ctx.estabelecimento), def.codigo) : true,
        erros: 0,
        itensAPublicar: e.lote.itens.length,
        janela: JANELA_PADRAO,
        agoraMinutos: 0,
        // A janela é do publicador (o ciclo só chama dentro dela ou quando o ambiente permite).
        ignorarJanela: true,
      });
      if (!decisao.pode)
        throw recusa(decisao.codigo ?? 'publicacao-recusada', decisao.motivo ?? 'Publicação recusada.');
      const semMapa = entidadesSemEscrita(e.lote.itens);
      if (semMapa.length > 0)
        throw recusa(
          'catalogo-sem-mapa',
          `A publicação de ${semMapa.join(', ')} (${def.titulo}) ainda não tem o mapa ao modelo próprio: nada do lote foi gravado.`,
        );
    },
    async gravar(tx, e: EntradaPublicacao) {
      for (const item of e.lote.itens) await escreverItem(tx, item, e.lote.edicao);
      const fim = e.lote.lote === e.lote.lotes;
      const versao = await tx.alterar('carga_catalogo', e.lote.carga, e.versao, {
        lotes_publicados: e.lote.lote,
        situacao: fim ? 'publicada' : 'publicando',
        ...(fim ? { publicada_em: new Date() } : {}),
      });
      return { carga: e.lote.carga, lote: e.lote.lote, itens: e.lote.itens.length, versao };
    },
    alvo: (e) => ({ tabela: 'carga_catalogo', id: e.lote.carga }),
    trilha: (e) => ({
      dados: { catalogo: def.codigo, lote: e.lote.lote, lotes: e.lote.lotes, itens: e.lote.itens.length, edicao: e.lote.edicao },
    }),
  });
}

const opFalha = definirOperacao({
  nome: 'catalogo.carga.falhou',
  tabelas: ['carga_catalogo'],
  entrada: esquemaFalha,
  acao: 'alteracao',
  travar: (e: EntradaFalha) => ({
    tabela: 'carga_catalogo',
    id: e.id,
    versaoEsperada: e.versao,
    colunas: ['estabelecimento_id', 'situacao'],
  }),
  async conferir(_tx, _e: EntradaFalha, ctx, relido) {
    if (!relido || Number(relido['estabelecimento_id']) !== ctx.estabelecimento)
      throw recusa('carga-inexistente', 'Carga não encontrada neste estabelecimento.');
    if (!EM_PUBLICACAO.includes(String(relido['situacao'])))
      throw recusa('situacao-invalida', 'Só a carga aprovada ou em publicação vai a "falhou".');
  },
  async gravar(tx, e: EntradaFalha, ctx) {
    const versao = await tx.alterar('carga_catalogo', e.id, e.versao, {
      situacao: 'falhou',
      motivo: e.motivo,
      encerrada_em: new Date(),
      encerrada_por_usuario_id: ctx.usuario,
    });
    return { id: e.id, versao };
  },
  alvo: (e) => ({ tabela: 'carga_catalogo', id: e.id }),
  trilha: (e) => ({ motivo: e.motivo, dados: { para: 'falhou' } }),
});

export class PortaPublicacaoPropria implements PortaPublicacaoCatalogo {
  private readonly executor: Executor;
  private estabelecimentoId: number | null = null;

  constructor(
    private readonly nucleo: NucleoPublicacao,
    /** Código do cliente na plataforma (o banco é cliente_<codigo>). */
    readonly cliente: string,
    /** Código do estabelecimento. */
    readonly hospital: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: `publicador-catalogos-${this.hospital}`.slice(0, 64) }, fn);
  }

  private async estabelecimento(): Promise<number> {
    if (this.estabelecimentoId !== null) return this.estabelecimentoId;
    const r = await this.ler((l) =>
      l.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [this.hospital]),
    );
    if (!r) throw recusa('estabelecimento-desconhecido', 'O estabelecimento do publicador não está cadastrado.');
    this.estabelecimentoId = Number(r.id);
    return this.estabelecimentoId;
  }

  private contexto(est: number, c: CargaAPublicar, correlacao: string, chave: string): ContextoOperacao {
    return {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: c.aprovadorId,
      correlacao: correlacao.slice(0, 64),
      chaveIdempotencia: chave.slice(0, 80),
    };
  }

  async cargasAPublicar(): Promise<readonly CargaAPublicar[]> {
    const est = await this.estabelecimento();
    const linhas = await this.ler((l) =>
      l.consultar(
        `SELECT ${COLUNAS_CARGA} WHERE c.estabelecimento_id = ? AND c.situacao IN ('aprovada', 'publicando')
          ORDER BY c.id LIMIT ${TETO_CARGAS}`,
        [est],
        { teto: TETO_CARGAS },
      ),
    );
    return linhas.map(paraCarga);
  }

  async carga(id: number): Promise<CargaAPublicar | null> {
    const est = await this.estabelecimento();
    const r = await this.ler((l) => l.uma(`SELECT ${COLUNAS_CARGA} WHERE c.id = ? AND c.estabelecimento_id = ?`, [id, est]));
    return r ? paraCarga(r) : null;
  }

  async itensDoLote(carga: number, lote: number): Promise<readonly LinhaDoLote[]> {
    const est = await this.estabelecimento();
    const linhas = await this.ler((l) =>
      l.consultar(
        `SELECT x.entidade, x.chave, x.comparacao, x.valores, x.valores_antes
           FROM carga_catalogo_linha x JOIN carga_catalogo c ON c.id = x.carga_catalogo_id
          WHERE x.carga_catalogo_id = ? AND c.estabelecimento_id = ? AND x.lote = ?
          ORDER BY x.linha LIMIT ${TETO_ITENS}`,
        [carga, est, lote],
        { teto: TETO_ITENS },
      ),
    );
    return linhas.map((r) => ({
      entidade: String(r['entidade']),
      chave: String(r['chave']),
      comparacao: txt(r['comparacao']),
      antes: objeto(r['valores_antes']),
      depois: objeto(r['valores']),
    }));
  }

  async publicarLote(c: CargaAPublicar, entrada: LoteCatalogo): Promise<void> {
    const def = definicaoCatalogo(c.catalogo);
    if (!def) throw recusa('catalogo-desconhecido', 'Catálogo desconhecido.');
    const est = await this.estabelecimento();
    const ctx = this.contexto(
      est,
      c,
      `catalogo-${c.id}-lote-${entrada.lote}`,
      `catalogo-${c.id}-lote-${entrada.lote}-de-${entrada.lotes}`,
    );
    await this.executor.executar(opPublicarLote(def), this.cliente, { versao: c.versao, lote: entrada }, ctx);
  }

  async marcarFalha(c: CargaAPublicar, motivo: string): Promise<void> {
    const est = await this.estabelecimento();
    const ctx = this.contexto(est, c, `catalogo-${c.id}-falha`, `catalogo-${c.id}-falha-v${c.versao}`);
    await this.executor.executar(opFalha, this.cliente, { id: c.id, versao: c.versao, motivo: motivo.slice(0, 500) }, ctx);
  }
}
