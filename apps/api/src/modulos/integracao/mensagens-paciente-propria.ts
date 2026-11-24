// Porta PRÓPRIA da comunicação com o paciente pela Hal-AI (F3.9, linha 08-INTG L133), sobre o banco do cliente:
//   - modelos (`modelo_mensagem_paciente`) do cliente inteiro ou do estabelecimento, por finalidade e canal;
//   - regras por tipo de aviso (`regra_envio_mensagem_paciente`): gatilho, antecedência, horário, limite, consentimento;
//   - o pedido de envio registrado (`pedido_mensagem_paciente`), com o momento do envio decidido pelo domínio, o texto
//     montado e as conferências de destino, consentimento, descadastro e limite; o pedido nunca é apagado (cancelar
//     só o pendente, com o motivo);
//   - os retornos da Hal-AI (`pedido_mensagem_paciente_retorno`): entrega, leitura, resposta interpretada, falha e
//     descadastro (que bloqueia o canal para o paciente);
//   - a visão por paciente: os pedidos com os retornos.
// O sistema não tem canal próprio (regra 15a): a Hal-AI lê os pendentes e devolve os retornos.
import {
  CANAIS_MENSAGEM,
  type CanalMensagem,
  type ContatoPaciente,
  escolherDestino,
  FINALIDADES_MODELO,
  type FinalidadeModelo,
  GATILHOS_ENVIO,
  type GatilhoEnvio,
  interpretarResposta,
  momentoDoEnvio,
  montarTexto,
  MOTIVO_DO_GATILHO,
  podeCancelarPedido,
  podePedirEnvio,
  situacaoAposRetorno,
  type SituacaoPedido,
  TIPOS_RETORNO,
  validarModeloMensagem,
  validarRegraEnvio,
} from '@sgh/dominio-integracao';
import { ErroOperacao } from '@sgh/nucleo';
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

export const PORTA_MENSAGENS_PACIENTE = Symbol('PORTA_MENSAGENS_PACIENTE');

const hora = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .nullable()
  .default(null);
const data = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .default(null);

export const esquemaModeloMensagem = z
  .object({
    id: z.number().int().positive().nullable().default(null),
    doCliente: z.boolean().default(false),
    codigo: z.string().min(1).max(30),
    descricao: z.string().min(1).max(150),
    finalidade: z.enum(FINALIDADES_MODELO),
    canal: z.enum(CANAIS_MENSAGEM),
    assunto: z.string().max(255).nullable().default(null),
    corpo: z.string().min(1).max(4000),
    respostaConfirmacao: z.string().max(30).nullable().default(null),
    respostaRecusa: z.string().max(30).nullable().default(null),
    antecedenciaHoras: z.number().int().min(0).max(720).nullable().default(null),
    janelaInicio: hora,
    janelaFim: hora,
    vigenciaInicio: data,
    vigenciaFim: data,
    ativo: z.boolean().default(true),
    versao: z.number().int().positive().nullable().default(null),
  })
  .strict();

export const esquemaRegraEnvio = z
  .object({
    id: z.number().int().positive().nullable().default(null),
    codigo: z.string().min(1).max(40),
    descricao: z.string().min(1).max(150),
    modeloId: z.number().int().positive(),
    gatilho: z.enum(GATILHOS_ENVIO),
    antecedenciaMinutos: z.number().int().nullable().default(null),
    horaInicio: hora,
    horaFim: hora,
    maximoEnviosPaciente: z.number().int().nullable().default(null),
    exigeConsentimento: z.boolean().default(true),
    ativo: z.boolean().default(true),
    versao: z.number().int().positive().nullable().default(null),
  })
  .strict();

