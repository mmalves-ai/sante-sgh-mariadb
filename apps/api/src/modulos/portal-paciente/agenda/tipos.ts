// Tipos de negócio da etapa 2 do portal (M50): configuração da agenda online, pré-check-in, intenção de pagamento,
// conciliação da tesouraria e pesquisa de satisfação. Vocabulário neutro (booleano, data ISO, id, valor numérico).
// Melhoria: as regras puras da tesouraria (situação pelo último fato; conciliação com segregação de funções) ficam
// aqui, testáveis sem banco, e a porta só confere com o pagamento travado.

export type TipoAgendaOnline = 'consulta' | 'exame';
export type SituacaoPreCheckin = 'enviado' | 'conferido' | 'recusado' | 'cancelado';
export type FormaPagamentoPortal = 'pix' | 'cartao-credito';
export type SituacaoPagamentoPortal = 'pendente' | 'confirmado' | 'recusado' | 'expirado' | 'duplicado';
export type ConectorPagamentoPortal = 'simulado' | 'gateway';
export type AcaoConciliacaoPortal = 'conciliado' | 'divergente' | 'estorno';
export type SituacaoTesourariaPortal = 'a-conciliar' | 'divergente' | 'conciliado' | 'estornado';

/** Minutos em que a reserva da conferência do pré-check-in vale. */
export const MINUTOS_RESERVA_CONFERENCIA = 10;
/** O operador do caixa do portal (o pagamento confirmado pelo gateway). */
export const OPERADOR_CAIXA_PORTAL = 'SGH.PORTAL';

export interface ConfigAgendaOnline {
  readonly id: number;
  readonly tipo: TipoAgendaOnline;
  readonly agenda: number;
  readonly nomeAgenda: string;
  readonly crm: number;
  readonly ativa: boolean;
  /** Convênios liberados no portal (vazio = os aceitos pela própria agenda). */
  readonly convenios: number[];
  /** Especialidades (consulta) ou exames (exame) liberados (vazio = todos os da agenda). */
  readonly servicos: number[];
  readonly antecedenciaHoras: number;
  readonly horizonteDias: number;
  readonly cancelaAteHoras: number;
  readonly precheckin: boolean;
  readonly valorParticular: number | null;
  /** A agenda de consultas oferece a teleconsulta no portal. */
  readonly teleconsulta: boolean;
  readonly alteradoPor: string;
  readonly alteradoEm: string | null;
  readonly versao: number;
}

export interface ConfigAgendaOnlineParaGravar {
  readonly hospital: string;
  readonly tipo: TipoAgendaOnline;
  readonly agenda: number;
  readonly nomeAgenda: string;
  readonly crm: number;
  readonly ativa: boolean;
  readonly convenios: readonly number[];
  readonly servicos: readonly number[];
  readonly antecedenciaHoras: number;
  readonly horizonteDias: number;
  readonly cancelaAteHoras: number;
  readonly precheckin: boolean;
  readonly valorParticular: number | null;
  readonly teleconsulta?: boolean;
  readonly por: string;
  /** null = a agenda ainda não tem configuração (inclusão); senão, a versão lida. */
  readonly versao: number | null;
}

export interface DocumentoPreCheckin {
  readonly tipo: string;
  readonly chave: string;
  readonly sha256: string;
  readonly mime: string;
}

export interface PreCheckinOnline {
  readonly id: number;
  readonly tipo: TipoAgendaOnline;
  readonly marcacao: number;
  readonly nomeAgenda: string;
  readonly crm: number;
  readonly data: string;
  readonly hora: string;
  readonly paciente: number;
  readonly conta: number;
  /** Os campos propostos (os nomes da alteração do cadastro), já validados no portal e no servidor. */
  readonly dados: Record<string, unknown>;
  readonly documentos: DocumentoPreCheckin[];
  readonly carteirinha: string | null;
  readonly carteirinhaValidade: string | null;
  readonly termos: string;
  readonly situacao: SituacaoPreCheckin;
  readonly motivoRecusa: string | null;
  readonly enviadoEm: string | null;
  readonly conferidoPor: string | null;
  readonly conferidoEm: string | null;
  /** Quem está conferindo agora (a reserva vale por MINUTOS_RESERVA_CONFERENCIA). */
  readonly reservadoPor: string | null;
  readonly camposGravados: string[];
  readonly versao: number;
}

export interface PreCheckinParaGravar {
  readonly hospital: string;
  readonly tipo: TipoAgendaOnline;
  readonly marcacao: number;
  readonly nomeAgenda: string;
  readonly crm: number;
  readonly data: string;
  readonly hora: string;
  readonly paciente: number;
  readonly conta: number;
  readonly dados: Record<string, unknown>;
  readonly documentos: readonly DocumentoPreCheckin[];
  readonly carteirinha: string | null;
  readonly carteirinhaValidade: string | null;
  readonly termos: string;
}

export interface FiltroPreCheckins {
  readonly situacao: SituacaoPreCheckin;
  readonly de: string;
  readonly ate: string;
  /** Cursor: o id do último da página anterior (ordem de chegada). */
  readonly depoisDe?: number | null;
  /** Só os destes pacientes (até 50). */
  readonly pacientes?: readonly number[] | null;
}

