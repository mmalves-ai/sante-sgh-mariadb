// Porta PRÓPRIA da prescrição digital por plataforma externa (F8, 08-INTG L132), sobre o banco do cliente. As regras
// são do @sgh/dominio-integracao (prescricao-digital.ts); aqui ficam as leituras e as gravações:
//   - a visão por paciente: as receitas do paciente com a situação da assinatura e os envios de cada uma (o retorno
//     validável: identificador, código e endereço de validação);
//   - o ENVIO: a receita emitida e assinada em ICP-Brasil pelo prescritor grava `envio_prescricao_plataforma`
//     (pendente, ligado ao documento assinado, à assinatura e ao resumo do documento) e a mensagem JSON na fila de
//     saída (`mensagem_integracao_saida`) do ponto da plataforma; o enviador de prescrição do worker entrega (simulador
//     fora de produção) e grava o retorno no envio;
//   - o CANCELAMENTO com motivo: o envio passa a cancelado (nada é apagado); se a plataforma já devolveu o
//     identificador, o pedido de cancelamento vai à fila; a pendente ainda na fila é cancelada lá também.
import { createHash } from 'node:crypto';
import {
  cancelamentoVaiAPlataforma,
  CATEGORIAS_PLATAFORMA_PRESCRICAO,
  conferirCancelamentoPrescricaoDigital,
  conferirEnvioPrescricaoDigital,
  EVENTO_PRESCRICAO_DIGITAL_CANCELAMENTO,
  EVENTO_PRESCRICAO_DIGITAL_ENVIO,
  montarPedidoPrescricaoDigital,
  type PedidoPrescricaoDigital,
} from '@sgh/dominio-integracao';
import type { TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  BaseComunicacaoPropria,
  bool,
  conflito,
  type ContextoComunicacao,
  dataOuNull,
  entradaValida,
  fusoDoEstabelecimento,
  naoEncontrado,
  num,
  numOuNull,
  recusa,
  txtOuNull,
} from './comunicacao-base-propria.js';

export const PORTA_PRESCRICAO_DIGITAL = Symbol('PORTA_PRESCRICAO_DIGITAL');

const T_ENVIO = 'envio_prescricao_plataforma';
const T_SAIDA = 'mensagem_integracao_saida';
const T_PONTO = 'ponto_integracao';
export const TABELAS_PRESCRICAO_DIGITAL = [T_ENVIO, T_SAIDA, T_PONTO] as const;

export const OPERACOES_PRESCRICAO_DIGITAL = {
  enviar: 'integracao.prescricao_digital.enviar',
  cancelar: 'integracao.prescricao_digital.cancelar',
} as const;

const CATEGORIAS_SQL = CATEGORIAS_PLATAFORMA_PRESCRICAO.map((c) => `'${c}'`).join(',');

export const esquemaEnvioPrescricao = z
  .object({ receita: z.number().int().positive(), plataforma: z.string().min(1).max(40) })
  .strict();
export const esquemaCancelamentoPrescricao = z
  .object({ motivo: z.string().max(500), versao: z.number().int().positive() })
  .strict();

export interface PlataformaPrescricao {
  readonly codigo: string;
  readonly nome: string;
  readonly parceiroApiAtivo: boolean;
}

export interface EnvioPrescricaoLido {
  readonly id: number;
  readonly receita: number | null;
  readonly plataforma: string;
  readonly plataformaNome: string;
  readonly situacao: string;
  readonly situacaoExterna: string | null;
  readonly identificadorExterno: string | null;
  readonly codigoValidacao: string | null;
  readonly urlValidacao: string | null;
  readonly filaSituacao: string | null;
  readonly enviadoEm: string | null;
  readonly retornoEm: string | null;
  readonly canceladoEm: string | null;
  readonly motivoCancelamento: string | null;
  readonly criadoEm: string;
  readonly versao: number;
}

export interface ReceitaParaEnvio {
  readonly id: number;
  readonly numero: string;
  readonly emitidaEm: string;
  readonly validadeAte: string | null;
  readonly situacao: string;
  readonly tipo: string;
  readonly controleEspecial: boolean;
  readonly prescritor: string | null;
  readonly assinatura: string | null;
  readonly nivelAssinatura: string | null;
  readonly envios: EnvioPrescricaoLido[];
}

