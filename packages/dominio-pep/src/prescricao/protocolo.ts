// Protocolos e kits (regra 2 da ficha do M24; cap-05b §5.7): aplicar um protocolo cria itens próprios na prescrição
// e guarda o vínculo prescrição × protocolo só para indicador (o gatilho do item recusa item que é de prescrição e
// de protocolo ao mesmo tempo); o protocolo vale para a idade, o peso, o sexo e a vigência cadastrados; os campos
// trazidos do protocolo ficam marcados como preenchidos automaticamente.

export interface ProtocoloCadastro {
  readonly id: number;
  readonly nome: string;
  readonly ativo: boolean;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
  readonly idadeMin: number | null;
  readonly idadeMax: number | null;
  readonly pesoMin: number | null;
  readonly pesoMax: number | null;
  /** 'M', 'F' ou null (ambos). */
  readonly sexo: string | null;
  /** Especialidades do protocolo; vazio: qualquer especialidade. */
  readonly especialidades?: readonly number[];
}

export interface PacienteProtocolo {
  readonly idade: number | null;
  readonly peso: number | null;
  readonly sexo: 'F' | 'M' | null;
}

/**
 * O protocolo vale para este paciente e este prescritor? Ativo, vigente, do sexo, da faixa de idade e de peso do
 * paciente (o dado ausente não recusa) e da especialidade do prescritor (`especialidades` null: não conferida).
 */
export function aplicabilidade(
  p: ProtocoloCadastro,
  pac: PacienteProtocolo,
  hoje: string,
  especialidades: readonly number[] | null = null,
): { aplicavel: boolean; motivo: string | null } {
  if (!p.ativo) return { aplicavel: false, motivo: 'Protocolo inativo.' };
  if (p.vigenciaInicio && hoje < p.vigenciaInicio.slice(0, 10))
    return { aplicavel: false, motivo: 'Protocolo ainda não vigente.' };
  if (p.vigenciaFim && hoje > p.vigenciaFim.slice(0, 10))
    return { aplicavel: false, motivo: 'Protocolo com vigência encerrada.' };
  const s = (p.sexo ?? '').trim().toUpperCase();
  if ((s === 'M' || s === 'F') && pac.sexo && pac.sexo !== s)
    return { aplicavel: false, motivo: 'Protocolo de outro sexo.' };
  if (pac.idade !== null) {
    if (p.idadeMin !== null && p.idadeMin > 0 && pac.idade < p.idadeMin)
      return { aplicavel: false, motivo: `Protocolo a partir de ${p.idadeMin} anos.` };
    if (p.idadeMax !== null && p.idadeMax > 0 && pac.idade > p.idadeMax)
      return { aplicavel: false, motivo: `Protocolo até ${p.idadeMax} anos.` };
  }
  if (pac.peso !== null) {
    if (p.pesoMin !== null && p.pesoMin > 0 && pac.peso < p.pesoMin)
      return { aplicavel: false, motivo: `Protocolo a partir de ${p.pesoMin} kg.` };
    if (p.pesoMax !== null && p.pesoMax > 0 && pac.peso > p.pesoMax)
      return { aplicavel: false, motivo: `Protocolo até ${p.pesoMax} kg.` };
  }
  const doProtocolo = p.especialidades ?? [];
  if (
    especialidades !== null &&
    doProtocolo.length > 0 &&
    !doProtocolo.some((e) => especialidades.includes(e))
  )
    return { aplicavel: false, motivo: 'Protocolo de outra especialidade.' };
  return { aplicavel: true, motivo: null };
}

/** O item tirado do protocolo vira item da prescrição (sem o vínculo de pertença) com a marca do protocolo. */
export function itemDoProtocolo<T extends { readonly chave: string }>(
  modelo: T,
  protocolo: number,
  sequencia: number,
): T & { readonly protocolo: number; readonly autopreenchido: readonly ['dose'] } {
  return { ...modelo, chave: `protocolo-${protocolo}-${sequencia}`, protocolo, autopreenchido: ['dose'] };
}

/** O vínculo de pertença do item é exclusivo: de prescrição OU de protocolo (paridade com o gatilho). */
export function pertencaValida(prescricao: number | null, protocolo: number | null): boolean {
  return !((prescricao ?? 0) > 0 && (protocolo ?? 0) > 0);
}
