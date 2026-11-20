// Contratos das telas do M04 em "Administração > Coexistência com o legado": "Conferência de gravação
// (triggers, generators, sentinelas)" e "Saúde das conexões e avisos de colisão". Só estrutura, classes,
// estados e contagens (nenhum valor de linha). Permissões config.gravacao.ler e config.conexao.ler.
import { z } from 'zod';
import { ESTADOS_OPERACAO } from '../assinatura/catalogo.js';

const coluna = z.object({ coluna: z.string(), classe: z.string(), origem: z.string() });
const passo = z.object({ ordem: z.number(), tabela: z.string(), acao: z.string(), colunas: z.array(coluna) });
const efeito = z.object({ trigger: z.string(), tabela: z.string(), acao: z.string(), faz: z.string() });

export const esquemaPainelGravacao = z.object({
  estabelecimentos: z.array(z.string()),
  operacoes: z.array(
    z.object({
      nome: z.string(),
      modulo: z.string(),
      descricao: z.string(),
      estados: z.record(z.string(), z.enum(ESTADOS_OPERACAO)),
      /** Receita do adaptador (null: operação só especificada, ainda sem executor). */
      receita: z
        .object({
          marco: z.string(),
          passos: z.array(passo),
          efeitos: z.array(efeito),
          naoFaz: z.array(z.string()),
          condicao: z.string(),
          concorrencia: z.string(),
          prova: z.string(),
          critica: z.boolean(),
        })
        .nullable(),
      triggers: z.array(z.object({ nome: z.string(), tabela: z.string(), efeito: z.string() })),
      /** Triggers do catálogo conferidos no RDB$TRIGGERS de cada estabelecimento. */
      triggersNoBanco: z.record(z.string(), z.record(z.string(), z.enum(['ativo', 'inativo', 'ausente']))),
      /** Provas pós-escrita: sucessos (na trilha, com o banco) e desfeitas (executor deste processo). */
      provas: z.record(z.string(), z.object({ sucesso: z.number(), desfeitas: z.number() })),
    }),
  ),
  /** De onde vêm as contagens (texto da tela). */
  limitacao: z.string().optional(),
});
export type PainelGravacao = z.infer<typeof esquemaPainelGravacao>;

export const esquemaPainelConexoes = z.object({
  rede: z.string(),
  pools: z.array(
    z.object({
      estabelecimento: z.string(),
      abertas: z.number(),
      livres: z.number(),
      emUso: z.number(),
      esperando: z.number(),
      sysdbaDev: z.boolean(),
    }),
  ),
  /** Coleta MON$ por estabelecimento (null: banco indisponível ou leitura recusada). */
  coletas: z.record(
    z.string(),
    z
      .object({
        em: z.string(),
        porSistema: z.array(z.object({ sistema: z.string(), conexoes: z.number(), transacoes: z.number() })),
        transacoesAcimaDoLimite: z.number(),
        esperasPorTrava: z.number(),
        alertas: z.number(),
      })
      .nullable(),
  ),
  /** Avisos de colisão (409 de versão e trava ocupada) por operação e estabelecimento, por hora (UTC). */
  colisoes: z.array(
    z.object({
      operacao: z.string(),
      estabelecimento: z.string(),
      porHora: z.record(z.string(), z.number()),
    }),
  ),
  /** Só as conexões do próprio sistema quando a conta não vê MON$ de todos (DP-15). */
  limitacao: z.string().nullable(),
});
export type PainelConexoes = z.infer<typeof esquemaPainelConexoes>;
