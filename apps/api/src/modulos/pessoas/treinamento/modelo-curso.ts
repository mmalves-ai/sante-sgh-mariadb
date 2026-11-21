// A categoria do curso no contrato e o tipo da tabela curso: a mesma tradução na porta própria e na porta em memória.
// O público fica no banco assim: o curso obrigatório por função em treinamento_obrigatorio_funcao (com vigência); o
// público por unidade (setor funcional), o curso obrigatório para todo o estabelecimento (sem alvo) e o público do curso
// não obrigatório em curso_publico_alvo, com a marca de obrigatório da linha.
import type { CategoriaCurso } from '@sgh/contratos';
import type { CamposCurso } from './tipos-treinamento.js';

/** A categoria do contrato → o tipo do curso no modelo. */
export const TIPO_DA_CATEGORIA: Readonly<Record<CategoriaCurso, string>> = {
  nr32: 'norma_regulamentadora',
  integracao: 'integracao',
  pop: 'procedimento_operacional',
  assistencial: 'capacitacao',
  gestao: 'gestao',
  outro: 'outro',
};

/** O tipo do curso no modelo para a categoria do contrato. */
export function conferirModeloDoCurso(x: Pick<CamposCurso, 'categoria'>): string {
  return TIPO_DA_CATEGORIA[x.categoria];
}
