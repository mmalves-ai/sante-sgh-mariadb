// Trilha de auditoria (trilha_auditoria) e saída de integração (integracao_mensagem, o outbox): gravadas pelo
// executor no mesmo Escritor da gravação, portanto na mesma transação. Desfeita a operação, as duas somem juntas.
// A carga do evento leva só ids e códigos.
import { createHash } from 'node:crypto';
import type { Escritor, Leitor } from './transacao.js';

export const ACOES_TRILHA = [
  'inclusao',
  'alteracao',
  'exclusao',
  'consulta',
  'impressao',
  'exportacao',
  'login',
  'logout',
  'acesso_negado',
  'quebra_de_vidro',
  'operacao',
] as const;
export type AcaoTrilha = (typeof ACOES_TRILHA)[number];

export interface LinhaTrilha {
  readonly estabelecimento: number | null;
  readonly usuario: number | null;
  readonly acao: AcaoTrilha;
  /** Nome da tabela afetada. */
  readonly entidade: string;
  readonly entidadeId: number | null;
  readonly dadosAntes?: unknown;
  readonly dadosDepois?: unknown;
  readonly motivo?: string | null;
  readonly enderecoIp?: string | null;
  readonly correlacao: string | null;
  readonly ocorridoEm: Date;
}

/** JSON para as colunas JSON (Date em ISO, bigint em texto); undefined vira NULL. */
export function paraJson(v: unknown): string | null {
  if (v === undefined) return null;
  return JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x));
}

// ── cadeia de hash (SBIS-16) ────────────────────────────────────────────────────────────────────────────
// Cada estabelecimento (e o escopo 0, dos eventos sem estabelecimento) tem uma cadeia: a linha leva o hash da
// anterior (hash_anterior) e o SHA-256 do próprio conteúdo canônico mais esse elo (hash_linha). A ordem é dada pela
// cabeça da cadeia (trilha_cadeia), travada com SELECT ... FOR UPDATE na mesma transação da linha: duas
// transações concorrentes no mesmo escopo esperam uma pela outra, e a única (estabelecimento_chave, hash_anterior)
// recusa qualquer bifurcação. O dia da cadeia vem do relógio do banco (UTC_DATE) e nunca volta. Na virada do dia, o
// núcleo grava o fecho do dia anterior (trilha_auditoria_fecho) na mesma transação; `fecharDiasTrilha` fecha os dias
// sem evento seguinte. Nenhum gatilho: tudo aqui, na aplicação.

/** Hash anterior do primeiro elo de uma cadeia. */
export const HASH_GENESE = '0'.repeat(64);

/** Conteúdo canônico de uma linha da trilha, como fica gravado (textos já cortados ao tamanho da coluna). */
export interface CamposCanonicosTrilha {
  readonly estabelecimento: number | string | null;
  readonly usuario: number | string | null;
  /** 'AAAA-MM-DD HH:MM:SS.mmm' em UTC (textoDataHoraTrilha). */
  readonly ocorridoEm: string;
  readonly acao: string;
  readonly entidade: string;
  readonly entidadeId: number | string | null;
  readonly dadosAntes: string | null;
  readonly dadosDepois: string | null;
  readonly motivo: string | null;
  readonly enderecoIp: string | null;
  readonly correlacao: string | null;
  /** 'AAAA-MM-DD'. */
  readonly cadeiaDia: string;
  readonly hashAnterior: string;
}

/** Data e hora como a coluna DATETIME(3) guarda (sessão em UTC, ADR 0002). */
export function textoDataHoraTrilha(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 23);
}

const textoOuNulo = (v: unknown): string | null =>
  v === null || v === undefined ? null : typeof v === 'bigint' ? v.toString() : String(v);

/** SHA-256 (64 hex) do conteúdo canônico: versão do formato e os campos, na ordem, numa lista JSON. */
export function hashLinhaTrilha(c: CamposCanonicosTrilha): string {
  const campos = [
    'trilha.v1',
    textoOuNulo(c.estabelecimento),
    textoOuNulo(c.usuario),
    c.ocorridoEm,
    c.acao,
    c.entidade,
    textoOuNulo(c.entidadeId),
    c.dadosAntes,
    c.dadosDepois,
    c.motivo,
    c.enderecoIp,
    c.correlacao,
    c.cadeiaDia,
    c.hashAnterior,
  ];
  return createHash('sha256').update(JSON.stringify(campos), 'utf8').digest('hex');
}

