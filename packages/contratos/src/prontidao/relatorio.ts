// Relatório de prontidão por setor e hospital (ficha do M35, regra 7; cap-15 §15.2.2 dia 7, §15.3.2, §15.3.3).
// Gerado por `pnpm prontidao:relatorio` em docs/prontidao/prontidao.json (e o .md ao lado); a tela "Prontidão por
// setor" e o painel de carga da tela de conexões leem este arquivo pela API. Só contagens e nomes de estrutura.
import { z } from 'zod';
import { ESTADOS_OPERACAO } from '../assinatura/catalogo.js';
import { PAPEIS_TREINAMENTO } from './catalogo.js';

/** Situação de um item da lista do cap-15 §15.3.2 na semana de construção. */
export const SITUACOES_ITEM_PRONTIDAO = [
  /** Cumprido com evidência na semana. */
  'atendido',
  /** Cumprido, com operações fora de `verde` que ficam fora da liberação (motivo listado; cap-15 §15.5). */
  'com-ressalva',
  /** Não cumprido na semana (a parte fica pendente; não para a semana). */
  'nao-atendido',
  /** Só se cumpre na Fase 4 (validação humana, TI, treinamento, apoio, pentest). */
  'fase4',
  /** Sem a cópia do estabelecimento (HS-1). */
  'bloqueado',
] as const;
export type SituacaoItemProntidao = (typeof SITUACOES_ITEM_PRONTIDAO)[number];

/** Itens da lista do cap-15 §15.3.2 (mais a construção, que a semana precisa dizer primeiro). */
export const ITENS_PRONTIDAO = [
  'construcao',
  'operacoes',
  'aceite',
  'treinamento',
  'estacoes',
  'carga',
  'apoio',
  'pentest',
] as const;
export type ItemProntidao = (typeof ITENS_PRONTIDAO)[number];

/** Veredito do setor na semana. */
export const VEREDITOS_SETOR = [
  /** Construído, operações verdes: pronto para homologar (não é liberação; cap-15 §15.2.1). */
  'pronto-para-homologar',
  /** Construído; as operações fora de `verde` ficam fora da liberação até a prova (cap-15 §15.5). */
  'pronto-com-ressalvas',
  /** Algum marco do setor não construído: a construção continua na Fase 4 (cap-15 §15.5). */
  'nao-construido',
  /** Sem a cópia do estabelecimento (HS-1). */
  'bloqueado',
] as const;
export type VereditoSetor = (typeof VEREDITOS_SETOR)[number];

const esquemaItem = z
  .object({
    item: z.enum(ITENS_PRONTIDAO),
    situacao: z.enum(SITUACOES_ITEM_PRONTIDAO),
    detalhe: z.string(),
  })
  .strict();

export const esquemaSetorProntidao = z
  .object({
    id: z.string(),
    nome: z.string(),
    onda: z.number().int().min(0).max(5),
    veredito: z.enum(VEREDITOS_SETOR),
    marcos: z.array(z.object({ marco: z.string(), status: z.string() }).strict()),
    operacoes: z
      .object({
        total: z.number().int().min(0),
        verdes: z.number().int().min(0),
        fora: z.array(
          z
            .object({ nome: z.string(), estado: z.enum(ESTADOS_OPERACAO), motivo: z.string().min(1) })
            .strict(),
        ),
      })
      .strict(),
    leituras: z.array(z.string()),
    recursos: z.array(z.string()),
    itens: z.array(esquemaItem),
    duvidas: z.array(z.string()),
    /** Ordem de construção na Fase 4 do que falta (marcos pendentes, na ordem do roteiro). */
    ordemFase4: z.array(z.string()),
  })
  .strict();
export type SetorProntidao = z.infer<typeof esquemaSetorProntidao>;