export const esquemaPedidoMensagem = z
  .object({
    regraId: z.number().int().positive(),
    pacienteId: z.number().int().positive(),
    /** Sem destino: o contato do canal com consentimento, do cadastro do paciente. Com destino: só se for do cadastro. */
    destino: z.string().min(3).max(254).nullable().default(null),
    /** O horário do evento futuro (agendamento); sem ele, o envio é agora ou na próxima abertura do horário. */
    referenciaEm: z.string().datetime({ offset: true }).nullable().default(null),
    valores: z.record(z.string(), z.string().max(200)).default({}),
    entidade: z.string().max(64).nullable().default(null),
    entidadeId: z.number().int().positive().nullable().default(null),
  })
  .strict();

export const esquemaRetornoMensagem = z
  .object({
    tipo: z.enum(TIPOS_RETORNO),
    codigoRetorno: z.string().max(30).nullable().default(null),
    descricao: z.string().max(500).nullable().default(null),
    respostaTexto: z.string().max(2000).nullable().default(null),
  })
  .strict();

export interface ModeloMensagemLido {
  readonly id: number;
  readonly doCliente: boolean;
  readonly codigo: string;
  readonly descricao: string;
  readonly finalidade: FinalidadeModelo;
  readonly canal: CanalMensagem;
  readonly assunto: string | null;
  readonly corpo: string;
  readonly respostaConfirmacao: string | null;
  readonly respostaRecusa: string | null;
  readonly janelaInicio: string | null;
  readonly janelaFim: string | null;
  readonly ativo: boolean;
  readonly versao: number;
}

export interface RegraEnvioLida {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly modeloId: number;
  readonly modelo: string;
  readonly gatilho: GatilhoEnvio;
  readonly canal: CanalMensagem;
  readonly antecedenciaMinutos: number | null;
  readonly horaInicio: string | null;
  readonly horaFim: string | null;
  readonly maximoEnviosPaciente: number | null;
  readonly exigeConsentimento: boolean;
  readonly ativo: boolean;
  readonly versao: number;
}

export interface PedidoMensagemLido {
  readonly id: number;
  readonly motivo: string;
  readonly canal: CanalMensagem;
  readonly regra: string | null;
  readonly situacao: SituacaoPedido;
  readonly agendadoPara: string | null;
  readonly enviadoEm: string | null;
  readonly entregueEm: string | null;
  readonly lidoEm: string | null;
  readonly canceladoEm: string | null;
  readonly motivoCancelamento: string | null;
  readonly retornos: { tipo: string; recebidoEm: string; respostaInterpretada: string | null }[];
}

const hhmm = (v: unknown): string | null => (v === null || v === undefined ? null : String(v).slice(0, 5));

export class PortaMensagensPacientePropria extends BaseComunicacaoPropria {
  modelos(c: ContextoComunicacao): Promise<ModeloMensagemLido[]> {
    return this.ler(c, 'mensagens.modelos', async (l, est) =>
      (
        await l.consultar(
          `SELECT id, estabelecimento_id, codigo, descricao, finalidade, canal, assunto, corpo, resposta_confirmacao,
                  resposta_recusa, janela_envio_inicio, janela_envio_fim, ativo, versao
             FROM modelo_mensagem_paciente
            WHERE estabelecimento_id IS NULL OR estabelecimento_id = ?
            ORDER BY finalidade, canal, descricao LIMIT 500`,
          [est],
        )
      ).map((x) => ({
        id: num(x['id']),
        doCliente: x['estabelecimento_id'] === null,
        codigo: String(x['codigo']),
        descricao: String(x['descricao']),
        finalidade: String(x['finalidade']) as FinalidadeModelo,
        canal: String(x['canal']) as CanalMensagem,
        assunto: txtOuNull(x['assunto']),
        corpo: String(x['corpo']),
        respostaConfirmacao: txtOuNull(x['resposta_confirmacao']),
        respostaRecusa: txtOuNull(x['resposta_recusa']),
        janelaInicio: hhmm(x['janela_envio_inicio']),
        janelaFim: hhmm(x['janela_envio_fim']),
        ativo: bool(x['ativo']),
        versao: num(x['versao']),
      })),
    );
  }

