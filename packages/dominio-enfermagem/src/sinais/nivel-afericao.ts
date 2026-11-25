// Nível de alerta de cada valor aferido e cadastro dos limites (F3.3, linha 03-PEP L115). Regras puras:
//   - o nível do valor vem do limite mais específico que se aplica (escolherLimite); sem nenhum, da faixa de alerta do
//     parâmetro (fora dela, atenção); valor não aferido não tem nível;
//   - o limite cadastrado respeita a ordem crítico inferior <= normal inferior <= normal superior <= crítico superior,
//     com pelo menos uma das quatro faixas, e a faixa etária em ordem (conferido na tela, na API e pelo banco);
//   - limites padrão do adulto pelo NEWS2 (Royal College of Physicians, 2017): normal = faixa que pontua 0; crítico =
//     faixa que pontua 3 sozinha (a que pede resposta imediata). Servem de ponto de partida do estabelecimento.
import {
  classificarPeloLimite,
  type ContextoAfericao,
  type ErroAfericao,
  escolherLimite,
  type LimiteParametro,
  type NivelAlerta,
} from './limites-setor.js';

export interface FaixaDoParametro {
  readonly alertaMinimo: number | null;
  readonly alertaMaximo: number | null;
}

export interface NivelCalculado {
  readonly nivel: NivelAlerta;
  /** O limite cadastrado que decidiu; null quando valeu a faixa do parâmetro. */
  readonly limite: number | null;
}

/** O nível de alerta do valor aferido, pelo limite que vale para o contexto ou, sem limite, pela faixa do parâmetro. */
export function nivelDaAfericao(
  valor: number,
  limites: readonly LimiteParametro[],
  contexto: ContextoAfericao,
  faixa: FaixaDoParametro,
): NivelCalculado {
  const l = escolherLimite(limites, contexto);
  if (l) return { nivel: classificarPeloLimite(valor, l), limite: l.id };
  const fora =
    (faixa.alertaMinimo !== null && valor < faixa.alertaMinimo) ||
    (faixa.alertaMaximo !== null && valor > faixa.alertaMaximo);
  return { nivel: fora ? 'atencao' : 'normal', limite: null };
}

/** Idade em dias completos na data da aferição (para a faixa etária do limite); null sem a data de nascimento. */
export function idadeEmDias(nascimento: string | null, aferidoEm: string): number | null {
  if (!nascimento || !/^\d{4}-\d{2}-\d{2}/.test(nascimento)) return null;
  const n = Date.UTC(+nascimento.slice(0, 4), +nascimento.slice(5, 7) - 1, +nascimento.slice(8, 10));
  const a = Date.UTC(+aferidoEm.slice(0, 4), +aferidoEm.slice(5, 7) - 1, +aferidoEm.slice(8, 10));
  const d = Math.floor((a - n) / 86_400_000);
  return d < 0 ? null : d;
}

export interface LimiteEntrada {
  readonly sexo: 'ambos' | 'feminino' | 'masculino';
  readonly idadeMinimaDias: number;
  readonly idadeMaximaDias: number | null;
  readonly limiteInferior: number | null;
  readonly normalInferior: number | null;
  readonly normalSuperior: number | null;
  readonly limiteSuperior: number | null;
}

/** Conferência do limite antes de gravar: faixas em ordem, ao menos uma informada, faixa etária em ordem. */
export function conferirLimite(l: LimiteEntrada): ErroAfericao[] {
  const r: ErroAfericao[] = [];
  const faixas = [l.limiteInferior, l.normalInferior, l.normalSuperior, l.limiteSuperior];
  if (faixas.every((x) => x === null))
    r.push({ campo: 'normalInferior', codigo: 'limite-vazio', mensagem: 'Informe ao menos uma das faixas.' });
  const par = (a: number | null, b: number | null, campo: string, codigo: string, mensagem: string) => {
    if (a !== null && b !== null && a > b) r.push({ campo, codigo, mensagem });
  };
  par(
    l.limiteInferior,
    l.normalInferior,
    'limiteInferior',
    'critico-inferior-acima-do-normal',
    'O crítico inferior não pode passar do normal inferior.',
  );
  par(
    l.normalInferior,
    l.normalSuperior,
    'normalSuperior',
    'normal-invertido',
    'O normal inferior não pode passar do normal superior.',
  );
  par(
    l.normalSuperior,
    l.limiteSuperior,
    'limiteSuperior',
    'critico-superior-abaixo-do-normal',
    'O crítico superior não pode ficar abaixo do normal superior.',
  );
  par(
    l.limiteInferior,
    l.limiteSuperior,
    'limiteSuperior',
    'critico-invertido',
    'O crítico inferior não pode passar do crítico superior.',
  );
  if (l.idadeMinimaDias < 0 || !Number.isInteger(l.idadeMinimaDias))
    r.push({
      campo: 'idadeMinimaDias',
      codigo: 'idade-invalida',
      mensagem: 'A idade mínima é em dias inteiros.',
    });
  if (l.idadeMaximaDias !== null && l.idadeMaximaDias < l.idadeMinimaDias)
    r.push({
      campo: 'idadeMaximaDias',
      codigo: 'idade-invertida',
      mensagem: 'A idade máxima não pode ficar abaixo da mínima.',
    });
  return r;
}

/** Limites padrão do adulto (18 anos ou mais) pelo NEWS2, por código do parâmetro vital. */
export const LIMITES_PADRAO_NEWS2: Readonly<
  Record<'fr' | 'spo2' | 'pas' | 'fc' | 'temperatura', Omit<LimiteEntrada, 'sexo' | 'idadeMaximaDias'>>
> = {
  // FR: 0 ponto de 12 a 20; 3 pontos com 8 ou menos e com 25 ou mais.
  fr: {
    idadeMinimaDias: 6575,
    limiteInferior: 9,
    normalInferior: 12,
    normalSuperior: 20,
    limiteSuperior: 24,
  },
  // SpO2 (escala 1): 0 ponto com 96 ou mais; 3 pontos com 91 ou menos.
  spo2: {
    idadeMinimaDias: 6575,
    limiteInferior: 92,
    normalInferior: 96,
    normalSuperior: null,
    limiteSuperior: null,
  },
  // PAS: 0 ponto de 111 a 219; 3 pontos com 90 ou menos e com 220 ou mais.
  pas: {
    idadeMinimaDias: 6575,
    limiteInferior: 91,
    normalInferior: 111,
    normalSuperior: 219,
    limiteSuperior: 219,
  },
  // FC: 0 ponto de 51 a 90; 3 pontos com 40 ou menos e com 131 ou mais.
  fc: {
    idadeMinimaDias: 6575,
    limiteInferior: 41,
    normalInferior: 51,
    normalSuperior: 90,
    limiteSuperior: 130,
  },
  // Temperatura: 0 ponto de 36,1 a 38,0; 3 pontos com 35,0 ou menos (a febre pontua no máximo 2: atenção).
  temperatura: {
    idadeMinimaDias: 6575,
    limiteInferior: 35.1,
    normalInferior: 36.1,
    normalSuperior: 38,
    limiteSuperior: null,
  },
};
