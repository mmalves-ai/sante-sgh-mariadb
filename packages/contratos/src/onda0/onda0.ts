// Onda 0: consultas ao vivo (ficha do M38; cap-15 §15.3.2 e §15.3.3; cap-14 §14.2.6, §14.5 e §14.10). Vocabulário
// puro: o público da onda, as telas de consulta com a permissão e a chave de liberação, as únicas gravações no
// legado que a onda admite, a lista que precisa estar marcada antes da primeira liberação de todas (regra 1) e o
// resultado da vigilância diária de gravação em produção (SGH_CFG_COEX_VIGIA), que nunca carrega valor de linha.
import { z } from 'zod';

/** Grupos do legado no escopo da onda 0 (regra 3; cap-15 §15.3.3 e §15.7). */
export const GRUPOS_ONDA_0 = ['MASTER', 'MASTER_SEM_FINANCEIRO'] as const;
export type GrupoOnda0 = (typeof GRUPOS_ONDA_0)[number];

/** Hospital em que a onda 0 começa (DP-4, decidida em 2026-10-19: o Serrano só depois de todas as ondas no pc). */
export const HOSPITAL_INICIAL_ONDA_0 = 'pc';

export interface GravacaoOnda0 {
  /** Nome exato no catálogo de operações (docs/operacoes/catalogo). */
  readonly operacao: string;
  /** Só entra se o perfil confirmou o comportamento do legado (ficha do M38, campo 5); senão fica fora (Desvios). */
  readonly condicional: boolean;
  readonly motivo: string;
}

/**
 * As únicas gravações no legado admitidas na onda 0 (ficha do M38, campo 5): a trilha dupla e o login. Nenhuma
 * operação de negócio. As que o catálogo ainda não tem (perfil não confirmou) ficam fora até a decisão em Desvios.
 */
export const GRAVACOES_ONDA_0: readonly GravacaoOnda0[] = [
  {
    operacao: 'auditoria.registrarEventoLegado',
    condicional: false,
    motivo:
      'trilha dupla: login, login falho, fim de sessão, bloqueio e desbloqueio de sessão e consulta de prontuário',
  },
  {
    operacao: 'acesso.registrarLogin',
    condicional: true,
    motivo: 'só se o perfil confirmou que o cadastro do usuário recebe a data do último acesso',
  },
  {
    operacao: 'acesso.bloquearPorTentativas',
    condicional: true,
    motivo: 'só se o perfil confirmou o bloqueio por tentativas no cadastro do usuário',
  },
  {
    operacao: 'acesso.trocarSenha',
    condicional: true,
    motivo: 'plano B (ADR 0012): enquanto bloqueada, a troca de senha não grava pelo Sante SGH',
  },
];

/** Operações que podem estar `liberada` em algum hospital durante a onda 0. */
export const OPERACOES_PERMITIDAS_ONDA_0: readonly string[] = GRAVACOES_ONDA_0.map((g) => g.operacao);

export interface TelaOnda0 {
  readonly id: string;
  /** Item da árvore de menus (planejamento/fonte-pdf/arvore-menus.txt). */
  readonly item: string;
  /** Rota da tela no web (a paleta não tem rota). */
  readonly rota: string | null;
  /** Permissão de leitura exigida pela rota (código do catálogo de permissões). */
  readonly permissao: string;
  /** Chave de funcionalidade (POL-3, SGH_CFG_LIBERACAO) que liga a tela por hospital; null = ainda sem chave. */
  readonly recurso: string | null;
  /** Marco que construiu a tela. */
  readonly marco: string;
}

/**
 * Telas de consulta da onda 0 (ficha do M38, campo 7), com a permissão e a rota que o web já usa. Cada tela tem a
 * sua chave em SGH_CFG_LIBERACAO (seção 12: uma por tela de consulta e hospital, e por grupo); a busca global não
 * tem chave (é da sessão e mostra só o que as permissões e as chaves já deixam ver). As chaves das telas que o M38
 * criou (cadastro, domínios, auditoria, matriz e saúde) ligam a tela para o público da onda; a leitura em si continua
 * sob a permissão do catálogo, conferida pelo servidor (D-CHAVE-TELA-38).
 */
