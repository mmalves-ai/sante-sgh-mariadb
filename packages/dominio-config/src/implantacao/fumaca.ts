// M60, etapa 3: regras puras da fumaça do servidor (ficha do M60, M60-F3): o relógio do servidor contra o do banco
// (descontado o fuso do servidor do banco), o fuso do processo, o Valkey, o worker e as filas, a impressão digital
// da parte legada e as chaves de liberação no estado esperado. Sem E/S: a API lê e estas funções julgam.
import {
  type ChaveLigada,
  type ChavesConferidas,
  DERIVA_ALERTA_MS,
  DERIVA_MAXIMA_MS,
  type FilaConferida,
  FUSO_DO_SERVIDOR,
  type HoraConfiavel,
  type ImpressaoConferida,
  type ItemFumaca,
  type ItemFumacaServidor,
  type RelogioConferido,
  type SituacaoItemConferencia,
  type ValkeyConferido,
} from '@sgh/contratos';
import { itemHoraConfiavel } from './hora-confiavel.js';

/** Fila com mais trabalhos à espera do que isto: alerta (o worker não está dando conta ou parou de consumir). */
export const TETO_AGUARDANDO_FILA = 100;

const QUINZE_MIN_MS = 15 * 60_000;
/** Fusos civis existentes: de UTC-12 a UTC+14. */
const FUSO_MIN = -12 * 60;
const FUSO_MAX = 14 * 60;

/** Em produção o que é só alerta nos outros ambientes vira falha. */
const grave = (ambiente: string): SituacaoItemConferencia => (ambiente === 'producao' ? 'falha' : 'alerta');

const item = (
  codigo: ItemFumacaServidor,
  titulo: string,
  situacao: SituacaoItemConferencia,
  detalhe: string,
): ItemFumaca => ({ codigo, titulo, situacao, detalhe });

/** Hora de parede AAAA-MM-DDTHH:mm:ss(.sss) sem fuso, lida como se fosse UTC (ms); NaN se inválida. */
export function horaDeParedeMs(texto: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(texto.trim());
  if (!m) return Number.NaN;
  const [, a, mes, d, h, mi, s, f] = m;
  const ms = Date.UTC(
    Number(a),
    Number(mes) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
    Number((f ?? '0').padEnd(3, '0')),
  );
  return ms;
}

/** Formata um instante como hora de parede sem fuso, pelos campos UTC (o espelho de horaDeParedeMs). */
export function formatarHoraDeParede(ms: number): string {
  return new Date(ms).toISOString().slice(0, 23);
}

/**
 * O relógio do servidor contra o do banco. O Firebird 3 devolve a hora de parede do servidor do banco, sem fuso: a
 * diferença bruta é o fuso daquele servidor (múltiplo de 15 min) mais a deriva entre os relógios. Fuso fora de
 * UTC-12..UTC+14 não é fuso: a deriva é a diferença inteira (o relógio de um dos lados está errado).
 */
export function compararRelogios(
  servidorMs: number,
  bancoLocal: string | null,
  fuso: string,
): RelogioConferido {
  const servidorEm = new Date(servidorMs).toISOString();
  const banco = bancoLocal === null ? Number.NaN : horaDeParedeMs(bancoLocal);
  if (Number.isNaN(banco)) return { servidorEm, fuso, bancoLocal: null, fusoBancoMin: null, derivaMs: null };
  const bruta = banco - servidorMs;
  const fusoMin = Math.round(bruta / QUINZE_MIN_MS) * 15;
  if (fusoMin < FUSO_MIN || fusoMin > FUSO_MAX)
    return { servidorEm, fuso, bancoLocal, fusoBancoMin: null, derivaMs: Math.round(bruta) };
  return {
    servidorEm,
    fuso,
    bancoLocal,
    fusoBancoMin: fusoMin === 0 ? 0 : fusoMin,
    derivaMs: Math.round(bruta - fusoMin * 60_000),
  };
}

