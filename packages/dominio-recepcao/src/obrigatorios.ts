// Obrigatoriedades da recepção pelos parâmetros do hospital em que se grava (M19; ficha, regra 8; cap-05a §5.2): o
// legado lê o parâmetro da recepção do banco (uma linha por estabelecimento) e o novo segue o mesmo: o que é
// obrigatório na abertura do atendimento a partir da senha (M20), se o atendimento exige a senha, e se o painel
// antigo por endereço de rede está em uso (os setores que continuam no outro sistema). Os nomes de campo são do
// vocabulário do novo; a lista vem dos chave-usuários e vira caso de teste (obrigatorios.spec.ts, por hospital).

/** Parâmetros lidos (o valor bruto da coluna: 'T', 'F', 'S', 'N', número ou null). */
export type ParametrosRecepcao = Readonly<Record<string, string | number | null>>;

/** Coluna de obrigatoriedade → campo da abertura do atendimento. */
export const OBRIGATORIEDADES: readonly {
  readonly coluna: string;
  readonly campo: string;
  readonly rotulo: string;
}[] = [
  { coluna: 'DIG_SEG', campo: 'segurado', rotulo: 'Dados do segurado' },
  { coluna: 'DIG_CRM', campo: 'profissional', rotulo: 'Profissional do atendimento' },
  { coluna: 'DIG_CDC', campo: 'centroCusto', rotulo: 'Centro de custo' },
  { coluna: 'DIG_ATE', campo: 'tipoAtendimento', rotulo: 'Tipo de atendimento' },
  { coluna: 'DIG_TPAG', campo: 'tipoPagamento', rotulo: 'Tipo de pagamento' },
  { coluna: 'DIG_OBS_AGE', campo: 'observacaoAgenda', rotulo: 'Observação do agendamento' },
  { coluna: 'DIG_TIPO2', campo: 'tipoPaciente', rotulo: 'Tipo do paciente' },
  { coluna: 'DIG_TPAGEN', campo: 'tipoAgendamento', rotulo: 'Tipo de agendamento' },
  { coluna: 'DIG_GUIA', campo: 'guia', rotulo: 'Número da guia' },
  { coluna: 'DIG_TRAT', campo: 'tratamento', rotulo: 'Tratamento' },
  { coluna: 'DIG_NAT', campo: 'naturalidade', rotulo: 'Naturalidade' },
  { coluna: 'DIG_ENC', campo: 'encaminhamento', rotulo: 'Encaminhamento' },
  { coluna: 'DIG_NOME', campo: 'nomeSocial', rotulo: 'Nome' },
  { coluna: 'DIG_ESP', campo: 'especialidade', rotulo: 'Especialidade' },
  { coluna: 'DIG_PROCED', campo: 'procedencia', rotulo: 'Procedência' },
  { coluna: 'DIG_GRUPO', campo: 'grupoAtendimento', rotulo: 'Grupo de atendimento' },
  { coluna: 'DIG_MEDENC', campo: 'medicoEncaminhador', rotulo: 'Médico que encaminhou' },
  { coluna: 'DIG_ACP', campo: 'acompanhante', rotulo: 'Acompanhante' },
  { coluna: 'DIG_IDT', campo: 'identidade', rotulo: 'Identidade' },
  { coluna: 'DIG_OBS_ATE', campo: 'observacaoAtendimento', rotulo: 'Observação do atendimento' },
  { coluna: 'DIG_PLA', campo: 'plano', rotulo: 'Plano do convênio' },
  { coluna: 'DIG_DOCTO', campo: 'documento', rotulo: 'Documento' },
  { coluna: 'DIG_TERM', campo: 'termo', rotulo: 'Termo de consentimento' },
];

export interface ObrigatoriedadesRecepcao {
  /** Campos obrigatórios da abertura do atendimento, na ordem da lista. */
  readonly campos: readonly string[];
  /** O atendimento só abre a partir de uma senha (DIG_SENHA). */
  readonly exigeSenha: boolean;
  /** O painel antigo por endereço de rede está configurado (os setores no outro sistema continuam com ele). */
  readonly painelAntigo: boolean;
}

const sim = (v: string | number | null | undefined) => {
  const t = String(v ?? '')
    .trim()
    .toUpperCase();
  return t === 'T' || t === 'S';
};

export function obrigatoriedadesDaRecepcao(p: ParametrosRecepcao): ObrigatoriedadesRecepcao {
  return {
    campos: OBRIGATORIEDADES.filter((o) => sim(p[o.coluna])).map((o) => o.campo),
    exigeSenha: sim(p['DIG_SENHA']),
    painelAntigo: sim(p['PAINEL']) || String(p['PAINELTCPIP'] ?? '').trim() !== '',
  };
}

/** Campos obrigatórios que faltam na entrada (vazio, zero e nulo contam como faltando). */
export function camposFaltando(
  o: ObrigatoriedadesRecepcao,
  entrada: Readonly<Record<string, unknown>>,
): string[] {
  return o.campos.filter((c) => {
    const v = entrada[c];
    return v === undefined || v === null || v === '' || v === 0;
  });
}
