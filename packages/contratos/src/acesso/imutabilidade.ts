// M59-F3 (ficha do M59, regra 6; cap-08 §8.16; SBIS-26): imutabilidade clínica imposta também no banco. Enquanto a
// retrocompatibilidade durar, a regra no banco é só por privilégio: nenhum usuário da aplicação (papéis por módulo,
// papel SGH_APLICACAO, conta ampla da aplicação) tem DELETE em tabela clínica que nenhuma operação do catálogo apaga.
// Trigger novo em tabela do banco continua proibido (convencoes.md §1, regra 3; guardas:legado, regra d); a regra por
// linha é o primeiro passo do plano de evolução, se o ADR da F6 extinguir a retrocompatibilidade.
//
// O que é "tabela clínica" (D-CLINICA-59): as tabelas de registro do paciente do modelo próprio, as que têm paciente,
// atendimento ou internação, nos módulos clínicos do DDL (prontuário com a enfermagem, internação, centro cirúrgico
// e SADT), mais a trilha de auditoria. As tabelas SGH_ do prontuário, dos documentos
// assinados, do laudo e do resultado, da hemoterapia (ato transfusional e reação) e do perioperatório (ficha
// anestésica, APA, SRPA, checklist) entram pelo prefixo. A lista do modelo sai gerada do DDL em
// tabelas-clinicas.gerado.ts (o teste de tools/verificadores confere que está em dia).
import { z } from 'zod';
import { TABELAS_CLINICAS_MODELO } from './tabelas-clinicas.gerado.js';

/**
 * Critério por módulo da matriz: a tela (coluna tela_funcao) diz se a tabela é do registro do paciente. `telasDentro`
 * lista os prefixos de tela aceitos; `telasFora`, os recusados (cadastros e configurações do módulo).
 */
export interface CriterioClinicoMatriz {
  readonly modulo: string;
  readonly telasDentro?: readonly string[];
  readonly telasFora?: readonly string[];
}
export const CRITERIOS_CLINICOS_MATRIZ: readonly CriterioClinicoMatriz[] = [
  { modulo: 'PEP', telasFora: ['Cadastros', 'Configurações', 'Administração PEP'] },
  { modulo: 'SADT', telasDentro: ['Laboratório', 'Laudos', 'Administração > Auditoria'] },
  {
    modulo: 'CC',
    telasDentro: ['Centro Cirúrgico > Registro de cirurgia', 'Administração > Auditoria'],
  },
];
/** Módulos da matriz cujas tabelas de registro são clínicas. */
export const MODULOS_CLINICOS_MATRIZ = CRITERIOS_CLINICOS_MATRIZ.map((c) => c.modulo);

/** A tela da matriz é do registro do paciente, pelo critério do módulo? */
export function telaClinica(criterio: CriterioClinicoMatriz, tela: string): boolean {
  const t = tela.trim();
  if (criterio.telasFora?.some((p) => t.startsWith(p))) return false;
  return criterio.telasDentro ? criterio.telasDentro.some((p) => t.startsWith(p)) : true;
}
/** Naturezas da matriz que são registro (o que o profissional escreveu ou o que aconteceu com o paciente). */
export const NATUREZAS_REGISTRO_CLINICO = ['movimento', 'historico', 'vinculo', 'auditoria'] as const;
/** Tabelas SGH_ do prontuário, dos documentos assinados, do SADT, da hemoterapia e do perioperatório. */
export const PREFIXOS_SGH_CLINICOS = [
  'SGH_PEP_',
  'SGH_DOC_',
  'SGH_DOCUMENTO_',
  'SGH_CC_FA',
  'SGH_CC_APA',
  'SGH_CC_SRPA',
  'SGH_CC_CHECKLIST',
  'SGH_SADT_LAUDO',
  'SGH_SADT_RESULT',
  'SGH_SADT_HEMO_ATO',
  'SGH_SADT_HEMO_REACAO',
] as const;

/**
 * Tabelas clínicas em que o DELETE é legítimo, com o motivo (o que se apaga não é registro do paciente). Toda
 * exceção nova entra aqui com o motivo; a conferência do plano recusa DELETE clínico fora desta lista.
 */
