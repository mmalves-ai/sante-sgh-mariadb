// Homologação do fornecedor por questionário pontuado (09-AREA linha 66) sobre o MariaDB do cliente pelo Executor do
// núcleo (trilha na mesma transação, versão conferida, Idempotency-Key honrada). As regras são do domínio
// (`@sgh/contratos/regras-suprimentos`, homologacao-fornecedor); aqui ficam a leitura, a trava das linhas e a gravação:
//   - questionario_homologacao + questionario_homologacao_pergunta: o modelo com a nota mínima, a validade e as
//     perguntas com peso e as opções pontuadas (JSON); o encerramento só fecha a vigência (nada apagado);
//   - homologacao_fornecedor + homologacao_fornecedor_resposta: a avaliação com a nota, a faixa, a situação e a
//     validade, e uma resposta por pergunta com os pontos e o peso; a exceção marca a reprovada como homologada com a
//     justificativa (por quem não avaliou); o cancelamento fica na situação, com o motivo na trilha.
// O faixa_avaliacao_fornecedor (cadastro das faixas) é só lido.
import {
  calcularNotaHomologacao,
  classificarHomologacao,
  conferirCancelamentoHomologacao,
  conferirExcecaoHomologacao,
  conferirQuestionarioHomologacao,
  type FaixaHomologacao,
  type HomologacaoResumo,
  type OpcaoHomologacao,
  type PerguntaHomologacao,
  type PosicaoRanking,
  type QuestionarioHomologacaoEntrada,
  rankingHomologacao,
  type RecusaSuprimentos,
  type RespostaHomologacaoEntrada,
  type ResultadoFaixaHomologacao,
  type SituacaoHomologacao,
  situacaoNaDataHomologacao,
  type TipoRespostaHomologacao,
  validadeHomologacao,
} from '@sgh/contratos/regras-suprimentos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  type Linha,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';

export const PORTA_HOMOLOGACAO_FORNECEDOR = Symbol('PORTA_HOMOLOGACAO_FORNECEDOR');
export const TABELAS_HOMOLOGACAO_FORNECEDOR = [
  'questionario_homologacao',
  'questionario_homologacao_pergunta',
  'homologacao_fornecedor',
  'homologacao_fornecedor_resposta',
] as const;
export const OPERACOES_HOMOLOGACAO_FORNECEDOR = {
  questionario: 'suprimentos.homologacao.gravar-questionario',
  encerrarQuestionario: 'suprimentos.homologacao.encerrar-questionario',
  avaliar: 'suprimentos.homologacao.avaliar',
  excecao: 'suprimentos.homologacao.aprovar-excecao',
  cancelar: 'suprimentos.homologacao.cancelar',
} as const;
const TETO_HOMOLOGACOES = 500;

export interface QuestionarioDetalhe {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly categoria: number | null;
  readonly categoriaDescricao: string | null;
  readonly notaMinima: number;
  readonly validadeMeses: number;
  readonly instrucoes: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly vigente: boolean;
  readonly perguntas: readonly PerguntaHomologacao[];
}

export interface HomologacaoLinha extends HomologacaoResumo {
  readonly versao: number;
  readonly questionarioDescricao: string;
  readonly categoriaDescricao: string | null;
  readonly insumoDescricao: string | null;
  readonly faixa: string | null;
  readonly justificativa: string | null;
  readonly avaliador: number;
  readonly avaliadorLogin: string | null;
  readonly situacaoNaData: SituacaoHomologacao;
  readonly requalificar: boolean;
}

export interface HomologacaoDetalhe extends HomologacaoLinha {
  readonly respostas: readonly {
    readonly sequencia: number;
    readonly pergunta: string;
    readonly resposta: string | null;
    readonly atende: boolean | null;
    readonly pontuacao: number;
    readonly peso: number;
  }[];
}

export interface PainelHomologacao {
  readonly hoje: string;
  readonly usuario: number | null;
  readonly questionarios: readonly QuestionarioDetalhe[];
  readonly faixas: readonly FaixaHomologacao[];
  readonly categorias: readonly {
    readonly id: number;
    readonly codigo: string;
    readonly descricao: string;
  }[];
  readonly homologacoes: readonly HomologacaoLinha[];
  readonly ranking: readonly (PosicaoRanking & { readonly questionarioDescricao: string })[];
}

