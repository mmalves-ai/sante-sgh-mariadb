// Domínios da portaria e dos terminais no CRUD genérico (M50, etapa 5; ficha, seção 5, "Receita genérica do CRUD para as
// 8 tabelas do marco": os 6 do controle de acesso desta etapa; os 2 das sessões são da etapa 6). Pelo catálogo RDB$ e
// pelo levantamento da cópia `pc`:
//   - tipos de visitante (8 linhas) e de visitado (6): o banco gera o código interno (generator) e recusa mudar o código
//     digitado (e_geral_valor_chave): incluir e alterar o nome; o tipo de visitante tem a situação (ATIVO com CHECK T/F);
//   - formas de identificação no acesso (4: biometria, crachá, etiqueta, facial): o novo lê os códigos (a biometria e o
//     facial só com a DP-45): TRAVADO, só consulta (D-CRUD-50-5);
//   - situações de acesso (3), tipos de terminal (6) e fabricantes (3): um trigger recusa incluir, alterar e excluir
//     (e_geral_sistema): de SISTEMA, só consulta.
// Opções do outro sistema (TBOPCOES, módulo Controle de acesso): Tabelas 4528 (com Crachás 4530 na portaria e Terminais
// 4540 nos terminais) para ler; Tabelas para gravar. Não há opção própria por tabela na árvore (inferida: conferir na
// validação).
import type { DominioPublico } from './tipos.js';

const TABELAS = 4528;
const CRACHAS = 4530;
const TERMINAIS = 4540;

const m50 = (
  recurso: string,
  singular: string,
  plural: string,
  subitem: 'portariaCadastros' | 'portariaTerminais',
  natureza: DominioPublico['natureza'],
  acoes: DominioPublico['acoes'],
  extra: Partial<DominioPublico> = {},
): DominioPublico => {
  const ler = [TABELAS, subitem === 'portariaCadastros' ? CRACHAS : TERMINAIS];
  return {
    modulo: 'hotelaria',
    recurso,
    rotulo: { singular, plural },
    subitem,
    natureza,
    acoes,
    opcoesLegado: Object.fromEntries(
      acoes.map((a) => [a, a === 'ler' || a === 'exportar' ? ler : [TABELAS]]),
    ) as unknown as DominioPublico['opcoesLegado'],
    origemOpcoes: 'inferida',
    marco: 'M50',
    ...extra,
  };
};

const SISTEMA = 'Tabela do sistema: o banco recusa incluir, alterar ou excluir.';

export const DOMINIOS_M50: readonly DominioPublico[] = [
  m50('tipoVisitante', 'Tipo de visitante', 'Tipos de visitante', 'portariaCadastros', 'editavel', [
    'ler',
    'criar',
    'editar',
    'inativar',
    'exportar',
  ]),
  m50('tipoVisitado', 'Tipo de visitado', 'Tipos de visitado', 'portariaCadastros', 'editavel', [
    'ler',
    'criar',
    'editar',
    'exportar',
  ]),
  m50(
    'formaIdentificacao',
    'Forma de identificação no acesso',
    'Formas de identificação no acesso',
    'portariaCadastros',
    'travado',
    ['ler', 'exportar'],
    {
      motivoSomenteLeitura:
        'travado: a portaria lê estes códigos (a biometria e o reconhecimento facial só com a decisão do encarregado de dados)',
    },
  ),
  m50(
    'situacaoAcesso',
    'Situação de acesso',
    'Situações de acesso',
    'portariaCadastros',
    'sistema',
    ['ler', 'exportar'],
    {
      motivoSomenteLeitura: SISTEMA,
    },
  ),
  m50(
    'tipoTerminal',
    'Tipo de terminal',
    'Tipos de terminal e catraca',
    'portariaTerminais',
    'sistema',
    ['ler', 'exportar'],
    {
      motivoSomenteLeitura: SISTEMA,
    },
  ),
  m50(
    'fabricanteTerminal',
    'Fabricante de terminal',
    'Fabricantes de terminal',
    'portariaTerminais',
    'sistema',
    ['ler', 'exportar'],
    { motivoSomenteLeitura: SISTEMA },
  ),
];
