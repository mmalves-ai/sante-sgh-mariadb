// Auxiliares das declarações de domínio (W0-01: saíram de catalogo.ts com os arrays DOMINIOS_Mxx, que foram para
// prefixos/<prefixo>.ts). Constantes de opções do menu do legado e as funções que montam a parte pública.
//
// Cabeçalho original de catalogo.ts:
// Parte pública das declarações do CRUD genérico: o lote-piloto do M08 (20 domínios `migrar-crud`; ficha,
// seção 3). A parte física (tabela, colunas) mora no grupo dono em @sgh/legado (`<grupo>/cadastros/`).
// Opções de menu (menu de origem, ver conector/mapa/permissoes.tsv):
//   - próprias da tabela, quando a árvore do SPDATA tem a tela (Religiões 3739, Motivo de exclusão 3590,
//     Tipos de alergia 6333–6338, Alergias 5441, Tipo de anestesia 5618, Higienização 5003–5006);
//   - inferidas (POL-1b), quando a árvore não tem item da tabela: a área genérica do módulo Tabelas que
//     abriga os cadastros pela inicial, "Geral A–L" (3648) ou "Geral M–Z" (3698). Conferir na validação.
// Natureza `sistema`: o trigger *_BIUD do legado levanta e_geral_sistema em qualquer gravação (dado do
// fornecedor): o SPDATA não inclui nem altera, e o novo também não (regra 1.1); só consulta.
import type { DominioPublico } from './tipos.js';

export const GERAL_A_L = [3648];

export const GERAL_M_Z = [3698];

export const SISTEMA =
  'o banco de dados recusa inclusão, alteração e exclusão: dado de sistema do fornecedor';

export function inferida(
  base: Omit<DominioPublico, 'opcoesLegado' | 'origemOpcoes' | 'marco'>,
  opcoes: readonly number[],
): DominioPublico {
  const o = Object.fromEntries(base.acoes.map((a) => [a, opcoes])) as DominioPublico['opcoesLegado'];
  return { ...base, opcoesLegado: o, origemOpcoes: 'inferida', marco: 'M08' };
}

export function propria(
  base: Omit<DominioPublico, 'opcoesLegado' | 'origemOpcoes' | 'marco'>,
  opcoes: DominioPublico['opcoesLegado'],
): DominioPublico {
  return { ...base, opcoesLegado: opcoes, origemOpcoes: 'tbopcoes', marco: 'M08' };
}

export const todas = (ids: readonly number[], acoes: DominioPublico['acoes']) =>
  Object.fromEntries(acoes.map((a) => [a, ids])) as DominioPublico['opcoesLegado'];

export const CIE = ['ler', 'criar', 'editar', 'exportar'] as const;

export const CIEI = ['ler', 'criar', 'editar', 'inativar', 'exportar'] as const;

export const CI = ['ler', 'criar', 'exportar'] as const;

export const LER = ['ler', 'exportar'] as const;

// M11 (ficha, seção 5, "Domínios do marco pelo CRUD genérico"): conselhos profissionais, especialidades, CBO da
// especialidade e prestadores terceiros, com as opções das telas do SPDATA (Tabelas › Geral A–L › Conselhos
// Profissionais 4886; Especialidades 3683 e Gerenciamento 3684; Prestadores de serviços 3730, 6376, 3731,
// 3733, 6377). As tabelas com chave composta (siglas por conselho e procedimentos por especialidade) ficam em
// consulta nas telas próprias do marco: a receita genérica do M08 só conhece chave de uma coluna (desvio
// registrado nas evidências do M11).
export const M11 = (d: DominioPublico): DominioPublico => ({ ...d, marco: 'M11' });

export const CONSELHOS = [4886];

export const ESPECIALIDADES = [3683, 3684];

export const AE = ['ler', 'editar', 'exportar'] as const;

export const AEI = ['ler', 'editar', 'inativar', 'exportar'] as const;

// M12: classificações oncológicas de operadora (Unimed BH; matriz: FAT, domínio, migrar-crud). Sem trigger
// nem generator no legado: o código é digitado. Opções do legado: Tabelas › Convênios (3561, acessar) e
// Convênios › Consultar/Alterar/Incluir (6307, 3567, 3568), inferidas (POL-1b: a árvore do SPDATA não tem
// item próprio destas tabelas); conferir na validação. Sem inativar (as tabelas não têm situação).
export const CONVENIOS_LER = [3561, 6307];

export const CONVENIOS_ALTERAR = [3567];

export const CONVENIOS_INCLUIR = [3568];

