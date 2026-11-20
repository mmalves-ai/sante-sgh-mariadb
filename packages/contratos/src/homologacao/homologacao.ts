// Homologação sobre a cópia, cenários controlados e pentest (M36; cap-10 §10.3, §10.4, §10.12; cap-14 §14.2.6 e
// §14.2.8; cap-15 §15.3.1). Três formatos versionados no repositório, todos SEM dado pessoal:
//   - registro de conferência: docs/operacoes/conferencias/<cod>/<operacao>.yaml (um por operação e hospital);
//   - matriz de achados do pentest: docs/seguranca/pentest/matriz-achados.yaml;
//   - painel de homologação: docs/homologacao/homologacao.json (gerado por `pnpm homologacao:roteiro`), lido pela API
//     nas telas de coexistência (assinaturas, conferência de gravação e verificação de schema).
// As rodadas de conferência seguem as ondas (cap-15 §15.3.3; ficha do M36, campo 5).
import { z } from 'zod';
import { ESTADOS_OPERACAO, type EstadoOperacao } from '../assinatura/catalogo.js';
import { operacoesDoSetor, SETORES_PRONTIDAO } from '../prontidao/catalogo.js';

const codigoEstabelecimento = z.string().regex(/^[a-z][a-z0-9]{0,9}$/);
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'AAAA-MM-DD');
const nomeOperacao = z.string().regex(/^[a-z]+\.[a-z][A-Za-z0-9]+$/);
const cenario = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** Papéis aceitos na conferência (nunca o nome da pessoa). */
export const PAPEIS_CONFERENCIA = [
  'chave-usuario',
  'medico',
  'enfermeiro',
  'ti',
  'gestor-de-acessos',
  'responsavel-tecnico',
] as const;

/**
 * Texto livre do registro (observações): sem dígitos em sequência (CPF, prontuário, telefone, CRM), sem e-mail e
 * curto. A regra é de forma; a revisão do responsável técnico no PR confere o sentido (cap-15 §15.10.1).
 */
export const RE_TEXTO_SEM_DADO_PESSOAL = /^(?![\s\S]*\d{4,})(?![\s\S]*@)[\s\S]{0,600}$/;

