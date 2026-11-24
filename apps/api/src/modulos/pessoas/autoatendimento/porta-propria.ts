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
// O atestado fica em atestado_colaborador (um por solicitação), com o CID pelo catálogo CID-10 (termo_terminologia) e o
// anexo em arquivo; toda leitura do atestado grava o acesso em atestado_colaborador_acesso (quem, quando, a finalidade e
// se viu o CID), e o CID só sai a quem pediu para vê-lo.
// O efeito da aprovação no ponto, nas férias e no cadastro usa os gravadores das portas próprias desses módulos sobre a
// mesma transação, com o contexto de quem decide (`efeitos`, em efeitos-proprios.ts, ligados na composição do módulo);
// sem eles ligados, a aprovação que tem efeito recusa com `modelo-pendente` e nada é gravado pela metade.
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
  AtestadoRegistrado,
  SituacaoSolicitacao,
  SolicitacaoRegistrada,
  TipoSolicitacao,
} from './tipos.js';

/** As tabelas que a gravação da solicitação escreve (mais as dos efeitos ligados). */
export const TABELAS_SOLICITACAO = [
  'solicitacao_colaborador',
  'atestado_colaborador',
  'atestado_colaborador_acesso',
  'arquivo',
] as const;

/** Os gravadores dos efeitos da aprovação (ponto, férias e cadastro) sobre a MESMA transação. */
export interface EfeitosAutoatendimento {
  readonly tabelas: readonly string[];
  gravadores(
    tx: TxOperacao,
    est: number,
    c: ContextoAutoatendimento,
  ): Pick<GravadorAutoatendimento, 'ponto' | 'folha' | 'pessoas'>;
}

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
         s.decidido_em, s.motivo_decisao, s.versao, t.codigo AS tipo, up.login AS pedido_por, ud.login AS decidido_por,
         EXISTS (SELECT 1 FROM atestado_colaborador ac
                  WHERE ac.solicitacao_colaborador_id = s.id AND ac.excluido_em IS NULL) AS tem_atestado
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
    temAtestado: Number(r['tem_atestado'] ?? 0) > 0,
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

/** O CID-10 do catálogo guarda o código sem ponto (J111); o contrato mostra com ponto depois do 3º caractere (J11.1). */
const cidSemPonto = (cid: string) => cid.trim().toUpperCase().replace('.', '');
const cidComPonto = (codigo: string) =>
  codigo.length > 3 ? `${codigo.slice(0, 3)}.${codigo.slice(3)}` : codigo;

const SQL_ATESTADO = `
  SELECT a.id, a.solicitacao_colaborador_id, a.emitido_em, a.dias, tt.codigo_termo AS cid, a.emitente,
         a.registro_conselho, ar.chave_armazenamento, ar.hash_sha256, ar.tipo_mime, ar.tamanho_bytes,
         u.login AS criado_login, a.criado_em
    FROM atestado_colaborador a
    JOIN solicitacao_colaborador s ON s.id = a.solicitacao_colaborador_id
    LEFT JOIN termo_terminologia tt ON tt.id = a.cid_termo_terminologia_id
    LEFT JOIN arquivo ar ON ar.id = a.arquivo_id
    LEFT JOIN usuario u ON u.id = a.criado_por
   WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL AND a.excluido_em IS NULL
     AND a.solicitacao_colaborador_id = ?`;

function atestadoDe(r: Linha, verCid: boolean): AtestadoRegistrado {
  const cid = textoN(r['cid']);
  const chave = textoN(r['chave_armazenamento']);
  return {
    id: n(r['id']),
    solicitacao: n(r['solicitacao_colaborador_id']),
    emitidoEm: dataIso(r['emitido_em']) ?? '',
    dias: n(r['dias']),
    cid: verCid && cid ? cidComPonto(cid) : null,
    temCid: cid !== null,
    emitente: texto(r['emitente']),
    registroConselho: textoN(r['registro_conselho']),
    arquivo:
      chave === null
        ? null
        : {
            chave,
            hash: texto(r['hash_sha256']),
            tipo: texto(r['tipo_mime']) as NonNullable<AtestadoRegistrado['arquivo']>['tipo'],
            tamanho: n(r['tamanho_bytes']),
          },
    criadoPor: texto(r['criado_login']),
    criadoEm: instante(r['criado_em']),
  } as AtestadoRegistrado;
}

