// Serviço do atendimento ao beneficiário com protocolo e das contas do portal do prestador (M56, etapa 8, F7): as
// conferências que dependem do banco (operadora, origem do atendimento, beneficiário pela carteirinha, pedido de
// autorização ligado, protocolo de origem da reanálise, prestador e domínios do portal) sobre as regras puras de
// @sgh/dominio-operadora, a ficha com as ações que valem agora e o texto da resposta por escrito. As gravações ficam no
// controlador (a porta grava com a trilha na mesma transação).
import { createHash, randomInt } from 'node:crypto';
import {
  type AcessoPortalPrestador,
  type AcessosPortalPrestador,
  type ApoioProtocolos,
  type CriarAcessoPortalEntrada,
  MENSAGENS_ATENDIMENTO,
  ORIGENS_ATENDIMENTO_OPERADORA,
  type ProtocoloDetalhe,
  type ProtocoloOpeResumo,
  type RegistrarProtocoloOpeEntrada,
} from '@sgh/contratos';
import {
  acoesDoProtocolo,
  classeDaNatureza,
  conferirFuncoesPortal,
  conferirOrigemDaReanalise,
  conferirRegistroProtocolo,
  funcoesDoTexto,
  PARAMETROS_PROTOCOLO,
  prazoDoProtocolo,
  prazoVigente,
  type Problema,
  type ProtocoloParaAcoes,
  prorrogavelAte,
  recusaDaAcao,
  textoDaRespostaEscrita,
} from '@sgh/dominio-operadora';
import { type DadosAcessoPortalPrestador, type DadosOperadora, type DadosProtocolo, type DadosProtocoloResumo, type EntradaRegistroProtocolo } from './dados-portas.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoAtendimento, PortaAtendimentoOperadora } from './atendimento-porta.js';
import type { PortaAutorizacaoOperadora } from './autorizacao-porta.js';

type AcaoProtocolo = ProtocoloDetalhe['acoes'][number];

/** Letras e números sem os que se confundem (0/O, 1/I/L). */
const ALFABETO_ATIVACAO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');
/** O código de ativação de uso único (12 caracteres; só o resumo SHA-256 vai ao banco). */
export function codigoDeAtivacao(): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += ALFABETO_ATIVACAO[randomInt(ALFABETO_ATIVACAO.length)];
  return s;
}

/** O rótulo da situação da guia (as situações da autorização da F4). */
export function rotuloDaGuia(situacao: string): string {
  const r: Readonly<Record<string, string>> = {
    'em-analise': 'Em análise',
    pendente: 'Aguardando complemento',
    'em-junta': 'Em junta',
    autorizada: 'Autorizada',
    parcial: 'Autorizada em parte',
    negada: 'Negada',
    cancelada: 'Cancelada',
  };
  return r[situacao] ?? situacao;
}

export function recusaDoAtendimento(problemas: readonly Problema[]): ErroProblema {
  const [p] = problemas;
  return new ErroProblema(
    'recusa-de-negocio',
    409,
    'Operação recusada',
    [...new Set(problemas.map((x) => MENSAGENS_ATENDIMENTO[x.codigo] ?? x.codigo))].join(' '),
    {
      codigo: p?.codigo ?? 'recusa',
      campos: [...new Set(problemas.map((x) => x.campo).filter((c): c is string => !!c))],
      bloqueios: problemas.map((x) => x.codigo),
    },
  );
}

const naoEncontrado = () =>
  new ErroProblema(
    'nao-encontrado',
    404,
    'Protocolo não encontrado',
    'O protocolo não está nesta operadora.',
  );
const acessoNaoEncontrado = () =>
  new ErroProblema(
    'nao-encontrado',
    404,
    'Acesso não encontrado',
    'O acesso ao portal não está nesta operadora.',
  );

const dataBr = (d: string) => d.slice(0, 10).split('-').reverse().join('/');
const quando = (d: string) => `${dataBr(d)} ${d.slice(11, 16)}`;

