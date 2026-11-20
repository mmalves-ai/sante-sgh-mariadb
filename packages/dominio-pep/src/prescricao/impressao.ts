// Prescrição impressa (M24; ficha, seção 10 "Documento"): as linhas do corpo do documento em PDF/A emitido pelo serviço
// de emissão (M09), item a item na ordem da prescrição, com a dose, a via, a frequência, os horários previstos
// (hora e situação), o que foi incluído depois, o suspenso (com a situação) e a observação para a enfermagem. Puro.

export interface HorarioImpresso {
  readonly dataHora: string;
  /** Rótulo da situação da checagem (Prescrito, Suspenso…). */
  readonly rotulo: string;
}

export interface ItemImpresso {
  readonly tipoNome: string;
  readonly descricao: string;
  readonly dose: string | null;
  readonly via: string | null;
  readonly frequencia: string | null;
  readonly situacao: 'ativo' | 'suspenso' | 'suspenso-correcao' | 'vencido';
  readonly incluidoDepois: boolean;
  readonly observacaoEnfermagem: string | null;
  readonly horarios: readonly HorarioImpresso[];
}

const SITUACAO: Readonly<Record<ItemImpresso['situacao'], string | null>> = {
  ativo: null,
  suspenso: 'Suspenso',
  'suspenso-correcao': 'Suspenso por correção',
  vencido: 'Vencido',
};

/** HH:MM de um carimbo local (AAAA-MM-DDTHH:MM[:SS]). */
function hora(s: string): string {
  return /T(\d{2}:\d{2})/.exec(s)?.[1] ?? s;
}

/** Linhas do corpo: "1) Tipo: descrição — dose — via — frequência", os horários e as marcas do item. */
export function linhasDaPrescricaoImpressa(
  itens: readonly ItemImpresso[],
  observacaoGeral: string | null,
): string[] {
  const linhas: string[] = [];
  itens.forEach((i, n) => {
    const partes = [i.dose, i.via, i.frequencia].filter((x): x is string => !!x && x.trim() !== '');
    const marcas = [SITUACAO[i.situacao], i.incluidoDepois ? 'Incluído depois' : null].filter(
      (x): x is string => x !== null,
    );
    linhas.push(
      `${n + 1}) ${i.tipoNome}: ${i.descricao}${partes.length ? ` — ${partes.join(' — ')}` : ''}${
        marcas.length ? ` (${marcas.join('; ')})` : ''
      }`,
    );
    if (i.horarios.length)
      linhas.push(`   Horários: ${i.horarios.map((h) => `${hora(h.dataHora)} ${h.rotulo}`).join(' · ')}`);
    if (i.observacaoEnfermagem) linhas.push(`   Para a enfermagem: ${i.observacaoEnfermagem}`);
  });
  if (observacaoGeral) linhas.push(`Observação: ${observacaoGeral}`);
  return linhas;
}
