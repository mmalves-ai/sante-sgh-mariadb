// Gravação e leitura das tabelas SGH_ técnicas do executor (ficha do M04, campo 6): SGH_TRILHA (só
// inclusão, cadeia de hash por estabelecimento), SGH_OUTBOX (evento na mesma transação; o relay publica),
// SGH_IDEMPOTENCIA (resultado da primeira execução) e SGH_CFG_LIBERACAO (chaves de liberação). Nada de
// dado pessoal: IDs, códigos, TBUSERS.NOME de quem operou e hashes.
import { createHash } from 'node:crypto';
import type { Linha } from '../driver.js';
import { CONFIGURACAO_PADRAO, TETO_ELO_TRILHA_DEV_MS } from '../configuracao.js';
import { ehTravaOcupada, ErroOperacao, restricaoUnicaViolada } from '../erros-operacao.js';
import { marcaComoAtual, origemSuporte } from '../como.js';
import { ErroCancelamentoPendente, ErroEsperaCurta, type Escritor, type Leitor } from '../transacao.js';

export const HASH_INICIAL = '0'.repeat(64);

// ── SGH_TRILHA ───────────────────────────────────────────────────────────────────────────────────

export interface LinhaTrilha {
  readonly rede: string;
  readonly hospital: string;
  readonly usuario: string;
  readonly evento: string;
  readonly recurso: string;
  readonly operacao: string;
  readonly tabelaAlvo: string | null;
  readonly idAlvo: string | null;
  readonly chaveNaturalAlvo: string | null;
  readonly resultado: string;
  readonly estacao: string | null;
  readonly correlacao: string;
  // M06 (0008_trilha_cadeia.sql): origem, objeto pelo ID do legado, ligação com a trilha do legado e
  // diferença (só nomes de coluna e identificadores; nunca texto clínico nem nome, SBIS-18).
  readonly origem?: string | null;
  readonly idPaciente?: number | null;
  readonly atendimento?: number | null;
  readonly idTrilhaLegado?: string | null;
  readonly diferenca?: string | null;
}

/** Campos do M06 na ordem do hash; o dia da cadeia vem do relógio do banco. */
function extrasDoHash(l: LinhaTrilha, dia: string | null): string[] | null {
  const extras = [
    l.origem ?? null,
    l.idPaciente === null || l.idPaciente === undefined ? null : String(l.idPaciente),
    l.atendimento === null || l.atendimento === undefined ? null : String(l.atendimento),
    l.idTrilhaLegado ?? null,
    l.diferenca ?? null,
    dia,
  ];
  // Linha do M04 (sem nenhum campo novo): o hash é o mesmo de antes do 0008.
  return extras.every((x) => x === null || x === '') ? null : extras.map((x) => x ?? '');
}

/**
 * Hash da linha: SHA-256 dos campos, na ordem, com o hash anterior (a cadeia). `dia`: o dia da cadeia
 * (DIA, do relógio do banco; M06).
 */
export function hashTrilha(
  id: string,
  dataHora: string,
  l: LinhaTrilha,
  anterior: string,
  dia: string | null = null,
): string {
  const campos = [
    id,
    dataHora.trim(),
    l.rede,
    l.hospital,
    l.usuario,
    l.evento,
    l.recurso,
    l.operacao,
    l.tabelaAlvo ?? '',
    l.idAlvo ?? '',
    l.chaveNaturalAlvo ?? '',
    l.resultado,
    l.estacao ?? '',
    l.correlacao,
    ...(extrasDoHash(l, dia) ?? []),
    anterior,
  ];
  return createHash('sha256').update(JSON.stringify(campos), 'utf8').digest('hex');
}

/**
 * Teto de tentativas de encadear quando o elo é TOMADO (outra transação confirmou o elo seguinte: única violada ou
 * LOCK TIMEOUT). A espera curta cancelada (o elo ainda está preso) não conta aqui: só o teto de tempo
 * (configuracao.ts: FB_TRILHA_ELO_TETO_MS) a limita, com a espera dobrando a cada tentativa.
 */
export const TENTATIVAS_ELO = 5;

