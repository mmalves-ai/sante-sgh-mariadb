// Enviadores das integrações novas (M34; ficha, regras 12 a 15; cap-12 §12.3): o conteúdo de cada evento e a entrega
// pelo tipo do parceiro — HL7 v2 (laboratório de apoio, classificação externa) por MLLP ao canal do motor de
// integração (o ACK AA aceita; AE/AR é falha com o motivo), FHIR R4 ao simulador ou à homologação da RNDS, e a API do
// parceiro (JSON por HTTP). Fora de produção, só destino em loopback (simuladores e o motor local): nenhuma mensagem a
// paciente, convênio, laboratório ou banco externo real (regra 15). O conteúdo nunca vai ao log.
// Leituras pela porta própria (o exame pedido, o item da lista de trabalho e a vacina com as retificações).
// Melhoria: o pedido ao apoio sai com o exame no código do laboratório (de-para) ou é recusado com o motivo; o exame
// cancelado ou recusado não vai à modalidade nem ao laboratório de apoio; a vacina vai na versão do evento a partir do
// próprio registro; as horas locais saem no fuso do estabelecimento; o parceiro HL7 só recebe a mensagem de teste no
// evento de teste (um evento sem mensagem HL7 definida é recusado com o motivo, nunca vira uma ADT de teste).
import { connect } from 'node:net';
import { EVENTO_OUTBOX_MWL } from '@sgh/contratos';
import {
  canalOie,
  dataHl7,
  deMllp,
  destinoRia,
  documentoRia,
  emMllp,
  EVENTO_ENVIO_PERFIS_TRIAGEM,
  eventoDocumentoRnds,
  eventoRia,
  imunizacaoDoRegistro,
  lerAck,
  montarPedidoApoio,
  motivoDaRecusaRnds,
  reciboDaRnds,
} from '@sgh/dominio-integracao';
import { itemMwlDicom } from '@sgh/dominio-sadt';
import { destinoDaWorklistNoEstabelecimento } from './destino-worklist.js';
import { conteudoPerfisTriagem } from './perfis-triagem.js';
import { ehEventoPrescricaoDigital, entregarPrescricaoDigital } from './prescricao-digital.js';
import {
  dadosEnvioVacina,
  enviarDocumentoRnds,
  garantirEnvioRnds,
  postarERegistrar,
} from './rnds-registro.js';
import type { Leitor, TxOperacao } from '@sgh/nucleo';
import { ErroEntrega, type Enviador } from './entrega.js';
import {
  type EnvioEntrega,
  examePedido,
  horaLocal,
  itemListaTrabalho,
  type ParceiroEntrega,
  vacinaNaVersao,
  vacinaParaRia,
} from './porta-propria.js';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Fora de produção, só loopback (a trava de saídas do M01 garante também no processo). */
export function destinoPermitido(ambiente: string, host: string): boolean {
  return ambiente === 'producao' || LOOPBACK.has(host);
}

/** Envia uma mensagem por MLLP e devolve o ACK (o primeiro quadro completo). */
export function enviarMllp(host: string, porta: number, mensagem: string, tempoMs = 10_000): Promise<string> {
  return new Promise((ok, falha) => {
    const s = connect({ host, port: porta });
    let buf: Uint8Array = new Uint8Array(0);
    const t = setTimeout(() => {
      s.destroy();
      falha(new ErroEntrega('tempo esgotado esperando o ACK', mensagem));
    }, tempoMs);
    t.unref();
    s.on('connect', () => s.write(emMllp(mensagem)));
    s.on('data', (d: Buffer) => {
      const junto = new Uint8Array(buf.length + d.length);
      junto.set(buf);
      junto.set(d, buf.length);
      const r = deMllp(junto);
      buf = r.resto;
      if (r.mensagens[0]) {
        clearTimeout(t);
        s.end();
        ok(r.mensagens[0]);
      }
    });
    s.on('error', (e) => {
      clearTimeout(t);
      falha(new ErroEntrega(`conexão recusada (${e.name})`, mensagem));
    });
  });
}