export const oncologia = (recurso: string, rotulo: { singular: string; plural: string }): DominioPublico => ({
  modulo: 'convenio',
  recurso,
  rotulo,
  subitem: 'oncologia',
  natureza: 'editavel',
  acoes: ['ler', 'criar', 'editar', 'exportar'],
  opcoesLegado: {
    ler: CONVENIOS_LER,
    criar: CONVENIOS_INCLUIR,
    editar: CONVENIOS_ALTERAR,
    exportar: CONVENIOS_LER,
  },
  origemOpcoes: 'inferida',
  marco: 'M12',
});

// M10 (ficha, seção 5, "Estrutura e domínios do marco pelo CRUD genérico"): a estrutura que todo o resto usa,
// com as opções das telas do legado (Tabelas › Geral M–Z › Unidade de atendimento 6401–6406; Geral A–L ›
// Controle de centro de custo 3663, 3665, 3981–3983, 6349, 6350; Clínicas 3662; Feriados 3690; Locais de
// consumo 3697; Geral M–Z › Unidade de consumo 3760; Painel eletrônico › Local de atendimento 3727; Recepção
// interna › Leitos › Manutenção 2323 e Listagens › Blocos 2326; Tabela unificada › Tipo de leito ›
// Especialidade/tipo de leito 3851; Dados do hospital 5418, 5760; Tabelas › Financeiro › Empresas 3621;
// Privacidade e proteção de dados 6511, 6516). Tabelas de chave composta (acomodações, guichês) e as de horário
// e encaminhamento do local ficam nas telas próprias do marco (a receita genérica só conhece chave de uma
// coluna). Os domínios de privacidade e o tipo de empresa têm trigger que recusa qualquer gravação
// (e_geral_sistema): só consulta, como no legado.
export const M10 = (d: DominioPublico): DominioPublico => ({ ...d, marco: 'M10' });

export const CIEI_M10 = ['ler', 'criar', 'editar', 'inativar', 'exportar'] as const;

export const CIE_M10 = ['ler', 'criar', 'editar', 'exportar'] as const;

export const HOSPITAL = [5418, 5760];

export const EMPRESAS = [3621];

export const PRIVACIDADE = [6511, 6516];

export const SISTEMA_M10 =
  'o banco de dados recusa inclusão, alteração e exclusão: dado de sistema do fornecedor';

export const OFICIAL = 'tabela de fonte oficial (carga de referência): só consulta';

// M13: mapeamentos locais dos catálogos oficiais e os leiautes de importação da base de CEP (ficha do M13,
// seção 5, "Domínios do marco pelo CRUD genérico"). Opções do legado: Utilitários › Importações › Tabelas
// auxiliares padrão TISS (6460) e Tabelas › SUS › Tabela unificada (6921), inferidas (POL-1b); Tabelas › CEP
// (Consultar 6341, Incluir 3651, Alterar 3650), próprias. As posições do leiaute (tabela sem chave primária)
// ficam em consulta até o CRUD genérico aceitar chave composta (M14).
export const catalogoDominio = (
  recurso: string,
  rotulo: { singular: string; plural: string },
  subitem: DominioPublico['subitem'],
  opcoes: DominioPublico['opcoesLegado'],
  origemOpcoes: DominioPublico['origemOpcoes'],
): DominioPublico => ({
  modulo: 'catalogo',
  recurso,
  rotulo,
  subitem,
  natureza: 'editavel',
  acoes: ['ler', 'criar', 'editar', 'exportar'],
  opcoesLegado: opcoes,
  origemOpcoes,
  marco: 'M13',
});

export const TISS_AUX = [6460];

export const SUS_UNIFICADA = [6921];

// M19 (ficha, seção 5, "Cadastros pelo CRUD genérico"): recepções (11; Tabelas › Painel eletrônico ›
// Recepção 3725), geradores de senha (36; Opções de geração de senha 3726 e Recepção externa › Gerador
// de senhas 3308), configuração dos painéis de chamada (5; Painel eletrônico 3724, Painel atendimento ›
// Salvar configurações 3971), tipos de painel (3, travado: o legado lê os códigos 1 a 3) e os painéis de TV de
// outros setores (19; Painel portal 3972, Salvar configurações 3973). A recepção, o painel e o painel
// de TV nascem no outro sistema com o texto de impressão ou o leiaute da TV (campos que este cadastro não edita): só
// alteração aqui.
export const M19 = (d: DominioPublico): DominioPublico => ({ ...d, marco: 'M19' });