const SQL_ENVIOS = `
  SELECT e.id, e.receita_medica_id, s.codigo AS plataforma, s.nome AS plataforma_nome, e.situacao, e.situacao_externa,
         e.identificador_externo, e.codigo_validacao, e.url_validacao, m.situacao AS fila_situacao, e.enviado_em,
         e.retorno_em, e.cancelado_em, e.motivo_cancelamento, e.criado_em, e.versao
    FROM envio_prescricao_plataforma e
    JOIN sistema_externo s ON s.id = e.sistema_externo_id
    LEFT JOIN mensagem_integracao_saida m ON m.id = e.mensagem_integracao_saida_id
   WHERE e.estabelecimento_id = ? AND e.excluido_em IS NULL`;

const envioDaLinha = (x: Record<string, unknown>): EnvioPrescricaoLido => ({
  id: num(x['id']),
  receita: numOuNull(x['receita_medica_id']),
  plataforma: String(x['plataforma']),
  plataformaNome: String(x['plataforma_nome']),
  situacao: String(x['situacao']),
  situacaoExterna: txtOuNull(x['situacao_externa']),
  identificadorExterno: txtOuNull(x['identificador_externo']),
  codigoValidacao: txtOuNull(x['codigo_validacao']),
  urlValidacao: txtOuNull(x['url_validacao']),
  filaSituacao: txtOuNull(x['fila_situacao']),
  enviadoEm: dataOuNull(x['enviado_em']),
  retornoEm: dataOuNull(x['retorno_em']),
  canceladoEm: dataOuNull(x['cancelado_em']),
  motivoCancelamento: txtOuNull(x['motivo_cancelamento']),
  criadoEm: dataOuNull(x['criado_em']) ?? '',
  versao: num(x['versao']),
});

/** A assinatura válida mais recente do documento da receita, com o signatário. */
const SQL_DOCUMENTO = `
  SELECT d.id AS documento_id, d.situacao AS documento_situacao, d.codigo_verificacao, d.hash_conteudo,
         COALESCE(d.arquivo_assinado_id, d.arquivo_id) AS arquivo_id,
         a.id AS assinatura_id, a.nivel, a.profissional_id AS signatario
    FROM documento_assinado d
    LEFT JOIN assinatura_documento a ON a.id = (
         SELECT MAX(a2.id) FROM assinatura_documento a2
          WHERE a2.documento_assinado_id = d.id AND a2.situacao = 'valida' AND a2.excluido_em IS NULL)
   WHERE d.entidade = 'receita_medica' AND d.entidade_id = ? AND d.estabelecimento_id = ? AND d.excluido_em IS NULL
   ORDER BY (d.situacao = 'assinado') DESC, d.id DESC LIMIT 1`;

export class PortaPrescricaoDigitalPropria extends BaseComunicacaoPropria {
  /** As plataformas de prescrição digital do cliente (sistema externo ativo da categoria, com parceiro de API). */
  plataformas(c: ContextoComunicacao): Promise<PlataformaPrescricao[]> {
    return this.ler(c, 'prescricaoDigital.plataformas', async (l) =>
      (
        await l.consultar(
          `SELECT s.codigo, s.nome,
                  EXISTS (SELECT 1 FROM parceiro_dados p WHERE p.sistema_externo_id = s.id AND p.tipo = 'api'
                             AND p.ativo = TRUE AND p.excluido_em IS NULL) AS parceiro
             FROM sistema_externo s
            WHERE s.ativo = TRUE AND s.excluido_em IS NULL AND s.categoria IN (${CATEGORIAS_SQL})
            ORDER BY s.nome LIMIT 100`,
          [],
          { teto: 100 },
        )
      ).map((x) => ({
        codigo: String(x['codigo']),
        nome: String(x['nome']),
        parceiroApiAtivo: bool(x['parceiro']),
      })),
    );
  }

  /** Busca de paciente pelo nome ou pelo prontuário (só os que têm receita no estabelecimento). */
  pacientes(
    c: ContextoComunicacao,
    termo: string,
  ): Promise<{ id: number; nome: string; prontuario: string }[]> {
    const t = termo.trim();
    if (t.length < 2) return Promise.resolve([]);
    return this.ler(c, 'prescricaoDigital.pacientes', async (l, est) =>
      (
        await l.consultar(
          `SELECT p.id, pf.nome, p.numero_prontuario
             FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE p.excluido_em IS NULL
              AND (pf.nome LIKE ? OR CAST(p.numero_prontuario AS CHAR) = ?)
              AND EXISTS (SELECT 1 FROM receita_medica r WHERE r.paciente_id = p.id AND r.estabelecimento_id = ?
                             AND r.excluido_em IS NULL)
            ORDER BY pf.nome LIMIT 30`,
          [`%${t.replace(/[%_]/g, '')}%`, t, est],
          { teto: 30 },
        )
      ).map((x) => ({
        id: num(x['id']),
        nome: String(x['nome']),
        prontuario: String(x['numero_prontuario']),
      })),
    );
  }

