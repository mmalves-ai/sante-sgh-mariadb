// Consulta somente leitura de tabela do legado (M14; ficha, seções 4 e 8, regras 5 e 15; cap-10 §10.11): a
// parte FÍSICA da declaração (tabela, chave de paginação, colunas com classe de máscara e filtro por coluna
// indexada) e o que sai dela sem banco: a descrição pública das colunas e a conferência dos nomes. As
// leituras (SQL, sempre READ ONLY) ficam em repositorio.ts.
import type { ColunaConsulta, ConsultaPublica } from '@sgh/contratos';

export interface ColunaConsultaFisica {
  readonly coluna: string;
  readonly campo: string;
  readonly rotulo: string;
  readonly tipo: ColunaConsulta['tipo'];
  /** Dado de pessoa: mascarada na lista; aparece só ao abrir o registro (evento auditado). */
  readonly mascarada?: boolean;
  readonly filtro?: 'igual' | 'periodo';
}

export interface DeclaracaoConsulta {
  readonly publico: ConsultaPublica;
  readonly grupo: string;
  readonly tabela: string;
  /** Chave primária (ordem do catálogo): paginação por chave (keyset); vazia: por posição. */
  readonly chave: readonly string[];
  readonly colunas: readonly ColunaConsultaFisica[];
  /**
   * Correção do M14 (escopo do M06): a coluna de cada escopo que a tabela tem. O filtro da sessão vira WHERE
   * nela em toda página, contagem, registro e exportação; escopo restrito sem coluna aqui falha fechado.
   */
  readonly escopos?: Readonly<Partial<Record<EscopoConsulta, string>>>;
}

export type EscopoConsulta =
  | 'unidade'
  | 'local'
  | 'convenio'
  | 'centroCusto'
  | 'localEstoque'
  | 'contaBancaria'
  | 'tipoAgenda'
  | 'tipoProntuario';

const NOME = /^[A-Z][A-Z0-9_$]{0,30}$/;
const CAMPO = /^[a-z][a-zA-Z0-9]{0,40}$/;

export function declararConsultaLegado(d: DeclaracaoConsulta): DeclaracaoConsulta {
  for (const n of [d.tabela, ...d.chave, ...d.colunas.map((c) => c.coluna)])
    if (!NOME.test(n)) throw new Error(`Consulta ${d.publico.recurso}: nome de objeto inválido (${n}).`);
  const campos = new Set<string>();
  for (const c of d.colunas) {
    if (!CAMPO.test(c.campo) || campos.has(c.campo))
      throw new Error(`Consulta ${d.publico.recurso}: campo inválido ou repetido (${c.campo}).`);
    campos.add(c.campo);
  }
  for (const k of d.chave)
    if (!d.colunas.some((c) => c.coluna === k))
      throw new Error(`Consulta ${d.publico.recurso}: chave ${k} fora das colunas.`);
  for (const c of Object.values(d.escopos ?? {}))
    if (!c || !NOME.test(c)) throw new Error(`Consulta ${d.publico.recurso}: coluna de escopo inválida.`);
  return Object.freeze(d);
}

/** Colunas como a API as descreve à tela (sem nome de tabela nem de coluna do legado). */
export function colunasDescritas(d: DeclaracaoConsulta): ColunaConsulta[] {
  return d.colunas.map((c) => ({
    campo: c.campo,
    rotulo: c.rotulo,
    tipo: c.tipo,
    mascarada: c.mascarada === true,
    ...(c.filtro ? { filtro: c.filtro } : {}),
    chave: d.chave.includes(c.coluna),
  }));
}

/** A consulta exige filtro: tabela grande (a tela recusa sem filtro; contagem "mais de N"). */
export function exigeFiltro(d: DeclaracaoConsulta): boolean {
  return d.publico.grande;
}
