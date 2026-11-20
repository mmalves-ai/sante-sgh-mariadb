// M60, etapa 3 (entrega 4): a coleta de `pnpm implantacao:verificar`, a fumaça pós-implantação. Só leitura: chama o
// HTTPS do servidor (a página, o redirecionamento do HTTP, /api/saude, /api/versao), as sondas da implantação do M38,
// a sonda da conferência da instalação (M60.2) e a sonda da fumaça do servidor, e lê o systemd quando roda no próprio
// servidor. O julgamento é das regras puras (@sgh/dominio-config). O segredo das sondas só vai no cabeçalho; nada de
// segredo, corpo de resposta ou dado de pessoa entra no relatório.
import { readFileSync } from 'node:fs';
import { request as pedirHttp } from 'node:http';
import { request as pedirHttps } from 'node:https';
import { parseEnv } from 'node:util';
import {
  esquemaConferenciaInstalacao,
  esquemaFumacaServidor,
  esquemaSondasImplantacao,
  esquemaVersao,
  ROTA_SONDA_FUMACA,
  ROTA_SONDA_INSTALACAO,
} from '@sgh/contratos';
import { type ColetaVerificacao, type RespostaColhida, type UnidadeLida } from '@sgh/dominio-config';
import { LAYOUT } from './artefatos.ts';

/** Rota das sondas da implantação azul/verde (M38, §6). */
export const ROTA_SONDAS_M38 = '/api/sistema/sonda';
/** Tempo máximo de cada chamada (as sondas leem o banco: folga para o pool abrir). */
export const PRAZO_CHAMADA_MS = 20_000;
/** Teto do corpo lido de uma resposta JSON. */
const TETO_CORPO = 1_000_000;

/** As unidades conferidas no servidor (o nginx serve as telas; o Valkey guarda sessões e filas). */
export const UNIDADES_SERVIDOR = (unit: string = LAYOUT.prefixoUnit): string[] => [
  `${unit}-api`,
  `${unit}-worker`,
  'nginx',
  'valkey-server',
];

export interface RespostaHttp extends RespostaColhida {
  readonly corpo: string | null;
}

export interface OpcoesHttp {
  readonly ca?: Buffer | null;
  readonly cabecalhos?: Record<string, string>;
  readonly prazoMs?: number;
}

/** Um GET sem seguir redirecionamento; o erro vira um código curto (nunca a mensagem inteira, que pode citar o host). */
export type ClienteHttp = (url: string, o?: OpcoesHttp) => Promise<RespostaHttp>;

export function codigoDeErro(e: unknown): string {
  const c = (e as { code?: unknown })?.code;
  if (typeof c === 'string' && /^[A-Z0-9_]{2,60}$/.test(c)) return c;
  return e instanceof Error && e.message === 'tempo esgotado' ? 'TEMPO_ESGOTADO' : 'ERRO';
}

export const clienteHttpNode: ClienteHttp = (url, o = {}) =>
  new Promise((resolve) => {
    const inicio = Date.now();
    const u = new URL(url);
    const pedir = u.protocol === 'https:' ? pedirHttps : pedirHttp;
    const req = pedir(
      u,
      {
        method: 'GET',
        headers: { accept: 'application/json, text/html', ...(o.cabecalhos ?? {}) },
        ...(u.protocol === 'https:' && o.ca ? { ca: o.ca } : {}),
      },
      (res) => {
        const partes: Buffer[] = [];
        let tamanho = 0;
        res.on('data', (d: Buffer) => {
          tamanho += d.length;
          if (tamanho <= TETO_CORPO) partes.push(d);
        });
        res.on('end', () => {
          const cabecalhos: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers))
            if (v !== undefined) cabecalhos[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
          resolve({
            status: res.statusCode ?? null,
            cabecalhos,
            erro: null,
            ms: Date.now() - inicio,
            corpo: Buffer.concat(partes).toString('utf8'),
          });
        });
        res.on('error', (e) =>
          resolve({
            status: null,
            cabecalhos: {},
            erro: codigoDeErro(e),
            ms: Date.now() - inicio,
            corpo: null,
          }),
        );
      },
    );
    req.setTimeout(o.prazoMs ?? PRAZO_CHAMADA_MS, () => req.destroy(new Error('tempo esgotado')));
    req.on('error', (e) =>
      resolve({ status: null, cabecalhos: {}, erro: codigoDeErro(e), ms: Date.now() - inicio, corpo: null }),
    );
    req.end();
  });