export const TELAS_ONDA_0: readonly TelaOnda0[] = [
  {
    id: 'prontuario',
    item: 'PEP > Prontuário ao vivo: consulta (formulários e RTF do legado)',
    rota: '/pep/prontuario',
    permissao: 'pep.prontuario.ler',
    recurso: 'pep.prontuario.consulta',
    marco: 'M15',
  },
  {
    id: 'leitos',
    item: 'Internação e leitos > Leitos > Painel de leitos ao vivo (consulta da ocupação)',
    rota: '/internacao/leitos/painel',
    permissao: 'internacao.leitos.ler',
    recurso: 'internacao.leitos.painel',
    marco: 'M16',
  },
  {
    id: 'censo',
    item: 'Internação e leitos > Leitos > Censo hospitalar diário (Portaria 312)',
    rota: '/internacao/censo',
    permissao: 'internacao.censo.ler',
    recurso: 'internacao.leitos.painel',
    marco: 'M16',
  },
  {
    id: 'paineis',
    item: 'Relatórios e BI > Painéis gerenciais (assistencial, operacional, financeiro)',
    rota: '/relatorios/paineis/:painel',
    permissao: 'relatorio.paineis.ler',
    recurso: 'relatorio.paineis',
    marco: 'M16',
  },
  {
    id: 'indicadores',
    item: 'Relatórios e BI > Indicadores hospitalares (Portaria 312, ANAHP)',
    rota: '/relatorios/indicadores',
    permissao: 'relatorio.indicadores.ler',
    recurso: 'relatorio.paineis',
    marco: 'M16',
  },
  {
    id: 'pacientes',
    item: 'Cadastros > Pacientes (cadastro único) > Cadastro e busca de paciente',
    rota: '/cadastros/pacientes',
    permissao: 'cadastro.paciente.ler',
    recurso: 'cadastro.paciente.consulta',
    marco: 'M11',
  },
  {
    id: 'pacientes-historico',
    item: 'Cadastros > Pacientes (cadastro único) > Histórico de alterações do cadastro',
    rota: '/cadastros/pacientes/historico',
    permissao: 'cadastro.historico.ler',
    recurso: 'cadastro.historico.consulta',
    marco: 'M11',
  },
  {
    id: 'profissionais',
    item: 'Cadastros > Profissionais > Profissionais, registros (CBO, conselho) e especialidades',
    rota: '/cadastros/profissionais',
    permissao: 'cadastro.profissional.ler',
    recurso: 'cadastro.profissional.consulta',
    marco: 'M11',
  },
  {
    id: 'dominios',
    item: 'Cadastros > Domínios e tabelas auxiliares (CRUD genérico)',
    rota: '/cadastros/dominios',
    permissao: 'config.dominio.ler',
    recurso: 'config.dominio.consulta',
    marco: 'M14',
  },
  {
    id: 'acessos-prontuario',
    item: 'Administração > Auditoria e privacidade > Registro de acesso ao prontuário (leituras)',
    rota: '/administracao/auditoria/acessos-prontuario',
    permissao: 'auditoria.acessos.ler',
    recurso: 'auditoria.acessos.consulta',
    marco: 'M15',
  },
  {
    id: 'matriz',
    item: 'Administração > Coexistência com o legado > Painel da matriz de cobertura',
    rota: '/administracao/coexistencia/matriz',
    permissao: 'config.matriz.ler',
    recurso: 'config.matriz.consulta',
    marco: 'M14',
  },
  {
    id: 'saude',
    item: 'Administração > Saúde do sistema (observabilidade)',
    rota: '/administracao/saude',
    permissao: 'sistema.saude.ler',
    recurso: 'sistema.saude.consulta',
    marco: 'M09',
  },
  {
    id: 'busca-global',
    item: 'Início > Busca global e paleta de comandos (Ctrl+K)',
    rota: null,
    permissao: 'sessao',
    recurso: null,
    marco: 'M10',
  },
];

/** Chaves de tela criadas pelo M38 (as demais telas da onda já tinham a sua, dos marcos de origem). */
export const CHAVES_TELA_ONDA_0 = [
  'cadastro.paciente.consulta',
  'cadastro.historico.consulta',
  'cadastro.profissional.consulta',
  'config.dominio.consulta',
  'auditoria.acessos.consulta',
  'config.matriz.consulta',
  'sistema.saude.consulta',
] as const;
export type ChaveTelaOnda0 = (typeof CHAVES_TELA_ONDA_0)[number];

/**
 * As permissões de leitura que cada chave de tela da onda 0 abre (seção 12: recolher é desligar a chave). A casca
 * tira a permissão da sessão quando a chave não vale para quem usa (menu, paleta e rota), e o servidor recusa a
 * rota declarada com a permissão (403 `recurso-desligado`, com o aviso de fora do escopo quando é o caso).
 */
