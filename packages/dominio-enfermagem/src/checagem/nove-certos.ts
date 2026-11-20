// Nove certos da administração (ficha do M25, regra 4; Portaria MS 2.095/2013, protocolo de segurança na prescrição,
// uso e administração de medicamentos): paciente, medicamento, via, hora, dose, registro, orientação, forma e resposta.
// Bloqueia o paciente errado, o item suspenso, o medicamento vencido e a dose maior que a prescrita; o medicamento
// lido diferente do prescrito também bloqueia (D-9C-25: é o "medicamento certo"). A divergência menor (hora fora da
// tolerância, dose menor que a prescrita, leitura da dose ausente quando não é obrigatória) avisa: o profissional
// confere e segue.
import type { AvaliacaoNoveCertos } from '@sgh/contratos';
import { dentroDaTolerancia } from './tolerancia.js';
import { gtinCasa } from './pulseira.js';

export interface EntradaNoveCertos {
  readonly desfecho: 'administrado' | 'naoAdministrado';
  /** O horário está suspenso (situação S ou C) ou o item foi suspenso depois da leitura. */
  readonly suspenso: boolean;
  /** A pulseira foi lida e é de outro paciente (paciente errado). */
  readonly pacienteErrado: boolean;
  readonly previsto: string;
  readonly agora: string;
  readonly toleranciaMinutos: number;
  readonly dosePrescrita: number | null;
  readonly quantidade: number | null;
  readonly unidade: string | null;
  /** Leitura da dose (GTIN e validade) e o código de barras do item prescrito. */
  readonly gtin: string | null;
  readonly barrasDoItem: string | null;
  readonly validade: string | null;
  readonly lote: string | null;
  readonly hoje: string;
  readonly doseObrigatoria: boolean;
  readonly loteValidadeObrigatorio: boolean;
  /** O horário é de medicamento, solução ou hemocomponente (o que tem dose a ler). */
  readonly temDose: boolean;
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

/** Regra 4: bloqueios e avisos dos nove certos para a checagem (o não administrado só confere a suspensão). */
export function avaliarNoveCertos(e: EntradaNoveCertos): AvaliacaoNoveCertos {
  const bloqueios: string[] = [];
  const avisos: string[] = [];
  if (e.suspenso)
    bloqueios.push('O item está suspenso: não administre (a suspensão foi registrada na prescrição).');
  if (e.desfecho === 'naoAdministrado') return { bloqueios, avisos };
  if (e.pacienteErrado) bloqueios.push('A pulseira lida não é do paciente deste horário (paciente certo).');
  if (e.temDose) {
    if (e.validade && e.validade < e.hoje)
      bloqueios.push('O medicamento lido está vencido (validade certa).');
    if (e.gtin && e.barrasDoItem && !gtinCasa(e.gtin, e.barrasDoItem))
      bloqueios.push('O medicamento lido não é o prescrito (medicamento certo).');
    if (e.doseObrigatoria && !e.gtin) bloqueios.push('Nesta unidade a leitura da dose é obrigatória.');
    if (e.loteValidadeObrigatorio && (!e.lote || !e.validade))
      bloqueios.push('Informe o lote e a validade da dose (obrigatórios para este tipo de item).');
    if (!e.doseObrigatoria && !e.gtin)
      avisos.push('A dose não foi lida: confira o rótulo antes de administrar.');
    if (e.gtin && !e.barrasDoItem)
      avisos.push('O item prescrito não tem código de barras no cadastro: confira o rótulo.');
  }
  if (e.dosePrescrita !== null && e.quantidade !== null) {
    const u = e.unidade ? ` ${e.unidade}` : '';
    if (e.quantidade > e.dosePrescrita + 1e-9)
      bloqueios.push(
        `A quantidade (${fmt(e.quantidade)}${u}) é maior que a dose prescrita (${fmt(e.dosePrescrita)}${u}) (dose certa).`,
      );
    else if (e.quantidade < e.dosePrescrita - 1e-9)
      avisos.push(
        `A quantidade (${fmt(e.quantidade)}${u}) é menor que a dose prescrita (${fmt(e.dosePrescrita)}${u}).`,
      );
  }
  if (!dentroDaTolerancia(e.previsto, e.agora, e.toleranciaMinutos))
    avisos.push('A administração está fora da tolerância do horário previsto (hora certa).');
  return { bloqueios, avisos };
}

/** Pode gravar: sem bloqueio e, havendo aviso, conferido pelo profissional. */
export function liberadoPelosNoveCertos(a: AvaliacaoNoveCertos, avisosConferidos: boolean): boolean {
  return a.bloqueios.length === 0 && (a.avisos.length === 0 || avisosConferidos);
}