/** `systemctl is-active` de cada unidade; nulo quando a ferramenta não roda no servidor. */
export type LeitorUnidades = (nomes: readonly string[]) => Promise<UnidadeLida[] | null>;

export interface PedidoVerificacao {
  /** https://<domínio do servidor>, sem barra no fim. */
  readonly endereco: string;
  readonly hospital: string;
  readonly token: string;
  readonly versaoEsperada: string | null;
  readonly ca: Buffer | null;
  /** Confere também o redirecionamento do HTTP para o HTTPS. */
  readonly conferirHttp: boolean;
}

function lerJson<T>(
  r: RespostaHttp,
  esquema: { parse(x: unknown): T },
): { valor: T | null; erro: string | null } {
  if (r.erro) return { valor: null, erro: r.erro };
  if (r.status !== 200) return { valor: null, erro: `HTTP ${r.status ?? '?'}` };
  try {
    return { valor: esquema.parse(JSON.parse(r.corpo ?? '')), erro: null };
  } catch {
    return { valor: null, erro: 'resposta fora do contrato' };
  }
}

const semCorpo = (r: RespostaHttp): RespostaColhida => ({
  status: r.status,
  cabecalhos: r.cabecalhos,
  erro: r.erro,
  ms: r.ms,
});

/** Coleta tudo o que os itens precisam, em paralelo onde não há dependência. */
export async function coletar(
  p: PedidoVerificacao,
  http: ClienteHttp,
  unidades: LeitorUnidades,
  relogio: () => number = Date.now,
): Promise<ColetaVerificacao> {
  const base = p.endereco.replace(/\/+$/, '');
  const comCa = { ca: p.ca };
  const sonda = { ...comCa, cabecalhos: { 'x-sonda-token': p.token } };
  const q = `?hospital=${encodeURIComponent(p.hospital)}`;
  const enderecoHttp = base.replace(/^https:/, 'http:');
  const [lidas, pagina, http80, saude, versao, sondas, conferencia, rede] = await Promise.all([
    unidades(UNIDADES_SERVIDOR()),
    http(`${base}/`, comCa),
    p.conferirHttp ? http(`${enderecoHttp}/`) : Promise.resolve(null),
    http(`${base}/api/saude`, comCa),
    http(`${base}/api/versao`, comCa),
    http(`${base}${ROTA_SONDAS_M38}${q}`, sonda),
    http(`${base}${ROTA_SONDA_INSTALACAO}${q}`, sonda),
    http(`${base}/api/estabelecimentos`, comCa),
  ]);
  // A fumaça por último e sozinha: o relógio desta máquina é tomado no meio da chamada.
  const antes = relogio();
  const fumaca = await http(`${base}${ROTA_SONDA_FUMACA}${q}`, sonda);
  const relogioLocalMs = Math.round((antes + relogio()) / 2);
  const s = lerJson(sondas, esquemaSondasImplantacao);
  const c = lerJson(conferencia, esquemaConferenciaInstalacao);
  const f = lerJson(fumaca, esquemaFumacaServidor);
  const v = lerJson(versao, esquemaVersao);
  return {
    unidades: lidas,
    pagina: semCorpo(pagina),
    http: http80 ? semCorpo(http80) : null,
    saude: semCorpo(saude),
    identificacao: v.valor?.identificacao ?? null,
    versaoEsperada: p.versaoEsperada,
    sondas: s.valor,
    sondasErro: s.erro,
    conferencia: c.valor,
    conferenciaErro: c.erro,
    fumaca: f.valor,
    fumacaErro: f.erro,
    relogioLocalMs: f.valor ? relogioLocalMs : null,
    rede: semCorpo(rede),
  };
}