interface CabecaCadeia {
  readonly estabelecimento_id: unknown;
  readonly ultimo_hash: unknown;
  readonly ultimo_trilha_auditoria_id: unknown;
  readonly dia_aberto: unknown;
  readonly primeiro_trilha_auditoria_id_dia: unknown;
  readonly hash_inicio_dia: unknown;
  readonly quantidade_dia: unknown;
  readonly hoje: unknown;
  [k: string]: unknown;
}

const SQL_CABECA = `SELECT estabelecimento_id, ultimo_hash, ultimo_trilha_auditoria_id,
       DATE_FORMAT(dia_aberto, '%Y-%m-%d') AS dia_aberto, primeiro_trilha_auditoria_id_dia, hash_inicio_dia,
       quantidade_dia, DATE_FORMAT(UTC_DATE(), '%Y-%m-%d') AS hoje
  FROM trilha_cadeia`;

/** Grava o fecho do dia aberto da cabeça (idempotente: o dia já fechado fica como está) e zera o dia aberto. */
async function fecharDiaAberto(e: Escritor, c: CabecaCadeia): Promise<boolean> {
  const n = await e.executar(
    `INSERT INTO trilha_auditoria_fecho (estabelecimento_id, dia, primeiro_trilha_auditoria_id,
       ultimo_trilha_auditoria_id, quantidade, hash_dia, hash_anterior, fechado_em, criado_em, versao)
     SELECT ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 1 FROM DUAL
      WHERE NOT EXISTS (SELECT 1 FROM trilha_auditoria_fecho WHERE estabelecimento_chave = IFNULL(?, 0) AND dia = ?)`,
    [
      c.estabelecimento_id ?? null,
      c.dia_aberto,
      c.primeiro_trilha_auditoria_id_dia,
      c.ultimo_trilha_auditoria_id,
      Number(c.quantidade_dia),
      c.ultimo_hash,
      c.hash_inicio_dia,
      c.estabelecimento_id ?? null,
      c.dia_aberto,
    ],
  );
  await e.executar(
    `UPDATE trilha_cadeia
        SET dia_aberto = NULL, primeiro_trilha_auditoria_id_dia = NULL, hash_inicio_dia = NULL, quantidade_dia = 0,
            alterado_em = UTC_TIMESTAMP(3), versao = versao + 1
      WHERE estabelecimento_chave = IFNULL(?, 0)`,
    [c.estabelecimento_id ?? null],
  );
  return n > 0;
}

/**
 * Fecha os dias da cadeia que ficaram abertos sem evento seguinte (dia anterior ao de hoje no relógio do banco).
 * Idempotente: devolve quantos fechos gravou agora. É a operação do fecho diário (agendada uma vez por dia).
 */
export async function fecharDiasTrilha(e: Escritor): Promise<number> {
  const abertas = await e.consultarParaAtualizar<CabecaCadeia>(
    `${SQL_CABECA} WHERE quantidade_dia > 0 AND dia_aberto < UTC_DATE() ORDER BY estabelecimento_chave`,
  );
  let n = 0;
  for (const c of abertas) if (await fecharDiaAberto(e, c)) n++;
  return n;
}

