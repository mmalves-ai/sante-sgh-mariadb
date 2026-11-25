// Comunicação da internação e da alta à operadora (F78.04-2, 04-INT linha 80), no banco do cliente. As regras são as
// puras de @sgh/dominio-internacao (comunicacao-operadora.ts); aqui ficam a leitura e a gravação. Contrato de efeito:
//   - registrar: `comunicacao_internacao_operadora` pendente (internação, fonte pagadora da internação, tipo, número da guia
//     vem da internação), conferida pelo domínio com os dados da própria internação (fonte de saúde
//     suplementar com registro, carteira, alta registrada, alta por óbito, uma viva por tipo); nada é redigitado;
//   - mensagem: a comunicação de beneficiário (COMUNICACAO_BENEFICIARIO do TISS 04.03.00, montada pelo gerador do
//     faturamento com cabeçalho completo e hash do epílogo) a partir dos dados gravados: carteira, recém-nascido pela
//     carteira da mãe, data do evento, tipo de internação da modalidade e motivo de encerramento da alta pelo código de
//     troca do motivo de saída — prévia sem gravar;
//   - transição (enviar, confirmar, rejeitar, falhar, reenviar, cancelar): situação, protocolo, resposta e as datas
//     de envio e de resposta, com a versão lida; nada é apagado (cancelar guarda o motivo);
//   - transmitir (C1-108): a pendente de internação, alta ou óbito sai pelo serviço web da comunicação de beneficiário
//     cadastrado para a fonte (endpoint_tiss_fonte_pagadora da transação comunicacao_beneficiario, ativo): a mensagem é
//     montada e conferida, a saída vai à outbox (`integracao_mensagem` pendente no ponto tiss.comunicacao_beneficiario,
//     só IDs, códigos e o hash) na mesma transação, e a comunicação fica 'enviada' com enviado_em e
//     integracao_mensagem_id. Sem o serviço web cadastrado, recusa (o envio por outro canal é a transição 'enviar');
//   - retorno (C1-108): lê a mensagem de integração ligada; recibo aceito com protocolo confirma, recusado rejeita com o
//     motivo da operadora, erro ou descarte falha com o código; ainda na fila, nada muda;
//   - disparar (C2-070): ao internar e ao registrar a saída, as comunicações devidas (domínio `comunicacoesDevidas`)
//     nascem pendentes sozinhas, origem 'sistema'; com o serviço web cadastrado para a fonte, já saem para a outbox na
//     mesma transação (enviadas, com a mensagem ligada). Nada nasce de novo quando o tipo já existe (nem o cancelado).
import { ErroLoteTiss, mensagemComunicacaoBeneficiario } from '@sgh/dominio-faturamento';
import {
  type AcaoComunicacao,
  comunicacoesDevidas,
  conferirMensagemComunicacao,
  conferirNovaComunicacao,
  conferirTransmissao,
  PONTO_COMUNICACAO_OPERADORA,
  retornoDaIntegracao,
  SITUACOES_COMUNICACAO_VIVAS,
  type SituacaoComunicacaoOperadora,
  type SituacaoMensagemIntegracao,
  TIPOS_COMUNICACAO_OPERADORA,
  type TipoComunicacaoOperadora,
  tipoInternacaoDaModalidade,
  transicaoComunicacao,
} from '@sgh/dominio-internacao';
import { gravarOutbox, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_COMUNICACAO_OPERADORA = Symbol('PORTA_COMUNICACAO_OPERADORA');

const TABELAS = ['comunicacao_internacao_operadora', 'integracao_mensagem'];
const ACOES = ['enviar', 'confirmar', 'rejeitar', 'falhar', 'reenviar', 'cancelar'] as const;

const esquemaRegistrar = z.object({ tipo: z.enum(TIPOS_COMUNICACAO_OPERADORA) }).strict();
const esquemaTransicao = z
  .object({
    acao: z.enum(ACOES),
    versao: z.number().int().positive(),
    protocolo: z.string().trim().max(50).nullable().default(null),
    resposta: z.string().trim().max(2000).nullable().default(null),
  })
  .strict();
const esquemaVersao = z.object({ versao: z.number().int().positive() }).strict();

export interface ComunicacaoLida {
  readonly id: number;
  readonly tipo: string;
  readonly situacao: string;
  readonly protocolo: string | null;
  readonly enviadoEm: string | null;
  readonly respondidoEm: string | null;
  readonly resposta: string | null;
  readonly criadoEm: string;
  readonly versao: number;
  /** Saiu pelo serviço web da operadora (mensagem de integração ligada). */
  readonly pelaIntegracao: boolean;
  /** Situação da mensagem de integração (pendente, enviada, processada, erro, descartada), se houver. */
  readonly situacaoEnvio: string | null;
}

const iso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString()
      : new Date(String(v)).toISOString();

interface DadosInternacao {
  readonly id: number;
  readonly fonte: number;
  readonly tipoFonte: string;
  readonly registroAns: string | null;
  readonly carteira: string | null;
  readonly guia: string | null;
  readonly entrada: string;
  readonly codigoPrestador: string;
  readonly altaEm: string | null;
  readonly altaPorObito: boolean;
  readonly motivoTiss: string | null;
  readonly tipoInternacao: string | null;
  readonly recemNascido: boolean;
}

async function lerInternacao(l: Leitor, internacao: number, est: number): Promise<DadosInternacao> {
  const r = await l.uma(
    `SELECT i.id, i.fonte_pagadora_id, i.numero_carteira, i.numero_guia, i.data_hora_entrada,
            f.tipo AS tipo_fonte, f.registro_ans,
            COALESCE((SELECT t.codigo_prestador_operadora FROM configuracao_tiss_fonte_pagadora t
                       WHERE t.fonte_pagadora_id = i.fonte_pagadora_id AND t.estabelecimento_id = i.estabelecimento_id
                       ORDER BY t.id DESC LIMIT 1), e.codigo_cnes, e.codigo) AS prestador,
            a.alta_em, a.destino, m.tipo_saida, m.codigo_tiss,
            mi.codigo_tiss AS modalidade_tiss, mi.classificacao AS modalidade_classificacao,
            EXISTS (SELECT 1 FROM internacao_recem_nascido rn
                     WHERE rn.propria_internacao_id = i.id AND rn.excluido_em IS NULL) AS recem_nascido
       FROM internacao i
       JOIN modalidade_internacao mi ON mi.id = i.modalidade_internacao_id
       JOIN fonte_pagadora f ON f.id = i.fonte_pagadora_id
       JOIN estabelecimento e ON e.id = i.estabelecimento_id
       LEFT JOIN alta_hospitalar a ON a.id = (SELECT MAX(x.id) FROM alta_hospitalar x
                                              WHERE x.internacao_id = i.id AND x.situacao = 'confirmada'
                                                AND x.excluido_em IS NULL)
       LEFT JOIN motivo_saida_hospitalar m ON m.id = a.motivo_saida_hospitalar_id
      WHERE i.id = ? AND i.estabelecimento_id = ?`,
    [internacao, est],
  );
  if (!r) throw naoEncontrado('Internação');
  return {
    id: num(r['id']),
    fonte: num(r['fonte_pagadora_id']),
    tipoFonte: String(r['tipo_fonte']),
    registroAns: txtOuNull(r['registro_ans']),
    carteira: txtOuNull(r['numero_carteira']),
    guia: txtOuNull(r['numero_guia']),
    entrada: iso(r['data_hora_entrada'])!,
    codigoPrestador: String(r['prestador'] ?? ''),
    altaEm: iso(r['alta_em']),
    altaPorObito: r['destino'] === 'obito' || r['tipo_saida'] === 'obito',
    motivoTiss: txtOuNull(r['codigo_tiss']),
    tipoInternacao: tipoInternacaoDaModalidade(
      txtOuNull(r['modalidade_tiss']),
      txtOuNull(r['modalidade_classificacao']),
    ),
    recemNascido: num(r['recem_nascido']) === 1,
  };
}

const comunicacaoLida = (r: Record<string, unknown>): ComunicacaoLida => ({
  id: num(r['id']),
  tipo: String(r['tipo']),
  situacao: String(r['situacao']),
  protocolo: txtOuNull(r['protocolo']),
  enviadoEm: iso(r['enviado_em']),
  respondidoEm: iso(r['respondido_em']),
  resposta: txtOuNull(r['resposta']),
  criadoEm: iso(r['criado_em'])!,
  versao: num(r['versao']),
  pelaIntegracao: r['integracao_mensagem_id'] !== null && r['integracao_mensagem_id'] !== undefined,
  situacaoEnvio: txtOuNull(r['situacao_envio']),
});

/** O serviço web da comunicação de beneficiário cadastrado e ativo para a fonte, no estabelecimento. */
async function servicoWebDaFonte(l: Leitor, est: number, fonte: number): Promise<number | null> {
  const r = await l.uma(
    `SELECT ep.id FROM endpoint_tiss_fonte_pagadora ep
       JOIN transacao_tiss_webservice t ON t.id = ep.transacao_tiss_webservice_id
      WHERE ep.estabelecimento_id = ? AND ep.fonte_pagadora_id = ? AND ep.forma_envio = 'servico_web'
        AND ep.ativo = TRUE AND t.ativo = TRUE AND t.tipo_transacao = 'comunicacao_beneficiario'
      ORDER BY ep.id DESC LIMIT 1`,
    [est, fonte],
  );
  return r ? num(r['id']) : null;
}

export class PortaComunicacaoOperadoraPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'internacao.comunicacaoOperadora');
  }

  /** As comunicações da internação (visão por paciente), da mais recente à mais antiga. */
  comunicacoes(c: ContextoPortaPropria, internacao: number): Promise<ComunicacaoLida[]> {
    return this.ler(c, 'lista', async (l, est) => {
      await lerInternacao(l, internacao, est.id);
      return (
        await l.consultar(
          `SELECT co.*, im.situacao AS situacao_envio FROM comunicacao_internacao_operadora co
             LEFT JOIN integracao_mensagem im ON im.id = co.integracao_mensagem_id
            WHERE co.internacao_id = ? AND co.excluido_em IS NULL ORDER BY co.id DESC LIMIT 200`,
          [internacao],
        )
      ).map(comunicacaoLida);
    });
  }

  async registrar(c: ContextoPortaPropria, internacao: number, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaRegistrar, entrada);
    return this.gravar(
      c,
      'internacao.comunicacaooperadora.registrar',
      ['comunicacao_internacao_operadora'],
      async (tx, est) => {
        await tx.consultarParaAtualizar('SELECT id FROM internacao WHERE id = ? AND estabelecimento_id = ?', [
          internacao,
          est.id,
        ]);
        const d = await lerInternacao(tx, internacao, est.id);
        const vivas = (
          await tx.consultar(
            `SELECT DISTINCT tipo FROM comunicacao_internacao_operadora
              WHERE internacao_id = ? AND excluido_em IS NULL AND situacao IN (${SITUACOES_COMUNICACAO_VIVAS.map(() => '?').join(', ')})`,
            [internacao, ...SITUACOES_COMUNICACAO_VIVAS],
          )
        ).map((r) => String(r['tipo']) as TipoComunicacaoOperadora);
        const p = conferirNovaComunicacao({
          tipo: e.tipo,
          tipoFonte: d.tipoFonte,
          registroAns: d.registroAns,
          numeroCarteira: d.carteira,
          altaRegistrada: d.altaEm !== null,
          altaPorObito: d.altaPorObito,
          vivas,
        });
        if (p.length) throw recusaRegra('Comunicação recusada', p);
        const id = await tx.incluir('comunicacao_internacao_operadora', {
          internacao_id: internacao,
          fonte_pagadora_id: d.fonte,
          tipo: e.tipo,
          situacao: 'pendente',
          origem: 'sistema',
        });
        return { tabela: 'comunicacao_internacao_operadora', id };
      },
    );
  }

  /** A mensagem de comunicação de beneficiário da comunicação (prévia; nada é gravado). */
  mensagem(
    c: ContextoPortaPropria,
    id: number,
  ): Promise<{ xml: string | null; problemas: { campo: string; mensagem: string }[] }> {
    return this.ler(c, 'mensagem', async (l, est) => {
      const r = await this.montar(l, id, est.id);
      return { xml: r.xml, problemas: r.problemas };
    });
  }

  /** Monta a mensagem dos dados gravados da comunicação e da internação (a mesma na prévia e no envio). */
  private async montar(
    l: Leitor,
    id: number,
    estId: number,
  ): Promise<{ xml: string | null; hash: string | null; problemas: { campo: string; mensagem: string }[] }> {
    const est = { id: estId };
    const r = await l.uma(
      `SELECT co.id, co.tipo, co.internacao_id FROM comunicacao_internacao_operadora co
         JOIN internacao i ON i.id = co.internacao_id
        WHERE co.id = ? AND i.estabelecimento_id = ? AND co.excluido_em IS NULL`,
      [id, est.id],
    );
    if (!r) throw naoEncontrado('Comunicação');
    const d = await lerInternacao(l, num(r['internacao_id']), est.id);
    const tipo = String(r['tipo']) as TipoComunicacaoOperadora;
    const conferida = conferirMensagemComunicacao({
      tipo,
      registroAns: d.registroAns ?? '',
      numeroCarteira: d.carteira ?? '',
      recemNascido: d.recemNascido,
      eventoEm: tipo === 'internacao' ? d.entrada : (d.altaEm ?? d.entrada),
      tipoInternacao: d.tipoInternacao,
      motivoEncerramento: d.motivoTiss,
    });
    const m = conferida.dados;
    if (!m) return { xml: null, hash: null, problemas: conferida.problemas };
    if (!d.codigoPrestador.trim())
      return {
        xml: null,
        hash: null,
        problemas: [
          { campo: 'prestador', mensagem: 'O hospital não tem o código de prestador na operadora.' },
        ],
      };
    const agora = new Date().toISOString();
    try {
      const msg = mensagemComunicacaoBeneficiario(
        {
          sequencialTransacao: String(id),
          data: agora.slice(0, 10),
          hora: agora.slice(11, 19),
          codigoPrestadorNaOperadora: d.codigoPrestador,
          registroANS: d.registroAns!,
        },
        {
          beneficiario: { numeroCarteira: m.numeroCarteira, atendimentoRN: m.recemNascido },
          dataEvento: m.dataEvento,
          tipoEvento: m.tipoEvento,
          tipoInternacao: m.tipoInternacao,
          motivoEncerramento: m.motivoEncerramento,
        },
      );
      return { xml: msg.xml, hash: msg.hash, problemas: [] };
    } catch (erro) {
      if (erro instanceof ErroLoteTiss)
        return { xml: null, hash: null, problemas: [{ campo: 'mensagem', mensagem: erro.message }] };
      throw erro;
    }
  }

  async transicao(
    c: ContextoPortaPropria,
    id: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: string }> {
    const e = entradaValida(esquemaTransicao, entrada);
    return this.gravar(
      c,
      `internacao.comunicacaooperadora.${e.acao}`,
      ['comunicacao_internacao_operadora'],
      async (tx, est) => {
        const r = (
          await tx.consultarParaAtualizar<Record<string, unknown>>(
            `SELECT co.situacao, co.protocolo, co.enviado_em FROM comunicacao_internacao_operadora co
               JOIN internacao i ON i.id = co.internacao_id
              WHERE co.id = ? AND i.estabelecimento_id = ? AND co.excluido_em IS NULL`,
            [id, est.id],
          )
        )[0];
        if (!r) throw naoEncontrado('Comunicação');
        const t = transicaoComunicacao({
          situacao: String(r['situacao']) as SituacaoComunicacaoOperadora,
          acao: e.acao as AcaoComunicacao,
          protocolo: e.protocolo ?? txtOuNull(r['protocolo']),
          resposta: e.resposta,
        });
        if (!t.para) throw recusaRegra('Transição recusada', t.problemas);
        const agora = new Date();
        const valores: Record<string, unknown> = { situacao: t.para };
        if (e.acao === 'enviar' || (e.acao === 'falhar' && r['enviado_em'] === null))
          valores['enviado_em'] = agora;
        if (e.acao === 'reenviar') valores['enviado_em'] = null;
        if (e.acao === 'confirmar' || e.acao === 'rejeitar') valores['respondido_em'] = agora;
        if (e.protocolo) valores['protocolo'] = e.protocolo;
        if (e.resposta) valores['resposta'] = e.resposta;
        await tx.alterar('comunicacao_internacao_operadora', id, e.versao, valores);
        return { tabela: 'comunicacao_internacao_operadora', id, situacao: t.para };
      },
    );
  }

  /**
   * Envia a comunicação pendente pelo serviço web da operadora: confere (domínio), monta a mensagem dos dados gravados,
   * grava a saída na outbox na mesma transação e marca 'enviada' com a mensagem ligada. O relay transmite depois do
   * COMMIT; o retorno é lido por `retorno`.
   */
  async transmitir(
    c: ContextoPortaPropria,
    id: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: string; mensagem: number }> {
    const e = entradaValida(esquemaVersao, entrada);
    return this.gravar(
      c,
      'internacao.comunicacaooperadora.transmitir',
      ['comunicacao_internacao_operadora', 'integracao_mensagem'],
      async (tx, est, usuario) => {
        const r = (
          await tx.consultarParaAtualizar<Record<string, unknown>>(
            `SELECT co.id, co.tipo, co.situacao, co.internacao_id, co.fonte_pagadora_id
               FROM comunicacao_internacao_operadora co
               JOIN internacao i ON i.id = co.internacao_id
              WHERE co.id = ? AND i.estabelecimento_id = ? AND co.excluido_em IS NULL`,
            [id, est.id],
          )
        )[0];
        if (!r) throw naoEncontrado('Comunicação');
        const fonte = num(r['fonte_pagadora_id']);
        const servico = await servicoWebDaFonte(tx, est.id, fonte);
        const tipo = String(r['tipo']) as TipoComunicacaoOperadora;
        const p = conferirTransmissao({
          situacao: String(r['situacao']) as SituacaoComunicacaoOperadora,
          tipo,
          servicoWeb: servico !== null,
        });
        if (p.length) throw recusaRegra('Envio recusado', p);
        const m = await this.montar(tx, id, est.id);
        if (!m.xml || !m.hash) throw recusaRegra('Envio recusado', m.problemas);
        const mensagem = await this.paraOutbox(tx, est.id, usuario, {
          id,
          versao: e.versao,
          internacao: num(r['internacao_id']),
          fonte,
          servico: servico!,
          tipo,
          hash: m.hash,
        });
        return { tabela: 'comunicacao_internacao_operadora', id, situacao: 'enviada', mensagem };
      },
    );
  }

  /** A saída para a outbox (só IDs, códigos e o hash) e a comunicação 'enviada' com a mensagem ligada. */
  private async paraOutbox(
    tx: TxOperacao,
    est: number,
    usuario: number,
    x: {
      id: number;
      versao: number;
      internacao: number;
      fonte: number;
      servico: number;
      tipo: TipoComunicacaoOperadora;
      hash: string;
    },
  ): Promise<number> {
    const agora = new Date();
    const mensagem = await gravarOutbox(tx, {
      estabelecimento: est,
      ponto: PONTO_COMUNICACAO_OPERADORA,
      entidade: 'comunicacao_internacao_operadora',
      entidadeId: x.id,
      chave: `${PONTO_COMUNICACAO_OPERADORA}:${x.id}:${x.versao}`,
      carga: {
        comunicacao: x.id,
        internacao: x.internacao,
        fonte: x.fonte,
        servicoWeb: x.servico,
        tipo: x.tipo,
        hash: x.hash,
      },
      usuario,
      agora,
    });
    await tx.alterar('comunicacao_internacao_operadora', x.id, x.versao, {
      situacao: 'enviada',
      enviado_em: agora,
      integracao_mensagem_id: mensagem,
    });
    return mensagem;
  }

  /**
   * C2-070: gera as comunicações devidas da internação (internação e, com a alta, a saída) e, com o serviço web
   * cadastrado para a fonte, já as envia para a outbox. Chamado ao internar e ao registrar a saída; idempotente.
   */
  async disparar(
    c: ContextoPortaPropria,
    internacao: number,
  ): Promise<{ geradas: { id: number; tipo: string; situacao: string }[] }> {
    return this.gravar(
      c,
      'internacao.comunicacaooperadora.disparar',
      ['comunicacao_internacao_operadora', 'integracao_mensagem'],
      async (tx, est, usuario) => {
        const trava = await tx.consultarParaAtualizar(
          'SELECT id FROM internacao WHERE id = ? AND estabelecimento_id = ?',
          [internacao, est.id],
        );
        if (!trava.length) throw naoEncontrado('Internação');
        const d = await lerInternacao(tx, internacao, est.id);
        const existentes = (
          await tx.consultar(
            `SELECT tipo, situacao FROM comunicacao_internacao_operadora
              WHERE internacao_id = ? AND excluido_em IS NULL`,
            [internacao],
          )
        ).map((r) => ({
          tipo: String(r['tipo']) as TipoComunicacaoOperadora,
          situacao: String(r['situacao']) as SituacaoComunicacaoOperadora,
        }));
        const devidas = comunicacoesDevidas({
          tipoFonte: d.tipoFonte,
          registroAns: d.registroAns,
          numeroCarteira: d.carteira,
          altaRegistrada: d.altaEm !== null,
          altaPorObito: d.altaPorObito,
          existentes,
        });
        const servico = devidas.length ? await servicoWebDaFonte(tx, est.id, d.fonte) : null;
        const geradas: { id: number; tipo: string; situacao: string }[] = [];
        for (const tipo of devidas) {
          const id = await tx.incluir('comunicacao_internacao_operadora', {
            internacao_id: internacao,
            fonte_pagadora_id: d.fonte,
            tipo,
            situacao: 'pendente',
            origem: 'sistema',
          });
          let situacao = 'pendente';
          if (
            servico !== null &&
            conferirTransmissao({ situacao: 'pendente', tipo, servicoWeb: true }).length === 0
          ) {
            const m = await this.montar(tx, id, est.id);
            if (m.xml && m.hash) {
              await this.paraOutbox(tx, est.id, usuario, {
                id,
                versao: 1,
                internacao,
                fonte: d.fonte,
                servico,
                tipo,
                hash: m.hash,
              });
              situacao = 'enviada';
            }
          }
          geradas.push({ id, tipo, situacao });
        }
        return { tabela: 'comunicacao_internacao_operadora', id: geradas[0]?.id ?? null, geradas };
      },
    );
  }

  /**
   * Lê o retorno do serviço web na mensagem de integração ligada e aplica a transição (confirmar, rejeitar ou falhar)
   * com a versão lida; sem retorno ainda, nada muda e devolve `aguardando`.
   */
  async retorno(
    c: ContextoPortaPropria,
    id: number,
  ): Promise<{ id: number; situacao: string; aguardando: boolean }> {
    return this.gravar(
      c,
      'internacao.comunicacaooperadora.retorno',
      ['comunicacao_internacao_operadora'],
      async (tx, est) => {
        const r = (
          await tx.consultarParaAtualizar<Record<string, unknown>>(
            `SELECT co.situacao, co.versao, co.integracao_mensagem_id, im.situacao AS situacao_envio,
                    im.resposta AS retorno, im.erro
               FROM comunicacao_internacao_operadora co
               JOIN internacao i ON i.id = co.internacao_id
               LEFT JOIN integracao_mensagem im ON im.id = co.integracao_mensagem_id
              WHERE co.id = ? AND i.estabelecimento_id = ? AND co.excluido_em IS NULL`,
            [id, est.id],
          )
        )[0];
        if (!r) throw naoEncontrado('Comunicação');
        const situacao = String(r['situacao']) as SituacaoComunicacaoOperadora;
        if (r['integracao_mensagem_id'] === null || r['situacao_envio'] === null)
          throw recusaRegra('Retorno recusado', [
            {
              campo: 'canal',
              mensagem: 'A comunicação não saiu pelo serviço web: informe a resposta à mão.',
            },
          ]);
        const lido = retornoDaIntegracao({
          situacaoComunicacao: situacao,
          situacaoMensagem: String(r['situacao_envio']) as SituacaoMensagemIntegracao,
          resposta: txtOuNull(r['retorno']),
          erro: txtOuNull(r['erro']),
        });
        if (lido.problemas.length) throw recusaRegra('Retorno recusado', lido.problemas);
        if (!lido.retorno)
          return { tabela: 'comunicacao_internacao_operadora', id, situacao, aguardando: true };
        const t = transicaoComunicacao({ situacao, ...lido.retorno });
        if (!t.para) throw recusaRegra('Retorno recusado', t.problemas);
        const valores: Record<string, unknown> = { situacao: t.para };
        if (lido.retorno.acao !== 'falhar') valores['respondido_em'] = new Date();
        if (lido.retorno.protocolo) valores['protocolo'] = lido.retorno.protocolo;
        if (lido.retorno.resposta) valores['resposta'] = lido.retorno.resposta;
        await tx.alterar('comunicacao_internacao_operadora', id, num(r['versao']), valores);
        return { tabela: 'comunicacao_internacao_operadora', id, situacao: t.para, aguardando: false };
      },
    );
  }
}
