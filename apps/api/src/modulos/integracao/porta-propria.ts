// Porta das integrações sobre o banco do cliente (MariaDB pelo @sgh/nucleo). Leituras: somente leitura (lerSomente),
// filtradas pelo estabelecimento da sessão (ou do código da rota, na entrada do parceiro). Gravações: sempre pelo
// Executor (definirOperacao), com a trilha, a idempotência e a mensagem de saída na MESMA transação (regra 7).
// Tabelas: parceiro_dados, cliente_api, chave_api, sistema_externo, ponto_integracao, mensagem_integracao_entrada,
// mensagem_integracao_saida, falha_integracao, arquivo, integracao_mensagem; no resultado do laboratório de apoio,
// exame_item, resultado_exame, resultado_analito e aviso_valor_critico (com a mensagem recebida concluída junto).
// Melhoria: o segredo do parceiro vira uma chave da API (chave_api) guardada por resumo, com validade, sequência e
// revogação: a troca revoga a anterior e guarda o histórico (antes o resumo era sobrescrito).
// Melhoria: a entrada idempotente pela restrição única (ponto, chave) do banco, e o conteúdo grande no armazém de
// objetos referenciado por `arquivo` (hash, tamanho e chave), nunca na tabela de mensagens.
// Melhoria: a fila de mortos ganha a falha tratável (falha_integracao: quando, quem tratou, como e reprocessamentos).
// Melhoria: o resultado do laboratório de apoio é gravado no exame pedido com a conferência do responsável técnico
// (resultado_exame + resultado_analito), com trava otimista pela versão do exame pedido.
// Melhoria: o resultado do apoio segue as regras do SADT (@sgh/dominio-sadt): o analito tem de ser do exame, a faixa
// do paciente fica congelada no valor, o anormal e o crítico são marcados, o crítico abre o aviso com prazo, o
// responsável técnico libera e o fato "resultado liberado" sai na mesma transação; origem "integracao".
// Melhoria: o setor executante do resultado vem do exame pedido ou do setor executante padrão do exame no
// estabelecimento; sem setor, recusa clara (nunca o id 0).
// Melhoria: a credencial do parceiro nasce restrita ao estabelecimento da sessão que a emite (cliente_api), e a
// entrega só copia o conteúdo do outbox do próprio estabelecimento.
// Melhoria: o parceiro é do cliente inteiro (cadastro único) e o ponto de entrada/saída é por estabelecimento, criado
// na primeira mensagem com o padrão de troca do tipo do parceiro (sem padrão cadastrado, recusa clara).
import { randomUUID } from 'node:crypto';
import { aplicarTratamento } from '@sgh/dominio-integracao';
import { idadeEmDias, interpretarValorApoio } from './aplicacao/interpretacao-apoio.js';
import { marcarRetornoNaRemessa, TABELAS_RETORNO_REMESSA } from '../sadt/public-api.js';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  gravarOutbox,
  type Leitor,
  type Linha,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { portaIndisponivel } from '../exames/public-api.js';