export interface AvaliacaoHomologacaoEntrada {
  readonly fornecedor: number;
  readonly questionario: number;
  readonly insumo: number | null;
  readonly respostas: readonly RespostaHomologacaoEntrada[];
}

export interface ResultadoAvaliacao {
  readonly id: number;
  readonly nota: number;
  readonly situacao: 'homologado' | 'reprovado';
  readonly faixa: string | null;
  readonly comRestricao: boolean;
  readonly validoAte: string | null;
  readonly motivos: readonly string[];
  readonly parcelas: readonly string[];
}

export interface PortaHomologacaoFornecedor {
  readonly destino: 'banco' | 'indisponivel';
  painel(c: ContextoPortaM18): Promise<PainelHomologacao>;
  detalhe(c: ContextoPortaM18, id: number): Promise<HomologacaoDetalhe>;
  fornecedores(
    c: ContextoPortaM18,
    termo: string,
  ): Promise<{ id: number; nome: string; documento: string | null; situacao: string }[]>;
  gravarQuestionario(
    c: ContextoPortaM18,
    e: QuestionarioHomologacaoEntrada,
    chave: string,
  ): Promise<{ id: number }>;
  encerrarQuestionario(
    c: ContextoPortaM18,
    id: number,
    fim: string,
    versao: number,
    chave: string,
  ): Promise<{ id: number }>;
  avaliar(c: ContextoPortaM18, e: AvaliacaoHomologacaoEntrada, chave: string): Promise<ResultadoAvaliacao>;
  aprovarExcecao(
    c: ContextoPortaM18,
    id: number,
    justificativa: string,
    versao: number,
    chave: string,
  ): Promise<{ id: number; validoAte: string | null }>;
  cancelar(
    c: ContextoPortaM18,
    id: number,
    motivo: string,
    versao: number,
    chave: string,
  ): Promise<{ id: number }>;
}

export function portaHomologacaoFornecedorIndisponivel(): PortaHomologacaoFornecedor {
  const falha = (): never => {
    throw new ErroProblema('indisponivel', 503, 'A homologação de fornecedores exige o banco próprio.');
  };
  return {
    destino: 'indisponivel',
    painel: falha,
    detalhe: falha,
    fornecedores: falha,
    gravarQuestionario: falha,
    encerrarQuestionario: falha,
    avaliar: falha,
    aprovarExcecao: falha,
    cancelar: falha,
  };
}

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const tx_ = (v: unknown) => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown) => v === true || Number(v) === 1;
const opcoesJson = (v: unknown): OpcaoHomologacao[] => {
  if (v === null || v === undefined) return [];
  const bruto = (typeof v === 'string' ? JSON.parse(v) : v) as {
    ordem: unknown;
    texto: unknown;
    pontos: unknown;
  }[];
  return Array.isArray(bruto)
    ? bruto.map((o) => ({ ordem: n(o.ordem), texto: String(o.texto), pontos: n(o.pontos) }))
    : [];
};

function recusarTodas(rs: readonly RecusaSuprimentos[]): void {
  const [r] = rs;
  if (r)
    throw recusa(r.codigo, rs.map((x) => x.mensagem).join(' '), {
      campos: [...new Set(rs.flatMap((x) => x.campos ?? []))],
    });
}

const SQL_QUESTIONARIO = `SELECT q.id, q.versao, q.codigo, q.descricao, q.categoria_fornecimento_id, c.descricao AS categoria_descricao,
    q.nota_minima, q.validade_meses, q.instrucoes, DATE_FORMAT(q.vigencia_inicio, '%Y-%m-%d') AS vigencia_inicio,
    DATE_FORMAT(q.vigencia_fim, '%Y-%m-%d') AS vigencia_fim, q.ativo
   FROM questionario_homologacao q LEFT JOIN categoria_fornecimento c ON c.id = q.categoria_fornecimento_id`;

