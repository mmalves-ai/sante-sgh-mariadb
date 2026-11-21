// Contratos do M59-F5 (ficha do M59, seções 4, 7 e 8, regras 9 e 10; cap-13 §13.2.1, §13.3, §13.6): o pacote de
// evidências SBIS, a autoavaliação mensal, a pré-auditoria externa e a auditoria formal, com as não conformidades e a
// correção de cada uma; o termo das concessões provisórias da coexistência (SGH_AUDIT_CONCESSAO), encerradas uma a
// uma com a evidência do endurecimento; o backup verificado (relatórios de restauração diária e mensal) e a
// exportação da trilha com a identificação do software, do estabelecimento (nome, CNES e CNPJ) e a prova da cadeia.
// O catálogo de requisitos é o recorte do cap-13 §13.3.1 a §13.3.3 (Manual v5.2); a planilha oficial completa entra
// pela mesma estrutura (código, nível, módulo, regime, concessão e evidências).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

// ── catálogo dos requisitos ──────────────────────────────────────────────────────────────────────

export const NIVEIS_SBIS = ['NGS1', 'ECF', 'NGS2'] as const;
export type NivelSbis = (typeof NIVEIS_SBIS)[number];

/** Regime do requisito durante a coexistência (cap-13 §13.2.1). */
export const REGIMES_SBIS = ['novo', 'concessao', 'pos-coexistencia'] as const;
export type RegimeSbis = (typeof REGIMES_SBIS)[number];

/** As concessões provisórias da coexistência (cap-13 §13.2.1, aceitas pelo dono em 18/10/2026). */
export const CONCESSOES_COEXISTENCIA = [
  'senha-formato-antigo',
  'permissoes-antigas',
  'privilegio-banco',
  'trilha-alteravel',
  'prontuario-alteravel',
  'segredos-em-tabela',
] as const;
export type CodigoConcessao = (typeof CONCESSOES_COEXISTENCIA)[number];

/** Os itens do pacote de evidências (cap-13 §13.6.3; regra 10). */
export const ITENS_PACOTE_SBIS = [
  'roteiro-demonstracao',
  'ambiente-testes',
  'trilha-exportada',
  'configuracao-seguranca',
  'restauracao-backup',
  'comunicacao-segura',
  'documentacao',
  'assinaturas',
  'fim-concessoes',
  'matriz-rastreabilidade',
] as const;
export type ItemPacoteSbis = (typeof ITENS_PACOTE_SBIS)[number];

export interface RequisitoSbis {
  readonly codigo: string;
  readonly nivel: NivelSbis;
  readonly titulo: string;
  readonly modulo: string;
  readonly regime: RegimeSbis;
  /** A concessão que o requisito espera encerrar (regime `concessao`). */
  readonly concessao?: CodigoConcessao;
  /** Itens do ECF que dependem de entrega da Fase 5 (a auditoria formal só com eles prontos; regra 9). */
  readonly fase5?: boolean;
  readonly evidencias: readonly ItemPacoteSbis[];
}

const R = (
  codigo: string,
  nivel: NivelSbis,
  titulo: string,
  modulo: string,
  regime: RegimeSbis,
  evidencias: readonly ItemPacoteSbis[],
  extra: Partial<Pick<RequisitoSbis, 'concessao' | 'fase5'>> = {},
): RequisitoSbis => ({ codigo, nivel, titulo, modulo, regime, evidencias, ...extra });

const DEMO = ['roteiro-demonstracao', 'matriz-rastreabilidade'] as const;