export const PERMISSOES_SOB_CHAVE_DE_TELA: Readonly<Record<ChaveTelaOnda0, readonly string[]>> = {
  'cadastro.paciente.consulta': ['cadastro.paciente.ler'],
  'cadastro.historico.consulta': ['cadastro.historico.ler'],
  'cadastro.profissional.consulta': ['cadastro.profissional.ler'],
  'config.dominio.consulta': ['config.dominio.ler'],
  'auditoria.acessos.consulta': ['auditoria.acessos.ler'],
  'config.matriz.consulta': ['config.matriz.ler'],
  'sistema.saude.consulta': ['sistema.saude.ler'],
};

/**
 * Leitura compartilhada com as telas das ondas seguintes: a mesma rota serve à busca do paciente da agenda, da
 * recepção, do atendimento, do centro cirúrgico e da internação. Com a chave de uma dessas telas ligada para quem
 * usa, a leitura vale mesmo sem a chave da tela de consulta (a tela de consulta continua fechada na casca).
 */
export const CHAVES_QUE_TAMBEM_ABREM_A_LEITURA: Readonly<Record<string, readonly string[]>> = {
  'cadastro.paciente.ler': [
    'agenda.consulta',
    'agenda.exame',
    'recepcao.senha',
    'cirurgia.agenda',
    'atendimento.ambulatorio',
    'atendimento.pa',
    'internacao.adt',
  ],
};

/** Motivo da recusa da leitura com a chave da tela desligada no estabelecimento (ou à espera de pré-requisito). */
export const MOTIVO_TELA_DESLIGADA_ONDA_0 = 'Esta consulta ainda não está ligada neste estabelecimento.';

/**
 * Gravações de negócio que as ações de escrita de cada tela usariam (o executor recusa enquanto não estiverem
 * `liberada` no hospital): com todas recusadas, a tela mostra a faixa "só consulta nesta etapa" e as ações de
 * escrita desabilitadas (ficha do M38, campo 7). As telas sem escrita não aparecem.
 */
export const ESCRITAS_TELAS_ONDA_0: Readonly<Record<string, readonly string[]>> = {
  pacientes: ['cadastro.cadastrarPaciente', 'cadastro.alterarPaciente', 'cadastro.unificarPaciente'],
  profissionais: [
    'cadastro.cadastrarProfissional',
    'cadastro.alterarProfissional',
    'cadastro.incluirRegistroProfissional',
    'cadastro.alterarRegistroProfissional',
    'cadastro.definirEspecialidadeProfissional',
    'cadastro.credenciarProfissional',
    'cadastro.vincularLoginProfissional',
    'cadastro.inativarProfissional',
    'cadastro.reativarProfissional',
    'cadastro.excluirProfissional',
    'cadastro.excluirRegistroProfissional',
  ],
  dominios: [
    'cadastro.incluirEstadoCivil',
    'cadastro.alterarEstadoCivil',
    'cadastro.incluirConselho',
    'cadastro.alterarConselho',
    'organizacao.alterarUnidade',
  ],
};

/** Motivo da recusa da consulta a quem está fora do escopo da onda (regra 3); o mesmo texto do web. */
export const MOTIVO_FORA_DO_ESCOPO_ONDA_0 =
  'Esta consulta ainda não foi liberada para o seu perfil nesta etapa da implantação.';

/** Situação de uma tela da onda para quem pergunta (GET /api/onda0/telas). */
export const SITUACOES_TELA_ONDA_0 = [
  'ligada',
  'desligada',
  'fora-do-escopo',
  'prerequisito',
  'sem-chave',
] as const;
export type SituacaoTelaOnda0 = (typeof SITUACOES_TELA_ONDA_0)[number];

export const esquemaTelaOnda0Situacao = z
  .object({
    id: z.string(),
    recurso: z.string().nullable(),
    permissao: z.string(),
    situacao: z.enum(SITUACOES_TELA_ONDA_0),
    /** A tela tem ações de escrita e alguma está liberada para quem pergunta; null: a tela não tem escrita. */
    escritaLiberada: z.boolean().nullable(),
  })
  .strict();
export type TelaOnda0Situacao = z.infer<typeof esquemaTelaOnda0Situacao>;

export const esquemaTelasOnda0 = z
  .object({
    hospital: z.string(),
    telas: z.array(esquemaTelaOnda0Situacao),
  })
  .strict();
export type TelasOnda0 = z.infer<typeof esquemaTelasOnda0>;

/** Itens que têm de estar marcados antes da primeira liberação de todas (regra 1; cap-15 §15.3.2). */
export const ITENS_PRIMEIRA_LIBERACAO = [
  'pentest',
  'ciencia-dp40',
  'adiado-para-deploy',
  'logo-dp9',
  'metas-de-servico',
  'prazos-de-severidade',
  'plantao-n3',
  'linha-de-base',
  'autorizacoes',
] as const;
export type ItemPrimeiraLiberacao = (typeof ITENS_PRIMEIRA_LIBERACAO)[number];

