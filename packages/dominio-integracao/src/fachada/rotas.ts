// M58-F4: o casamento do pedido com a operação do contrato (mesmos caminhos: `/convenios/{codigo}` casa
// `/convenios/315`), o escopo do token por superfície (utils/auth.js da versão 0.23.0) e o modo de cada operação
// (servida pelo Sante SGH, repassada à API original ou desligada) a partir da configuração do estabelecimento.
import { timingSafeEqual } from 'node:crypto';
import {
  CATALOGO_FACHADA,
  CONFIGURACAO_FACHADA_PADRAO,
  type ConfiguracaoFachada,
  type EscopoTokenFachada,
  type ModoFachada,
  type OperacaoFachada,
  PARAMETROS_FACHADA,
  SUPERFICIES_FACHADA,
  type SuperficieFachada,
} from '@sgh/contratos';
import { naoAutorizado } from './erros.js';

// ── Casamento ─────────────────────────────────────────────────────────────────────────────────────

export interface RotaCasada {
  readonly operacao: OperacaoFachada;
  readonly parametros: Readonly<Record<string, string>>;
}

const SEGMENTO_SEGURO = /^[A-Za-z0-9._~%-]{1,120}$/;

/** A operação do contrato para o método e o caminho (sem a query string), ou null (rota inexistente). */
export function casarRota(
  metodo: string,
  caminhoBruto: string,
  catalogo: readonly OperacaoFachada[] = CATALOGO_FACHADA,
): RotaCasada | null {
  const caminho = caminhoBruto.split('?')[0]!.replace(/\/+$/, '') || '/';
  const partes = caminho.split('/');
  const m = metodo.toUpperCase();
  // Caminho fixo primeiro (`/exames/agendamentos/cancelar` antes de qualquer `{param}`).
  const exata = catalogo.find((o) => o.metodo === m && o.caminho === caminho);
  if (exata) return { operacao: exata, parametros: {} };
  for (const o of catalogo) {
    if (o.metodo !== m || !o.caminho.includes('{')) continue;
    const molde = o.caminho.split('/');
    if (molde.length !== partes.length) continue;
    const parametros: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < molde.length && ok; i++) {
      const s = molde[i]!;
      const p = partes[i]!;
      if (s.startsWith('{') && s.endsWith('}')) {
        if (!SEGMENTO_SEGURO.test(p)) ok = false;
        else parametros[s.slice(1, -1)] = decodeURIComponent(p);
      } else if (s !== p) ok = false;
    }
    if (ok) return { operacao: o, parametros };
  }
  return null;
}

// ── Escopo do token ───────────────────────────────────────────────────────────────────────────────

export type TokensFachada = Readonly<Record<EscopoTokenFachada, string | null>>;

/** Comparação de tempo constante (evita ataque de tempo). */
export function tokensIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** O token do `Authorization: Bearer …` ou do `x-api-key`. */
export function extrairToken(autorizacao: unknown, chave: unknown): string | null {
  const a = Array.isArray(autorizacao) ? autorizacao[0] : autorizacao;
  if (typeof a === 'string' && /^bearer\s+/i.test(a)) return a.replace(/^bearer\s+/i, '').trim() || null;
  const k = Array.isArray(chave) ? chave[0] : chave;
  return typeof k === 'string' && k.trim() ? k.trim() : null;
}

/**
 * Os tokens aceitos pela operação: cada superfície com token próprio aceita SÓ o dela; sem token próprio, cai no
 * principal (nunca os dois: aceitar o principal na auditoria anularia a separação).
 */
export function tokensAceitos(op: OperacaoFachada, tokens: TokensFachada): readonly string[] {
  const proprio = op.escopo === 'principal' ? null : tokens[op.escopo];
  const t = proprio ?? tokens.principal;
  return t ? [t] : [];
}

/** Confere o token do pedido: público passa; sem token configurado ou token errado → 401. */
export function autenticar(op: OperacaoFachada, fornecido: string | null, tokens: TokensFachada): void {
  if (op.publica) return;
  const aceitos = tokensAceitos(op, tokens);
  if (!fornecido || !aceitos.some((t) => tokensIguais(fornecido, t))) throw naoAutorizado();
}

// ── Configuração (SGH_CFG_PARAMETRO) ──────────────────────────────────────────────────────────────

const sim = (v: string | undefined, padrao: boolean) =>
  v === undefined ? padrao : ['sim', 'true', 's', '1'].includes(v.trim().toLowerCase());

/** As superfícies de uma lista separada por vírgula (as desconhecidas ficam fora). */
export function lerSuperficies(v: string): SuperficieFachada[] {
  const pedidas = new Set(v.split(',').map((s) => s.trim().toLowerCase()));
  return SUPERFICIES_FACHADA.filter((s) => pedidas.has(s));
}