import type { ContextoGravacao } from '../cadastro/tipos.js';
import {
  type ContagemPorSituacao,
  type ContextoIntegracao,
  type DadosParceiro,
  type EnvioIntegracao,
  type GravadorIntegracao,
  type LaboratorioApoio,
  METODOS_PORTA_INTEGRACAO,
  type NovaRecebida,
  type NovoEnvio,
  type ParceiroIntegracao,
  type PortaIntegracao,
  type RecebidaIntegracao,
  type ResultadoApoio,
  type SaudeFilas,
  type SituacaoEnvio,
  type SituacaoRecebida,
  type TratamentoEnvio,
  type TrilhaIntegracao,
  type VinculoResponsavel,
} from './porta.js';

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoIntegracao {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

/** Tabelas que a gravação da integração pode escrever (o Executor recusa as outras). */
export const TABELAS_INTEGRACAO = [
  'parceiro_dados',
  'cliente_api',
  'chave_api',
  'sistema_externo',
  'ponto_integracao',
  'mensagem_integracao_entrada',
  'mensagem_integracao_saida',
  'falha_integracao',
  'arquivo',
  'integracao_mensagem',
] as const;

const TABELAS_RESULTADO_APOIO = [
  'exame_item',
  'resultado_exame',
  'resultado_analito',
  'aviso_valor_critico',
  'mensagem_integracao_entrada',
  // O item da remessa que levou a amostra fica com o resultado recebido, e a remessa, recebida ou concluída.
  ...TABELAS_RETORNO_REMESSA,
] as const;

// ---- conversões (banco → negócio) ----

const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const inteiro = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const booleano = (v: unknown): boolean => v === true || Number(v) === 1;
export function data(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v;
  const t = String(v);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t.replace(' ', 'T')}Z`);
}
const iso = (v: unknown): string | null => data(v)?.toISOString().slice(0, 19) ?? null;
function lista(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== 'string' || v === '') return [];
  try {
    const x: unknown = JSON.parse(v);
    return Array.isArray(x) ? x.map(String) : [];
  } catch {
    return [];
  }
}

/** Situação da mensagem de saída → vocabulário da fila (o monitor e a tela). */
export function situacaoDoEnvio(s: string): SituacaoEnvio {
  if (s === 'enviada' || s === 'confirmada') return 'enviado';
  if (s === 'erro' || s === 'rejeitada' || s === 'expirada') return 'morto';
  if (s === 'cancelada') return 'descartado';
  return 'pendente';
}
const SITUACOES_SAIDA: Readonly<Record<SituacaoEnvio, readonly string[]>> = {
  pendente: ['pendente', 'enviando'],
  enviado: ['enviada', 'confirmada'],
  morto: ['erro', 'rejeitada', 'expirada'],
  descartado: ['cancelada'],
};

/** Situação da mensagem de entrada → vocabulário da tela (a conferência do responsável técnico é "validada"). */
export function situacaoDaRecebida(s: string): SituacaoRecebida {
  if (s === 'validada') return 'conferir';
  if (s === 'processada') return 'processada';
  if (s === 'rejeitada' || s === 'erro' || s === 'descartada') return 'recusada';
  return 'recebida';
}
const SITUACAO_ENTRADA: Readonly<Record<SituacaoRecebida, string>> = {
  recebida: 'recebida',
  conferir: 'validada',
  processada: 'processada',
  recusada: 'rejeitada',
};
const SITUACOES_ENTRADA: Readonly<Record<SituacaoRecebida, readonly string[]>> = {
  recebida: ['recebida', 'processando', 'duplicada'],
  conferir: ['validada'],
  processada: ['processada'],
  recusada: ['rejeitada', 'erro', 'descartada'],
};

const TRATAMENTO_FALHA: Readonly<Record<TratamentoEnvio, string>> = {
  reprocessar: 'reprocessada',
  corrigir: 'resolvida',
  descartar: 'descartada',
};
function tratamentoDaFalha(s: unknown): TratamentoEnvio | null {
  if (s === 'reprocessada') return 'reprocessar';
  if (s === 'resolvida') return 'corrigir';
  if (s === 'descartada') return 'descartar';
  return null;
}

/** O formato da mensagem recebida pelo tipo (HL7 v2, recurso FHIR ou texto). */
export function formatoDoTipo(tipo: string): 'hl7v2' | 'fhir_json' | 'texto' {
  if (/^(ORU|ORM|OML|ADT|SIU|MDM|ACK)/.test(tipo)) return 'hl7v2';
  if (/^[A-Z][A-Za-z]+$/.test(tipo)) return 'fhir_json';
  return 'texto';
}

const FAMILIA_DO_TIPO: Readonly<Record<string, string>> = {
  hl7: 'hl7v2',
  apoio: 'hl7v2',
  fhir: 'fhir',
  api: 'api',
  arquivo: 'arquivo',
};
const CATEGORIA_DO_TIPO: Readonly<Record<string, string>> = {
  apoio: 'laboratorio',
  governo: 'governo',
  hl7: 'outro',
  fhir: 'outro',
};

/** Tabela do objeto que a mensagem gerou: só as do modelo (nunca nome de outro sistema). */
const ENTIDADES_OBJETO = new Set(['exame_item', 'resultado_exame', 'atendimento', 'paciente']);
const entidadeDe = (t: string | null): string | null => (t && ENTIDADES_OBJETO.has(t) ? t : null);
const idDe = (v: string | null): number | null => (v && /^\d{1,15}$/.test(v) ? Number(v) : null);

const esquemaEntrada = z.record(z.string(), z.unknown());

const SQL_PARCEIRO = `
  SELECT p.id, p.codigo, p.nome, p.tipo, p.canal, p.escopos, p.eventos, p.limite_tentativas, p.finalidade,
         p.base_legal, p.ativo, p.alterado_em, ca.identificador_cliente,
         EXISTS (SELECT 1 FROM chave_api k WHERE k.cliente_api_id = ca.id AND k.situacao = 'ativa'
                    AND k.excluido_em IS NULL) AS tem_segredo,
         u.login AS criado_por_login
    FROM parceiro_dados p
    LEFT JOIN cliente_api ca ON ca.id = p.cliente_api_id AND ca.excluido_em IS NULL
    LEFT JOIN usuario u ON u.id = p.criado_por
   WHERE p.excluido_em IS NULL`;

const parceiroDaLinha = (x: Linha): ParceiroIntegracao => ({
  id: String(x['id']),
  codigo: String(x['codigo']),
  nome: String(x['nome']),
  tipo: String(x['tipo']),
  canal: texto(x['canal']),
  escopos: lista(x['escopos']),
  eventos: lista(x['eventos']),
  limiteTentativas: inteiro(x['limite_tentativas']),
  finalidade: String(x['finalidade']),
  baseLegal: String(x['base_legal']),
  clienteId: texto(x['identificador_cliente']),
  temSegredo: booleano(x['tem_segredo']),
  ativo: booleano(x['ativo']),
  criadoPor: texto(x['criado_por_login']) ?? 'sistema',
  alteradoEm: data(x['alterado_em']),
});

// As mensagens de saída do estabelecimento, com o parceiro (pelo sistema externo) e a última falha tratável.
const SQL_ENVIO = `
  SELECT s.id, s.integracao_mensagem_id, s.chave_idempotencia, s.tipo_mensagem, p.codigo AS parceiro, s.correlacao,
         s.entidade, s.entidade_id, s.situacao, s.tentativas, s.proxima_tentativa_em, s.enviada_em, s.codigo_resposta,
         s.resposta, s.hash_sha256, s.criado_em, f.ocorrido_em AS morto_em, f.situacao AS falha_situacao,
         f.tratamento, uf.login AS tratado_por
    FROM mensagem_integracao_saida s
    JOIN parceiro_dados p ON p.sistema_externo_id = s.sistema_externo_id AND p.excluido_em IS NULL
    LEFT JOIN falha_integracao f ON f.id = (SELECT MAX(f2.id) FROM falha_integracao f2
                                             WHERE f2.mensagem_integracao_saida_id = s.id AND f2.excluido_em IS NULL)
    LEFT JOIN usuario uf ON uf.id = f.alterado_por
   WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL`;

function envioDaLinha(x: Linha): EnvioIntegracao {
  const situacao = situacaoDoEnvio(String(x['situacao']));
  const tratamento = tratamentoDaFalha(x['falha_situacao']);
  return {
    id: String(x['id']),
    idOutbox: texto(x['integracao_mensagem_id']) ?? '',
    chaveEvento: String(x['chave_idempotencia']),
    tipoEvento: texto(x['tipo_mensagem']) ?? '',
    parceiro: String(x['parceiro']),
    chaveOrdem: texto(x['correlacao']) ?? '',
    tabelaFato: texto(x['entidade']),
    idFato: texto(x['entidade_id']),
    situacao,
    tentativas: inteiro(x['tentativas']),
    proximaTentativaEm: data(x['proxima_tentativa_em']),
    enviadoEm: data(x['enviada_em']),
    recibo: texto(x['codigo_resposta']),
    resposta: texto(x['resposta']),
    hashConteudo: texto(x['hash_sha256']),
    mortoEm: data(x['morto_em']),
    tratamento,
    tratadoPor: tratamento ? texto(x['tratado_por']) : null,
    motivoTratamento: tratamento ? texto(x['tratamento']) : null,
    criadoEm: data(x['criado_em']) ?? new Date(0),
  };
}

const SQL_RECEBIDA = `
  SELECT m.id, p.codigo AS parceiro, m.tipo_mensagem, m.chave_idempotencia, m.hash_sha256, a.chave_armazenamento,
         m.tamanho_bytes, m.situacao, m.mensagem_confirmacao, m.entidade, m.entidade_id, m.processada_em,
         m.recebida_em, u.login AS conferido_por
    FROM mensagem_integracao_entrada m
    JOIN parceiro_dados p ON p.sistema_externo_id = m.sistema_externo_id AND p.excluido_em IS NULL
    LEFT JOIN arquivo a ON a.id = m.arquivo_id
    LEFT JOIN usuario u ON u.id = m.alterado_por
   WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL`;

function recebidaDaLinha(x: Linha): RecebidaIntegracao {
  const conferidoPor = texto(x['conferido_por']);
  return {
    id: String(x['id']),
    parceiro: String(x['parceiro']),
    tipo: texto(x['tipo_mensagem']) ?? '',
    chaveParceiro: String(x['chave_idempotencia']),
    hash: texto(x['hash_sha256']) ?? '',
    chaveS3: texto(x['chave_armazenamento']),
    tamanho: inteiro(x['tamanho_bytes']),
    situacao: situacaoDaRecebida(String(x['situacao'])),
    detalhe: texto(x['mensagem_confirmacao']),
    tabelaObjeto: texto(x['entidade']),
    idObjeto: texto(x['entidade_id']),
    conferidoPor,
    conferidoEm: conferidoPor ? data(x['processada_em']) : null,
    recebidoEm: data(x['recebida_em']) ?? new Date(0),
  };
}

function semEstabelecimento(): Error {
  return recusa(
    'estabelecimento-desconhecido',
    'O estabelecimento da gravação não está cadastrado neste cliente.',
  );
}

/** Os campos simples do resultado (o que vai ao resultado da operação no núcleo). */
function resultadoSimples(r: unknown): ResultadoOperacao {
  if (r === null || r === undefined) return {};
  if (typeof r !== 'object') return typeof r === 'string' && r.length > 200 ? {} : { valor: r as number };
  return Object.fromEntries(
    Object.entries(r).filter(
      ([, v]) =>
        v === null ||
        typeof v === 'number' ||
        typeof v === 'boolean' ||
        (typeof v === 'string' && v.length <= 200),
    ),
  ) as ResultadoOperacao;
}

export class PortaIntegracaoPropria implements PortaIntegracao {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoIntegracao,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoIntegracao, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'integracao' }, fn);
  }

  /** O estabelecimento da sessão pelo id, ou pelo código da rota (entrada do parceiro). */
  private async estabelecimento(c: ContextoIntegracao, l: Leitor): Promise<number | null> {
    if (typeof c.estabelecimento === 'number') return c.estabelecimento;
    const r = await l.uma<{ id: unknown }>(
      'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
      [c.hospital],
    );
    return r ? Number(r.id) : null;
  }

  /** Leitura de dado do estabelecimento: sem estabelecimento conhecido, o valor vazio. */
  private doEstabelecimento<T>(
    c: ContextoIntegracao,
    vazio: T,
    fn: (l: Leitor, est: number) => Promise<T>,
  ): Promise<T> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      return est === null ? vazio : fn(l, est);
    });
  }

  async relogio(c: ContextoIntegracao): Promise<Date> {
    const r = await this.ler(c, (l) => l.uma<{ agora: unknown }>('SELECT CURRENT_TIMESTAMP(3) AS agora'));
    return data(r?.agora) ?? new Date();
  }

  // ---- parceiros (do cliente inteiro: o cadastro do parceiro vale para todos os estabelecimentos) ----

  parceiros(c: ContextoIntegracao): Promise<ParceiroIntegracao[]> {
    return this.ler(c, async (l) =>
      (await l.consultar(`${SQL_PARCEIRO} ORDER BY p.codigo`, [], { teto: 500 })).map(parceiroDaLinha),
    );
  }

  parceiro(c: ContextoIntegracao, codigo: string): Promise<ParceiroIntegracao | null> {
    return this.ler(c, async (l) => {
      const x = await l.uma(`${SQL_PARCEIRO} AND p.codigo = ?`, [codigo]);
      return x ? parceiroDaLinha(x) : null;
    });
  }

  credencial(c: ContextoIntegracao, clienteId: string) {
    return this.ler(c, async (l) => {
      const x = await l.uma(
        `SELECT p.codigo, p.ativo, p.escopos, ca.situacao, ca.estabelecimento_id, k.hash_chave
           FROM cliente_api ca
           JOIN parceiro_dados p ON p.cliente_api_id = ca.id AND p.excluido_em IS NULL
           JOIN chave_api k ON k.cliente_api_id = ca.id AND k.situacao = 'ativa' AND k.excluido_em IS NULL
                AND k.valida_desde <= CURRENT_TIMESTAMP(3) AND (k.valida_ate IS NULL OR k.valida_ate > CURRENT_TIMESTAMP(3))
          WHERE ca.identificador_cliente = ? AND ca.excluido_em IS NULL
          ORDER BY k.sequencia DESC LIMIT 1`,
        [clienteId],
      );
      if (!x) return null;
      const est = await this.estabelecimento(c, l);
      const restrito = x['estabelecimento_id'] === null ? null : Number(x['estabelecimento_id']);
      return {
        codigo: String(x['codigo']),
        resumo: String(x['hash_chave']),
        // O cliente da API restrito a um estabelecimento não vale nos outros (falha fechada).
        ativo:
          booleano(x['ativo']) &&
          x['situacao'] === 'ativo' &&
          est !== null &&
          (restrito === null || restrito === est),
        escopos: lista(x['escopos']),
      };
    });
  }

  // ---- mensagens de saída e a fila de mortos ----

  envios(
    c: ContextoIntegracao,
    f: { readonly situacao?: string; readonly parceiro?: string; readonly limite: number },
  ) {
    return this.doEstabelecimento(c, [] as EnvioIntegracao[], async (l, est) => {
      const situacoes = f.situacao ? SITUACOES_SAIDA[f.situacao as SituacaoEnvio] : undefined;
      if (f.situacao && !situacoes) return [];
      const filtros: string[] = [];
      const p: unknown[] = [est];
      if (situacoes) {
        filtros.push(`s.situacao IN (${situacoes.map(() => '?').join(', ')})`);
        p.push(...situacoes);
      }
      if (f.parceiro) {
        filtros.push('p.codigo = ?');
        p.push(f.parceiro);
      }
      const limite = Math.max(1, Math.min(Math.trunc(f.limite) || 1, 500));
      return (
        await l.consultar(
          `${SQL_ENVIO}${filtros.map((x) => ` AND ${x}`).join('')} ORDER BY s.id DESC LIMIT ${limite}`,
          p,
          { teto: 500 },
        )
      ).map(envioDaLinha);
    });
  }

  envio(c: ContextoIntegracao, id: string) {
    if (!/^\d{1,15}$/.test(id)) return Promise.resolve(null);
    return this.doEstabelecimento(c, null as EnvioIntegracao | null, async (l, est) => {
      const x = await l.uma(`${SQL_ENVIO} AND s.id = ?`, [est, Number(id)]);
      return x ? envioDaLinha(x) : null;
    });
  }

  mortos(c: ContextoIntegracao) {
    return this.doEstabelecimento(c, [] as EnvioIntegracao[], async (l, est) =>
      (
        await l.consultar(
          `${SQL_ENVIO} AND s.situacao IN ('erro', 'rejeitada', 'expirada') ORDER BY f.ocorrido_em, s.id LIMIT 100`,
          [est],
          { teto: 100 },
        )
      ).map(envioDaLinha),
    );
  }

  contagens(c: ContextoIntegracao) {
    const vazio = { outbox: [], envios: [], entradas: [] } as {
      outbox: ContagemPorSituacao[];
      envios: ContagemPorSituacao[];
      entradas: ContagemPorSituacao[];
    };
    return this.doEstabelecimento(c, vazio, async (l, est) => {
      const somar = (linhas: Linha[], mapear: (s: string) => string): ContagemPorSituacao[] => {
        const m = new Map<string, ContagemPorSituacao>();
        for (const x of linhas) {
          const chave = String(x['chave']);
          const situacao = mapear(String(x['situacao']));
          const k = `${chave}|${situacao}`;
          m.set(k, { chave, situacao, quantidade: (m.get(k)?.quantidade ?? 0) + inteiro(x['n']) });
        }
        return [...m.values()];
      };
      const outbox = await l.consultar(
        `SELECT ponto AS chave, situacao, COUNT(*) AS n FROM integracao_mensagem
          WHERE direcao = 'saida' AND estabelecimento_id = ?
            AND (situacao NOT IN ('enviada', 'processada') OR criado_em >= CURRENT_TIMESTAMP(3) - INTERVAL 1 DAY)
          GROUP BY ponto, situacao`,
        [est],
        { teto: 500 },
      );
      const envios = await l.consultar(
        `SELECT p.codigo AS chave, s.situacao, COUNT(*) AS n FROM mensagem_integracao_saida s
           JOIN parceiro_dados p ON p.sistema_externo_id = s.sistema_externo_id AND p.excluido_em IS NULL
          WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL GROUP BY p.codigo, s.situacao`,
        [est],
        { teto: 500 },
      );
      const entradas = await l.consultar(
        `SELECT p.codigo AS chave, m.situacao, COUNT(*) AS n FROM mensagem_integracao_entrada m
           JOIN parceiro_dados p ON p.sistema_externo_id = m.sistema_externo_id AND p.excluido_em IS NULL
          WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL GROUP BY p.codigo, m.situacao`,
        [est],
        { teto: 500 },
      );
      return {
        outbox: somar(outbox, (s) => s),
        envios: somar(envios, situacaoDoEnvio),
        entradas: somar(entradas, situacaoDaRecebida),
      };
    });
  }

  // ---- mensagens de entrada ----

  recebidas(
    c: ContextoIntegracao,
    f: { readonly situacao?: string; readonly parceiro?: string; readonly limite: number },
  ) {
    return this.doEstabelecimento(c, [] as RecebidaIntegracao[], async (l, est) => {
      const situacoes = f.situacao ? SITUACOES_ENTRADA[f.situacao as SituacaoRecebida] : undefined;
      if (f.situacao && !situacoes) return [];
      const filtros: string[] = [];
      const p: unknown[] = [est];
      if (situacoes) {
        filtros.push(`m.situacao IN (${situacoes.map(() => '?').join(', ')})`);
        p.push(...situacoes);
      }
      if (f.parceiro) {
        filtros.push('p.codigo = ?');
        p.push(f.parceiro);
      }
      const limite = Math.max(1, Math.min(Math.trunc(f.limite) || 1, 500));
      return (
        await l.consultar(
          `${SQL_RECEBIDA}${filtros.map((x) => ` AND ${x}`).join('')} ORDER BY m.id DESC LIMIT ${limite}`,
          p,
          { teto: 500 },
        )
      ).map(recebidaDaLinha);
    });
  }

  recebida(c: ContextoIntegracao, id: string) {
    if (!/^\d{1,15}$/.test(id)) return Promise.resolve(null);
    return this.doEstabelecimento(c, null as RecebidaIntegracao | null, async (l, est) => {
      const x = await l.uma(`${SQL_RECEBIDA} AND m.id = ?`, [est, Number(id)]);
      return x ? recebidaDaLinha(x) : null;
    });
  }

  // ---- saúde das filas, identificação para a RNDS e o laboratório de apoio ----

  saudeFilas(c: ContextoIntegracao): Promise<SaudeFilas> {
    const vazio: SaudeFilas = {
      filas: [],
      bi: { pendentes: 0, maisAntiga: null },
      examesApoio: { marcados: 0, exportados: 0, pendentes: 0, maisAntigo: null },
    };
    return this.doEstabelecimento(c, vazio, async (l, est) => {
      const saida = await l.consultar(
        `SELECT pi.codigo, COUNT(*) AS n, MIN(s.criado_em) AS d FROM mensagem_integracao_saida s
           JOIN ponto_integracao pi ON pi.id = s.ponto_integracao_id
          WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL AND s.situacao IN ('pendente', 'enviando')
          GROUP BY pi.codigo ORDER BY pi.codigo`,
        [est],
        { teto: 500 },
      );
      const entrada = await l.consultar(
        `SELECT pi.codigo, COUNT(*) AS n, MIN(m.recebida_em) AS d FROM mensagem_integracao_entrada m
           JOIN ponto_integracao pi ON pi.id = m.ponto_integracao_id
          WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL AND m.situacao IN ('recebida', 'validada', 'processando')
          GROUP BY pi.codigo ORDER BY pi.codigo`,
        [est],
        { teto: 500 },
      );
      const pendentes = await l.uma(
        `SELECT COUNT(*) AS n, MIN(criado_em) AS d FROM integracao_mensagem
          WHERE direcao = 'saida' AND situacao = 'pendente' AND estabelecimento_id = ?`,
        [est],
      );
      // Os exames pedidos ao laboratório de apoio nos últimos 90 dias (só contagens).
      const apoio = await l.uma(
        `SELECT COUNT(*) AS marcados,
                SUM(CASE WHEN ei.situacao IN ('em_analise', 'resultado_digitado', 'revisado', 'liberado', 'entregue')
                         THEN 1 ELSE 0 END) AS exportados,
                SUM(CASE WHEN ei.situacao IN ('solicitado', 'autorizado', 'agendado', 'coletado') THEN 1 ELSE 0 END)
                  AS pendentes,
                MIN(CASE WHEN ei.situacao IN ('solicitado', 'autorizado', 'agendado', 'coletado') THEN ei.criado_em END)
                  AS mais_antigo
           FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
          WHERE r.estabelecimento_id = ? AND ei.laboratorio_apoio_id IS NOT NULL AND ei.excluido_em IS NULL
            AND ei.situacao <> 'cancelado' AND ei.criado_em >= CURRENT_TIMESTAMP(3) - INTERVAL 90 DAY`,
        [est],
      );
      return {
        filas: [
          ...saida.map((x) => ({
            fila: String(x['codigo']),
            direcao: 'saida' as const,
            quantidade: inteiro(x['n']),
            maisAntiga: iso(x['d']),
          })),
          ...entrada.map((x) => ({
            fila: String(x['codigo']),
            direcao: 'entrada' as const,
            quantidade: inteiro(x['n']),
            maisAntiga: iso(x['d']),
          })),
        ],
        bi: { pendentes: inteiro(pendentes?.['n']), maisAntiga: iso(pendentes?.['d']) },
        examesApoio: {
          marcados: inteiro(apoio?.['marcados']),
          exportados: inteiro(apoio?.['exportados']),
          pendentes: inteiro(apoio?.['pendentes']),
          maisAntigo: iso(apoio?.['mais_antigo']),
        },
      };
    });
  }

  identificacao(c: ContextoIntegracao) {
    return this.ler(c, async (l) => {
      // Paciente e profissional são do cliente inteiro (cadastro único): sem filtro de estabelecimento.
      const p = await l.uma(
        `SELECT SUM(CASE WHEN pf.cpf IS NOT NULL THEN 1 ELSE 0 END) AS cpf,
                SUM(CASE WHEN pf.cns IS NOT NULL THEN 1 ELSE 0 END) AS cns
           FROM paciente pa JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
          WHERE pa.excluido_em IS NULL AND pf.excluido_em IS NULL`,
      );
      const r = await l.uma(
        `SELECT COUNT(*) AS cns FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
          WHERE pr.excluido_em IS NULL AND pf.cns IS NOT NULL`,
      );
      const est = await this.estabelecimento(c, l);
      const h =
        est === null
          ? null
          : await l.uma('SELECT codigo_cnes FROM estabelecimento WHERE id = ? AND excluido_em IS NULL', [
              est,
            ]);
      return {
        pacientesComCpf: inteiro(p?.['cpf']),
        pacientesComCns: inteiro(p?.['cns']),
        profissionaisComCns: inteiro(r?.['cns']),
        estabelecimentoComCnes: Boolean(h && texto(h['codigo_cnes'])),
      };
    });
  }

  interfacesApoio(c: ContextoIntegracao): Promise<LaboratorioApoio[]> {
    return this.doEstabelecimento(c, [] as LaboratorioApoio[], async (l, est) =>
      (
        await l.consultar(
          `SELECT la.id, la.nome, la.codigo,
                  (SELECT COUNT(*) FROM exame_laboratorio_apoio x WHERE x.laboratorio_apoio_id = la.id AND x.ativo) AS n
             FROM laboratorio_apoio la
            WHERE la.estabelecimento_id = ? AND la.ativo AND la.excluido_em IS NULL ORDER BY la.id`,
          [est],
          { teto: 200 },
        )
      ).map((x) => ({
        codigo: Number(x['id']),
        nome: texto(x['nome']),
        laboratorio: texto(x['codigo']),
        exames: inteiro(x['n']),
      })),
    );
  }

  deParaExame(c: ContextoIntegracao, laboratorio: number, codigoExame: string) {
    const vazio = {
      exame: null as number | null,
      elementos: [] as { codigoLaboratorio: string; nome: string | null }[],
    };
    return this.doEstabelecimento(c, vazio, async (l, est) => {
      const x = await l.uma(
        `SELECT ela.id, ela.exame_id FROM exame_laboratorio_apoio ela
           JOIN laboratorio_apoio la ON la.id = ela.laboratorio_apoio_id
          WHERE ela.laboratorio_apoio_id = ? AND la.estabelecimento_id = ? AND ela.codigo_exame_apoio = ? AND ela.ativo`,
        [laboratorio, est, codigoExame],
      );
      if (!x) return vazio;
      const elementos = await l.consultar(
        `SELECT codigo_elemento_externo, nome_elemento_externo FROM elemento_exame_laboratorio_apoio
          WHERE exame_laboratorio_apoio_id = ? AND excluido_em IS NULL ORDER BY id`,
        [Number(x['id'])],
        { teto: 500 },
      );
      return {
        exame: Number(x['exame_id']),
        elementos: elementos.map((e) => ({
          codigoLaboratorio: String(e['codigo_elemento_externo']),
          nome: texto(e['nome_elemento_externo']),
        })),
      };
    });
  }

  exameDoRetorno(c: ContextoIntegracao, id: number) {
    return this.doEstabelecimento(
      c,
      null as Awaited<ReturnType<PortaIntegracao['exameDoRetorno']>>,
      async (l, est) => {
        const x = await l.uma(
          `SELECT ei.id, ei.exame_id, ei.situacao, ei.laboratorio_apoio_id, r.paciente_id, r.atendimento_id, e.codigo, e.nome,
                EXISTS (SELECT 1 FROM resultado_exame re WHERE re.exame_item_id = ei.id AND re.excluido_em IS NULL)
                  AS digitado
           FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
           JOIN exame e ON e.id = ei.exame_id
          WHERE ei.id = ? AND r.estabelecimento_id = ? AND ei.excluido_em IS NULL AND r.excluido_em IS NULL`,
          [id, est],
        );
        if (!x) return null;
        const elementos = await l.consultar(
          `SELECT a.id, a.nome FROM exame_analito ea JOIN analito a ON a.id = ea.analito_id
          WHERE ea.exame_id = ? AND ea.ativo AND ea.excluido_em IS NULL AND NOT ea.titulo ORDER BY ea.ordem, ea.id`,
          [Number(x['exame_id'])],
          { teto: 500 },
        );
        return {
          id,
          paciente: Number(x['paciente_id']),
          atendimento: x['atendimento_id'] === null ? null : Number(x['atendimento_id']),
          exame: String(x['codigo']),
          exameNome: texto(x['nome']),
          liberado: ['liberado', 'entregue'].includes(String(x['situacao'])),
          digitado: booleano(x['digitado']),
          elementos: elementos.map((e) => ({ elemento: Number(e['id']), nome: String(e['nome']) })),
          laboratorio: x['laboratorio_apoio_id'] === null ? null : Number(x['laboratorio_apoio_id']),
        };
      },
    );
  }

  exameLido(c: ContextoIntegracao, id: number) {
    return this.doEstabelecimento(c, null as { id: number; versao: number } | null, async (l, est) => {
      const x = await l.uma(
        `SELECT ei.versao FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
          WHERE ei.id = ? AND r.estabelecimento_id = ? AND ei.excluido_em IS NULL`,
        [id, est],
      );
      return x ? { id, versao: Number(x['versao']) } : null;
    });
  }

  vinculos(c: ContextoIntegracao, login: string): Promise<VinculoResponsavel[]> {
    return this.doEstabelecimento(c, [] as VinculoResponsavel[], async (l, est) =>
      (
        await l.consultar(
          `SELECT v.profissional_id, COALESCE(pr.nome_exibicao, pf.nome) AS nome, pr.situacao,
                  (SELECT MIN(ic.id) FROM inscricao_conselho ic WHERE ic.profissional_id = pr.id
                      AND ic.situacao IN ('ativa', 'provisoria') AND ic.excluido_em IS NULL) AS inscricao,
                  (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE) AS vigente
             FROM usuario u
             JOIN usuario_vinculo_profissional v ON v.usuario_id = u.id AND v.estabelecimento_id = ?
                  AND v.profissional_id IS NOT NULL AND v.excluido_em IS NULL
             JOIN profissional pr ON pr.id = v.profissional_id AND pr.excluido_em IS NULL
             JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
            WHERE u.login = ? AND u.excluido_em IS NULL`,
          [est, login],
          { teto: 50 },
        )
      ).map((x) => ({
        vinculo: Number(x['profissional_id']),
        conselho: inteiro(x['inscricao']),
        nome: String(x['nome']),
        ativo: x['situacao'] === 'ativo' && booleano(x['vigente']),
      })),
    );
  }

  // ---- gravações ----

  async registrarResultadoApoio(
    c: ContextoIntegracao,
    r: ResultadoApoio,
    octx: ContextoGravacao,
  ): Promise<{ resultado: number; repetida: boolean }> {
    const est = await this.ler(c, (l) =>
      this.estabelecimento({ ...c, estabelecimento: octx.estabelecimento ?? c.estabelecimento ?? null }, l),
    );
    if (est === null) throw semEstabelecimento();
    const operacao = definirOperacao<ResultadoApoio, { resultado: number; exame: number; critico: boolean }>({
      nome: 'integracao.apoio.registrar-resultado',
      tabelas: TABELAS_RESULTADO_APOIO,
      entrada: esquemaResultadoApoio as unknown as z.ZodType<ResultadoApoio>,
      acao: 'inclusao',
      travar: (e) => ({ tabela: 'exame_item', id: e.exame, versaoEsperada: e.versao, colunas: ['situacao'] }),
      gravar: async (tx, e) => gravarResultadoApoio(tx, est, e),
      alvo: (_e, s) => ({ tabela: 'resultado_exame', id: s.resultado }),
      // O fato do resultado liberado, na mesma transação (regra 7): só ids e o sinal de crítico.
      eventos: (_e, s) => [
        {
          tipo: 'fato.resultado.liberado',
          carga: { exame: s.exame, resultado: s.resultado, critico: s.critico },
        },
      ],
      trilha: (e) => ({
        dados: {
          exame: e.exame,
          elementos: e.elementos.length,
          conferente: e.conferente,
          recebida: e.recebida,
        },
      }),
    });
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: octx.usuario,
      correlacao: octx.correlacao,
      chaveIdempotencia: octx.chaveIdempotencia,
    };
    const s = await this.executor.executar(operacao, this.cliente, r, ctx);
    return { resultado: Number(s.resultado.resultado), repetida: s.repetida };
  }

  async gravar<T>(
    c: ContextoIntegracao,
    trilha: TrilhaIntegracao | ((r: T) => TrilhaIntegracao),
    fn: (g: GravadorIntegracao) => Promise<T>,
  ): Promise<T> {
    const est = await this.ler(c, (l) => this.estabelecimento(c, l));
    if (est === null) throw semEstabelecimento();
    let feito: { readonly r: T } | null = null;
    const linha = (): TrilhaIntegracao => {
      if (!feito) throw new Error('Gravação sem resultado.');
      return typeof trilha === 'function' ? trilha(feito.r) : trilha;
    };
    const operacao = definirOperacao<Record<string, unknown>, ResultadoOperacao>({
      nome: 'integracao.gravacao',
      tabelas: TABELAS_INTEGRACAO,
      entrada: esquemaEntrada,
      acao: 'operacao',
      gravar: async (tx) => {
        const r = await fn(new GravadorIntegracaoBanco(tx, est));
        feito = { r };
        return resultadoSimples(r);
      },
      alvo: () => {
        const l = linha();
        return { tabela: l.entidade, id: l.entidadeId };
      },
      trilha: () => {
        const l = linha();
        return { dados: l.dadosDepois, motivo: l.motivo ?? null };
      },
    });
    const fixa = typeof trilha === 'function' ? null : trilha;
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: fixa?.usuario ?? c.usuario ?? null,
      correlacao: (fixa?.correlacao ?? c.correlacao ?? 'integracao').slice(0, 64) || 'integracao',
      chaveIdempotencia: `direta:${randomUUID()}`,
    };
    await this.executor.executar(operacao, this.cliente, {}, ctx);
    const pronto = feito as { readonly r: T } | null;
    if (!pronto) throw new Error('Gravação sem resultado.');
    return pronto.r;
  }
}

const esquemaResultadoApoio = z.object({
  exame: z.number().int().positive(),
  versao: z.number().int().positive(),
  laboratorio: z.number().int().positive().nullable(),
  elementos: z
    .array(
      z.object({
        elemento: z.number().int().positive(),
        numerico: z.number().nullable(),
        alfa: z.string().max(2000).nullable(),
      }),
    )
    .min(1)
    .max(200),
  observacao: z.string().max(1000),
  conferente: z.number().int().positive(),
  recebida: z
    .string()
    .regex(/^\d{1,15}$/)
    .nullable(),
});

const SEXO_DA_SIGLA: Readonly<Record<string, 'M' | 'F'>> = { M: 'M', F: 'F' };
const SEXO_DA_REGRA: Readonly<Record<'M' | 'F', string>> = { M: 'masculino', F: 'feminino' };
const numeroOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * O resultado conferido do apoio no exame pedido, pelas regras do SADT: o analito do exame, a faixa do paciente, o
 * anormal e o crítico (com o aviso), a liberação pelo responsável técnico e a mensagem recebida concluída junto.
 */
async function gravarResultadoApoio(
  tx: TxOperacao,
  est: number,
  e: ResultadoApoio,
): Promise<{ resultado: number; exame: number; critico: boolean }> {
  const x = await tx.uma(
    `SELECT ei.id, ei.versao, ei.situacao, ei.exame_id, ei.setor_diagnostico_id, ei.laboratorio_apoio_id, r.paciente_id,
            pf.data_nascimento, sx.sigla AS sexo
       FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
       JOIN paciente p ON p.id = r.paciente_id
       JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
       LEFT JOIN sexo sx ON sx.id = pf.sexo_id
      WHERE ei.id = ? AND r.estabelecimento_id = ? AND ei.excluido_em IS NULL AND r.excluido_em IS NULL`,
    [e.exame, est],
  );
  if (!x) throw recusa('exame-inexistente', 'O exame do pedido não está neste estabelecimento.');
  if (['liberado', 'entregue', 'cancelado', 'recusado'].includes(String(x['situacao'])))
    throw recusa('exame-encerrado', 'O exame do pedido já foi liberado, entregue ou cancelado.');
  const ja = await tx.uma('SELECT id FROM resultado_exame WHERE exame_item_id = ? AND excluido_em IS NULL', [
    e.exame,
  ]);
  if (ja) throw recusa('resultado-ja-digitado', 'O exame já tem resultado.');
  const exameId = Number(x['exame_id']);
  // O laboratório: o do pedido; senão o da mensagem, conferido no estabelecimento.
  const laboratorio = x['laboratorio_apoio_id'] === null ? e.laboratorio : Number(x['laboratorio_apoio_id']);
  if (laboratorio === null)
    throw recusa('sem-laboratorio-apoio', 'O laboratório de apoio do resultado não foi identificado.');
  const lab = await tx.uma(
    'SELECT id FROM laboratorio_apoio WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [laboratorio, est],
  );
  if (!lab) throw recusa('sem-laboratorio-apoio', 'O laboratório de apoio não é deste estabelecimento.');
  // Os analitos do exame (o valor de analito de outro exame é recusado).
  const analitos = new Map(
    (
      await tx.consultar(
        `SELECT ea.id, ea.analito_id, ea.ordem FROM exame_analito ea
          WHERE ea.exame_id = ? AND ea.ativo AND ea.excluido_em IS NULL AND NOT ea.titulo`,
        [exameId],
      )
    ).map(
      (a) => [Number(a['analito_id']), { exameAnalito: Number(a['id']), ordem: Number(a['ordem']) }] as const,
    ),
  );
  for (const v of e.elementos)
    if (!analitos.has(v.elemento))
      throw recusa('elemento-inexistente', `O analito ${v.elemento} não é do exame pedido.`);
  // O setor executante: o do pedido; senão o padrão do exame no estabelecimento; sem setor, recusa.
  let setor = numeroOuNulo(x['setor_diagnostico_id']);
  if (setor === null) {
    const s = await tx.uma<{ setor_diagnostico_id: unknown }>(
      `SELECT es.setor_diagnostico_id FROM exame_setor_executante es
         JOIN setor_diagnostico sd ON sd.id = es.setor_diagnostico_id AND sd.estabelecimento_id = ? AND sd.excluido_em IS NULL
        WHERE es.exame_id = ? AND es.ativo AND es.excluido_em IS NULL
        ORDER BY es.padrao DESC, es.id LIMIT 1`,
      [est, exameId],
    );
    setor = s ? Number(s.setor_diagnostico_id) : null;
  }
  if (setor === null)
    throw recusa(
      'sem-setor-executante',
      'O exame não tem setor executante neste estabelecimento: cadastre o setor do exame.',
    );
  const agora = new Date();
  const sexo = SEXO_DA_SIGLA[String(x['sexo'] ?? '')] ?? null;
  const dias = idadeEmDias(data(x['data_nascimento']), agora);
  const paciente = { sexo, idadeAnos: dias === null ? null : Math.floor(dias / 365.25) };
  const interpretados = [];
  for (const v of e.elementos) {
    const ea = analitos.get(v.elemento)!;
    // A faixa vigente do paciente: a mais específica (sexo e idade) da condição comum.
    const f = await tx.uma(
      `SELECT id, referencia_minima, referencia_maxima, referencia_texto, critico_minimo, critico_maximo
         FROM faixa_referencia
        WHERE exame_analito_id = ? AND ativo AND condicao = 'nenhuma'
          AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
          AND (sexo_id IS NULL OR sexo_id = (SELECT pf.sexo_id FROM pessoa_fisica pf JOIN paciente p ON p.pessoa_fisica_id = pf.id
                                              WHERE p.id = ?))
          AND (idade_minima_dias IS NULL OR (? IS NOT NULL AND idade_minima_dias <= ?))
          AND (idade_maxima_dias IS NULL OR (? IS NOT NULL AND idade_maxima_dias >= ?))
        ORDER BY sexo_id IS NULL, (idade_minima_dias IS NULL AND idade_maxima_dias IS NULL), id DESC LIMIT 1`,
      [ea.exameAnalito, Number(x['paciente_id']), dias, dias, dias, dias],
    );
    // A regra de crítico vigente: a do estabelecimento antes da do cliente, a mais específica primeiro.
    const rc = await tx.uma(
      `SELECT id, limite_inferior, limite_superior, prazo_comunicacao_minutos FROM regra_valor_critico
        WHERE analito_id = ? AND ativo AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
          AND setor_funcional_id IS NULL AND (limite_inferior IS NOT NULL OR limite_superior IS NOT NULL)
          AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
          AND (sexo IS NULL OR sexo = ?)
          AND (idade_minima_dias IS NULL OR (? IS NOT NULL AND idade_minima_dias <= ?))
          AND (idade_maxima_dias IS NULL OR (? IS NOT NULL AND idade_maxima_dias >= ?))
        ORDER BY estabelecimento_id IS NULL, sexo IS NULL, id DESC LIMIT 1`,
      [v.elemento, est, sexo ? SEXO_DA_REGRA[sexo] : null, dias, dias, dias, dias],
    );
    interpretados.push({
      v,
      ea,
      faixa: f ? Number(f['id']) : null,
      i: interpretarValorApoio({
        elemento: v.elemento,
        valor: v.numerico,
        faixa: f
          ? {
              id: Number(f['id']),
              minimo: numeroOuNulo(f['referencia_minima']),
              maximo: numeroOuNulo(f['referencia_maxima']),
              texto: texto(f['referencia_texto']),
              criticoMinimo: numeroOuNulo(f['critico_minimo']),
              criticoMaximo: numeroOuNulo(f['critico_maximo']),
            }
          : null,
        regra: rc
          ? {
              id: Number(rc['id']),
              abaixoDe: numeroOuNulo(rc['limite_inferior']),
              acimaDe: numeroOuNulo(rc['limite_superior']),
              prazoMinutos: Number(rc['prazo_comunicacao_minutos']),
            }
          : null,
        paciente,
      }),
    });
  }
  const anormal = interpretados.some((y) => y.i.anormal);
  const critico = interpretados.some((y) => y.i.critico);
  const resultado = await tx.incluir('resultado_exame', {
    exame_item_id: e.exame,
    paciente_id: Number(x['paciente_id']),
    setor_diagnostico_id: setor,
    laboratorio_apoio_id: laboratorio,
    forma_entrada: 'laboratorio_apoio',
    situacao: 'liberado',
    resultado_em: agora,
    digitado_por_usuario_id: tx.contexto.usuario,
    digitado_em: agora,
    conferido_por_profissional_id: e.conferente,
    conferido_em: agora,
    liberado_por_profissional_id: e.conferente,
    liberado_em: agora,
    anormal,
    critico,
    observacao: e.observacao,
    origem: 'integracao',
  });
  for (const y of interpretados.sort((a, b) => a.ea.ordem - b.ea.ordem || a.v.elemento - b.v.elemento)) {
    const analito = await tx.incluir('resultado_analito', {
      resultado_exame_id: resultado,
      sequencia: y.ea.ordem,
      analito_id: y.v.elemento,
      valor_numerico: y.v.numerico,
      valor_texto: y.v.numerico === null ? (y.v.alfa ?? '') : y.v.alfa,
      faixa_referencia_id: y.faixa,
      referencia_minimo: y.i.referenciaMinimo,
      referencia_maximo: y.i.referenciaMaximo,
      referencia_texto: y.i.referenciaTexto,
      critico_minimo: y.i.criticoMinimo,
      critico_maximo: y.i.criticoMaximo,
      interpretacao: y.i.interpretacao,
      anormal: y.i.anormal,
      critico: y.i.critico,
      origem: 'integracao',
    });
    if (y.i.critico)
      await tx.incluir('aviso_valor_critico', {
        estabelecimento_id: est,
        resultado_exame_id: resultado,
        resultado_analito_id: analito,
        paciente_id: Number(x['paciente_id']),
        regra_valor_critico_id: y.i.regraCritica,
        gerado_em: agora,
        prazo_em: new Date(agora.getTime() + (y.i.prazoCriticoMinutos ?? 0) * 60_000),
        situacao: 'pendente',
        origem: 'integracao',
      });
  }
  await tx.alterar('exame_item', e.exame, Number(x['versao']), {
    situacao: 'liberado',
    revisado_em: agora,
    revisado_por_usuario_id: tx.contexto.usuario,
    liberado_em: agora,
    liberado_por_usuario_id: tx.contexto.usuario,
  });
  await marcarRetornoNaRemessa(tx, est, e.exame, resultado, agora);
  // A mensagem que trouxe o resultado sai da fila na mesma transação (sem resultado gravado com mensagem presa).
  if (e.recebida !== null) {
    const n = await new GravadorIntegracaoBanco(tx, est).concluirRecebida(e.recebida, {
      situacao: 'processada',
      detalhe: `${e.elementos.length} elemento(s) gravado(s)`,
      tabelaObjeto: 'resultado_exame',
      idObjeto: String(resultado),
    });
    if (n !== 1) throw recusa('retorno-mudou', 'O retorno não está mais na fila de conferência.');
  }
  return { resultado, exame: e.exame, critico };
}

/** O gravador sobre a transação da operação (o estabelecimento é o da sessão ou o da rota do parceiro). */
class GravadorIntegracaoBanco implements GravadorIntegracao {
  constructor(
    private readonly tx: TxOperacao,
    private readonly est: number,
  ) {}

  private async parceiroPorCodigo(codigo: string, travar = false): Promise<Linha | null> {
    const sql = `SELECT id, versao, codigo, nome, tipo, finalidade, limite_tentativas, sistema_externo_id, cliente_api_id, ativo
                   FROM parceiro_dados WHERE codigo = ? AND excluido_em IS NULL`;
    const l = travar
      ? await this.tx.consultarParaAtualizar(sql, [codigo])
      : await this.tx.consultar(sql, [codigo]);
    return l[0] ?? null;
  }

  /** O sistema externo do parceiro (criado com ele; o parceiro carregado sem ele ganha um aqui). */
  private async sistemaDo(p: Linha): Promise<number> {
    if (p['sistema_externo_id'] !== null) return Number(p['sistema_externo_id']);
    const ja = await this.tx.uma<{ id: unknown }>(
      'SELECT id FROM sistema_externo WHERE codigo = ? AND excluido_em IS NULL',
      [String(p['codigo'])],
    );
    const id =
      ja !== null
        ? Number(ja.id)
        : await this.tx.incluir('sistema_externo', {
            codigo: String(p['codigo']),
            nome: String(p['nome']),
            categoria: CATEGORIA_DO_TIPO[String(p['tipo'])] ?? 'outro',
            finalidade: String(p['finalidade']).slice(0, 500),
            ambiente: 'producao',
            ativo: true,
          });
    await this.tx.alterar('parceiro_dados', Number(p['id']), Number(p['versao']), { sistema_externo_id: id });
    return id;
  }

  /** O ponto de entrada ou de saída do parceiro no estabelecimento (criado na primeira mensagem). */
  private async pontoDo(p: Linha, direcao: 'entrada' | 'saida'): Promise<{ ponto: number; sistema: number }> {
    const sistema = await this.sistemaDo(p);
    const codigo = `parceiro.${String(p['codigo'])}.${direcao}`;
    const ja = await this.tx.uma<{ id: unknown; ativo: unknown }>(
      'SELECT id, ativo FROM ponto_integracao WHERE estabelecimento_id = ? AND codigo = ? AND excluido_em IS NULL',
      [this.est, codigo],
    );
    if (ja) {
      if (!booleano(ja.ativo))
        throw recusa('ponto-desativado', 'O ponto de integração do parceiro está desativado.');
      return { ponto: Number(ja.id), sistema };
    }
    const tipo = String(p['tipo']);
    const familia = FAMILIA_DO_TIPO[tipo] ?? 'proprio';
    const padrao = await this.tx.uma<{ id: unknown }>(
      'SELECT id FROM padrao_troca WHERE familia = ? AND ativo ORDER BY id LIMIT 1',
      [familia],
    );
    if (!padrao)
      throw recusa(
        'padrao-troca-nao-cadastrado',
        `O padrão de troca "${familia}" não está cadastrado neste cliente.`,
      );
    const ponto = await this.tx.incluir('ponto_integracao', {
      estabelecimento_id: this.est,
      codigo,
      nome: `${String(p['nome'])} (${direcao})`.slice(0, 150),
      sistema_externo_id: sistema,
      padrao_troca_id: Number(padrao.id),
      direcao,
      transporte: 'http_rest',
      formato_conteudo: familia === 'hl7v2' ? 'hl7v2' : 'json',
      limite_tentativas: Math.max(1, Math.min(inteiro(p['limite_tentativas']) || 5, 50)),
      ambiente: 'producao',
      ativo: true,
    });
    return { ponto, sistema };
  }

  async criarParceiro(p: DadosParceiro): Promise<string> {
    if (await this.parceiroPorCodigo(p.codigo))
      throw recusa('duplicado', 'Já existe parceiro com este código.');
    const id = await this.tx.incluir('parceiro_dados', {
      codigo: p.codigo,
      nome: p.nome,
      tipo: p.tipo,
      canal: p.canal,
      escopos: JSON.stringify([...p.escopos]),
      eventos: JSON.stringify([...p.eventos]),
      limite_tentativas: p.limiteTentativas,
      finalidade: p.finalidade,
      base_legal: p.baseLegal,
      // O parceiro nasce desligado: só passa a receber depois da revisão e da ativação.
      ativo: false,
    });
    const criado = await this.parceiroPorCodigo(p.codigo, true);
    if (criado) await this.sistemaDo(criado);
    return String(id);
  }

  async alterarParceiro(
    codigo: string,
    p: Omit<DadosParceiro, 'codigo' | 'tipo'> & { readonly ativo: boolean },
  ): Promise<number> {
    const x = await this.parceiroPorCodigo(codigo, true);
    if (!x) return 0;
    await this.tx.alterar('parceiro_dados', Number(x['id']), Number(x['versao']), {
      nome: p.nome,
      canal: p.canal,
      escopos: JSON.stringify([...p.escopos]),
      eventos: JSON.stringify([...p.eventos]),
      limite_tentativas: p.limiteTentativas,
      finalidade: p.finalidade,
      base_legal: p.baseLegal,
      ativo: p.ativo,
    });
    return 1;
  }

  async gravarCredencial(codigo: string, clienteId: string, resumo: string): Promise<number> {
    const p = await this.parceiroPorCodigo(codigo, true);
    if (!p) return 0;
    const agora = new Date();
    let cliente: number;
    if (p['cliente_api_id'] === null) {
      cliente = await this.tx.incluir('cliente_api', {
        codigo: `parceiro-${String(p['id'])}`.slice(0, 30),
        nome: String(p['nome']),
        identificador_cliente: clienteId,
        tipo_autenticacao: 'chave_api',
        situacao: 'ativo',
        sistema_externo_id: await this.sistemaDo(p),
        usuario_id: null,
        // A credencial vale só no estabelecimento da sessão que a emite (a rota de outro estabelecimento recusa).
        estabelecimento_id: this.est,
      });
      const relido = await this.parceiroPorCodigo(codigo, true);
      await this.tx.alterar('parceiro_dados', Number(p['id']), Number(relido?.['versao'] ?? p['versao']), {
        cliente_api_id: cliente,
      });
    } else {
      cliente = Number(p['cliente_api_id']);
      const ca = (
        await this.tx.consultarParaAtualizar(
          'SELECT id, versao, estabelecimento_id FROM cliente_api WHERE id = ?',
          [cliente],
        )
      )[0];
      if (!ca) return 0;
      if (ca['estabelecimento_id'] !== null && Number(ca['estabelecimento_id']) !== this.est)
        throw recusa('outro-estabelecimento', 'A credencial do parceiro é de outro estabelecimento.');
      // A troca também restringe ao estabelecimento a credencial antiga que valia para o cliente inteiro.
      await this.tx.alterar('cliente_api', cliente, Number(ca['versao']), {
        identificador_cliente: clienteId,
        estabelecimento_id: this.est,
      });
    }
    // A troca revoga a chave anterior (o histórico fica) e a nova começa já.
    const ativas = await this.tx.consultarParaAtualizar(
      "SELECT id, versao FROM chave_api WHERE cliente_api_id = ? AND situacao = 'ativa' AND excluido_em IS NULL",
      [cliente],
    );
    for (const k of ativas)
      await this.tx.alterar('chave_api', Number(k['id']), Number(k['versao']), {
        situacao: 'revogada',
        revogada_em: agora,
        revogada_por_usuario_id: this.tx.contexto.usuario,
        motivo_revogacao: 'Substituída por uma nova chave.',
      });
    const seq = await this.tx.uma<{ n: unknown }>(
      'SELECT COALESCE(MAX(sequencia), 0) + 1 AS n FROM chave_api WHERE cliente_api_id = ?',
      [cliente],
    );
    await this.tx.incluir('chave_api', {
      cliente_api_id: cliente,
      sequencia: inteiro(seq?.n) || 1,
      prefixo: resumo.slice(0, 16),
      hash_chave: resumo,
      algoritmo_hash: 'sha256',
      situacao: 'ativa',
      valida_desde: agora,
    });
    return 1;
  }

  async tratarMorto(id: string, t: { acao: TratamentoEnvio; motivo: string }): Promise<number> {
    if (!/^\d{1,15}$/.test(id)) return 0;
    const s = (
      await this.tx.consultarParaAtualizar(
        `SELECT id, versao, situacao, ponto_integracao_id, alterado_em FROM mensagem_integracao_saida
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [Number(id), this.est],
      )
    )[0];
    if (!s || situacaoDoEnvio(String(s['situacao'])) !== 'morto') return 0;
    const r = aplicarTratamento('morto', t.acao, t.motivo);
    const agora = new Date();
    await this.tx.alterar(
      'mensagem_integracao_saida',
      Number(s['id']),
      Number(s['versao']),
      r.situacao === 'pendente'
        ? {
            situacao: 'pendente',
            tentativas: 0,
            proxima_tentativa_em: agora,
            // Corrigir: o conteúdo é refeito no próximo envio (o resumo do anterior deixa de valer).
            ...(r.refazerConteudo ? { hash_sha256: null } : {}),
          }
        : { situacao: 'cancelada' },
    );
    const f = (
      await this.tx.consultarParaAtualizar(
        `SELECT id, versao, reprocessamentos FROM falha_integracao
          WHERE mensagem_integracao_saida_id = ? AND excluido_em IS NULL ORDER BY id DESC LIMIT 1`,
        [Number(s['id'])],
      )
    )[0];
    const tratamento = {
      situacao: TRATAMENTO_FALHA[t.acao],
      tratamento: t.motivo.slice(0, 2000),
      tratada_em: agora,
      responsavel_usuario_id: this.tx.contexto.usuario,
      ...(t.acao === 'reprocessar' ? { ultimo_reprocessamento_em: agora } : {}),
    };
    if (f)
      await this.tx.alterar('falha_integracao', Number(f['id']), Number(f['versao']), {
        ...tratamento,
        ...(t.acao === 'reprocessar' ? { reprocessamentos: inteiro(f['reprocessamentos']) + 1 } : {}),
      });
    else
      await this.tx.incluir('falha_integracao', {
        estabelecimento_id: this.est,
        ponto_integracao_id: Number(s['ponto_integracao_id']),
        mensagem_integracao_saida_id: Number(s['id']),
        etapa: 'envio',
        mensagem: 'O envio esgotou as tentativas do parceiro.',
        ocorrido_em: data(s['alterado_em']) ?? agora,
        ...tratamento,
        reprocessamentos: t.acao === 'reprocessar' ? 1 : 0,
      });
    return 1;
  }

  private async recebidaPorId(id: number): Promise<RecebidaIntegracao> {
    const x = await this.tx.uma(`${SQL_RECEBIDA} AND m.id = ?`, [this.est, id]);
    if (!x) throw new Error('Mensagem recebida sem leitura.');
    return recebidaDaLinha(x);
  }

  async registrarRecebida(r: NovaRecebida): Promise<{ recebida: RecebidaIntegracao; repetida: boolean }> {
    const p = await this.parceiroPorCodigo(r.parceiro, true);
    if (!p) throw recusa('parceiro-desconhecido', 'O parceiro da mensagem não está cadastrado.');
    if (!r.chaveS3) throw recusa('conteudo-ausente', 'A mensagem chegou sem o conteúdo guardado.');
    const { ponto, sistema } = await this.pontoDo(p, 'entrada');
    // Idempotência da entrada (regra 8): a mesma chave no mesmo ponto devolve a primeira (a trava cobre a corrida).
    const ja = (
      await this.tx.consultarParaAtualizar(
        'SELECT id FROM mensagem_integracao_entrada WHERE ponto_integracao_id = ? AND chave_idempotencia = ?',
        [ponto, r.chaveParceiro.slice(0, 150)],
      )
    )[0];
    if (ja) return { recebida: await this.recebidaPorId(Number(ja['id'])), repetida: true };
    const agora = new Date();
    const arquivo = await this.tx.incluir('arquivo', {
      estabelecimento_id: this.est,
      entidade: 'mensagem_integracao_entrada',
      finalidade: 'mensagem_integracao',
      nome_original: `${r.tipo.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 60) || 'mensagem'}.txt`,
      tipo_mime: formatoDoTipo(r.tipo) === 'fhir_json' ? 'application/fhir+json' : 'text/plain',
      tamanho_bytes: r.tamanho,
      hash_sha256: r.hash,
      chave_armazenamento: r.chaveS3,
      imutavel: true,
    });
    const id = await this.tx.incluir('mensagem_integracao_entrada', {
      estabelecimento_id: this.est,
      ponto_integracao_id: ponto,
      sistema_externo_id: sistema,
      cliente_api_id: p['cliente_api_id'],
      arquivo_id: arquivo,
      chave_idempotencia: r.chaveParceiro.slice(0, 150),
      identificador_externo: r.chaveParceiro.slice(0, 150),
      correlacao: r.hash.slice(0, 64),
      tipo_mensagem: r.tipo.slice(0, 60),
      formato: formatoDoTipo(r.tipo),
      hash_sha256: r.hash,
      tamanho_bytes: r.tamanho,
      recebida_em: agora,
      situacao: SITUACAO_ENTRADA[r.situacao],
      processada_em: r.situacao === 'processada' || r.situacao === 'recusada' ? agora : null,
      entidade: entidadeDe(r.tabelaObjeto),
      entidade_id: entidadeDe(r.tabelaObjeto) ? idDe(r.idObjeto) : null,
      mensagem_confirmacao: r.detalhe?.slice(0, 1000) ?? null,
      origem: 'integracao',
    });
    await this.tx.alterar('arquivo', arquivo, 1, { entidade_id: id });
    return { recebida: await this.recebidaPorId(id), repetida: false };
  }

  async concluirRecebida(
    id: string,
    c: {
      situacao: 'processada' | 'recusada';
      detalhe: string | null;
      tabelaObjeto: string | null;
      idObjeto: string | null;
    },
  ): Promise<number> {
    if (!/^\d{1,15}$/.test(id)) return 0;
    const x = (
      await this.tx.consultarParaAtualizar(
        `SELECT id, versao, situacao FROM mensagem_integracao_entrada
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [Number(id), this.est],
      )
    )[0];
    if (!x || x['situacao'] !== 'validada') return 0;
    await this.tx.alterar('mensagem_integracao_entrada', Number(x['id']), Number(x['versao']), {
      situacao: SITUACAO_ENTRADA[c.situacao],
      mensagem_confirmacao: c.detalhe?.slice(0, 1000) ?? null,
      entidade: entidadeDe(c.tabelaObjeto),
      entidade_id: entidadeDe(c.tabelaObjeto) ? idDe(c.idObjeto) : null,
      processada_em: new Date(),
    });
    return 1;
  }

  async registrarEnvio(n: NovoEnvio): Promise<boolean> {
    const p = await this.parceiroPorCodigo(n.parceiro, true);
    if (!p) throw recusa('parceiro-desconhecido', 'O parceiro da entrega não está cadastrado.');
    const { ponto, sistema } = await this.pontoDo(p, 'saida');
    const chave = n.chaveEvento.slice(0, 150);
    // O consumidor idempotente (regra 8): a mesma entrega (ponto do estabelecimento + evento) não cria outra.
    const ja = await this.tx.consultarParaAtualizar(
      'SELECT id FROM mensagem_integracao_saida WHERE ponto_integracao_id = ? AND chave_idempotencia = ?',
      [ponto, chave],
    );
    if (ja.length > 0) return false;
    const origem = idDe(n.idOutbox);
    const carga = origem
      ? await this.tx.uma<{ conteudo: unknown }>(
          'SELECT conteudo FROM integracao_mensagem WHERE id = ? AND estabelecimento_id = ?',
          [origem, this.est],
        )
      : null;
    await this.tx.incluir('mensagem_integracao_saida', {
      estabelecimento_id: this.est,
      ponto_integracao_id: ponto,
      sistema_externo_id: sistema,
      integracao_mensagem_id: carga ? origem : null,
      entidade: n.tabelaFato?.slice(0, 64) ?? null,
      entidade_id: idDe(n.idFato),
      chave_idempotencia: chave,
      correlacao: n.chaveOrdem.slice(0, 64),
      tipo_mensagem: n.tipoEvento.slice(0, 60),
      formato: 'json',
      conteudo: texto(carga?.conteudo) ?? JSON.stringify({ evento: n.tipoEvento, chave }),
      situacao: 'pendente',
      tentativas: 0,
      tentativas_maximas: Math.max(1, inteiro(p['limite_tentativas']) || 5),
    });
    return true;
  }

  async outbox(ev: {
    tipo: string;
    chave: string;
    carga: Readonly<Record<string, string | number | boolean | null>>;
  }) {
    const id = await gravarOutbox(this.tx, {
      estabelecimento: this.est,
      ponto: ev.tipo,
      entidade: null,
      entidadeId: null,
      chave: ev.chave,
      carga: ev.carga,
      usuario: this.tx.contexto.usuario,
      agora: new Date(),
    });
    return String(id);
  }
}

export function portaIntegracaoIndisponivel(): PortaIntegracao {
  return portaIndisponivel<PortaIntegracao>(METODOS_PORTA_INTEGRACAO);
}