/** Catálogo dos requisitos SBIS acompanhados (cap-13 §13.3.1 a §13.3.3). */
export const REQUISITOS_SBIS: readonly RequisitoSbis[] = [
  R(
    'SBIS-01',
    'NGS1',
    'Tela "Sobre" com nome, fornecedor e versão; versão em toda exportação',
    'Plataforma',
    'novo',
    [...DEMO, 'documentacao'],
  ),
  R(
    'SBIS-02',
    'NGS1',
    'Login validado no servidor; código temporário só como segundo fator',
    'Plataforma',
    'novo',
    [...DEMO, 'configuracao-seguranca'],
  ),
  R(
    'SBIS-03',
    'NGS1',
    'Senha guardada com hash e salt individual; nova gravação no primeiro login',
    'Plataforma',
    'concessao',
    [...DEMO, 'fim-concessoes'],
    { concessao: 'senha-formato-antigo' },
  ),
  R(
    'SBIS-04',
    'NGS1',
    'Qualidade e ciclo da senha parametrizáveis',
    'Plataforma',
    'concessao',
    [...DEMO, 'configuracao-seguranca'],
    { concessao: 'senha-formato-antigo' },
  ),
  R('SBIS-05', 'NGS1', 'Bloqueio após até 10 tentativas, com mensagem genérica', 'Plataforma', 'novo', [
    ...DEMO,
    'configuracao-seguranca',
  ]),
  R('SBIS-06', 'NGS1', 'Último acesso mostrado ao entrar', 'Plataforma', 'novo', [
    ...DEMO,
    'configuracao-seguranca',
  ]),
  R('SBIS-07', 'NGS1', 'Reautenticação em operação crítica, lista configurável', 'Plataforma', 'novo', [
    ...DEMO,
    'configuracao-seguranca',
  ]),
  R(
    'SBIS-08',
    'NGS1',
    'Dois métodos de autenticação, com opção de exigir os dois',
    'Plataforma',
    'pos-coexistencia',
    [...DEMO, 'configuracao-seguranca'],
  ),
  R(
    'SBIS-09',
    'NGS1',
    'Sessão bloqueada por inatividade, sem perder o digitado, protegida contra roubo e repetição',
    'Plataforma',
    'novo',
    [...DEMO, 'configuracao-seguranca'],
  ),
  R(
    'SBIS-10',
    'NGS1',
    'Toda tela protegida por permissão; administrativo sem acesso clínico',
    'Acesso',
    'concessao',
    DEMO,
    { concessao: 'permissoes-antigas' },
  ),
  R(
    'SBIS-11',
    'NGS1',
    'Uma pessoa, um usuário ligado a CPF único; usuário com operação só é inativado',
    'Acesso',
    'novo',
    DEMO,
  ),
  R(
    'SBIS-12',
    'NGS1',
    'Sempre um administrador ou gestor de acessos ativo e não removível',
    'Acesso',
    'concessao',
    DEMO,
    { concessao: 'permissoes-antigas' },
  ),
  R(
    'SBIS-13',
    'NGS1',
    'Backup completo, cifrado, verificado e com restauração conferida',
    'Infraestrutura',
    'novo',
    ['restauracao-backup', 'documentacao'],
  ),
  R(
    'SBIS-14',
    'NGS1',
    'TLS 1.2 ou superior e canal autenticado entre componentes, inclusive com o banco',
    'Plataforma',
    'concessao',
    ['comunicacao-segura', 'fim-concessoes'],
    { concessao: 'privilegio-banco' },
  ),
  R(
    'SBIS-15',
    'NGS1',
    'Registro no banco; anexos cifrados com nome opaco; exportação cifrada',
    'Plataforma',
    'novo',
    DEMO,
  ),
  R(
    'SBIS-16',
    'NGS1',
    'Trilha que não pode ser desligada, só de inclusão, com hash encadeado',
    'Auditoria',
    'concessao',
    ['trilha-exportada', 'fim-concessoes'],
    { concessao: 'trilha-alteravel' },
  ),
  R('SBIS-17', 'NGS1', 'Catálogo de eventos auditáveis da versão 5.2', 'Auditoria', 'novo', [
    'trilha-exportada',
    'matriz-rastreabilidade',
  ]),
  R(
    'SBIS-18',
    'NGS1',
    'Evento com ID, data e hora com fuso, estação, usuário e objeto; sem dado clínico',
    'Auditoria',
    'novo',
    ['trilha-exportada'],
  ),
  R(
    'SBIS-19',
    'NGS1',
    'Consulta cronológica da trilha e exportação aberta com nome, CNES e CNPJ',
    'Auditoria',
    'novo',
    [...DEMO, 'trilha-exportada'],
  ),
  R('SBIS-20', 'NGS1', 'Manuais por perfil, instalação, backup e notas de versão', 'Documentação', 'novo', [
    'documentacao',
  ]),
  R('SBIS-21', 'NGS1', 'Hora sincronizada, milissegundos e fuso; exportação RFC 3339', 'Plataforma', 'novo', [
    'trilha-exportada',
    'documentacao',
  ]),
  R(
    'SBIS-22',
    'NGS1',
    'Canal para o usuário registrar incidente, problema ou sugestão',
    'Suporte',
    'novo',
    DEMO,
  ),
  R(
    'SBIS-23',
    'NGS1',
    'Termo de uso e privacidade aceito no primeiro acesso e a cada versão',
    'Acesso',
    'novo',
    DEMO,
  ),
  R(
    'SBIS-24',
    'NGS1',
    'Contestação do paciente sobre a exatidão de dado, com resposta',
    'Privacidade',
    'novo',
    DEMO,
  ),
  R(
    'SBIS-25',
    'NGS1',
    'Anonimização e pseudonimização em exportações e bases não produtivas',
    'Privacidade',
    'novo',
    [...DEMO, 'ambiente-testes'],
  ),
  R(
    'SBIS-26',
    'NGS1',
    'Correção só pelo autor, com nova versão e justificativa; nunca alteração clínica',
    'Prontuário',
    'concessao',
    [...DEMO, 'fim-concessoes'],
    { concessao: 'prontuario-alteravel' },
  ),
  R(
    'ECF.01',
    'ECF',
    'Estabelecimento, setores, leitos e profissional com conselho, UF e CBO',
    'Cadastros',
    'novo',
    DEMO,
  ),
  R(
    'ECF.03.01',
    'ECF',
    'Paciente aderente ao CNS: nome social, gênero, raça/cor e representante legal',
    'Cadastros',
    'novo',
    DEMO,
  ),
  R(
    'ECF.03.10',
    'ECF',
    'Detecção e unificação de duplicidades; busca fonética; cabeçalho fixo do paciente',
    'Cadastros',
    'novo',
    DEMO,
  ),
  R(
    'ECF.06',
    'ECF',
    'Abertura de atendimento, alocação de leito, alta médica separada da administrativa',
    'Internação',
    'novo',
    DEMO,
  ),
  R(
    'ECF.07',
    'ECF',
    'Sumário clínico, alergias, anamnese, CID, problemas, evoluções, interconsulta e óbito',
    'Prontuário',
    'novo',
    DEMO,
  ),
  R(
    'ECF.07.SAE',
    'ECF',
    'Diagnósticos e prescrição de enfermagem, balanço hídrico, feridas e escalas',
    'Enfermagem',
    'novo',
    DEMO,
    { fase5: true },
  ),
  R(
    'ECF.07.30',
    'ECF',
    'Preceptoria: residente registra, preceptor valida e coassina',
    'Prontuário',
    'novo',
    DEMO,
  ),
  R(
    'ECF.07.33',
    'ECF',
    'Sumário de alta no modelo oficial, editável, no mínimo em PDF',
    'Internação',
    'novo',
    DEMO,
  ),
  R(
    'ECF.09',
    'ECF',
    'Centro cirúrgico: equipe, horários, relatório e entrada e saída da sala',
    'Centro cirúrgico',
    'novo',
    DEMO,
  ),
  R(
    'ECF.09.SEG',
    'ECF',
    'Avaliação pré-anestésica, ficha anestésica e checklist de cirurgia segura',
    'Centro cirúrgico',
    'novo',
    DEMO,
    { fase5: true },
  ),
  R(
    'ECF.10',
    'ECF',
    'Prescrição estruturada, não padronizado, favoritos, suspensão e situação por item',
    'Prescrição',
    'novo',
    DEMO,
  ),
  R(
    'ECF.11',
    'ECF',
    'Validação farmacêutica, dispensação e conferência por código de barras',
    'Farmácia',
    'novo',
    DEMO,
  ),
  R(
    'ECF.12',
    'ECF',
    'Checagem à beira do leito com leitura da pulseira e do medicamento',
    'Enfermagem',
    'novo',
    DEMO,
  ),
  R(
    'ECF.12.RAS',
    'ECF',
    'Hemocomponentes e OPME com código e lote na administração',
    'Hemoterapia e OPME',
    'novo',
    DEMO,
    { fase5: true },
  ),
  R('ECF.13', 'ECF', 'Pedido e resultado de exames, com destaque fora da referência', 'Exames', 'novo', DEMO),
  R(
    'ECF.14',
    'ECF',
    'Apoio à decisão na prescrição, com justificativa da exceção',
    'Prescrição',
    'novo',
    DEMO,
  ),
  R(
    'ECF.15',
    'ECF',
    'Rascunho, registro retroativo marcado, terminologia com versão e versão de testes',
    'Prontuário',
    'novo',
    [...DEMO, 'ambiente-testes'],
  ),
  R(
    'ECF.18',
    'ECF',
    'Modelos de TCLE, termos de consentimento e impressão do prontuário com recibo',
    'Prontuário',
    'novo',
    DEMO,
  ),
  R(
    'ECF.19',
    'ECF',
    'Agravos de notificação parametrizáveis com situação notificado ou não',
    'Vigilância',
    'novo',
    DEMO,
    { fase5: true },
  ),
  R('ECF.20.03', 'ECF', 'Sumário de alta gerado e guardado no modelo oficial', 'Integrações', 'novo', DEMO, {
    fase5: true,
  }),
  R(
    'SBIS-30',
    'NGS2',
    'Certificado A1, A3 e em nuvem; pelo menos duas autoridades por mídia',
    'Assinatura',
    'novo',
    ['assinaturas'],
  ),
  R('SBIS-31', 'NGS2', 'CPF do certificado igual ao do usuário a cada uso', 'Assinatura', 'novo', [
    'assinaturas',
  ]),
  R(
    'SBIS-32',
    'NGS2',
    'Validação no servidor: cadeia, vigência e revogação; raízes atualizadas',
    'Assinatura',
    'novo',
    ['assinaturas'],
  ),
  R('SBIS-33', 'NGS2', 'Formatos CAdES, XAdES ou PAdES com política mínima AD-RB', 'Assinatura', 'novo', [
    'assinaturas',
  ]),
  R('SBIS-35', 'NGS2', 'Prévia exata do conteúdo assinado', 'Documentos', 'novo', ['assinaturas', ...DEMO]),
  R('SBIS-36', 'NGS2', 'Pendências de assinatura: aviso, lista e assinatura em lote', 'Documentos', 'novo', [
    'assinaturas',
    ...DEMO,
  ]),
  R(
    'SBIS-37',
    'NGS2',
    'Serviço externo fora do ar: pendente, aviso e reprocessamento',
    'Assinatura',
    'novo',
    ['assinaturas'],
  ),
  R(
    'SBIS-38',
    'NGS2',
    'Selo de assinado visível; encadeamento por paciente verificável',
    'Documentos',
    'novo',
    ['assinaturas'],
  ),
  R('SBIS-39', 'NGS2', 'Validação ao incluir, assinar, imprimir, importar e exportar', 'Assinatura', 'novo', [
    'assinaturas',
  ]),
  R('SBIS-40', 'NGS2', 'Carimbo do tempo na prescrição e no atestado', 'Assinatura', 'novo', ['assinaturas']),
  R(
    'SBIS-42',
    'NGS2',
    'Exportação validável fora do sistema e rodapé legal na impressão',
    'Documentos',
    'novo',
    ['assinaturas'],
  ),
  R(
    'SBIS-43',
    'NGS2',
    'Login por certificado: vigência, cadeia, revogação, CPF e uso de autenticação',
    'Plataforma',
    'novo',
    ['assinaturas'],
  ),
  R(
    'ICP-06',
    'NGS2',
    'Segredos dos serviços de assinatura em cofre, nunca em tabela',
    'Plataforma',
    'concessao',
    ['fim-concessoes'],
    { concessao: 'segredos-em-tabela' },
  ),
];

