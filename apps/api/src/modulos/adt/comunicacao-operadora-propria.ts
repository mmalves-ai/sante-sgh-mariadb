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
//     de envio e de resposta, com a versão lida; nada é apagado (cancelar guarda o motivo).
import { ErroLoteTiss, mensagemComunicacaoBeneficiario } from '@sgh/dominio-faturamento';
import {
  type AcaoComunicacao,
  conferirMensagemComunicacao,
  conferirNovaComunicacao,
  SITUACOES_COMUNICACAO_VIVAS,
  type SituacaoComunicacaoOperadora,
  TIPOS_COMUNICACAO_OPERADORA,
  type TipoComunicacaoOperadora,
  tipoInternacaoDaModalidade,
  transicaoComunicacao,
} from '@sgh/dominio-internacao';
import type { Leitor } from '@sgh/nucleo';
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

const TABELAS = ['comunicacao_internacao_operadora'];
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
});

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
          `SELECT * FROM comunicacao_internacao_operadora
            WHERE internacao_id = ? AND excluido_em IS NULL ORDER BY id DESC LIMIT 200`,
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
      if (!m) return { xml: null, problemas: conferida.problemas };
      if (!d.codigoPrestador.trim())
        return {
          xml: null,
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
        return { xml: msg.xml, problemas: [] };
      } catch (erro) {
        if (erro instanceof ErroLoteTiss)
          return { xml: null, problemas: [{ campo: 'mensagem', mensagem: erro.message }] };
        throw erro;
      }
    });
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
}