/** Grava uma linha da trilha, encadeada por hash na mesma transação; devolve o id dela. */
export async function gravarTrilha(e: Escritor, l: LinhaTrilha): Promise<number> {
  if (!(ACOES_TRILHA as readonly string[]).includes(l.acao)) throw new Error('Ação de trilha inválida.');
  const est = l.estabelecimento;
  // Cabeça da cadeia: criada na primeira vez; o ON DUPLICATE KEY já trava a linha existente (exclusiva).
  await e.executar(
    `INSERT INTO trilha_cadeia (estabelecimento_id, ultimo_hash, quantidade_dia, criado_em, versao)
     VALUES (?, ?, 0, UTC_TIMESTAMP(3), 1) ON DUPLICATE KEY UPDATE id = id`,
    [est, HASH_GENESE],
  );
  const [c] = await e.consultarParaAtualizar<CabecaCadeia>(
    `${SQL_CABECA} WHERE estabelecimento_chave = IFNULL(?, 0)`,
    [est],
  );
  const hoje = typeof c?.hoje === 'string' ? c.hoje : new Date().toISOString().slice(0, 10);
  const aberto = typeof c?.dia_aberto === 'string' ? c.dia_aberto : null;
  const qtd = Number(c?.quantidade_dia ?? 0);
  // O dia da cadeia nunca volta (relógio do banco atrasado não reabre um dia).
  const dia = aberto !== null && aberto > hoje ? aberto : hoje;
  if (c && qtd > 0 && aberto !== null && aberto < dia) await fecharDiaAberto(e, c);
  const novoDia = !(qtd > 0 && aberto === dia);
  const anterior = typeof c?.ultimo_hash === 'string' ? c.ultimo_hash : HASH_GENESE;
  const canon: CamposCanonicosTrilha = {
    estabelecimento: est,
    usuario: l.usuario,
    ocorridoEm: textoDataHoraTrilha(l.ocorridoEm),
    acao: l.acao,
    entidade: l.entidade.slice(0, 64),
    entidadeId: l.entidadeId,
    dadosAntes: paraJson(l.dadosAntes),
    dadosDepois: paraJson(l.dadosDepois),
    motivo: l.motivo?.slice(0, 500) ?? null,
    enderecoIp: l.enderecoIp?.slice(0, 45) ?? null,
    correlacao: l.correlacao?.slice(0, 64) ?? null,
    cadeiaDia: dia,
    hashAnterior: anterior,
  };
  const hash = hashLinhaTrilha(canon);
  const id = await e.inserir(
    'INSERT INTO trilha_auditoria (estabelecimento_id, usuario_id, ocorrido_em, acao, entidade, entidade_id, dados_antes, dados_depois, motivo, endereco_ip, correlacao, criado_em, criado_por, versao, cadeia_dia, hash_anterior, hash_linha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
    [
      est,
      l.usuario,
      l.ocorridoEm,
      l.acao,
      canon.entidade,
      l.entidadeId,
      canon.dadosAntes,
      canon.dadosDepois,
      canon.motivo,
      canon.enderecoIp,
      canon.correlacao,
      l.ocorridoEm,
      l.usuario,
      dia,
      anterior,
      hash,
    ],
  );
  await e.executar(
    novoDia
      ? `UPDATE trilha_cadeia
            SET ultimo_trilha_auditoria_id = ?, ultimo_hash = ?, dia_aberto = ?, primeiro_trilha_auditoria_id_dia = ?,
                hash_inicio_dia = ?, quantidade_dia = 1, alterado_em = UTC_TIMESTAMP(3), versao = versao + 1
          WHERE estabelecimento_chave = IFNULL(?, 0)`
      : `UPDATE trilha_cadeia
            SET ultimo_trilha_auditoria_id = ?, ultimo_hash = ?, quantidade_dia = quantidade_dia + 1,
                alterado_em = UTC_TIMESTAMP(3), versao = versao + 1
          WHERE estabelecimento_chave = IFNULL(?, 0)`,
    novoDia ? [id, hash, dia, id, anterior, est] : [id, hash, est],
  );
  return id;
}

/** A verificação da cadeia num dia: linhas do dia, se fecha, e onde quebra (id da linha, ou o motivo). */
export interface VerificacaoCadeiaDia {
  readonly dia: string;
  readonly linhas: number;
  readonly ok: boolean;
  /** Id da primeira linha que não fecha (ou da linha fora da cadeia); 'sem-fecho'; 'fecho-divergente'; 'elo-entre-dias'. */
  readonly quebraEm: string | null;
}

const MOTIVO_SEM_FECHO = 'sem-fecho';
const PAGINA_VERIFICACAO = 5000;
const MOTIVO_FECHO_DIVERGENTE = 'fecho-divergente';
/** O dia não emenda no anterior (dia sumido, fecho trocado ou cadeia recalculada) ou o seguinte não emenda nele. */
const MOTIVO_ELO_ENTRE_DIAS = 'elo-entre-dias';

/**
 * Prova a cadeia de um dia de um escopo (estabelecimento, ou null para o escopo 0): recalcula o hash de cada linha
 * em ordem, confere cada elo com o anterior, o primeiro elo com o fim do dia fechado anterior (ou a gênese), o fim
 * com o fecho do dia (ou com a cabeça, no dia ainda aberto) e, no último dia fechado, o fecho com a cabeça da cadeia.
 * Linha do escopo fora da cadeia gravada depois do encadeamento (marco em trilha_encadeamento_inicio) quebra a prova
 * e é apontada pelo id. Use dentro de uma leitura (snapshot único).
 */
