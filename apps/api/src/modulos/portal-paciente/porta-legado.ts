// Porta do portal do paciente sobre o núcleo do legado (M50, etapa 1): leituras READ ONLY (o paciente pela PK e pelo
// prontuário, os domínios do consentimento, os nomes da trilha e as tabelas SGH_ do marco); gravações numa transação
// SGH_ com a SGH_TRILHA junto (nenhuma tabela do legado). `portaPortalNaTransacao`: a mesma porta sobre UMA transação
// aberta (integração na cópia, desfeita).
import {
  ativarContaPortal,
  feriadosDoPeriodo,
  manifestacoesPortalDoPaciente,
  registrarManifestacaoSgh,
  bloquearContaPortal,
  cancelarTrocaEmailPortal,
  confirmarTrocaEmailPortal,
  consentimentosPortalDoPaciente,
  contaPortalDoPaciente,
  contaPortalPorConvite,
  contaPortalPorEmail,
  contaPortalPorId,
  contasPortalAbertasDePacientes,
  criarContaPortal,
  decidirVinculoPortal,
  desbloquearContaPortal,
  documentosPortalDoPaciente,
  dominiosConsentimentoPortal,
  encerrarContaPortal,
  encerrarVinculoPortal,
  type Escritor,
  gravarTrilha,
  guardiaoConferePorCadastro,
  type Leitor,
  leiturasDoTitular,
  lerCapacidadesCivis,
  ligarPedidoTitularAConta,
  marcarConsentimentoDoPortal,
  nomesDosUsuarios,
  type NucleoLegado,
  pacienteParaPortal,
  pacientesPorProntuarioParaPortal,
  pedidosTitularDaConta,
  pedirTrocaEmailPortal,
  pedirVinculoPortal,
  reemitirConvitePortal,
  registrarConsentimento,
  registrarEntradaPortal,
  registrarErroConvitePortal,
  registrarPedidoTitular,
  cancelarPedidoTitular,
  atosDaCopia,
  filaDeCopias,
  registrarAtoCopia,
  revogarConsentimento,
  trocaEmailPortalPendente,
  trocaEmailPortalPorToken,
  trocarSegundoFatorPortal,
  trocarSenhaPortal,
  vinculoPortalPorId,
  vinculosAtivosPortal,
  vinculosDaContaPortal,
  vinculosDoTitularPortal,
  vinculosParaConferirPortal,
} from '@sgh/legado';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoPortal,
  type GravadorPortal,
  METODOS_PORTA_PORTAL,
  type PortaPortalPaciente,
  type TrilhaDaGravacao,
} from './porta.js';

