// Registro das emissões no banco do cliente (M09/M23), pelo @sgh/nucleo: a mesma interface do registro em memória
// (registro.ts), sobre a tabela emissao_documento. A reserva e a confirmação são operações do Executor (trilha, outbox
// e idempotência na mesma transação); as leituras são somente leitura. A validação pública pelo QR lê daqui.
// Melhoria: a unicidade (código, chave do objeto, QR e (original, via)) e a regra "confirmada só com a versão do
// objeto" ficam no banco (UNIQUE e CHECK), não só na aplicação; a confirmação usa a trava otimista (versao) e só passa
// de 'reservada' para 'emitida' uma vez; a reemissão aponta o original pela chave do banco (FK), não por texto.
// Melhoria: o registro é montado por requisição (registroEmissoesDaRequisicao): cliente, estabelecimento, usuário e
// correlação vêm da sessão, nunca de um cliente fixo no processo; a emissão grava o estabelecimento da sessão (id do
// cadastro) e o usuário que emitiu (autor_usuario_id e trilha); as leituras internas (porId, doOriginal, daOrigem)
// filtram o estabelecimento da sessão. Só a validação pública pelo QR (porQr) lê sem esse filtro: quem valida é o
// portador do documento, sem sessão, e o identificador do QR é único no cliente inteiro (UNIQUE).
// Pendência de modelo (pedido do lote 02-06): a tabela emissao_documento (DDL proposto em docs/obra/fatias/f22/saida).
import { randomUUID } from 'node:crypto';
import { type EmissaoDocumento, ErroEmissao, ErroViaOcupada } from '@sgh/dominio-documento';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  restricaoUnicaViolada,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { RegistroEmissoes } from './registro.js';

/** O mínimo do núcleo que o registro usa. */
export type NucleoRegistroEmissoes = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;

const TABELA = 'emissao_documento';
const UQ_VIA = 'uq_emissao_documento_original_via';

