// Dados demográficos do paciente (F3.1, 02-CAD linha 15): nome social, raça/cor e povo indígena, capacidade civil e
// condições de vulnerabilidade. Regras puras: quem chama leu no banco o que os vocabulários pedem (a raça/cor que
// exige etnia, a capacidade que exige responsável legal) e a representação vigente do paciente.

/** O que a gravação dos dados demográficos precisa conferir, já com o que o vocabulário escolhido pede. */
export interface DemografiaConferida {
  readonly nome: string;
  readonly usaNomeSocial: boolean;
  readonly nomeSocial: string | null;
  /** Nulo: raça/cor não informada. Verdadeiro: a raça/cor escolhida exige a etnia (povo indígena). */
  readonly racaCorExigeEtnia: boolean | null;
  readonly temPovoIndigena: boolean;
  /** A língua indígena falada foi informada (só com a raça/cor que exige etnia; opcional mesmo nela). */
  readonly temIdiomaIndigena?: boolean;
  /** Nulo: capacidade civil não informada. Verdadeiro: a capacidade escolhida exige responsável legal. */
  readonly capacidadeExigeResponsavel: boolean | null;
  /** Há representante legal (responsável legal, guardião, tutor ou curador) vigente hoje no cadastro. */
  readonly temRepresentanteVigente: boolean;
}

export type ErroDemografia =
  | 'nome-social-exigido'
  | 'nome-social-igual-ao-nome'
  | 'povo-indigena-exigido'
  | 'povo-indigena-indevido'
  | 'idioma-indigena-indevido'
  | 'capacidade-sem-responsavel';

/** O campo da tela que cada recusa aponta. */
export const CAMPO_DO_ERRO_DEMOGRAFIA: Record<ErroDemografia, string> = {
  'nome-social-exigido': 'nomeSocial',
  'nome-social-igual-ao-nome': 'nomeSocial',
  'povo-indigena-exigido': 'povoIndigena',
  'povo-indigena-indevido': 'povoIndigena',
  'idioma-indigena-indevido': 'idiomaIndigena',
  'capacidade-sem-responsavel': 'capacidadeCivil',
};

const semAcento = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * As recusas da gravação, na ordem dos campos da tela (lista vazia: pode gravar).
 *   - quem usa nome social tem de informá-lo, e ele não repete o nome civil (o nome social guardado sem uso é aceito:
 *     a pessoa pode ter deixado de usar);
 *   - o povo indígena é informado sempre, e só, com a raça/cor que exige a etnia;
 *   - a língua indígena é opcional, e só com a raça/cor que exige a etnia;
 *   - a capacidade civil que exige responsável legal só é gravada com representante vigente no cadastro.
 */
export function errosDemografia(d: DemografiaConferida): ErroDemografia[] {
  const erros: ErroDemografia[] = [];
  const social = (d.nomeSocial ?? '').trim();
  if (d.usaNomeSocial && social === '') erros.push('nome-social-exigido');
  else if (social !== '' && semAcento(social) === semAcento(d.nome)) erros.push('nome-social-igual-ao-nome');
  if (d.racaCorExigeEtnia === true && !d.temPovoIndigena) erros.push('povo-indigena-exigido');
  if (d.racaCorExigeEtnia !== true && d.temPovoIndigena) erros.push('povo-indigena-indevido');
  if (d.racaCorExigeEtnia !== true && d.temIdiomaIndigena === true) erros.push('idioma-indigena-indevido');
  if (d.capacidadeExigeResponsavel === true && !d.temRepresentanteVigente)
    erros.push('capacidade-sem-responsavel');
  return erros;
}

/** O nome pelo qual a pessoa é chamada: o social quando usado, senão o civil. */
export const nomeDeTratamento = (nome: string, usaNomeSocial: boolean, nomeSocial: string | null): string =>
  usaNomeSocial && (nomeSocial ?? '').trim() !== '' ? (nomeSocial ?? '').trim() : nome;

// ── Condições de vulnerabilidade (declaradas com data e informante; encerradas com data, nunca apagadas) ──

export const INFORMANTES_VULNERABILIDADE = [
  'paciente',
  'responsavel',
  'familiar',
  'profissional',
  'servico_social',
  'outro',
] as const;
export type InformanteVulnerabilidade = (typeof INFORMANTES_VULNERABILIDADE)[number];

