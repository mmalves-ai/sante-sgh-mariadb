// Decisão de acesso em passos (ficha do M06, regra 5; cap-08 §8.4): sessão → permissão → escopo
// organizacional → categoria profissional → vínculo assistencial → permite e audita, ou oferece quebra de
// vidro, ou nega. Puro: o servidor e a tela chamam com o mesmo `AbilitySgh` (ability.ts).
import { type AbilitySgh, pode, type RegistroComEscopo } from './ability.js';

export type PassoDecisao = 'sessao' | 'permissao' | 'escopo' | 'categoria' | 'vinculo' | 'concluida';
export type Desfecho = 'permite' | 'quebra-de-vidro' | 'nega';

export interface PedidoAcesso {
  readonly autenticado: boolean;
  readonly ability: AbilitySgh;
  readonly permissao: string;
  /** Atributos do registro (unidade, convênio…) para o escopo; ausente: decisão só pela permissão. */
  readonly registro?: RegistroComEscopo;
  /** Ação privativa de categoria com conselho (ATO-01). */
  readonly exigeConselho?: boolean;
  readonly temConselho?: boolean;
  /** Passo 5: o vínculo é exigido? (exigeVinculo); e há vínculo? */
  readonly exigeVinculo?: boolean;
  readonly temVinculo?: boolean;
  /** Acesso de emergência vigente para este paciente (quebra de vidro já aberta). */
  readonly emergenciaVigente?: boolean;
  /** A pessoa pode pedir quebra de vidro (acesso.emergencia.solicitar). */
  readonly podeQuebrarVidro?: boolean;
}

export interface ResultadoDecisao {
  readonly desfecho: Desfecho;
  /** Onde a decisão parou. */
  readonly passo: PassoDecisao;
  /** Toda leitura permitida de prontuário é auditada; a negada também (tentativa). */
  readonly auditar: boolean;
  readonly motivo: string;
  readonly porEmergencia: boolean;
}

const r = (
  desfecho: Desfecho,
  passo: PassoDecisao,
  motivo: string,
  porEmergencia = false,
): ResultadoDecisao => ({ desfecho, passo, motivo, auditar: passo !== 'sessao', porEmergencia });

export function decidir(p: PedidoAcesso): ResultadoDecisao {
  if (!p.autenticado) return r('nega', 'sessao', 'sem sessão válida');
  if (!pode(p.ability, p.permissao)) return r('nega', 'permissao', 'sem a permissão');
  if (p.registro && !pode(p.ability, p.permissao, p.registro))
    return r('nega', 'escopo', 'registro fora do escopo');
  if (p.exigeConselho && !p.temConselho)
    return r('nega', 'categoria', 'ação privativa de categoria com conselho');
  if (p.exigeVinculo && !p.temVinculo) {
    if (p.emergenciaVigente) return r('permite', 'concluida', 'acesso de emergência vigente', true);
    if (p.podeQuebrarVidro) return r('quebra-de-vidro', 'vinculo', 'sem vínculo: quebra de vidro disponível');
    return r('nega', 'vinculo', 'sem vínculo assistencial');
  }
  return r('permite', 'concluida', 'permitido');
}