/** Opções da linha de comando (`--chave=valor` e bandeiras). */
export function lerArgumentos(argv: readonly string[]): {
  opcoes: Record<string, string>;
  bandeiras: Set<string>;
} {
  const opcoes: Record<string, string> = {};
  const bandeiras = new Set<string>();
  for (const a of argv) {
    if (a === '--') continue;
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`Argumento não reconhecido: ${a.slice(0, 40)}`);
    if (m[2] === undefined) bandeiras.add(m[1] as string);
    else opcoes[m[1] as string] = m[2];
  }
  return { opcoes, bandeiras };
}

/** Lê um arquivo KEY=valor (sante.env, instalacao.env); ausente ou ilegível: vazio. */
export function lerArquivoEnv(
  caminho: string,
  ler: (c: string) => string = (c) => readFileSync(c, 'utf8'),
): Record<string, string> {
  try {
    return parseEnv(ler(caminho)) as Record<string, string>;
  } catch {
    return {};
  }
}

export interface FontesPedido {
  readonly opcoes: Record<string, string>;
  readonly bandeiras: Set<string>;
  /** /etc/sante-sgh/sante.env (no servidor) ou o ambiente do processo (na obra). */
  readonly ambiente: Record<string, string | undefined>;
  /** /etc/sante-sgh/instalacao.env (SITE_DOMINIO, SITE_CERT). */
  readonly instalacao: Record<string, string | undefined>;
  /** A identificação do manifesto da versão ativa (/opt/sante-sgh/atual/manifesto.json). */
  readonly identificacaoDoManifesto: string | null;
  readonly lerCa: (caminho: string) => Buffer;
}

/** O pedido a partir das opções, do sante.env e do estado da instalação; recusa sem endereço, sem token ou sem hospital. */
export function montarPedido(f: FontesPedido): PedidoVerificacao {
  const dominio = f.instalacao['SITE_DOMINIO']?.trim();
  const endereco = (f.opcoes['endereco'] ?? (dominio ? `https://${dominio}` : '')).trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^/\s?#]+(?::\d+)?$/.test(endereco))
    throw new Error('Informe --endereco=https://<domínio do servidor> (ou rode no servidor instalado).');
  const token = (f.ambiente['SONDA_TOKEN'] ?? '').trim();
  if (token.length < 32)
    throw new Error('SONDA_TOKEN ausente ou curto no sante.env (32 caracteres ou mais).');
  const configurados = (f.ambiente['ESTABELECIMENTOS'] ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const hospital = (f.opcoes['hospital'] ?? configurados[0] ?? '').trim();
  if (!/^[a-z0-9]{1,10}$/.test(hospital)) throw new Error('Informe --hospital=<código do estabelecimento>.');
  const caminhoCa = f.opcoes['ca'] ?? (f.bandeiras.has('sem-ca') ? undefined : f.instalacao['SITE_CERT']);
  let ca: Buffer | null = null;
  if (caminhoCa) {
    try {
      ca = f.lerCa(caminhoCa);
    } catch {
      if (f.opcoes['ca']) throw new Error('O arquivo de --ca= não pôde ser lido.');
    }
  }
  const versaoEsperada = (
    f.opcoes['versao'] ??
    f.identificacaoDoManifesto ??
    f.ambiente['SONDA_VERSAO_ESPERADA'] ??
    ''
  ).trim();
  return {
    endereco,
    hospital,
    token,
    versaoEsperada: versaoEsperada || null,
    ca,
    conferirHttp: !f.bandeiras.has('sem-http'),
  };
}
