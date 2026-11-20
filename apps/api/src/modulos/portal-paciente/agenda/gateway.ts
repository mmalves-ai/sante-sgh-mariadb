// Gateway de pagamento do portal do paciente (M50, etapa 2; ficha, seção 5: "Pix ou cartão pelo gateway (só em
// produção); confirmação idempotente"). Fora de produção, só o SIMULADO (`PORTAL_PAGAMENTO_MODO` vazio ou `simulador`):
// cria a cobrança em memória, devolve um Pix copia e cola sintético e só aprova quando a pessoa usa "Simular o
// pagamento" (o retorno simulado). O gateway real depende da autorização do dono (pré-requisito da chave
// `portal.pagamento`, POL-3): sem contrato e credenciais, o modo `desligado` (e a produção sem gateway) recusa abrir
// cobrança com 503. O número do cartão nunca passa pelo Sante: o cartão vai à página segura do gateway.
import { randomBytes } from 'node:crypto';
import type { FormaPagamentoPortal } from '@sgh/contratos';

export interface CobrancaCriada {
  readonly transacao: string;
  readonly pixCopiaECola: string | null;
  readonly enderecoCartao: string | null;
}

export interface SituacaoNoGateway {
  readonly resultado: 'aprovado' | 'recusado' | 'pendente' | 'expirado';
  readonly comprovante: string;
}

export interface GatewayPagamento {
  readonly conector: 'simulado' | 'gateway';
  readonly disponivel: boolean;
  criar(p: {
    valor: number;
    forma: FormaPagamentoPortal;
    referencia: string;
    expiraEm: Date;
  }): Promise<CobrancaCriada>;
  /** Relê a transação no gateway (o retorno e a conferência nunca confiam no corpo recebido). */
  consultar(transacao: string): Promise<SituacaoNoGateway>;
  /** W0-10: o estorno total da transação aprovada (a tesouraria); devolve o comprovante do gateway. */
  estornar(transacao: string, valor: number): Promise<{ comprovante: string }>;
}

/** O gateway simulado da sessão sintética e dos testes (nada sai da máquina). */
export class GatewaySimulado implements GatewayPagamento {
  readonly conector = 'simulado' as const;
  readonly disponivel = true;
  private readonly cobrancas = new Map<string, { expiraEm: Date; pago: boolean; recusado: boolean }>();

  constructor(private readonly agora: () => Date = () => new Date()) {}

  async criar(p: { valor: number; forma: FormaPagamentoPortal; referencia: string; expiraEm: Date }) {
    const transacao = `SIM-${p.forma === 'pix' ? 'PIX' : 'CARTAO'}-${randomBytes(9).toString('hex').toUpperCase()}`;
    this.cobrancas.set(transacao, { expiraEm: p.expiraEm, pago: false, recusado: false });
    const centavos = Math.round(p.valor * 100);
    return {
      transacao,
      // Copia e cola SINTÉTICO (não é um BR Code válido: não paga nada em banco nenhum).
      pixCopiaECola: p.forma === 'pix' ? `SIMULADO-PIX|${transacao}|${centavos}|${p.referencia}` : null,
      enderecoCartao: p.forma === 'cartao-credito' ? `/paciente/pagamentos?simulado=${transacao}` : null,
    };
  }

  async consultar(transacao: string): Promise<SituacaoNoGateway> {
    const c = this.cobrancas.get(transacao);
    if (!c) return { resultado: 'pendente', comprovante: '' };
    if (c.pago) return { resultado: 'aprovado', comprovante: `SIM-COMP-${transacao.slice(-8)}` };
    if (c.recusado) return { resultado: 'recusado', comprovante: '' };
    if (c.expiraEm.getTime() < this.agora().getTime()) return { resultado: 'expirado', comprovante: '' };
    return { resultado: 'pendente', comprovante: '' };
  }

  /** O estorno simulado (nada sai da máquina): o comprovante sintético. */
  async estornar(transacao: string): Promise<{ comprovante: string }> {
    const c = this.cobrancas.get(transacao);
    if (c) c.pago = false;
    return { comprovante: `SIM-EST-${randomBytes(6).toString('hex').toUpperCase()}` };
  }

  /** O "pagamento" da sessão sintética (o botão "Simular o pagamento"; nunca em produção). */
  simularPagamento(transacao: string, aprovar = true): boolean {
    const c = this.cobrancas.get(transacao);
    if (!c) return false;
    if (aprovar) c.pago = true;
    else c.recusado = true;
    return true;
  }
}

/** Sem gateway (produção sem a autorização do dono, ou `PORTAL_PAGAMENTO_MODO=desligado`). */
export class GatewayIndisponivel implements GatewayPagamento {
  readonly conector = 'gateway' as const;
  readonly disponivel = false;
  async criar(): Promise<CobrancaCriada> {
    throw new Error('Gateway de pagamento não configurado.');
  }
  async consultar(): Promise<SituacaoNoGateway> {
    return { resultado: 'pendente', comprovante: '' };
  }
  async estornar(): Promise<{ comprovante: string }> {
    throw new Error('Gateway de pagamento não configurado.');
  }
}

/** O gateway do ambiente: simulado em dev, ci, homologação e treino; desligado em produção até o contrato. */
export function gatewayDoAmbiente(
  env: Record<string, string | undefined>,
  ambiente: string,
): GatewayPagamento {
  const modo = env['PORTAL_PAGAMENTO_MODO']?.trim() ?? '';
  if (ambiente === 'producao' || modo === 'desligado') return new GatewayIndisponivel();
  return new GatewaySimulado();
}
