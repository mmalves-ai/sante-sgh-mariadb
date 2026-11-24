// Consulta de elegibilidade do beneficiário junto à operadora (F3.9, 08-INTG L128 (31)), no banco do cliente. As regras
// são as puras de @sgh/dominio-faturamento (tiss/elegibilidade.ts); aqui ficam a leitura e a gravação.
// Contrato de efeito:
//   - consultar: `consulta_elegibilidade` 'pendente' a partir da cobertura do paciente (fonte pagadora, plano, carteira
//     como enviada, validade, atendimento, quem pediu). Se a mesma carteira já foi elegível no dia, nada é gravado e a
//     consulta do dia é devolvida (menos cliques, sem consulta repetida à operadora);
//   - responder: a consulta fica 'elegivel', 'inelegivel' (com o motivo), 'erro' ou 'sem_resposta', com o instante da
//     resposta e o código de validação; a cobertura guarda a última elegibilidade (instante e se foi aprovada). A
//     consulta respondida não muda mais: nova situação é nova consulta (o histórico fica inteiro).
import {
  conferirPedidoElegibilidade,
  conferirRespostaElegibilidade,
  elegibilidadeDoDia,
  type SituacaoElegibilidade,
} from '@sgh/dominio-faturamento';
import { z } from 'zod';
import {
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_ELEGIBILIDADE = Symbol('PORTA_ELEGIBILIDADE');

const TABELAS = ['consulta_elegibilidade', 'cobertura_paciente'];

const id = z.number().int().positive();
const esquemaConsulta = z
  .object({
    cobertura: id,
    atendimento: id.nullable().default(null),
    identificacao: z.enum(['carteira', 'biometria', 'documento']).default('carteira'),
  })
  .strict();
const esquemaResposta = z
  .object({
    situacao: z.enum(['elegivel', 'inelegivel', 'erro', 'sem_resposta']),
    motivoNegativa: z.string().trim().max(2000).nullable().default(null),
    motivoGlosa: id.nullable().default(null),
    codigoValidacao: z.string().trim().max(40).nullable().default(null),
    versao: z.number().int().positive(),
  })
  .strict();

/** O dia civil (AAAA-MM-DD) do instante no fuso do estabelecimento. */
export function diaCivil(d: Date, fuso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

const iso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString()
      : new Date(String(v)).toISOString();
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);

export interface ConsultaElegibilidadeLida {
  readonly id: number;
  readonly cobertura: number | null;
  readonly fontePagadora: string;
  readonly carteira: string;
  readonly situacao: SituacaoElegibilidade;
  readonly solicitadaEm: string;
  readonly respondidaEm: string | null;
  readonly motivoNegativa: string | null;
  readonly codigoValidacao: string | null;
  readonly por: string | null;
  readonly versao: number;
}

export class PortaElegibilidadePropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'tiss.elegibilidade');
  }

  /** A visão por paciente: as coberturas ativas com a última elegibilidade e as consultas, das mais recentes. */
  doPaciente(c: ContextoPortaPropria, paciente: number) {
    return this.ler(c, 'paciente', async (l, est) => {
      const coberturas = (
        await l.consultar(
          `SELECT cp.id, cp.numero_carteira, cp.validade, cp.principal, cp.ultima_elegibilidade_em, cp.ultima_elegibilidade_aprovada,
                  fp.nome AS fonte FROM cobertura_paciente cp JOIN fonte_pagadora fp ON fp.id = cp.fonte_pagadora_id
            WHERE cp.paciente_id = ? AND cp.excluido_em IS NULL AND cp.situacao = 'ativa' ORDER BY cp.principal DESC, cp.id`,
          [paciente],
        )
      ).map((x) => ({
        id: num(x['id']),
        fontePagadora: String(x['fonte']),
        carteira: txtOuNull(x['numero_carteira']),
        validade: dataIso(x['validade']),
        principal: !!num(x['principal']),
        ultimaElegibilidadeEm: iso(x['ultima_elegibilidade_em']),
        ultimaAprovada:
          x['ultima_elegibilidade_aprovada'] === null ? null : !!num(x['ultima_elegibilidade_aprovada']),
      }));
      const consultas: ConsultaElegibilidadeLida[] = (
        await l.consultar(
          `SELECT ce.*, fp.nome AS fonte, u.login FROM consulta_elegibilidade ce JOIN fonte_pagadora fp ON fp.id = ce.fonte_pagadora_id
             LEFT JOIN usuario u ON u.id = ce.solicitada_por_usuario_id
            WHERE ce.paciente_id = ? AND ce.estabelecimento_id = ? AND ce.excluido_em IS NULL
            ORDER BY ce.solicitada_em DESC, ce.id DESC LIMIT 100`,
          [paciente, est.id],
        )
      ).map((x) => ({
        id: num(x['id']),
        cobertura: numOuNull(x['cobertura_paciente_id']),
        fontePagadora: String(x['fonte']),
        carteira: String(x['numero_carteira']),
        situacao: String(x['situacao']) as SituacaoElegibilidade,
        solicitadaEm: iso(x['solicitada_em'])!,
        respondidaEm: iso(x['respondida_em']),
        motivoNegativa: txtOuNull(x['motivo_negativa']),
        codigoValidacao: txtOuNull(x['codigo_validacao']),
        por: txtOuNull(x['login']),
        versao: num(x['versao']),
      }));
      return { coberturas, consultas };
    });
  }

  consultar(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{ id: number; situacao: SituacaoElegibilidade; reaproveitada: boolean }> {
    const e = entradaValida(esquemaConsulta, entrada);
    return this.gravar(
      c,
      'tiss.elegibilidade.consultar',
      ['consulta_elegibilidade'],
      async (tx, est, usuario) => {
        const cp = await tx.uma(
          `SELECT id, paciente_id, fonte_pagadora_id, plano_fonte_pagadora_id, numero_carteira, validade
           FROM cobertura_paciente WHERE id = ? AND excluido_em IS NULL AND situacao = 'ativa'`,
          [e.cobertura],
        );
        if (!cp) throw naoEncontrado('Cobertura');
        const agora = new Date();
        const hoje = diaCivil(agora, est.fuso);
        const carteira = String(cp['numero_carteira'] ?? '').trim();
        const problemas = conferirPedidoElegibilidade({
          carteira,
          validadeCarteira: dataIso(cp['validade']),
          hoje,
        });
        if (
          e.atendimento !== null &&
          !(await tx.uma(
            'SELECT id FROM atendimento WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ?',
            [e.atendimento, cp['paciente_id'], est.id],
          ))
        )
          problemas.push({
            campo: 'atendimento',
            mensagem: 'O atendimento não é deste paciente neste estabelecimento.',
          });
        if (problemas.length) throw recusaRegra('Consulta recusada', problemas);
        const u = await tx.uma(
          `SELECT id, situacao, solicitada_em, numero_carteira FROM consulta_elegibilidade
          WHERE paciente_id = ? AND fonte_pagadora_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
          ORDER BY solicitada_em DESC, id DESC LIMIT 1`,
          [cp['paciente_id'], cp['fonte_pagadora_id'], est.id],
        );
        if (
          u &&
          elegibilidadeDoDia(
            {
              situacao: String(u['situacao']) as SituacaoElegibilidade,
              dia: diaCivil(new Date(u['solicitada_em'] as Date), est.fuso),
              carteira: String(u['numero_carteira']),
            },
            carteira,
            hoje,
          )
        )
          return {
            tabela: 'consulta_elegibilidade',
            id: num(u['id']),
            situacao: 'elegivel' as const,
            reaproveitada: true,
          };
        const novo = await tx.incluir('consulta_elegibilidade', {
          estabelecimento_id: est.id,
          paciente_id: num(cp['paciente_id']),
          fonte_pagadora_id: num(cp['fonte_pagadora_id']),
          plano_fonte_pagadora_id: numOuNull(cp['plano_fonte_pagadora_id']),
          cobertura_paciente_id: e.cobertura,
          atendimento_id: e.atendimento,
          numero_carteira: carteira,
          validade_carteira: dataIso(cp['validade']),
          tipo_identificacao: e.identificacao,
          situacao: 'pendente',
          solicitada_em: agora,
          solicitada_por_usuario_id: usuario,
        });
        return {
          tabela: 'consulta_elegibilidade',
          id: novo,
          situacao: 'pendente' as const,
          reaproveitada: false,
        };
      },
    );
  }

  responder(
    c: ContextoPortaPropria,
    consulta: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: SituacaoElegibilidade }> {
    const e = entradaValida(esquemaResposta, entrada);
    return this.gravar(
      c,
      'tiss.elegibilidade.responder',
      ['consulta_elegibilidade', 'cobertura_paciente'],
      async (tx, est) => {
        const ce = await tx.uma(
          'SELECT id, situacao, cobertura_paciente_id FROM consulta_elegibilidade WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [consulta, est.id],
        );
        if (!ce) throw naoEncontrado('Consulta de elegibilidade');
        const problemas = conferirRespostaElegibilidade(String(ce['situacao']) as SituacaoElegibilidade, e);
        if (
          e.motivoGlosa !== null &&
          !(await tx.uma('SELECT id FROM motivo_glosa WHERE id = ?', [e.motivoGlosa]))
        )
          problemas.push({ campo: 'motivoGlosa', mensagem: 'Motivo de negativa inexistente.' });
        if (problemas.length) throw recusaRegra('Resposta recusada', problemas);
        const agora = new Date();
        await tx.alterar('consulta_elegibilidade', consulta, e.versao, {
          situacao: e.situacao,
          respondida_em: agora,
          motivo_negativa: e.situacao === 'elegivel' ? null : e.motivoNegativa,
          motivo_glosa_id: e.situacao === 'inelegivel' ? e.motivoGlosa : null,
          codigo_validacao: e.situacao === 'elegivel' ? e.codigoValidacao : null,
        });
        const cob = numOuNull(ce['cobertura_paciente_id']);
        if (cob !== null && (e.situacao === 'elegivel' || e.situacao === 'inelegivel')) {
          const v = await tx.uma('SELECT versao FROM cobertura_paciente WHERE id = ?', [cob]);
          if (v)
            await tx.alterar('cobertura_paciente', cob, num(v['versao']), {
              ultima_elegibilidade_em: agora,
              ultima_elegibilidade_aprovada: e.situacao === 'elegivel',
            });
        }
        return { tabela: 'consulta_elegibilidade', id: consulta, situacao: e.situacao };
      },
    );
  }
}