export interface ConfiguracaoEnviadores {
  readonly ambiente: string;
  readonly produto: string;
  readonly hostMllp: string;
  readonly simuladorRnds: string | null;
  readonly destinoApi: (codigo: string) => string | null;
  readonly ler: <T>(hospital: string, fn: (l: Leitor) => Promise<T>) => Promise<T>;
  readonly agora: () => Date;
  /** F8 (08-INTG L132): a gravação do retorno da prescrição digital no envio (operação do executor). */
  readonly gravar?: <T>(
    hospital: string,
    fn: (tx: TxOperacao) => Promise<T>,
    opcoes: { readonly operacao: string; readonly tabelas: readonly string[] },
  ) => Promise<T>;
  /** F8 (08-INTG L132): o documento assinado da receita lido do armazém de arquivos (anexado na entrega). */
  readonly lerArquivo?: (
    hospital: string,
    id: number,
  ) => Promise<{ readonly conteudo: Uint8Array; readonly tipoMime: string; readonly hash: string }>;
  /** A porta MLLP do canal no motor (padrão: a do canal versionado; o teste usa a do contêiner descartável). */
  readonly portaDoCanal?: (canal: string) => number;
  /**
   * W0-03 (M6): o parâmetro de credencial da RNDS. A homologação só com ela autorizada; fora do simulador, só com a
   * credencial (o certificado ICP-Brasil do estabelecimento) e o envio pelo cliente com o certificado. Em dev e ci o
   * destino é SEMPRE o simulador local, com ou sem credencial.
   */
  readonly rnds?: {
    readonly homologacaoAutorizada: boolean;
    readonly credencial: boolean;
    /** O envio com o certificado (token no ehr-auth e o POST ao EHR); ausente, nada sai fora do simulador. */
    readonly enviarComCertificado?: (
      d: { readonly url: string; readonly autenticacao: string },
      conteudo: string,
    ) => Promise<{ status: number; corpo: string; location: string | null }>;
  };
}

/** MSH-10 curto e único do envio (até 20 caracteres). */
const controle = (e: EnvioEntrega) => `SGH${e.id}`.slice(0, 20);

/** O conteúdo HL7 do evento (o pedido ao apoio com o exame no código do laboratório; o teste sem paciente). */
export async function conteudoHl7(
  c: ConfiguracaoEnviadores,
  p: ParceiroEntrega,
  e: EnvioEntrega,
  hospital: string,
): Promise<string> {
  const cab = {
    aplicacaoOrigem: c.produto.replace(/[^A-Za-z0-9 -]/g, '').slice(0, 20) || 'SGH',
    instituicaoOrigem: hospital.toUpperCase(),
    aplicacaoDestino: p.codigo.toUpperCase().slice(0, 20),
    instituicaoDestino: p.codigo.toUpperCase().slice(0, 20),
    dataHora: c.agora(),
    controle: controle(e),
    processamento: (c.ambiente === 'producao' ? 'P' : 'T') as 'P' | 'T',
  };
  if (e.tipoEvento === 'fato.exame.apoio' && e.objeto) {
    const x = await c.ler(hospital, (l) => examePedido(l, hospital, Number(e.objeto)));
    if (!x) throw new ErroEntrega('exame do evento não encontrado');
    // O exame cancelado ou recusado depois de entrar na remessa não vai ao laboratório (que executaria e cobraria).
    if (x.cancelado)
      throw new ErroEntrega('exame cancelado no prontuário: nada enviado ao laboratório de apoio');
    if (!x.apoio) throw new ErroEntrega('exame sem o código do laboratório de apoio (de-para): nada enviado');
    return montarPedidoApoio({
      cabecalho: cab,
      paciente: {
        id: x.paciente.id,
        prontuario: x.paciente.prontuario,
        nome: x.paciente.nome,
        nascimento: x.paciente.nascimento ? new Date(`${x.paciente.nascimento}T00:00:00Z`) : null,
        sexo: x.paciente.sexo,
      },
      atendimento: { numero: x.atendimento, classe: 'O' },
      pedido: x.id,
      exame: { codigo: x.apoio.codigo, nome: x.apoio.nome ?? x.exame.nome, material: x.apoio.material },
      solicitadoEm: x.solicitadoEm ?? c.agora(),
      urgente: x.urgente,
    });
  }
  // F3.9 (L140): os perfis de prioridade ao sistema de triagem, exatamente como gravados na fila pela API.
  if (e.tipoEvento === EVENTO_ENVIO_PERFIS_TRIAGEM) {
    const m = await c.ler(hospital, (l) => conteudoPerfisTriagem(l, hospital, e.id));
    if (!m) throw new ErroEntrega('envio de perfis sem a mensagem HL7 gravada: nada enviado');
    return m;
  }
  if (e.tipoEvento !== 'integracao.teste')
    throw new ErroEntrega(
      `evento ${e.tipoEvento.slice(0, 60)} sem mensagem HL7 definida para o parceiro: nada enviado`,
    );
  // A mensagem de teste (sem paciente): só o cabeçalho e o evento.
  return [
    `MSH|^~\\&|${cab.aplicacaoOrigem}|${cab.instituicaoOrigem}|${cab.aplicacaoDestino}|${cab.instituicaoDestino}|${dataHl7(cab.dataHora)}||ADT^A08^ADT_A01|${cab.controle}|T|2.5`,
    `EVN|A08|${dataHl7(cab.dataHora)}`,
  ].join('\r');
}

