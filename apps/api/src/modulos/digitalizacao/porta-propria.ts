// Porta da digitalização certificada sobre o banco do cliente (M50, etapa 6; F2.2, lote 03-02), pelo @sgh/nucleo:
// leituras somente leitura e as gravações numa operação do Executor (trilha, outbox e idempotência na mesma transação),
// nas tabelas do modelo: documento_digitalizado (o índice do documento), arquivo (a chave do objeto no armazenamento,
// o SHA-256, o tamanho e a guarda legal), lote_digitalizacao (o lote numerado do estabelecimento, com o operador e as
// quantidades), tipo_documento_arquivo (o tipo documental, pelo código), assinatura_icp e validacao_assinatura (a
// assinatura ICP-Brasil de quem conferiu, origem "digitalizacao"). O paciente vem de paciente + pessoa_fisica (cadastro
// da rede inteira) e a internação é o atendimento do estabelecimento. Toda leitura filtra o estabelecimento da sessão e
// os registros excluídos; instantes no banco, exibidos no fuso do estabelecimento.
// Melhoria: a segregação (quem confere não é quem capturou; quem assina é quem conferiu) é conferida pelo usuário da
// sessão, por id, na linha travada (não pelo texto do login), e o banco a reforça por CHECK (pedido do lote).
// Melhoria: o lote é um registro próprio, numerado pela sequência de negócio do estabelecimento, com o operador e as
// quantidades de documentos e páginas; a ordem no lote é única no banco (pedido do lote).
// Melhoria: o arquivo é um metadado próprio (arquivo), imutável e com a guarda legal (retencao_ate), ligado ao documento.
// Melhoria: a conferência usa a trava otimista do núcleo (versão relida na transação: 409 conflito-versao).
// Melhoria: a assinatura do documento aponta a assinatura ICP-Brasil (assinatura_icp) e a validação no servidor, na
// mesma transação do documento "assinado"; a falha deixa só a evidência.
// Melhoria: a chave do arquivo no banco leva o estabelecimento (estabelecimento-<id>/...), como o armazenamento, que
// guarda o objeto sob o estabelecimento: o mesmo PDF capturado em dois estabelecimentos do cliente não colide na chave
// única do arquivo; a recusa do arquivo repetido é só a do mesmo estabelecimento (SQL_HASH_EXISTE).
// Melhoria: a captura e a conferência da tela são repetíveis: a Idempotency-Key do pedido (com a ação) é a chave da
// operação no Executor e os dados efetivos entram no hash; a repetição devolve o resultado gravado (sem 409). A
// assinatura, que volta do serviço de assinatura (sem pedido da tela), grava com uma chave própria por documento.
// Dependência de modelo (pedido do lote 03-02, saida/03-02.json): as colunas do índice e do ciclo no
// documento_digitalizado (lote, ordem, descrição, resolução, cor, motivo da recusa, assinatura e a situação "assinado").
// O módulo só entra no registro depois do DDL aplicado; o int spec aplica o pedido no cliente de teste e o desfaz.
import { randomUUID } from 'node:crypto';
import {
  CORES_DIGITALIZACAO,
  type CorDigitalizacao,
  TETO_FILA_DIGITALIZACAO,
  TIPOS_DOCUMENTO_DIGITALIZADO,
  type TipoDocumentoDigitalizado,
} from '@sgh/contratos';
import {
  type ContextoNucleo,
  definirOperacao,
  erroIdempotenciaDivergente,
  type Executor,
  garantirSequencia,
  hashEntrada,
  type Leitor,
  lerIdempotencia,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  restricaoViolada,
  travarEConferir,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { AssinaturaParaGravar, ValidacaoParaGravar } from '../assinatura/tipos.js';
import { type ContextoPortaM18, portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import { civil, FUSO_PADRAO, relogioNoFuso } from '../exames/relogio.js';
import {
  chaveDoPedido,
  type ContextoDigitalizacao,
  type ContextoGravacaoDigitalizacao,
  type GravadorDigitalizacao,
  METODOS_PORTA_DIGITALIZACAO,
  operacaoDoPedido,
  type PortaDigitalizacao,
} from './porta.js';
import type {
  CapturaDigitalizacao,
  DocumentoDigitalizado,
  PacienteDoProntuario,
  SituacaoDigitalizacao,
} from './tipos.js';

/** O que a porta usa do NucleoProprio (os testes trocam). */
export type NucleoDigitalizacao = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;

/** Tabelas que as gravações da digitalização escrevem (a transação recusa as outras). */
export const TABELAS_DIGITALIZACAO = [
  'documento_digitalizado',
  'arquivo',
  'lote_digitalizacao',
  'sequencia_negocio',
  'assinatura_icp',
  'validacao_assinatura',
] as const;

/** Situação no banco → situação do produto (a substituída sai da fila e das leituras). */
const DO_BANCO: Readonly<Record<string, SituacaoDigitalizacao>> = {
  pendente_conferencia: 'capturado',
  conferido: 'conferido',
  rejeitado: 'recusado',
  assinado: 'assinado',
};
const PARA_O_BANCO: Readonly<Record<SituacaoDigitalizacao, string>> = {
  capturado: 'pendente_conferencia',
  conferido: 'conferido',
  recusado: 'rejeitado',
  assinado: 'assinado',
};
/** Lote que ainda recebe documentos. */
const LOTE_ABERTO = ['aberto', 'em_digitalizacao'];
/** Teto da ordem no lote (SMALLINT do índice). */
const TETO_ORDEM_LOTE = 32_000;
const SEQUENCIA_LOTE = 'lote_digitalizacao';
/** A chave do arquivo no banco: a do armazenamento sob o estabelecimento (a chave única vale para o cliente inteiro). */
const chaveNoBanco = (est: number, chave: string) => `estabelecimento-${est}/${chave}`;
const chaveDoArmazem = (v: unknown) => texto(v).replace(/^estabelecimento-\d+\//, '');

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const textoN = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
/** DATE do banco → "AAAA-MM-DD". */
const dataIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : '';
const instante = (v: unknown): Date | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};
/** Instante do banco → "AAAA-MM-DDTHH:mm" no fuso do estabelecimento. */
function local(v: unknown, fuso: string): string | null {
  const d = instante(v);
  if (!d) return null;
  const c = civil(d, fuso);
  return `${c.data}T${c.hora}`;
}
const dataLocal = (v: unknown, fuso: string): string | null => {
  const d = instante(v);
  return d ? civil(d, fuso).data : null;
};
const tipoDoc = (v: unknown): TipoDocumentoDigitalizado =>
  (TIPOS_DOCUMENTO_DIGITALIZADO as readonly string[]).includes(texto(v))
    ? (texto(v) as TipoDocumentoDigitalizado)
    : 'outro';
const corDoc = (v: unknown): CorDigitalizacao =>
  (CORES_DIGITALIZACAO as readonly string[]).includes(texto(v)) ? (texto(v) as CorDigitalizacao) : 'monocromatico';
const marcas = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const NOME_PACIENTE = `CASE WHEN p.usa_nome_social = TRUE AND p.nome_social IS NOT NULL AND p.nome_social <> ''
  THEN p.nome_social ELSE pf.nome END`;

const SELECAO_DOCUMENTO = `SELECT d.id, d.lote_digitalizacao_id, d.ordem_lote, p.numero_prontuario, d.atendimento_id,
       d.paciente_id, t.codigo AS tipo_documento, d.descricao, d.data_documento, d.quantidade_paginas, d.resolucao_dpi,
       d.cor, a.chave_armazenamento, a.hash_sha256, a.tamanho_bytes, a.retencao_ate, d.situacao,
       ud.login AS capturado_por, d.digitalizado_em, uc.login AS conferido_por, d.conferido_em, d.motivo_rejeicao,
       d.assinatura_icp_id, ua.login AS assinado_por, d.assinado_em, ai.carimbo_tempo_em, d.versao
  FROM documento_digitalizado d
  JOIN paciente p ON p.id = d.paciente_id
  JOIN tipo_documento_arquivo t ON t.id = d.tipo_documento_arquivo_id
  JOIN arquivo a ON a.id = d.arquivo_id
  JOIN usuario ud ON ud.id = d.digitalizador_usuario_id
  LEFT JOIN usuario uc ON uc.id = d.conferente_usuario_id
  LEFT JOIN assinatura_icp ai ON ai.id = d.assinatura_icp_id
  LEFT JOIN usuario ua ON ua.id = ai.usuario_id
 WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL AND d.situacao <> 'substituido'`;

function documentoDe(r: Linha, fuso: string): DocumentoDigitalizado {
  return {
    id: n(r['id']),
    lote: n(r['lote_digitalizacao_id']),
    ordem: n(r['ordem_lote']),
    prontuario: n(r['numero_prontuario']),
    internacao: nn(r['atendimento_id']),
    paciente: n(r['paciente_id']),
    tipoDocumento: tipoDoc(r['tipo_documento']),
    descricao: texto(r['descricao']),
    dataDocumento: dataIso(r['data_documento']),
    paginas: n(r['quantidade_paginas']),
    resolucaoDpi: n(r['resolucao_dpi']),
    cor: corDoc(r['cor']),
    arquivoChave: chaveDoArmazem(r['chave_armazenamento']),
    hash: texto(r['hash_sha256']),
    tamanho: n(r['tamanho_bytes']),
    situacao: DO_BANCO[texto(r['situacao'])] ?? 'capturado',
    capturadoPor: texto(r['capturado_por']),
    capturadoEm: local(r['digitalizado_em'], fuso) ?? '',
    conferidoPor: textoN(r['conferido_por']),
    conferidoEm: local(r['conferido_em'], fuso),
    motivo: textoN(r['motivo_rejeicao']),
    assinatura: nn(r['assinatura_icp_id']),
    assinadoPor: textoN(r['assinado_por']),
    assinadoEm: local(r['assinado_em'], fuso),
    carimboEm: local(r['carimbo_tempo_em'], fuso),
    guardaAte: dataIso(r['retencao_ate']),
    versao: n(r['versao']),
  };
}

async function fusoDe(l: Leitor, est: number): Promise<string> {
  const r = await l.uma<{ fuso_horario: string | null }>('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
  return r?.fuso_horario || FUSO_PADRAO;
}

function contextoDe(c: ContextoPortaM18): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || 'digitalizacao').slice(0, 64),
  };
}

