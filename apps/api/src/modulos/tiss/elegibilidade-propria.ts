// Consulta de elegibilidade do beneficiário junto à operadora (F3.9, 08-INTG L128 (31)), no banco do cliente. As regras
// são as puras de @sgh/dominio-faturamento (tiss/elegibilidade.ts); aqui ficam a leitura e a gravação.
// Contrato de efeito:
//   - consultar: `consulta_elegibilidade` 'pendente' a partir da cobertura do paciente (fonte pagadora, plano, carteira
//     como enviada, validade, atendimento, quem pediu). Se a mesma carteira já foi elegível no dia, nada é gravado e a
//     consulta do dia é devolvida (menos cliques, sem consulta repetida à operadora);
//   - responder: a consulta fica 'elegivel', 'inelegivel' (com o motivo), 'erro' ou 'sem_resposta', com o instante da
//     resposta e o código de validação; a cobertura guarda a última elegibilidade (instante e se foi aprovada). A
//     consulta respondida não muda mais: nova situação é nova consulta (o histórico fica inteiro);
//   - serviço web (C2-070): com o serviço web de elegibilidade cadastrado e ativo para a fonte no estabelecimento
//     (endpoint_tiss_fonte_pagadora da transação 'elegibilidade'), a consulta nova já sai para a outbox na mesma
//     transação (`integracao_mensagem` pendente no ponto tiss.elegibilidade, só IDs e códigos, nunca a carteira) e fica
//     pendente com integracao_mensagem_id; fora de produção o transmissor usa destino falso (regra 6);
//   - retorno (C2-070): lê a mensagem ligada; na fila, nada muda; o recibo vira a resposta pela mesma gravação da
//     resposta à mão (situação, motivo, código de validação e a última elegibilidade da cobertura).
import {
  conferirPedidoElegibilidade,
  conferirRespostaElegibilidade,
  conferirTransmissaoElegibilidade,
  elegibilidadeDoDia,
  PONTO_ELEGIBILIDADE,
  type RespostaElegibilidade,
  respostaElegibilidadeDoRetorno,
  type SituacaoElegibilidade,
  type SituacaoMensagemElegibilidade,
} from '@sgh/dominio-faturamento';
import { gravarOutbox, type Leitor, type TxOperacao } from '@sgh/nucleo';
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

const TABELAS = ['consulta_elegibilidade', 'cobertura_paciente', 'integracao_mensagem'];

