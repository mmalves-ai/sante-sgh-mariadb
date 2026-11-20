// Monta o serviço de sessão (M05): escolhe a fonte de acesso pelo ambiente e o armazém. Fonte SINTÉTICA só
// com AMBIENTE explícito igual a dev ou ci (ausente ou desconhecido nunca vale dev: as senhas sintéticas
// estão no repositório); em homolog, treino e produção, o núcleo do legado (login real), e só com a
// combinação do spike fixada (ACESSO_COMBINACAO_SENHA). O armazém padrão é em memória (testes); o servidor
// passa o Valkey (main.ts exige VALKEY_URL fora de dev/ci).
import { CATALOGO_LEGADO_ORIGEM } from '@sgh/contratos/catalogo-legado';
import { BLOQUEIO_PORTA_PADRAO_MINUTOS } from '@sgh/dominio-acesso';
import { combinacaoDoAmbiente, type Ambiente } from '@sgh/legado';
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

/**
 * ADR 0021: em AMBIENTE=dev, ACESSO_FONTE_DEV=copia faz o login dos usuários do SPDATA e a lista de alvos do
 * "login como" usarem o TBUSERS REAL da cópia (READ ONLY; a trilha continua em memória: nada grava na cópia
 * no login). Padrão: a fonte sintética. Só vale em dev (ci, homolog, treino e produção recusam a chave).
 */
export function fonteDevDaCopia(env: Ambiente): boolean {
  return ambienteDeclarado(env) === 'dev' && (env['ACESSO_FONTE_DEV'] ?? '').trim() === 'copia';
}

/**
 * Pedido do dono (17/11/2026; liberação full, ADR 0034): o dev sobre a cópia GRAVA. Com DEV_GRAVA_COPIA=sim (e só com
 * AMBIENTE=dev e ACESSO_FONTE_DEV=copia), a API troca as fontes em memória pelas de produção: executor, trilha,
 * configuração e chaves de liberação lidas e gravadas no banco da cópia, com as permissões de cada login. Os dados
 * originais voltam da matriz (banco-dev/scripts/restaurar.sh). Sem a chave, o dev segue como antes (memória).
 */
export function devGravaCopia(env: Ambiente): boolean {
  return fonteDevDaCopia(env) && (env['DEV_GRAVA_COPIA'] ?? '').trim() === 'sim';
}

/** As fontes de dados do app em memória (dev/ci sintéticos), salvo o dev que grava na cópia. */
export function fontesSinteticas(env: Ambiente): boolean {
  return ambienteSintetico(env) && !devGravaCopia(env);
}

/**
 * Motivo de recusa da partida pela configuração de acesso (null: pode subir). Fora de dev/ci, sem a
 * combinação do spike a API não sobe: com todas as candidatas valendo, uma senha guardada em maiúsculas
 * aceitaria qualquer caixa.
 */
export function recusaDoAcesso(env: Ambiente): string | null {
  const a = ambienteDeclarado(env);
  if (!a) return 'AMBIENTE ausente ou desconhecido: use dev, ci, homolog, treino ou producao.';
  const fonteDev = (env['ACESSO_FONTE_DEV'] ?? '').trim();
  if (fonteDev && !['sintetica', 'copia'].includes(fonteDev))
    return 'ACESSO_FONTE_DEV inválido: use sintetica (padrão) ou copia.';
  if (fonteDev === 'copia' && a !== 'dev') return 'ACESSO_FONTE_DEV=copia só vale em AMBIENTE=dev.';
  try {
    const fixa = combinacaoDoAmbiente(env);
    if (!AMBIENTES_SINTETICOS.has(a) && !fixa) {
      return 'ACESSO_COMBINACAO_SENHA ausente: fora de dev/ci o login exige a combinação confirmada pelo spike.';
    }
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return null;
}

export function escolherFonteAcesso(env: Ambiente, real: FonteAcesso | null): FonteAcesso | null {
  if (recusaDoAcesso(env)) return null;
  // ACESSO_FONTE_DEV=copia sem o núcleo configurado: sem fonte (503), nunca cai calada na sintética.
  if (fonteDevDaCopia(env)) return real;
  if (ambienteSintetico(env)) return new FonteAcessoSintetica(env);
  return real;
}

function minutosBloqueio(env: Ambiente): number {
  const n = Number(env['ACESSO_BLOQUEIO_PORTA_MINUTOS'] ?? '');
  return Number.isInteger(n) && n > 0 ? n : BLOQUEIO_PORTA_PADRAO_MINUTOS;
}

export function montarServicoSessao(
  env: Ambiente,
  real: FonteAcesso | null,
  armazem: ArmazemSessao = new ArmazemMemoria(),
  trilha: RegistradorTrilha | null = null,
  aviso?: (mensagem: string, campos: Record<string, unknown>) => void,
  como: Pick<
    ConfigServicoSessao,
    'guardaComo' | 'reautenticarAtor' | 'aoEncerrarComo' | 'identidade' | 'senhaLegado'
  > = {},
): ServicoSessao | null {
  const fonte = escolherFonteAcesso(env, real);
  if (!fonte) return null;
  const trocaSenhaPeloNovo = (env['ACESSO_TROCA_SENHA_PELO_NOVO'] ?? '').trim() === 'sim';
  return new ServicoSessao(fonte, armazem, () => Date.now(), {
    trocaSenhaPeloNovo,
    combinacao: combinacaoDoAmbiente(env),
    bloqueioPortaSegundos: minutosBloqueio(env) * 60,
    // M06: permissões do legado (cache de 3 min no mesmo armazém) e a trilha dupla dos eventos de sessão.
    // Com o núcleo real, só o estabelecimento cuja árvore gerou o catálogo (falha fechada; HS-1).
    autorizacao: new ServicoAutorizacao(
      fonte,
      armazem,
      () => Date.now(),
      fonte === real ? new Set([CATALOGO_LEGADO_ORIGEM.estabelecimento]) : null,
    ),
    ...(trilha ? { trilha } : {}),
    ...(aviso ? { aviso } : {}),
    ...como,
  });
}
