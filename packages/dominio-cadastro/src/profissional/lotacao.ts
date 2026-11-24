// Lotação do profissional no estabelecimento e na unidade (F3.1, 02-CAD linha 18): ocupação (CBO), carga horária
// semanal por tipo (ambulatorial, hospitalar e outras), vínculo de trabalho do cadastro nacional e vigência. É a base
// da ficha do profissional no cadastro nacional de estabelecimentos. Regras puras: a gravação só confere e grava.

export const CARGA_SEMANAL_MAXIMA = 168;

export interface LotacaoProposta {
  readonly estabelecimento: number;
  readonly unidade: number | null;
  readonly ocupacao: number;
  readonly cargaAmbulatorial: number;
  readonly cargaHospitalar: number;
  readonly cargaOutros: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

export interface LotacaoExistente {
  readonly id: number;
  readonly estabelecimento: number;
  readonly unidade: number | null;
  readonly ocupacao: number;
  readonly inicio: string;
  readonly fim: string | null;
  readonly cargaSemanal: number;
}

export const cargaSemanal = (
  l: Pick<LotacaoProposta, 'cargaAmbulatorial' | 'cargaHospitalar' | 'cargaOutros'>,
) => l.cargaAmbulatorial + l.cargaHospitalar + l.cargaOutros;

const inteiroHoras = (n: number) => Number.isInteger(n) && n >= 0 && n <= CARGA_SEMANAL_MAXIMA;

/** Erros da lotação proposta, todos de uma vez (a tela marca cada campo). */
export function errosLotacao(l: LotacaoProposta): string[] {
  const erros: string[] = [];
  if (![l.cargaAmbulatorial, l.cargaHospitalar, l.cargaOutros].every(inteiroHoras))
    erros.push('carga-invalida');
  else if (cargaSemanal(l) === 0) erros.push('carga-zerada');
  else if (cargaSemanal(l) > CARGA_SEMANAL_MAXIMA) erros.push('carga-acima-da-semana');
  if (l.vigenciaFim !== null && l.vigenciaFim < l.vigenciaInicio) erros.push('vigencia-invertida');
  return erros;
}

const sobrepoe = (aIni: string, aFim: string | null, bIni: string, bFim: string | null) =>
  (aFim === null || aFim >= bIni) && (bFim === null || bFim >= aIni);

/**
 * Aviso (sem bloqueio) acima desta carga semanal somada: o teto de 168 horas é só o físico; acima de 60 horas por
 * semana a jornada deixa de ser praticável para o mesmo profissional e a ficha do cadastro nacional costuma ser
 * questionada. A gravação passa; a tela mostra o aviso.
 */
export const CARGA_SEMANAL_ALTA = 60;

/** Carga somada das lotações que valem no dia `d` (a vigência inclui o início e o fim). */
export const cargaNoDia = (lotacoes: readonly LotacaoExistente[], d: string) =>
  lotacoes
    .filter((x) => x.inicio <= d && (x.fim === null || x.fim >= d))
    .reduce((s, x) => s + x.cargaSemanal, 0);

/**
 * Conflitos com as lotações já gravadas: a mesma ocupação no mesmo estabelecimento e unidade não pode ter duas
 * vigências que se cruzam (encerre a anterior). A carga é a MÁXIMA SIMULTÂNEA dentro do período da nova: a soma só
 * das lotações que valem ao mesmo tempo, conferida em cada ponto em que a carga pode subir (o início da nova e o
 * início de cada lotação dentro do período dela). Lotações sequenciais (uma termina antes de a outra começar) nunca
 * se somam. Acima da semana recusa; acima de CARGA_SEMANAL_ALTA só avisa.
 */
export function conflitosLotacao(
  existentes: readonly LotacaoExistente[],
  nova: LotacaoProposta,
): { sobrepostas: number[]; cargaNoPeriodo: number; excedeSemana: boolean; cargaAlta: boolean } {
  const noPeriodo = existentes.filter((x) =>
    sobrepoe(x.inicio, x.fim, nova.vigenciaInicio, nova.vigenciaFim),
  );
  const sobrepostas = noPeriodo
    .filter(
      (x) =>
        x.estabelecimento === nova.estabelecimento &&
        x.unidade === nova.unidade &&
        x.ocupacao === nova.ocupacao,
    )
    .map((x) => x.id);
  const pontos = new Set([nova.vigenciaInicio]);
  for (const x of noPeriodo) if (x.inicio > nova.vigenciaInicio) pontos.add(x.inicio);
  const maxima = Math.max(...[...pontos].map((d) => cargaNoDia(noPeriodo, d)));
  const cargaNoPeriodo = maxima + cargaSemanal(nova);
  return {
    sobrepostas,
    cargaNoPeriodo,
    excedeSemana: cargaNoPeriodo > CARGA_SEMANAL_MAXIMA,
    cargaAlta: cargaNoPeriodo > CARGA_SEMANAL_ALTA,
  };
}