export const esquemaRegistroConferencia = z
  .object({
    formato: z.literal(1),
    operacao: nomeOperacao,
    estabelecimento: codigoEstabelecimento,
    data,
    /** Papel de quem conferiu e a área (registro clínico: médico E enfermeiro). */
    conferentes: z
      .array(z.object({ papel: z.enum(PAPEIS_CONFERENCIA), area: z.string().min(2).max(60) }).strict())
      .min(1),
    /** Versão do roteiro de homologação usada (docs/homologacao/<cod>/roteiro.md, linha "Versão"). */
    versao_roteiro: z.string().regex(/^\d{4}-\d{2}-\d{2}\.\d+$/, 'AAAA-MM-DD.n'),
    /** Impressão digital do schema da cópia na hora da conferência (resumo do M02). */
    impressao_schema: z.string().regex(/^[0-9a-f]{16,128}$/),
    cenarios: z
      .array(
        z
          .object({
            cenario,
            /** O que o chave-usuário viu na tela do outro sistema. */
            resultado: z.enum(['conforme', 'divergente']),
          })
          .strict(),
      )
      .min(1),
    resultado: z.enum(['conferida', 'divergente']),
    observacoes: z
      .string()
      .regex(RE_TEXTO_SEM_DADO_PESSOAL, 'observação sem dígitos em sequência nem e-mail')
      .optional(),
    /** PR em que o responsável técnico revisou o registro. */
    revisao: z.object({ pr: z.string().regex(/^(?:#\d+|[0-9a-f]{7,40})$/), data }).strict(),
  })
  .strict();
export type RegistroConferencia = z.infer<typeof esquemaRegistroConferencia>;

/** Módulos de registro clínico: a conferência exige médico e enfermeiro (regra 4; cap-14 §14.2.6). */
export const MODULOS_REGISTRO_CLINICO: readonly string[] = ['pep', 'enfermagem'];

// ---------------------------------------------------------------------------------------------------------------
// Rodadas de conferência (ondas)

export interface RodadaConferencia {
  readonly onda: number;
  readonly rotulo: string;
  /** Quem confere no outro sistema (ficha, campo 5). */
  readonly quem: string;
}

export const RODADAS_CONFERENCIA: readonly RodadaConferencia[] = [
  { onda: 0, rotulo: 'Onda 0 (leituras e eventos de acesso)', quem: 'TI e gestor de acessos' },
  { onda: 1, rotulo: 'Onda 1 (recepção, agenda e cadastro)', quem: 'recepção, agendamento e call center' },
  {
    onda: 2,
    rotulo: 'Onda 2 (fluxo do paciente)',
    quem: 'internação, médicos e enfermeiros, SADT, centro cirúrgico, higienização, SAME',
  },
  { onda: 3, rotulo: 'Onda 3 (suprimentos)', quem: 'farmácia, almoxarifado, compras' },
  { onda: 4, rotulo: 'Onda 4 (receita)', quem: 'faturamento, auditoria de contas, financeiro, repasse' },
  { onda: 5, rotulo: 'Onda 5 (demais)', quem: 'áreas donas' },
];

/** Operações que a ficha põe na onda 0 embora o setor de acessos seja da onda 1 (eventos de login e senha). */
export const OPERACOES_ONDA_0: readonly string[] = [
  'auditoria.registrarEventoLegado',
  'acesso.registrarLogin',
  'acesso.bloquearPorTentativas',
  'acesso.trocarSenha',
];

/**
 * Operações que a ficha (campo 5) põe na onda 1 embora um setor de onda posterior também as use: o agendamento e o
 * cancelamento de exame são do agendamento e do call center (onda 1), não do SADT (onda 2).
 */
export const OPERACOES_ONDA_1: readonly string[] = ['agenda.agendarExame', 'agenda.cancelarExame'];

/** Onda da operação: a menor dos setores que a usam (cap-15 §15.3.3); fora de todos os setores, a 5. */
export function ondaDaOperacao(nome: string, todos: readonly string[] = [nome]): number {
  if (OPERACOES_ONDA_0.includes(nome)) return 0;
  if (OPERACOES_ONDA_1.includes(nome)) return 1;
  const nomes = todos.includes(nome) ? todos : [...todos, nome];
  let onda = 5;
  for (const s of SETORES_PRONTIDAO) {
    if (s.onda < onda && operacoesDoSetor(s, nomes).includes(nome)) onda = s.onda;
  }
  return onda;
}

// ---------------------------------------------------------------------------------------------------------------
// Estado efetivo depois da reexecução (regra 6): usado pelo `pnpm operacoes:estado`, pelo painel e, em tempo de
// execução, pelo passo 0 do executor (fonteCatalogoArquivo, @sgh/legado) e pelas rotas de configuração.

/** Último resultado do `assinatura:testar` da operação no hospital: resultado por cenário. */
export type ResultadoPorCenario = Readonly<Record<string, string>>;

/**
 * Chave que marca o resultado mais recente ilegível ou fora do esquema (arquivo truncado, por exemplo): conta como
 * divergência (falha fechada), nunca como "sem execução".
 */
export const CHAVE_RESULTADO_ILEGIVEL = '(resultado ilegível)';

const EXIGE_CONFERENCIA_EFETIVA: readonly EstadoOperacao[] = ['conferida', 'liberada'];

/**
 * Regra 6: reexecução com divergência numa operação `conferida` ou `liberada` faz ela voltar a `bloqueada` no
 * hospital até a correção e nova conferência; se estava `liberada`, o recolhimento é imediato. Resultado ilegível
 * conta como divergência.
 */
export function estadoEfetivo(
  estado: EstadoOperacao,
  ultimo: ResultadoPorCenario | null,
): { estado: EstadoOperacao; motivo: string | null; recolher: boolean } {
  if (!ultimo || !EXIGE_CONFERENCIA_EFETIVA.includes(estado))
    return { estado, motivo: null, recolher: false };
  const ilegivel = CHAVE_RESULTADO_ILEGIVEL in ultimo;
  if (!ilegivel && !Object.values(ultimo).includes('diferencas'))
    return { estado, motivo: null, recolher: false };
  return {
    estado: 'bloqueada',
    motivo: ilegivel
      ? `resultado da última reexecução das assinaturas ilegível (estava ${estado}); reexecutar e conferir de novo`
      : `divergência na última reexecução das assinaturas (estava ${estado}); corrigir e conferir de novo`,
    recolher: estado === 'liberada',
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Pentest (regra 8; cap-14 §14.2.8)

export const SEVERIDADES_PENTEST = ['critica', 'alta', 'media', 'baixa', 'informativa'] as const;
export const SITUACOES_ACHADO = ['aberto', 'corrigido', 'retestado', 'excecao-aprovada'] as const;

export const esquemaAchadoPentest = z
  .object({
    id: z.string().regex(/^PT-\d{3}$/),
    titulo: z.string().min(5).max(160),
    /** Item do OWASP ASVS 4.0.3 nível 2 (ex.: V4.2.1). */
    asvs: z.string().regex(/^V\d{1,2}\.\d{1,2}\.\d{1,2}$/),
    componente: z.enum(['bff', 'api', 'web', 'worker', 'socket', 'tokens-painel-totem', 'conexao-firebird']),
    severidade: z.enum(SEVERIDADES_PENTEST),
    situacao: z.enum(SITUACOES_ACHADO),
    /** Commit ou PR da correção (corrigido e retestado). */
    correcao: z.string().optional(),
    reteste: z
      .object({ data, resultado: z.enum(['corrigido', 'persiste']) })
      .strict()
      .optional(),
    excecao: z
      .object({ decisao: z.string().regex(/^(?:DP-\d+|ADR \d{4})/), data, papel: z.string().min(3) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (a.situacao === 'retestado' && !a.reteste)
      ctx.addIssue({ code: 'custom', path: ['reteste'], message: 'retestado sem o registro do reteste' });
    if (a.situacao === 'excecao-aprovada' && !a.excecao)
      ctx.addIssue({ code: 'custom', path: ['excecao'], message: 'exceção sem a decisão registrada' });
    if ((a.situacao === 'corrigido' || a.situacao === 'retestado') && !a.correcao)
      ctx.addIssue({ code: 'custom', path: ['correcao'], message: 'correção sem o commit ou o PR' });
  });
export type AchadoPentest = z.infer<typeof esquemaAchadoPentest>;

export const esquemaMatrizPentest = z
  .object({
    formato: z.literal(1),
    /** `nao-iniciado` (sem contrato), `em-andamento`, `concluido` (relatório entregue), `retestado`. */
    situacao: z.enum(['nao-iniciado', 'em-andamento', 'concluido', 'retestado']),
    versao_candidata: z.string().nullable(),
    ambiente: z.string().min(3),
    lista: z.literal('OWASP ASVS 4.0.3 nível 2'),
    data_relatorio: data.nullable(),
    data_reteste: data.nullable(),
    achados: z.array(esquemaAchadoPentest),
  })
  .strict()
  .superRefine((m, ctx) => {
    const ids = new Set<string>();
    m.achados.forEach((a, i) => {
      if (ids.has(a.id)) ctx.addIssue({ code: 'custom', path: ['achados', i, 'id'], message: 'repetido' });
      ids.add(a.id);
    });
    if (m.situacao === 'retestado' && !m.data_reteste)
      ctx.addIssue({ code: 'custom', path: ['data_reteste'], message: 'retestado sem a data do reteste' });
    if ((m.situacao === 'concluido' || m.situacao === 'retestado') && !m.data_relatorio)
      ctx.addIssue({
        code: 'custom',
        path: ['data_relatorio'],
        message: 'concluído sem a data do relatório',
      });
  });
export type MatrizPentest = z.infer<typeof esquemaMatrizPentest>;

// ---------------------------------------------------------------------------------------------------------------
// Painel de homologação (docs/homologacao/homologacao.json)

const contagemRodada = z
  .object({
    operacoes: z.number().int().min(0),
    verdes: z.number().int().min(0),
    conferidas: z.number().int().min(0),
    comCenarioControlado: z.number().int().min(0),
  })
  .strict();

const conferenciaNoPainel = z
  .object({
    data,
    papeis: z.array(z.string()),
    resultado: z.enum(['conferida', 'divergente']),
    /** Problemas do `conferencia:verificar` (vazio: o registro sustenta o estado). */
    problemas: z.array(z.string()),
  })
  .strict();

export const esquemaPainelHomologacao = z
  .object({
    formato: z.literal(1),
    geradoEm: z.string(),
    versaoRoteiro: z.string(),
    hospitais: z.array(
      z
        .object({
          codigo: codigoEstabelecimento,
          /** Motivo de o hospital estar fora (HS-1), ou null. */
          bloqueio: z.string().nullable(),
          impressaoHomologada: z.string().nullable(),
          /** Impressões registradas nas conferências do hospital (resumo → quantidade). */
          impressoesConferidas: z.record(z.string(), z.number().int().min(0)),
        })
        .strict(),
    ),
    /** A IA nunca conecta à produção: a impressão de produção vem da TI na renovação da cópia. */
    producao: z.string(),
    rodadas: z.array(
      z
        .object({
          onda: z.number().int().min(0),
          rotulo: z.string(),
          quem: z.string(),
          porHospital: z.record(z.string(), contagemRodada),
        })
        .strict(),
    ),
    operacoes: z.array(
      z
        .object({
          nome: z.string(),
          onda: z.number().int().min(0),
          /** Já gravada em produção pela `sante-api` (primeira da fila). */
          santeApi: z.boolean(),
          origens: z.record(z.string(), z.number().int().min(0)),
          estados: z.record(z.string(), z.enum(ESTADOS_OPERACAO)),
          conferencias: z.record(z.string(), conferenciaNoPainel),
          /** Triggers do catálogo × vistos no trace dos cenários controlados (null: nenhum cenário com trace). */
          triggers: z
            .object({
              catalogo: z.array(z.string()),
              vistos: z.array(z.string()).nullable(),
            })
            .strict(),
        })
        .strict(),
    ),
    /** Fila herdada dos marcos: operações à espera de cenário controlado (motivo do catálogo cita o M36). */
    filaCenarioControlado: z.array(z.object({ operacao: z.string(), motivo: z.string() }).strict()),
    pentest: z
      .object({
        situacao: z.string(),
        abertosCriticosOuAltos: z.number().int().min(0),
        porSeveridade: z.record(z.string(), z.number().int().min(0)),
        reteste: z.string().nullable(),
        bloqueiaLiberacao: z.boolean(),
      })
      .strict(),
    problemas: z.array(z.string()),
  })
  .strict();
export type PainelHomologacao = z.infer<typeof esquemaPainelHomologacao>;
