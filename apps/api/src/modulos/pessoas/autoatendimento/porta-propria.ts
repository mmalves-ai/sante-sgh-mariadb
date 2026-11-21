// Porta PRÓPRIA das solicitações do autoatendimento (W0-06, parte 6b-2; F2.2 lote 03-02) sobre o MariaDB do cliente,
// pelo @sgh/nucleo: solicitacao_colaborador com o tipo_solicitacao_colaborador (pelo código do contrato), o vínculo de
// trabalho do pedido, o ajuste_ponto ligado e o usuario de quem pediu e de quem decidiu. Leituras somente leitura no
// estabelecimento da sessão; gravações numa operação do Executor (gravacaoDireta: trilha, outbox e idempotência na
// mesma transação), com a solicitação travada e conferida pela versão.
// Melhoria: quem pediu (a conta da sessão, criado_por) e quem decidiu são contas (FK para usuario), não login solto; a desistência guarda o instante
// próprio (desistido_em) e a recusa exige o motivo (CHECK do banco).
// Melhoria: a decisão é recusada ao solicitante e a desistência a quem não pediu também na porta do banco (antes, só na
// memória e no serviço).
// Melhoria: o tipo do pedido é cadastro (FK pelo código); o tipo que faltar recusa com `cadastro-pendente`.
// Melhoria: os ajustes do ponto ligados ao pedido ficam no detalhe do pedido (dados.ajustes), como o modelo prevê.
// Pendente (pedido em docs/obra/fatias/f22/saida/03-02.json): o atestado (com o CID restrito) e a trilha de acesso a ele
// não têm tabela: incluir e ler o atestado recusam com `modelo-pendente`; como nada pode ter sido gravado, a lista de
// acessos é de fato vazia. O efeito da aprovação no ponto, nas férias e no cadastro usa os gravadores das portas
// próprias desses módulos sobre a mesma transação (`efeitos`); enquanto não forem ligados, a aprovação que tem efeito
// recusa com `modelo-pendente` e nada é gravado pela metade.
import { ErroOperacao, recusa, type TxOperacao } from '@sgh/nucleo';
import { type AnotacaoGravacao, gravacaoDireta } from '../../enfermagem/gravacao-direta.js';
import type { GravacaoFeita, TrilhaDaGravacao } from '../../exames/public-api.js';
import {
  dataIso,
  exigirUsuario,
  instante,
  instanteN,
  json,
  type L,
  lerNoEstabelecimento,
  type Linha,
  marcas,
  modeloPendente,
  n,
  type NucleoQualidade,
  paraBanco,
  relogioDoEstabelecimento,
  texto,
  textoN,
} from '../../qualidade/apoio-propria.js';
import type {
  ContextoAutoatendimento,
  FiltroSolicitacoesPorta,
  GravadorAutoatendimento,
  PortaAutoatendimento,
} from './porta-autoatendimento.js';
import type {
  AcessoAtestado,
  AjusteDaSolicitacao,
  SituacaoSolicitacao,
  SolicitacaoRegistrada,
  TipoSolicitacao,
} from './tipos.js';

/** As tabelas que a gravação da solicitação escreve (mais as dos efeitos ligados). */
export const TABELAS_SOLICITACAO = ['solicitacao_colaborador'] as const;

/** Os gravadores dos efeitos da aprovação (ponto, férias e cadastro) sobre a MESMA transação. */
export interface EfeitosAutoatendimento {
  readonly tabelas: readonly string[];
  gravadores(tx: TxOperacao, est: number): Pick<GravadorAutoatendimento, 'ponto' | 'folha' | 'pessoas'>;
}

const PENDENTE_ATESTADO = 'O atestado do autoatendimento (dados do atestado com o CID e a trilha de acesso)';
const PENDENTE_EFEITO = 'O efeito da aprovação no ponto, nas férias ou no cadastro do colaborador';

/** Um gravador de efeito ainda não ligado: toda chamada recusa (a transação inteira é desfeita). */
function efeitoPendente<T extends object>(): T {
  return new Proxy({} as T, {
    get: () => () => Promise.reject(modeloPendente(PENDENTE_EFEITO)),
  });
}

