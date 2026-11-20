// Estação e origem do evento (MAQUINA_USUARIO do legado, "MÁQUINA:conta"; ORIGEM da trilha própria): o
// prefixo configurável TRILHA_ESTACAO (padrão SGH-WEB, o que distingue o Sante SGH na trilha do SPDATA;
// decisão nas evidências do M06) e o endereço de rede de quem pediu (nenhum nome de pessoa).
import type { RequisicaoComCabecalhos } from './resolvedor-sessao.js';

export const ESTACAO_PREFIXO_PADRAO = 'SGH-WEB';

export function prefixoEstacao(env: NodeJS.ProcessEnv = process.env): string {
  const p = (env['TRILHA_ESTACAO'] ?? '').trim().toUpperCase();
  return /^[A-Z0-9_-]{2,30}$/.test(p) ? p : ESTACAO_PREFIXO_PADRAO;
}

const CORRELACAO = /^[A-Za-z0-9._:-]{1,64}$/;

/**
 * Correlação para a trilha (SGH_TRILHA.CORRELACAO, só inclusão): o cabeçalho x-correlacao só quando é um
 * código (letras, dígitos e . _ : -, até 64); qualquer outro texto (que poderia levar dado pessoal) é trocado
 * pelo padrão do servidor.
 */
export function correlacaoDaRequisicao(req: RequisicaoComCabecalhos, padrao: string): string {
  const bruto = req.headers['x-correlacao'];
  const c = Array.isArray(bruto) ? bruto[0] : bruto;
  return typeof c === 'string' && CORRELACAO.test(c) ? c : padrao;
}

/** Sufixo da estação nas gravações do "como" (ADR 0021): o hospital vê "Suporte técnico", nunca o IP. */
export const ESTACAO_SUPORTE = 'SUPORTE';

export function estacaoDaRequisicao(
  req: RequisicaoComCabecalhos,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (req.sghComo) return `${prefixoEstacao(env)}:${ESTACAO_SUPORTE}`;
  const ip = (req.ip ?? '').replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45) || 'desconhecido';
  return `${prefixoEstacao(env)}:${ip}`.slice(0, 100);
}
