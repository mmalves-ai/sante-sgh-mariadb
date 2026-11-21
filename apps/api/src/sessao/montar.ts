// Monta o serviço de sessão (M05): escolhe a fonte de acesso pelo ambiente e o armazém. A fonte de execução é a
// PRÓPRIA (banco do cliente pelo @sgh/nucleo). A SINTÉTICA (senhas no repositório) só vale com AMBIENTE explícito
// igual a dev ou ci (ausente ou desconhecido nunca vale dev). O armazém padrão é em memória (testes); o servidor
// passa o Valkey (main.ts exige VALKEY_URL fora de dev/ci).
import { BLOQUEIO_PORTA_PADRAO_MINUTOS } from '@sgh/dominio-acesso';
import { type Ambiente, FORMATO_CLIENTE } from '@sgh/nucleo';
import { ArmazemMemoria, type ArmazemSessao } from './armazem.js';
import type { FonteAcesso } from './fonte-acesso.js';
import { type ConfigServicoSessao, ServicoSessao } from './servico-sessao.js';
import { FonteAcessoSintetica } from '../modulos/acesso/fonte-sintetica.js';
import { ServicoAutorizacao } from '../autorizacao/servico-autorizacao.js';
import type { RegistradorTrilha } from '../autorizacao/trilha.js';

export const AMBIENTES_SINTETICOS: ReadonlySet<string> = new Set(['dev', 'ci']);
export const AMBIENTES_CONHECIDOS: ReadonlySet<string> = new Set([
  'dev',
  'ci',
  'homolog',
  'treino',
  'producao',
]);

/** AMBIENTE explícito e conhecido; null quando ausente ou desconhecido (a API recusa a partida). */
export function ambienteDeclarado(env: Ambiente): string | null {
  const a = env['AMBIENTE']?.trim() ?? '';
  return AMBIENTES_CONHECIDOS.has(a) ? a : null;
}

/** dev/ci (e só eles) usam a fonte sintética e o cookie sem o prefixo __Host-. */
export function ambienteSintetico(env: Ambiente): boolean {
  const a = ambienteDeclarado(env);
  return a !== null && AMBIENTES_SINTETICOS.has(a);
}

/** Valores de ACESSO_FONTE_DEV: `propria` (o banco do cliente) ou `sintetica` (só dev/ci). */
export const FONTES_ACESSO = ['propria', 'sintetica'] as const;
export type NomeFonteAcesso = (typeof FONTES_ACESSO)[number];

/** ACESSO_FONTE_DEV declarado (null: ausente; o padrão depende do ambiente e do núcleo). */
export function fonteAcessoDeclarada(env: Ambiente): NomeFonteAcesso | null {
  const v = (env['ACESSO_FONTE_DEV'] ?? '').trim();
  return (FONTES_ACESSO as readonly string[]).includes(v) ? (v as NomeFonteAcesso) : null;
}

/**
 * A fonte que o login usa. Declarada: a declarada. Sem declaração: ci usa a sintética; dev usa a própria quando o
 * núcleo está configurado (senão a sintética); homolog, treino e produção, sempre a própria.
 */
export function fonteAcessoEfetiva(env: Ambiente, nucleoConfigurado: boolean): NomeFonteAcesso {
  const declarada = fonteAcessoDeclarada(env);
  if (declarada) return declarada;
  const a = ambienteDeclarado(env);
  if (a === 'ci') return 'sintetica';
  if (a === 'dev') return nucleoConfigurado ? 'propria' : 'sintetica';
  return 'propria';
}

/** As fontes de dados do app em memória (a fonte de acesso sintética). */
export function fontesSinteticas(env: Ambiente, nucleoConfigurado = false): boolean {
  return ambienteSintetico(env) && fonteAcessoEfetiva(env, nucleoConfigurado) === 'sintetica';
}

