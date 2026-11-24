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
 * Conflitos com as lotações já gravadas: a mesma ocupação no mesmo estabelecimento e unidade não pode ter duas
 * vigências que se cruzam (encerre a anterior). A soma das cargas que valem no início da nova não passa da semana.
 */
export function conflitosLotacao(
  existentes: readonly LotacaoExistente[],
  nova: LotacaoProposta,
): { sobrepostas: number[]; cargaNoPeriodo: number; excedeSemana: boolean } {
  const sobrepostas = existentes
    .filter(
      (x) =>
        x.estabelecimento === nova.estabelecimento &&
        x.unidade === nova.unidade &&
        x.ocupacao === nova.ocupacao &&
        sobrepoe(x.inicio, x.fim, nova.vigenciaInicio, nova.vigenciaFim),
    )
    .map((x) => x.id);
  const cargaNoPeriodo =
    existentes
      .filter((x) => sobrepoe(x.inicio, x.fim, nova.vigenciaInicio, nova.vigenciaFim))
      .reduce((s, x) => s + x.cargaSemanal, 0) + cargaSemanal(nova);
  return { sobrepostas, cargaNoPeriodo, excedeSemana: cargaNoPeriodo > CARGA_SEMANAL_MAXIMA };
}