/**
 * M47 (etapa 3): o item da lista de trabalho DICOM (JSON do DICOM, PS3.18 F.2) do exame do evento, com o número de
 * acesso do item (o mesmo em todo reenvio: o destino atualiza, não duplica). Lido na hora do envio (o paciente e o
 * exame como estão agora); o conteúdo nunca vai ao log.
 */
export async function conteudoMwl(
  c: ConfiguracaoEnviadores,
  e: EnvioEntrega,
  hospital: string,
  parceiro: string,
): Promise<{ conteudo: string; accession: string }> {
  const exame = Number(e.objeto);
  if (!Number.isInteger(exame) || exame <= 0)
    throw new ErroEntrega('evento da lista de trabalho sem o exame');
  const lido = await c.ler(hospital, async (l) => ({
    item: await itemListaTrabalho(l, hospital, exame),
    exame: await examePedido(l, hospital, exame),
    destino: await destinoDaWorklistNoEstabelecimento(l, hospital, c.agora()),
  }));
  // Sem chave de liberação (05-SADT linha 20): o envio existe porque o parceiro é o destino configurado no
  // estabelecimento da mensagem (ativo e com o evento). Outro parceiro, ou o destino retirado, nada envia.
  if (lido.destino !== parceiro)
    throw new ErroEntrega(
      'o parceiro não é o destino da lista de trabalho deste estabelecimento: nada enviado',
    );
  if (!lido.item || !lido.exame) throw new ErroEntrega('item da lista de trabalho não encontrado');
  // O exame cancelado ou recusado depois de virar item não volta à modalidade como procedimento agendado.
  if (lido.exame.cancelado) throw new ErroEntrega('exame cancelado no prontuário: nada enviado');
  const x = lido.exame;
  const modalidade = lido.item.modalidade ?? x.modalidade;
  if (!modalidade) throw new ErroEntrega('item da lista de trabalho sem modalidade: nada enviado');
  const item = itemMwlDicom({
    accession: lido.item.accession,
    hospital,
    modalidade,
    estacao: modalidade,
    paciente: {
      id: x.paciente.prontuario,
      nome: x.paciente.nome,
      nascimento: x.paciente.nascimento,
      sexo: x.paciente.sexo,
    },
    exame: { codigo: x.exame.codigo, nome: x.exame.nome },
    agendadoPara: horaLocal(x.agendadoPara ?? c.agora(), x.fuso),
    urgente: x.urgente,
    solicitante: x.solicitante,
  });
  return { conteudo: JSON.stringify(item), accession: lido.item.accession };
}