/** O serviço web de elegibilidade cadastrado e ativo para a fonte, no estabelecimento. */
async function servicoWebElegibilidade(l: Leitor, est: number, fonte: number): Promise<number | null> {
  const r = await l.uma(
    `SELECT ep.id FROM endpoint_tiss_fonte_pagadora ep
       JOIN transacao_tiss_webservice t ON t.id = ep.transacao_tiss_webservice_id
      WHERE ep.estabelecimento_id = ? AND ep.fonte_pagadora_id = ? AND ep.forma_envio = 'servico_web'
        AND ep.ativo = TRUE AND t.ativo = TRUE AND t.tipo_transacao = 'elegibilidade'
      ORDER BY ep.id DESC LIMIT 1`,
    [est, fonte],
  );
  return r ? num(r['id']) : null;
}

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
  /** C2-070: saiu pelo serviço web da operadora (mensagem de integração ligada). */
  readonly pelaOperadora: boolean;
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
        pelaOperadora: x['integracao_mensagem_id'] !== null && x['integracao_mensagem_id'] !== undefined,
      }));
      return { coberturas, consultas };
    });
  }

  consultar(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{ id: number; situacao: SituacaoElegibilidade; reaproveitada: boolean; enviada: boolean }> {
    const e = entradaValida(esquemaConsulta, entrada);
    return this.gravar(
      c,
      'tiss.elegibilidade.consultar',
      ['consulta_elegibilidade', 'integracao_mensagem'],
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
            enviada: false,
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
        const fonte = num(cp['fonte_pagadora_id']);
        const servico = await servicoWebElegibilidade(tx, est.id, fonte);
        const enviada =
          conferirTransmissaoElegibilidade({
            situacao: 'pendente',
            jaEnviada: false,
            servicoWeb: servico !== null,
          }).length === 0;
        if (enviada) {
          const mensagem = await gravarOutbox(tx, {
            estabelecimento: est.id,
            ponto: PONTO_ELEGIBILIDADE,
            entidade: 'consulta_elegibilidade',
            entidadeId: novo,
            chave: `${PONTO_ELEGIBILIDADE}:${novo}`,
            carga: {
              consulta: novo,
              cobertura: e.cobertura,
              fonte,
              servicoWeb: servico,
              identificacao: e.identificacao,
            },
            usuario,
            agora,
          });
          await tx.alterar('consulta_elegibilidade', novo, 1, { integracao_mensagem_id: mensagem });
        }
        return {
          tabela: 'consulta_elegibilidade',
          id: novo,
          situacao: 'pendente' as const,
          reaproveitada: false,
          enviada,
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
        await aplicarResposta(tx, consulta, e.versao, numOuNull(ce['cobertura_paciente_id']), e);
        return { tabela: 'consulta_elegibilidade', id: consulta, situacao: e.situacao };
      },
    );
  }

  /** C2-070: lê o retorno do serviço web na mensagem ligada e grava a resposta; ainda na fila, devolve `aguardando`. */
  retorno(
    c: ContextoPortaPropria,
    consulta: number,
  ): Promise<{ id: number; situacao: SituacaoElegibilidade; aguardando: boolean }> {
    return this.gravar(
      c,
      'tiss.elegibilidade.retorno',
      ['consulta_elegibilidade', 'cobertura_paciente'],
      async (tx, est) => {
        const ce = (
          await tx.consultarParaAtualizar<Record<string, unknown>>(
            `SELECT ce.id, ce.situacao, ce.versao, ce.cobertura_paciente_id, ce.integracao_mensagem_id,
                    im.situacao AS situacao_envio, im.resposta AS retorno, im.erro
               FROM consulta_elegibilidade ce
               LEFT JOIN integracao_mensagem im ON im.id = ce.integracao_mensagem_id
              WHERE ce.id = ? AND ce.estabelecimento_id = ? AND ce.excluido_em IS NULL`,
            [consulta, est.id],
          )
        )[0];
        if (!ce) throw naoEncontrado('Consulta de elegibilidade');
        const situacao = String(ce['situacao']) as SituacaoElegibilidade;
        if (ce['integracao_mensagem_id'] === null || ce['situacao_envio'] === null)
          throw recusaRegra('Retorno recusado', [
            {
              campo: 'canal',
              mensagem: 'A consulta não saiu pelo serviço web: registre a resposta da operadora à mão.',
            },
          ]);
        if (situacao !== 'pendente')
          throw recusaRegra('Retorno recusado', [
            { campo: 'consulta', mensagem: 'A consulta já tem resposta: faça uma nova consulta.' },
          ]);
        const r = respostaElegibilidadeDoRetorno({
          situacaoMensagem: String(ce['situacao_envio']) as SituacaoMensagemElegibilidade,
          resposta: txtOuNull(ce['retorno']),
          erro: txtOuNull(ce['erro']),
        });
        if (!r) return { tabela: 'consulta_elegibilidade', id: consulta, situacao, aguardando: true };
        const p = conferirRespostaElegibilidade(situacao, r);
        if (p.length) throw recusaRegra('Retorno recusado', p);
        await aplicarResposta(tx, consulta, num(ce['versao']), numOuNull(ce['cobertura_paciente_id']), r);
        return { tabela: 'consulta_elegibilidade', id: consulta, situacao: r.situacao, aguardando: false };
      },
    );
  }
}

/** Grava a resposta (à mão ou do serviço web) e a última elegibilidade da cobertura. */
async function aplicarResposta(
  tx: TxOperacao,
  consulta: number,
  versao: number,
  cob: number | null,
  e: RespostaElegibilidade,
): Promise<void> {
  const agora = new Date();
  await tx.alterar('consulta_elegibilidade', consulta, versao, {
    situacao: e.situacao,
    respondida_em: agora,
    motivo_negativa: e.situacao === 'elegivel' ? null : e.motivoNegativa,
    motivo_glosa_id: e.situacao === 'inelegivel' ? e.motivoGlosa : null,
    codigo_validacao: e.situacao === 'elegivel' ? e.codigoValidacao : null,
  });
  if (cob !== null && (e.situacao === 'elegivel' || e.situacao === 'inelegivel')) {
    const v = await tx.uma('SELECT versao FROM cobertura_paciente WHERE id = ?', [cob]);
    if (v)
      await tx.alterar('cobertura_paciente', cob, num(v['versao']), {
        ultima_elegibilidade_em: agora,
        ultima_elegibilidade_aprovada: e.situacao === 'elegivel',
      });
  }
}
