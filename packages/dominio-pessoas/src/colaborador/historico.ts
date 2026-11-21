// Histórico funcional (SGH_PES_HISTORICO; só inclusão): cada mudança de cargo, função, jornada ou lotação vira uma
// linha nova com o antes e o depois; nada é editado nem apagado. A vigência não volta para antes da admissão nem da
// última mudança registrada (a ordem do histórico é a ordem das vigências).
import type { TipoEventoHistorico } from '@sgh/contratos';
import { diasEntre } from '../datas.js';

export interface SituacaoFuncional {
  readonly cargo: string;
  readonly funcao: string | null;
  readonly cargaSemanalHoras: number;
  /** Nulo: vínculo sem centro de custo (o modelo permite; a lotação nova sempre traz um). */
  readonly centroCusto: number | null;
  readonly unidade: number | null;
  readonly setor: string | null;
}

export interface MudancaFuncional {
  readonly vigencia: string;
  readonly cargo?: string;
  readonly funcao?: string | null;
  readonly cargaSemanalHoras?: number;
  readonly lotacao?: {
    readonly centroCusto: number;
    readonly unidade: number | null;
    readonly setor: string | null;
  };
}

export interface EventoHistorico {
  readonly tipo: TipoEventoHistorico;
  readonly vigencia: string;
  readonly antes: string | null;
  readonly depois: string | null;
}

export type ResultadoMudanca =
  | { readonly ok: true; readonly eventos: readonly EventoHistorico[]; readonly nova: SituacaoFuncional }
  | {
      readonly ok: false;
      readonly recusa: 'sem-mudanca' | 'vigencia-anterior';
      readonly mensagem: string;
    };

const lotacaoTexto = (l: Pick<SituacaoFuncional, 'centroCusto' | 'unidade' | 'setor'>): string =>
  [
    l.centroCusto === null ? 'sem centro de custo' : `centro de custo ${l.centroCusto}`,
    l.unidade === null ? null : `unidade ${l.unidade}`,
    l.setor,
  ]
    .filter((x): x is string => x !== null && x !== '')
    .join(' · ');

export function aplicarMudanca(
  atual: SituacaoFuncional,
  mudanca: MudancaFuncional,
  limites: { readonly admissao: string; readonly ultimaVigencia: string | null },
): ResultadoMudanca {
  const piso = limites.ultimaVigencia ?? limites.admissao;
  if (diasEntre(piso, mudanca.vigencia) < 0)
    return {
      ok: false,
      recusa: 'vigencia-anterior',
      mensagem: 'A vigência vem antes da admissão ou da última mudança registrada.',
    };
  const eventos: EventoHistorico[] = [];
  const v = mudanca.vigencia;
  let nova: SituacaoFuncional = atual;
  if (mudanca.cargo !== undefined && mudanca.cargo !== atual.cargo) {
    eventos.push({ tipo: 'cargo', vigencia: v, antes: atual.cargo, depois: mudanca.cargo });
    nova = { ...nova, cargo: mudanca.cargo };
  }
  if (mudanca.funcao !== undefined && mudanca.funcao !== atual.funcao) {
    eventos.push({ tipo: 'funcao', vigencia: v, antes: atual.funcao, depois: mudanca.funcao });
    nova = { ...nova, funcao: mudanca.funcao };
  }
  if (mudanca.cargaSemanalHoras !== undefined && mudanca.cargaSemanalHoras !== atual.cargaSemanalHoras) {
    eventos.push({
      tipo: 'jornada',
      vigencia: v,
      antes: `${atual.cargaSemanalHoras} h semanais`,
      depois: `${mudanca.cargaSemanalHoras} h semanais`,
    });
    nova = { ...nova, cargaSemanalHoras: mudanca.cargaSemanalHoras };
  }
  const l = mudanca.lotacao;
  if (l && (l.centroCusto !== atual.centroCusto || l.unidade !== atual.unidade || l.setor !== atual.setor)) {
    eventos.push({ tipo: 'lotacao', vigencia: v, antes: lotacaoTexto(atual), depois: lotacaoTexto(l) });
    nova = { ...nova, centroCusto: l.centroCusto, unidade: l.unidade, setor: l.setor };
  }
  if (eventos.length === 0)
    return { ok: false, recusa: 'sem-mudanca', mensagem: 'Os dados informados são iguais aos atuais.' };
  return { ok: true, eventos, nova };
}