function gravador(e: Escritor, c: ContextoPortal): GravadorPortal {
  const h = c.hospital;
  return {
    criarConta: (x) => criarContaPortal(e, { ...x, rede: c.rede, hospital: h }),
    reemitirConvite: (conta, versao, x) => reemitirConvitePortal(e, h, conta, versao, x),
    registrarErroConvite: (conta) => registrarErroConvitePortal(e, h, conta),
    ativar: (conta, versao, a) => ativarContaPortal(e, h, conta, versao, a),
    registrarEntrada: (conta, r) => registrarEntradaPortal(e, h, conta, r),
    trocarSenha: (conta, versao, s) => trocarSenhaPortal(e, h, conta, versao, s),
    trocarSegundoFator: (conta, versao, env) => trocarSegundoFatorPortal(e, h, conta, versao, env),
    pedirTrocaEmail: (t) => pedirTrocaEmailPortal(e, h, { ...t, rede: c.rede }),
    confirmarTrocaEmail: (t, conta, versao, x) => confirmarTrocaEmailPortal(e, h, t, conta, versao, x),
    cancelarTrocaEmail: (t) => cancelarTrocaEmailPortal(e, h, t),
    bloquear: (conta, versao, d) => bloquearContaPortal(e, h, conta, versao, d),
    desbloquear: (conta, versao, por) => desbloquearContaPortal(e, h, conta, versao, por),
    encerrar: (conta, versao, d) => encerrarContaPortal(e, h, conta, versao, d),
    pedirVinculo: (v) => pedirVinculoPortal(e, { ...v, hospital: h }),
    decidirVinculo: (v, versao, d) => decidirVinculoPortal(e, h, v, versao, d),
    encerrarVinculo: (v, versao, d) => encerrarVinculoPortal(e, h, v, versao, d),
    async registrarConsentimento(x) {
      const id = await registrarConsentimento(e, {
        hospital: h,
        idPaciente: x.idPaciente,
        pront: x.pront,
        finalidade: x.finalidade,
        versao: x.versao,
        situacao: x.situacao,
        signatario: x.signatario,
        usuario: x.usuario,
      });
      await marcarConsentimentoDoPortal(e, h, id, { conta: x.conta, vinculo: x.vinculo });
      return { id };
    },
    revogarConsentimento: (r) => revogarConsentimento(e, { ...r, hospital: h }),
    // W0-10 (M1): o escritor da ouvidoria interna (W0-04), canal "portal", identificada com o paciente da sessão.
    registrarManifestacao: (m) =>
      registrarManifestacaoSgh(e, {
        hospital: h,
        protocoloDe: m.protocoloDe,
        canal: 'portal',
        tipo: m.tipo,
        identificada: true,
        paciente: m.paciente,
        manifestante: null,
        contato: null,
        area: m.area,
        relato: m.relato,
        recebidaEm: m.recebidaEm,
        prazoEm: m.prazoEm,
        pesquisa: null,
        agora: m.recebidaEm,
        usuario: m.usuario,
      }),
    async registrarPedido(p, trilha) {
      const r = await registrarPedidoTitular(
        e,
        {
          rede: c.rede,
          hospital: h,
          idPaciente: p.idPaciente,
          tipo: p.tipo,
          canal: 'portal',
          descricao: p.descricao,
          por: p.por,
          prazoDias: p.prazoDias,
        },
        trilha,
      );
      await ligarPedidoTitularAConta(e, h, r.id, p.conta, p.identidadeVerificada ? { por: p.por } : null);
      return r;
    },
    // W0-10 (M2): o pedido de acesso (escritor do M10) e o ato da solicitação na mesma transação.
    async pedirCopia(p, trilhas) {
      const r = await registrarPedidoTitular(
        e,
        {
          rede: c.rede,
          hospital: h,
          idPaciente: p.idPaciente,
          tipo: 'acesso',
          canal: p.canal,
          descricao: p.descricao,
          por: p.por,
          prazoDias: p.prazoDias,
        },
        trilhas.pedido,
      );
      if (p.conta !== null)
        await ligarPedidoTitularAConta(e, h, r.id, p.conta, p.identidadeVerificada ? { por: p.por } : null);
      await registrarAtoCopia(
        e,
        h,
        {
          protocolo: r.protocolo,
          idPaciente: p.idPaciente,
          ato: 'solicitacao',
          solicitante: p.solicitante,
          vinculo: p.vinculo,
          prova: p.prova,
          por: p.por,
          conferir: (_x, atos) => (atos.length > 0 ? 'A cópia deste pedido já foi solicitada.' : null),
        },
        trilhas.copia,
      );
      return r;
    },
    registrarAtoCopia: ({ conferir, ...d }, trilha) =>
      registrarAtoCopia(e, h, { ...d, conferir: (x, atos) => conferir(x.situacao, atos) }, trilha),
    async cancelarPedido(p, trilha) {
      await cancelarPedidoTitular(
        e,
        h,
        {
          protocolo: p.protocolo,
          idPaciente: p.idPaciente,
          conta: p.conta,
          motivo: p.motivo,
          observacao: p.observacao,
          por: p.por,
          conferir: (x) => p.conferir(x.situacao),
        },
        trilha,
      );
    },
  };
}

async function naTransacao<T>(
  e: Escritor,
  c: ContextoPortal,
  trilha: TrilhaDaGravacao<T>,
  fn: (g: GravadorPortal) => Promise<T>,
) {
  const r = await fn(gravador(e, c));
  const linha = typeof trilha === 'function' ? trilha(r) : trilha;
  if (linha) await gravarTrilha(e, linha);
  return r;
}