/** O resumo da lista (as escolhas fechadas do banco vêm como texto: a tela recebe só os valores do contrato). */
export function resumoDoProtocolo(p: DadosProtocoloResumo): ProtocoloOpeResumo {
  return {
    id: p.id,
    protocolo: p.protocolo,
    instancia: p.instancia as ProtocoloOpeResumo['instancia'],
    natureza: p.natureza as ProtocoloOpeResumo['natureza'],
    classe: p.classe as ProtocoloOpeResumo['classe'],
    canal: p.canal as ProtocoloOpeResumo['canal'],
    beneficiarioNome: p.beneficiarioNome,
    carteirinha: p.carteirinha,
    assunto: p.assunto,
    situacao: p.situacao,
    abertoEm: p.abertoEm,
    prazoEm: prazoVigente(p),
    vencido: p.vencido,
    escritaPendente: p.escritaPedida && !p.escritaEnviadaEm,
    escritaVencida: p.escritaVencida,
    versao: p.versao,
  };
}

export const acessoDe = (a: DadosAcessoPortalPrestador): AcessoPortalPrestador => ({
  id: a.id,
  operadora: a.operadora,
  prestador: a.prestador,
  prestadorNome: a.prestadorNome,
  login: a.login,
  nome: a.nome,
  funcoes: funcoesDoTexto(a.funcoes),
  tipoAtendimento: a.tipoAtendimento,
  situacao: a.situacao,
  ativacaoValidaAte: a.ativacaoValidaAte,
  bloqueadoAte: a.bloqueadoAte,
  ultimoAcessoEm: a.ultimoAcessoEm,
  motivoEncerramento: a.motivoEncerramento,
  versao: a.versao,
});

export interface RegistroConferido {
  readonly registroAns: string;
  /** O registro sem o número (montado na transação com a sequência) nem o usuário. */
  readonly registro: Omit<EntradaRegistroProtocolo, 'hospital' | 'protocolo' | 'usuario'>;
}

export class ServicoAtendimentoOperadora {
  constructor(
    readonly porta: PortaAtendimentoOperadora,
    readonly autorizacoes: Pick<PortaAutorizacaoOperadora, 'autorizacao'>,
  ) {}

  async apoio(
    c: ContextoAtendimento,
    x: { ligada: boolean; motivo: string | null; podeRegistrar: boolean },
  ): Promise<ApoioProtocolos> {
    // Com a fatia desligada, nada da operadora é lido (só os domínios do estabelecimento; D-LEITURA-56).
    const [dominios, operadoras, relogio] = await Promise.all([
      this.porta.dominios(c),
      x.ligada ? this.porta.operadoras(c) : Promise.resolve([]),
      this.porta.relogio(c),
    ]);
    return {
      dominios: {
        origem: dominios.origem.map((o) => ({
          codigo: o.id,
          rotulo:
            ORIGENS_ATENDIMENTO_OPERADORA[o.id as keyof typeof ORIGENS_ATENDIMENTO_OPERADORA] ?? o.rotulo,
        })),
      },
      operadoras: operadoras
        .filter((o) => o.situacao === 'ativa')
        .map((o) => ({ id: o.id, nome: o.nomeFantasia ?? o.razaoSocial, registroAns: o.registroAns })),
      ligada: x.ligada,
      motivo: x.motivo,
      podeRegistrar: x.podeRegistrar && x.ligada,
      hoje: relogio.hoje,
      parametros: { ...PARAMETROS_PROTOCOLO },
    };
  }

  private async operadora(c: ContextoAtendimento, id: number): Promise<DadosOperadora> {
    const o = (await this.porta.operadoras(c)).find((x) => x.id === id);
    if (!o) throw recusaDoAtendimento([{ codigo: 'operadora-inexistente', campo: 'operadora' }]);
    if (o.situacao !== 'ativa')
      throw recusaDoAtendimento([{ codigo: 'operadora-inativa', campo: 'operadora' }]);
    return o;
  }

