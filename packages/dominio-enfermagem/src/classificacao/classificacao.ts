// Classificação de pacientes para o dimensionamento (ficha do M45, regra 9; cap-05b §5.8; COFEN 543/2017): Fugulin por
// turno nas unidades de internação (12 áreas de 1 a 4 pontos; a categoria de cuidado dá as horas de enfermagem em 24 h)
// e NAS na terapia intensiva (23 itens com o peso em % do tempo de um profissional em 24 h). A carga da unidade soma as
// horas com as parcelas impressas e é comparada com a equipe informada na tela (até a escala da Fase 6, M52).
import { AREAS_FUGULIN, CATEGORIAS_FUGULIN, type InstrumentoClassificacao, ITENS_NAS } from '@sgh/contratos';

export interface ResultadoClassificacao {
  readonly instrumento: InstrumentoClassificacao;
  readonly versao: number;
  readonly itens: Readonly<Record<string, number | string>>;
  readonly total: number;
  readonly categoria: string;
  readonly rotuloCategoria: string;
  readonly horas24h: number;
}

export type RecusaClassificacao = {
  readonly ok: false;
  readonly codigo: 'item-faltando' | 'valor-nunca-visto';
  readonly mensagem: string;
  readonly itens: readonly string[];
};

const umDecimal = (n: number) => Math.round(n * 10) / 10;

/** Fugulin (2005): todas as 12 áreas respondidas de 1 a 4; total de 12 a 48. */
export function classificarFugulin(
  respostas: Readonly<Record<string, number | string>>,
): ({ ok: true } & ResultadoClassificacao) | RecusaClassificacao {
  const faltam = AREAS_FUGULIN.filter((a) => respostas[a.codigo] === undefined).map((a) => a.codigo);
  if (faltam.length)
    return {
      ok: false,
      codigo: 'item-faltando',
      mensagem: `Avalie as 12 áreas (faltam ${faltam.length}).`,
      itens: faltam,
    };
  const conhecidas = new Set(AREAS_FUGULIN.map((a) => a.codigo));
  const invalidas = [
    ...Object.keys(respostas).filter((k) => !conhecidas.has(k)),
    ...AREAS_FUGULIN.filter((a) => !a.opcoes.some((o) => o.valor === respostas[a.codigo])).map(
      (a) => a.codigo,
    ),
  ];
  if (invalidas.length)
    return {
      ok: false,
      codigo: 'valor-nunca-visto',
      mensagem: 'Cada área vai de 1 a 4 pontos.',
      itens: invalidas,
    };
  const itens: Record<string, number> = {};
  for (const a of AREAS_FUGULIN) itens[a.codigo] = Number(respostas[a.codigo]);
  const total = Object.values(itens).reduce((s, v) => s + v, 0);
  const c = CATEGORIAS_FUGULIN.find((x) => total >= x.minimo && total <= x.maximo)!;
  return {
    ok: true,
    instrumento: 'fugulin',
    versao: 1,
    itens,
    total,
    categoria: c.codigo,
    rotuloCategoria: c.rotulo,
    horas24h: c.horas,
  };
}

/**
 * NAS: o item com subitens recebe o código do subitem escolhido ("1b"); o item simples, "sim". Item ausente = não feito.
 * O total é a soma dos pesos (em % de um profissional em 24 h); as horas = total × 24 ÷ 100.
 */
export function classificarNas(
  respostas: Readonly<Record<string, number | string>>,
): ({ ok: true } & ResultadoClassificacao) | RecusaClassificacao {
  const porCodigo = new Map(ITENS_NAS.map((i) => [i.codigo, i]));
  const invalidos: string[] = [];
  const itens: Record<string, string> = {};
  let total = 0;
  for (const [k, v] of Object.entries(respostas)) {
    const item = porCodigo.get(k);
    if (!item) {
      invalidos.push(k);
      continue;
    }
    if (item.subitens) {
      const s = item.subitens.find((x) => x.codigo === v);
      if (!s) invalidos.push(k);
      else {
        itens[k] = s.codigo;
        total += s.peso;
      }
    } else if (v === 'sim') {
      itens[k] = 'sim';
      total += item.peso ?? 0;
    } else invalidos.push(k);
  }
  if (invalidos.length)
    return {
      ok: false,
      codigo: 'valor-nunca-visto',
      mensagem: 'Há item do NAS fora das opções: escolha o subitem ou marque o item.',
      itens: invalidos,
    };
  total = umDecimal(total);
  return {
    ok: true,
    instrumento: 'nas',
    versao: 1,
    itens,
    total,
    categoria: 'nas',
    rotuloCategoria: `${String(total).replace('.', ',')}% do tempo de um profissional`,
    horas24h: umDecimal((total * 24) / 100),
  };
}

export function classificar(
  instrumento: InstrumentoClassificacao,
  respostas: Readonly<Record<string, number | string>>,
): ({ ok: true } & ResultadoClassificacao) | RecusaClassificacao {
  return instrumento === 'fugulin' ? classificarFugulin(respostas) : classificarNas(respostas);
}

export interface CargaCalculada {
  readonly fugulin: {
    readonly porCategoria: readonly { codigo: string; rotulo: string; pacientes: number; horas: number }[];
    readonly horas24h: number;
  };
  readonly nas: { readonly pacientes: number; readonly soma: number; readonly profissionaisPorTurno: number };
}

/** A carga da unidade no turno: as horas do Fugulin por categoria e a soma do NAS (cada parcela à mostra). */
export function cargaDaUnidade(
  classificacoes: readonly { instrumento: InstrumentoClassificacao; categoria: string; total: number }[],
): CargaCalculada {
  const porCategoria = CATEGORIAS_FUGULIN.map((c) => {
    const n = classificacoes.filter((x) => x.instrumento === 'fugulin' && x.categoria === c.codigo).length;
    return { codigo: c.codigo, rotulo: c.rotulo, pacientes: n, horas: n * c.horas };
  });
  const nas = classificacoes.filter((x) => x.instrumento === 'nas');
  const soma = umDecimal(nas.reduce((s, x) => s + x.total, 0));
  return {
    fugulin: { porCategoria, horas24h: porCategoria.reduce((s, c) => s + c.horas, 0) },
    nas: { pacientes: nas.length, soma, profissionaisPorTurno: Math.round((soma / 100) * 100) / 100 },
  };
}

/**
 * A comparação com a equipe informada na tela: as horas disponíveis no turno (profissionais × horas do turno) contra
 * as horas necessárias no turno (as de 24 h na proporção do turno), com a diferença.
 */
export function compararComEquipe(c: {
  readonly horasNecessarias24h: number;
  readonly profissionais: number;
  readonly horasDoTurno: number;
}): {
  necessariasNoTurno: number;
  disponiveis: number;
  diferenca: number;
  suficiente: boolean;
  conta: string;
} {
  const necessariasNoTurno = umDecimal((c.horasNecessarias24h * c.horasDoTurno) / 24);
  const disponiveis = umDecimal(c.profissionais * c.horasDoTurno);
  const diferenca = umDecimal(disponiveis - necessariasNoTurno);
  const fmt = (n: number) => String(n).replace('.', ',');
  return {
    necessariasNoTurno,
    disponiveis,
    diferenca,
    suficiente: diferenca >= 0,
    conta: `${fmt(c.profissionais)} profissionais × ${fmt(c.horasDoTurno)} h = ${fmt(disponiveis)} h disponíveis; ${fmt(c.horasNecessarias24h)} h em 24 h × ${fmt(c.horasDoTurno)} ÷ 24 = ${fmt(necessariasNoTurno)} h necessárias no turno`,
  };
}
