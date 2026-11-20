// Higiene de alertas da casca (ficha do M27, regra 6; cap-03 §3.2): só o risco grave interrompe o trabalho — alergia,
// dose acima do limite e paciente errado —; o resto vai para a central de avisos (o sino), sem janela no meio da tarefa.
// Um aviso que interrompe aparece uma vez por sessão do navegador (o mesmo aviso não volta a interromper depois de
// fechado; continua na central até ser resolvido). Puro, sem rede.
import { type Aviso, type CentralAvisos, TIPOS_AVISO_GRAVE } from '@sgh/contratos';

export type Apresentacao = 'interromper' | 'central';

/** Interrompe só o risco grave da lista (alergia, dose acima do limite, paciente errado); o resto vai à central. */
export function apresentacaoDoAviso(a: Pick<Aviso, 'tipo' | 'gravidade'>): Apresentacao {
  return a.gravidade === 'grave' && (TIPOS_AVISO_GRAVE as readonly string[]).includes(a.tipo)
    ? 'interromper'
    : 'central';
}

/** Os avisos novos que devem interromper agora (ainda não mostrados nesta sessão). */
export function avisosQueInterrompem(avisos: readonly Aviso[], jaMostrados: ReadonlySet<number>): Aviso[] {
  return avisos.filter(
    (a) => a.estado === 'novo' && apresentacaoDoAviso(a) === 'interromper' && !jaMostrados.has(a.id),
  );
}

/** O número do selo do sino: os avisos novos e as mensagens não lidas (os comunicados só vão à caixa; D-AVISO-27). */
export function seloDoSino(central: CentralAvisos | undefined, naoLidas: number): number {
  return (central?.novos ?? 0) + Math.max(0, naoLidas);
}

/** A central em ordem: novos, depois lidos, depois resolvidos; dentro de cada um, o mais novo primeiro. */
export function ordenarCentral(avisos: readonly Aviso[]): Aviso[] {
  const peso = { novo: 0, lido: 1, resolvido: 2 } as const;
  return [...avisos].sort(
    (a, b) => peso[a.estado] - peso[b.estado] || b.criadoEm.localeCompare(a.criadoEm) || b.id - a.id,
  );
}