  /**
   * Confere o registro (regras puras, depois o banco) e monta a linha com o prazo pelo relógio do banco. `prestador` é
   * o do portal (a sessão dá o prestador; nunca a tela).
   */
  async conferirRegistro(
    c: ContextoAtendimento,
    e: RegistrarProtocoloOpeEntrada,
    extra: { prestador?: number } = {},
  ): Promise<RegistroConferido> {
    const problemas = conferirRegistroProtocolo({
      instancia: e.instancia,
      natureza: e.natureza,
      canal: e.canal,
      solicitante: e.solicitante,
      carteirinha: e.carteirinha ?? null,
      solicitanteNome: e.solicitanteNome ?? null,
      numeroNip: e.numeroNip ?? null,
      urgente: e.urgente,
      altaComplexidade: e.altaComplexidade,
      temAutorizacao: e.autorizacao !== undefined,
      temOrigemProtocolo: e.origemProtocolo !== undefined,
    });
    if (e.canal === 'portal-prestador' && extra.prestador === undefined)
      problemas.push({ codigo: 'portal-so-prestador', campo: 'canal' });
    if (problemas.length) throw recusaDoAtendimento(problemas);
    const [operadora, dominios, el, guia, origem, relogio] = await Promise.all([
      this.operadora(c, e.operadora),
      this.porta.dominios(c),
      e.carteirinha ? this.porta.elegibilidade(c, e.carteirinha) : Promise.resolve(null),
      e.autorizacao ? this.autorizacoes.autorizacao(c, e.autorizacao) : Promise.resolve(null),
      e.origemProtocolo ? this.porta.protocolo(c, e.origemProtocolo) : Promise.resolve(null),
      this.porta.relogio(c),
    ]);
    const banco: Problema[] = [];
    if (!dominios.origem.some((o) => o.id === e.origem))
      banco.push({ codigo: 'origem-inexistente', campo: 'origem' });
    if (e.carteirinha) {
      if (!el) banco.push({ codigo: 'beneficiario-inexistente', campo: 'carteirinha' });
      else if (el.beneficiario.operadora !== operadora.id)
        banco.push({ codigo: 'beneficiario-de-outra-operadora', campo: 'carteirinha' });
    }
    if (e.autorizacao) {
      if (!guia || guia.operadora !== operadora.id)
        banco.push({ codigo: 'autorizacao-inexistente', campo: 'autorizacao' });
      else if (el && guia.beneficiario !== el.beneficiario.id)
        banco.push({ codigo: 'autorizacao-de-outro-beneficiario', campo: 'autorizacao' });
    }
    if (e.origemProtocolo) {
      if (!origem || origem.operadora !== operadora.id)
        banco.push({ codigo: 'origem-protocolo-inexistente', campo: 'origemProtocolo' });
      else {
        const reanalises = await this.porta.reanalises(c, origem.id);
        banco.push(
          ...conferirOrigemDaReanalise({
            instancia: origem.instancia as ProtocoloDetalhe['instancia'],
            situacao: origem.situacao,
            reanaliseEmAberto: reanalises.some((r) => r.situacao === 'aberto' || r.situacao === 'em-analise'),
          }).map((p) => ({ ...p, campo: 'origemProtocolo' })),
        );
        if (el && origem.beneficiario !== el.beneficiario.id)
          banco.push({ codigo: 'origem-protocolo-de-outro-beneficiario', campo: 'origemProtocolo' });
      }
    }
    if (banco.length) throw recusaDoAtendimento(banco);
    const prazo = prazoDoProtocolo(e, relogio.agora);
    return {
      registroAns: operadora.registroAns,
      registro: {
        operadora: operadora.id,
        instancia: e.instancia,
        natureza: e.natureza,
        classe: classeDaNatureza(e.natureza),
        canal: e.canal,
        origem: e.origem,
        solicitante: e.solicitante,
        solicitanteNome: e.solicitanteNome ?? null,
        beneficiario: el?.beneficiario.id ?? null,
        carteirinha: el ? (e.carteirinha ?? null) : null,
        prestador: extra.prestador ?? null,
        autorizacao: e.autorizacao ?? null,
        origemProtocolo: e.origemProtocolo ?? null,
        numeroNip: e.numeroNip ?? null,
        urgente: e.urgente,
        altaComplexidade: e.altaComplexidade,
        assunto: e.assunto,
        relato: e.relato,
        abertoEm: relogio.agora,
        prazoTipo: prazo.tipo,
        prazoEm: prazo.prazoEm,
        escritaPedida: e.escritaPedida,
      },
    };
  }

  static mensagemDoRegistro(protocolo: string, prazoTipo: string, prazoEm: string): string {
    return prazoTipo === 'imediato'
      ? `Protocolo ${protocolo}: resposta imediata.`
      : `Protocolo ${protocolo}: resposta até ${quando(prazoEm)}.`;
  }

  async protocoloOu404(c: ContextoAtendimento, id: number): Promise<DadosProtocolo> {
    const p = await this.porta.protocolo(c, id);
    if (!p) throw naoEncontrado();
    return p;
  }