async function perguntasDe(
  l: Pick<Leitor, 'consultar'>,
  questionario: number,
): Promise<PerguntaHomologacao[]> {
  const rs = await l.consultar<Linha>(
    `SELECT id, sequencia, identificador, texto, peso, tipo_resposta, respostas, obrigatoria, eliminatoria
       FROM questionario_homologacao_pergunta
      WHERE questionario_homologacao_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
    [questionario],
  );
  return rs.map((r) => ({
    id: n(r['id']),
    sequencia: n(r['sequencia']),
    identificador: tx_(r['identificador']),
    texto: String(r['texto']),
    peso: n(r['peso']),
    tipoResposta: String(r['tipo_resposta']) as TipoRespostaHomologacao,
    opcoes: opcoesJson(r['respostas']),
    obrigatoria: bool(r['obrigatoria']),
    eliminatoria: bool(r['eliminatoria']),
  }));
}

async function questionarioDe(
  l: Leitor | TxOperacao,
  id: number,
  hoje: string,
): Promise<QuestionarioDetalhe> {
  const r = await l.uma<Linha>(`${SQL_QUESTIONARIO} WHERE q.id = ?`, [id]);
  if (!r)
    throw recusa('questionario-inexistente', 'O questionário não existe.', { campos: ['questionario'] });
  return questionarioDaLinha(r, await perguntasDe(l, id), hoje);
}

function questionarioDaLinha(r: Linha, perguntas: PerguntaHomologacao[], hoje: string): QuestionarioDetalhe {
  const inicio = String(r['vigencia_inicio']);
  const fim = tx_(r['vigencia_fim']);
  return {
    id: n(r['id']),
    versao: n(r['versao']),
    codigo: String(r['codigo']),
    descricao: String(r['descricao']),
    categoria: nn(r['categoria_fornecimento_id']),
    categoriaDescricao: tx_(r['categoria_descricao']),
    notaMinima: n(r['nota_minima']),
    validadeMeses: n(r['validade_meses']),
    instrucoes: tx_(r['instrucoes']),
    vigenciaInicio: inicio,
    vigenciaFim: fim,
    vigente: bool(r['ativo']) && inicio <= hoje && (fim === null || fim >= hoje),
    perguntas,
  };
}

async function faixasDe(l: Pick<Leitor, 'consultar'>): Promise<FaixaHomologacao[]> {
  const rs = await l.consultar<Linha>(
    `SELECT id, codigo, descricao, nota_inicial, nota_final, resultado FROM faixa_avaliacao_fornecedor
      WHERE ativo ORDER BY ordem, nota_inicial DESC`,
    [],
  );
  return rs.map((r) => ({
    id: n(r['id']),
    codigo: String(r['codigo']),
    descricao: String(r['descricao']),
    notaInicial: n(r['nota_inicial']),
    notaFinal: n(r['nota_final']),
    resultado: String(r['resultado']) as ResultadoFaixaHomologacao,
  }));
}

const SQL_HOMOLOGACAO = `SELECT h.id, h.versao, h.empresa_fornecedora_id, COALESCE(f.nome_fantasia, f.razao_social) AS fornecedor_nome,
    h.questionario_homologacao_id, q.descricao AS questionario_descricao, c.descricao AS categoria_descricao,
    i.nome AS insumo_nome, h.situacao, h.nota, h.excecao_aprovada, h.justificativa, fx.descricao AS faixa_descricao,
    DATE_FORMAT(h.avaliado_em, '%Y-%m-%d %H:%i:%s') AS avaliado_em, DATE_FORMAT(h.valido_ate, '%Y-%m-%d') AS valido_ate,
    h.avaliador_usuario_id, u.login AS avaliador_login
   FROM homologacao_fornecedor h
   JOIN empresa_fornecedora f ON f.id = h.empresa_fornecedora_id
   JOIN questionario_homologacao q ON q.id = h.questionario_homologacao_id
   LEFT JOIN categoria_fornecimento c ON c.id = h.categoria_fornecimento_id
   LEFT JOIN insumo i ON i.id = h.insumo_id
   LEFT JOIN faixa_avaliacao_fornecedor fx ON fx.id = h.faixa_avaliacao_fornecedor_id
   LEFT JOIN usuario u ON u.id = h.avaliador_usuario_id
  WHERE h.estabelecimento_id = ? AND h.excluido_em IS NULL`;

function homologacaoDaLinha(r: Linha, hoje: string): HomologacaoLinha {
  const base = {
    id: n(r['id']),
    versao: n(r['versao']),
    fornecedor: n(r['empresa_fornecedora_id']),
    fornecedorNome: String(r['fornecedor_nome']),
    questionario: n(r['questionario_homologacao_id']),
    questionarioDescricao: String(r['questionario_descricao']),
    categoriaDescricao: tx_(r['categoria_descricao']),
    insumoDescricao: tx_(r['insumo_nome']),
    situacao: String(r['situacao']) as SituacaoHomologacao,
    nota: nn(r['nota']),
    excecao: bool(r['excecao_aprovada']),
    justificativa: tx_(r['justificativa']),
    faixa: tx_(r['faixa_descricao']),
    avaliadoEm: String(r['avaliado_em']),
    validoAte: tx_(r['valido_ate']),
    avaliador: n(r['avaliador_usuario_id']),
    avaliadorLogin: tx_(r['avaliador_login']),
  };
  const s = situacaoNaDataHomologacao(base, hoje);
  return { ...base, situacaoNaData: s.situacao, requalificar: s.requalificar };
}

async function hojeDe(l: Pick<Leitor, 'uma'>): Promise<string> {
  const r = await l.uma<Linha>("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') AS hoje", []);
  return String(r?.['hoje']);
}

export class PortaHomologacaoFornecedorPropria implements PortaHomologacaoFornecedor {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private contexto(c: ContextoPortaM18): ContextoNucleo & { estabelecimento: number } {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: c.correlacao || 'homologacao-fornecedor',
    };
  }

  private async executar<
    R extends Readonly<Record<string, string | number | boolean | null>> & { id: number },
  >(
    c: ContextoPortaM18,
    nome: string,
    entrada: Record<string, unknown>,
    chave: string,
    gravar: (tx: TxOperacao, est: number) => Promise<R>,
    alvo: string,
    motivo: string | null = null,
  ): Promise<R> {
    const ctxN = this.contexto(c);
    const op = definirOperacao({
      nome,
      tabelas: [...TABELAS_HOMOLOGACAO_FORNECEDOR],
      entrada: z.unknown(),
      gravar: (tx: TxOperacao) => gravar(tx, ctxN.estabelecimento),
      alvo: (_e, r: R) => ({ tabela: alvo, id: r.id }),
      trilha: () => ({ dados: entrada, motivo }),
    });
    const ctx: ContextoOperacao = { ...ctxN, chaveIdempotencia: chave };
    const { resultado } = await this.executor.executar(op, c.cliente, entrada, ctx);
    return resultado as R;
  }

  /** A homologação do estabelecimento, travada para a gravação. */
  private async homologacaoTravada(tx: TxOperacao, est: number, id: number) {
    const [r] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, situacao, excecao_aprovada, avaliador_usuario_id, DATE_FORMAT(avaliado_em, '%Y-%m-%d') AS avaliado_em,
              questionario_homologacao_id
         FROM homologacao_fornecedor WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [id, est],
    );
    if (!r) throw recusa('nao-encontrado', 'A homologação não existe neste estabelecimento.');
    return {
      id: n(r['id']),
      versao: n(r['versao']),
      situacao: String(r['situacao']) as SituacaoHomologacao,
      excecao: bool(r['excecao_aprovada']),
      avaliador: n(r['avaliador_usuario_id']),
      avaliadoEm: String(r['avaliado_em']),
      questionario: n(r['questionario_homologacao_id']),
    };
  }

  painel(c: ContextoPortaM18): Promise<PainelHomologacao> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const hoje = await hojeDe(l);
      const qs = await l.consultar<Linha>(
        `${SQL_QUESTIONARIO} ORDER BY q.ativo DESC, q.descricao LIMIT 200`,
        [],
      );
      const questionarios: QuestionarioDetalhe[] = [];
      for (const r of qs) questionarios.push(questionarioDaLinha(r, await perguntasDe(l, n(r['id'])), hoje));
      const hs = (
        await l.consultar<Linha>(
          `${SQL_HOMOLOGACAO} ORDER BY h.avaliado_em DESC, h.id DESC LIMIT ${TETO_HOMOLOGACOES}`,
          [ctx.estabelecimento],
        )
      ).map((r) => homologacaoDaLinha(r, hoje));
      const ranking = questionarios.flatMap((q) =>
        rankingHomologacao(hs, q.id, hoje).map((x) => ({ ...x, questionarioDescricao: q.descricao })),
      );
      const categorias = await l.consultar<Linha>(
        'SELECT id, codigo, descricao FROM categoria_fornecimento WHERE ativo ORDER BY descricao LIMIT 200',
        [],
      );
      return {
        hoje,
        usuario: c.usuario ?? null,
        questionarios,
        faixas: await faixasDe(l),
        categorias: categorias.map((x) => ({
          id: n(x['id']),
          codigo: String(x['codigo']),
          descricao: String(x['descricao']),
        })),
        homologacoes: hs,
        ranking,
      };
    });
  }

  detalhe(c: ContextoPortaM18, id: number): Promise<HomologacaoDetalhe> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const hoje = await hojeDe(l);
      const r = await l.uma<Linha>(`${SQL_HOMOLOGACAO} AND h.id = ?`, [ctx.estabelecimento, id]);
      if (!r) throw recusa('nao-encontrado', 'A homologação não existe neste estabelecimento.');
      const rs = await l.consultar<Linha>(
        `SELECT r.sequencia, p.texto, r.resposta, r.atende, r.pontuacao, r.peso
           FROM homologacao_fornecedor_resposta r
           JOIN questionario_homologacao_pergunta p ON p.id = r.questionario_homologacao_pergunta_id
          WHERE r.homologacao_fornecedor_id = ? AND r.excluido_em IS NULL ORDER BY r.sequencia`,
        [id],
      );
      return {
        ...homologacaoDaLinha(r, hoje),
        respostas: rs.map((x) => ({
          sequencia: n(x['sequencia']),
          pergunta: String(x['texto']),
          resposta: tx_(x['resposta']),
          atende: x['atende'] === null || x['atende'] === undefined ? null : bool(x['atende']),
          pontuacao: n(x['pontuacao']),
          peso: n(x['peso']),
        })),
      };
    });
  }

  fornecedores(c: ContextoPortaM18, termo: string) {
    const ctx = this.contexto(c);
    const t = `%${termo.trim()}%`;
    return this.nucleo.lerSomente(ctx, async (l) =>
      (
        await l.consultar<Linha>(
          `SELECT id, razao_social, nome_fantasia, COALESCE(cnpj, cpf) AS documento, situacao FROM empresa_fornecedora
            WHERE excluido_em IS NULL AND situacao <> 'inativo'
              AND (razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj LIKE ?)
            ORDER BY razao_social LIMIT 30`,
          [t, t, t],
        )
      ).map((r) => ({
        id: n(r['id']),
        nome: String(r['nome_fantasia'] ?? r['razao_social']),
        documento: tx_(r['documento']),
        situacao: String(r['situacao']),
      })),
    );
  }

  gravarQuestionario(c: ContextoPortaM18, e: QuestionarioHomologacaoEntrada, chave: string) {
    const entrada = {
      ...e,
      perguntas: e.perguntas.map((p) => ({ ...p, opcoes: p.opcoes.map((o) => ({ ...o })) })),
    };
    return this.executar(
      c,
      OPERACOES_HOMOLOGACAO_FORNECEDOR.questionario,
      entrada,
      chave,
      async (tx) => {
        recusarTodas(conferirQuestionarioHomologacao(e));
        if (e.categoria !== null) {
          const k = await tx.uma<Linha>('SELECT id FROM categoria_fornecimento WHERE id = ? AND ativo', [
            e.categoria,
          ]);
          if (!k)
            throw recusa('categoria-inexistente', 'A categoria de fornecimento não existe ou está inativa.', {
              campos: ['categoria'],
            });
        }
        const codigo = e.codigo.trim().toUpperCase();
        const repetido = await tx.uma<Linha>('SELECT id FROM questionario_homologacao WHERE codigo = ?', [
          codigo,
        ]);
        if (repetido)
          throw recusa('questionario-codigo', 'Já existe questionário com este código.', {
            campos: ['codigo'],
          });
        const id = await tx.incluir('questionario_homologacao', {
          codigo,
          descricao: e.descricao.trim(),
          categoria_fornecimento_id: e.categoria,
          nota_minima: e.notaMinima,
          validade_meses: e.validadeMeses,
          instrucoes: e.instrucoes?.trim() || null,
          vigencia_inicio: e.vigenciaInicio,
          vigencia_fim: e.vigenciaFim,
          ativo: true,
        });
        let sequencia = 0;
        for (const p of e.perguntas)
          await tx.incluir('questionario_homologacao_pergunta', {
            questionario_homologacao_id: id,
            sequencia: ++sequencia,
            identificador: p.identificador?.trim() ? p.identificador.trim().toUpperCase() : null,
            texto: p.texto.trim(),
            peso: p.peso,
            tipo_resposta: p.tipoResposta,
            respostas:
              p.tipoResposta === 'escala' || p.tipoResposta === 'multipla_escolha'
                ? JSON.stringify(
                    [...p.opcoes]
                      .sort((a, b) => a.ordem - b.ordem)
                      .map((o) => ({
                        ordem: o.ordem,
                        texto: o.texto.trim(),
                        pontos: o.pontos,
                        padrao: false,
                      })),
                  )
                : null,
            obrigatoria: p.obrigatoria,
            eliminatoria: p.eliminatoria,
          });
        return { id };
      },
      'questionario_homologacao',
    );
  }

  encerrarQuestionario(c: ContextoPortaM18, id: number, fim: string, versao: number, chave: string) {
    return this.executar(
      c,
      OPERACOES_HOMOLOGACAO_FORNECEDOR.encerrarQuestionario,
      { id, fim, versao },
      chave,
      async (tx) => {
        await tx.consultarParaAtualizar<Linha>('SELECT id FROM questionario_homologacao WHERE id = ?', [id]);
        const q = await questionarioDe(tx, id, fim);
        if (fim < q.vigenciaInicio || (q.vigenciaFim !== null && fim > q.vigenciaFim))
          throw recusa(
            'questionario-vigencia',
            'O encerramento fica entre o início e o fim atual da vigência do questionário.',
            { campos: ['fim'] },
          );
        await tx.alterar('questionario_homologacao', id, versao, { vigencia_fim: fim });
        return { id };
      },
      'questionario_homologacao',
    );
  }

  async avaliar(
    c: ContextoPortaM18,
    e: AvaliacaoHomologacaoEntrada,
    chave: string,
  ): Promise<ResultadoAvaliacao> {
    const entrada = { ...e, respostas: e.respostas.map((x) => ({ ...x })) };
    const r = await this.executar(
      c,
      OPERACOES_HOMOLOGACAO_FORNECEDOR.avaliar,
      entrada,
      chave,
      async (tx, est) => {
        const hoje = await hojeDe(tx);
        const q = await questionarioDe(tx, e.questionario, hoje);
        if (!q.vigente)
          throw recusa('questionario-fora-vigencia', 'O questionário não está vigente hoje.', {
            campos: ['questionario'],
          });
        const f = await tx.uma<Linha>(
          "SELECT id FROM empresa_fornecedora WHERE id = ? AND excluido_em IS NULL AND situacao <> 'inativo'",
          [e.fornecedor],
        );
        if (!f)
          throw recusa('fornecedor-inexistente', 'O fornecedor não existe ou está inativo.', {
            campos: ['fornecedor'],
          });
        if (e.insumo !== null) {
          const i = await tx.uma<Linha>('SELECT id FROM insumo WHERE id = ? AND excluido_em IS NULL', [
            e.insumo,
          ]);
          if (!i) throw recusa('insumo-inexistente', 'O produto não existe.', { campos: ['insumo'] });
        }
        const calculo = calcularNotaHomologacao(q.perguntas, e.respostas);
        recusarTodas(calculo.recusas);
        const nota = calculo.nota!;
        const cl = classificarHomologacao(nota, q.notaMinima, await faixasDe(tx));
        const validoAte = cl.situacao === 'homologado' ? validadeHomologacao(hoje, q.validadeMeses) : null;
        const id = await tx.incluir('homologacao_fornecedor', {
          estabelecimento_id: est,
          empresa_fornecedora_id: e.fornecedor,
          questionario_homologacao_id: q.id,
          insumo_id: e.insumo,
          categoria_fornecimento_id: q.categoria,
          avaliador_usuario_id: tx.contexto.usuario,
          avaliado_em: new Date(),
          nota: nota.nota,
          faixa_avaliacao_fornecedor_id: cl.faixa?.id ?? null,
          excecao_aprovada: false,
          justificativa: null,
          valido_ate: validoAte,
          situacao: cl.situacao,
        });
        let sequencia = 0;
        for (const x of nota.respostas)
          await tx.incluir('homologacao_fornecedor_resposta', {
            homologacao_fornecedor_id: id,
            sequencia: ++sequencia,
            questionario_homologacao_pergunta_id: x.pergunta,
            resposta: x.resposta,
            atende: x.atende,
            pontuacao: x.pontuacao,
            peso: x.peso,
          });
        return {
          id,
          nota: nota.nota,
          situacao: cl.situacao,
          faixa: cl.faixa?.descricao ?? null,
          comRestricao: cl.comRestricao,
          validoAte,
          motivos: JSON.stringify(cl.motivos),
          parcelas: JSON.stringify(nota.parcelas),
        };
      },
      'homologacao_fornecedor',
    );
    return {
      id: r.id,
      nota: Number(r.nota),
      situacao: r.situacao as 'homologado' | 'reprovado',
      faixa: r.faixa === null ? null : String(r.faixa),
      comRestricao: r.comRestricao === true,
      validoAte: r.validoAte === null ? null : String(r.validoAte),
      motivos: JSON.parse(String(r.motivos)) as string[],
      parcelas: JSON.parse(String(r.parcelas)) as string[],
    };
  }

  aprovarExcecao(c: ContextoPortaM18, id: number, justificativa: string, versao: number, chave: string) {
    return this.executar(
      c,
      OPERACOES_HOMOLOGACAO_FORNECEDOR.excecao,
      { id, justificativa, versao },
      chave,
      async (tx, est) => {
        const h = await this.homologacaoTravada(tx, est, id);
        recusarTodas(conferirExcecaoHomologacao(h, n(tx.contexto.usuario), justificativa));
        const q = await questionarioDe(tx, h.questionario, h.avaliadoEm);
        const validoAte = validadeHomologacao(h.avaliadoEm, q.validadeMeses);
        await tx.alterar('homologacao_fornecedor', id, versao, {
          excecao_aprovada: true,
          justificativa: justificativa.trim(),
          situacao: 'homologado',
          valido_ate: validoAte,
        });
        return { id, validoAte };
      },
      'homologacao_fornecedor',
      justificativa.trim(),
    );
  }

  cancelar(c: ContextoPortaM18, id: number, motivo: string, versao: number, chave: string) {
    return this.executar(
      c,
      OPERACOES_HOMOLOGACAO_FORNECEDOR.cancelar,
      { id, motivo, versao },
      chave,
      async (tx, est) => {
        const h = await this.homologacaoTravada(tx, est, id);
        recusarTodas(conferirCancelamentoHomologacao(h.situacao, motivo));
        await tx.alterar('homologacao_fornecedor', id, versao, { situacao: 'cancelado' });
        return { id };
      },
      'homologacao_fornecedor',
      motivo.trim(),
    );
  }
}