/**
 * W0-03 (M6): o RIA da vacina à RNDS. O documento é montado na hora do envio, da versão do evento (o registro local
 * nunca muda; a substituição leva a versão retificada e o cancelamento a que valia antes do estorno). O destino sai do
 * ambiente e do parâmetro de credencial (dev e ci: SEMPRE o simulador local; nenhuma chamada à RNDS). A recusa da RNDS
 * vira a resposta curta do envio (o monitor de recusas mostra); o conteúdo nunca vai ao log.
 */
export async function enviarRia(
  c: ConfiguracaoEnviadores,
  e: EnvioEntrega,
  hospital: string,
): Promise<{ recibo: string | null; resposta: string; conteudo: string }> {
  const [idVacina, idVersao] = (e.objeto ?? '').split('.');
  const vacina = Number(idVacina);
  const versao = Number(idVersao ?? 0);
  if (!Number.isInteger(vacina) || vacina <= 0 || !Number.isInteger(versao) || versao < 0)
    throw new ErroEntrega('evento do RIA sem a vacina');
  const destino = (() => {
    try {
      return destinoRia({
        ambiente: c.ambiente,
        homologacaoAutorizada: c.rnds?.homologacaoAutorizada ?? false,
        credencial: c.rnds?.credencial ?? false,
        simulador: c.simuladorRnds,
      });
    } catch (x) {
      throw new ErroEntrega(x instanceof Error ? x.message.slice(0, 200) : 'destino da RNDS indisponível');
    }
  })();
  const lido = await c.ler(hospital, (l) => vacinaParaRia(l, hospital, vacina));
  if (!lido) throw new ErroEntrega('vacina do evento não encontrada');
  // O cancelamento leva a versão que valia antes do estorno; a substituição, a versão retificada.
  const v = vacinaNaVersao(lido, e.tipoEvento === 'fato.vacina.cancelada' ? versao - 1 : versao);
  const imunizacao = imunizacaoDoRegistro(v, {
    hospital,
    paciente: lido.paciente,
    vacinador: v.vacinador,
  });
  const conteudo = JSON.stringify(
    documentoRia({
      evento: e.tipoEvento as Parameters<typeof documentoRia>[0]['evento'],
      hospital,
      vacina,
      versao,
      imunizacao,
      emitidoEm: c.agora(),
    }),
  );
  // C2-085: com a gravação configurada (o worker sempre a tem), o envio e a versão ficam em envio_rnds e
  // envio_rnds_versao com a resposta (aceita, recusada ou a falha de transporte).
  if (c.gravar)
    return postarERegistrar(c, hospital, conteudo, `${hospital}-ria-${vacina}-v${versao}`, async (tx) => ({
      envio: await garantirEnvioRnds(
        tx,
        dadosEnvioVacina(hospital, e.tipoEvento, versao, vacina, lido.paciente, v.vacinador),
        c.agora(),
      ),
      numero: versao + 1,
    }));
  let r: { status: number; corpo: string; location: string | null };
  if (!destino.certificado) {
    const u = new URL(destino.url);
    if (!LOOPBACK.has(u.hostname))
      throw new ErroEntrega('simulador da RNDS fora do loopback: nada enviado', conteudo);
    const h = await fetch(destino.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/fhir+json',
        'idempotency-key': `${hospital}-ria-${vacina}-v${versao}`,
      },
      body: conteudo,
      signal: AbortSignal.timeout(10_000),
    }).catch((x: unknown) => {
      throw new ErroEntrega(
        `simulador da RNDS indisponível (${x instanceof Error ? x.name : 'erro'})`,
        conteudo,
      );
    });
    r = { status: h.status, corpo: await h.text().catch(() => ''), location: h.headers.get('location') };
  } else {
    const enviar = c.rnds?.enviarComCertificado;
    if (!enviar || !destino.autenticacao)
      throw new ErroEntrega('cliente com o certificado da RNDS não configurado: nada enviado', conteudo);
    r = await enviar({ url: destino.url, autenticacao: destino.autenticacao }, conteudo).catch(
      (x: unknown) => {
        throw new ErroEntrega(`RNDS indisponível (${x instanceof Error ? x.name : 'erro'})`, conteudo);
      },
    );
  }
  if (r.status < 200 || r.status >= 300)
    throw new ErroEntrega(motivoDaRecusaRnds(r.status, r.corpo), conteudo);
  return {
    recibo: reciboDaRnds(r.location, r.corpo) ?? `HTTP ${r.status}`,
    resposta: `HTTP ${r.status} (${destino.ambiente})`,
    conteudo,
  };
}