  /**
   * Grava o modelo. O modelo do cliente inteiro (`doCliente`) muda o texto de todos os estabelecimentos: só pela rota
   * de alcance do cliente (`alcanceCliente`, permissão integracao.mensagem.configurarCliente).
   */
  gravarModelo(c: ContextoComunicacao, entrada: unknown, alcanceCliente = false): Promise<{ id: number }> {
    const x = entradaValida(esquemaModeloMensagem, entrada);
    if (x.doCliente && !alcanceCliente)
      throw new ErroOperacao(
        403,
        'alcance-do-cliente',
        'Operação recusada',
        'O modelo do cliente inteiro vale para todos os estabelecimentos: exige a permissão de alcance do cliente.',
      );
    const erros = validarModeloMensagem(x);
    if (erros.length) throw recusa(erros, 'Modelo recusado');
    return this.gravar(
      c,
      'integracao.mensagem.configurarModelo',
      ['modelo_mensagem_paciente'],
      async (tx, est) => {
        const alvo = x.doCliente ? null : est;
        const valores = {
          descricao: x.descricao.trim(),
          finalidade: x.finalidade,
          assunto: x.assunto,
          corpo: x.corpo,
          resposta_confirmacao: x.respostaConfirmacao,
          resposta_recusa: x.respostaRecusa,
          antecedencia_horas: x.antecedenciaHoras,
          janela_envio_inicio: x.janelaInicio,
          janela_envio_fim: x.janelaFim,
          vigencia_inicio: x.vigenciaInicio,
          vigencia_fim: x.vigenciaFim,
          ativo: x.ativo,
        };
        const a = await tx.uma(
          `SELECT id, versao FROM modelo_mensagem_paciente
          WHERE codigo = ? AND canal = ? AND estabelecimento_id <=> ? FOR UPDATE`,
          [x.codigo, x.canal, alvo],
        );
        if (a) {
          if (x.versao === null || x.versao !== num(a['versao']) || (x.id !== null && x.id !== num(a['id'])))
            throw conflito();
          await tx.alterar('modelo_mensagem_paciente', num(a['id']), x.versao, valores);
          return { id: num(a['id']) };
        }
        if (x.id !== null) throw conflito();
        return {
          id: await tx.incluir('modelo_mensagem_paciente', {
            estabelecimento_id: alvo,
            codigo: x.codigo,
            canal: x.canal,
            ...valores,
          }),
        };
      },
    );
  }

  regras(c: ContextoComunicacao): Promise<RegraEnvioLida[]> {
    return this.ler(c, 'mensagens.regras', async (l, est) =>
      (
        await l.consultar(
          `SELECT r.id, r.codigo, r.descricao, r.modelo_mensagem_paciente_id, m.descricao AS modelo, r.gatilho, r.canal,
                  r.antecedencia_minutos, r.hora_envio_inicio, r.hora_envio_fim, r.maximo_envios_paciente,
                  r.exige_consentimento, r.ativo, r.versao
             FROM regra_envio_mensagem_paciente r
             JOIN modelo_mensagem_paciente m ON m.id = r.modelo_mensagem_paciente_id
            WHERE r.estabelecimento_id = ? ORDER BY r.gatilho, r.descricao LIMIT 500`,
          [est],
        )
      ).map((x) => ({
        id: num(x['id']),
        codigo: String(x['codigo']),
        descricao: String(x['descricao']),
        modeloId: num(x['modelo_mensagem_paciente_id']),
        modelo: String(x['modelo']),
        gatilho: String(x['gatilho']) as GatilhoEnvio,
        canal: String(x['canal']) as CanalMensagem,
        antecedenciaMinutos: numOuNull(x['antecedencia_minutos']),
        horaInicio: hhmm(x['hora_envio_inicio']),
        horaFim: hhmm(x['hora_envio_fim']),
        maximoEnviosPaciente: numOuNull(x['maximo_envios_paciente']),
        exigeConsentimento: bool(x['exige_consentimento']),
        ativo: bool(x['ativo']),
        versao: num(x['versao']),
      })),
    );
  }