/** A trilha não pôde ser gravada no teto: a ação não acontece (SBIS: nada auditável sem trilha). Mesmo 503 da API. */
export function erroTrilhaIndisponivel(): ErroOperacao {
  return new ErroOperacao(
    503,
    'trilha-indisponivel',
    'Trilha de auditoria indisponível',
    'Outra gravação está encadeando a trilha neste estabelecimento; nada foi gravado. Tente de novo em instantes.',
  );
}

/**
 * Inclui a linha na trilha, encadeada à última linha confirmada do estabelecimento. A unicidade de
 * (HOSPITAL, HASH_ANTERIOR) faz uma inclusão simultânea sobre o mesmo elo esperar e falhar; o comando falho
 * é desfeito sozinho e a inclusão é refeita sobre o novo último elo.
 *
 * Espera curta e limitada (18/11/2026): cada inclusão espera a trava no máximo `esperaMs` (cancelada só neste
 * comando; o LOCK TIMEOUT do resto da transação não muda) e o refazer do encadeamento só acontece dentro de
 * `tetoMs`. Estourou: erro 503 "trilha-indisponivel" na hora, sem prender a conexão por LOCK TIMEOUT x tentativas.
 * Sem elo duplicado: a única SGH_UQ_TRILHA_ELO continua sendo quem decide; nenhum elo é gravado fora dela.
 */
export async function gravarTrilha(e: Escritor, linha: LinhaTrilha): Promise<{ id: string; hash: string }> {
  // Sessão "como" (ADR 0021): o USUARIO é o alvo (como na TBCABTRILHA), e a ORIGEM leva o ator real (tipo,
  // conta e sessão; sem nome, e-mail nem IP). Vale para toda linha gravada na requisição "como".
  const marca = marcaComoAtual();
  const l: LinhaTrilha = marca ? { ...linha, origem: origemSuporte(marca) } : linha;
  const esperaMs = e.esperaCurta?.esperaMs ?? CONFIGURACAO_PADRAO.esperaEloTrilhaMs;
  // Sem espera curta (dublês, CRUD em memória): o teto curto do dev, nunca o de produção.
  const tetoMs = e.esperaCurta?.tetoMs ?? TETO_ELO_TRILHA_DEV_MS;
  const inicio = Date.now();
  let tomadas = 0;
  let espera = esperaMs;
  for (;;) {
    const restante = tetoMs - (Date.now() - inicio);
    if (restante <= 0) throw erroTrilhaIndisponivel();
    const [ultima] = await e.consultar(
      'SELECT FIRST 1 HASH_LINHA FROM SGH_TRILHA WHERE HOSPITAL = ? ORDER BY HOSPITAL DESC, ID DESC',
      [l.hospital],
      { teto: 1 },
    );
    const anterior = String(ultima?.['HASH_LINHA'] ?? HASH_INICIAL).trim();
    const [g] = await e.consultar(
      'SELECT CAST(NEXT VALUE FOR SGH_GEN_TRILHA AS VARCHAR(20)) ID, CAST(LOCALTIMESTAMP AS VARCHAR(24)) H, CAST(CAST(CURRENT_TIMESTAMP AS DATE) AS VARCHAR(10)) D FROM RDB$DATABASE',
      [],
      { teto: 1 },
    );
    const id = String(g?.['ID'] ?? '');
    const dataHora = String(g?.['H'] ?? '').trim();
    const dia = g?.['D'] === undefined || g['D'] === null ? null : String(g['D']).trim();
    const hash = hashTrilha(id, dataHora, l, anterior, dia);
    const m06 = dia !== null;
    try {
      const sql = `INSERT INTO SGH_TRILHA (ID, DATA_HORA, REDE, HOSPITAL, USUARIO, EVENTO, RECURSO, OPERACAO, TABELA_ALVO,
           ID_ALVO, CHAVE_NATURAL_ALVO, RESULTADO, ESTACAO, CORRELACAO,${m06 ? ' ORIGEM, ID_RICADPAC, REG, ID_TBCABTRILHA, DIFERENCA, DIA,' : ''} HASH_ANTERIOR, HASH_LINHA)
         VALUES (CAST(CAST(? AS VARCHAR(20)) AS BIGINT), CAST(CAST(? AS VARCHAR(24)) AS TIMESTAMP), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,${m06 ? ' ?, ?, ?, CAST(CAST(? AS VARCHAR(20)) AS BIGINT), ?, CAST(CAST(? AS VARCHAR(10)) AS DATE),' : ''} ?, ?)`;
      const parametros = [
        id,
        dataHora,
        l.rede,
        l.hospital,
        l.usuario,
        l.evento,
        l.recurso,
        l.operacao,
        l.tabelaAlvo,
        l.idAlvo,
        l.chaveNaturalAlvo,
        l.resultado,
        l.estacao,
        l.correlacao,
        ...(m06
          ? [
              l.origem ?? null,
              l.idPaciente ?? null,
              l.atendimento ?? null,
              l.idTrilhaLegado ?? null,
              l.diferenca ?? null,
              dia,
            ]
          : []),
        anterior,
        hash,
      ];
      // Espera curta: começa em `esperaMs` e dobra a cada cancelamento (um INSERT só lento, sem disputa, ganha
      // tempo), nunca além do que sobra do teto (piso de 100 ms para o comando).
      const ms = Math.max(100, Math.min(espera, restante));
      if (e.esperaCurta) await e.esperaCurta.executar(sql, parametros, ms);
      else await e.executar(sql, parametros);
      return { id, hash };
    } catch (erro) {
      // Cancelamento que não deu para consumir: a transação não recebe outro comando (nem o SELECT da nova
      // tentativa). A ação é recusada com o 503 e tudo é desfeito: nenhuma ação sem trilha, nenhum elo órfão.
      if (erro instanceof ErroCancelamentoPendente) throw erroTrilhaIndisponivel();
      // Elo ainda preso (espera curta cancelada) ou tomado (o outro confirmou: única ou LOCK TIMEOUT): refaz no teto.
      const preso = erro instanceof ErroEsperaCurta;
      const tomado = restricaoUnicaViolada(erro) === 'SGH_UQ_TRILHA_ELO' || ehTravaOcupada(erro);
      if (!preso && !tomado) throw erro;
      if (preso) espera *= 2;
      else tomadas++;
      if (tomadas >= TENTATIVAS_ELO || Date.now() - inicio >= tetoMs) throw erroTrilhaIndisponivel();
    }
  }
}

