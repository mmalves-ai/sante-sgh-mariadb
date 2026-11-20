// Ficha anestésica (M46, regra 3): a montagem do que a tela recebe a partir da ficha lida (as SGH_CC_FA*): a descrição de
// cada lançamento no vocabulário do novo, as lacunas da grade de 5 minutos com as justificativas, a linha de
// responsabilidade, os totais de fluidos, os abertos (gás e infusão sem fim), os anestesistas da cirurgia e o que impede
// a assinatura para quem está na sessão. Regras puras (a receita reconfere na transação o que vale).
import {
  EVENTOS_FICHA,
  FLUIDOS_FICHA,
  GASES_FICHA,
  PERDAS_FICHA,
  SINAIS_FICHA,
  VIAS_FICHA,
  type LacunaSinal,
  type MarcoFicha,
  type ParteFicha,
  type RecusaAnestesia,
  type ResponsavelFicha,
  type SinalFicha,
  type SituacaoFicha,
} from '@sgh/contratos';
import {
  anestesistasDaCirurgia,
  janelaDosSinais,
  lacunasDeSinais,
  linhaDeResponsabilidade,
  pendenciasDeAssinatura,
  totaisDaFicha,
  type FluidoLancado,
} from './ficha-anestesica.js';

export interface LancamentoParaMontar {
  readonly id: number;
  readonly parte: ParteFicha;
  readonly momento: string;
  readonly fim: string | null;
  readonly dados: Readonly<Record<string, string | number | null>>;
  readonly profissional: number | null;
  readonly registradoEm: string;
  readonly balanco: { readonly id: number; readonly em: string } | null;
}

export interface FichaParaMontar {
  readonly situacao: SituacaoFicha;
  readonly marcos: Readonly<Partial<Record<MarcoFicha, string>>>;
  readonly abertura: number;
  readonly abertaEm: string;
  readonly lancamentos: readonly LancamentoParaMontar[];
  readonly passagens: readonly { readonly momento: string; readonly de: number; readonly para: number }[];
  readonly lacunas: readonly { readonly inicio: string; readonly fim: string }[];
}

/** Os nomes dos domínios lidos do banco (modo respiratório, posição, função na equipe) e dos itens e profissionais. */
export interface NomesDaFicha {
  readonly modos?: ReadonlyMap<number, string>;
  readonly posicoes?: ReadonlyMap<number, string>;
  readonly funcoes?: ReadonlyMap<number, string>;
  readonly profissionais?: ReadonlyMap<number, string>;
}

const rotulo = <T extends readonly { codigo: string; rotulo: string }[]>(l: T, c: unknown) =>
  l.find((x) => x.codigo === c)?.rotulo ?? String(c ?? '');
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** A descrição do lançamento, o valor e a unidade (para a lista e para o gráfico). */
export function descreverLancamento(
  l: Pick<LancamentoParaMontar, 'parte' | 'dados'>,
  nomes: NomesDaFicha = {},
): { descricao: string; valor: number | null; unidade: string | null } {
  const d = l.dados;
  const num = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : null);
  switch (l.parte) {
    case 'sinal': {
      const s = SINAIS_FICHA[d['tipo'] as SinalFicha];
      return { descricao: s?.rotulo ?? txt(d['tipo']), valor: num('valor'), unidade: s?.unidade ?? null };
    }
    case 'medicamento':
      return {
        descricao: `${txt(d['descricao']) || `Item ${txt(d['item'])}`} · ${rotulo(VIAS_FICHA, d['via'])}`,
        valor: num('dose'),
        unidade: txt(d['unidade']) || null,
      };
    case 'gas': {
      const g = GASES_FICHA[d['gas'] as keyof typeof GASES_FICHA];
      return { descricao: g?.rotulo ?? txt(d['gas']), valor: num('valor'), unidade: g?.unidade ?? null };
    }
    case 'fluido':
      return { descricao: rotulo(FLUIDOS_FICHA, d['fluido']), valor: num('volumeMl'), unidade: 'mL' };
    case 'perda':
      return { descricao: rotulo(PERDAS_FICHA, d['perda']), valor: num('volumeMl'), unidade: 'mL' };
    case 'evento': {
      const e = rotulo(EVENTOS_FICHA, d['evento']);
      return { descricao: d['descricao'] ? `${e}: ${txt(d['descricao'])}` : e, valor: null, unidade: null };
    }
    case 'modoRespiratorio':
      return {
        descricao: nomes.modos?.get(num('modo') ?? -1) ?? `Modo ${txt(d['modo'])}`,
        valor: null,
        unidade: null,
      };
    case 'posicao':
      return {
        descricao: nomes.posicoes?.get(num('posicao') ?? -1) ?? `Posição ${txt(d['posicao'])}`,
        valor: null,
        unidade: null,
      };
    case 'equipe': {
      const quem =
        nomes.profissionais?.get(num('profissional') ?? -1) ?? `Profissional ${txt(d['profissional'])}`;
      const funcao = nomes.funcoes?.get(num('funcao') ?? -1) ?? `Função ${txt(d['funcao'])}`;
      return { descricao: `${quem} · ${funcao}`, valor: null, unidade: null };
    }
    case 'procedimento':
      return {
        descricao: d['observacao'] ? `${txt(d['descricao'])}: ${txt(d['observacao'])}` : txt(d['descricao']),
        valor: null,
        unidade: null,
      };
    case 'exame':
      return {
        descricao: d['resultado'] ? `${txt(d['exame'])}: ${txt(d['resultado'])}` : txt(d['exame']),
        valor: null,
        unidade: null,
      };
    case 'avulso':
      return { descricao: txt(d['descricao']), valor: num('quantidade'), unidade: null };
    case 'bi':
      return {
        descricao: txt(d['descricao']) || `Item ${txt(d['item'])}`,
        valor: num('vazao'),
        unidade: txt(d['unidade']) || null,
      };
    default:
      return { descricao: l.parte, valor: null, unidade: null };
  }
}