/** Descrição e fonte de cada item (a lista marcada em docs/marcos/M38/evidencias.md cita a fonte). */
export const FONTES_PRIMEIRA_LIBERACAO: Readonly<
  Record<ItemPrimeiraLiberacao, { readonly descricao: string; readonly fonte: string }>
> = {
  pentest: { descricao: 'pentest sem crítico ou alto aberto', fonte: 'cap-15 §15.3.2; M36' },
  'ciencia-dp40': {
    descricao: 'ciência formal das concessões de segurança registrada no deploy',
    fonte: 'DP-40; cap-08 §8.15',
  },
  'adiado-para-deploy': {
    descricao: 'itens de ESTADO.md › Adiado para o deploy concluídos',
    fonte: 'ESTADO.md',
  },
  'logo-dp9': { descricao: 'logo validado pelo marketing da Rede', fonte: 'DP-9; DP-49' },
  'metas-de-servico': {
    descricao: 'metas de serviço aprovadas (abrir prontuário p95 < 1,5 s; login p95 < 2 s)',
    fonte: 'cap-14 §14.5',
  },
  'prazos-de-severidade': { descricao: 'prazos de severidade aprovados', fonte: 'cap-14 §14.9.2' },
  'plantao-n3': { descricao: 'plantão N3 com roteiro por alerta', fonte: 'cap-14 §14.9.3' },
  'linha-de-base': { descricao: 'linha de base do servidor medida', fonte: 'cap-10 §10.11' },
  autorizacoes: {
    descricao: 'autorizações de implantação, scripts SGH_ em produção e liberação da onda 0 por hospital',
    fonte: 'ficha do M38, campo 2; cap-09 §9.13',
  },
};

/** Metas de serviço da onda (cap-14 §14.5), em milissegundos de p95. Valores propostos até a aprovação. */
export const METAS_ONDA_0 = {
  abrirProntuarioP95Ms: 1500,
  abrirRegistroP95Ms: 1500,
  loginP95Ms: 2000,
  buscaPacienteP95Ms: 300,
  consultaCadastroP95Ms: 500,
  cicloPainelLeitosMs: 300,
  censoMs: 2000,
} as const;

/** Partes da assinatura que podem divergir, sem valor (o tipo da classe, nunca o argumento dela). */
export const TIPOS_ELEMENTO_VIGIA = [
  'tabela',
  'acao',
  'linhas',
  'colunas',
  'classe',
  'formato',
  'ligacao',
  'efeito-trigger',
  'generator',
] as const;

const NOME_ESTRUTURA = /^[A-Z][A-Z0-9_$]{0,62}$/;

export const esquemaElementoVigia = z
  .object({
    tipo: z.enum(TIPOS_ELEMENTO_VIGIA),
    tabela: z.string().regex(NOME_ESTRUTURA),
    coluna: z.string().regex(NOME_ESTRUTURA).nullable(),
    /** Tipo da classe esperada (`entrada`, `constante`, `dominio`...), nunca o valor; null quando não se aplica. */
    classe: z
      .string()
      .regex(/^[a-z-]{1,20}$/)
      .nullable(),
    /** Em quantas gravações da amostra o elemento divergiu. */
    ocorrencias: z.number().int().positive(),
  })
  .strict();
export type ElementoVigia = z.infer<typeof esquemaElementoVigia>;

/** Uma linha de SGH_CFG_COEX_VIGIA: hospital, dia, operação e o que divergiu (só estrutura). */
export const esquemaResultadoVigia = z
  .object({
    hospital: z.string().regex(/^[a-z]{2,8}$/),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    operacao: z.string().regex(/^[a-z]+\.[a-zA-Z]+$/),
    amostradas: z.number().int().nonnegative(),
    divergentes: z.number().int().nonnegative(),
    elementos: z.array(esquemaElementoVigia),
  })
  .strict()
  .refine((r) => r.divergentes <= r.amostradas, { message: 'divergentes acima da amostra' })
  .refine((r) => (r.divergentes === 0) === (r.elementos.length === 0), {
    message: 'elementos só quando há divergência',
  });
export type ResultadoVigia = z.infer<typeof esquemaResultadoVigia>;

/** Linha lida de SGH_CFG_COEX_VIGIA: o resultado e o momento da execução (ISO 8601). */
export const esquemaExecucaoVigia = z
  .object({ resultado: esquemaResultadoVigia, executadoEm: z.string() })
  .strict();
export type ExecucaoVigia = z.infer<typeof esquemaExecucaoVigia>;

