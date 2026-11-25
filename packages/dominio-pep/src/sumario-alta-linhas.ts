// Sumário de alta por seção (F3.3, linha 03-PEP L124): o que fica gravado linha a linha, na ordem das seções que valem
// para o atendimento, e o recorte de tempo de cada seção aplicado aos dados do episódio antes de montar o sumário.
// Regras puras: quem grava recebe as linhas prontas; quem monta recebe os itens já recortados pela janela da seção.
import type { SumarioAltaEstruturado } from '@sgh/contratos';
import {
  PISO_LEGAL_SUMARIO,
  type SecaoVigente,
  type TipoConteudoSecao,
  textoDaSecao,
} from './sumario-alta-secoes.js';

/** Grupo da linha gravada (o domínio fechado da coluna; a seção configurada vai no título). */
export const GRUPOS_LINHA_SUMARIO = [
  'motivo_internacao',
  'diagnosticos',
  'procedimentos',
  'exames',
  'evolucao',
  'medicamentos_alta',
  'alergias',
  'plano',
  'encaminhamentos',
  'orientacoes',
  'condicao_alta',
  'outros',
] as const;
export type GrupoLinhaSumario = (typeof GRUPOS_LINHA_SUMARIO)[number];

export interface LinhaSumarioSecao {
  readonly sequencia: number;
  readonly grupo: GrupoLinhaSumario;
  /** Código da seção configurada de onde a linha veio (o piso legal usa o código "diagnosticos"). */
  readonly secao: string;
  readonly titulo: string;
  readonly texto: string | null;
  /** CID-10 sem ponto, em maiúsculas; nulo quando o diagnóstico não tem código válido. */
  readonly cid10: string | null;
}

/** A seção que a linha pede para a seção vigente (o código é só a escolha do estabelecimento). */
export function grupoDaSecao(tipo: TipoConteudoSecao, codigo: string): GrupoLinhaSumario {
  switch (tipo) {
    case 'diagnosticos':
      return 'diagnosticos';
    case 'procedimentos':
      return 'procedimentos';
    case 'exames':
      return 'exames';
    case 'medicamentos':
      return 'medicamentos_alta';
    case 'evolucao_clinica':
      return 'evolucao';
    case 'plano_terapeutico':
      return 'plano';
    case 'orientacoes':
      return 'orientacoes';
    case 'alergias':
      return 'alergias';
    case 'condicao_alta':
      return 'condicao_alta';
    case 'texto_livre':
      return codigo === 'motivo' ? 'motivo_internacao' : 'outros';
    default:
      return 'outros';
  }
}

const CID10 = /^[A-Z][0-9]{2}[0-9A-Z]{0,3}$/;

/** CID-10 sem ponto e em maiúsculas; o que não tem a forma do CID-10 volta nulo (nunca grava código inventado). */
export function cid10DaLinha(cid: string | undefined): string | null {
  if (!cid) return null;
  const c = cid.replace(/\./g, '').trim().toUpperCase();
  return CID10.test(c) ? c : null;
}

const limpo = (t: string | undefined | null): string => (t ?? '').trim();

/**
 * As linhas do sumário na ordem das seções vigentes: uma linha por diagnóstico, procedimento, medicamento, alergia e
 * encaminhamento; uma linha para cada texto. Seção vazia não gera linha. O diagnóstico é piso legal: se a configuração
 * não tem seção de diagnóstico, as linhas dele entram no fim, com o título "Diagnósticos".
 */
