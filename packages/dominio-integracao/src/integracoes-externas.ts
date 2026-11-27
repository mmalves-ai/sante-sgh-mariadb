// Regras da central de integrações externas (decisão 53 do dono). Puras: sem banco nem rede.
// - situacaoDaIntegracao: o que a tela mostra (simulador, real incompleto, real neutralizado, real configurado ou com
//   falha), pelo modo gravado, pelo que falta e pelo ambiente;
// - modoEfetivo: o que o adaptador usa. Só é real em produção, com o real ligado e completo; em qualquer outro caso, o
//   simulador (regra 6 do AGENTS.md: nada sai fora de produção);
// - respostaSimulada: o simulador comum, determinístico pela chave do pedido (aceite, recusa, protocolo e erro de
//   transporte), para testes e para o hospital treinar.
import {
  type EntradaIntegracaoExterna,
  type ModoIntegracaoExterna,
  type SituacaoIntegracaoExterna,
} from '@sgh/contratos';

export interface EstadoIntegracaoExterna {
  readonly modo: ModoIntegracaoExterna;
  readonly parametros: Readonly<Record<string, string>>;
  /** Campos de credencial já guardados no cofre (nulo: cofre indisponível, não se sabe). */
  readonly credenciaisDefinidas: ReadonlySet<string> | null;
  readonly ultimaFalhaEm: Date | null;
  /** Quando o real foi ligado pela última vez: falha anterior a isso não conta. */
  readonly modoAlteradoEm: Date | null;
}

/** O que falta para o real ficar completo: rótulos dos parâmetros obrigatórios vazios e das credenciais ausentes. */
export function faltasDoReal(e: EntradaIntegracaoExterna, s: EstadoIntegracaoExterna): string[] {
  const faltam: string[] = [];
  for (const p of e.parametros)
    if (p.obrigatorio && !(s.parametros[p.id] ?? '').trim()) faltam.push(p.rotulo);
  for (const c of e.camposCredencial)
    if (!s.credenciaisDefinidas || !s.credenciaisDefinidas.has(c.id)) faltam.push(c.rotulo);
  return faltam;
}

export function situacaoDaIntegracao(
  e: EntradaIntegracaoExterna,
  s: EstadoIntegracaoExterna,
  producao: boolean,
): SituacaoIntegracaoExterna {
  if (s.modo === 'simulador') return 'simulador';
  if (faltasDoReal(e, s).length) return 'real-incompleto';
  if (!producao) return 'real-neutralizado';
  if (s.ultimaFalhaEm && (!s.modoAlteradoEm || s.ultimaFalhaEm >= s.modoAlteradoEm)) return 'real-com-falha';
  return 'real-configurado';
}

/** O modo que o adaptador usa: real só em produção, ligado e completo. */
export function modoEfetivo(
  e: EntradaIntegracaoExterna,
  s: EstadoIntegracaoExterna,
  producao: boolean,
): ModoIntegracaoExterna {
  return producao && s.modo === 'real' && faltasDoReal(e, s).length === 0 ? 'real' : 'simulador';
}

export type RespostaSimulada =
  | { readonly tipo: 'aceite'; readonly protocolo: string }
  | { readonly tipo: 'recusa'; readonly codigo: string; readonly mensagem: string }
  | { readonly tipo: 'erro-transporte'; readonly mensagem: string };

/** Resumo FNV-1a de 32 bits (determinístico, sem dependência de cripto). */
function resumo(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * O simulador comum: a mesma chave dá sempre a mesma resposta. Chave terminada em "-recusa" é recusada e em
 * "-erro" falha no transporte (o hospital treina e os testes cobrem os três caminhos); o resto é aceito com um
 * protocolo derivado da integração e da chave.
 */
export function respostaSimulada(integracao: string, chave: string): RespostaSimulada {
  const k = chave.trim().toLowerCase();
  if (k.endsWith('-erro'))
    return { tipo: 'erro-transporte', mensagem: 'Simulador: o serviço não respondeu (erro de transporte).' };
  if (k.endsWith('-recusa'))
    return { tipo: 'recusa', codigo: 'SIM-RECUSA', mensagem: 'Simulador: pedido recusado pelo serviço.' };
  const n = resumo(`${integracao}|${k}`).toString(36).toUpperCase().padStart(7, '0');
  return { tipo: 'aceite', protocolo: `SIM-${n}` };
}