export const CODIGOS_REQUISITOS_SBIS: ReadonlySet<string> = new Set(REQUISITOS_SBIS.map((r) => r.codigo));

/** O que cada concessão é, em texto de produto, e os requisitos que ela segura. */
export const DESCRICAO_CONCESSOES: Readonly<
  Record<CodigoConcessao, { titulo: string; requisitos: readonly string[] }>
> = {
  'senha-formato-antigo': {
    titulo: 'Senha no formato antigo, lida pelos dois sistemas',
    requisitos: ['SBIS-03', 'SBIS-04'],
  },
  'permissoes-antigas': {
    titulo: 'Permissões e grupos de acesso amplo da coexistência',
    requisitos: ['SBIS-10', 'SBIS-12'],
  },
  'privilegio-banco': { titulo: 'Privilégio de banco como na coexistência', requisitos: ['SBIS-14'] },
  'trilha-alteravel': { titulo: 'Trilha de auditoria anterior alterável', requisitos: ['SBIS-16'] },
  'prontuario-alteravel': { titulo: 'Prontuário alterável fora do Sante', requisitos: ['SBIS-26'] },
  'segredos-em-tabela': { titulo: 'Credenciais de parceiros guardadas em tabela', requisitos: ['ICP-06'] },
};

// ── concessões ───────────────────────────────────────────────────────────────────────────────────

