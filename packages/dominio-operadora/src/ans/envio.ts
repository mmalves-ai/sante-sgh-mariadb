// Regras 6 e 7 do M56 (ficha, seção 8): envios à ANS (SIB, SIP, DIOPS, TPS, monitoramento TISS, ressarcimento ao SUS)
// guardam arquivo, hash e recibo, e nada sai fora de `producao`: fora dela, o simulador responde (o mesmo critério do
// envio TISS do M31). As mensagens ao beneficiário vão só pelas APIs da Hal-AI (DP-44 b), só com a base legal da DP-44
// (a) aprovada, e nunca fora de produção.
import {
  type AcaoEnvioAns,
  OBRIGACOES_ANS,
  OBRIGACOES_COM_GRU,
  type ObrigacaoAns,
  type SituacaoEnvioAns,
} from '@sgh/contratos';

export type DestinoEnvioAns = 'simulador' | 'ans';

/** Destino do envio: a ANS só em produção. */
export function destinoEnvioAns(ambiente: string): DestinoEnvioAns {
  return ambiente === 'producao' ? 'ans' : 'simulador';
}

export type DecisaoMensagem =
  | { readonly enviar: true; readonly canal: 'hal-ai' }
  | { readonly enviar: false; readonly motivo: 'fora-de-producao' | 'sem-base-legal' | 'chave-desligada' };

/** Mensagem ao beneficiário (cobrança, vencimento, protocolo): só pela Hal-AI, em produção, com base legal e chave. */
export function decidirMensagemBeneficiario(e: {
  readonly ambiente: string;
  readonly baseLegalAprovada: boolean;
  readonly chaveLigada: boolean;
}): DecisaoMensagem {
  if (!e.chaveLigada) return { enviar: false, motivo: 'chave-desligada' };
  if (!e.baseLegalAprovada) return { enviar: false, motivo: 'sem-base-legal' };
  if (e.ambiente !== 'producao') return { enviar: false, motivo: 'fora-de-producao' };
  return { enviar: true, canal: 'hal-ai' };
}

/**
 * Competência do envio pela periodicidade da obrigação: mensal `AAAA-MM`, trimestral `AAAA-Tn` (n de 1 a 4), sob
 * demanda `AAAA-MM-DD` (a data do ofício ou da notificação).
 */
export function competenciaValida(obrigacao: ObrigacaoAns, competencia: string): boolean {
  const per = OBRIGACOES_ANS[obrigacao].periodicidade;
  if (per === 'mensal') return /^\d{4}-(0[1-9]|1[0-2])$/.test(competencia);
  if (per === 'trimestral') return /^\d{4}-T[1-4]$/.test(competencia);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(competencia);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
  );
}

/** Trimestre da competência mensal (`2026-08` → `2026-T3`), para juntar o mensal no trimestral. */
export function trimestreDaCompetencia(competencia: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(competencia);
  if (!m) throw new Error(`Competência mensal inválida: ${competencia}`);
  return `${m[1]}-T${Math.ceil(Number(m[2]) / 3)}`;
}

export interface RegistroEnvioAns {
  readonly obrigacao: ObrigacaoAns;
  readonly competencia: string;
  readonly destino: DestinoEnvioAns;
  /** Nome do arquivo gerado (guardado com o conteúdo). */
  readonly arquivo: string;
  /** SHA-256 do arquivo, em hexadecimal minúsculo. */
  readonly hash: string;
  /** Recibo ou protocolo devolvido (obrigatório quando foi à ANS). */
  readonly recibo: string | null;
}

export type ProblemaEnvio =
  'competencia-invalida' | 'sem-arquivo' | 'hash-invalido' | 'sem-recibo' | 'recibo-no-simulador';

/** Conferência do registro em SGH_OPE_ENVIO_ANS (regra 7): arquivo, hash e, na ANS, o recibo. */
export function problemasDoEnvio(r: RegistroEnvioAns): ProblemaEnvio[] {
  const p: ProblemaEnvio[] = [];
  if (!competenciaValida(r.obrigacao, r.competencia)) p.push('competencia-invalida');
  if (!r.arquivo.trim()) p.push('sem-arquivo');
  if (!/^[0-9a-f]{64}$/.test(r.hash)) p.push('hash-invalido');
  if (r.destino === 'ans' && !r.recibo?.trim()) p.push('sem-recibo');
  if (r.destino === 'simulador' && r.recibo !== null) p.push('recibo-no-simulador');
  return p;
}

// ── Etapa 7 (F6): o ciclo do envio ──────────────────────────────────────────────────────────────

/** As ações do envio na situação (a tela só mostra; a API confere de novo). */
export function acoesDoEnvio(e: {
  readonly obrigacao: ObrigacaoAns;
  readonly situacao: SituacaoEnvioAns;
  readonly temArquivo: boolean;
  readonly pago: boolean;
  /** Ressarcimento: todos os atendimentos decididos. */
  readonly decidido?: boolean;
  /** Ressarcimento: o prazo da impugnação ainda corre. */
  readonly noPrazo?: boolean;
}): AcaoEnvioAns[] {
  const a: AcaoEnvioAns[] = [];
  if (e.temArquivo) a.push('baixar');
  if (e.situacao === 'gerado') {
    if (e.obrigacao !== 'RESSARCIMENTO_SUS' || e.decidido) a.push('transmitir');
    if (e.obrigacao === 'RESSARCIMENTO_SUS') a.push('decidir');
  }
  if (e.situacao === 'enviado') a.push('retorno');
  if (
    (e.situacao === 'aceito' || e.situacao === 'aceitoParcial') &&
    OBRIGACOES_COM_GRU.includes(e.obrigacao) &&
    !e.pago
  )
    a.push('pagar');
  return a;
}

/** Recusas da transmissão: o recibo na ANS e nenhum no simulador (regra 7). */
export function problemasDaTransmissao(
  destino: DestinoEnvioAns,
  recibo: string | null | undefined,
): string[] {
  const r = recibo?.trim() ? recibo.trim() : null;
  if (destino === 'ans' && !r) return ['sem-recibo'];
  if (destino === 'simulador' && r) return ['recibo-no-simulador'];
  return [];
}
