// Consumidor dos eventos do faturamento no financeiro (M32; ficha, seções 5 e 10): o evento da outbox chega pelo
// BullMQ pelo menos uma vez e o efeito é idempotente pela chave do evento.
//   - `faturamento.glosa.aceita` (M31): a glosa aceita do item vira glosa no título a receber da conta
//     (glosa_titulo_receber, com a trilha na mesma transação, pela operação do Executor em glosa-propria.ts); a conta
//     ainda sem título fica de fora (a glosa entra pela tela de baixa por demonstrativo quando o título nascer);
//   - `faturamento.competencia.fechada` (M31): o título a receber da competência é gravado pela tela
//     (`financeiro.criarTituloReceber`), que exige um usuário real com a permissão e a funcionalidade liberada
//     (segregação e trilha por pessoa): o worker não grava em nome de ninguém. O evento alimenta a fila de trabalho
//     ("contas apresentadas sem título", lida ao vivo) e a tela gera os títulos da competência com um clique.
// Melhoria: a gravação é uma operação declarada (nome e as duas tabelas que grava), no estabelecimento resolvido pelo
//   código e conferido no banco; código desconhecido é recusado pelo acesso.
import type { AcessoIntegracao } from '../integracao/acesso.js';
import type { EventoRecebido } from '../integracao/consumidor-idempotente.js';
import {
  OPERACAO_GLOSA_EVENTO,
  registrarGlosaAceitaDoEvento,
  TABELAS_GLOSA_EVENTO,
} from './glosa-propria.js';

export const EVENTOS_FINANCEIRO: ReadonlySet<string> = new Set([
  'faturamento.glosa.aceita',
  'faturamento.competencia.fechada',
]);

export type ResultadoEventoFinanceiro =
  | { readonly resultado: 'registrada' | 'repetida' | 'sem-titulo' | 'sem-glosa'; readonly id: number | null }
  | { readonly resultado: 'fila-de-trabalho'; readonly convenio: number; readonly competencia: string }
  | null;

const inteiro = (v: string | number | undefined): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Trata um evento do faturamento. `_cliente` fica na assinatura do chamador (relay da outbox): o acesso já está no
 * banco do cliente.
 */
export async function consumirEventoFinanceiro(
  acesso: AcessoIntegracao,
  _cliente: string,
  ev: EventoRecebido,
): Promise<ResultadoEventoFinanceiro> {
  if (!EVENTOS_FINANCEIRO.has(ev.tipo)) return null;
  const hospital = String(ev.dados['hospital'] ?? '');
  if (!/^[a-z0-9]{1,10}$/.test(hospital)) return null;
  if (ev.tipo === 'faturamento.glosa.aceita') {
    const item = inteiro(ev.dados['item']);
    if (item === null) return null;
    return acesso.gravar(
      hospital,
      (tx) => registrarGlosaAceitaDoEvento(tx, { item, chaveEvento: ev.chave.slice(0, 100) }),
      { operacao: OPERACAO_GLOSA_EVENTO, tabelas: TABELAS_GLOSA_EVENTO },
    );
  }
  const convenio = Number(ev.dados['convenio']);
  const ano = inteiro(ev.dados['ano']);
  const mes = inteiro(ev.dados['mes']);
  if (!Number.isInteger(convenio) || convenio < 0 || ano === null || mes === null || mes > 12) return null;
  return { resultado: 'fila-de-trabalho', convenio, competencia: `${ano}-${String(mes).padStart(2, '0')}` };
}