/** O detalhe do pedido gravado em `dados` (o que não tem coluna própria). */
interface DetalheSolicitacao {
  readonly vinculo?: number;
  readonly diasGozo?: number | null;
  readonly diasAbono?: number | null;
  readonly adiantaDecimo?: boolean | null;
  readonly movimento?: number | null;
  readonly justificativa?: number | null;
  readonly campo?: string | null;
  readonly valorAnterior?: string | null;
  readonly valorNovo?: string | null;
  readonly ferias?: number | null;
  readonly ajustes?: readonly number[];
}

const desatualizado = () =>
  new ErroOperacao(
    409,
    'desatualizado',
    'Operação recusada',
    'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
  );
const mesmo = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

const SQL_SOLICITACAO = `
  SELECT s.id, s.situacao, s.solicitado_em, s.data_inicio, s.data_fim, s.dados, s.justificativa, s.arquivo_id,
         s.decidido_em, s.motivo_decisao, s.versao, t.codigo AS tipo, up.login AS pedido_por, ud.login AS decidido_por
    FROM solicitacao_colaborador s
    JOIN tipo_solicitacao_colaborador t ON t.id = s.tipo_solicitacao_colaborador_id
    LEFT JOIN usuario up ON up.id = s.criado_por
    LEFT JOIN usuario ud ON ud.id = s.decidido_por_usuario_id
   WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL`;

function solicitacaoDe(r: Linha): SolicitacaoRegistrada {
  const d = json<DetalheSolicitacao>(r['dados'], {});
  return {
    id: n(r['id']),
    vinculo: n(d.vinculo),
    tipo: texto(r['tipo']) as TipoSolicitacao,
    inicio: dataIso(r['data_inicio']),
    fim: dataIso(r['data_fim']),
    diasGozo: d.diasGozo ?? null,
    diasAbono: d.diasAbono ?? null,
    adiantaDecimo: d.adiantaDecimo ?? null,
    movimento: d.movimento ?? null,
    justificativa: d.justificativa ?? null,
    campo: (d.campo ?? null) as SolicitacaoRegistrada['campo'],
    valorAnterior: d.valorAnterior ?? null,
    valorNovo: d.valorNovo ?? null,
    observacao: textoN(r['justificativa']),
    situacao: texto(r['situacao']) as SituacaoSolicitacao,
    pedidoPor: texto(r['pedido_por']),
    pedidoEm: instante(r['solicitado_em']),
    decididoPor: textoN(r['decidido_por']),
    decididoEm: instanteN(r['decidido_em']),
    motivoDecisao: textoN(r['motivo_decisao']),
    ferias: d.ferias ?? null,
    temAtestado: false,
    versao: n(r['versao']),
  } as SolicitacaoRegistrada;
}

/** A situação do ajuste do ponto como a tela da solicitação conhece. */
const SITUACAO_AJUSTE: Readonly<Record<string, string>> = {
  pendente: 'pendente',
  aprovado: 'aprovado',
  recusado: 'recusado',
  cancelado: 'desistido',
};

async function lerSolicitacao(l: L, est: number, id: number): Promise<Linha | null> {
  return l.uma<Linha>(`${SQL_SOLICITACAO} AND s.id = ?`, [est, id]);
}

/** A solicitação travada para a decisão (SELECT ... FOR UPDATE na transação da operação). */
async function travarSolicitacao(tx: TxOperacao, est: number, id: number): Promise<Linha | null> {
  const [r] = await tx.consultarParaAtualizar<Linha>(`${SQL_SOLICITACAO} AND s.id = ?`, [est, id], {
    teto: 1,
  });
  return r ?? null;
}

async function ajustesDe(l: L, est: number, solicitacao: number): Promise<AjusteDaSolicitacao[]> {
  const s = await l.uma<Linha>(
    'SELECT dados FROM solicitacao_colaborador WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [solicitacao, est],
  );
  const ids = (json<DetalheSolicitacao>(s?.['dados'], {}).ajustes ?? []).filter((x) => Number.isInteger(x));
  if (ids.length === 0) return [];
  const rs = await l.consultar<Linha>(
    `SELECT id, COALESCE(marcacao_em, solicitado_em) AS dia, situacao, versao FROM ajuste_ponto
      WHERE estabelecimento_id = ? AND excluido_em IS NULL AND id IN (${marcas(ids.length)})
      ORDER BY dia, id`,
    [est, ...ids],
    { teto: 500 },
  );
  return rs.map((r) => ({
    id: n(r['id']),
    dia: dataIso(r['dia']) ?? '',
    situacao: (SITUACAO_AJUSTE[texto(r['situacao'])] ??
      texto(r['situacao'])) as AjusteDaSolicitacao['situacao'],
    versao: n(r['versao']),
  }));
}