/** Informante que precisa do nome (quem declarou não é o próprio paciente nem o serviço). */
export const INFORMANTES_COM_NOME: readonly InformanteVulnerabilidade[] = [
  'responsavel',
  'familiar',
  'outro',
];

export interface VulnerabilidadeNova {
  readonly declaradaEm: string;
  readonly informanteTipo: string;
  readonly informanteNome: string | null;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Os campos recusados da declaração: data válida, não futura e não anterior ao nascimento; informante do vocabulário,
 * com o nome quando não é o paciente nem o serviço; `ja-vigente` quando a mesma condição já está vigente.
 */
export function errosVulnerabilidade(
  v: VulnerabilidadeNova,
  nascimento: string | null,
  hoje: string,
  jaVigente: boolean,
): string[] {
  const erros: string[] = [];
  if (jaVigente) erros.push('ja-vigente');
  if (
    !DATA.test(v.declaradaEm) ||
    v.declaradaEm > hoje ||
    (nascimento !== null && v.declaradaEm < nascimento)
  )
    erros.push('declaradaEm');
  const informante = v.informanteTipo as InformanteVulnerabilidade;
  if (!INFORMANTES_VULNERABILIDADE.includes(informante)) erros.push('informanteTipo');
  else if (INFORMANTES_COM_NOME.includes(informante) && (v.informanteNome ?? '').trim().length < 3)
    erros.push('informanteNome');
  return erros;
}

/** O fim da condição não é futuro nem anterior à declaração. */
export const recusaFimVulnerabilidade = (declaradaEm: string, fim: string, hoje: string): 'fim' | null =>
  !DATA.test(fim) || fim > hoje || fim < declaradaEm ? 'fim' : null;

/**
 * Dados sensíveis do bloco demográfico (LGPD, art. 5º, II: origem racial ou étnica, convicção religiosa, vida
 * sexual e saúde). Só saem para quem tem `cadastro.paciente.verSensivel`, como os sensíveis da ficha. A
 * identidade de gênero fica de fora: ela guia o nome social, que todo atendimento precisa usar.
 */
export const CAMPOS_SENSIVEIS_DEMOGRAFIA = [
  'racaCor',
  'povoIndigena',
  'idiomaIndigena',
  'religiao',
  'orientacaoSexual',
] as const;
export type CampoSensivelDemografia = (typeof CAMPOS_SENSIVEIS_DEMOGRAFIA)[number];

/**
 * A leitura para quem não vê dado sensível: os campos sensíveis vêm nulos, as declarações de vulnerabilidade e de
 * doença crônica vêm vazias, e `sensivelRestrito` diz à tela que o bloco está restrito ao perfil (não "vazio").
 */
export function restringirSensiveisDemografia<
  T extends Record<CampoSensivelDemografia, unknown> & {
    vulnerabilidades: readonly unknown[];
    condicoesCronicas: readonly unknown[];
  },
>(dados: T, verSensivel: boolean): T & { sensivelRestrito: boolean } {
  if (verSensivel) return { ...dados, sensivelRestrito: false };
  const r: T & { sensivelRestrito: boolean } = {
    ...dados,
    vulnerabilidades: [],
    condicoesCronicas: [],
    sensivelRestrito: true,
  };
  for (const c of CAMPOS_SENSIVEIS_DEMOGRAFIA) (r as Record<string, unknown>)[c] = null;
  return r;
}

/**
 * A gravação do bloco por quem não vê dado sensível: a tela não recebeu esses campos, então o que veio no pedido é
 * ignorado e o que está gravado continua (nunca apaga o que o perfil não pôde ver).
 */
export function manterSensiveisGravados<T extends Record<CampoSensivelDemografia, number | null>>(
  entrada: T,
  gravados: Record<CampoSensivelDemografia, number | null>,
  verSensivel: boolean,
): T {
  if (verSensivel) return entrada;
  const r = { ...entrada };
  for (const c of CAMPOS_SENSIVEIS_DEMOGRAFIA) (r as Record<string, number | null>)[c] = gravados[c];
  return r;
}