export interface VerificacaoCadeia {
  readonly linhas: number;
  readonly ok: boolean;
  /** ID da primeira linha que não fecha (hash recalculado ou elo anterior diferente). */
  readonly quebraEm: string | null;
}

export interface OpcoesVerificacao {
  /** Só o trecho do dia (AAAA-MM-DD; verificação diária, M06). */
  readonly dia?: string;
  /** Hash do último elo do dia anterior (o primeiro elo do dia tem de apontar para ele). */
  readonly eloInicial?: string;
  /** false: banco sem o 0008 (colunas do M06 ausentes). */
  readonly m06?: boolean;
}

/**
 * Percorre a trilha do estabelecimento em ordem de ID, recalculando cada hash e conferindo cada elo. Com
 * `dia`, só o trecho daquele dia (o primeiro elo confere com `eloInicial`, quando informado).
 */
export async function verificarCadeia(
  l: Leitor,
  hospital: string,
  lote = 1_000,
  opcoes: OpcoesVerificacao = {},
): Promise<VerificacaoCadeia> {
  let anterior = HASH_INICIAL;
  let ultimoId = '-1';
  let linhas = 0;
  for (;;) {
    const pagina: Linha[] = await l.consultar(
      `SELECT FIRST ${lote} CAST(ID AS VARCHAR(20)) ID, CAST(DATA_HORA AS VARCHAR(24)) H, REDE, HOSPITAL, USUARIO,
              EVENTO, RECURSO, OPERACAO, TABELA_ALVO, ID_ALVO, CHAVE_NATURAL_ALVO, RESULTADO, ESTACAO, CORRELACAO,
              ${opcoes.m06 === false ? '' : 'ORIGEM, CAST(ID_RICADPAC AS VARCHAR(20)) ID_RICADPAC, CAST(REG AS VARCHAR(20)) REG, CAST(ID_TBCABTRILHA AS VARCHAR(20)) ID_TBCABTRILHA, DIFERENCA, CAST(DIA AS VARCHAR(10)) DIA,'}
              HASH_ANTERIOR, HASH_LINHA
         FROM SGH_TRILHA WHERE HOSPITAL = ? AND ID > CAST(? AS BIGINT)${opcoes.dia ? ' AND DIA = CAST(CAST(? AS VARCHAR(10)) AS DATE)' : ''} ORDER BY ID`,
      opcoes.dia ? [hospital, ultimoId, opcoes.dia] : [hospital, ultimoId],
      { teto: lote },
    );
    for (const r of pagina) {
      const txt = (k: string) => (r[k] === null || r[k] === undefined ? null : String(r[k]).trim());
      const id = String(r['ID']);
      const linha: LinhaTrilha = {
        rede: txt('REDE') ?? '',
        hospital: txt('HOSPITAL') ?? '',
        usuario: txt('USUARIO') ?? '',
        evento: txt('EVENTO') ?? '',
        recurso: txt('RECURSO') ?? '',
        operacao: txt('OPERACAO') ?? '',
        tabelaAlvo: txt('TABELA_ALVO'),
        idAlvo: txt('ID_ALVO'),
        chaveNaturalAlvo: txt('CHAVE_NATURAL_ALVO'),
        resultado: txt('RESULTADO') ?? '',
        estacao: txt('ESTACAO'),
        correlacao: txt('CORRELACAO') ?? '',
        origem: txt('ORIGEM'),
        idPaciente: txt('ID_RICADPAC') === null ? null : Number(txt('ID_RICADPAC')),
        atendimento: txt('REG') === null ? null : Number(txt('REG')),
        idTrilhaLegado: txt('ID_TBCABTRILHA'),
        diferenca: txt('DIFERENCA'),
      };
      const elo = txt('HASH_ANTERIOR') ?? '';
      const hash = txt('HASH_LINHA') ?? '';
      // Verificação do dia: o primeiro elo do dia aponta para o último do dia anterior (lido à parte).
      if (linhas === 0 && opcoes.dia) anterior = elo === '' ? anterior : (opcoes.eloInicial ?? elo);
      if (elo !== anterior || hashTrilha(id, String(r['H'] ?? ''), linha, elo, txt('DIA')) !== hash) {
        return { linhas, ok: false, quebraEm: id };
      }
      anterior = hash;
      ultimoId = id;
      linhas++;
    }
    if (pagina.length < lote) return { linhas, ok: true, quebraEm: null };
  }
}

