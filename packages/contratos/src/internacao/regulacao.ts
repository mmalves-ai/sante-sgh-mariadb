// Regulação estadual no NIR (M44, etapa 3; ficha, seções 5 a 8, regra 14; cap-05a §5.4, Nota; cap-12 §12.4): o
// número da regulação (a central do estado, do município ou outra) registrado à mão na solicitação de leito, com a
// situação que a central informa (só inclusão: cada mudança é uma linha nova ligada à anterior). O conector automático
// com a central só existe se a DP-29 confirmar uma API: até lá a chave `nir.regulacaoConector` fica DESLIGADA (POL-3)
// e, ligada fora de produção, a mensagem sai pela outbox na mesma transação e quem responde é o simulador. A
// configuração de regulação do fornecedor anterior (as tabelas de sistema, serviço, endpoint e domínios) é só consulta:
// não corresponde à central do RJ e nunca é gravada.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

export const CENTRAIS_REGULACAO = [
  { codigo: 'estadual', rotulo: 'Central estadual de regulação' },
  { codigo: 'municipal', rotulo: 'Central municipal de regulação' },
  { codigo: 'sisreg', rotulo: 'SISREG' },
  { codigo: 'gerint', rotulo: 'GERINT (internações)' },
  { codigo: 'gercon', rotulo: 'GERCON (consultas)' },
  { codigo: 'outra', rotulo: 'Outra central' },
] as const;
export type CentralRegulacao = (typeof CENTRAIS_REGULACAO)[number]['codigo'];
export const CODIGOS_CENTRAL_REGULACAO = CENTRAIS_REGULACAO.map((c) => c.codigo) as [
  CentralRegulacao,
  ...CentralRegulacao[],
];

/** Entrada: o paciente regulado para este hospital; saída: este hospital pede vaga em outro pela central. */
export const SENTIDOS_REGULACAO = [
  { codigo: 'entrada', rotulo: 'Paciente regulado para cá' },
  { codigo: 'saida', rotulo: 'Pedido de vaga em outro hospital' },
] as const;
export type SentidoRegulacao = (typeof SENTIDOS_REGULACAO)[number]['codigo'];

export const SITUACOES_REGULACAO = [
  { codigo: 'solicitada', rotulo: 'Solicitada à central', final: false },
  { codigo: 'em_analise', rotulo: 'Em análise na central', final: false },
  { codigo: 'autorizada', rotulo: 'Autorizada', final: false },
  { codigo: 'negada', rotulo: 'Negada', final: true },
  { codigo: 'cancelada', rotulo: 'Cancelada', final: true },
  { codigo: 'concluida', rotulo: 'Concluída (paciente transferido ou recebido)', final: true },
] as const;
export type SituacaoRegulacao = (typeof SITUACOES_REGULACAO)[number]['codigo'];
export const CODIGOS_SITUACAO_REGULACAO = SITUACOES_REGULACAO.map((s) => s.codigo) as [
  SituacaoRegulacao,
  ...SituacaoRegulacao[],
];

/** Origem do registro: digitado pelo NIR ou recebido do conector (DP-29; fora de produção, do simulador). */
export const ORIGENS_REGISTRO_REGULACAO = ['manual', 'conector'] as const;
export type OrigemRegistroRegulacao = (typeof ORIGENS_REGISTRO_REGULACAO)[number];

/** Chave do conector com a central (POL-3: desligada até a DP-29 confirmar a API). */
export const CHAVE_CONECTOR_REGULACAO = 'nir.regulacaoConector';
/** Tipo do evento da outbox que leva o pedido à central (só IDs e códigos na carga). */
export const EVENTO_OUTBOX_REGULACAO = 'internacao.regulacao.enviar';

/** Número como as centrais emitem: letras, dígitos, ponto, barra e hífen (sem espaço). */
export const FORMATO_NUMERO_REGULACAO = /^[A-Z0-9][A-Z0-9./-]{3,29}$/;

export const esquemaRegistrarRegulacao = z
  .object({
    /** A solicitação de leito do NIR a que a regulação se liga. */
    solicitacao: z.number().int().positive().max(2_147_483_647),
    central: z.enum(CODIGOS_CENTRAL_REGULACAO),
    sentido: z.enum(['entrada', 'saida']),
    numero: z
      .string()
      .trim()
      .transform((s) => s.toUpperCase())
      .pipe(
        z
          .string()
          .regex(FORMATO_NUMERO_REGULACAO, 'Número de 4 a 30 letras, dígitos, ponto, barra ou hífen.'),
      ),
    situacao: z.enum(CODIGOS_SITUACAO_REGULACAO),
    /** O registro vigente visto na tela (null: o primeiro da solicitação); colisão se outro chegou antes. */
    anterior: z.number().int().positive().nullable().default(null),
    /** Observação operacional (sem diagnóstico nem dado do paciente). */
    observacao: textoCp1252(300).nullable().default(null),
  })
  .strict();
export type RegistrarRegulacaoEntrada = z.infer<typeof esquemaRegistrarRegulacao>;

const txt = z.string();
const n = z.number().int();

export const esquemaRegistroRegulacao = z.object({
  id: n,
  solicitacao: n,
  central: z.enum(CODIGOS_CENTRAL_REGULACAO),
  sentido: z.enum(['entrada', 'saida']),
  numero: txt,
  situacao: z.enum(CODIGOS_SITUACAO_REGULACAO),
  origem: z.enum(ORIGENS_REGISTRO_REGULACAO),
  observacao: txt.nullable(),
  anterior: n.nullable(),
  /** Impressão da mensagem trocada com a central (SHA-256), quando houve conector; o conteúdo nunca fica aqui. */
  mensagemHash: txt.nullable(),
  por: txt,
  em: txt,
});
export type RegistroRegulacao = z.infer<typeof esquemaRegistroRegulacao>;

export const esquemaRegulacaoDaSolicitacao = z.object({
  solicitacao: n,
  paciente: z.object({ id: n, nome: txt }),
  estadoSolicitacao: txt,
  prioridade: txt,
  solicitadoEm: txt,
  vigente: esquemaRegistroRegulacao.nullable(),
  historico: z.array(esquemaRegistroRegulacao),
});
export type RegulacaoDaSolicitacao = z.infer<typeof esquemaRegulacaoDaSolicitacao>;

/** A configuração de regulação do fornecedor anterior (consulta; nada é gravado nela). */
export const esquemaConfiguracaoRegulacao = z.object({
  sistemas: z.array(z.object({ id: n, sigla: txt, ativo: z.boolean(), servicos: n, servicosAtivos: n })),
  endpoints: z.array(z.object({ id: n, servico: n.nullable(), descricao: txt, metodo: txt.nullable() })),
  tabelas: z.array(
    z.object({ id: n, descricao: txt, ativo: z.boolean(), referencia: txt.nullable(), valores: n }),
  ),
});
export type ConfiguracaoRegulacao = z.infer<typeof esquemaConfiguracaoRegulacao>;

export const esquemaTelaRegulacao = z.object({
  solicitacoes: z.array(esquemaRegulacaoDaSolicitacao),
  /** Contagem por situação vigente (as sem registro em "sem número"). */
  contagens: z.record(z.string(), n),
  conector: z.object({
    ligado: z.boolean(),
    motivo: txt.nullable(),
    modo: z.enum(['desligado', 'simulador']),
  }),
  acoes: z.object({ registrar: z.boolean(), motivo: txt.nullable() }),
  lidoEm: txt,
});
export type TelaRegulacao = z.infer<typeof esquemaTelaRegulacao>;