/** A entrada da operação: os dados efetivos do pedido (com a ação), que entram no hash da idempotência. */
const ENTRADA_GRAVACAO = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));
const entradaDoPedido = (p: NonNullable<ContextoGravacaoDigitalizacao['pedido']>) => ({ ...p.entrada, acao: p.acao });

const semEstabelecimento = () => recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');

/** O mesmo arquivo (SHA-256) já digitalizado no estabelecimento (em qualquer situação). */
const SQL_HASH_EXISTE = `SELECT d.id FROM documento_digitalizado d JOIN arquivo a ON a.id = d.arquivo_id
  WHERE d.estabelecimento_id = ? AND a.hash_sha256 = ? AND d.excluido_em IS NULL LIMIT 1`;

/** Gravador sobre a transação da operação: o estabelecimento e o usuário vêm da sessão, por id. */
function gravadorSobre(tx: TxOperacao, est: number, usuario: number, agora: () => Date): GravadorDigitalizacao {
  const jaDigitalizado = () =>
    recusa('ja-digitalizado', 'Este mesmo arquivo já foi digitalizado neste estabelecimento.');

  async function lote(x: CapturaDigitalizacao): Promise<{ id: number; ordem: number }> {
    if (x.lote === null) {
      await garantirSequencia(
        tx,
        { tipo: SEQUENCIA_LOTE, estabelecimento: est, prefixo: 'LD-' },
        { usuario, agora: agora() },
      );
      const numero = await tx.proximoNumero(SEQUENCIA_LOTE);
      const id = await tx.incluir('lote_digitalizacao', {
        estabelecimento_id: est,
        numero: numero.formatado,
        operador_usuario_id: usuario,
        iniciado_em: agora(),
        situacao: 'em_digitalizacao',
        formato_arquivo: 'pdf',
      });
      return { id, ordem: 1 };
    }
    const [l] = await tx.consultarParaAtualizar(
      'SELECT id, situacao FROM lote_digitalizacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [x.lote, est],
      { teto: 1 },
    );
    if (!l) throw recusa('lote-inexistente', 'O lote informado não existe neste estabelecimento.');
    if (!LOTE_ABERTO.includes(texto(l['situacao'])))
      throw recusa('lote-fechado', 'O lote informado já foi encerrado: abra um lote novo.');
    const m = await tx.uma('SELECT COALESCE(MAX(ordem_lote), 0) AS m FROM documento_digitalizado WHERE lote_digitalizacao_id = ?', [
      x.lote,
    ]);
    const ordem = n(m?.['m']) + 1;
    if (ordem > TETO_ORDEM_LOTE) throw recusa('lote-cheio', 'O lote chegou ao limite de documentos: abra um lote novo.');
    return { id: x.lote, ordem };
  }

  async function gravarAssinatura(
    a: Omit<AssinaturaParaGravar, 'hospital'>,
    v: Omit<ValidacaoParaGravar, 'assinatura'>,
  ): Promise<number> {
    const provedor = a.provedor
      ? await tx.uma('SELECT id FROM provedor_assinatura_nuvem WHERE codigo = ? AND excluido_em IS NULL', [a.provedor])
      : null;
    const id = await tx.incluir('assinatura_icp', {
      estabelecimento_id: est,
      origem_assinatura: 'digitalizacao',
      usuario_id: usuario,
      certificado_usuario_id: a.certificado,
      provedor_assinatura_nuvem_id: provedor ? n(provedor['id']) : null,
      midia: a.midia,
      formato: a.formato,
      politica_icp: a.politicaIcp,
      hash_assinado: a.hash,
      situacao: a.estado,
      tentativas: a.tentativas,
      falha: a.falha?.slice(0, 60) ?? null,
      proxima_tentativa_em: a.proximaEm,
      assinatura_cms: a.assinatura ? Buffer.from(a.assinatura, 'base64') : null,
      carimbo_tempo: a.carimboToken ? Buffer.from(a.carimboToken, 'base64') : null,
      carimbo_tempo_em: a.carimboEm,
      carimbo_tempo_serie: a.carimboSerie?.slice(0, 64) ?? null,
    });
    await tx.incluir('validacao_assinatura', {
      assinatura_icp_id: id,
      momento: v.momento,
      resultado: v.resultado,
      cadeia_ok: v.cadeia,
      vigencia_ok: v.vigencia,
      revogacao_ok: v.revogacao,
      cpf_ok: v.cpf,
      assinatura_ok: v.assinaturaConfere,
      carimbo_ok: v.carimbo,
      motivos: JSON.stringify(v.motivos.map((m) => m.slice(0, 60))),
      usuario_id: usuario,
      validada_em: v.em,
    });
    return id;
  }

  /** Trava o documento do estabelecimento (outro estabelecimento: não existe). */
  async function travar(id: number, versao?: number): Promise<Linha> {
    const d = await travarEConferir(tx, {
      tabela: 'documento_digitalizado',
      id,
      colunas: ['estabelecimento_id', 'situacao', 'digitalizador_usuario_id', 'conferente_usuario_id', 'excluido_em'],
      ...(versao !== undefined ? { versaoEsperada: versao } : {}),
    });
    if (n(d['estabelecimento_id']) !== est || d['excluido_em'] !== null)
      throw recusa('nao-encontrado', 'O documento não existe neste estabelecimento.');
    return d;
  }

  return {
    capturar: async (x) => {
      const tipo = await tx.uma('SELECT id FROM tipo_documento_arquivo WHERE codigo = ? AND ativo = TRUE', [
        x.tipoDocumento,
      ]);
      if (!tipo)
        throw recusa(
          'tipo-documento-sem-cadastro',
          'O tipo documental não está cadastrado: o administrador inclui o tipo nos tipos de documento do arquivo.',
        );
      if (await tx.uma(SQL_HASH_EXISTE, [est, x.hash])) throw jaDigitalizado();
      const l = await lote(x);
      let arquivo: number;
      try {
        arquivo = await tx.incluir('arquivo', {
          estabelecimento_id: est,
          entidade: 'documento_digitalizado',
          finalidade: 'digitalizacao',
          nome_original: `digitalizacao-${x.hash.slice(0, 16)}.pdf`,
          tipo_mime: 'application/pdf',
          tamanho_bytes: x.tamanho,
          hash_sha256: x.hash,
          chave_armazenamento: chaveNoBanco(est, x.arquivoChave),
          retencao_ate: x.guardaAte,
          imutavel: true,
        });
      } catch (e) {
        if (restricaoViolada(e)?.tipo === 'unica') throw jaDigitalizado();
        throw e;
      }
      let id: number;
      try {
        id = await tx.incluir('documento_digitalizado', {
          estabelecimento_id: est,
          paciente_id: x.paciente,
          atendimento_id: x.internacao,
          lote_digitalizacao_id: l.id,
          ordem_lote: l.ordem,
          tipo_documento_arquivo_id: n(tipo['id']),
          arquivo_id: arquivo,
          descricao: x.descricao.slice(0, 120),
          data_documento: x.dataDocumento,
          quantidade_paginas: x.paginas,
          resolucao_dpi: x.resolucaoDpi,
          cor: x.cor,
          digitalizado_em: agora(),
          digitalizador_usuario_id: usuario,
          situacao: PARA_O_BANCO.capturado,
        });
      } catch (e) {
        if (restricaoViolada(e)?.tipo === 'unica')
          throw recusa('lote-em-uso', 'Outra captura entrou no mesmo lote agora: tente de novo.');
        throw e;
      }
      await tx.executar('UPDATE arquivo SET entidade_id = ? WHERE id = ?', [id, arquivo]);
      await tx.executar(
        `UPDATE lote_digitalizacao SET quantidade_documentos = quantidade_documentos + 1,
           quantidade_paginas = quantidade_paginas + ?, alterado_em = ?, alterado_por = ?, versao = versao + 1
         WHERE id = ?`,
        [x.paginas, agora(), usuario, l.id],
      );
      return { id, lote: l.id, ordem: l.ordem };
    },
    conferir: async (x) => {
      const d = await travar(x.id, x.versao);
      if (texto(d['situacao']) !== PARA_O_BANCO.capturado)
        throw recusa('ja-conferido', 'O documento já foi conferido: atualize a fila.');
      if (n(d['digitalizador_usuario_id']) === usuario)
        throw recusa('conferente-capturou', 'Quem capturou o documento não confere a fidelidade: outra pessoa confere.');
      const fiel = x.situacao === 'conferido';
      await tx.alterar('documento_digitalizado', x.id, x.versao, {
        situacao: PARA_O_BANCO[x.situacao],
        conferido: fiel,
        conferido_em: agora(),
        conferente_usuario_id: usuario,
        motivo_rejeicao: fiel ? null : (x.motivo?.slice(0, 200) ?? null),
      });
    },
    assinar: async (x) => {
      const d = await travar(x.id);
      if (texto(d['situacao']) !== PARA_O_BANCO.conferido || nn(d['conferente_usuario_id']) !== usuario)
        throw recusa(
          'versao-desatualizada',
          'O documento já foi assinado, deixou de estar conferido ou foi conferido por outra pessoa.',
        );
      const id = await gravarAssinatura(x.assinatura, x.validacao);
      await tx.alterar('documento_digitalizado', x.id, n(d['versao']), {
        situacao: PARA_O_BANCO.assinado,
        assinatura_icp_id: id,
        assinado_em: agora(),
      });
      return id;
    },
    registrarFalha: (x) => gravarAssinatura(x.assinatura, x.validacao),
  };
}