const esquemaReserva = z
  .object({
    id: z.string().uuid(),
    rede: z.string().min(1).max(63),
    estabelecimento: z.string().min(1).max(20),
    modelo: z.string().min(1).max(40),
    versaoModelo: z.string().min(1).max(20),
    origem: z.object({ tipo: z.string().min(1).max(40), id: z.number().int().positive() }),
    via: z.number().int().min(1).max(999),
    idOriginal: z.string().uuid().nullable(),
    motivoReemissao: z.string().max(200).nullable(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    chaveObjeto: z.string().min(1).max(300),
    identificadorQr: z.string().min(1).max(64),
    autor: z.string().min(1).max(60),
    emitidoEm: z.string().datetime({ offset: true }),
  })
  .strict();
type Reserva = z.infer<typeof esquemaReserva>;

const esquemaConfirmacao = z
  .object({ id: z.string().uuid(), versaoObjeto: z.string().trim().min(1).max(100) })
  .strict();
type Confirmacao = z.infer<typeof esquemaConfirmacao>;

const SELECT_EMISSAO = `
  SELECT e.id, e.codigo, e.rede, e.estabelecimento_codigo, e.modelo, e.versao_modelo, e.origem_tipo,
         e.origem_registro_id, e.via, o.codigo AS codigo_original, e.motivo_reemissao, e.hash_conteudo,
         e.chave_objeto, e.identificador_qr, e.autor, e.emitido_em, e.versao_objeto, e.situacao, e.versao
    FROM emissao_documento e
    LEFT JOIN emissao_documento o ON o.id = e.original_emissao_documento_id
   WHERE e.excluido_em IS NULL`;

const reservar = definirOperacao({
  nome: 'documento.reservar-emissao',
  tabelas: [TABELA],
  entrada: esquemaReserva,
  acao: 'inclusao',
  async gravar(tx, e: Reserva) {
    const est = tx.contexto.estabelecimento;
    if (est === null)
      throw new ErroOperacao(
        422,
        'sem-estabelecimento',
        'Estabelecimento da sessão',
        'A emissão exige o estabelecimento da sessão.',
      );
    let original: number | null = null;
    if (e.idOriginal !== null) {
      const o = await tx.uma<{ id: unknown }>(
        'SELECT id FROM emissao_documento WHERE codigo = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.idOriginal, est],
      );
      if (!o)
        throw new ErroOperacao(
          409,
          'original-inexistente',
          'Original não encontrado',
          'A emissão original da reemissão não existe.',
        );
      original = Number(o.id);
    }
    try {
      const id = await tx.incluir(TABELA, {
        estabelecimento_id: est,
        codigo: e.id,
        rede: e.rede,
        estabelecimento_codigo: e.estabelecimento,
        modelo: e.modelo,
        versao_modelo: e.versaoModelo,
        origem_tipo: e.origem.tipo,
        origem_registro_id: e.origem.id,
        via: e.via,
        original_emissao_documento_id: original,
        motivo_reemissao: e.motivoReemissao,
        hash_conteudo: e.sha256,
        chave_objeto: e.chaveObjeto,
        identificador_qr: e.identificadorQr,
        autor: e.autor,
        autor_usuario_id: tx.contexto.usuario,
        emitido_em: new Date(e.emitidoEm),
        situacao: 'reservada',
      });
      return { id };
    } catch (erro) {
      const uq = restricaoUnicaViolada(erro);
      if (uq === UQ_VIA)
        throw new ErroOperacao(
          409,
          'via-ocupada',
          'Via já reservada',
          `A via ${e.via} já foi reservada para o original.`,
        );
      if (uq)
        throw new ErroOperacao(
          409,
          'emissao-repetida',
          'Emissão repetida',
          'Emissão repetida: o registro é só de inclusão.',
        );
      throw erro;
    }
  },
  alvo: (_e, r) => ({ tabela: TABELA, id: Number(r['id']) }),
});

const confirmar = definirOperacao({
  nome: 'documento.confirmar-emissao',
  tabelas: [TABELA],
  entrada: esquemaConfirmacao,
  acao: 'alteracao',
  async gravar(tx, e: Confirmacao) {
    const [l] = await tx.consultarParaAtualizar<{ id: unknown; situacao: unknown; versao: unknown }>(
      'SELECT id, situacao, versao FROM emissao_documento WHERE codigo = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.id, tx.contexto.estabelecimento],
    );
    if (!l)
      throw new ErroOperacao(
        404,
        'reserva-inexistente',
        'Reserva não encontrada',
        'Reserva da emissão não encontrada.',
      );
    if (l.situacao !== 'reservada')
      throw new ErroOperacao(409, 'ja-confirmada', 'Emissão já confirmada', 'Emissão já confirmada.');
    const versao = await tx.alterar(TABELA, Number(l.id), Number(l.versao), {
      situacao: 'emitida',
      versao_objeto: e.versaoObjeto,
      confirmado_em: new Date(),
    });
    return { id: Number(l.id), versao };
  },
  alvo: (_e, r) => ({ tabela: TABELA, id: Number(r['id']) }),
});

const dataIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

function emissaoDe(l: Linha): EmissaoDocumento {
  return {
    id: String(l['codigo']),
    rede: String(l['rede']),
    estabelecimento: String(l['estabelecimento_codigo']),
    modelo: String(l['modelo']),
    versaoModelo: String(l['versao_modelo']),
    origem: { tipo: String(l['origem_tipo']), idLegado: Number(l['origem_registro_id']) },
    via: Number(l['via']),
    idOriginal:
      l['codigo_original'] === null || l['codigo_original'] === undefined
        ? null
        : String(l['codigo_original']),
    motivoReemissao: l['motivo_reemissao'] === null ? null : String(l['motivo_reemissao']),
    sha256: String(l['hash_conteudo']),
    chaveObjeto: String(l['chave_objeto']),
    identificadorQr: String(l['identificador_qr']),
    autor: String(l['autor']),
    emitidoEm: dataIso(l['emitido_em']),
    versaoS3:
      l['versao_objeto'] === null || l['versao_objeto'] === undefined ? null : String(l['versao_objeto']),
  };
}

/** Traduz a recusa do executor para os erros do domínio da emissão (a reemissão tenta a próxima via). */
function traduzir(e: unknown): never {
  if (e instanceof ErroOperacao) {
    const codigo = String(e.problema['codigo'] ?? '');
    if (codigo === 'via-ocupada') throw new ErroViaOcupada(String(e.problema.detail ?? e.message));
    throw new ErroEmissao(String(e.problema.detail ?? e.message));
  }
  throw e;
}

export interface OpcoesRegistroEmissoesPropria {
  /** O executor compartilhado (montado uma vez pela fábrica). */
  readonly executor?: Executor;
}

/**
 * Registro das emissões de UMA requisição: o contexto (cliente, estabelecimento, usuário e correlação) é o da sessão.
 * A fonte do documento monta um por requisição com registroEmissoesDaRequisicao.
 */
export class RegistroEmissoesPropria implements RegistroEmissoes {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoRegistroEmissoes,
    private readonly ctx: ContextoNucleo,
    opcoes: OpcoesRegistroEmissoesPropria = {},
  ) {
    this.executor = opcoes.executor ?? nucleo.criarExecutor();
  }

  private contexto(): ContextoOperacao {
    return {
      ...this.ctx,
      correlacao: this.ctx.correlacao.slice(0, 64),
      chaveIdempotencia: `emissao:${randomUUID()}`,
    };
  }

  private ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ ...this.ctx, correlacao: this.ctx.correlacao.slice(0, 64) }, fn);
  }

  /** As leituras internas são do estabelecimento da sessão; sem ele, nada é lido. */
  private lerDoEstabelecimento<T>(vazio: T, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = this.ctx.estabelecimento;
    if (est === null) return Promise.resolve(vazio);
    return this.ler((l) => fn(l, est));
  }

  async reservar(e: EmissaoDocumento): Promise<number> {
    if (e.versaoS3 !== null) throw new ErroEmissao('A reserva entra sem versão do S3.');
    if (this.ctx.estabelecimento === null)
      throw new ErroEmissao('A emissão exige o estabelecimento da sessão.');
    const entrada: Reserva = {
      id: e.id,
      rede: e.rede,
      estabelecimento: e.estabelecimento,
      modelo: e.modelo,
      versaoModelo: e.versaoModelo,
      origem: { tipo: e.origem.tipo, id: e.origem.idLegado },
      via: e.via,
      idOriginal: e.idOriginal,
      motivoReemissao: e.motivoReemissao,
      sha256: e.sha256,
      chaveObjeto: e.chaveObjeto,
      identificadorQr: e.identificadorQr,
      autor: e.autor,
      emitidoEm: e.emitidoEm,
    };
    const r = await this.executor
      .executar(reservar, this.ctx.cliente, entrada, this.contexto())
      .catch(traduzir);
    return Number(r.resultado['id']);
  }

  async confirmar(id: string, versaoS3: string): Promise<EmissaoDocumento> {
    if (!versaoS3.trim() || versaoS3.length > 100) throw new ErroEmissao('Versão do S3 inválida.');
    if (this.ctx.estabelecimento === null)
      throw new ErroEmissao('A emissão exige o estabelecimento da sessão.');
    await this.executor
      .executar(confirmar, this.ctx.cliente, { id, versaoObjeto: versaoS3 }, this.contexto())
      .catch(traduzir);
    const lida = await this.lerDoEstabelecimento(null as Linha | null, (l, est) =>
      l.uma(`${SELECT_EMISSAO} AND e.codigo = ? AND e.estabelecimento_id = ?`, [id, est]),
    );
    if (!lida) throw new ErroEmissao('Reserva da emissão não encontrada.');
    return emissaoDe(lida);
  }

  porId(id: string): Promise<EmissaoDocumento | null> {
    return this.lerDoEstabelecimento(null as EmissaoDocumento | null, async (l, est) => {
      const r = await l.uma(
        `${SELECT_EMISSAO} AND e.codigo = ? AND e.estabelecimento_id = ? AND e.situacao = 'emitida'`,
        [id, est],
      );
      return r ? emissaoDe(r) : null;
    });
  }

  /**
   * Validação pública pelo QR: sem filtro de estabelecimento de propósito (quem valida não tem sessão; o
   * identificador do QR é único no cliente inteiro e só a emissão confirmada aparece).
   */
  porQr(identificador: string): Promise<EmissaoDocumento | null> {
    return this.ler(async (l) => {
      const r = await l.uma(`${SELECT_EMISSAO} AND e.identificador_qr = ? AND e.situacao = 'emitida'`, [
        identificador,
      ]);
      return r ? emissaoDe(r) : null;
    });
  }

  doOriginal(idOriginal: string): Promise<EmissaoDocumento[]> {
    return this.lerDoEstabelecimento([] as EmissaoDocumento[], async (l, est) =>
      (
        await l.consultar(
          `${SELECT_EMISSAO} AND e.estabelecimento_id = ? AND (e.codigo = ? OR o.codigo = ?) ORDER BY e.via, e.id LIMIT 1000`,
          [est, idOriginal, idOriginal],
        )
      ).map(emissaoDe),
    );
  }

  daOrigem(tipo: string, id: number): Promise<EmissaoDocumento[]> {
    return this.lerDoEstabelecimento([] as EmissaoDocumento[], async (l, est) =>
      (
        await l.consultar(
          `${SELECT_EMISSAO} AND e.estabelecimento_id = ? AND e.origem_tipo = ? AND e.origem_registro_id = ?
             AND e.situacao = 'emitida'
            ORDER BY e.via, e.id LIMIT 1000`,
          [est, tipo, id],
        )
      ).map(emissaoDe),
    );
  }
}