// ── SGH_OUTBOX ───────────────────────────────────────────────────────────────────────────────────

const CODIGO_CARGA = /^[A-Za-z0-9._:-]{1,64}$/;

/** Carga do evento: só IDs (números) e códigos curtos (nunca nome, documento ou texto clínico). */
export function conferirCarga(carga: Readonly<Record<string, unknown>>): string {
  for (const [k, v] of Object.entries(carga)) {
    if (!/^[a-z][A-Za-z0-9]{0,40}$/.test(k)) throw new Error('Carga do evento com chave inválida.');
    if (typeof v === 'number' && Number.isFinite(v)) continue;
    if (typeof v === 'string' && CODIGO_CARGA.test(v)) continue;
    throw new Error(`Carga do evento: "${k}" tem de ser ID ou código.`);
  }
  const json = JSON.stringify(carga);
  if (json.length > 2000) throw new Error('Carga do evento grande demais.');
  return json;
}

export interface EventoOutbox {
  readonly rede: string;
  readonly hospital: string;
  readonly tipo: string;
  readonly chave: string;
  readonly carga: Readonly<Record<string, number | string>>;
}

/**
 * Chave do evento (única em SGH_OUTBOX e jobId no BullMQ): SHA-256 em 64 hexadecimais da chave composta, de
 * tamanho fixo (cortar a composta em 120 colidia com nomes de operação longos e chaves de 80).
 */
export function chaveEvento(composta: string): string {
  return createHash('sha256').update(composta, 'utf8').digest('hex');
}

export async function gravarOutbox(e: Escritor, ev: EventoOutbox): Promise<string> {
  const carga = conferirCarga(ev.carga);
  const linha = await e.executarRetornando(
    `INSERT INTO SGH_OUTBOX (ID, REDE, HOSPITAL, TIPO, CHAVE_EVENTO, CARGA)
     VALUES (NEXT VALUE FOR SGH_GEN_OUTBOX, ?, ?, ?, ?, ?) RETURNING CAST(ID AS VARCHAR(20)) ID`,
    [ev.rede, ev.hospital, ev.tipo, chaveEvento(ev.chave), carga],
  );
  return String(linha['ID'] ?? '');
}