export function criarEnviador(c: ConfiguracaoEnviadores): Enviador {
  return async (p, e, hospital) => {
    // W0-03 (M6): o RIA (aplicação, substituição e cancelamento) ao parceiro FHIR da RNDS.
    if (p.tipo === 'fhir' && eventoRia(e.tipoEvento)) return enviarRia(c, e, hospital);
    // C2-085 (08-INTG L130): o sumário de alta e o resultado de exame (o envio posto na fila pela API).
    if (p.tipo === 'fhir' && eventoDocumentoRnds(e.tipoEvento)) return enviarDocumentoRnds(c, e, hospital);
    // F8 (08-INTG L132): a receita à plataforma de prescrição digital (simulador fora de produção) e o retorno.
    if (p.tipo === 'api' && ehEventoPrescricaoDigital(e.tipoEvento))
      return entregarPrescricaoDigital(c, p, e, hospital);
    if (p.tipo === 'hl7' || p.tipo === 'apoio') {
      const canal = p.canal ? canalOie(p.canal) : undefined;
      if (!canal) throw new ErroEntrega('parceiro sem canal do motor de integração');
      if (!destinoPermitido(c.ambiente, c.hostMllp))
        throw new ErroEntrega('destino fora do loopback fora de produção');
      const conteudo = await conteudoHl7(c, p, e, hospital);
      const porta = c.portaDoCanal?.(canal.canal) ?? canal.portaMllp;
      const ack = lerAck(await enviarMllp(c.hostMllp, porta, conteudo));
      if (ack.codigo !== 'AA' && ack.codigo !== 'CA')
        throw new ErroEntrega(`${ack.codigo}: ${ack.texto}`.slice(0, 200), conteudo);
      return { recibo: `${ack.codigo}-${ack.controle}`.slice(0, 120), resposta: ack.codigo, conteudo };
    }
    const destino = p.tipo === 'fhir' ? c.simuladorRnds : c.destinoApi(p.codigo);
    if (!destino) throw new ErroEntrega('parceiro sem destino configurado');
    const u = new URL(destino);
    if (!destinoPermitido(c.ambiente, u.hostname))
      throw new ErroEntrega('destino fora do loopback fora de produção');
    // M47 (etapa 3): o item da lista de trabalho vai como JSON do DICOM, com o número de acesso como chave de idempotência.
    const mwl = e.tipoEvento === EVENTO_OUTBOX_MWL ? await conteudoMwl(c, e, hospital, p.codigo) : null;
    const conteudo =
      mwl?.conteudo ??
      JSON.stringify({
        evento: e.tipoEvento,
        chave: e.chaveEvento,
        estabelecimento: hospital,
        objeto: e.objeto,
        ordem: e.chaveOrdem,
      });
    const r = await fetch(destino, {
      method: 'POST',
      headers: {
        'content-type': mwl ? 'application/dicom+json' : 'application/json',
        'idempotency-key': (mwl ? `${hospital}-${mwl.accession}` : e.chaveEvento).slice(0, 120),
      },
      body: conteudo,
      signal: AbortSignal.timeout(10_000),
    }).catch((x: unknown) => {
      throw new ErroEntrega(`destino indisponível (${x instanceof Error ? x.name : 'erro'})`, conteudo);
    });
    if (!r.ok) throw new ErroEntrega(`HTTP ${r.status}`, conteudo);
    const recibo = r.headers.get('x-recibo') ?? r.headers.get('location');
    return { recibo: recibo?.slice(0, 120) ?? `HTTP ${r.status}`, resposta: `HTTP ${r.status}`, conteudo };
  };
}