function gravador(
  tx: TxOperacao,
  est: number,
  anotacao: AnotacaoGravacao,
  efeitos: EfeitosAutoatendimento | null,
): GravadorAutoatendimento {
  const agora = async () => paraBanco(await relogioDoEstabelecimento(tx, est));
  const travada = async (id: number, versao: number) => {
    const r = await travarSolicitacao(tx, est, id);
    if (!r || n(r['versao']) !== versao || r['situacao'] !== 'pendente') throw desatualizado();
    return r;
  };
  const e = efeitos?.gravadores(tx, est) ?? {
    ponto: efeitoPendente<GravadorAutoatendimento['ponto']>(),
    folha: efeitoPendente<GravadorAutoatendimento['folha']>(),
    pessoas: efeitoPendente<GravadorAutoatendimento['pessoas']>(),
  };
  return {
    async solicitacao(id) {
      const r = await lerSolicitacao(tx, est, id);
      return r ? solicitacaoDe(r) : null;
    },
    async incluirSolicitacao(x) {
      const tipo = await tx.uma<{ id: number }>(
        'SELECT id FROM tipo_solicitacao_colaborador WHERE codigo = ? AND ativo = TRUE',
        [x.tipo],
      );
      if (!tipo)
        throw recusa(
          'cadastro-pendente',
          `O tipo de solicitação "${x.tipo}" não está cadastrado: peça ao RH que cadastre os tipos do autoatendimento.`,
        );
      const v = await tx.uma<{ colaborador_id: number }>(
        'SELECT colaborador_id FROM vinculo_trabalho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.vinculo, est],
      );
      if (!v) throw recusa('vinculo-inexistente', 'O vínculo do pedido não existe neste estabelecimento.');
      const detalhe: DetalheSolicitacao = {
        vinculo: x.vinculo,
        diasGozo: x.diasGozo,
        diasAbono: x.diasAbono,
        adiantaDecimo: x.adiantaDecimo,
        movimento: x.movimento,
        justificativa: x.justificativa,
        campo: x.campo,
        valorAnterior: x.valorAnterior,
        valorNovo: x.valorNovo,
        ajustes: [],
      };
      return tx.incluir('solicitacao_colaborador', {
        estabelecimento_id: est,
        colaborador_id: Number(v.colaborador_id),
        tipo_solicitacao_colaborador_id: Number(tipo.id),
        situacao: 'pendente',
        solicitado_em: await agora(),
        data_inicio: x.inicio,
        data_fim: x.fim,
        dados: JSON.stringify(detalhe),
        justificativa: x.observacao,
      });
    },
    incluirAtestado: () => Promise.reject(modeloPendente(PENDENTE_ATESTADO)),
    async decidirSolicitacao(x) {
      const r = await travada(x.id, x.versao);
      if (mesmo(texto(r['pedido_por']), x.por))
        throw recusa('solicitacao-decisao-pelo-solicitante', 'Quem pediu não decide a própria solicitação.');
      if (r['tipo'] === 'ferias' && x.situacao === 'aprovada' && x.ferias === null)
        throw recusa('ferias-obrigatoria', 'A aprovação das férias exige a programação.');
      const d = json<DetalheSolicitacao>(r['dados'], {});
      if (x.motivo) anotacao.motivo = x.motivo;
      await tx.alterar('solicitacao_colaborador', x.id, x.versao, {
        situacao: x.situacao,
        decidido_por_usuario_id: await exigirUsuario(tx, x.por),
        decidido_em: await agora(),
        motivo_decisao: x.motivo,
        dados: JSON.stringify({ ...d, ferias: x.ferias }),
      });
    },
    async desistirSolicitacao(x) {
      const atual = await travarSolicitacao(tx, est, x.id);
      if (atual && !mesmo(texto(atual['pedido_por']), x.por))
        throw recusa(
          'solicitacao-desistencia-so-do-solicitante',
          'Só quem pediu pode desistir da solicitação. O gestor aprova ou recusa, com o motivo.',
        );
      await travada(x.id, x.versao);
      const em = await agora();
      anotacao.motivo = x.motivo;
      await tx.alterar('solicitacao_colaborador', x.id, x.versao, {
        situacao: 'desistida',
        desistido_em: em,
        decidido_por_usuario_id: await exigirUsuario(tx, x.por),
        decidido_em: em,
        motivo_decisao: x.motivo,
      });
    },
    async ligarAjuste(x) {
      const r = await travarSolicitacao(tx, est, x.solicitacao);
      const a = await tx.uma<{ id: number }>(
        'SELECT id FROM ajuste_ponto WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.ajuste, est],
      );
      const d = json<DetalheSolicitacao>(r?.['dados'], {});
      if (!r || !a || (d.ajustes ?? []).includes(x.ajuste)) throw desatualizado();
      await tx.alterar('solicitacao_colaborador', x.solicitacao, n(r['versao']), {
        dados: JSON.stringify({ ...d, ajustes: [...(d.ajustes ?? []), x.ajuste] }),
      });
    },
    ajustesDaSolicitacao: (id) => ajustesDe(tx, est, id),
    atestado: () => Promise.reject(modeloPendente(PENDENTE_ATESTADO)),
    ponto: e.ponto,
    folha: e.folha,
    pessoas: e.pessoas,
  };
}