  gravarRegra(c: ContextoComunicacao, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaRegraEnvio, entrada);
    return this.gravar(
      c,
      'integracao.mensagem.configurarRegra',
      ['regra_envio_mensagem_paciente'],
      async (tx, est) => {
        const m = await tx.uma(
          `SELECT finalidade, canal, ativo FROM modelo_mensagem_paciente
            WHERE id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`,
          [x.modeloId, est],
        );
        if (!m) throw naoEncontrado('Modelo de mensagem');
        const canal = String(m['canal']) as CanalMensagem;
        const erros = validarRegraEnvio(
          { ...x, canal },
          { finalidade: String(m['finalidade']) as FinalidadeModelo, canal, ativo: bool(m['ativo']) },
        );
        if (erros.length) throw recusa(erros, 'Regra recusada');
        const valores = {
          descricao: x.descricao.trim(),
          modelo_mensagem_paciente_id: x.modeloId,
          gatilho: x.gatilho,
          canal,
          antecedencia_minutos: x.antecedenciaMinutos,
          hora_envio_inicio: x.horaInicio,
          hora_envio_fim: x.horaFim,
          maximo_envios_paciente: x.maximoEnviosPaciente,
          exige_consentimento: x.exigeConsentimento,
          ativo: x.ativo,
        };
        const a = await tx.uma(
          'SELECT id, versao FROM regra_envio_mensagem_paciente WHERE estabelecimento_id = ? AND codigo = ? FOR UPDATE',
          [est, x.codigo],
        );
        if (a) {
          if (x.versao === null || x.versao !== num(a['versao'])) throw conflito();
          await tx.alterar('regra_envio_mensagem_paciente', num(a['id']), x.versao, valores);
          return { id: num(a['id']) };
        }
        if (x.id !== null) throw conflito();
        return {
          id: await tx.incluir('regra_envio_mensagem_paciente', {
            estabelecimento_id: est,
            codigo: x.codigo,
            ...valores,
          }),
        };
      },
    );
  }

  /** Registra o pedido de envio pela regra (a Hal-AI envia no momento decidido); recusa o que não confere. */
  pedir(
    c: ContextoComunicacao,
    entrada: unknown,
    agora: Date = new Date(),
  ): Promise<{ id: number; agendadoPara: string }> {
    const x = entradaValida(esquemaPedidoMensagem, entrada);
    return this.gravar(
      c,
      'integracao.mensagem.pedirEnvio',
      ['pedido_mensagem_paciente'],
      async (tx, est, usuario) => {
        const r = await tx.uma(
          `SELECT r.id, r.gatilho, r.canal, r.antecedencia_minutos, r.hora_envio_inicio, r.hora_envio_fim,
                r.maximo_envios_paciente, r.exige_consentimento, r.ativo, m.id AS modelo_id, m.assunto, m.corpo,
                m.ativo AS modelo_ativo, e.nome_fantasia, e.fuso_horario
           FROM regra_envio_mensagem_paciente r
           JOIN modelo_mensagem_paciente m ON m.id = r.modelo_mensagem_paciente_id
           JOIN estabelecimento e ON e.id = r.estabelecimento_id
          WHERE r.id = ? AND r.estabelecimento_id = ?`,
          [x.regraId, est],
        );
        if (!r) throw naoEncontrado('Regra de envio');
        const p = await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [
          x.pacienteId,
        ]);
        if (!p) throw naoEncontrado('Paciente');
        const canal = String(r['canal']) as CanalMensagem;
        // O consentimento conferido é o de COMUNICAÇÃO dado no contato (aceite de mensagem do telefone; aceite de
        // comunicação do e-mail com o termo dele válido), nunca um termo de outra finalidade do paciente.
        const contatos: ContatoPaciente[] = (
          await tx.consultar(
            `SELECT 'telefone' AS tipo,
                    CONCAT(CASE WHEN t.ddi = '55' THEN '' ELSE t.ddi END, COALESCE(t.ddd, ''), t.numero) AS endereco,
                    t.principal, t.aceita_mensagem AS aceita, t.usa_aplicativo_mensagem AS app
               FROM paciente p JOIN telefone_pessoa t ON t.pessoa_fisica_id = p.pessoa_fisica_id AND t.excluido_em IS NULL
              WHERE p.id = ?
             UNION ALL
             SELECT 'email', m.email, m.principal,
                    m.aceita_comunicacao AND (m.consentimento_titular_id IS NULL OR EXISTS (
                      SELECT 1 FROM consentimento_titular k
                       WHERE k.id = m.consentimento_titular_id AND k.situacao = 'autorizado' AND k.revogado_em IS NULL
                         AND k.excluido_em IS NULL AND (k.valido_ate IS NULL OR k.valido_ate >= CURRENT_DATE()))),
                    0
               FROM paciente p JOIN email_pessoa m ON m.pessoa_fisica_id = p.pessoa_fisica_id AND m.excluido_em IS NULL
              WHERE p.id = ?`,
            [x.pacienteId, x.pacienteId],
          )
        ).map((k) => ({
          tipo: (String(k['tipo']) === 'email' ? 'email' : 'telefone') as ContatoPaciente['tipo'],
          endereco: String(k['endereco']),
          principal: bool(k['principal']),
          aceitaComunicacao: bool(k['aceita']),
          usaAplicativo: bool(k['app']),
        }));
        const escolhido = escolherDestino(canal, contatos, x.destino);
        const descadastro = await tx.uma(
          `SELECT COUNT(*) AS n FROM pedido_mensagem_paciente_retorno t
           JOIN pedido_mensagem_paciente q ON q.id = t.pedido_mensagem_paciente_id
          WHERE q.paciente_id = ? AND q.canal = ? AND t.tipo = 'descadastro' AND t.excluido_em IS NULL`,
          [x.pacienteId, canal],
        );
        const envios = await tx.uma(
          `SELECT COUNT(*) AS n FROM pedido_mensagem_paciente
          WHERE regra_envio_mensagem_paciente_id = ? AND paciente_id = ? AND situacao <> 'cancelado'
            AND excluido_em IS NULL`,
          [x.regraId, x.pacienteId],
        );
        const erros = podePedirEnvio({
          canal,
          destino: escolhido.destino,
          destinoNoCadastro: escolhido.noCadastro,
          exigeConsentimento: bool(r['exige_consentimento']),
          temConsentimento: escolhido.consentido,
          descadastradoNoCanal: num(descadastro?.['n']) > 0,
          maximoEnviosPaciente: numOuNull(r['maximo_envios_paciente']),
          enviosDaRegraAoPaciente: num(envios?.['n']),
          regraAtiva: bool(r['ativo']) && bool(r['modelo_ativo']),
        });
        const valores = { estabelecimento: String(r['nome_fantasia']), ...x.valores };
        const corpo = montarTexto(String(r['corpo']), valores);
        const assunto = r['assunto'] === null ? null : montarTexto(String(r['assunto']), valores);
        const faltando = [...new Set([...corpo.faltando, ...(assunto?.faltando ?? [])])];
        if (faltando.length)
          erros.push({
            campo: 'valores',
            codigo: 'variavel-sem-valor',
            mensagem: `Faltam os valores de: ${faltando.join(', ')}.`,
          });
        const momento = momentoDoEnvio({
          referencia: x.referenciaEm ? new Date(x.referenciaEm) : null,
          antecedenciaMinutos: numOuNull(r['antecedencia_minutos']),
          horaInicio: hhmm(r['hora_envio_inicio']),
          horaFim: hhmm(r['hora_envio_fim']),
          agora,
          fusoMinutos: await fusoDoEstabelecimento(tx, est, agora),
        });
        if (!momento)
          erros.push({
            campo: 'referenciaEm',
            codigo: 'fora-do-prazo',
            mensagem: 'Não há mais tempo de avisar antes do evento no horário de envio.',
          });
        if (erros.length) throw recusa(erros, 'Envio recusado');
        const id = await tx.incluir('pedido_mensagem_paciente', {
          estabelecimento_id: est,
          paciente_id: x.pacienteId,
          modelo_mensagem_paciente_id: num(r['modelo_id']),
          regra_envio_mensagem_paciente_id: x.regraId,
          motivo_envio: MOTIVO_DO_GATILHO[String(r['gatilho']) as GatilhoEnvio],
          entidade: x.entidade,
          entidade_id: x.entidadeId,
          canal,
          destino: escolhido.destino!.trim(),
          assunto: assunto?.texto.slice(0, 200) ?? null,
          conteudo: corpo.texto,
          agendado_para: momento,
          situacao: 'pendente',
          solicitante_usuario_id: usuario,
        });
        return { id, agendadoPara: momento!.toISOString() };
      },
    );
  }

  private async pedidoDoEstabelecimento(
    tx: { uma: (s: string, p: unknown[]) => Promise<Record<string, unknown> | null> },
    id: number,
    est: number,
  ) {
    const p = await tx.uma(
      `SELECT q.id, q.situacao, q.versao, m.resposta_confirmacao, m.resposta_recusa
         FROM pedido_mensagem_paciente q LEFT JOIN modelo_mensagem_paciente m ON m.id = q.modelo_mensagem_paciente_id
        WHERE q.id = ? AND q.estabelecimento_id = ? AND q.excluido_em IS NULL FOR UPDATE`,
      [id, est],
    );
    if (!p) throw naoEncontrado('Pedido de mensagem');
    return p;
  }

  /** Cancela o pedido ainda não enviado (fica registrado, com o motivo). */
  cancelar(c: ContextoComunicacao, id: number, motivo: string): Promise<{ id: number }> {
    if (!motivo?.trim())
      throw recusa([{ campo: 'motivo', codigo: 'motivo-obrigatorio', mensagem: 'Informe o motivo.' }]);
    return this.gravar(
      c,
      'integracao.mensagem.cancelarEnvio',
      ['pedido_mensagem_paciente'],
      async (tx, est) => {
        const p = await this.pedidoDoEstabelecimento(tx, id, est);
        if (!podeCancelarPedido(String(p['situacao']) as SituacaoPedido))
          throw new ErroOperacao(
            409,
            'pedido-ja-enviado',
            'Não dá para cancelar',
            'O pedido já foi à Hal-AI; só o pendente é cancelado.',
          );
        await tx.alterar('pedido_mensagem_paciente', id, num(p['versao']), {
          situacao: 'cancelado',
          cancelado_em: new Date(),
          motivo_cancelamento: motivo.trim().slice(0, 500),
        });
        return { id };
      },
    );
  }

  /** A Hal-AI aceitou o pedido: enviado, com o identificador dela. */
  marcarEnviado(c: ContextoComunicacao, id: number, identificadorExterno: string): Promise<{ id: number }> {
    return this.gravar(
      c,
      'integracao.mensagem.marcarEnviado',
      ['pedido_mensagem_paciente'],
      async (tx, est) => {
        const p = await this.pedidoDoEstabelecimento(tx, id, est);
        if (String(p['situacao']) !== 'pendente')
          throw new ErroOperacao(
            409,
            'pedido-nao-pendente',
            'Situação mudou',
            'O pedido não está mais pendente.',
          );
        await tx.alterar('pedido_mensagem_paciente', id, num(p['versao']), {
          situacao: 'enviado',
          enviado_em: new Date(),
          identificador_externo: identificadorExterno.trim().slice(0, 120) || null,
        });
        return { id };
      },
    );
  }

  /** Retorno da Hal-AI: grava o retorno em sequência e avança a situação pela regra do domínio. */
  registrarRetorno(
    c: ContextoComunicacao,
    id: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: SituacaoPedido; respostaInterpretada: string | null }> {
    const x = entradaValida(esquemaRetornoMensagem, entrada);
    return this.gravar(
      c,
      'integracao.mensagem.registrarRetorno',
      ['pedido_mensagem_paciente_retorno', 'pedido_mensagem_paciente'],
      async (tx, est) => {
        const p = await this.pedidoDoEstabelecimento(tx, id, est);
        const atual = String(p['situacao']) as SituacaoPedido;
        const { situacao } = situacaoAposRetorno(atual, x.tipo);
        const respostaInterpretada =
          x.tipo === 'resposta' && x.respostaTexto
            ? interpretarResposta(
                x.respostaTexto,
                txtOuNull(p['resposta_confirmacao']),
                txtOuNull(p['resposta_recusa']),
              )
            : null;
        const seq = await tx.uma(
          'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM pedido_mensagem_paciente_retorno WHERE pedido_mensagem_paciente_id = ?',
          [id],
        );
        const agora = new Date();
        const retorno = await tx.incluir('pedido_mensagem_paciente_retorno', {
          pedido_mensagem_paciente_id: id,
          sequencia: num(seq?.['s']),
          tipo: x.tipo,
          recebido_em: agora,
          codigo_retorno: x.codigoRetorno,
          descricao: x.descricao,
          resposta_texto: x.respostaTexto,
          resposta_interpretada: respostaInterpretada,
          origem: 'integracao',
        });
        if (situacao !== atual) {
          const extra: Record<string, unknown> = { situacao };
          if (situacao === 'entregue') extra['entregue_em'] = agora;
          if (situacao === 'lido') extra['lido_em'] = agora;
          await tx.alterar('pedido_mensagem_paciente', id, num(p['versao']), extra);
        }
        return { id: retorno, situacao, respostaInterpretada };
      },
    );
  }

  /** A visão por paciente: os pedidos do estabelecimento com os retornos (mais novos primeiro). */
  doPaciente(c: ContextoComunicacao, paciente: number): Promise<PedidoMensagemLido[]> {
    return this.ler(c, 'mensagens.paciente', async (l, est) => {
      const ped = await l.consultar(
        `SELECT q.id, q.motivo_envio, q.canal, r.descricao AS regra, q.situacao, q.agendado_para, q.enviado_em,
                q.entregue_em, q.lido_em, q.cancelado_em, q.motivo_cancelamento
           FROM pedido_mensagem_paciente q
           LEFT JOIN regra_envio_mensagem_paciente r ON r.id = q.regra_envio_mensagem_paciente_id
          WHERE q.paciente_id = ? AND q.estabelecimento_id = ? AND q.excluido_em IS NULL
          ORDER BY q.criado_em DESC, q.id DESC LIMIT 200`,
        [paciente, est],
      );
      const ids = ped.map((x) => num(x['id']));
      const ret = ids.length
        ? await l.consultar(
            `SELECT pedido_mensagem_paciente_id AS p, tipo, recebido_em, resposta_interpretada
               FROM pedido_mensagem_paciente_retorno
              WHERE pedido_mensagem_paciente_id IN (${ids.map(() => '?').join(',')}) AND excluido_em IS NULL
              ORDER BY sequencia`,
            ids,
          )
        : [];
      return ped.map((x) => ({
        id: num(x['id']),
        motivo: String(x['motivo_envio']),
        canal: String(x['canal']) as CanalMensagem,
        regra: txtOuNull(x['regra']),
        situacao: String(x['situacao']) as SituacaoPedido,
        agendadoPara: dataOuNull(x['agendado_para']),
        enviadoEm: dataOuNull(x['enviado_em']),
        entregueEm: dataOuNull(x['entregue_em']),
        lidoEm: dataOuNull(x['lido_em']),
        canceladoEm: dataOuNull(x['cancelado_em']),
        motivoCancelamento: txtOuNull(x['motivo_cancelamento']),
        retornos: ret
          .filter((t) => num(t['p']) === num(x['id']))
          .map((t) => ({
            tipo: String(t['tipo']),
            recebidoEm: dataOuNull(t['recebido_em'])!,
            respostaInterpretada: txtOuNull(t['resposta_interpretada']),
          })),
      }));
    });
  }
}