export interface PagamentoPortal {
  readonly id: number;
  readonly conta: number;
  readonly paciente: number;
  readonly tipo: TipoAgendaOnline;
  readonly marcacao: number;
  readonly valor: number;
  readonly forma: FormaPagamentoPortal;
  readonly conector: ConectorPagamentoPortal;
  readonly transacao: string;
  readonly situacao: SituacaoPagamentoPortal;
  readonly expiraEm: Date;
  readonly pagamentoCaixa: number | null;
  readonly criadoEm: string | null;
  readonly confirmadoEm: string | null;
  readonly confirmadoPor: string | null;
  /** O que o gateway devolveu na criação (o copia e cola do Pix; a página segura do cartão). */
  readonly pixCopiaECola: string | null;
  readonly enderecoCartao: string | null;
  readonly versao: number;
}

export interface NovaIntencaoPagamento {
  readonly hospital: string;
  readonly conta: number;
  readonly paciente: number;
  readonly tipo: TipoAgendaOnline;
  readonly marcacao: number;
  readonly valor: number;
  readonly forma: FormaPagamentoPortal;
  readonly conector: ConectorPagamentoPortal;
  readonly transacao: string;
  readonly expiraEm: Date;
  readonly pixCopiaECola: string | null;
  readonly enderecoCartao: string | null;
}

export interface ResultadoConfirmacaoPortal {
  /** true só na chamada que mudou a situação (a repetida devolve false e o mesmo pagamento). */
  readonly mudou: boolean;
  readonly pagamento: PagamentoPortal;
}

export interface ConciliacaoPortal {
  readonly id: number;
  readonly pagamento: number;
  readonly acao: AcaoConciliacaoPortal;
  readonly valor: number;
  readonly referencia: string | null;
  readonly motivo: string | null;
  readonly usuario: string;
  readonly em: string | null;
}

export interface NovaConciliacaoPortal {
  readonly hospital: string;
  readonly pagamento: number;
  readonly acao: AcaoConciliacaoPortal;
  readonly valor: number;
  readonly referencia: string | null;
  readonly motivo: string | null;
  readonly usuario: string;
}

export interface PagamentoTesourariaPortal {
  readonly pagamento: PagamentoPortal;
  readonly cobradoPor: string | null;
  readonly atos: readonly ConciliacaoPortal[];
}

export interface PesquisaPortal {
  readonly id: number;
  readonly tipo: TipoAgendaOnline;
  readonly marcacao: number;
  readonly nomeAgenda: string;
  readonly dataAtendimento: string;
  readonly nota: number;
  readonly comentario: string | null;
  readonly respondidaEm: string | null;
}

export interface RespostaPesquisaParaGravar {
  readonly hospital: string;
  readonly conta: number;
  readonly paciente: number;
  readonly tipo: TipoAgendaOnline;
  readonly marcacao: number;
  readonly nomeAgenda: string;
  readonly dataAtendimento: string;
  readonly nota: number;
  readonly comentario: string | null;
}

/** A situação do pagamento na tesouraria (o fato mais forte decide). */
export function situacaoTesourariaPortal(atos: readonly ConciliacaoPortal[]): SituacaoTesourariaPortal {
  if (atos.some((a) => a.acao === 'estorno')) return 'estornado';
  if (atos.some((a) => a.acao === 'conciliado')) return 'conciliado';
  if (atos.some((a) => a.acao === 'divergente')) return 'divergente';
  return 'a-conciliar';
}

const igual = (a: string | null, b: string) => (a ?? '').trim().toUpperCase() === b.trim().toUpperCase();

/** A regra da conciliação (null = pode); o código vai ao problema da API. */
export function conferirConciliacaoPortal(
  t: PagamentoTesourariaPortal,
  n: Pick<NovaConciliacaoPortal, 'acao' | 'valor' | 'motivo' | 'usuario'>,
): { codigo: 'situacao' | 'valor' | 'segregacao' | 'motivo'; mensagem: string } | null {
  const p = t.pagamento;
  if (p.situacao !== 'confirmado' && p.situacao !== 'duplicado')
    return { codigo: 'situacao', mensagem: 'Só o pagamento confirmado pelo gateway se concilia ou estorna.' };
  const sit = situacaoTesourariaPortal(t.atos);
  if (sit === 'estornado') return { codigo: 'situacao', mensagem: 'O pagamento já foi estornado.' };
  if (n.acao !== 'conciliado' && (n.motivo ?? '').trim().length < 5)
    return { codigo: 'motivo', mensagem: 'Informe o motivo (ao menos 5 caracteres).' };
  if (n.acao === 'conciliado' || n.acao === 'divergente') {
    if (sit === 'conciliado')
      return {
        codigo: 'situacao',
        mensagem: 'O pagamento já foi conciliado: depois da baixa, só o estorno.',
      };
    if (igual(t.cobradoPor, n.usuario))
      return { codigo: 'segregacao', mensagem: 'Quem cobrou o pagamento não pode conciliá-lo.' };
  }
  if (n.acao === 'conciliado' && Math.round(n.valor * 100) !== Math.round(p.valor * 100))
    return {
      codigo: 'valor',
      mensagem: 'O valor do extrato não confere com o pagamento: registre a divergência.',
    };
  if (n.acao === 'estorno') {
    if (Math.round(n.valor * 100) !== Math.round(p.valor * 100))
      return { codigo: 'valor', mensagem: 'O estorno é do valor total do pagamento.' };
    const baixa = t.atos.find((a) => a.acao === 'conciliado');
    if (baixa && igual(baixa.usuario, n.usuario))
      return { codigo: 'segregacao', mensagem: 'Quem conciliou o pagamento não pode estorná-lo.' };
    if (igual(t.cobradoPor, n.usuario))
      return { codigo: 'segregacao', mensagem: 'Quem cobrou o pagamento não pode estorná-lo.' };
  }
  return null;
}