async function acessosDe(l: L, est: number, solicitacao: number): Promise<AcessoAtestado[]> {
  const rs = await l.consultar<Linha>(
    `SELECT x.id, u.login, x.acessado_em, x.viu_cid, x.finalidade
       FROM atestado_colaborador_acesso x
       JOIN atestado_colaborador a ON a.id = x.atestado_colaborador_id AND a.excluido_em IS NULL
       JOIN solicitacao_colaborador s ON s.id = a.solicitacao_colaborador_id
       JOIN usuario u ON u.id = x.usuario_id
      WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL AND a.solicitacao_colaborador_id = ?
      ORDER BY x.acessado_em DESC, x.id DESC LIMIT 500`,
    [est, solicitacao],
    { teto: 500 },
  );
  return rs.map((r) => ({
    id: n(r['id']),
    acessadoPor: texto(r['login']),
    acessadoEm: instante(r['acessado_em']),
    viuCid: Number(r['viu_cid']) === 1 || r['viu_cid'] === true,
    finalidade: texto(r['finalidade']),
  }));
}

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
  c: ContextoAutoatendimento,
): GravadorAutoatendimento {
  const agora = async () => paraBanco(await relogioDoEstabelecimento(tx, est));
  // A ligação do ajuste à solicitação (ligarAjuste) grava a solicitação pela versão e a sobe; a decisão que vem depois,
  // na MESMA transação, traz a versão lida antes da operação (como na memória, onde a ligação não muda a versão). As
  // subidas feitas por esta transação contam; a gravação de outra pessoa continua recusando com `desatualizado`.
  const subidas = new Map<number, number>();
  const travada = async (id: number, versao: number) => {
    const r = await travarSolicitacao(tx, est, id);
    if (!r || n(r['versao']) !== versao + (subidas.get(id) ?? 0) || r['situacao'] !== 'pendente')
      throw desatualizado();
    return r;
  };
  const e = efeitos?.gravadores(tx, est, c) ?? {
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
    async incluirAtestado(x) {
      const sol = await travarSolicitacao(tx, est, x.solicitacao);
      if (!sol) throw desatualizado();
      if (sol['tipo'] !== 'atestado')
        throw recusa('atestado-fora-do-tipo', 'Só a solicitação do tipo atestado recebe o atestado.');
      const ja = await tx.uma<{ id: number }>(
        'SELECT id FROM atestado_colaborador WHERE solicitacao_colaborador_id = ? LIMIT 1',
        [x.solicitacao],
      );
      if (ja) throw recusa('atestado-repetido', 'A solicitação já tem um atestado.');
      let cid: number | null = null;
      if (x.cid !== null) {
        const t = await tx.uma<{ id: number }>(
          `SELECT tt.id FROM termo_terminologia tt JOIN terminologia t ON t.id = tt.terminologia_id
            WHERE t.codigo = 'cid10' AND tt.codigo_termo = ? AND tt.ativo = TRUE
            ORDER BY tt.id LIMIT 1`,
          [cidSemPonto(x.cid)],
        );
        if (!t)
          throw recusa('cid-inexistente', 'O CID informado não está no catálogo CID-10 carregado.', {
            campos: ['cid'],
          });
        cid = n(t.id);
      }
      const arquivo =
        x.arquivo === null
          ? null
          : await tx.incluir('arquivo', {
              estabelecimento_id: est,
              entidade: 'atestado_colaborador',
              finalidade: 'atestado',
              nome_original: (x.arquivo.chave.split('/').at(-1) ?? 'atestado').slice(0, 255),
              tipo_mime: x.arquivo.tipo,
              tamanho_bytes: x.arquivo.tamanho,
              hash_sha256: x.arquivo.hash,
              chave_armazenamento: x.arquivo.chave,
            });
      return tx.incluir('atestado_colaborador', {
        solicitacao_colaborador_id: x.solicitacao,
        emitido_em: x.emitidoEm,
        dias: x.dias,
        cid_termo_terminologia_id: cid,
        emitente: x.emitente,
        registro_conselho: x.registroConselho,
        arquivo_id: arquivo,
      });
    },
    async decidirSolicitacao(x) {
      const r = await travada(x.id, x.versao);
      if (mesmo(texto(r['pedido_por']), x.por))
        throw recusa('solicitacao-decisao-pelo-solicitante', 'Quem pediu não decide a própria solicitação.');
      if (r['tipo'] === 'ferias' && x.situacao === 'aprovada' && x.ferias === null)
        throw recusa('ferias-obrigatoria', 'A aprovação das férias exige a programação.');
      const d = json<DetalheSolicitacao>(r['dados'], {});
      if (x.motivo) anotacao.motivo = x.motivo;
      await tx.alterar('solicitacao_colaborador', x.id, n(r['versao']), {
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
      const r = await travada(x.id, x.versao);
      const em = await agora();
      anotacao.motivo = x.motivo;
      await tx.alterar('solicitacao_colaborador', x.id, n(r['versao']), {
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
      subidas.set(x.solicitacao, (subidas.get(x.solicitacao) ?? 0) + 1);
    },
    ajustesDaSolicitacao: (id) => ajustesDe(tx, est, id),
    async atestado(x) {
      const r = await tx.uma<Linha>(SQL_ATESTADO, [est, x.solicitacao]);
      if (!r) return null;
      const em = await agora();
      await tx.incluir('atestado_colaborador_acesso', {
        atestado_colaborador_id: n(r['id']),
        usuario_id: await exigirUsuario(tx, x.por),
        acessado_em: em,
        viu_cid: x.verCid,
        finalidade: x.finalidade.slice(0, 200),
      });
      return atestadoDe(r, x.verCid);
    },
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
      gravador: (tx, est, anotacao) => gravador(tx, est, anotacao, efeitos, c),
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
  /** A trilha de leitura do atestado da solicitação, do acesso mais recente ao mais antigo. */
  acessosAtestado(c: ContextoAutoatendimento, solicitacao: number): Promise<AcessoAtestado[]> {
    return this.ler(c, (l, est) => acessosDe(l, est, solicitacao));
  }
}
