// Reação transfusional e hemovigilância (ficha do M47, regra 5; cap-05b §5.11 "Reação transfusional e
// retrovigilância"): registro, conduta, devolução ou descarte da bolsa; toda reação gera a sugestão de notificação ao
// núcleo de segurança do paciente (M48) e os campos da notificação de hemovigilância para a digitação no portal da
// Anvisa (DP-47.8: sem API conhecida; exportação dos campos). Grave (grau 3) e óbito (grau 4) são prioridade imediata.
import {
  type CondutaReacao,
  type CorrelacaoReacao,
  type DestinoBolsaReacao,
  type GrauReacao,
  rotuloTipoReacao,
  TIPOS_REACAO_TRANSFUSIONAL,
  type TipoReacaoTransfusional,
} from '@sgh/contratos';

export type ProblemaReacao =
  | 'ato-sem-inicio'
  | 'reacao-antes-do-inicio'
  | 'em-curso-sem-interromper'
  | 'destino-obrigatorio'
  | 'obito-sem-grau-4';

export const MENSAGENS_REACAO: Readonly<Record<ProblemaReacao, string>> = {
  'ato-sem-inicio': 'A reação é registrada sobre uma transfusão iniciada.',
  'reacao-antes-do-inicio': 'O início da reação não pode ser antes do início da transfusão.',
  'em-curso-sem-interromper': 'Com a transfusão em curso, a primeira conduta é interrompê-la.',
  'destino-obrigatorio': 'Diga se a bolsa foi devolvida à agência ou descartada.',
  'obito-sem-grau-4': 'Correlação com óbito exige o grau 4.',
};

/** Regra 5: conferência do registro da reação. */
export function conferirReacao(c: {
  readonly atoIniciadoEm: string | null;
  readonly atoEmCurso: boolean;
  readonly inicioReacaoEm: string;
  readonly tipo: TipoReacaoTransfusional;
  readonly grau: GrauReacao;
  readonly condutas: readonly CondutaReacao[];
  readonly destinoBolsa: DestinoBolsaReacao;
  readonly obito: boolean;
}): readonly ProblemaReacao[] {
  const p: ProblemaReacao[] = [];
  if (c.atoIniciadoEm === null) p.push('ato-sem-inicio');
  else if (c.inicioReacaoEm < c.atoIniciadoEm) p.push('reacao-antes-do-inicio');
  if (c.atoEmCurso && !c.condutas.includes('interromperTransfusao')) p.push('em-curso-sem-interromper');
  const imediata = TIPOS_REACAO_TRANSFUSIONAL.find((t) => t.codigo === c.tipo)?.tempo === 'imediata';
  if (imediata && c.atoEmCurso && c.destinoBolsa === 'naoSeAplica') p.push('destino-obrigatorio');
  if (c.obito && c.grau !== 4) p.push('obito-sem-grau-4');
  return p;
}

export interface SugestaoNotificacao {
  readonly sugerida: true;
  readonly prioridade: 'imediata' | 'rotina';
  /** Evento de hemovigilância para o núcleo de segurança (M48). */
  readonly categoria: 'hemovigilancia';
  readonly titulo: string;
  /** A bolsa deixa o estoque (descarte ou devolução): vai ao evento BOLSA_DESCARTADA. */
  readonly bolsaSaiDoEstoque: boolean;
}

/** Toda reação sugere a notificação; grau 3 ou 4, ou correlação confirmada com grau 2+, é imediata. */
export function sugestaoDeNotificacao(c: {
  readonly tipo: TipoReacaoTransfusional;
  readonly grau: GrauReacao;
  readonly correlacao: CorrelacaoReacao;
  readonly destinoBolsa: DestinoBolsaReacao;
}): SugestaoNotificacao {
  const imediata = c.grau >= 3 || (c.correlacao === 'confirmada' && c.grau >= 2);
  return {
    sugerida: true,
    prioridade: imediata ? 'imediata' : 'rotina',
    categoria: 'hemovigilancia',
    titulo: `Reação transfusional: ${rotuloTipoReacao(c.tipo)} (grau ${c.grau})`,
    bolsaSaiDoEstoque: c.destinoBolsa !== 'naoSeAplica',
  };
}

/** Os campos para a notificação de hemovigilância (digitados no portal; nada vai sozinho para fora). */
export interface CamposNotificacaoHemovigilancia {
  readonly dataTransfusao: string;
  readonly dataReacao: string;
  readonly hemocomponente: string;
  readonly numeroBolsa: string;
  readonly tipoReacao: string;
  readonly tempo: 'imediata' | 'tardia';
  readonly gravidade: GrauReacao;
  readonly correlacao: CorrelacaoReacao;
  readonly sinaisESintomas: string;
  readonly condutas: readonly CondutaReacao[];
  /** Identificação mínima do paciente do formulário (iniciais, sexo, idade): sem nome nem documento. */
  readonly paciente: {
    readonly iniciais: string;
    readonly sexo: 'F' | 'M' | 'I';
    readonly idade: number | null;
  };
}

/** Iniciais do nome (só as letras iniciais das palavras com 3 letras ou mais). */
export function iniciais(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[^\p{L}\s]/gu, '')
    .split(/\s+/)
    .filter((p) => p.length >= 3)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function camposNotificacao(c: {
  readonly inicioTransfusaoEm: string;
  readonly inicioReacaoEm: string;
  readonly hemocomponente: string;
  readonly numeroBolsa: string;
  readonly tipo: TipoReacaoTransfusional;
  readonly descricaoOutra: string | null;
  readonly grau: GrauReacao;
  readonly correlacao: CorrelacaoReacao;
  readonly sinaisESintomas: string;
  readonly condutas: readonly CondutaReacao[];
  readonly nomePaciente: string;
  readonly sexo: 'F' | 'M' | 'I';
  readonly idade: number | null;
}): CamposNotificacaoHemovigilancia {
  const t = TIPOS_REACAO_TRANSFUSIONAL.find((x) => x.codigo === c.tipo);
  return {
    dataTransfusao: c.inicioTransfusaoEm.slice(0, 10),
    dataReacao: c.inicioReacaoEm.slice(0, 10),
    hemocomponente: c.hemocomponente,
    numeroBolsa: c.numeroBolsa,
    tipoReacao:
      c.tipo === 'outra' && c.descricaoOutra ? `Outra: ${c.descricaoOutra}` : rotuloTipoReacao(c.tipo),
    tempo: t?.tempo ?? 'imediata',
    gravidade: c.grau,
    correlacao: c.correlacao,
    sinaisESintomas: c.sinaisESintomas,
    condutas: c.condutas,
    paciente: { iniciais: iniciais(c.nomePaciente), sexo: c.sexo, idade: c.idade },
  };
}
