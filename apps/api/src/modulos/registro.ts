// Registro dos módulos de negócio da API (F2-L): o boot monta a base (sessão, autorização e sistema) e, por cima, os
// módulos pedidos em API_MODULOS que já foram migrados para o banco próprio. Cada módulo migrado entra aqui com um
// carregador preguiçoso (import dinâmico), para que o grafo do build só junte o que está registrado.
//
// API_MODULOS: lista separada por vírgula. Padrão "sessao,autorizacao,sistema" (só a base). "todos": a base e todos os
// registrados. Nome desconhecido ou de módulo ainda não migrado recusa a partida, com a mensagem.
import type { DynamicModule } from '@nestjs/common';
import type { Ambiente, NucleoProprio } from '@sgh/nucleo';
import type { RegistradorTrilha } from '../autorizacao/trilha.js';
import type { Configuracao } from '../configuracao.js';
import type { GanchosComoTardios } from '../sessao/ganchos-como.js';
import type { ArmazemSessao } from '../sessao/armazem.js';
import type { ServicoSessao } from '../sessao/servico-sessao.js';

/** Partes da base, sempre montadas (o app-base.module). */
export const MODULOS_BASE = ['sessao', 'autorizacao', 'sistema'] as const;
export const API_MODULOS_PADRAO = MODULOS_BASE.join(',');

/** O que a base entrega a um módulo registrado ao montá-lo. */
export interface ContextoModulo {
  readonly configuracao: Configuracao;
  readonly nucleo: NucleoProprio | null;
  readonly env: Ambiente;
  readonly armazem: ArmazemSessao;
  readonly servico: ServicoSessao | null;
  readonly trilha: RegistradorTrilha;
  /** Ganchos do "login como" na sessão da base, que o módulo suporte liga (ausente: nenhuma sessão "como" vale). */
  readonly ganchosComo?: GanchosComoTardios;
}

/** O que o arquivo de um módulo migrado exporta (`modulo.ts`). */
export interface ModuloApi {
  modulo(contexto: ContextoModulo): DynamicModule | Promise<DynamicModule>;
}

export type CarregadorModulo = () => Promise<ModuloApi>;

/**
 * Módulos migrados: nome → carregador. Vazio na F2-L; a F2.2/F2.3 inclui cada módulo migrado, por exemplo
 * `cadastro: () => import('./cadastro/modulo.js')`.
 */
export const REGISTRO_MODULOS: Readonly<Record<string, CarregadorModulo>> = Object.freeze({
  agenda: () => import('./agenda/modulo.js'),
  assinatura: () => import('./assinatura/modulo.js'),
  atendimento: () => import('./atendimento/modulo.js'),
  cadastro: () => import('./cadastro/modulo.js'),
  catalogos: () => import('./catalogos/modulo.js'),
  config: () => import('./config/modulo.js'),
  consultas: () => import('./consultas/modulo.js'),
  contratualizacao: () => import('./contratualizacao/modulo.js'),
  custos: () => import('./custos/modulo.js'),
  documento: () => import('./documento/modulo.js'),
  enfermagem: () => import('./enfermagem/modulo.js'),
  especialidades: () => import('./especialidades/modulo.js'),
  exames: () => import('./exames/modulo.js'),
  farmacia: () => import('./farmacia/modulo.js'),
  faturamento: () => import('./faturamento/modulo.js'),
  financeiro: () => import('./financeiro/modulo.js'),
  implantacao: () => import('./implantacao/modulo.js'),
  internacao: () => import('./internacao/modulo.js'),
  operadora: () => import('./operadora/modulo.js'),
  orcamento: () => import('./orcamento/modulo.js'),
  patrimonio: () => import('./patrimonio/modulo.js'),
  portaria: () => import('./portaria/modulo.js'),
  precos: () => import('./precos/modulo.js'),
  recepcao: () => import('./recepcao/modulo.js'),
  rede: () => import('./rede/modulo.js'),
  rouparia: () => import('./rouparia/modulo.js'),
  sessoes: () => import('./sessoes/modulo.js'),
  suporte: () => import('./suporte/modulo.js'),
});

export class ErroModulos extends Error {
  override readonly name = 'ErroModulos';
}

/** Os módulos registrados que API_MODULOS pede (a base fica de fora). Lança ErroModulos com a mensagem. */
export function modulosPedidos(
  env: Ambiente,
  registro: Readonly<Record<string, CarregadorModulo>> = REGISTRO_MODULOS,
): string[] {
  const bruto = env['API_MODULOS']?.trim() || API_MODULOS_PADRAO;
  const nomes = [
    ...new Set(
      bruto
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean),
    ),
  ];
  const registrados = Object.keys(registro).sort();
  if (nomes.includes('todos')) {
    if (nomes.length > 1) throw new ErroModulos('API_MODULOS: "todos" não se combina com outros nomes.');
    return registrados;
  }
  const base: readonly string[] = MODULOS_BASE;
  const recusados = nomes.filter((n) => !base.includes(n) && !Object.hasOwn(registro, n));
  if (recusados.length > 0)
    throw new ErroModulos(
      `API_MODULOS: módulo desconhecido ou ainda não migrado: ${recusados.join(', ')}. ` +
        `Base: ${MODULOS_BASE.join(', ')}. Migrados: ${registrados.length ? registrados.join(', ') : 'nenhum'}.`,
    );
  return nomes.filter((n) => !base.includes(n));
}

/** Motivo de recusa da partida por API_MODULOS (null: pode subir). */
export function recusaDosModulos(
  env: Ambiente,
  registro: Readonly<Record<string, CarregadorModulo>> = REGISTRO_MODULOS,
): string | null {
  try {
    modulosPedidos(env, registro);
    return null;
  } catch (e) {
    if (e instanceof ErroModulos) return e.message;
    throw e;
  }
}

/** Carrega e monta os módulos pedidos, na ordem pedida. */
export async function carregarModulos(
  contexto: ContextoModulo,
  registro: Readonly<Record<string, CarregadorModulo>> = REGISTRO_MODULOS,
): Promise<DynamicModule[]> {
  const nomes = modulosPedidos(contexto.env, registro);
  const modulos: DynamicModule[] = [];
  for (const nome of nomes) {
    const carregar = registro[nome];
    if (!carregar) throw new ErroModulos(`API_MODULOS: módulo ${nome} sem carregador.`);
    modulos.push(await (await carregar()).modulo(contexto));
  }
  return modulos;
}
