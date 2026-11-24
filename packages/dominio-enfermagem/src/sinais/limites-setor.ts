// Limites de alerta dos sinais vitais por setor, faixa etária, sexo e instrumento, e o detalhe da aferição (F3.3, linha
// 03-PEP L115). Regras puras, para a gravação própria usar quando ganhar o adaptador:
//   - o limite que vale é o mais específico entre os ativos que se aplicam (setor > estabelecimento > cliente;
//     instrumento informado > qualquer; faixa etária mais estreita); sem nenhum, vale a faixa do parâmetro;
//   - a classificação do valor: crítico fora dos limites extremos, atenção fora da faixa normal, normal dentro;
//   - o detalhe: local e posição exigidos quando o setor manda; "não aferido" só com motivo (e complemento quando o
//     motivo pede) e sem valor.

export interface LimiteParametro {
  readonly id: number;
  readonly estabelecimento: number | null;
  readonly setor: number | null;
  readonly instrumento: number | null;
  readonly sexo: 'ambos' | 'feminino' | 'masculino';
  readonly idadeMinimaDias: number;
  readonly idadeMaximaDias: number | null;
  readonly limiteInferior: number | null;
  readonly normalInferior: number | null;
  readonly normalSuperior: number | null;
  readonly limiteSuperior: number | null;
  readonly ativo: boolean;
}

export interface ContextoAfericao {
  readonly estabelecimento: number;
  readonly setor: number | null;
  readonly instrumento: number | null;
  readonly sexo: 'feminino' | 'masculino' | null;
  readonly idadeDias: number | null;
}

export type NivelAlerta = 'normal' | 'atencao' | 'critico';

function aplica(l: LimiteParametro, c: ContextoAfericao): boolean {
  if (!l.ativo) return false;
  if (l.estabelecimento !== null && l.estabelecimento !== c.estabelecimento) return false;
  if (l.setor !== null && l.setor !== c.setor) return false;
  if (l.instrumento !== null && l.instrumento !== c.instrumento) return false;
  if (l.sexo !== 'ambos' && l.sexo !== c.sexo) return false;
  if (c.idadeDias === null) return l.idadeMinimaDias === 0 && l.idadeMaximaDias === null;
  return c.idadeDias >= l.idadeMinimaDias && (l.idadeMaximaDias === null || c.idadeDias <= l.idadeMaximaDias);
}

function especificidade(l: LimiteParametro): [number, number] {
  const peso =
    (l.setor !== null ? 8 : 0) +
    (l.estabelecimento !== null ? 4 : 0) +
    (l.instrumento !== null ? 2 : 0) +
    (l.sexo !== 'ambos' ? 1 : 0);
  const largura = (l.idadeMaximaDias ?? 54_750) - l.idadeMinimaDias;
  return [peso, -largura];
}

/** O limite que vale para a aferição, ou null (vale a faixa do parâmetro). Empate: o de menor id (o mais antigo). */
export function escolherLimite(
  limites: readonly LimiteParametro[],
  c: ContextoAfericao,
): LimiteParametro | null {
  let melhor: LimiteParametro | null = null;
  for (const l of limites) {
    if (!aplica(l, c)) continue;
    if (!melhor) {
      melhor = l;
      continue;
    }
    const [a1, a2] = especificidade(l);
    const [b1, b2] = especificidade(melhor);
    if (a1 > b1 || (a1 === b1 && (a2 > b2 || (a2 === b2 && l.id < melhor.id)))) melhor = l;
  }
  return melhor;
}

/** Classificação do valor pelas faixas: crítico fora dos limites extremos, atenção fora do normal. */
export function classificarPeloLimite(
  valor: number,
  l: Pick<LimiteParametro, 'limiteInferior' | 'normalInferior' | 'normalSuperior' | 'limiteSuperior'>,
): NivelAlerta {
  if (
    (l.limiteInferior !== null && valor < l.limiteInferior) ||
    (l.limiteSuperior !== null && valor > l.limiteSuperior)
  )
    return 'critico';
  if (
    (l.normalInferior !== null && valor < l.normalInferior) ||
    (l.normalSuperior !== null && valor > l.normalSuperior)
  )
    return 'atencao';
  return 'normal';
}

export interface DetalheAfericao {
  readonly valor: number | null;
  readonly local: number | null;
  readonly posicao: number | null;
  readonly naoAferido: boolean;
  readonly motivoNaoAfericao: { readonly id: number; readonly exigeComplemento: boolean } | null;
  readonly justificativa: string | null;
}

export interface RegraSetorParametro {
  readonly exigeLocal: boolean;
  readonly exigePosicao: boolean;
}

export interface ErroAfericao {
  readonly campo: string;
  readonly codigo: string;
  readonly mensagem: string;
}

/** Conferência do detalhe da aferição antes de gravar (na tela, na hora; na API, de novo). */
export function conferirDetalheAfericao(
  d: DetalheAfericao,
  regra: RegraSetorParametro | null,
): ErroAfericao[] {
  const r: ErroAfericao[] = [];
  if (d.naoAferido) {
    if (d.valor !== null)
      r.push({ campo: 'valor', codigo: 'nao-aferido-com-valor', mensagem: 'Não aferido não leva valor.' });
    if (!d.motivoNaoAfericao)
      r.push({ campo: 'motivo', codigo: 'motivo-obrigatorio', mensagem: 'Informe o motivo de não aferir.' });
    else if (d.motivoNaoAfericao.exigeComplemento && !(d.justificativa ?? '').trim())
      r.push({
        campo: 'justificativa',
        codigo: 'complemento-obrigatorio',
        mensagem: 'Este motivo pede um complemento.',
      });
    return r;
  }
  if (d.valor === null)
    r.push({ campo: 'valor', codigo: 'valor-obrigatorio', mensagem: 'Informe o valor aferido.' });
  if (d.motivoNaoAfericao)
    r.push({
      campo: 'motivo',
      codigo: 'motivo-sem-nao-aferido',
      mensagem: 'O motivo só vale para não aferido.',
    });
  if (regra?.exigeLocal && d.local === null)
    r.push({
      campo: 'local',
      codigo: 'local-obrigatorio',
      mensagem: 'Este setor exige o local da aferição.',
    });
  if (regra?.exigePosicao && d.posicao === null)
    r.push({
      campo: 'posicao',
      codigo: 'posicao-obrigatoria',
      mensagem: 'Este setor exige a posição do paciente.',
    });
  return r;
}