export const SITUACOES_CONCESSAO = ['vigente', 'encerrada'] as const;
export type SituacaoConcessao = (typeof SITUACOES_CONCESSAO)[number];

/** Indicador medido do endurecimento que encerra a concessão. */
export const INDICADORES_CONCESSAO = ['atendido', 'pendente', 'indisponivel'] as const;
export type IndicadorConcessao = (typeof INDICADORES_CONCESSAO)[number];

export const esquemaConcessao = z.object({
  codigo: z.enum(CONCESSOES_COEXISTENCIA),
  titulo: z.string(),
  requisitos: z.array(z.string()),
  situacao: z.enum(SITUACOES_CONCESSAO),
  indicador: z.enum(INDICADORES_CONCESSAO),
  /** O que o indicador mediu, em texto de produto (sem nome de pessoa nem valor de segredo). */
  medida: z.string(),
  fimPrevisto: z.iso.date().nullable(),
  evidencia: z.string().nullable(),
  encerradaPor: z.string().nullable(),
  encerradaEm: z.iso.datetime().nullable(),
  reabertaPor: z.string().nullable(),
  reabertaEm: z.iso.datetime().nullable(),
  motivoReabertura: z.string().nullable(),
  /** Pode encerrar agora (null) ou o código da recusa. */
  recusa: z.string().nullable(),
});
export type Concessao = z.infer<typeof esquemaConcessao>;