/**
 * @deprecated Só para o app.module de referência (fora do boot da F2-L): a fonte de acesso sobre a cópia do banco de
 * origem não existe neste produto. Sempre falso.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura mantida para o app.module de referência
export function fonteDevDaCopia(_env: Ambiente): boolean {
  return false;
}

/** @deprecated Só para o app.module de referência (fora do boot da F2-L). Sempre falso. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura mantida para o app.module de referência
export function devGravaCopia(_env: Ambiente): boolean {
  return false;
}

/** Motivo de recusa da partida pela configuração de acesso (null: pode subir). */
export function recusaDoAcesso(env: Ambiente): string | null {
  const a = ambienteDeclarado(env);
  if (!a) return 'AMBIENTE ausente ou desconhecido: use dev, ci, homolog, treino ou producao.';
  const fonte = (env['ACESSO_FONTE_DEV'] ?? '').trim();
  if (fonte === 'copia')
    return 'ACESSO_FONTE_DEV=copia não existe mais: use propria (o banco do cliente) ou sintetica (dev/ci).';
  if (fonte && !fonteAcessoDeclarada(env))
    return 'ACESSO_FONTE_DEV inválido: use propria (o banco do cliente) ou sintetica (dev/ci).';
  if (fonte === 'sintetica' && !AMBIENTES_SINTETICOS.has(a))
    return 'ACESSO_FONTE_DEV=sintetica só vale em AMBIENTE=dev ou ci.';
  return null;
}

/** A fonte do login (null: recusada pela configuração, ou a própria sem o núcleo, e a API responde 503). */
export function escolherFonteAcesso(env: Ambiente, real: FonteAcesso | null): FonteAcesso | null {
  if (recusaDoAcesso(env)) return null;
  // A própria sem o núcleo configurado: sem fonte (503), nunca cai calada na sintética.
  if (fonteAcessoEfetiva(env, real !== null) === 'sintetica') return new FonteAcessoSintetica(env);
  return real;
}

function minutosBloqueio(env: Ambiente): number {
  const n = Number(env['ACESSO_BLOQUEIO_PORTA_MINUTOS'] ?? '');
  return Number.isInteger(n) && n > 0 ? n : BLOQUEIO_PORTA_PADRAO_MINUTOS;
}

/**
 * Os estabelecimentos do cliente da fonte, lidos a cada consulta (a lista da fonte pode ser recarregada): o catálogo
 * de ações (acao_sistema) é do banco do cliente e vale para todos os seus estabelecimentos; outro código é recusado
 * pela autorização (falha fechada).
 */
class EstabelecimentosDaFonte extends Set<string> {
  constructor(private readonly fonte: FonteAcesso) {
    super();
  }
  override has(codigo: string): boolean {
    return this.fonte.estabelecimentos.some((e) => e.codigo === codigo);
  }
}

/**
 * O cliente das chaves da sessão (CLIENTE_PADRAO). Com a fonte própria é obrigatório e no formato do núcleo: sem ele,
 * a partida é recusada (o cookie de um cliente não pode valer na API de outro que divida o armazém). Na sintética,
 * opcional (null).
 */
export function clienteDaSessao(env: Ambiente, fontePropria: boolean): string | null {
  const cliente = env['CLIENTE_PADRAO']?.trim() || null;
  if (cliente !== null && !FORMATO_CLIENTE.test(cliente))
    throw new Error('CLIENTE_PADRAO inválido: use o código do cliente na plataforma.');
  if (fontePropria && cliente === null)
    throw new Error('CLIENTE_PADRAO ausente: a fonte própria exige o cliente (as chaves da sessão o levam).');
  return cliente;
}

export function montarServicoSessao(
  env: Ambiente,
  real: FonteAcesso | null,
  armazem: ArmazemSessao = new ArmazemMemoria(),
  trilha: RegistradorTrilha | null = null,
  aviso?: (mensagem: string, campos: Record<string, unknown>) => void,
  como: Pick<
    ConfigServicoSessao,
    'guardaComo' | 'reautenticarAtor' | 'aoEncerrarComo' | 'identidade' | 'senha' | 'plataforma'
  > = {},
): ServicoSessao | null {
  const fonte = escolherFonteAcesso(env, real);
  if (!fonte) return null;
  const cliente = clienteDaSessao(env, fonte === real);
  return new ServicoSessao(fonte, armazem, () => Date.now(), {
    // Todas as chaves do armazém levam o cliente (um banco por cliente; o Valkey pode ser comum).
    cliente,
    bloqueioPortaSegundos: minutosBloqueio(env) * 60,
    // M06: permissões (cache de 3 min no mesmo armazém) e a trilha dos eventos de sessão. Com a fonte própria, só
    // os estabelecimentos do cliente da fonte (falha fechada).
    autorizacao: new ServicoAutorizacao(
      fonte,
      armazem,
      () => Date.now(),
      fonte === real ? new EstabelecimentosDaFonte(fonte) : null,
      // O cliente da fonte entra nas chaves do cache (um banco por cliente).
      cliente,
    ),
    ...(trilha ? { trilha } : {}),
    ...(aviso ? { aviso } : {}),
    ...como,
  });
}