export interface PendenteOutbox {
  readonly id: string;
  readonly rede: string;
  readonly hospital: string;
  readonly tipo: string;
  readonly chave: string;
  readonly carga: Record<string, number | string>;
  readonly tentativas: number;
}

/**
 * Pendentes do estabelecimento, em ordem de ID, até o primeiro que ainda espera a próxima tentativa (exclusive).
 * A ordem por ID vale entre ciclos: se o menor pendente está em espera, nada sai naquele ciclo (os seguintes
 * não passam na frente dele).
 */
export async function lerPendentesOutbox(l: Leitor, hospital: string, lote = 100): Promise<PendenteOutbox[]> {
  const linhas = await l.consultar(
    `SELECT FIRST ${Math.max(1, Math.min(lote, 1000))} CAST(ID AS VARCHAR(20)) ID, REDE, HOSPITAL, TIPO, CHAVE_EVENTO,
            CARGA, TENTATIVAS,
            CASE WHEN PROXIMA_TENTATIVA_EM > CURRENT_TIMESTAMP THEN 1 ELSE 0 END EM_ESPERA
       FROM SGH_OUTBOX
      WHERE SITUACAO = 'pendente' AND HOSPITAL = ?
      ORDER BY SITUACAO, HOSPITAL, ID`,
    [hospital],
    { teto: 1000 },
  );
  const espera = linhas.findIndex((r) => Number(r['EM_ESPERA'] ?? 0) === 1);
  return (espera < 0 ? linhas : linhas.slice(0, espera)).map((r) => ({
    id: String(r['ID']),
    rede: String(r['REDE'] ?? '').trim(),
    hospital: String(r['HOSPITAL'] ?? '').trim(),
    tipo: String(r['TIPO'] ?? '').trim(),
    chave: String(r['CHAVE_EVENTO'] ?? '').trim(),
    carga: JSON.parse(String(r['CARGA'] ?? '{}')) as Record<string, number | string>,
    tentativas: Number(r['TENTATIVAS'] ?? 0),
  }));
}

/**
 * Dados do job publicado pelo relay: a carga do evento mais o estabelecimento e a rede da linha da outbox
 * (estes prevalecem sobre a carga).
 */
export function dadosDoJobOutbox(ev: PendenteOutbox): Record<string, number | string> {
  return { ...ev.carga, hospital: ev.hospital, rede: ev.rede };
}

export async function marcarPublicado(e: Escritor, id: string): Promise<number> {
  return e.executar(
    `UPDATE SGH_OUTBOX SET SITUACAO = 'publicado', PUBLICADO_EM = CURRENT_TIMESTAMP, ULTIMO_ERRO = NULL
      WHERE ID = CAST(? AS BIGINT) AND SITUACAO = 'pendente'`,
    [id],
  );
}

/** Falha: nova tentativa com espera crescente; esgotadas, `morto`. */
export async function marcarFalha(
  e: Escritor,
  id: string,
  tentativas: number,
  maximo: number,
  esperaSegundos: number,
  erro: string,
): Promise<'pendente' | 'morto'> {
  const situacao = tentativas + 1 >= maximo ? 'morto' : 'pendente';
  await e.executar(
    `UPDATE SGH_OUTBOX SET TENTATIVAS = TENTATIVAS + 1, SITUACAO = ?, ULTIMO_ERRO = ?,
            PROXIMA_TENTATIVA_EM = DATEADD(? SECOND TO CURRENT_TIMESTAMP)
      WHERE ID = CAST(? AS BIGINT) AND SITUACAO = 'pendente'`,
    [situacao, erro.slice(0, 200), esperaSegundos, id],
  );
  return situacao;
}

// ── SGH_IDEMPOTENCIA ─────────────────────────────────────────────────────────────────────────────

export interface RegistroIdempotencia {
  readonly hashEntrada: string;
  readonly resultado: Record<string, number | string | boolean | null>;
  /** TBUSERS.NOME de quem gravou (a repetição só devolve o resultado à mesma pessoa). */
  readonly usuario: string | null;
}