export const esquemaPublicoPapel = z
  .object({
    papel: z.enum(PAPEIS_TREINAMENTO),
    nome: z.string(),
    /** Usuários ativos e não bloqueados (contagem; null sem medida ou abaixo de 5, `menorQue5`). */
    usuarios: z.number().int().min(0).nullable(),
    menorQue5: z.boolean(),
    referencia: z.number().int().min(0),
    parcelas: z.array(
      z
        .object({
          grupo: z.string(),
          /** null: sem medida ou abaixo de 5 (`menorQue5`). */
          usuarios: z.number().int().min(0).nullable(),
          menorQue5: z.boolean(),
          referencia: z.number().int().min(0).nullable(),
        })
        .strict(),
    ),
    ondas: z.array(z.number().int()),
    cargaHoraria: z.string(),
    guias: z.number().int().min(0),
  })
  .strict();
export type PublicoPapel = z.infer<typeof esquemaPublicoPapel>;

export const esquemaJornadaCarga = z
  .object({
    jornada: z.string(),
    p95Ms: z.number().nullable(),
    metaMs: z.number().nullable(),
    atendida: z.boolean().nullable(),
  })
  .strict();

/** Resumo da carga somada (k6) que entra no relatório e no painel de conexões. */
export const esquemaCargaProntidao = z
  .object({
    cenario: z.string(),
    executadoEm: z.string(),
    usuarios: z.number().int().min(0),
    resultado: z.enum(['verde', 'vermelho']),
    /** DP-15: medido na cópia de desenvolvimento; vale como indicação até a homologação. */
    indicativo: z.boolean(),
    jornadas: z.array(esquemaJornadaCarga),
    /** Operações-chave do outro sistema simulado: p95 antes e durante a carga (ms). */
    outroSistema: z.array(
      z
        .object({
          operacao: z.string(),
          antesP95Ms: z.number().nullable(),
          duranteP95Ms: z.number().nullable(),
        })
        .strict(),
    ),
    mon: z
      .object({
        transacaoMaisLongaMs: z.number().nullable(),
        acimaDoLimite: z.number().int().nullable(),
        escritas: z.number().int().nullable(),
      })
      .strict(),
    /**
     * Revisão do M35: metas do cap-14 §14.5 que o cenário não mede com a rota real (o k6 só exercita as rotas de
     * leitura de carga). Com alguma, a carga do setor fica "com ressalva" (parcial), não "atendido".
     */
    metasNaoMedidas: z
      .array(z.object({ meta: z.string(), alvo: z.string(), motivo: z.string() }).strict())
      .optional(),
    arquivo: z.string(),
  })
  .strict();
export type CargaProntidao = z.infer<typeof esquemaCargaProntidao>;

export const esquemaHospitalProntidao = z
  .object({
    codigo: z.string(),
    nome: z.string(),
    bloqueio: z.string().nullable(),
    setores: z.array(esquemaSetorProntidao),
    publico: z.array(esquemaPublicoPapel),
    publicoTotal: z.number().int().min(0).nullable(),
    /** Chaves de liberação preparadas para o comitê (todas desligadas). */
    chavesPreparadas: z.number().int().min(0).nullable(),
    chavesLigadas: z.number().int().min(0).nullable(),
    proposta: z
      .object({
        onda0: z.array(z.string()),
        onda1: z.array(z.string()),
        foraDaProposta: z.array(z.object({ setor: z.string(), motivo: z.string() }).strict()),
      })
      .strict(),
  })
  .strict();
export type HospitalProntidao = z.infer<typeof esquemaHospitalProntidao>;

export const esquemaRelatorioProntidao = z
  .object({
    formato: z.literal(1),
    geradoEm: z.string(),
    /** Contagem do catálogo de operações (operação × estabelecimento). */
    estados: z.record(z.string(), z.number().int().min(0)),
    liberadas: z.number().int().min(0),
    hospitais: z.array(esquemaHospitalProntidao),
    carga: esquemaCargaProntidao.nullable(),
  })
  .strict();
export type RelatorioProntidao = z.infer<typeof esquemaRelatorioProntidao>;
