// Setores da migração gradual (ficha do M37, seções 6 e 12; DP-4): o catálogo dos setores das ondas (M35) mais o que
// o comitê gravou em SGH_CFG_COEX_SETOR (situação, datas, chave, condução, aceite, composição). As chaves que o lote
// do setor liga por pessoa são as funcionalidades do setor (catálogo) e a chave própria gravada, quando houver. O
// segundo estabelecimento aparece "aguardando o ProntoCardio" até todos os setores do primeiro estarem liberados.
import {
  type DefinicaoSetor,
  ESTABELECIMENTO_PRIMEIRO_DP4,
  SETORES_PRONTIDAO,
  SITUACOES_SETOR_COEX,
  type SituacaoSetorCoex,
  type TipoComposicaoSetor,
} from '@sgh/contratos';
import { setorLiberado } from './acesso-apos-trilha.js';

export interface SetorGravado {
  readonly codigo: string;
  readonly nome: string;
  readonly onda: number;
  readonly situacao: SituacaoSetorCoex;
  readonly chaveLiberacao: string | null;
  readonly conducao: boolean;
  readonly aceiteCoordenador: boolean;
  readonly datas: Readonly<
    Record<'homologacao' | 'treinamento' | 'liberado' | 'acompanhamento' | 'migrado', string | null>
  >;
  readonly composicao: readonly { tipo: TipoComposicaoSetor; valor: string }[];
}

export interface SetorMontado extends SetorGravado {
  readonly definicao: DefinicaoSetor | null;
  readonly chaves: readonly { tipo: 'operacao' | 'recurso'; chave: string }[];
  readonly gravado: boolean;
}

const SEM_DATAS = {
  homologacao: null,
  treinamento: null,
  liberado: null,
  acompanhamento: null,
  migrado: null,
};

/**
 * O catálogo com o gravado por cima (o gravado vale; setor só gravado, sem catálogo, também aparece). `ehRecurso`
 * diz se uma chave própria é funcionalidade (POL-3) ou operação do catálogo.
 */
export function montarSetores(
  gravados: readonly SetorGravado[],
  ehRecurso: (chave: string) => boolean,
  catalogo: readonly DefinicaoSetor[] = SETORES_PRONTIDAO,
): SetorMontado[] {
  const porCodigo = new Map(gravados.map((g) => [g.codigo, g]));
  const r: SetorMontado[] = [];
  const chavesDe = (def: DefinicaoSetor | null, propria: string | null) => {
    const lista: { tipo: 'operacao' | 'recurso'; chave: string }[] = (def?.recursos ?? []).map((c) => ({
      tipo: 'recurso' as const,
      chave: c,
    }));
    if (propria && !lista.some((x) => x.chave === propria))
      lista.push({ tipo: ehRecurso(propria) ? 'recurso' : 'operacao', chave: propria });
    return lista;
  };
  for (const def of catalogo) {
    const g = porCodigo.get(def.id);
    r.push({
      codigo: def.id,
      nome: g?.nome ?? def.nome,
      onda: g?.onda ?? def.onda,
      situacao: g?.situacao ?? 'legado',
      chaveLiberacao: g?.chaveLiberacao ?? null,
      conducao: g?.conducao ?? false,
      aceiteCoordenador: g?.aceiteCoordenador ?? false,
      datas: g?.datas ?? SEM_DATAS,
      composicao: g?.composicao ?? [],
      definicao: def,
      chaves: chavesDe(def, g?.chaveLiberacao ?? null),
      gravado: !!g,
    });
    porCodigo.delete(def.id);
  }
  for (const g of porCodigo.values())
    r.push({ ...g, definicao: null, chaves: chavesDe(null, g.chaveLiberacao), gravado: true });
  return r.sort((a, b) => a.onda - b.onda || a.nome.localeCompare(b.nome));
}

/** A coluna de data da passagem para a situação (a situação "legado" não tem data). */
export function colunaDaSituacao(s: SituacaoSetorCoex): keyof SetorGravado['datas'] | null {
  return s === 'legado' ? null : s;
}

/** Avança só um passo por vez ou recua para qualquer anterior (recolher é imediato; cap-15 §15.3.2). */
export function transicaoPermitida(de: SituacaoSetorCoex, para: SituacaoSetorCoex): boolean {
  const i = SITUACOES_SETOR_COEX.indexOf(de);
  const j = SITUACOES_SETOR_COEX.indexOf(para);
  return j <= i + 1;
}

/**
 * DP-4: o estabelecimento ativo espera o primeiro? O primeiro (ProntoCardio) nunca espera; os outros esperam até todos
 * os setores do primeiro estarem liberados (liberado, em acompanhamento ou migrado).
 */
export function aguardandoPrimeiro(
  hospital: string,
  setoresDoPrimeiro: readonly Pick<SetorGravado, 'situacao'>[] | null,
  primeiro = ESTABELECIMENTO_PRIMEIRO_DP4,
  nomePrimeiro = 'ProntoCardio',
): { aguardando: boolean; motivo: string | null } {
  if (hospital === primeiro) return { aguardando: false, motivo: null };
  if (setoresDoPrimeiro === null)
    return { aguardando: true, motivo: `Aguardando o ${nomePrimeiro}: a situação dele não pôde ser lida.` };
  const faltam = setoresDoPrimeiro.filter((s) => !setorLiberado(s.situacao)).length;
  if (faltam === 0) return { aguardando: false, motivo: null };
  return {
    aguardando: true,
    motivo: `Aguardando o ${nomePrimeiro}: ${faltam} setor(es) de lá ainda não liberado(s). As ondas aqui começam depois de todas no ${nomePrimeiro}.`,
  };
}