export async function lerIdempotencia(
  l: Leitor,
  chave: string,
  operacao: string,
  hospital: string,
): Promise<RegistroIdempotencia | null> {
  const [r] = await l.consultar(
    'SELECT HASH_ENTRADA, RESULTADO, USUARIO FROM SGH_IDEMPOTENCIA WHERE CHAVE = ? AND OPERACAO = ? AND HOSPITAL = ?',
    [chave, operacao, hospital],
    { teto: 1 },
  );
  if (!r) return null;
  return {
    hashEntrada: String(r['HASH_ENTRADA'] ?? '').trim(),
    resultado: JSON.parse(String(r['RESULTADO'] ?? '{}')) as RegistroIdempotencia['resultado'],
    usuario: r['USUARIO'] === null || r['USUARIO'] === undefined ? null : String(r['USUARIO']).trimEnd(),
  };
}

export async function gravarIdempotencia(
  e: Escritor,
  r: {
    chave: string;
    operacao: string;
    hospital: string;
    hashEntrada: string;
    resultado: string;
    usuario: string;
  },
): Promise<void> {
  await e.executar(
    `INSERT INTO SGH_IDEMPOTENCIA (CHAVE, OPERACAO, HOSPITAL, HASH_ENTRADA, RESULTADO, USUARIO)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [r.chave, r.operacao, r.hospital, r.hashEntrada, r.resultado, r.usuario],
  );
}

/** Expurgo das chaves vencidas (dias configuráveis). */
export async function expurgarIdempotencia(e: Escritor, dias: number): Promise<number> {
  if (!Number.isInteger(dias) || dias < 1) throw new Error('Dias de expurgo inválidos.');
  return e.executar('DELETE FROM SGH_IDEMPOTENCIA WHERE CRIADO_EM < DATEADD(? DAY TO CURRENT_TIMESTAMP)', [
    -dias,
  ]);
}

// ── SGH_CFG_LIBERACAO ────────────────────────────────────────────────────────────────────────────

export interface ChaveLiberacao {
  /** M08: `grupo` (TBGRUUSU.NOME), liberação por grupo da DP-4. */
  readonly escopo: 'hospital' | 'setor' | 'grupo' | 'pessoa';
  readonly valor: string;
  readonly ligada: boolean;
}

export async function lerLiberacoes(
  l: Leitor,
  hospital: string,
  operacao: string,
): Promise<ChaveLiberacao[]> {
  const linhas = await l.consultar(
    // Só chave de OPERAÇÃO (recurso desligado é outra coisa, M08) e só a que decide (LIGADA nula herda, 0016).
    "SELECT ESCOPO, VALOR, LIGADA FROM SGH_CFG_LIBERACAO WHERE HOSPITAL = ? AND OPERACAO = ? AND TIPO = 'operacao' AND LIGADA IS NOT NULL",
    [hospital, operacao],
    { teto: 5_000 },
  );
  return linhas.map((r) => ({
    escopo: String(r['ESCOPO']).trim() as ChaveLiberacao['escopo'],
    valor: String(r['VALOR'] ?? '').trim(),
    ligada: r['LIGADA'] === true || r['LIGADA'] === 1,
  }));
}

/**
 * A chave libera a pessoa? Ligada no estabelecimento inteiro ('*'), no setor da sessão ou para a pessoa
 * (TBUSERS.NOME exato). Chave do estabelecimento desligada recusa sempre (recolher); fora isso, a chave
 * desligada da pessoa ou do setor prevalece sobre a ligada mais ampla.
 */
export function liberacaoPermite(
  chaves: readonly ChaveLiberacao[],
  pessoa: string,
  setor: string | undefined,
  grupo?: string,
): boolean {
  const da = (escopo: ChaveLiberacao['escopo'], valor: string | undefined) =>
    valor === undefined ? undefined : chaves.find((c) => c.escopo === escopo && c.valor === valor);
  const doEstabelecimento = da('hospital', '*');
  // Recolher é desligar a chave do estabelecimento (ficha do M04, seção 12): desligada, recusa sempre.
  if (doEstabelecimento && !doEstabelecimento.ligada) return false;
  // A mais específica vence: pessoa, grupo (M08, DP-4), setor, estabelecimento (mesma regra de
  // @sgh/dominio-config, liberacao/lote.ts, chaveLibera).
  for (const c of [da('pessoa', pessoa), da('grupo', grupo), da('setor', setor), doEstabelecimento]) {
    if (c) return c.ligada;
  }
  return false;
}