/** O destino do repasse: só http(s) sem credencial no endereço (vazio: sem repasse). */
export function destinoValido(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash)
      return null;
    return t.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** A configuração efetiva a partir dos valores vigentes (chave → valor; ausente: o padrão). */
export function lerConfiguracaoFachada(valores: ReadonlyMap<string, string>): ConfiguracaoFachada {
  const sup = valores.get(PARAMETROS_FACHADA.superficies);
  const dest = valores.get(PARAMETROS_FACHADA.destino);
  return {
    ligada: sim(valores.get(PARAMETROS_FACHADA.ligada), CONFIGURACAO_FACHADA_PADRAO.ligada),
    escrita: sim(valores.get(PARAMETROS_FACHADA.escrita), CONFIGURACAO_FACHADA_PADRAO.escrita),
    superficies: sup === undefined ? CONFIGURACAO_FACHADA_PADRAO.superficies : lerSuperficies(sup),
    destino: dest === undefined ? CONFIGURACAO_FACHADA_PADRAO.destino : destinoValido(dest),
  };
}

/** Valida o valor pedido para uma chave da fachada; devolve o valor normalizado ou a mensagem da recusa. */
export function validarValorFachada(chave: string, valor: string): { valor: string } | { recusa: string } {
  const v = valor.trim();
  switch (chave) {
    case PARAMETROS_FACHADA.ligada:
    case PARAMETROS_FACHADA.escrita:
      return v === 'sim' || v === 'nao' ? { valor: v } : { recusa: 'Use "sim" ou "nao".' };
    case PARAMETROS_FACHADA.superficies: {
      const pedidas = v
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const desconhecidas = pedidas.filter((s) => !(SUPERFICIES_FACHADA as readonly string[]).includes(s));
      if (desconhecidas.length) return { recusa: `Superfície desconhecida: ${desconhecidas.join(', ')}.` };
      return { valor: lerSuperficies(v).join(',') };
    }
    case PARAMETROS_FACHADA.destino:
      if (!v) return { valor: '' };
      return destinoValido(v)
        ? { valor: destinoValido(v)! }
        : { recusa: 'Informe um endereço http(s) sem usuário, senha, consulta ou fragmento.' };
    default:
      return { recusa: 'Chave fora da fachada.' };
  }
}

// ── Modo de cada operação ─────────────────────────────────────────────────────────────────────────

/** Estados do catálogo de operações em que a escrita equivalente é provada (verde ou além; M03). */
const ESTADOS_PROVADOS = new Set(['verde', 'conferida', 'liberada']);

export type CausaDesligada = 'fachada' | 'superficie' | 'escrita' | 'nao-provada' | 'sem-destino';

export interface ModoDescrito {
  readonly modo: ModoFachada;
  readonly motivo: string | null;
  /** Por que está desligada (null: servida ou repassada). */
  readonly causa: CausaDesligada | null;
}

const desligada = (causa: CausaDesligada, motivo: string): ModoDescrito => ({
  modo: 'desligada',
  motivo,
  causa,
});

/**
 * Como a fachada atende a operação. `estado`: o estado da operação equivalente no catálogo (null: fora do catálogo).
 * Toda escrita (servida ou repassada) exige a escrita ligada; a escrita servida exige também a operação equivalente
 * provada (POL-3: a não provada fica desligada, com o motivo); a não servida vai ao destino do repasse, quando há.
 */
export function modoDaOperacao(
  op: OperacaoFachada,
  cfg: ConfiguracaoFachada,
  estado: (operacaoSgh: string) => string | null,
): ModoDescrito {
  if (!cfg.ligada) return desligada('fachada', 'A fachada está desligada no estabelecimento.');
  if (!cfg.superficies.includes(op.superficie))
    return desligada('superficie', `A superfície ${op.superficie} está fora da fachada.`);
  if (op.escreve && !cfg.escrita)
    return desligada('escrita', 'A escrita pela fachada está desligada (padrão): nada é gravado por ela.');
  if (op.servidaPeloSante) {
    const naoProvadas = op.operacoesSgh.filter((n) => !ESTADOS_PROVADOS.has(estado(n) ?? ''));
    if (op.escreve && naoProvadas.length)
      return desligada(
        'nao-provada',
        `A gravação equivalente ainda não foi provada pelo teste de assinatura: ${naoProvadas.join(', ')}.`,
      );
    return { modo: 'servida', motivo: null, causa: null };
  }
  if (cfg.destino)
    return {
      modo: 'repassada',
      motivo: 'Ainda não servida pelo Sante SGH: repassada à API original.',
      causa: null,
    };
  return desligada(
    'sem-destino',
    'Ainda não servida pelo Sante SGH e sem endereço da API original para o repasse.',
  );
}
