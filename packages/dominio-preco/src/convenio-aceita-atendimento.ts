// Convênio suspenso bloqueia novos atendimentos nas telas do novo (ficha do M12, regra 11; cap-06a §6.1). No
// legado, suspender não bloqueia nada (convênio inativo segue nas agendas); no novo, a agenda (M17) e a
// recepção perguntam por esta regra (public-api `cadastro.convenioAceitaAtendimento`). Situação fora de
// A/I (a coluna aceita NULL e não tem CHECK) não é adivinhada: não aceita, com o motivo.

export interface SituacaoDoConvenio {
  readonly codigo: number;
  readonly situacao: string | null;
}

export interface AceiteAtendimento {
  readonly aceita: boolean;
  readonly motivo: string | null;
}

export function convenioAceitaAtendimento(c: SituacaoDoConvenio | null): AceiteAtendimento {
  if (!c) return { aceita: false, motivo: 'Convênio não encontrado.' };
  const s = (c.situacao ?? '').trim();
  if (s === 'A') return { aceita: true, motivo: null };
  if (s === 'I')
    return {
      aceita: false,
      motivo: `Convênio ${c.codigo} suspenso: não aceita novo atendimento nem agendamento no sistema novo.`,
    };
  return {
    aceita: false,
    motivo: `Convênio ${c.codigo} com situação desconhecida: confira o cadastro antes de atender.`,
  };
}