  /** Visão por paciente: as receitas (mais novas primeiro) com a assinatura e os envios de cada uma. */
  doPaciente(c: ContextoComunicacao, paciente: number): Promise<ReceitaParaEnvio[]> {
    return this.ler(c, 'prescricaoDigital.paciente', async (l, est) => {
      const receitas = await l.consultar(
        `SELECT r.id, r.numero, r.emitida_em, r.validade_ate, r.situacao, t.descricao AS tipo, t.controle_especial,
                pf.nome AS prescritor,
                (SELECT d.situacao FROM documento_assinado d WHERE d.entidade = 'receita_medica' AND d.entidade_id = r.id
                    AND d.excluido_em IS NULL ORDER BY (d.situacao = 'assinado') DESC, d.id DESC LIMIT 1) AS assinatura,
                (SELECT a.nivel FROM documento_assinado d JOIN assinatura_documento a ON a.documento_assinado_id = d.id
                  WHERE d.entidade = 'receita_medica' AND d.entidade_id = r.id AND d.excluido_em IS NULL
                    AND a.situacao = 'valida' AND a.excluido_em IS NULL ORDER BY a.id DESC LIMIT 1) AS nivel
           FROM receita_medica r
           JOIN tipo_receita t ON t.id = r.tipo_receita_id
           LEFT JOIN profissional pr ON pr.id = r.prescritor_profissional_id
           LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
          WHERE r.paciente_id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL
          ORDER BY r.emitida_em DESC, r.id DESC LIMIT 100`,
        [paciente, est],
        { teto: 100 },
      );
      const envios = (
        await l.consultar(
          `${SQL_ENVIOS} AND e.paciente_id = ? ORDER BY e.id DESC LIMIT 500`,
          [est, paciente],
          { teto: 500 },
        )
      ).map(envioDaLinha);
      return receitas.map((r) => ({
        id: num(r['id']),
        numero: String(r['numero']),
        emitidaEm: dataOuNull(r['emitida_em']) ?? '',
        validadeAte: r['validade_ate'] ? String(dataOuNull(r['validade_ate'])).slice(0, 10) : null,
        situacao: String(r['situacao']),
        tipo: String(r['tipo']),
        controleEspecial: bool(r['controle_especial']),
        prescritor: txtOuNull(r['prescritor']),
        assinatura: txtOuNull(r['assinatura']),
        nivelAssinatura: txtOuNull(r['nivel']),
        envios: envios.filter((e) => e.receita === num(r['id'])),
      }));
    });
  }

  /** Os envios do estabelecimento (fila de acompanhamento), pela situação. */
  envios(c: ContextoComunicacao, situacao: string | null): Promise<EnvioPrescricaoLido[]> {
    return this.ler(c, 'prescricaoDigital.envios', async (l, est) =>
      (
        await l.consultar(
          `${SQL_ENVIOS} ${situacao ? 'AND e.situacao = ?' : ''} ORDER BY e.id DESC LIMIT 200`,
          situacao ? [est, situacao] : [est],
          { teto: 200 },
        )
      ).map(envioDaLinha),
    );
  }