type Ler = <T>(c: ContextoPortal, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaPortalPaciente, 'destino' | 'gravar'> {
  return {
    paciente: (c, id) => ler(c, (l) => pacienteParaPortal(l, id)),
    pacientesPorProntuario: (c, p) => ler(c, (l) => pacientesPorProntuarioParaPortal(l, p)),
    capacidadesCivis: (c) => ler(c, (l) => lerCapacidadesCivis(l)),
    conta: (c, id) => ler(c, (l) => contaPortalPorId(l, c.hospital, id)),
    contaPorEmail: (c, r) => ler(c, (l) => contaPortalPorEmail(l, c.hospital, r)),
    contaPorConvite: (c, r) => ler(c, (l) => contaPortalPorConvite(l, c.hospital, r)),
    trocaEmailPorToken: (c, r) => ler(c, (l) => trocaEmailPortalPorToken(l, c.hospital, r)),
    trocaEmailPendente: (c, k) => ler(c, (l) => trocaEmailPortalPendente(l, c.hospital, k)),
    contaDoPaciente: (c, p) => ler(c, (l) => contaPortalDoPaciente(l, c.hospital, p)),
    contasAbertas: (c) => ler(c, (l) => contasPortalAbertasDePacientes(l, c.hospital)),
    vinculosDaConta: (c, conta) => ler(c, (l) => vinculosDaContaPortal(l, c.hospital, conta)),
    vinculosDoTitular: (c, p) => ler(c, (l) => vinculosDoTitularPortal(l, c.hospital, p)),
    vinculo: (c, id) => ler(c, (l) => vinculoPortalPorId(l, c.hospital, id)),
    filaVinculos: (c, f) => ler(c, (l) => vinculosParaConferirPortal(l, c.hospital, f)),
    vinculosAtivos: (c) => ler(c, (l) => vinculosAtivosPortal(l, c.hospital)),
    guardiaoConfere: (c, t, r) => ler(c, (l) => guardiaoConferePorCadastro(l, t, r)),
    dominiosConsentimento: (c) => ler(c, (l) => dominiosConsentimentoPortal(l)),
    consentimentos: (c, p) => ler(c, (l) => consentimentosPortalDoPaciente(l, c.hospital, p)),
    pedidos: (c, conta, p) => ler(c, (l) => pedidosTitularDaConta(l, c.hospital, conta, p)),
    documentos: (c, p, tipos, pagina, apenas = null) =>
      ler(c, (l) => documentosPortalDoPaciente(l, c.hospital, p, tipos, pagina, apenas)),
    leituras: (c, p, ev, de, ate) => ler(c, (l) => leiturasDoTitular(l, c.hospital, p, ev, de, ate)),
    nomes: (c, logins) => ler(c, (l) => nomesDosUsuarios(l, logins)),
    manifestacoes: (c, p) => ler(c, (l) => manifestacoesPortalDoPaciente(l, c.hospital, p)),
    feriados: (c, de, ate) => ler(c, async (l) => [...(await feriadosDoPeriodo(l, de, ate))]),
    filaCopias: (c, f) => ler(c, (l) => filaDeCopias(l, c.hospital, f)),
    atosCopia: (c, id) => ler(c, (l) => atosDaCopia(l, c.hospital, id)),
  };
}

export function portaPortalLegado(nucleo: NucleoLegado): PortaPortalPaciente {
  const ctx = (c: ContextoPortal) => ({ rede: c.rede, hospital: c.hospital, traceId: 'portal-paciente' });
  return {
    destino: 'legado',
    gravar: (c, fn, trilha) => nucleo.gravarSgh(ctx(c), (e) => naTransacao(e, c, trilha, fn)),
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

export function portaPortalNaTransacao(e: Escritor): PortaPortalPaciente {
  return {
    destino: 'legado',
    gravar: (c, fn, trilha) => naTransacao(e, c, trilha, fn),
    ...leituras((_c, fn) => fn(e)),
  };
}

export function portaPortalIndisponivel(): PortaPortalPaciente {
  return portaIndisponivel<PortaPortalPaciente>(METODOS_PORTA_PORTAL);
}
