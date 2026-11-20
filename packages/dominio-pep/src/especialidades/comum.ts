// Apoio comum das especialidades sob demanda (M45, etapa 6): a recusa de negócio com o código (a API devolve 409 com
// ele), o arredondamento e o relógio civil "AAAA-MM-DDTHH:MM" (sem fuso: o relógio do estabelecimento).

export type CodigoRecusaEspecialidade =
  | 'valor-desconhecido'
  | 'exame-vazio'
  | 'exame-repetido'
  | 'metodo-pio-ausente'
  | 'protocolo-sem-farmaco'
  | 'dia-fora-do-ciclo'
  | 'farmaco-repetido'
  | 'protocolo-identico'
  | 'protocolo-substituido'
  | 'ciclo-alem-do-protocolo'
  | 'ciclo-repetido'
  | 'novo-tratamento-fora-do-ciclo-1'
  | 'novo-tratamento-sem-anterior'
  | 'prescricao-ja-vinculada'
  | 'prescricao-fora-do-ciclo'
  | 'prescricao-suspensa'
  | 'ciclo-sem-prescricao'
  | 'ciclo-fora-de-sequencia'
  | 'data-antes-do-anterior'
  | 'intervalo-curto'
  | 'creatinina-ausente'
  | 'motivo-reducao'
  | 'ciclo-ja-validado'
  | 'validador-e-prescritor'
  | 'doses-incompletas'
  | 'dose-divergente'
  | 'registro-vazio'
  | 'liquido-sem-bolsa-rota'
  | 'instante-futuro'
  | 'antes-da-admissao'
  | 'pressao-invertida'
  | 'apgar10-ausente'
  | 'mae-nao-feminina'
  | 'horario-repetido'
  | 'horario-apos-validade'
  | 'horario-antes-do-preparo'
  | 'ordem-ja-conferida'
  | 'conferente-e-preparador'
  | 'ordem-nao-conferida'
  | 'ordem-vencida'
  | 'internacao-encerrada'
  // W0-05: o ciclo de vida do protocolo e do ciclo e a alteração da ordem do lactário.
  | 'versao-revogada'
  | 'protocolo-inativo'
  | 'ciclo-interrompido'
  | 'ordem-cancelada'
  // W0-05 revisão: o ajuste com a prescrição ligada, a data depois do ciclo seguinte e a prescrição fora do dia.
  | 'ciclo-com-prescricao'
  | 'data-depois-do-seguinte'
  | 'prescricao-fora-do-dia';

export class ErroEspecialidade extends Error {
  override readonly name = 'ErroEspecialidade';
  readonly codigo: CodigoRecusaEspecialidade;
  constructor(codigo: CodigoRecusaEspecialidade, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

export const recusar = (codigo: CodigoRecusaEspecialidade, mensagem: string): never => {
  throw new ErroEspecialidade(codigo, mensagem);
};

/** Arredonda em `casas` casas decimais (meio para cima, sem o erro do ponto flutuante em 1,005). */
export function arredondar(x: number, casas = 1): number {
  const f = 10 ** casas;
  return Math.round((x + Number.EPSILON) * f) / f;
}

/** Número com vírgula decimal e as casas pedidas (as contas impressas na tela). */
export function decimalBr(x: number, casas = 1): string {
  return arredondar(x, casas).toFixed(casas).replace('.', ',');
}

const MS_MIN = 60_000;
const instante = (civil: string) => Date.parse(`${civil.length === 10 ? `${civil}T00:00` : civil}:00Z`);

/** Minutos de `de` até `ate` (instantes civis "AAAA-MM-DDTHH:MM" ou datas "AAAA-MM-DD"). */
export function minutosEntreCivis(de: string, ate: string): number {
  return Math.round((instante(ate) - instante(de)) / MS_MIN);
}

/** O instante civil `h` horas depois de `civil` ("AAAA-MM-DDTHH:MM"). */
export function somarHorasCivil(civil: string, h: number): string {
  return new Date(instante(civil) + h * 3_600_000).toISOString().slice(0, 16);
}

/** Idade em anos completos no dia (null sem nascimento). */
export function idadeEmAnos(nascimento: string | null, hoje: string): number | null {
  if (!nascimento || !/^\d{4}-\d{2}-\d{2}/.test(nascimento) || nascimento.startsWith('1899-12-30'))
    return null;
  const [a, m, d] = nascimento.slice(0, 10).split('-').map(Number) as [number, number, number];
  const [ha, hm, hd] = hoje.slice(0, 10).split('-').map(Number) as [number, number, number];
  let idade = ha - a;
  if (hm < m || (hm === m && hd < d)) idade -= 1;
  return idade < 0 ? null : idade;
}