export class PortaDigitalizacaoPropria implements PortaDigitalizacao {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoDigitalizacao,
    executorPronto?: Executor,
    private readonly agora: () => Date = () => new Date(),
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoDigitalizacao, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) return Promise.reject(semEstabelecimento());
    return this.nucleo.lerSomente(contextoDe(c), async (l) => fn(l, est, await fusoDe(l, est)));
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────

  /** A digitalização não tem operação de tela pelo Executor: as gravações são diretas (gravarSgh). */
  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(): Promise<never> {
    throw recusa('operacao-desconhecida', 'A digitalização grava pelas ações da própria tela.');
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorDigitalizacao) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw semEstabelecimento();
    if (c.usuario === null) throw recusa('sem-usuario', 'A gravação da digitalização exige o usuário da sessão.');
    const usuario = c.usuario;
    const pedido = (c as ContextoGravacaoDigitalizacao).pedido;
    let saida: { valor: T } | null = null;
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const op = definirOperacao({
      nome: pedido ? operacaoDoPedido(pedido) : 'digitalizacao.gravacao-direta',
      tabelas: TABELAS_DIGITALIZACAO,
      entrada: ENTRADA_GRAVACAO,
      gravar: async (tx) => {
        saida = { valor: await fn(gravadorSobre(tx, est, usuario, this.agora)) };
        return { valor: JSON.stringify(saida.valor ?? null) } as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'documento_digitalizado', id: l?.entidadeId ?? null };
      },
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    // O pedido da tela: a Idempotency-Key (com a ação) e os dados efetivos. Sem pedido (a volta da assinatura), cada
    // gravação é uma operação própria (a assinatura em lote grava um documento por vez).
    const chave = pedido ? chaveDoPedido(pedido) : `digitalizacao:${randomUUID()}`;
    const entrada = pedido ? entradaDoPedido(pedido) : { chave };
    const r = await this.executor.executar(op, c.cliente, entrada, { ...contextoDe(c), chaveIdempotencia: chave });
    if (r.repetida) return JSON.parse(String(r.resultado['valor'] ?? 'null')) as T;
    if (!saida) throw new Error('Gravação da digitalização sem resultado.');
    return (saida as { valor: T }).valor;
  }

  async repeticao<T>(c: ContextoGravacaoDigitalizacao): Promise<{ readonly valor: T } | null> {
    const pedido = c.pedido;
    if (!pedido) return null;
    const nome = operacaoDoPedido(pedido);
    const anterior = await this.nucleo.lerSomente(contextoDe(c), (l) => lerIdempotencia(l, nome, chaveDoPedido(pedido)));
    if (!anterior) return null;
    // A mesma chave com outros dados, ou de outra pessoa, não devolve o resultado de quem gravou.
    if (anterior.hashEntrada !== hashEntrada(nome, entradaDoPedido(pedido)) || anterior.usuario !== c.usuario)
      throw erroIdempotenciaDivergente();
    return { valor: JSON.parse(String(anterior.resultado['valor'] ?? 'null')) as T };
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoDigitalizacao): Promise<{ agora: string; hoje: string }> {
    return this.ler(c, async (_l, _e, fuso) => {
      const r = relogioNoFuso(fuso, this.agora());
      return { agora: `${r.hoje}T${r.hora}`, hoje: r.hoje };
    });
  }

  fila(c: ContextoDigitalizacao, situacao: SituacaoDigitalizacao | null) {
    return this.ler(c, async (l, est, fuso) => {
      const filtro = situacao ? ' AND d.situacao = ?' : '';
      const linhas = await l.consultar(
        `${SELECAO_DOCUMENTO}${filtro} ORDER BY d.digitalizado_em DESC, d.id DESC LIMIT ${TETO_FILA_DIGITALIZACAO + 1}`,
        situacao ? [est, PARA_O_BANCO[situacao]] : [est],
        { teto: TETO_FILA_DIGITALIZACAO + 1 },
      );
      const contagens: Record<SituacaoDigitalizacao, number> = { capturado: 0, conferido: 0, recusado: 0, assinado: 0 };
      const grupos = await l.consultar(
        `SELECT situacao, COUNT(*) AS total FROM documento_digitalizado
          WHERE estabelecimento_id = ? AND excluido_em IS NULL GROUP BY situacao`,
        [est],
        { teto: 20 },
      );
      for (const g of grupos) {
        const s = DO_BANCO[texto(g['situacao'])];
        if (s) contagens[s] += n(g['total']);
      }
      return {
        itens: linhas.slice(0, TETO_FILA_DIGITALIZACAO).map((r) => documentoDe(r, fuso)),
        cortada: linhas.length > TETO_FILA_DIGITALIZACAO,
        contagens,
      };
    });
  }

  documento(c: ContextoDigitalizacao, id: number) {
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.uma(`${SELECAO_DOCUMENTO} AND d.id = ?`, [est, id]);
      return r ? documentoDe(r, fuso) : null;
    });
  }

  porIds(c: ContextoDigitalizacao, ids: readonly number[]) {
    const lista = [...new Set(ids)].filter((x) => Number.isSafeInteger(x) && x > 0).slice(0, TETO_FILA_DIGITALIZACAO);
    if (lista.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(`${SELECAO_DOCUMENTO} AND d.id IN (${marcas(lista.length)}) ORDER BY d.id`, [est, ...lista], {
          teto: lista.length,
        })
      ).map((r) => documentoDe(r, fuso)),
    );
  }

  doProntuario(c: ContextoDigitalizacao, pront: number) {
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `${SELECAO_DOCUMENTO} AND p.numero_prontuario = ? ORDER BY d.data_documento DESC, d.id DESC
           LIMIT ${TETO_FILA_DIGITALIZACAO}`,
          [est, pront],
          { teto: TETO_FILA_DIGITALIZACAO },
        )
      ).map((r) => documentoDe(r, fuso)),
    );
  }

  loteExiste(c: ContextoDigitalizacao, lote: number) {
    return this.ler(c, async (l, est) =>
      Boolean(
        await l.uma(
          `SELECT id FROM lote_digitalizacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
             AND situacao IN (${marcas(LOTE_ABERTO.length)})`,
          [lote, est, ...LOTE_ABERTO],
        ),
      ),
    );
  }

  hashExiste(c: ContextoDigitalizacao, hash: string) {
    return this.ler(c, async (l, est) => Boolean(await l.uma(SQL_HASH_EXISTE, [est, hash])));
  }

  paciente(c: ContextoDigitalizacao, pront: number): Promise<PacienteDoProntuario | null> {
    return this.ler(c, async (l, est, fuso) => {
      // O paciente é cadastro da rede inteira (sem estabelecimento); os atendimentos são só os do estabelecimento.
      const p = await l.uma(
        `SELECT p.id, p.numero_prontuario, ${NOME_PACIENTE} AS nome
           FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE p.numero_prontuario = ? AND p.excluido_em IS NULL`,
        [pront],
      );
      if (!p) return null;
      const atendimentos = await l.consultar(
        `SELECT id, entrada_em, saida_em FROM atendimento
          WHERE paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado'
          ORDER BY entrada_em DESC, id DESC LIMIT 50`,
        [n(p['id']), est],
        { teto: 50 },
      );
      return {
        prontuario: n(p['numero_prontuario']),
        paciente: n(p['id']),
        nome: texto(p['nome']),
        internacoes: atendimentos.map((a) => ({
          reg: n(a['id']),
          entrada: dataLocal(a['entrada_em'], fuso) ?? '',
          saida: dataLocal(a['saida_em'], fuso),
        })),
      };
    });
  }

  prontuarioDaInternacao(c: ContextoDigitalizacao, reg: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT p.numero_prontuario FROM atendimento a JOIN paciente p ON p.id = a.paciente_id
          WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
        [reg, est],
      );
      return r ? n(r['numero_prontuario']) : null;
    });
  }

  nomes(c: ContextoDigitalizacao, ids: readonly number[]) {
    const lista = [...new Set(ids)].filter((x) => Number.isSafeInteger(x) && x > 0).slice(0, 500);
    if (lista.length === 0) return Promise.resolve(new Map<number, string>());
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT p.id, ${NOME_PACIENTE} AS nome FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE p.id IN (${marcas(lista.length)})`,
        lista,
        { teto: lista.length },
      );
      return new Map(linhas.map((r) => [n(r['id']), texto(r['nome'])] as const));
    });
  }
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaDigitalizacaoIndisponivel(): PortaDigitalizacao {
  return portaIndisponivel<PortaDigitalizacao>(METODOS_PORTA_DIGITALIZACAO);
}