export function linhasDoSumario(
  s: SumarioAltaEstruturado,
  secoes: readonly SecaoVigente[],
): LinhaSumarioSecao[] {
  const r: Omit<LinhaSumarioSecao, 'sequencia'>[] = [];
  const titulo = (x: SecaoVigente) => x.descricao.trim().slice(0, 150);
  const texto = (x: SecaoVigente, grupo: GrupoLinhaSumario, t: string | undefined | null) => {
    if (limpo(t)) r.push({ grupo, secao: x.codigo, titulo: titulo(x), texto: limpo(t), cid10: null });
  };
  const diagnosticos = (secao: string, t: string) => {
    for (const d of s.diagnosticos) {
      const cid10 = cid10DaLinha(d.cid);
      const desc = limpo(d.descricao);
      if (!cid10 && !desc) continue;
      r.push({ grupo: 'diagnosticos', secao, titulo: t, texto: desc || null, cid10 });
    }
  };
  for (const x of secoes) {
    const g = grupoDaSecao(x.tipoConteudo, x.codigo);
    switch (x.tipoConteudo) {
      case 'diagnosticos':
        diagnosticos(x.codigo, titulo(x));
        break;
      case 'procedimentos':
        for (const p of s.procedimentos) texto(x, g, p);
        break;
      case 'medicamentos':
        for (const m of s.medicamentosAlta) texto(x, g, m);
        break;
      case 'alergias':
        for (const a of s.alergias) texto(x, g, a);
        break;
      case 'evolucao_clinica':
        texto(x, g, s.evolucao);
        break;
      case 'plano_terapeutico':
        texto(x, g, s.plano);
        for (const e of s.encaminhamentos) texto(x, 'encaminhamentos', e);
        break;
      case 'condicao_alta':
        texto(x, g, s.condicaoAlta);
        break;
      default: {
        const t = textoDaSecao(s, x.codigo);
        texto(x, g, t || (x.codigo === 'motivo' ? s.motivoInternacao : null));
      }
    }
  }
  if (PISO_LEGAL_SUMARIO.includes('diagnosticos') && !secoes.some((x) => x.tipoConteudo === 'diagnosticos'))
    diagnosticos('diagnosticos', 'Diagnósticos');
  return r.map((l, i) => ({ ...l, sequencia: i + 1 }));
}

/** Item do episódio com o momento clínico (realização da cirurgia, resultado do exame). */
export interface ItemDatado {
  readonly texto: string;
  readonly em: string | Date | null;
}

export interface JanelaItens {
  readonly desde: string | Date;
  readonly ate: string | Date;
  readonly ultimo: boolean;
}

const ms = (d: string | Date): number => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/**
 * Os itens que caem na janela da seção, sem repetir texto. Sem janela (seção sem recorte), todos. Com janela, só os
 * datados entre o início e o fim; `ultimo` deixa só os do momento mais recente da janela.
 */
export function itensNaJanela(itens: readonly ItemDatado[], janela: JanelaItens | null): string[] {
  let dentro: ItemDatado[] = [...itens];
  if (janela) {
    const de = ms(janela.desde);
    const ate = ms(janela.ate);
    dentro = itens.filter((i) => i.em !== null && ms(i.em) >= de && ms(i.em) <= ate);
    if (janela.ultimo && dentro.length > 0) {
      const max = Math.max(...dentro.map((i) => ms(i.em as string | Date)));
      dentro = dentro.filter((i) => ms(i.em as string | Date) === max);
    }
  }
  return [...new Set(dentro.map((i) => i.texto.trim()).filter((t) => t.length > 0))];
}

/** Seção com a janela já calculada para o atendimento (entrada e alta). */
export interface SecaoComJanela {
  readonly tipoConteudo: TipoConteudoSecao;
  readonly janela: JanelaItens | null;
}

/**
 * Procedimentos e exames do episódio pela janela da seção que os mostra. Sem seção do tipo, o episódio inteiro (o
 * campo continua no sumário para o médico completar).
 */
export function episodioNasJanelas(
  ep: { readonly procedimentos: readonly ItemDatado[]; readonly exames: readonly ItemDatado[] },
  secoes: readonly SecaoComJanela[],
): { procedimentos: string[]; exames: string[] } {
  const janela = (t: TipoConteudoSecao) => secoes.find((x) => x.tipoConteudo === t)?.janela ?? null;
  return {
    procedimentos: itensNaJanela(ep.procedimentos, janela('procedimentos')),
    exames: itensNaJanela(ep.exames, janela('exames')),
  };
}