export const esquemaPainelConcessoes = z.object({
  hospital: z.string(),
  desligado: z.boolean(),
  contingenciaAtiva: z.boolean(),
  vigentes: z.number().int().nonnegative(),
  encerradas: z.number().int().nonnegative(),
  concessoes: z.array(esquemaConcessao),
});
export type PainelConcessoes = z.infer<typeof esquemaPainelConcessoes>;

const esquemaSenha = z.string().min(1).max(64);

export const esquemaEncerrarConcessao = z
  .object({ evidencia: textoCp1252(1000).pipe(z.string().trim().min(10)), senha: esquemaSenha })
  .strict();
export type EncerrarConcessaoPedido = z.infer<typeof esquemaEncerrarConcessao>;

export const esquemaReabrirConcessao = z
  .object({ motivo: textoCp1252(200).pipe(z.string().trim().min(5)), senha: esquemaSenha })
  .strict();
export type ReabrirConcessaoPedido = z.infer<typeof esquemaReabrirConcessao>;

export const esquemaPrevisaoConcessao = z.object({ fimPrevisto: z.iso.date().nullable() }).strict();
export type PrevisaoConcessaoPedido = z.infer<typeof esquemaPrevisaoConcessao>;

// ── ciclos de avaliação (autoavaliação, pré-auditoria e auditoria) ──────────────────────────────

export const TIPOS_CICLO_SBIS = ['autoavaliacao', 'pre-auditoria', 'auditoria'] as const;
export type TipoCicloSbis = (typeof TIPOS_CICLO_SBIS)[number];

export const SITUACOES_CICLO_SBIS = ['aberto', 'concluido', 'cancelado'] as const;
export type SituacaoCicloSbis = (typeof SITUACOES_CICLO_SBIS)[number];

export const RESULTADOS_ITEM_SBIS = [
  'pendente',
  'conforme',
  'nao-conforme',
  'concessao',
  'nao-aplicavel',
] as const;
export type ResultadoItemSbis = (typeof RESULTADOS_ITEM_SBIS)[number];

export const SEVERIDADES_NC_SBIS = ['bloqueante', 'maior', 'menor', 'observacao'] as const;
export type SeveridadeNcSbis = (typeof SEVERIDADES_NC_SBIS)[number];

/** Origem da lacuna no relatório (cap-13 §13.6.2: o que é concessão e o que é defeito do novo). */
export const ORIGENS_NC_SBIS = ['defeito', 'concessao', 'documentacao'] as const;
export type OrigemNcSbis = (typeof ORIGENS_NC_SBIS)[number];

export const SITUACOES_CORRECAO_SBIS = ['aberta', 'corrigida', 'verificada'] as const;
export type SituacaoCorrecaoSbis = (typeof SITUACOES_CORRECAO_SBIS)[number];

/** Parecer do ciclo concluído (pré-auditoria: versão sem não conformidade bloqueante; cap-13 §13.6.2). */
export const PARECERES_SBIS = ['apto', 'com-bloqueante'] as const;
export type ParecerSbis = (typeof PARECERES_SBIS)[number];

export const esquemaItemCicloSbis = z.object({
  requisito: z.string(),
  nivel: z.enum(NIVEIS_SBIS),
  titulo: z.string(),
  resultado: z.enum(RESULTADOS_ITEM_SBIS),
  severidade: z.enum(SEVERIDADES_NC_SBIS).nullable(),
  origem: z.enum(ORIGENS_NC_SBIS).nullable(),
  evidencia: z.string().nullable(),
  observacao: z.string().nullable(),
  avaliadoPor: z.string().nullable(),
  avaliadoEm: z.iso.datetime().nullable(),
  correcao: z.enum(SITUACOES_CORRECAO_SBIS).nullable(),
  correcaoDescricao: z.string().nullable(),
  corrigidoPor: z.string().nullable(),
  corrigidoEm: z.iso.datetime().nullable(),
  verificadoPor: z.string().nullable(),
  verificadoEm: z.iso.datetime().nullable(),
});
export type ItemCicloSbis = z.infer<typeof esquemaItemCicloSbis>;