  /** Envia a receita assinada à plataforma: o envio pendente e a mensagem na fila de saída, na mesma transação. */
  enviar(
    c: ContextoComunicacao,
    entrada: unknown,
    agora: Date = new Date(),
  ): Promise<{ id: number; mensagem: number }> {
    const e = entradaValida(esquemaEnvioPrescricao, entrada);
    return this.gravar(
      c,
      OPERACOES_PRESCRICAO_DIGITAL.enviar,
      TABELAS_PRESCRICAO_DIGITAL,
      async (tx, est) => {
        const [r] = await tx.consultarParaAtualizar(
          `SELECT id, numero, paciente_id, atendimento_id, prescritor_profissional_id, situacao, emitida_em, validade_ate
           FROM receita_medica WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [e.receita, est],
          { teto: 1 },
        );
        if (!r) throw naoEncontrado('Receita');
        const d = await tx.uma(SQL_DOCUMENTO, [e.receita, est]);
        const s = await tx.uma(
          `SELECT s.id, s.categoria, s.ativo,
                (SELECT p.id FROM parceiro_dados p WHERE p.sistema_externo_id = s.id AND p.tipo = 'api' AND p.ativo = TRUE
                    AND p.excluido_em IS NULL ORDER BY p.id LIMIT 1) AS parceiro_id
           FROM sistema_externo s WHERE s.codigo = ? AND s.excluido_em IS NULL`,
          [e.plataforma],
        );
        const anteriores = await tx.consultar(
          `SELECT situacao, sistema_externo_id FROM envio_prescricao_plataforma
          WHERE receita_medica_id = ? AND excluido_em IS NULL LIMIT 200`,
          [e.receita],
          { teto: 200 },
        );
        const fuso = await fusoDoEstabelecimento(tx, est, agora);
        const hoje = new Date(agora.getTime() + fuso * 60_000).toISOString().slice(0, 10);
        const validade = r['validade_ate'] ? String(dataOuNull(r['validade_ate'])).slice(0, 10) : null;
        const erros = conferirEnvioPrescricaoDigital(
          {
            situacaoReceita: String(r['situacao']),
            situacaoDocumento: d ? String(d['documento_situacao']) : null,
            nivelAssinatura: d ? txtOuNull(d['nivel']) : null,
            assinadaPeloPrescritor:
              !!d && numOuNull(d['signatario']) === num(r['prescritor_profissional_id']),
            validadeAte: validade,
            hoje,
          },
          s
            ? {
                ativa: bool(s['ativo']),
                categoria: String(s['categoria']),
                parceiroApiAtivo: numOuNull(s['parceiro_id']) !== null,
              }
            : null,
          anteriores.map((a) => ({
            situacao: String(a['situacao']),
            plataformaMesma: !!s && num(a['sistema_externo_id']) === num(s['id']),
          })),
        );
        if (erros.length > 0 || !s || !d) throw recusa(erros, 'Envio recusado');
        const sid = num(s['id']);
        const id = await tx.incluir(T_ENVIO, {
          estabelecimento_id: est,
          atendimento_id: num(r['atendimento_id']),
          paciente_id: num(r['paciente_id']),
          profissional_id: num(r['prescritor_profissional_id']),
          sistema_externo_id: sid,
          receita_medica_id: e.receita,
          documento_assinado_id: num(d['documento_id']),
          assinatura_documento_id: numOuNull(d['assinatura_id']),
          hash_documento: txtOuNull(d['hash_conteudo']),
          versao_api: '1',
          situacao: 'pendente',
        });
        const mensagem = await this.enfileirar(tx, est, sid, num(s['parceiro_id']), id, {
          evento: EVENTO_PRESCRICAO_DIGITAL_ENVIO,
          envio: id,
          estabelecimento: c.hospital,
          receita: {
            numero: String(r['numero']),
            emitidaEm: dataOuNull(r['emitida_em']) ?? '',
            validadeAte: validade,
          },
          documento: {
            codigoVerificacao: String(d['codigo_verificacao']),
            hash: String(d['hash_conteudo']),
            arquivo: num(d['arquivo_id']),
          },
          identificadorExterno: null,
          motivo: null,
        });
        await tx.alterar(T_ENVIO, id, 1, { mensagem_integracao_saida_id: mensagem });
        return { id, mensagem };
      },
    );
  }

  /** Cancela o envio (com o motivo e a versão lida); a plataforma recebe o cancelamento se já conhece a receita. */
  cancelar(
    c: ContextoComunicacao,
    id: number,
    entrada: unknown,
    agora: Date = new Date(),
  ): Promise<{ id: number; mensagem: number | null }> {
    const e = entradaValida(esquemaCancelamentoPrescricao, entrada);
    return this.gravar(
      c,
      OPERACOES_PRESCRICAO_DIGITAL.cancelar,
      TABELAS_PRESCRICAO_DIGITAL,
      async (tx, est) => {
        const [x] = await tx.consultarParaAtualizar(
          `SELECT e.id, e.situacao, e.versao, e.identificador_externo, e.sistema_externo_id, e.mensagem_integracao_saida_id,
                r.numero, r.emitida_em, r.validade_ate,
                (SELECT p.id FROM parceiro_dados p WHERE p.sistema_externo_id = e.sistema_externo_id AND p.tipo = 'api'
                    AND p.excluido_em IS NULL ORDER BY p.ativo DESC, p.id LIMIT 1) AS parceiro_id
           FROM envio_prescricao_plataforma e LEFT JOIN receita_medica r ON r.id = e.receita_medica_id
          WHERE e.id = ? AND e.estabelecimento_id = ? AND e.excluido_em IS NULL`,
          [id, est],
          { teto: 1 },
        );
        if (!x) throw naoEncontrado('Envio');
        if (num(x['versao']) !== e.versao) throw conflito();
        const erros = conferirCancelamentoPrescricaoDigital(String(x['situacao']), e.motivo);
        if (erros.length > 0) throw recusa(erros, 'Cancelamento recusado');
        // A mensagem do envio ainda não entregue sai da fila (cancelada, não apagada).
        const msg = numOuNull(x['mensagem_integracao_saida_id']);
        if (msg !== null) {
          const m = await tx.uma(
            "SELECT id, versao FROM mensagem_integracao_saida WHERE id = ? AND situacao IN ('pendente','erro','rejeitada','expirada')",
            [msg],
          );
          if (m) await tx.alterar(T_SAIDA, msg, num(m['versao']), { situacao: 'cancelada' });
        }
        const identificador = txtOuNull(x['identificador_externo']);
        let mensagem: number | null = null;
        if (cancelamentoVaiAPlataforma(identificador) && numOuNull(x['parceiro_id']) !== null)
          mensagem = await this.enfileirar(tx, est, num(x['sistema_externo_id']), num(x['parceiro_id']), id, {
            evento: EVENTO_PRESCRICAO_DIGITAL_CANCELAMENTO,
            envio: id,
            estabelecimento: c.hospital,
            receita: {
              numero: String(x['numero'] ?? ''),
              emitidaEm: dataOuNull(x['emitida_em']) ?? '',
              validadeAte: x['validade_ate'] ? String(dataOuNull(x['validade_ate'])).slice(0, 10) : null,
            },
            documento: null,
            identificadorExterno: identificador,
            motivo: e.motivo.trim(),
          });
        await tx.alterar(T_ENVIO, id, e.versao, {
          situacao: 'cancelada',
          cancelado_em: agora,
          motivo_cancelamento: e.motivo.trim(),
        });
        return { id, mensagem };
      },
    );
  }

  /** A mensagem JSON na fila de saída do ponto da plataforma (criado na primeira vez). */
  private async enfileirar(
    tx: TxOperacao,
    est: number,
    sistema: number,
    parceiro: number,
    envio: number,
    pedido: PedidoPrescricaoDigital,
  ): Promise<number> {
    const par = await tx.uma('SELECT codigo, nome, limite_tentativas FROM parceiro_dados WHERE id = ?', [
      parceiro,
    ]);
    if (!par) throw naoEncontrado('Parceiro da plataforma');
    const codigoPonto = `parceiro.${String(par['codigo'])}.saida`;
    let ponto = await tx.uma(
      'SELECT id, ativo FROM ponto_integracao WHERE estabelecimento_id = ? AND codigo = ? AND excluido_em IS NULL',
      [est, codigoPonto],
    );
    if (ponto && !bool(ponto['ativo']))
      throw recusa([
        {
          campo: 'ponto',
          codigo: 'ponto-desativado',
          mensagem: 'O ponto de saída da plataforma está desativado.',
        },
      ]);
    if (!ponto) {
      const padrao = await tx.uma(
        "SELECT id FROM padrao_troca WHERE familia IN ('api','proprio') AND ativo = TRUE ORDER BY familia = 'api' DESC, id LIMIT 1",
        [],
      );
      if (!padrao)
        throw recusa([
          {
            campo: 'ponto',
            codigo: 'padrao-troca-nao-cadastrado',
            mensagem: 'O padrão de troca por API não está cadastrado neste cliente.',
          },
        ]);
      ponto = {
        id: await tx.incluir(T_PONTO, {
          estabelecimento_id: est,
          codigo: codigoPonto,
          nome: `${String(par['nome'])} (saida)`.slice(0, 150),
          sistema_externo_id: sistema,
          padrao_troca_id: num(padrao['id']),
          direcao: 'saida',
          transporte: 'http_rest',
          formato_conteudo: 'json',
          ativo: true,
        }),
        ativo: true,
      };
    }
    const conteudo = montarPedidoPrescricaoDigital(pedido);
    const tipo = pedido.evento === EVENTO_PRESCRICAO_DIGITAL_ENVIO ? 'envio' : 'cancelamento';
    return tx.incluir(T_SAIDA, {
      estabelecimento_id: est,
      ponto_integracao_id: num(ponto['id']),
      sistema_externo_id: sistema,
      entidade: T_ENVIO,
      entidade_id: envio,
      chave_idempotencia: `prescricao-digital:${tipo}:${envio}`,
      correlacao: `prescricao-digital.${envio}`.slice(0, 64),
      tipo_mensagem: pedido.evento,
      formato: 'json',
      conteudo,
      hash_sha256: createHash('sha256').update(conteudo).digest('hex'),
      situacao: 'pendente',
      tentativas: 0,
      tentativas_maximas: Math.max(1, num(par['limite_tentativas']) || 5),
    });
  }
}