/**
 * Fábrica do registro por requisição (para a fonte do documento): um executor para o processo, o contexto de cada
 * requisição (cliente, estabelecimento, usuário e correlação da sessão) em cada registro.
 */
export function registroEmissoesDaRequisicao(
  nucleo: NucleoRegistroEmissoes,
  executor: Executor = nucleo.criarExecutor(),
): (ctx: ContextoNucleo) => RegistroEmissoes {
  return (ctx) => new RegistroEmissoesPropria(nucleo, ctx, { executor });
}

/** DDL proposto da tabela (pedido do lote 02-06; convenções do ADR 0002). Referência do pedido: o teste não o aplica. */
export const DDL_EMISSAO_DOCUMENTO = `CREATE TABLE emissao_documento (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  codigo CHAR(36) NOT NULL COMMENT 'Identificador público da emissão (UUID)',
  rede VARCHAR(63) NOT NULL COMMENT 'Segmento da rede na chave do objeto',
  estabelecimento_codigo VARCHAR(20) NOT NULL COMMENT 'Segmento do estabelecimento na chave do objeto',
  modelo VARCHAR(40) NOT NULL,
  versao_modelo VARCHAR(20) NOT NULL,
  origem_tipo VARCHAR(40) NOT NULL COMMENT 'Tipo do registro de origem do documento',
  origem_registro_id BIGINT UNSIGNED NOT NULL,
  via SMALLINT UNSIGNED NOT NULL,
  original_emissao_documento_id BIGINT UNSIGNED NULL COMMENT 'Emissão original (via 1) da reemissão',
  motivo_reemissao VARCHAR(200) NULL,
  hash_conteudo CHAR(64) NOT NULL COMMENT 'SHA-256 do PDF gravado',
  chave_objeto VARCHAR(300) NOT NULL COMMENT 'Chave do objeto no armazenamento imutável',
  identificador_qr VARCHAR(64) NOT NULL,
  autor VARCHAR(60) NOT NULL COMMENT 'Login de quem emitiu, no momento da emissão',
  autor_usuario_id BIGINT UNSIGNED NULL,
  emitido_em DATETIME(3) NOT NULL,
  versao_objeto VARCHAR(100) NULL COMMENT 'Versão do objeto gravado (a leitura é sempre por ela)',
  situacao VARCHAR(20) NOT NULL DEFAULT 'reservada',
  confirmado_em DATETIME(3) NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_emissao_documento_situacao CHECK (situacao IN ('reservada','emitida')),
  CONSTRAINT ck_emissao_documento_confirmacao CHECK ((situacao = 'reservada' AND versao_objeto IS NULL AND confirmado_em IS NULL) OR (situacao = 'emitida' AND versao_objeto IS NOT NULL AND confirmado_em IS NOT NULL)),
  CONSTRAINT ck_emissao_documento_via CHECK (via >= 1 AND ((via = 1) = (original_emissao_documento_id IS NULL))),
  CONSTRAINT ck_emissao_documento_reemissao CHECK (via = 1 OR motivo_reemissao IS NOT NULL),
  CONSTRAINT ck_emissao_documento_hash CHECK (hash_conteudo REGEXP '^[0-9a-f]{64}$'),
  UNIQUE KEY uq_emissao_documento_codigo (codigo),
  UNIQUE KEY uq_emissao_documento_chave_objeto (chave_objeto),
  UNIQUE KEY uq_emissao_documento_identificador_qr (identificador_qr),
  UNIQUE KEY uq_emissao_documento_original_via (original_emissao_documento_id, via),
  KEY ix_emissao_documento_origem (origem_tipo, origem_registro_id),
  KEY ix_emissao_documento_estabelecimento (estabelecimento_id, emitido_em),
  KEY ix_emissao_documento_autor_usuario_id (autor_usuario_id)
) COMMENT='Emissão de documento em PDF imutável: via, chave do objeto, QR de validação e hash';
ALTER TABLE emissao_documento
  ADD CONSTRAINT fk_emissao_documento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emissao_documento_original_emissao_documento_id FOREIGN KEY (original_emissao_documento_id) REFERENCES emissao_documento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_emissao_documento_autor_usuario_id FOREIGN KEY (autor_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;`;
