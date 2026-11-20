// Regras 3 e 3a do M37 (cap-15 §15.4.2; DP-4, decidida em 2026-10-19): a chave de PESSOA em SGH_CFG_LIBERACAO só é
// ligada quando o setor dela está liberado no estabelecimento E a trilha do papel dela (na onda do setor) está
// concluída com o resultado "aprovado"; quem não concluiu continua no outro sistema, que segue disponível. O lote
// aplica de uma vez a uma lista de usuários, a um grupo do legado ou ao setor inteiro: as pessoas do alvo que não
// cumprem a regra ficam de fora e aparecem listadas, com o motivo (nada é feito pessoa a pessoa à mão).
import {
  PAPEIS,
  type PapelTreinamento,
  SITUACOES_SETOR_LIBERADO,
  type SituacaoSetorCoex,
  type TipoAlvoLote,
  type TipoComposicaoSetor,
} from '@sgh/contratos';
import { chaveDoGrupo } from '../prontidao/prontidao.js';

/** O papel do treinamento de um grupo do legado (pelos grupos de cada papel; sem papel: "outros"). */
export function papelDoGrupo(grupo: string | null): PapelTreinamento {
  if (!grupo) return 'outros';
  const g = chaveDoGrupo(grupo);
  return PAPEIS.find((p) => p.id !== 'outros' && p.grupos.some((x) => chaveDoGrupo(x) === g))?.id ?? 'outros';
}

export interface PessoaDoLote {
  readonly login: string;
  readonly grupo: string | null;
  readonly unidades: readonly number[];
  readonly locais: readonly number[];
  readonly ativo: boolean;
}

export interface ConclusaoValida {
  readonly login: string;
  readonly papel: PapelTreinamento;
  readonly onda: number;
  readonly resultado: 'aprovado' | 'refazer';
  readonly concluidoEm: string;
}

export interface SetorDoLote {
  readonly codigo: string;
  readonly onda: number;
  readonly situacao: SituacaoSetorCoex;
  readonly papeis: readonly PapelTreinamento[];
  /** A composição gravada (unidades, locais, grupos); vazia: os grupos dos papéis do setor (catálogo). */
  readonly composicao: readonly { tipo: TipoComposicaoSetor; valor: string }[];
}

/** O setor está liberado no estabelecimento (as pessoas dele podem receber o acesso)? */
export function setorLiberado(situacao: SituacaoSetorCoex): boolean {
  return SITUACOES_SETOR_LIBERADO.includes(situacao);
}

/** A pessoa pertence ao setor (pela composição gravada; sem ela, pelo papel do grupo)? */
export function pessoaNoSetor(p: PessoaDoLote, s: SetorDoLote): boolean {
  if (s.composicao.length === 0) return s.papeis.includes(papelDoGrupo(p.grupo));
  return s.composicao.some((c) => {
    if (c.tipo === 'grupo') return p.grupo !== null && chaveDoGrupo(p.grupo) === chaveDoGrupo(c.valor);
    const n = Number(c.valor);
    return c.tipo === 'unidade' ? p.unidades.includes(n) : p.locais.includes(n);
  });
}

/**
 * A trilha do papel da pessoa na onda do setor está concluída? Vale a conclusão mais recente da pessoa para o papel e
 * a onda: "refazer" depois de "aprovado" desfaz (o instrutor pediu de novo). Qualquer versão da trilha vale
 * (D-TRILHA-37: a reciclagem numa versão nova é decisão do comitê, não bloqueio automático).
 */
export function trilhaConcluida(
  login: string,
  papel: PapelTreinamento,
  onda: number,
  conclusoes: readonly ConclusaoValida[],
): boolean {
  const l = login.trim().toUpperCase();
  const dela = conclusoes
    .filter((c) => c.login.trim().toUpperCase() === l && c.papel === papel && c.onda === onda)
    .sort((a, b) => a.concluidoEm.localeCompare(b.concluidoEm));
  return dela.length > 0 && dela[dela.length - 1]!.resultado === 'aprovado';
}

/** Regra 3: pode ligar o acesso da pessoa? Com o motivo quando não. */
export function decidirAcesso(
  p: PessoaDoLote,
  s: SetorDoLote,
  conclusoes: readonly ConclusaoValida[],
): { pode: true } | { pode: false; motivo: string } {
  if (!p.ativo) return { pode: false, motivo: 'usuário inativo ou bloqueado' };
  if (!setorLiberado(s.situacao))
    return {
      pode: false,
      motivo: `o setor está em "${s.situacao}" (só liberado, em acompanhamento ou migrado)`,
    };
  if (!pessoaNoSetor(p, s)) return { pode: false, motivo: 'a pessoa não pertence ao setor' };
  const papel = papelDoGrupo(p.grupo);
  if (!trilhaConcluida(p.login, papel, s.onda, conclusoes))
    return { pode: false, motivo: `trilha "${papel}" da onda ${s.onda} não concluída` };
  return { pode: true };
}

export interface PlanoLote {
  readonly incluidos: readonly string[];
  readonly fora: readonly { login: string; motivo: string }[];
}

/**
 * Regra 3a: as pessoas do alvo (lista de usuários, grupo do legado ou o setor inteiro) e quem fica de fora. O alvo
 * "usuarios" com login que não existe no estabelecimento sai em "fora" (nunca é ligado às cegas).
 */
export function planejarLoteCoexistencia(
  alvo: { tipo: TipoAlvoLote; valores: readonly string[] },
  pessoas: readonly PessoaDoLote[],
  setor: SetorDoLote,
  conclusoes: readonly ConclusaoValida[],
): PlanoLote {
  const porLogin = new Map(pessoas.map((p) => [p.login.trim().toUpperCase(), p]));
  let candidatos: PessoaDoLote[];
  const fora: { login: string; motivo: string }[] = [];
  if (alvo.tipo === 'usuarios') {
    candidatos = [];
    for (const v of [...new Set(alvo.valores.map((x) => x.trim().toUpperCase()).filter(Boolean))]) {
      const p = porLogin.get(v);
      if (p) candidatos.push(p);
      else fora.push({ login: v, motivo: 'usuário não encontrado no estabelecimento' });
    }
  } else if (alvo.tipo === 'grupo') {
    const g = new Set(alvo.valores.map(chaveDoGrupo));
    candidatos = pessoas.filter((p) => p.grupo !== null && g.has(chaveDoGrupo(p.grupo)));
  } else {
    candidatos = pessoas.filter((p) => pessoaNoSetor(p, setor));
  }
  const incluidos: string[] = [];
  for (const p of candidatos.sort((a, b) => a.login.localeCompare(b.login))) {
    const d = decidirAcesso(p, setor, conclusoes);
    if (d.pode) incluidos.push(p.login.trim());
    else fora.push({ login: p.login.trim(), motivo: d.motivo });
  }
  return { incluidos, fora };
}