export const EXCECOES_DELETE_CLINICO: readonly { readonly tabela: string; readonly motivo: string }[] = [
  {
    tabela: 'SGH_PEP_FORMNOVO_CASO',
    motivo:
      'casos de teste do formulário novo (M45), apagados com o rascunho do formulário; não são registro de paciente',
  },
  {
    tabela: 'SGH_PEP_DISPOSITIVO',
    motivo:
      'W0-03 (D-CRUD-ORFAOS): cadastro técnico do aparelho da beira do leito (nome, unidade, resumo do identificador; nenhum dado de paciente); só o cadastrado por engano e sem nenhuma leitura vinculada se apaga, com o retrato em SGH_HIST_EXCLUSAO',
  },
  {
    tabela: 'SGH_PEP_DISPOSITIVO_VERSAO',
    motivo:
      'revisão W0-03: os valores anteriores do cadastro técnico do aparelho (nome, unidade, situação); saem só junto com o aparelho excluído, dentro do mesmo retrato em SGH_HIST_EXCLUSAO (nenhuma versão órfã; nenhum dado de paciente)',
  },
  {
    tabela: 'SGH_PEP_ONCO_CICLO_PRESC',
    motivo:
      'o vínculo do ciclo de quimioterapia com a prescrição geral, desfeito só antes da validação farmacêutica (W0-05); o fato fica no evento do ciclo com quem, quando e o motivo, e a prescrição não muda',
  },
];

const CLINICAS_MODELO = new Set<string>(TABELAS_CLINICAS_MODELO);
const EXCECOES = new Set(EXCECOES_DELETE_CLINICO.map((e) => e.tabela));

/** A tabela guarda registro clínico (do modelo, pela lista gerada do DDL; ou SGH_, pelo prefixo)? */
export function ehTabelaClinica(tabela: string): boolean {
  const t = tabela.trim().toUpperCase();
  if (t.startsWith('SGH_')) return PREFIXOS_SGH_CLINICOS.some((p) => t.startsWith(p));
  return CLINICAS_MODELO.has(t.toLowerCase());
}

/** DELETE nesta tabela fere a imutabilidade (clínica e fora das exceções)? */
export const deleteClinicoProibido = (tabela: string): boolean =>
  ehTabelaClinica(tabela) && !EXCECOES.has(tabela.trim().toUpperCase());

const identBanco = z.string().regex(/^[A-Z][A-Z0-9_$]{0,62}$/);
const contagem = z.union([z.number().int().nonnegative(), z.literal('<5')]);

/** Resposta de GET /api/administracao/acesso/contas-banco/imutabilidade. */
export const esquemaImutabilidadeResposta = z
  .object({
    hospital: z.string().regex(/^[a-z][a-z0-9]{0,9}$/),
    em: z.iso.datetime(),
    tabelasClinicas: z
      .object({ legado: z.number().int().nonnegative(), sgh: z.number().int().nonnegative() })
      .strict(),
    /** Operações do catálogo com DELETE em tabela clínica fora das exceções (o esperado é nenhuma). */
    operacoesComDelete: z.array(z.object({ operacao: z.string(), tabela: identBanco }).strict()),
    /** Itens do plano dos papéis por módulo com DELETE clínico (o esperado é nenhum: a geração recusa). */
    planoComDelete: z.number().int().nonnegative(),
    excecoes: z.array(z.object({ tabela: identBanco, motivo: z.string() }).strict()),
    /**
     * Quem tem DELETE em tabela clínica no banco agora (catálogo de segurança), por conta legível; as demais
     * (contas do outro sistema fora da lista) num agregado, sem o nome.
     */
    titulares: z.array(
      z
        .object({
          titular: z.union([identBanco, z.literal('(outras)')]),
          /** Conta ou papel do Sante SGH (o que o script 0002 revoga). */
          doSante: z.boolean(),
          tabelas: contagem,
        })
        .strict(),
    ),
    /** A conta ampla da aplicação ainda apaga registro clínico (a concessão segue vigente). */
    concessaoVigente: z.boolean(),
  })
  .strict();
export type ImutabilidadeResposta = z.infer<typeof esquemaImutabilidadeResposta>;
