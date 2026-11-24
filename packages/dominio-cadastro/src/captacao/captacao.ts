// Origem e indicação do paciente (F3.1, 02-CAD linha 12): de onde o paciente veio e quem indicou. Fonte única da regra
// de quem indicou: o tipo de indicação que o hospital mantém (domínio tipo_indicacao: categoria, exige o profissional,
// exige o complemento). O canal é só o meio por onde o contato chegou (site, telefone, campanha...), e o único canal
// com exigência própria é a campanha (o nome dela). O captado tem de ser identificado (paciente, pré-cadastro ou
// contato) e ninguém indica a si mesmo. Vocabulário neutro: ids, booleanos e texto.

export const CANAIS_CAPTACAO = [
  'indicacao_profissional',
  'indicacao_paciente',
  'parceiro',
  'campanha',
  'site',
  'telefone',
  'redes_sociais',
  'espontaneo',
  'outro',
] as const;
export type CanalCaptacao = (typeof CANAIS_CAPTACAO)[number];

/** O tipo de indicação como o hospital o cadastrou (lido do domínio na gravação). */
export interface TipoIndicacaoRegra {
  readonly id: number;
  readonly ativo: boolean;
  readonly categoria: string;
  readonly exigeProfissional: boolean;
  readonly exigeComplemento: boolean;
}

export interface CaptacaoProposta {
  readonly canal: CanalCaptacao;
  /** Obrigatório (a coluna é NOT NULL): null quando o id informado não existe no domínio. */
  readonly tipoIndicacao: TipoIndicacaoRegra | null;
  readonly paciente?: number | null;
  readonly preCadastro?: number | null;
  readonly contatoNome?: string | null;
  readonly indicadorProfissional?: number | null;
  readonly indicadorPaciente?: number | null;
  readonly parceiro?: number | null;
  readonly indicadorNome?: string | null;
  readonly campanha?: string | null;
}

export interface RecusaCaptacao {
  readonly codigo: string;
  readonly campo: string;
  readonly mensagem: string;
}

const preenchido = (t: string | null | undefined): boolean => (t ?? '').trim().length > 0;

/** Confere a captação proposta; devolve a lista de recusas (vazia quando pode gravar). */
export function conferirCaptacao(c: CaptacaoProposta): RecusaCaptacao[] {
  const r: RecusaCaptacao[] = [];
  if (!c.paciente && !c.preCadastro && !preenchido(c.contatoNome))
    r.push({
      codigo: 'captado-obrigatorio',
      campo: 'paciente',
      mensagem: 'Informe o paciente, o pré-cadastro ou o nome do contato captado.',
    });
  const t = c.tipoIndicacao;
  if (!t || !t.ativo)
    r.push({
      codigo: 'tipo-indicacao-obrigatorio',
      campo: 'tipoIndicacao',
      mensagem: 'Escolha um tipo de indicação ativo no cadastro do hospital.',
    });
  else {
    if (t.exigeProfissional && !c.indicadorProfissional)
      r.push({
        codigo: 'indicador-obrigatorio',
        campo: 'indicadorProfissional',
        mensagem: 'Este tipo de indicação pede o profissional que indicou.',
      });
    if (t.exigeComplemento && !preenchido(c.indicadorNome) && !c.indicadorPaciente && !c.parceiro)
      r.push({
        codigo: 'complemento-obrigatorio',
        campo: 'indicadorNome',
        mensagem:
          'Este tipo de indicação pede quem indicou: escolha o paciente, o parceiro ou escreva o nome.',
      });
  }
  if (c.canal === 'campanha' && !preenchido(c.campanha))
    r.push({
      codigo: 'campanha-obrigatoria',
      campo: 'campanha',
      mensagem: 'Escreva o nome da campanha.',
    });
  if (c.paciente && c.indicadorPaciente && c.paciente === c.indicadorPaciente)
    r.push({
      codigo: 'autoindicacao',
      campo: 'indicadorPaciente',
      mensagem: 'O paciente não pode indicar a si mesmo.',
    });
  return r;
}

/** Totais por canal, na ordem dos canais (para a consulta e o indicador por origem). */
export function totaisPorCanal(
  linhas: readonly { readonly canal: string; readonly total: number }[],
): { canal: CanalCaptacao; total: number }[] {
  const m = new Map(linhas.map((l) => [l.canal, l.total]));
  return CANAIS_CAPTACAO.map((canal) => ({ canal, total: m.get(canal) ?? 0 }));
}
