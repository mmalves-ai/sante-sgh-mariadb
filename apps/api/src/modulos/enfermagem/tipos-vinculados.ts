// Tipos que este lote usa e que pertencem às portas da enfermagem e dos escores (porta.ts e escores-porta.ts): são
// derivados das próprias portas, para acompanhar qualquer mudança delas sem duplicar a definição. E a entrada da
// checagem do horário (a operação de checar da porta da enfermagem), que a fila beira-leito e o início da transfusão
// montam.
import type { ChecagemAdministracao } from './checagem.js';
import type { PortaEnfermagem } from './porta.js';
import type { PortaEscores } from './escores-porta.js';

/** O paciente internado na unidade (leito, unidade, alergia). */
export type InternadoEnfermagem = NonNullable<Awaited<ReturnType<PortaEnfermagem['internado']>>>;
/** O horário de administração da prescrição (a grade da enfermagem). */
export type HorarioEnfermagemLido = NonNullable<Awaited<ReturnType<PortaEnfermagem['horario']>>>;
/** O escore registrado (NEWS2, Braden…). */
export type EscoreRegistrado = Awaited<ReturnType<PortaEscores['escores']>>[number];
/** O protocolo gerenciado do internado (sepse, AVC, TEV). */
export type ProtocoloDoInternado = NonNullable<Awaited<ReturnType<PortaEscores['protocoloInternado']>>>;
/** O acionamento do time de resposta rápida. */
export type AcionamentoTrrRegistrado = Awaited<ReturnType<PortaEscores['acionamentosTrr']>>[number];
/** A versão da ficha de parada cardiorrespiratória. */
export type VersaoPcrRegistrada = Awaited<ReturnType<PortaEscores['versoesPcr']>>[number];

/** A entrada da operação de checagem do horário (porta da enfermagem). */
export type ChecagemGravacao = ChecagemAdministracao;

/** Contenção do paciente (ordem, horários e encerramento). */
export type ContencaoRegistrada = Awaited<ReturnType<PortaEscores['contencoes']>>[number];

/**
 * Chave do estabelecimento para o estado das portas em memória (dev/ci): o código da sessão quando o contexto o traz
 * (contexto da porta do cadastro), senão o id do estabelecimento.
 */
export function chaveDoEstabelecimento(c: { readonly estabelecimento: number | null }): string {
  const h = (c as { readonly hospital?: unknown }).hospital;
  return typeof h === 'string' && h ? h : String(c.estabelecimento ?? '');
}