export async function verificarDiaTrilha(
  l: Leitor,
  estabelecimento: number | null,
  dia: string,
): Promise<VerificacaoCadeiaDia> {
  const fora = await l.uma(
    `SELECT MIN(t.id) AS id FROM trilha_auditoria t
      WHERE t.estabelecimento_chave = IFNULL(?, 0) AND t.cadeia_dia IS NULL
        AND t.id > IFNULL((SELECT MAX(marco_sem_cadeia) FROM trilha_encadeamento_inicio), 0)`,
    [estabelecimento],
  );
  const idFora = fora ? textoOuNulo(fora['id']) : null;
  const fecho = await l.uma(
    `SELECT primeiro_trilha_auditoria_id AS primeiro, ultimo_trilha_auditoria_id AS ultimo, quantidade,
            hash_dia AS fim, hash_anterior AS inicio
       FROM trilha_auditoria_fecho WHERE estabelecimento_chave = IFNULL(?, 0) AND dia = ?`,
    [estabelecimento, dia],
  );
  const fechoAnterior = await l.uma(
    `SELECT hash_dia AS fim, ultimo_trilha_auditoria_id AS ultimo
       FROM trilha_auditoria_fecho WHERE estabelecimento_chave = IFNULL(?, 0) AND dia < ?
      ORDER BY dia DESC LIMIT 1`,
    [estabelecimento, dia],
  );
  const haFechoSeguinte = await l.uma(
    `SELECT 1 AS sim FROM trilha_auditoria_fecho WHERE estabelecimento_chave = IFNULL(?, 0) AND dia > ? LIMIT 1`,
    [estabelecimento, dia],
  );
  const cabeca = await l.uma(
    `SELECT primeiro_trilha_auditoria_id_dia AS primeiro, ultimo_trilha_auditoria_id AS ultimo,
            quantidade_dia AS quantidade, ultimo_hash AS fim, hash_inicio_dia AS inicio,
            DATE_FORMAT(dia_aberto, '%Y-%m-%d') AS dia_aberto
       FROM trilha_cadeia WHERE estabelecimento_chave = IFNULL(?, 0)`,
    [estabelecimento],
  );
  const cab = cabeca && Number(cabeca['quantidade']) > 0 && cabeca['dia_aberto'] === dia ? cabeca : null;
  const esperado = fecho ?? cab;
  let anterior = esperado ? textoOuNulo(esperado['inicio']) : null;
  let n = 0;
  let primeiro: string | null = null;
  let ultimo: string | null = null;
  let quebra: string | null = null;
  // Em páginas por id, sem guardar o dia na memória (um dia movimentado passa do teto de linhas de uma consulta).
  for (let desde = 0; ;) {
    const pagina = await l.consultar(
      `SELECT id, estabelecimento_id, usuario_id, LEFT(DATE_FORMAT(ocorrido_em, '%Y-%m-%d %H:%i:%s.%f'), 23) AS ocorrido,
              acao, entidade, entidade_id, CAST(dados_antes AS CHAR) AS antes, CAST(dados_depois AS CHAR) AS depois,
              motivo, endereco_ip, correlacao, hash_anterior, hash_linha
         FROM trilha_auditoria
        WHERE estabelecimento_chave = IFNULL(?, 0) AND cadeia_dia = ? AND id > ?
        ORDER BY id
        LIMIT ${PAGINA_VERIFICACAO}`,
      [estabelecimento, dia, desde],
    );
    for (const r of pagina) {
      n++;
      ultimo = textoOuNulo(r['id']);
      primeiro ??= ultimo;
      if (quebra !== null || !esperado) continue;
      const recalculado = hashLinhaTrilha({
        estabelecimento: textoOuNulo(r['estabelecimento_id']),
        usuario: textoOuNulo(r['usuario_id']),
        ocorridoEm: String(r['ocorrido']),
        acao: String(r['acao']),
        entidade: String(r['entidade']),
        entidadeId: textoOuNulo(r['entidade_id']),
        dadosAntes: textoOuNulo(r['antes']),
        dadosDepois: textoOuNulo(r['depois']),
        motivo: textoOuNulo(r['motivo']),
        enderecoIp: textoOuNulo(r['endereco_ip']),
        correlacao: textoOuNulo(r['correlacao']),
        cadeiaDia: dia,
        hashAnterior: textoOuNulo(r['hash_anterior']) ?? '',
      });
      if (r['hash_anterior'] !== anterior || r['hash_linha'] !== recalculado) quebra = ultimo;
      else anterior = recalculado;
    }
    if (pagina.length < PAGINA_VERIFICACAO) break;
    desde = Number(ultimo);
  }
  if (idFora !== null) return { dia, linhas: n, ok: false, quebraEm: idFora };
  if (!esperado) return { dia, linhas: n, ok: n === 0, quebraEm: n === 0 ? null : MOTIVO_SEM_FECHO };
  if (quebra !== null) return { dia, linhas: n, ok: false, quebraEm: quebra };
  // O dia emenda no fim do dia fechado anterior (ou na gênese), e começa depois do último elo dele.
  const inicioEsperado = fechoAnterior ? textoOuNulo(fechoAnterior['fim']) : HASH_GENESE;
  const emendaAntes =
    textoOuNulo(esperado['inicio']) === inicioEsperado &&
    (!fechoAnterior || Number(esperado['primeiro']) > Number(fechoAnterior['ultimo']));
  // O último dia fechado emenda na cabeça: no início do dia aberto seguinte, ou no último elo da cadeia.
  let emendaDepois = true;
  if (fecho && !haFechoSeguinte) {
    const seguinte = cabeca
      ? textoOuNulo(Number(cabeca['quantidade']) > 0 ? cabeca['inicio'] : cabeca['fim'])
      : null;
    emendaDepois = seguinte === textoOuNulo(fecho['fim']);
  }
  if (!emendaAntes || !emendaDepois) return { dia, linhas: n, ok: false, quebraEm: MOTIVO_ELO_ENTRE_DIAS };
  const confere =
    n === Number(esperado['quantidade']) &&
    anterior === textoOuNulo(esperado['fim']) &&
    primeiro === textoOuNulo(esperado['primeiro']) &&
    ultimo === textoOuNulo(esperado['ultimo']);
  return { dia, linhas: n, ok: confere, quebraEm: confere ? null : MOTIVO_FECHO_DIVERGENTE };
}

