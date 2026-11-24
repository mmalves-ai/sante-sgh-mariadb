// Origem e indicação do paciente (F3.1, 02-CAD linha 12): de onde o paciente veio (canal) e quem indicou. A regra fica
// no domínio: cada canal exige o seu indicador (profissional, paciente, parceiro ou campanha), o captado tem de ser
// identificado (paciente, pré-cadastro ou contato) e ninguém indica a si mesmo. Vocabulário neutro: ids e texto.

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

export interface CaptacaoProposta {
  readonly canal: CanalCaptacao;
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
  switch (c.canal) {
    case 'indicacao_profissional':
      if (!c.indicadorProfissional && !preenchido(c.indicadorNome))
        r.push({
          codigo: 'indicador-obrigatorio',
          campo: 'indicadorProfissional',
          mensagem: 'Indicação de profissional: escolha o profissional ou escreva o nome de quem indicou.',
        });
      break;
    case 'indicacao_paciente':
      if (!c.indicadorPaciente && !preenchido(c.indicadorNome))
        r.push({
          codigo: 'indicador-obrigatorio',
          campo: 'indicadorPaciente',
          mensagem: 'Indicação de paciente: escolha o paciente ou escreva o nome de quem indicou.',
        });
      break;
    case 'parceiro':
      if (!c.parceiro && !preenchido(c.indicadorNome))
        r.push({
          codigo: 'indicador-obrigatorio',
          campo: 'parceiro',
          mensagem: 'Parceiro: escolha a empresa parceira ou escreva o nome dela.',
        });
      break;
    case 'campanha':
      if (!preenchido(c.campanha))
        r.push({
          codigo: 'campanha-obrigatoria',
          campo: 'campanha',
          mensagem: 'Escreva o nome da campanha.',
        });
      break;
    default:
      break;
  }
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
