// Mapa grupo do legado → perfil do Sante SGH (ficha do M06, regra 12; cap-08 §8.7): proposta automática,
// revisada por área no M10 (gravada em SGH_ACESSO_MAPA_OPCAO). O grupo continua valendo nos dois sistemas; o
// perfil serve para aplicar as regras que o legado não tem (categoria profissional, vínculo, minimização),
// abrir a tela inicial certa e propor perfis complementares. Grupos sem usuários ativos continuam no
// legado; PAINEIS não vira perfil de pessoa; MASTER* e SEM GRUPO ficam "caso a caso".

export type CategoriaProfissional =
  | 'medico'
  | 'enfermeiro'
  | 'tecnico-enfermagem'
  | 'farmaceutico'
  | 'biomedico'
  | 'tecnico-sadt'
  | 'nutricionista'
  | 'fisioterapeuta'
  | 'administrativo';

/** Categorias com conselho profissional (CRM, COREN, CRF, CRBM, CRN, CREFITO). */
export const CATEGORIAS_COM_CONSELHO: ReadonlySet<CategoriaProfissional> = new Set([
  'medico',
  'enfermeiro',
  'farmaceutico',
  'biomedico',
  'nutricionista',
  'fisioterapeuta',
]);

export type Nivel = 'operador' | 'supervisor' | 'gestor';

export type DestinoGrupo =
  | {
      readonly tipo: 'perfil';
      readonly perfil: string;
      readonly nivel: Nivel;
      readonly categoria: CategoriaProfissional;
      readonly assistencial: boolean;
    }
  | { readonly tipo: 'continua-no-legado'; readonly motivo: string }
  | { readonly tipo: 'painel'; readonly motivo: string }
  | { readonly tipo: 'caso-a-caso'; readonly motivo: string };

const p = (
  perfil: string,
  nivel: Nivel,
  categoria: CategoriaProfissional,
  assistencial = categoria !== 'administrativo',
): DestinoGrupo => ({ tipo: 'perfil', perfil, nivel, categoria, assistencial });

const SEM_USUARIOS = {
  tipo: 'continua-no-legado',
  motivo: 'sem usuários ativos; sem perfil correspondente por ora',
} as const;
const CASO = { tipo: 'caso-a-caso', motivo: 'revisão individual; acesso amplo atual mantido' } as const;

/** Chave do grupo: maiúsculas sem acento, espaços simples (o nome vem do legado em CP1252). */
export function chaveGrupo(nome: string): string {
  return nome.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Os 42 grupos da cópia do ProntoCardio (contados em 2026-10-18; cap-08 §8.7). */
export const MAPA_GRUPOS: Readonly<Record<string, DestinoGrupo>> = {
  MEDICOS: p('medico', 'operador', 'medico'),
  MEDICOS_SUPERVISAO: p('coordenador-medico', 'supervisor', 'medico'),
  ENFERMAGEM_TECNICO: p('tecnico-enfermagem', 'operador', 'tecnico-enfermagem'),
  ENFERMAGEM_ENFERMEIRO: p('enfermeiro', 'operador', 'enfermeiro'),
  ENFERMAGEM_ENFERMEIRO_CC: p('enfermeiro-centro-cirurgico', 'operador', 'enfermeiro'),
  ENFERMAGEM_SUPERVISAO: p('coordenador-enfermagem', 'supervisor', 'enfermeiro'),
  FARMACIA: p('farmaceutico', 'operador', 'farmaceutico'),
  FARMACIA_SUPERVISAO: p('supervisor-farmacia', 'supervisor', 'farmaceutico'),
  LABORATORIO: p('laboratorio', 'operador', 'biomedico'),
  LABORATORIO_SUPERVISAO: p('supervisor-laboratorio', 'supervisor', 'biomedico'),
  EXAMES_TECNICO: p('tecnico-imagem', 'operador', 'tecnico-sadt'),
  NUTRICAO: p('nutricionista', 'operador', 'nutricionista'),
  FISIOTERAPIA: p('fisioterapeuta', 'operador', 'fisioterapeuta'),
  ATENDIMENTO: p('recepcao-ambulatorio', 'operador', 'administrativo'),
  ATENDIMENTO_INTERNACAO: p('recepcao-internacao', 'operador', 'administrativo'),
  'ATENDIMENTO_PRONTO ATENDIMENTO': p('recepcao-pronto-atendimento', 'operador', 'administrativo'),
  ATENDIMENTO_SUPERVISAO: p('supervisor-recepcao', 'supervisor', 'administrativo'),
  FATURAMENTO: p('faturista', 'operador', 'administrativo'),
  FATURAMENTO_ASSISTENCIAL: p('faturista-assistencial', 'operador', 'administrativo'),
  FATURAMENTO_AUDITORIA: p('auditor-contas', 'operador', 'administrativo'),
  FATURAMENTO_AUDITORIA_MATMED: p('auditor-contas', 'operador', 'administrativo'),
  FATURAMENTO_SUPERVISAO: p('supervisor-faturamento', 'supervisor', 'administrativo'),
  FINANCEIRO: p('financeiro', 'operador', 'administrativo'),
  FINANCEIRO_CONTAS_A_RECEBER: p('financeiro-contas-a-receber', 'operador', 'administrativo'),
  FINANCEIRO_CONSULTA: p('financeiro-consulta', 'operador', 'administrativo'),
  FINANCEIRO_SUPERVISAO: p('supervisor-financeiro', 'supervisor', 'administrativo'),
  DIRETOR_FINANCEIRO: p('diretoria-administrativa-financeira', 'gestor', 'administrativo'),
  ALMOXARIFADO: p('almoxarife', 'operador', 'administrativo'),
  ALMOXARIFADO_SUPERVISAO: p('supervisor-suprimentos', 'supervisor', 'administrativo'),
  COMPRAS: p('comprador', 'operador', 'administrativo'),
  HOTELARIA: p('supervisor-higienizacao-hotelaria', 'supervisor', 'administrativo'),
  PAINEIS: {
    tipo: 'painel',
    motivo: 'logins de TV; nos painéis novos, dispositivo Painel/Totem sem login de pessoa',
  },
  MASTER: CASO,
  MASTER_SEM_FINANCEIRO: CASO,
  MASTER_CONSULTA_FINANCEIRO: CASO,
  'SEM GRUPO': { tipo: 'caso-a-caso', motivo: 'revisão individual; sem perfil padrão' },
  DIRETORIA: SEM_USUARIOS,
  TI: SEM_USUARIOS,
  TI_SUPERVISAO: SEM_USUARIOS,
  COMPRAS_SUPERVISAO: SEM_USUARIOS,
  EXAMES_LAUDOS: SEM_USUARIOS,
  HOTERIA_SUPERVISAO: SEM_USUARIOS,
};

/**
 * Destino de um grupo. Grupo desconhecido (criado no legado depois do mapa) fica "caso a caso" até a
 * revisão: nunca recebe perfil por adivinhação.
 */
export function destinoDoGrupo(nome: string | null): DestinoGrupo {
  if (!nome) return { tipo: 'caso-a-caso', motivo: 'usuário sem grupo' };
  return (
    MAPA_GRUPOS[chaveGrupo(nome)] ?? {
      tipo: 'caso-a-caso',
      motivo: 'grupo fora do mapa (criado depois); revisão da área',
    }
  );
}