export const esquemaResumoResultados = z.object({
  pendente: z.number().int().nonnegative(),
  conforme: z.number().int().nonnegative(),
  'nao-conforme': z.number().int().nonnegative(),
  concessao: z.number().int().nonnegative(),
  'nao-aplicavel': z.number().int().nonnegative(),
  bloqueantesAbertas: z.number().int().nonnegative(),
  defeitos: z.number().int().nonnegative(),
});
export type ResumoResultadosSbis = z.infer<typeof esquemaResumoResultados>;

export const esquemaCicloSbis = z.object({
  id: z.string(),
  tipo: z.enum(TIPOS_CICLO_SBIS),
  competencia: z.string().regex(/^\d{4}-\d{2}$/),
  versao: z.string(),
  referencia: z.string(),
  avaliador: z.string().nullable(),
  situacao: z.enum(SITUACOES_CICLO_SBIS),
  parecer: z.enum(PARECERES_SBIS).nullable(),
  parecerTexto: z.string().nullable(),
  certificado: z.string().nullable(),
  abertoPor: z.string(),
  abertoEm: z.iso.datetime(),
  concluidoPor: z.string().nullable(),
  concluidoEm: z.iso.datetime().nullable(),
  resumo: esquemaResumoResultados,
});
export type CicloSbis = z.infer<typeof esquemaCicloSbis>;

export const esquemaCicloSbisDetalhe = esquemaCicloSbis.extend({ itens: z.array(esquemaItemCicloSbis) });
export type CicloSbisDetalhe = z.infer<typeof esquemaCicloSbisDetalhe>;

/** Referência do manual: a vigente em 2026-10-19 (DP-48). */
export const REFERENCIA_SBIS_PADRAO = 'Manual de Certificação S-RES SBIS v5.2';

export const esquemaAbrirCiclo = z
  .object({
    tipo: z.enum(TIPOS_CICLO_SBIS),
    versao: z.string().trim().min(1).max(40),
    referencia: textoCp1252(120).optional(),
    /** Organização do consultor externo ou da auditoria (pré-auditoria e auditoria). */
    avaliador: textoCp1252(120).optional(),
  })
  .strict();
export type AbrirCicloPedido = z.infer<typeof esquemaAbrirCiclo>;

export const esquemaAvaliarItem = z
  .object({
    resultado: z.enum(RESULTADOS_ITEM_SBIS).exclude(['pendente']),
    severidade: z.enum(SEVERIDADES_NC_SBIS).optional(),
    origem: z.enum(ORIGENS_NC_SBIS).optional(),
    evidencia: textoCp1252(500).optional(),
    observacao: textoCp1252(500).optional(),
  })
  .strict();
export type AvaliarItemPedido = z.infer<typeof esquemaAvaliarItem>;

export const esquemaCorrigirItem = z
  .object({ descricao: textoCp1252(500).pipe(z.string().trim().min(10)) })
  .strict();
export type CorrigirItemPedido = z.infer<typeof esquemaCorrigirItem>;

export const esquemaConcluirCiclo = z
  .object({
    parecerTexto: textoCp1252(1000).pipe(z.string().trim().min(10)),
    certificado: z.string().trim().min(3).max(40).optional(),
    senha: esquemaSenha,
  })
  .strict();
export type ConcluirCicloPedido = z.infer<typeof esquemaConcluirCiclo>;

export const esquemaCancelarCiclo = z
  .object({ motivo: textoCp1252(200).pipe(z.string().trim().min(5)) })
  .strict();
export type CancelarCicloPedido = z.infer<typeof esquemaCancelarCiclo>;

// ── pacote de evidências e painel SBIS ──────────────────────────────────────────────────────────

/** pronto; pendente; gerado-no-ci (o servidor não vê o resultado: o comando o produz na versão candidata). */
export const SITUACOES_ITEM_PACOTE = ['pronto', 'pendente', 'gerado-no-ci'] as const;
export type SituacaoItemPacote = (typeof SITUACOES_ITEM_PACOTE)[number];

export const esquemaItemPacote = z.object({
  item: z.enum(ITENS_PACOTE_SBIS),
  titulo: z.string(),
  situacao: z.enum(SITUACOES_ITEM_PACOTE),
  detalhe: z.string(),
  requisitos: z.array(z.string()),
});
export type ItemPacote = z.infer<typeof esquemaItemPacote>;

