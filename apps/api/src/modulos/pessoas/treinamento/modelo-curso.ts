// O que o cadastro de cursos do modelo (tabela curso e treinamento_obrigatorio_funcao) ainda não guarda: a mesma recusa
// na porta própria e na porta em memória, para o dev/ci não esconder o que no banco fica indisponível.
// Pendente (pedido de DDL em docs/obra/fatias/f22/saida/03-11.json, com prioridade): as categorias `pop` e `gestao`, o
// público por unidade (setor), o curso obrigatório para todo o estabelecimento (NR-32) e o público de curso não
// obrigatório recusam com 409 `modelo-pendente` até sair o curso_publico_alvo e a extensão de ck_curso_tipo.
import type { CategoriaCurso } from '@sgh/contratos';
import { recusa } from '@sgh/nucleo';
import type { CamposCurso } from './tipos-treinamento.js';

export const MODELO_PENDENTE = 'modelo-pendente';

/** A categoria do contrato → o tipo do curso no modelo (as que faltam no modelo ficam de fora). */
export const TIPO_DA_CATEGORIA: Partial<Record<CategoriaCurso, string>> = {
  nr32: 'norma_regulamentadora',
  integracao: 'integracao',
  assistencial: 'capacitacao',
  outro: 'outro',
};

const pendente = (mensagem: string, campo: string) => recusa(MODELO_PENDENTE, mensagem, { campos: [campo] });

/** Confere a categoria e o público do curso contra o modelo; devolve o tipo do curso no modelo. */
export function conferirModeloDoCurso(x: Pick<CamposCurso, 'categoria' | 'obrigatorio' | 'alvos'>): string {
  const tipo = TIPO_DA_CATEGORIA[x.categoria];
  if (!tipo)
    throw pendente(
      `A categoria "${x.categoria}" ainda não tem lugar no cadastro de cursos: escolha outra.`,
      'categoria',
    );
  if (x.alvos.some((a) => a.tipo === 'unidade'))
    throw pendente(
      'O público por unidade ainda não tem lugar no cadastro de cursos: indique as funções.',
      'alvos',
    );
  if (x.obrigatorio && x.alvos.length === 0)
    throw pendente(
      'O curso obrigatório para todo o estabelecimento ainda não tem lugar no cadastro: indique as funções.',
      'alvos',
    );
  if (!x.obrigatorio && x.alvos.length > 0)
    throw pendente(
      'O público só vale para o curso obrigatório: marque como obrigatório ou tire o público.',
      'alvos',
    );
  return tipo;
}