/** GET /api/config/assinaturas/vigia?hospital=&de=&ate= (tela de testes de assinatura, aba Vigilância diária). */
export const esquemaPainelVigia = z
  .object({
    hospital: z.string(),
    de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    estabelecimentos: z.array(z.string()),
    execucoes: z.array(esquemaExecucaoVigia),
  })
  .strict();
export type PainelVigia = z.infer<typeof esquemaPainelVigia>;

/** Tamanho padrão da amostra diária por operação (cap-14 §14.2.6, proposta: a TI ajusta por COEX_VIGIA_AMOSTRA). */
export const AMOSTRA_VIGIA_PADRAO = 50;

/** Sondas da implantação azul/verde (cap-14 §14.10.1): GET /api/sistema/sonda, antes de receber tráfego. */
export const SONDAS_IMPLANTACAO = [
  'saude',
  'versao',
  'login-sonda',
  'painel-leitos',
  'recusa-negocio',
] as const;
export type SondaImplantacao = (typeof SONDAS_IMPLANTACAO)[number];

export const esquemaResultadoSonda = z
  .object({
    sonda: z.enum(SONDAS_IMPLANTACAO),
    ok: z.boolean(),
    /** Texto curto sem dado (contagem, versão, código do problema). */
    detalhe: z.string().max(200),
    ms: z.number().int().nonnegative(),
  })
  .strict();
export type ResultadoSonda = z.infer<typeof esquemaResultadoSonda>;

export const esquemaSondasImplantacao = z
  .object({
    hospital: z.string(),
    versao: z.string(),
    pronta: z.boolean(),
    sondas: z.array(esquemaResultadoSonda),
  })
  .strict();
export type SondasImplantacao = z.infer<typeof esquemaSondasImplantacao>;

// ── Conferência de leitura do chave-usuário (regra 6; cap-15 §15.3.1; m32, figuras 32.1 e 32.2) ──────────────

/** Áreas que têm de conferir as leituras da onda 0 (NIR e diretoria clínica). */
export const AREAS_CONFERENCIA_LEITURAS = ['nir', 'diretoria-clinica'] as const;

/** O que o chave-usuário confere em cada tela, lado a lado com o outro sistema. */
export const ITENS_CONFERENCIA_LEITURAS = {
  leitos: 'o painel de leitos bate com o outro sistema no mesmo minuto em todas as unidades',
  censo: 'o censo do dia bate com o movimento do dia',
  prontuario: 'o prontuário mostra os registros como foram feitos, com a marca de feito fora do Sante SGH',
  paineis: 'os painéis e indicadores batem com os números do hospital no período',
  pacientes: 'a busca e a ficha do paciente batem com o cadastro',
} as const;
export type TelaConferida = keyof typeof ITENS_CONFERENCIA_LEITURAS;

const RE_SEM_DADO_PESSOAL = /^(?![\s\S]*\d{4,})(?![\s\S]*@)[\s\S]{0,600}$/;

/** Registro `docs/operacoes/conferencias/<pc|hs>/leituras-onda-0.yaml`: papel e área, nunca nome. */
export const esquemaConferenciaLeiturasOnda0 = z
  .object({
    formato: z.literal(1),
    estabelecimento: z.string().regex(/^[a-z][a-z0-9]{0,9}$/),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'AAAA-MM-DD'),
    /** Versão do Sante SGH em que a conferência foi feita (a identificação da tela Sobre). */
    versao: z.string().min(1).max(80),
    conferentes: z
      .array(
        z
          .object({
            papel: z.enum(['chave-usuario', 'medico', 'enfermeiro', 'ti', 'responsavel-tecnico']),
            area: z.string().min(2).max(60),
          })
          .strict(),
      )
      .min(1),
    leituras: z
      .array(
        z
          .object({
            tela: z.enum(Object.keys(ITENS_CONFERENCIA_LEITURAS) as [TelaConferida, ...TelaConferida[]]),
            resultado: z.enum(['conforme', 'divergente']),
            /** Quantas unidades (ou registros) foram conferidas, sem identificar nenhuma. */
            conferidas: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1),
    resultado: z.enum(['aceita', 'recusada']),
    observacoes: z
      .string()
      .regex(RE_SEM_DADO_PESSOAL, 'observação sem dígitos em sequência nem e-mail')
      .optional(),
    revisao: z
      .object({
        pr: z.string().regex(/^(?:#\d+|[0-9a-f]{7,40})$/),
        data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .strict(),
  })
  .strict();
export type ConferenciaLeiturasOnda0 = z.infer<typeof esquemaConferenciaLeiturasOnda0>;