export const esquemaPainelSbis = z.object({
  hospital: z.string(),
  referencia: z.string(),
  desligado: z.boolean(),
  /** A auditoria formal pode ser aberta (regra 9) ou o motivo. */
  auditoriaFormal: z.object({ pode: z.boolean(), motivo: z.string().nullable() }),
  /** Número do certificado para o rodapé (SBIS-42): só depois da auditoria concluída apta. */
  certificado: z.string().nullable(),
  requisitos: z.object({
    total: z.number().int().nonnegative(),
    porNivel: z.record(z.enum(NIVEIS_SBIS), z.number().int().nonnegative()),
    porRegime: z.record(z.enum(REGIMES_SBIS), z.number().int().nonnegative()),
    fase5: z.number().int().nonnegative(),
  }),
  pacote: z.array(esquemaItemPacote),
  ciclos: z.array(esquemaCicloSbis),
});
export type PainelSbis = z.infer<typeof esquemaPainelSbis>;

// ── backup verificado (SBIS-13) ─────────────────────────────────────────────────────────────────

export const TIPOS_RESTAURACAO = ['diaria', 'mensal'] as const;
export type TipoRestauracao = (typeof TIPOS_RESTAURACAO)[number];

export const RESULTADOS_RESTAURACAO = ['ok', 'falhou'] as const;
export const INTEGRIDADES_RESTAURACAO = ['ok', 'falhou', 'nao-verificada'] as const;

/** Prazo da diária (horas desde a última com sucesso) e da mensal (dias). */
export const PRAZO_RESTAURACAO_DIARIA_HORAS = 26;
export const PRAZO_RESTAURACAO_MENSAL_DIAS = 32;

export const esquemaRegistrarRestauracao = z
  .object({
    tipo: z.enum(TIPOS_RESTAURACAO),
    inicio: z.iso.datetime({ offset: true }),
    fim: z.iso.datetime({ offset: true }),
    resultado: z.enum(RESULTADOS_RESTAURACAO),
    integridade: z.enum(INTEGRIDADES_RESTAURACAO),
    tamanhoMb: z.number().int().nonnegative().max(10_000_000).optional(),
    ambiente: textoCp1252(80).pipe(z.string().trim().min(2)),
    observacao: textoCp1252(500).optional(),
  })
  .strict()
  .refine((r) => Date.parse(r.fim) >= Date.parse(r.inicio), {
    message: 'O fim vem depois do início.',
    path: ['fim'],
  });
export type RegistrarRestauracaoPedido = z.infer<typeof esquemaRegistrarRestauracao>;

export const esquemaRestauracao = z.object({
  id: z.string(),
  tipo: z.enum(TIPOS_RESTAURACAO),
  inicio: z.iso.datetime(),
  fim: z.iso.datetime(),
  duracaoMinutos: z.number().int().nonnegative(),
  resultado: z.enum(RESULTADOS_RESTAURACAO),
  integridade: z.enum(INTEGRIDADES_RESTAURACAO),
  tamanhoMb: z.number().int().nullable(),
  ambiente: z.string(),
  observacao: z.string().nullable(),
  registradoPor: z.string(),
  registradoEm: z.iso.datetime(),
});
export type Restauracao = z.infer<typeof esquemaRestauracao>;

export const esquemaSituacaoRestauracao = z.object({
  tipo: z.enum(TIPOS_RESTAURACAO),
  ultimaComSucesso: z.iso.datetime().nullable(),
  emDia: z.boolean(),
  falhasRecentes: z.number().int().nonnegative(),
});
export type SituacaoRestauracao = z.infer<typeof esquemaSituacaoRestauracao>;

export const esquemaBackupVerificado = z.object({
  hospital: z.string(),
  diaria: esquemaSituacaoRestauracao,
  mensal: esquemaSituacaoRestauracao,
  alertas: z.array(z.string()),
  restauracoes: z.array(esquemaRestauracao),
  destino: z.enum(['banco', 'memoria']),
});
export type BackupVerificado = z.infer<typeof esquemaBackupVerificado>;

// ── exportação da trilha para a auditoria (SBIS-16 a 19; cap-13 §13.6.3) ─────────────────────────

export const FORMATOS_TRILHA_SBIS = ['csv', 'xml'] as const;

export const esquemaIdentificacaoExportacao = z.object({
  software: z.string(),
  versao: z.string(),
  ambiente: z.string(),
  estabelecimento: z.string().nullable(),
  cnes: z.string().nullable(),
  cnpj: z.string().nullable(),
  inicio: z.iso.date(),
  fim: z.iso.date(),
  geradoEm: z.string(),
  geradoPor: z.string(),
});
export type IdentificacaoExportacao = z.infer<typeof esquemaIdentificacaoExportacao>;