export interface FichaMontada {
  readonly lacunas: LacunaSinal[];
  readonly responsaveis: ResponsavelFicha[];
  readonly totais: { ganhosMl: number; perdasMl: number; hemocomponentesMl: number };
  /** Gás e infusão contínua sem fim (impedem a assinatura). */
  readonly abertos: number;
  readonly anestesistas: ReadonlySet<number>;
  /** O profissional da sessão que é anestesista da cirurgia (null = nenhum). */
  readonly assinante: number | null;
  readonly pendenciasAssinatura: RecusaAnestesia[];
}

/**
 * A ficha para a tela e para a conferência da receita. `agora` fecha a grade quando a anestesia ainda não terminou;
 * `sessao` são os registros profissionais (TBCBOPRO) de quem está na sessão.
 */
export function montarFicha(
  f: FichaParaMontar,
  o: {
    readonly agora: string;
    readonly agendado: number | null;
    readonly funcaoAnestesista: number | null;
    readonly sessao: readonly number[];
  },
): FichaMontada {
  const sinais = f.lancamentos
    .filter((l) => l.parte === 'sinal')
    .map((l) => ({ tipo: l.dados['tipo'] as SinalFicha, momento: l.momento }));
  const janela = janelaDosSinais(f.marcos, o.agora);
  const lacunas = janela ? lacunasDeSinais(sinais, janela, f.lacunas) : [];
  const responsaveis = linhaDeResponsabilidade({ anestesista: f.abertura, de: f.abertaEm }, f.passagens);
  const fluidos: FluidoLancado[] = f.lancamentos
    .filter((l) => l.parte === 'fluido' || l.parte === 'perda')
    .map((l) => ({
      id: l.id,
      parte: l.parte as 'fluido' | 'perda',
      tipo: String(l.dados[l.parte === 'fluido' ? 'fluido' : 'perda'] ?? ''),
      volumeMl: Number(l.dados['volumeMl'] ?? 0),
      momento: l.momento,
      fim: l.fim,
    }));
  const abertos = f.lancamentos.filter(
    (l) =>
      (l.parte === 'gas' || l.parte === 'bi' || (l.parte === 'medicamento' && l.dados['continua'] === 1)) &&
      !l.fim,
  ).length;
  const equipe = f.lancamentos
    .filter((l) => l.parte === 'equipe')
    .map((l) => ({ profissional: Number(l.dados['profissional']), funcao: Number(l.dados['funcao']) }));
  const anestesistas = anestesistasDaCirurgia({
    agendado: o.agendado,
    equipe,
    funcaoAnestesista: o.funcaoAnestesista,
    responsaveis,
  });
  const assinante = o.sessao.find((p) => anestesistas.has(p)) ?? null;
  const pendenciasAssinatura = pendenciasDeAssinatura(
    { situacao: f.situacao, marcos: f.marcos, lacunas, abertos },
    assinante,
    anestesistas,
  );
  return {
    lacunas,
    responsaveis,
    totais: totaisDaFicha(fluidos),
    abertos,
    anestesistas,
    assinante,
    pendenciasAssinatura,
  };
}