/** O fuso como UTC±HH:MM. */
export function rotuloFuso(min: number): string {
  const s = min < 0 ? '-' : '+';
  const a = Math.abs(min);
  return `UTC${s}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** UTC e Etc/UTC (e os sinônimos do tzdata) contam como o fuso exigido. */
export function fusoEhUtc(fuso: string): boolean {
  return [
    'UTC',
    'ETC/UTC',
    'ETC/UCT',
    'UCT',
    'ETC/ZULU',
    'ZULU',
    'ETC/GMT',
    'GMT',
    'ETC/UNIVERSAL',
    'UNIVERSAL',
  ].includes(fuso.trim().toUpperCase());
}

/**
 * As chaves esperadas de IMPLANTACAO_CHAVES_ESPERADAS: códigos separados por vírgula; `prefixo.*` vale para todas as
 * chaves do prefixo. M61 (liberação full na instalação, ADR 0034): `todas` aceita qualquer chave ligada e
 * `todas-exceto:<a>,<b>` aceita qualquer uma menos as listadas (lidas como `*` e `!<a>`, `!<b>`). Vazio: nenhuma chave
 * ligada (quem lê o ambiente aplica o padrão da instalação antes; `nenhuma` é o vazio explícito).
 */
export function lerChavesEsperadas(texto: string | undefined | null): string[] {
  const t = (texto ?? '').trim();
  if (t === 'nenhuma') return [];
  const todas = t === 'todas' || t.startsWith('todas-exceto:');
  const lista = (t.startsWith('todas-exceto:') ? t.slice('todas-exceto:'.length) : todas ? '' : t)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  for (const c of lista)
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*(?:\.\*)?$/i.test(c))
      throw new Error(`IMPLANTACAO_CHAVES_ESPERADAS: código inválido (${c.slice(0, 40)}).`);
  return todas ? ['*', ...new Set(lista.map((c) => `!${c}`))] : [...new Set(lista)];
}

const casa = (chave: string, esperada: string): boolean =>
  esperada.endsWith('.*') ? chave.startsWith(esperada.slice(0, -1)) : chave === esperada;

/** A chave ligada está na lista esperada (`*` com as exceções `!x`, ou os códigos e prefixos)? */
export function chaveEsperada(chave: string, esperadas: readonly string[]): boolean {
  if (esperadas.includes('*')) return !esperadas.some((e) => e.startsWith('!') && casa(chave, e.slice(1)));
  return esperadas.some((e) => casa(chave, e));
}

export interface LinhaChave {
  readonly tipo: 'operacao' | 'recurso';
  readonly chave: string;
  readonly escopo: string;
  readonly ligada: boolean | null;
}

/** As linhas ligadas agrupadas por chave, só com contagens por escopo (o valor do escopo nunca sai). */
export function contarChavesLigadas(linhas: readonly LinhaChave[]): ChaveLigada[] {
  const mapa = new Map<string, ChaveLigada>();
  for (const l of linhas) {
    if (l.ligada !== true) continue;
    const k = `${l.tipo}\u0000${l.chave}`;
    const atual = mapa.get(k) ?? { tipo: l.tipo, chave: l.chave, hospital: 0, setor: 0, grupo: 0, pessoa: 0 };
    const escopo =
      l.escopo === 'setor' || l.escopo === 'grupo' || l.escopo === 'pessoa' ? l.escopo : 'hospital';
    mapa.set(k, { ...atual, [escopo]: atual[escopo] + 1 });
  }
  return [...mapa.values()].sort((a, b) => a.tipo.localeCompare(b.tipo) || a.chave.localeCompare(b.chave));
}

export function conferirChaves(
  linhas: readonly LinhaChave[] | null,
  esperadas: readonly string[],
): ChavesConferidas {
  if (linhas === null) return { lidas: false, ligadas: [], esperadas: [...esperadas], inesperadas: [] };
  const ligadas = contarChavesLigadas(linhas);
  const inesperadas = ligadas
    .filter((c) => !chaveEsperada(c.chave, esperadas))
    .map((c) => `${c.tipo}:${c.chave}`);
  return { lidas: true, ligadas, esperadas: [...esperadas], inesperadas };
}

export interface EntradaFumacaServidor {
  readonly ambiente: string;
  readonly relogio: RelogioConferido;
  /** W0-09 (M2): a hora confiável contra o NTP (opcional: sem ela, o item não aparece). */
  readonly horaConfiavel?: HoraConfiavel;
  readonly valkey: ValkeyConferido;
  readonly filas: readonly FilaConferida[];
  readonly impressao: ImpressaoConferida;
  readonly chaves: ChavesConferidas;
}

function itemFuso(e: EntradaFumacaServidor): ItemFumaca {
  const titulo = 'Fuso do servidor de aplicação';
  return fusoEhUtc(e.relogio.fuso)
    ? item('fuso', titulo, 'ok', `Processos em ${FUSO_DO_SERVIDOR}.`)
    : item(
        'fuso',
        titulo,
        grave(e.ambiente),
        `Processos em ${e.relogio.fuso || 'fuso não informado'}: defina TZ=${FUSO_DO_SERVIDOR} no sante.env e reinicie os serviços.`,
      );
}

function itemRelogio(e: EntradaFumacaServidor): ItemFumaca {
  const titulo = 'Relógio do servidor e do banco';
  const r = e.relogio;
  if (r.derivaMs === null) return item('relogio', titulo, 'falha', 'O relógio do banco não foi lido.');
  const fuso =
    r.fusoBancoMin === null ? 'fuso do banco não reconhecido' : `banco em ${rotuloFuso(r.fusoBancoMin)}`;
  const d = Math.abs(r.derivaMs);
  const seg = (d / 1000).toFixed(1).replace('.', ',');
  if (r.fusoBancoMin === null || d > DERIVA_MAXIMA_MS)
    return item(
      'relogio',
      titulo,
      'falha',
      `Diferença de ${seg} s (${fuso}): sincronize os relógios (NTP) do servidor de aplicação e do servidor do banco.`,
    );
  if (d > DERIVA_ALERTA_MS)
    return item(
      'relogio',
      titulo,
      'alerta',
      `Diferença de ${seg} s (${fuso}): confira o NTP dos dois servidores.`,
    );
  return item('relogio', titulo, 'ok', `Diferença de ${seg} s (${fuso}).`);
}

function itemValkey(e: EntradaFumacaServidor): ItemFumaca {
  const titulo = 'Serviço de sessões e filas';
  if (!e.valkey.configurado)
    return item('valkey', titulo, grave(e.ambiente), 'VALKEY_URL não está configurada no sante.env.');
  if (!e.valkey.responde)
    return item(
      'valkey',
      titulo,
      'falha',
      'O serviço de sessões e filas não respondeu: confira o serviço valkey-server.',
    );
  return item('valkey', titulo, 'ok', `Responde em ${e.valkey.latenciaMs ?? 0} ms.`);
}

function itemWorker(e: EntradaFumacaServidor): ItemFumaca {
  const titulo = 'Trabalhadores consumindo as filas';
  const lidas = e.filas.filter((f) => f.consumidores !== null);
  if (lidas.length === 0)
    return item(
      'worker',
      titulo,
      grave(e.ambiente),
      'Sem o serviço de filas não há como ver os consumidores.',
    );
  const sem = lidas.filter((f) => f.consumidores === 0).map((f) => f.codigo);
  if (sem.length === lidas.length)
    return item(
      'worker',
      titulo,
      'falha',
      'Nenhum trabalhador conectado às filas: confira o serviço sante-sgh-worker.',
    );
  if (sem.length > 0)
    return item(
      'worker',
      titulo,
      'alerta',
      `Fila sem consumidor: ${sem.join(', ')} (confira WORKER_SERVICOS no sante.env).`,
    );
  const total = Math.max(...lidas.map((f) => f.consumidores ?? 0));
  return item('worker', titulo, 'ok', `${total} consumidor(es) por fila.`);
}

function itemFilas(e: EntradaFumacaServidor): ItemFumaca {
  const titulo = 'Filas de trabalho';
  const lidas = e.filas.filter((f) => f.aguardando !== null);
  if (lidas.length === 0) return item('filas', titulo, grave(e.ambiente), 'As filas não foram lidas.');
  const problemas: string[] = [];
  for (const f of lidas) {
    if ((f.falhas ?? 0) > 0) problemas.push(`${f.codigo}: ${f.falhas} com falha`);
    if ((f.aguardando ?? 0) > TETO_AGUARDANDO_FILA) problemas.push(`${f.codigo}: ${f.aguardando} à espera`);
  }
  const resumo = lidas
    .map((f) => `${f.codigo} ${f.aguardando ?? 0} à espera, ${f.falhas ?? 0} com falha`)
    .join('; ');
  return problemas.length > 0
    ? item('filas', titulo, 'alerta', `${problemas.join('; ')}: veja o log do worker.`)
    : item('filas', titulo, 'ok', `${resumo}.`);
}

function itemImpressao(e: EntradaFumacaServidor): ItemFumaca {
  const titulo = 'Estrutura do banco igual à homologada';
  const i = e.impressao;
  const resumo = i.resumo ? ` (impressão ${i.resumo})` : '';
  switch (i.estado) {
    case 'homologado':
      return item('impressao-digital', titulo, 'ok', `Igual à homologada${resumo}.`);
    case 'divergente':
      return item(
        'impressao-digital',
        titulo,
        'falha',
        `Diferente da homologada${resumo}: escritas bloqueadas em ${i.bloqueiaTudo ? 'todas as tabelas' : `${i.tabelasBloqueadas} tabela(s)`}. Acione o responsável técnico.`,
      );
    case 'sem-homologacao':
      return item(
        'impressao-digital',
        titulo,
        grave(e.ambiente),
        `Não há impressão homologada para este estabelecimento${resumo}: o pacote precisa levar a homologada.`,
      );
    case 'indisponivel':
      return item('impressao-digital', titulo, 'falha', 'O banco não respondeu à verificação da estrutura.');
    default:
      return item(
        'impressao-digital',
        titulo,
        'alerta',
        'A verificação da estrutura ainda não terminou desde a partida: repita em alguns minutos.',
      );
  }
}

function itemChaves(e: EntradaFumacaServidor): ItemFumaca {
  const titulo = 'Chaves de liberação no estado esperado';
  const c = e.chaves;
  if (!c.lidas) return item('chaves', titulo, 'falha', 'As chaves de liberação não foram lidas.');
  if (c.inesperadas.length > 0)
    return item(
      'chaves',
      titulo,
      'falha',
      `Ligadas fora do esperado: ${c.inesperadas.slice(0, 10).join(', ')}${c.inesperadas.length > 10 ? ` (+${c.inesperadas.length - 10})` : ''}. Desligue em Funcionalidades por estabelecimento ou confira IMPLANTACAO_CHAVES_ESPERADAS.`,
    );
  return item(
    'chaves',
    titulo,
    'ok',
    c.ligadas.length === 0
      ? 'Nenhuma chave ligada (implantação sem liberação).'
      : `${c.ligadas.length} chave(s) ligada(s), todas esperadas.`,
  );
}

/** Os itens da fumaça do servidor, na ordem de ITENS_FUMACA_SERVIDOR. */
export function itensDaFumaca(e: EntradaFumacaServidor): ItemFumaca[] {
  return [
    itemFuso(e),
    itemRelogio(e),
    ...(e.horaConfiavel ? [itemHoraConfiavel(e.horaConfiavel)] : []),
    itemValkey(e),
    itemWorker(e),
    itemFilas(e),
    itemImpressao(e),
    itemChaves(e),
  ];
}

/** A pior situação de uma lista de itens (vazia: ok). */
export function piorSituacao(
  itens: readonly { readonly situacao: SituacaoItemConferencia }[],
): SituacaoItemConferencia {
  if (itens.some((i) => i.situacao === 'falha')) return 'falha';
  if (itens.some((i) => i.situacao === 'alerta')) return 'alerta';
  return 'ok';
}