// M18 (ficha, seção 5, "Cadastros pelo CRUD genérico"): a agenda de exames, a escala semanal da agenda de
// exames e as salas cirúrgicas, com as opções do SADT › Agenda › Manutenção (2759, 2760) e do
// Bloco Cirúrgico › Tabelas › Salas (2233). Os usuários permitidos por sala têm receita própria
// (cirurgia.definirSalaUsuario): a tabela só tem a chave (incluir e excluir).
export const M18 = (d: DominioPublico): DominioPublico => ({ ...d, marco: 'M18' });

// M20: configuração do atendimento externo pelo CRUD genérico (ficha do M20, seção 5, "Cadastros pelo CRUD genérico"):
// as fichas a imprimir (modelo, título e as seleções por convênio, especialidade, unidade e grupo; Recepção externa ›
// Tabelas › Fichas a imprimir, menu de origem 3230, e Criação de fichas 3225) e os leitos de observação do pronto
// atendimento (Leitos › Manutenção 4554, Tipos de leito 4553). O modelo e o título nascem com o leiaute de impressão,
// que este cadastro não grava: só alteração. O local do leito nasce com a acomodação do mapa de leitos: só alteração.
export const M20 = (d: DominioPublico): DominioPublico => ({ ...d, marco: 'M20' });

export const FICHAS = [3230, 3225];

export const LEITOS = [4554, 4552];

export const selecaoFicha = (recurso: string, singular: string, plural: string): DominioPublico =>
  M20(
    propria(
      {
        modulo: 'atendimento',
        recurso,
        rotulo: { singular, plural },
        subitem: 'agenda',
        natureza: 'editavel',
        // W1-05: a linha de seleção (chave composta) se exclui como o cadastro anterior exclui.
        acoes: [...CIE, 'excluir'],
        categoria: 'ligacao',
      },
      todas(FICHAS, [...CIE, 'excluir']),
    ),
  );

// M26: cadastros do SADT e do portal de resultados pelo CRUD genérico (ficha do M26, seção 5, "Sem gravação nova no
// legado": receita genérica, uma assinatura por declaração): as modalidades de imagem (Integração com PACs › Equipamento,
// menu de origem 4742), as grandezas do laudo estruturado do eco (Tabelas do S.A.D.T. 2677: sem item próprio, inferida), a
// configuração do portal (Integração Resultados web 4743: cadastro de perfil 4744, perfil por usuário 4745,
// configurações gerais 4747) e o autocadastro de médico solicitante do portal do outro sistema (Acesso médico
// solicitante 4748; a aprovação liga ao médico do cadastro de solicitantes).
export const M26 = (d: DominioPublico): DominioPublico => ({ ...d, marco: 'M26' });

export const PORTAL = [4743, 4744, 4745, 4747];

// M21: cadastros da internação, da higienização e do SAME pelo CRUD genérico (ficha do M21, seção 5, "Cadastros pelo
// CRUD genérico"): as fichas a imprimir da internação (modelo, título, seleções por convênio e especialidade; Recepção
// interna › Emissão de fichas 2372 e Fichas a imprimir 2315), as áreas, os profissionais, os telefones, os vínculos
// (área e leito) e os materiais por tipo de limpeza da higienização (5004, 5008, 5010, 5006) e os setores e as
// operações do SAME (Controle de prontuários › Setores 2365; as operações são dado de sistema: o gatilho recusa).
export const M21 = (d: DominioPublico): DominioPublico => ({ ...d, marco: 'M21' });

export const FICHAS_INT = [2372, 2315];

export const HIG_AREAS = [5004];

export const HIG_PROFISSIONAIS = [5008];

export const HIG_VINCULOS = [5010];

export const HIG_MATERIAIS = [5006];

export const SAME_SETORES = [2365, 2362];

export const SEM_INCLUSAO_FICHA_INT =
  'o modelo novo nasce com o leiaute de impressão, que este cadastro não grava: a inclusão fica desligada até essa gravação ser provada; aqui se alteram o nome, as cópias, a ordem e as condições de impressão';

export const VINCULO = ['ler', 'criar', 'exportar'] as const;

// M25 (ficha, seção 5): os procedimentos e cuidados de enfermagem prescritíveis (200, com a restrição de sexo e
// idade) e os kits de material por procedimento (13), pelo CRUD genérico. Opções do módulo Tabelas: os
// procedimentos clínicos 3736 e as três áreas de kit 3679, 3689 e 3738 (inferidas pelo título "Kit", POL-1b: conferir
// na validação com a TI, DP-3). Quem edita é a supervisão de enfermagem.
export const M25 = (d: DominioPublico): DominioPublico => ({ ...d, marco: 'M25' });

export const PROCEDIMENTOS_ENF = [3736];

export const KITS_PROCEDIMENTO = [3679, 3689, 3738];