  private async paraAcoes(c: ContextoAtendimento, p: DadosProtocolo): Promise<ProtocoloParaAcoes> {
    const reanalises = await this.porta.reanalises(c, p.id);
    return {
      instancia: p.instancia as ProtocoloParaAcoes['instancia'],
      situacao: p.situacao,
      conclusao: p.conclusao as ProtocoloParaAcoes['conclusao'],
      abertoEm: p.abertoEm,
      prazoEm: p.prazoEm,
      prorrogadoAte: p.prorrogadoAte,
      escritaPedida: p.escritaPedida,
      escritaPrazoEm: p.escritaPrazoEm,
      escritaEnviadaEm: p.escritaEnviadaEm,
      reanaliseEmAberto: reanalises.some((r) => r.situacao === 'aberto' || r.situacao === 'em-analise'),
    };
  }

  /** O protocolo, se a ação vale nele agora (senão a recusa com o motivo). */
  async conferirAcao(c: ContextoAtendimento, id: number, acao: AcaoProtocolo): Promise<DadosProtocolo> {
    const p = await this.protocoloOu404(c, id);
    const motivo = recusaDaAcao(await this.paraAcoes(c, p), acao);
    if (motivo) throw recusaDoAtendimento([{ codigo: motivo }]);
    return p;
  }

  async detalhe(c: ContextoAtendimento, id: number): Promise<ProtocoloDetalhe> {
    const p = await this.protocoloOu404(c, id);
    const [eventos, reanalises, dominios, operadoras, estado, respostas] = await Promise.all([
      this.porta.eventos(c, id),
      this.porta.reanalises(c, id),
      this.porta.dominios(c),
      this.porta.operadoras(c),
      this.paraAcoes(c, p),
      this.porta.respostasPrestador(c, id),
    ]);
    const operadora = operadoras.find((o) => o.id === p.operadora);
    const origemRotulo =
      ORIGENS_ATENDIMENTO_OPERADORA[p.origem as keyof typeof ORIGENS_ATENDIMENTO_OPERADORA] ??
      dominios.origem.find((o) => o.id === p.origem)?.rotulo ??
      String(p.origem);
    const textoEscrito =
      p.conclusao && p.resposta && p.respondidoEm && operadora
        ? textoDaRespostaEscrita({
            operadoraNome: operadora.nomeFantasia ?? operadora.razaoSocial,
            registroAns: operadora.registroAns,
            protocolo: p.protocolo,
            instancia: p.instancia as ProtocoloDetalhe['instancia'],
            natureza: p.natureza as ProtocoloDetalhe['natureza'],
            abertoEm: p.abertoEm,
            assunto: p.assunto,
            conclusao: p.conclusao as NonNullable<ProtocoloDetalhe['conclusao']>,
            resposta: p.resposta,
            fundamento: p.fundamento,
            respondidoEm: p.respondidoEm,
          })
        : null;
    return {
      ...resumoDoProtocolo(p),
      operadora: p.operadora,
      origem: p.origem,
      origemRotulo,
      solicitante: p.solicitante as ProtocoloDetalhe['solicitante'],
      solicitanteNome: p.solicitanteNome,
      beneficiario: p.beneficiario,
      prestador: p.prestador,
      autorizacao: p.autorizacao,
      origemProtocolo: p.origemProtocolo,
      reanalises: reanalises.map((r) => ({ id: r.id, protocolo: r.protocolo, situacao: r.situacao })),
      numeroNip: p.numeroNip,
      urgente: p.urgente,
      altaComplexidade: p.altaComplexidade,
      relato: p.relato,
      prazoTipo: p.prazoTipo as ProtocoloDetalhe['prazoTipo'],
      prazoOriginalEm: p.prazoEm,
      prorrogadoAte: p.prorrogadoAte,
      prorrogacaoMotivo: p.prorrogacaoMotivo,
      prorrogavelAte: prorrogavelAte(estado),
      conclusao: p.conclusao as ProtocoloDetalhe['conclusao'],
      resposta: p.resposta,
      fundamento: p.fundamento,
      meio: p.meio as ProtocoloDetalhe['meio'],
      respondidoEm: p.respondidoEm,
      respondidoPor: p.respondidoPor,
      escritaPedida: p.escritaPedida,
      escritaPedidaEm: p.escritaPedidaEm,
      escritaPrazoEm: p.escritaPrazoEm,
      escritaEnviadaEm: p.escritaEnviadaEm,
      escritaMeio: p.escritaMeio as ProtocoloDetalhe['escritaMeio'],
      encerradoEm: p.encerradoEm,
      motivoCancelamento: p.motivoCancelamento,
      eventos: eventos.map((e) => ({
        id: e.id,
        evento: e.evento as ProtocoloDetalhe['eventos'][number]['evento'],
        situacao: e.situacao,
        texto: e.texto,
        em: e.em,
        por: e.por,
      })),
      acoes: acoesDoProtocolo(estado),
      textoEscrito,
      respostasPrestador: respostas.map((r) => ({
        id: r.id,
        interacao: r.interacao,
        evento: r.evento,
        texto: r.texto,
        anexo: r.anexo,
        em: r.em,
      })),
    };
  }