export type CargaEvento = Readonly<Record<string, number | string | boolean | null>>;

export interface MensagemSaida {
  readonly estabelecimento: number | null;
  /** Ponto de integração (o tipo do evento). */
  readonly ponto: string;
  readonly entidade: string | null;
  readonly entidadeId: number | null;
  /** Chave única do evento (vai em referencia_externa; o relay a usa para não enviar duas vezes). */
  readonly chave: string;
  readonly carga: CargaEvento;
  readonly usuario: number | null;
  readonly agora: Date;
}

/** Chave do evento (64 hex): cliente, operação, chave de idempotência e posição. */
export function chaveDoEvento(
  cliente: string,
  operacao: string,
  chaveIdempotencia: string,
  i: number,
): string {
  return createHash('sha256')
    .update(`${cliente}\u0000${operacao}\u0000${chaveIdempotencia}\u0000${i}`, 'utf8')
    .digest('hex');
}

export const FORMATO_PONTO = /^[a-z][a-z0-9_.]{0,79}$/;

/** Grava a mensagem de saída pendente (outbox); devolve o id. O envio é do relay, depois do COMMIT. */
export async function gravarOutbox(e: Escritor, m: MensagemSaida): Promise<number> {
  if (!FORMATO_PONTO.test(m.ponto)) throw new Error('Ponto de integração inválido.');
  return e.inserir(
    "INSERT INTO integracao_mensagem (estabelecimento_id, ponto, direcao, situacao, tentativas, entidade, entidade_id, referencia_externa, conteudo, criado_em, criado_por, versao) VALUES (?, ?, 'saida', 'pendente', 0, ?, ?, ?, ?, ?, ?, 1)",
    [
      m.estabelecimento,
      m.ponto,
      m.entidade?.slice(0, 64) ?? null,
      m.entidadeId,
      m.chave.slice(0, 120),
      paraJson(m.carga),
      m.agora,
      m.usuario,
    ],
  );
}