export class PortaAutoatendimentoPropria implements PortaAutoatendimento {
  readonly destino = 'banco' as const;
  private executor: ReturnType<NucleoQualidade['criarExecutor']> | null = null;

  constructor(
    private readonly nucleo: NucleoQualidade,
    private readonly efeitos: EfeitosAutoatendimento | null = null,
  ) {}

  private ler<T>(c: ContextoAutoatendimento, fn: (l: L, est: number) => Promise<T>): Promise<T> {
    return lerNoEstabelecimento(this.nucleo, { ...c, correlacao: c.correlacao || 'autoatendimento' }, fn);
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }
  async executar(): Promise<GravacaoFeita> {
    throw recusa('operacao-desconhecida', 'O autoatendimento não usa operação de tela do executor.');
  }
  gravarSgh<T>(
    c: ContextoAutoatendimento,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorAutoatendimento) => Promise<T>,
  ): Promise<T> {
    this.executor ??= this.nucleo.criarExecutor();
    const efeitos = this.efeitos;
    return gravacaoDireta(this.executor, c, {
      nome: 'pessoas.autoatendimento.gravar',
      tabelas: [...TABELAS_SOLICITACAO, ...(efeitos?.tabelas ?? [])],
      trilha,
      gravador: (tx, est, anotacao) => gravador(tx, est, anotacao, efeitos),
      fn,
    });
  }

  hoje(c: ContextoAutoatendimento): Promise<string> {
    return this.ler(c, async (l, est) => (await relogioDoEstabelecimento(l, est)).slice(0, 10));
  }
  solicitacoes(c: ContextoAutoatendimento, f: FiltroSolicitacoesPorta): Promise<SolicitacaoRegistrada[]> {
    const vs = f.vinculos ?? null;
    if (vs !== null && vs.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) => {
      let sql = SQL_SOLICITACAO;
      const p: unknown[] = [est];
      if (vs !== null) {
        sql += ` AND CAST(JSON_VALUE(s.dados, '$.vinculo') AS UNSIGNED) IN (${marcas(vs.length)})`;
        p.push(...vs);
      }
      if (f.situacao) {
        sql += ' AND s.situacao = ?';
        p.push(f.situacao);
      }
      // Um a mais que o teto da tela: o serviço avisa que a lista foi cortada.
      const rs = await l.consultar<Linha>(`${sql} ORDER BY s.solicitado_em DESC, s.id DESC LIMIT 501`, p, {
        teto: 501,
      });
      return rs.map(solicitacaoDe);
    });
  }
  solicitacao(c: ContextoAutoatendimento, id: number): Promise<SolicitacaoRegistrada | null> {
    return this.ler(c, async (l, est) => {
      const r = await lerSolicitacao(l, est, id);
      return r ? solicitacaoDe(r) : null;
    });
  }
  ajustesDaSolicitacao(c: ContextoAutoatendimento, solicitacao: number): Promise<AjusteDaSolicitacao[]> {
    return this.ler(c, (l, est) => ajustesDe(l, est, solicitacao));
  }
  /** O atestado ainda não tem tabela: nenhum acesso pode ter sido gravado neste banco. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta; a operação aguarda o modelo
  async acessosAtestado(_c: ContextoAutoatendimento, _solicitacao: number): Promise<AcessoAtestado[]> {
    return [];
  }
}
