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
  conferirCredencialMensageria,
  efeitoDaResposta,
  type EfeitoResposta,
  ENTIDADE_DO_EVENTO,
  EVENTO_DO_GATILHO,
  type EventoMensagem,
  HORIZONTE_VESPERA_MIN,
  PRAZO_AVISO_EVENTO_MIN,
  pedidosDosEventos,
  type RespostaInterpretada,
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
import { ErroOperacao, type TxOperacao } from '@sgh/nucleo';
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
import { lerAutorizacaoBasica, segredoConfere } from './aplicacao/credencial.js';

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
  async gravarModelo(
    c: ContextoComunicacao,
    entrada: unknown,
    alcanceCliente = false,
  ): Promise<{ id: number }> {
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
      'integracao.mensagem.configurar_modelo',
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
        const [a] = await tx.consultarParaAtualizar(
          `SELECT id, versao FROM modelo_mensagem_paciente
          WHERE codigo = ? AND canal = ? AND estabelecimento_id <=> ?`,
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

  async gravarRegra(c: ContextoComunicacao, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaRegraEnvio, entrada);
    return this.gravar(
      c,
      'integracao.mensagem.configurar_regra',
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
        const [a] = await tx.consultarParaAtualizar(
          'SELECT id, versao FROM regra_envio_mensagem_paciente WHERE estabelecimento_id = ? AND codigo = ?',
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
  async pedir(
    c: ContextoComunicacao,
    entrada: unknown,
    agora: Date = new Date(),
  ): Promise<{ id: number; agendadoPara: string }> {
    const x = entradaValida(esquemaPedidoMensagem, entrada);
    return this.gravar(
      c,
      'integracao.mensagem.pedir_envio',
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

  private async pedidoDoEstabelecimento(tx: TxOperacao, id: number, est: number) {
    const [p] = await tx.consultarParaAtualizar(
      `SELECT q.id, q.situacao, q.versao, q.entidade, q.entidade_id, q.canal, m.resposta_confirmacao, m.resposta_recusa
         FROM pedido_mensagem_paciente q LEFT JOIN modelo_mensagem_paciente m ON m.id = q.modelo_mensagem_paciente_id
        WHERE q.id = ? AND q.estabelecimento_id = ? AND q.excluido_em IS NULL`,
      [id, est],
    );
    if (!p) throw naoEncontrado('Pedido de mensagem');
    return p;
  }

  /** Cancela o pedido ainda não enviado (fica registrado, com o motivo). */
  async cancelar(c: ContextoComunicacao, id: number, motivo: string): Promise<{ id: number }> {
    if (!motivo?.trim())
      throw recusa([{ campo: 'motivo', codigo: 'motivo-obrigatorio', mensagem: 'Informe o motivo.' }]);
    return this.gravar(
      c,
      'integracao.mensagem.cancelar_envio',
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
      'integracao.mensagem.marcar_enviado',
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
  async registrarRetorno(
    c: ContextoComunicacao,
    id: number,
    entrada: unknown,
  ): Promise<{
    id: number;
    situacao: SituacaoPedido;
    respostaInterpretada: string | null;
    efeito: EfeitoResposta['acao'] | null;
  }> {
    const x = entradaValida(esquemaRetornoMensagem, entrada);
    return this.gravar(
      c,
      'integracao.mensagem.registrar_retorno',
      [
        'pedido_mensagem_paciente_retorno',
        'pedido_mensagem_paciente',
        'marcacao_horario',
        'confirmacao_marcacao',
      ],
      async (tx, est, usuario) => {
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
        const efeito =
          x.tipo === 'resposta'
            ? await this.aplicarEfeitoNaMarcacao(tx, est, usuario, p, respostaInterpretada, agora)
            : null;
        const retorno = await tx.incluir('pedido_mensagem_paciente_retorno', {
          pedido_mensagem_paciente_id: id,
          sequencia: num(seq?.['s']),
          tipo: x.tipo,
          recebido_em: agora,
          codigo_retorno: x.codigoRetorno,
          descricao: x.descricao,
          resposta_texto: x.respostaTexto,
          resposta_interpretada: respostaInterpretada,
          efeito_resposta: efeito?.acao ?? null,
          confirmacao_marcacao_id: efeito?.confirmacao ?? null,
          origem: 'integracao',
        });
        if (situacao !== atual) {
          const extra: Record<string, unknown> = { situacao };
          if (situacao === 'entregue') extra['entregue_em'] = agora;
          if (situacao === 'lido') extra['lido_em'] = agora;
          await tx.alterar('pedido_mensagem_paciente', id, num(p['versao']), extra);
        }
        return { id: retorno, situacao, respostaInterpretada, efeito: efeito?.acao ?? null };
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

  /**
   * O efeito da resposta interpretada na marcação ligada ao pedido (regra do domínio): confirma a presença da marcação
   * aguardando, ou abre o pedido de cancelamento ou de reagendamento (confirmação recusada, com a observação, para a
   * equipe da agenda); nunca cancela nem remarca sozinha. Na mesma transação do retorno.
   */
  private async aplicarEfeitoNaMarcacao(
    tx: TxOperacao,
    est: number,
    usuario: number,
    pedido: Record<string, unknown>,
    interpretada: RespostaInterpretada | null,
    agora: Date,
  ): Promise<{ acao: EfeitoResposta['acao']; confirmacao: number | null }> {
    const entidade = txtOuNull(pedido['entidade']);
    const marcacaoId = numOuNull(pedido['entidade_id']);
    const [m] =
      entidade === ENTIDADE_DO_EVENTO.marcacao && marcacaoId !== null
        ? await tx.consultarParaAtualizar(
            `SELECT m.id, m.versao, m.canal_marcacao_id, s.significado, h.inicio_em
               FROM marcacao_horario m
               JOIN situacao_marcacao s ON s.id = m.situacao_marcacao_id
               JOIN horario_agenda h ON h.id = m.horario_agenda_id
              WHERE m.id = ? AND m.estabelecimento_id = ? AND m.excluido_em IS NULL`,
            [marcacaoId, est],
          )
        : [];
    const efeito = efeitoDaResposta({
      entidade,
      interpretada,
      significadoMarcacao: m ? String(m['significado']) : null,
      consultaJaPassou: m ? new Date(m['inicio_em'] as string).getTime() <= agora.getTime() : false,
    });
    if (efeito.acao === 'nenhum' || !m) return { acao: efeito.acao, confirmacao: null };
    const significado = efeito.acao === 'confirmar_presenca' ? 'confirmada' : 'recusada';
    const sc = await tx.uma(
      'SELECT id FROM situacao_confirmacao WHERE significado = ? AND ativo ORDER BY ordem, id LIMIT 1',
      [significado],
    );
    if (!sc)
      throw new ErroOperacao(
        422,
        'configuracao-incompleta',
        'Configuração incompleta',
        `Falta a situação de confirmação "${significado}" no cadastro da agenda.`,
      );
    // O canal da confirmação é o da mensagem quando a agenda o tem cadastrado; senão, o canal da marcação.
    const canal = await tx.uma('SELECT id FROM canal_marcacao WHERE codigo = ? AND ativo', [
      String(pedido['canal']),
    ]);
    if (efeito.acao === 'confirmar_presenca') {
      const sm = await tx.uma(
        "SELECT id FROM situacao_marcacao WHERE significado = 'confirmada' AND ativo ORDER BY ordem, id LIMIT 1",
        [],
      );
      if (!sm)
        throw new ErroOperacao(
          422,
          'configuracao-incompleta',
          'Configuração incompleta',
          'Falta a situação de marcação "confirmada" no cadastro da agenda.',
        );
      await tx.alterar('marcacao_horario', num(m['id']), num(m['versao']), {
        situacao_marcacao_id: num(sm['id']),
      });
    }
    const t = await tx.uma(
      'SELECT COALESCE(MAX(tentativa), 0) + 1 AS n FROM confirmacao_marcacao WHERE marcacao_horario_id = ?',
      [m['id']],
    );
    const confirmacao = await tx.incluir('confirmacao_marcacao', {
      estabelecimento_id: est,
      marcacao_horario_id: m['id'],
      tentativa: num(t?.['n'] ?? 1),
      canal_marcacao_id: canal ? canal['id'] : m['canal_marcacao_id'],
      situacao_confirmacao_id: num(sc['id']),
      automatica: true,
      solicitada_em: agora,
      respondida_em: agora,
      responsavel_usuario_id: usuario,
      observacao:
        efeito.acao === 'confirmar_presenca' ? 'Confirmada pelo paciente na mensagem.' : efeito.observacao,
    });
    return { acao: efeito.acao, confirmacao };
  }

  /**
   * O disparo automático pelos eventos (marcação criada, véspera da marcação, resultado liberado, alta): lê as regras
   * ativas de gatilho automático, os eventos do estabelecimento ainda no prazo e os pedidos já feitos, e registra cada
   * pedido novo por `pedir` (cada um na sua transação, com as conferências de destino, consentimento, descadastro e
   * limite). A recusa de um pedido (sem contato, sem consentimento, descadastro) não para os outros: volta contada.
   */
  async dispararEventos(
    c: ContextoComunicacao,
    agora: Date = new Date(),
  ): Promise<{ pedidos: number; recusados: Record<string, number> }> {
    const automaticos = Object.keys(EVENTO_DO_GATILHO);
    const lido = await this.ler(c, 'mensagens.eventos', async (l, est) => {
      const regras = (
        await l.consultar(
          `SELECT r.id, r.gatilho, r.antecedencia_minutos
             FROM regra_envio_mensagem_paciente r
             JOIN modelo_mensagem_paciente m ON m.id = r.modelo_mensagem_paciente_id AND m.ativo
            WHERE r.estabelecimento_id = ? AND r.ativo
              AND r.gatilho IN (${automaticos.map(() => '?').join(',')})`,
          [est, ...automaticos],
        )
      ).map((x) => ({
        id: num(x['id']),
        gatilho: String(x['gatilho']) as GatilhoEnvio,
        antecedenciaMinutos: numOuNull(x['antecedencia_minutos']),
      }));
      if (regras.length === 0) return { regras, eventos: [] as EventoMensagem[], ja: new Set<string>() };
      const tipos = new Set(regras.map((r) => EVENTO_DO_GATILHO[r.gatilho]));
      const desde = new Date(agora.getTime() - PRAZO_AVISO_EVENTO_MIN * 60_000);
      const maxAnt = Math.max(0, ...regras.map((r) => r.antecedenciaMinutos ?? 0));
      const ate = new Date(agora.getTime() + (HORIZONTE_VESPERA_MIN + maxAnt) * 60_000);
      const fuso = await fusoDoEstabelecimento(l, est, agora);
      const local = (d: Date) => new Date(d.getTime() + fuso * 60_000).toISOString();
      const dataHora = (d: Date) => {
        const iso = local(d);
        return { data: iso.slice(0, 10).split('-').reverse().join('/'), hora: iso.slice(11, 16) };
      };
      const eventos: EventoMensagem[] = [];
      if (tipos.has('marcacao'))
        for (const x of await l.consultar(
          `SELECT m.id, m.paciente_id, m.criado_em, h.inicio_em, a.nome AS servico, pf.nome AS paciente_nome
             FROM marcacao_horario m
             JOIN situacao_marcacao s ON s.id = m.situacao_marcacao_id
             JOIN horario_agenda h ON h.id = m.horario_agenda_id
             JOIN agenda_servico a ON a.id = h.agenda_servico_id
             JOIN paciente p ON p.id = m.paciente_id
             JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL AND m.paciente_id IS NOT NULL
              AND s.significado IN ('aguardando', 'confirmada') AND h.inicio_em > ?
              AND (m.criado_em >= ? OR h.inicio_em <= ?)
            ORDER BY h.inicio_em LIMIT 2000`,
          [est, agora, desde, ate],
        )) {
          const inicio = new Date(x['inicio_em'] as string);
          eventos.push({
            tipo: 'marcacao',
            entidadeId: num(x['id']),
            pacienteId: num(x['paciente_id']),
            ocorridoEm: new Date(x['criado_em'] as string),
            referenciaEm: inicio,
            valores: {
              ...dataHora(inicio),
              servico: String(x['servico']),
              paciente_nome: String(x['paciente_nome']),
            },
          });
        }
      if (tipos.has('resultado'))
        for (const x of await l.consultar(
          `SELECT r.id, r.paciente_id, r.liberado_em, x.nome AS servico, pf.nome AS paciente_nome
             FROM resultado_exame r
             JOIN exame_item i ON i.id = r.exame_item_id
             JOIN requisicao_exame q ON q.id = i.requisicao_exame_id
             JOIN exame x ON x.id = i.exame_id
             JOIN paciente p ON p.id = r.paciente_id
             JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE q.estabelecimento_id = ? AND r.situacao = 'liberado' AND r.excluido_em IS NULL
              AND r.liberado_em >= ? AND r.liberado_em <= ?
            ORDER BY r.liberado_em LIMIT 2000`,
          [est, desde, agora],
        )) {
          const em = new Date(x['liberado_em'] as string);
          eventos.push({
            tipo: 'resultado',
            entidadeId: num(x['id']),
            pacienteId: num(x['paciente_id']),
            ocorridoEm: em,
            referenciaEm: null,
            valores: {
              ...dataHora(em),
              servico: String(x['servico']),
              paciente_nome: String(x['paciente_nome']),
            },
          });
        }
      if (tipos.has('alta'))
        for (const x of await l.consultar(
          `SELECT a.id, n.paciente_id, a.alta_em, pf.nome AS paciente_nome
             FROM alta_hospitalar a
             JOIN internacao n ON n.id = a.internacao_id
             JOIN paciente p ON p.id = n.paciente_id
             JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE n.estabelecimento_id = ? AND a.situacao = 'confirmada' AND a.excluido_em IS NULL
              AND a.alta_em >= ? AND a.alta_em <= ?
            ORDER BY a.alta_em LIMIT 2000`,
          [est, desde, agora],
        )) {
          const em = new Date(x['alta_em'] as string);
          eventos.push({
            tipo: 'alta',
            entidadeId: num(x['id']),
            pacienteId: num(x['paciente_id']),
            ocorridoEm: em,
            referenciaEm: null,
            valores: { ...dataHora(em), paciente_nome: String(x['paciente_nome']) },
          });
        }
      const ids = regras.map((r) => r.id);
      const ja = new Set(
        (
          await l.consultar(
            `SELECT regra_envio_mensagem_paciente_id AS r, entidade, entidade_id
               FROM pedido_mensagem_paciente
              WHERE regra_envio_mensagem_paciente_id IN (${ids.map(() => '?').join(',')})
                AND entidade IS NOT NULL AND criado_em >= ?`,
            [...ids, new Date(desde.getTime() - 30 * 86_400_000)],
          )
        ).map((x) => `${num(x['r'])}:${String(x['entidade'])}:${num(x['entidade_id'])}`),
      );
      return { regras, eventos, ja };
    });
    let pedidos = 0;
    const recusados: Record<string, number> = {};
    for (const q of pedidosDosEventos(lido.regras, lido.eventos, lido.ja, agora)) {
      try {
        await this.pedir(
          c,
          {
            regraId: q.regraId,
            pacienteId: q.pacienteId,
            referenciaEm: q.referenciaEm?.toISOString() ?? null,
            valores: q.valores,
            entidade: q.entidade,
            entidadeId: q.entidadeId,
          },
          agora,
        );
        pedidos++;
      } catch (e) {
        const p = (e as { problema?: { status?: number; codigo?: string } }).problema;
        if (!p || (p.status !== 422 && p.status !== 404)) throw e;
        const codigo = p.codigo ?? 'recusado';
        recusados[codigo] = (recusados[codigo] ?? 0) + 1;
      }
    }
    return { pedidos, recusados };
  }

  /**
   * O contexto da Hal-AI pela credencial (Basic cliente:segredo do cliente da API): conferida em tempo constante pelo
   * resumo da chave ativa; tem de ser de um sistema de mensageria ativo, no estabelecimento, com o usuário técnico (autor
   * da trilha) e o escopo das mensagens ao paciente.
   */
  async contextoDaCredencial(hospital: string, autorizacao: unknown): Promise<ContextoComunicacao> {
    const negar = () =>
      new ErroOperacao(401, 'nao-autenticado', 'Credencial inválida', 'Confira o cliente e o segredo.');
    const cred = lerAutorizacaoBasica(autorizacao);
    if (!cred) throw negar();
    const base: ContextoComunicacao = {
      cliente: this.cliente,
      hospital,
      usuario: null,
      correlacao: 'integracao.mensagens.halai',
    };
    const x = await this.ler(base, 'mensagens.credencial', async (l, est) => {
      const r = await l.uma(
        `SELECT ca.situacao, ca.estabelecimento_id, ca.usuario_id, s.codigo AS sistema, s.categoria,
                s.ativo AS sistema_ativo, k.hash_chave,
                (SELECT JSON_ARRAYAGG(ea.codigo) FROM escopo_cliente_api ec
                   JOIN escopo_api ea ON ea.id = ec.escopo_api_id AND ea.ativo
                  WHERE ec.cliente_api_id = ca.id AND ec.excluido_em IS NULL AND ec.vigencia_inicio <= CURRENT_DATE()
                    AND (ec.vigencia_fim IS NULL OR ec.vigencia_fim >= CURRENT_DATE())) AS escopos
           FROM cliente_api ca
           JOIN chave_api k ON k.cliente_api_id = ca.id AND k.situacao = 'ativa' AND k.excluido_em IS NULL
                AND k.valida_desde <= CURRENT_TIMESTAMP(3) AND (k.valida_ate IS NULL OR k.valida_ate > CURRENT_TIMESTAMP(3))
           LEFT JOIN sistema_externo s ON s.id = ca.sistema_externo_id AND s.excluido_em IS NULL
          WHERE ca.identificador_cliente = ? AND ca.excluido_em IS NULL
          ORDER BY k.sequencia DESC LIMIT 1`,
        [cred.clienteId],
      );
      return r ? { r, est } : null;
    });
    if (!x || !segredoConfere(cred.segredo, String(x.r['hash_chave']))) throw negar();
    const erros = conferirCredencialMensageria({
      categoriaSistema: txtOuNull(x.r['categoria']),
      sistemaAtivo: bool(x.r['sistema_ativo']),
      situacaoCliente: String(x.r['situacao']),
      restritoA: numOuNull(x.r['estabelecimento_id']),
      estabelecimento: x.est,
      usuarioTecnico: numOuNull(x.r['usuario_id']),
      escopos: listaEscopos(x.r['escopos']),
    });
    if (erros.length > 0)
      throw new ErroOperacao(
        403,
        erros[0]!.codigo,
        'Credencial recusada',
        erros.map((e) => e.mensagem).join(' '),
      );
    return {
      ...base,
      usuario: num(x.r['usuario_id']),
      correlacao: `halai.${String(x.r['sistema'])}`.slice(0, 64),
    };
  }

  /** Os pedidos pendentes que já chegaram ao momento do envio (a Hal-AI lê, envia e devolve o "enviado"). */
  pendentes(c: ContextoComunicacao, agora: Date = new Date()): Promise<PedidoPendente[]> {
    return this.ler(c, 'mensagens.pendentes', async (l, est) =>
      (
        await l.consultar(
          `SELECT id, canal, destino, assunto, conteudo, agendado_para, motivo_envio
             FROM pedido_mensagem_paciente
            WHERE estabelecimento_id = ? AND situacao = 'pendente' AND excluido_em IS NULL AND agendado_para <= ?
            ORDER BY agendado_para, id LIMIT 500`,
          [est, agora],
        )
      ).map((x) => ({
        id: num(x['id']),
        motivo: String(x['motivo_envio']),
        canal: String(x['canal']) as CanalMensagem,
        destino: String(x['destino']),
        assunto: txtOuNull(x['assunto']),
        conteudo: String(x['conteudo']),
        agendadoPara: dataOuNull(x['agendado_para'])!,
      })),
    );
  }
}

export interface PedidoPendente {
  readonly id: number;
  readonly motivo: string;
  readonly canal: CanalMensagem;
  readonly destino: string;
  readonly assunto: string | null;
  readonly conteudo: string;
  readonly agendadoPara: string;
}

/** A lista de escopos gravada em JSON (o driver devolve texto ou já a lista). */
function listaEscopos(v: unknown): string[] {
  let x: unknown = v;
  if (typeof v === 'string') {
    try {
      x = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return Array.isArray(x) ? x.map(String) : [];
}