export const esquemaProvaCadeia = z.object({
  dias: z.number().int().nonnegative(),
  eventos: z.number().int().nonnegative(),
  integra: z.boolean(),
  /** Dia (AAAA-MM-DD) e ID do primeiro elo que não fecha. */
  quebraDia: z.iso.date().nullable(),
  quebraEm: z.string().nullable(),
});
export type ProvaCadeia = z.infer<typeof esquemaProvaCadeia>;

/** Período máximo da prova da cadeia por exportação (dias; cada dia é uma verificação). */
export const DIAS_MAXIMOS_PROVA_CADEIA = 31;

// ── recusas ─────────────────────────────────────────────────────────────────────────────────────

export const RECUSAS_SBIS = [
  'sistema-anterior-ligado',
  'contingencia-ativa',
  'indicador-pendente',
  'indicador-indisponivel',
  'concessao-ja-encerrada',
  'concessao-ja-vigente',
  'ciclo-aberto-do-tipo',
  'autoavaliacao-do-mes',
  'auditoria-sem-pre-auditoria',
  'fase5-pendente',
  'concessoes-vigentes',
  'avaliador-obrigatorio',
  'ciclo-fechado',
  'requisito-desconhecido',
  'concessao-fora-da-autoavaliacao',
  'concessao-encerrada',
  'nc-sem-severidade',
  'evidencia-obrigatoria',
  'item-nao-conforme',
  'correcao-nao-aberta',
  'correcao-nao-corrigida',
  'verificador-igual',
  'nc-sem-verificacao',
  'itens-pendentes',
  'itens-mudaram',
  'certificado-obrigatorio',
  'certificado-so-na-auditoria',
] as const;
export type RecusaSbis = (typeof RECUSAS_SBIS)[number];

export const TEXTO_RECUSA_SBIS: Readonly<Record<RecusaSbis, string>> = {
  'sistema-anterior-ligado': 'O desligamento deste estabelecimento ainda não foi concluído.',
  'contingencia-ativa': 'O período de contingência ainda está aberto neste estabelecimento.',
  'indicador-pendente': 'O endurecimento que encerra esta concessão ainda não terminou.',
  'indicador-indisponivel': 'Não foi possível medir o endurecimento agora; tente de novo.',
  'concessao-ja-encerrada': 'Esta concessão já está encerrada.',
  'concessao-ja-vigente': 'Esta concessão já está vigente.',
  'ciclo-aberto-do-tipo': 'Já existe um ciclo aberto deste tipo.',
  'autoavaliacao-do-mes': 'A autoavaliação deste mês já foi concluída.',
  'auditoria-sem-pre-auditoria':
    'A auditoria formal pede uma pré-auditoria concluída sem não conformidade bloqueante.',
  'fase5-pendente': 'Há requisitos do conteúdo do prontuário que dependem de entregas ainda não liberadas.',
  'concessoes-vigentes': 'Ainda há concessões da coexistência vigentes neste estabelecimento.',
  'avaliador-obrigatorio': 'Informe a organização que conduz a avaliação.',
  'ciclo-fechado': 'Este ciclo já foi concluído ou cancelado.',
  'requisito-desconhecido': 'Requisito fora do catálogo.',
  'concessao-fora-da-autoavaliacao':
    'Concessão só é aceita na autoavaliação; na pré-auditoria e na auditoria é não conformidade.',
  'concessao-encerrada':
    'A concessão deste requisito já foi encerrada: avalie como conforme ou não conforme.',
  'nc-sem-severidade': 'Não conformidade pede a severidade e a origem.',
  'evidencia-obrigatoria': 'Informe a evidência.',
  'item-nao-conforme': 'Só não conformidade tem correção.',
  'correcao-nao-aberta': 'A correção não está aberta.',
  'correcao-nao-corrigida': 'A correção ainda não foi registrada.',
  'verificador-igual': 'A verificação é feita por outra pessoa, não por quem corrigiu.',
  'nc-sem-verificacao':
    'Esta não conformidade só pode ser avaliada de novo depois de corrigida e verificada por outra pessoa.',
  'itens-pendentes': 'Ainda há requisitos sem avaliação.',
  'itens-mudaram':
    'O ciclo mudou enquanto a ação era gravada (outra pessoa concluiu, cancelou ou avaliou um requisito): confira a lista e tente de novo.',
  'certificado-obrigatorio': 'Informe o número do certificado emitido.',
  'certificado-so-na-auditoria': 'O número do certificado só existe na auditoria formal apta.',
};