  /** W0-10: o anexo de uma resposta do prestador no protocolo (download na ficha; 404 se não é deste protocolo). */
  async anexoDaResposta(
    c: ContextoAtendimento,
    id: number,
    resposta: number,
  ): Promise<{ nome: string; tipo: string; sha256: string; bytes: Buffer }> {
    const x = await this.porta.anexoDaResposta(c, resposta);
    if (!x || x.protocolo !== id)
      throw new ErroProblema('nao-encontrado', 404, 'Anexo não encontrado', 'O anexo não é deste protocolo.');
    return { nome: x.nome, tipo: x.tipo, sha256: x.sha256, bytes: x.bytes };
  }

  // ── Contas do portal ─────────────────────────────────────────────────────────────────────────

  async acessos(
    c: ContextoAtendimento,
    x: { ligada: boolean; motivo: string | null; podeEditar: boolean },
    prestadores: readonly { id: number; nome: string }[],
    operadoras: readonly { id: number; nome: string; registroAns: string }[] = [],
  ): Promise<AcessosPortalPrestador> {
    // Com a fatia desligada, nada da operadora é lido (só os domínios do estabelecimento; D-LEITURA-56).
    const [itens, dominios] = await Promise.all([
      x.ligada ? this.porta.acessos(c) : Promise.resolve([]),
      this.porta.dominios(c),
    ]);
    return {
      itens: itens.map(acessoDe),
      ligada: x.ligada,
      motivo: x.motivo,
      podeEditar: x.podeEditar,
      funcoes: dominios.funcoesPortal.map((f) => ({
        codigo: f.id,
        rotulo: f.rotulo,
        liberavel: [1, 2, 3, 7].includes(f.id),
      })),
      tiposAtendimento: dominios.tiposAtendimento.map((t) => ({ codigo: t.id, rotulo: t.rotulo })),
      prestadores: [...prestadores],
      operadoras: [...operadoras],
    };
  }

  /** As funções e o tipo de atendimento conferidos contra o domínio do banco. */
  async conferirFuncoes(
    c: ContextoAtendimento,
    funcoes: readonly number[],
    tipoAtendimento: number,
  ): Promise<void> {
    const d = await this.porta.dominios(c);
    const p = conferirFuncoesPortal(
      funcoes,
      d.funcoesPortal.map((f) => f.id),
    );
    if (!d.tiposAtendimento.some((t) => t.id === tipoAtendimento))
      p.push({ codigo: 'tipo-atendimento-inexistente', campo: 'tipoAtendimento' });
    if (p.length) throw recusaDoAtendimento(p);
  }

  /** O prestador da conta nova: na rede, credenciado; a operadora ativa. */
  async conferirCriacao(
    c: ContextoAtendimento,
    e: CriarAcessoPortalEntrada,
    operadora: number,
  ): Promise<void> {
    await this.operadora(c, operadora);
    const p = await this.porta.prestador(c, e.prestador);
    if (!p) throw recusaDoAtendimento([{ codigo: 'prestador-inexistente', campo: 'prestador' }]);
    if (p.situacao !== 'credenciado')
      throw recusaDoAtendimento([{ codigo: 'prestador-inativo', campo: 'prestador' }]);
    await this.conferirFuncoes(c, e.funcoes, e.tipoAtendimento);
  }

  async acessoOu404(c: ContextoAtendimento, id: number): Promise<DadosAcessoPortalPrestador> {
    const a = await this.porta.acesso(c, id);
    if (!a) throw acessoNaoEncontrado();
    if (a.situacao === 'encerrado') throw recusaDoAtendimento([{ codigo: 'acesso-encerrado' }]);
    return a;
  }
}
