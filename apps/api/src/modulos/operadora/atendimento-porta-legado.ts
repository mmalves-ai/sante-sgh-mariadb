// Porta do atendimento com protocolo e das contas do portal do prestador sobre o núcleo do legado (M56, etapa 8, F7):
// cada leitura numa transação curta READ ONLY no banco do estabelecimento; as gravações só do novo (SGH_OPE_PROTOCOLO,
// _EVT e SGH_OPE_PORTAL_ACESSO) numa transação SGH_ com a SGH_TRILHA junto (`somenteSgh` recusa qualquer escrita fora
// de SGH_). Em dev sobre a cópia compartilhada, as gravações são recusadas (`sghSoLeitura`).
import {
  acessoPortalParaEntrada,
  acessoPortalPorId,
  acessosPortalSgh,
  alterarAcessoPortalSgh,
  analisarProtocoloSgh,
  ativarAcessoPortalSgh,
  cancelarProtocoloSgh,
  consultaProtocoloSgh,
  criarAcessoPortalSgh,
  elegibilidadeSgh,
  consultasElegibilidadeSgh,
  registrarConsultaElegibilidadeSgh,
  validadeDaCarteirinhaSgh,
  encerrarAcessoPortalSgh,
  encerrarProtocoloSgh,
  enviarEscritaProtocoloSgh,
  eventosProtocoloSgh,
  gravarTrilha,
  interagirProtocoloSgh,
  type Leitor,
  lerDominioOperadora,
  type NucleoLegado,
  operadorasSgh,
  pedirEscritaProtocoloSgh,
  pedirReanaliseProtocoloSgh,
  prestadorPorId,
  prorrogarProtocoloSgh,
  protocoloSgh,
  protocolosSgh,
  proximaSequenciaProtocolo,
  reanalisesDoProtocolo,
  reemitirAcessoPortalSgh,
  registrarProtocoloSgh,
  registrarTentativaPortalSgh,
  relogioRecepcao,
  responderProtocoloSgh,
  somenteSgh,
  totaisProtocolosSgh,
  trocarCredencialPortalSgh,
  anexoDaRespostaPrestador,
  respostasPrestadorDoProtocolo,
  responderInteracaoPrestadorSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoAtendimento,
  METODOS_PORTA_ATENDIMENTO,
  type PortaAtendimentoOperadora,
} from './atendimento-porta.js';

export function portaAtendimentoOperadoraLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente' | 'gravarSgh'>,
  opcoes: { readonly sghSoLeitura?: boolean } = {},
): PortaAtendimentoOperadora {
  const ctx = (c: ContextoAtendimento) => ({
    rede: c.rede,
    hospital: c.hospital,
    traceId: 'operadora-atendimento',
  });
  const ler = <T>(c: ContextoAtendimento, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    relogio: (c) =>
      ler(c, async (l) => {
        const r = await relogioRecepcao(l);
        return { hoje: r.hoje, agora: r.agora.slice(0, 19).replace(' ', 'T') };
      }),
    dominios: (c) =>
      ler(c, async (l) => ({
        origem: await lerDominioOperadora(l, 'SPORIGEM_ATEND'),
        funcoesPortal: await lerDominioOperadora(l, 'PFPORTALOPCAO'),
        tiposAtendimento: await lerDominioOperadora(l, 'PFTPATEND'),
      })),
    operadoras: (c) => ler(c, (l) => operadorasSgh(l, c.hospital)),
    elegibilidade: (c, carteirinha) => ler(c, (l) => elegibilidadeSgh(l, c.hospital, carteirinha)),
    validadeCarteirinha: (c, b) => ler(c, (l) => validadeDaCarteirinhaSgh(l, c.hospital, b)),
    consultasElegibilidade: (c, p) => ler(c, (l) => consultasElegibilidadeSgh(l, c.hospital, p)),
    prestador: (c, id) => ler(c, (l) => prestadorPorId(l, c.hospital, id)),
    protocolos: (c, f) => ler(c, (l) => protocolosSgh(l, c.hospital, f)),
    totais: (c) => ler(c, (l) => totaisProtocolosSgh(l, c.hospital)),
    protocolo: (c, id) => ler(c, (l) => protocoloSgh(l, c.hospital, id)),
    reanalises: (c, id) => ler(c, (l) => reanalisesDoProtocolo(l, c.hospital, id)),
    eventos: (c, id) => ler(c, (l) => eventosProtocoloSgh(l, c.hospital, id)),
    consulta: (c, numero, prestador) => ler(c, (l) => consultaProtocoloSgh(l, c.hospital, numero, prestador)),
    respostasPrestador: (c, id) => ler(c, (l) => respostasPrestadorDoProtocolo(l, c.hospital, id)),
    anexoDaResposta: (c, resposta, prestador) =>
      ler(c, (l) => anexoDaRespostaPrestador(l, c.hospital, resposta, prestador)),
    acessos: (c) => ler(c, (l) => acessosPortalSgh(l, c.hospital)),
    acesso: (c, id) => ler(c, (l) => acessoPortalPorId(l, c.hospital, id)),
    acessoParaEntrada: (c, chave) => ler(c, (l) => acessoPortalParaEntrada(l, c.hospital, chave)),
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: os protocolos e os acessos não são gravados.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const h = c.hospital;
        const r = await fn({
          proximoProtocolo: () => proximaSequenciaProtocolo(e),
          registrar: (x) => registrarProtocoloSgh(e, { hospital: h, ...x }),
          analisar: (x) => analisarProtocoloSgh(e, { hospital: h, ...x }),
          interagir: (x) => interagirProtocoloSgh(e, { hospital: h, ...x }),
          prorrogar: (x) => prorrogarProtocoloSgh(e, { hospital: h, ...x }),
          responder: (x) => responderProtocoloSgh(e, { hospital: h, ...x }),
          pedirEscrita: (x) => pedirEscritaProtocoloSgh(e, { hospital: h, ...x }),
          enviarEscrita: (x) => enviarEscritaProtocoloSgh(e, { hospital: h, ...x }),
          encerrar: (x) => encerrarProtocoloSgh(e, { hospital: h, ...x }),
          cancelar: (x) => cancelarProtocoloSgh(e, { hospital: h, ...x }),
          reanalise: (x) =>
            pedirReanaliseProtocoloSgh(e, { hospital: h, ...x, novo: { hospital: h, ...x.novo } }),
          criarAcesso: (x) => criarAcessoPortalSgh(e, { hospital: h, ...x }),
          alterarAcesso: (x) => alterarAcessoPortalSgh(e, { hospital: h, ...x }),
          reemitirAcesso: (x) => reemitirAcessoPortalSgh(e, { hospital: h, ...x }),
          encerrarAcesso: (x) => encerrarAcessoPortalSgh(e, { hospital: h, ...x }),
          ativarAcesso: (x) => ativarAcessoPortalSgh(e, { hospital: h, ...x }),
          tentativaPortal: (x) => registrarTentativaPortalSgh(e, { hospital: h, ...x }),
          trocarCredencial: (x) => trocarCredencialPortalSgh(e, { hospital: h, ...x }),
          responderInteracaoPrestador: (x) => responderInteracaoPrestadorSgh(e, { hospital: h, ...x }),
          registrarElegibilidade: (x) => registrarConsultaElegibilidadeSgh(e, { hospital: h, ...x }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
  };
}

/** Fora de dev/ci sem o núcleo: 503 em tudo (falha fechada). */
export function portaAtendimentoOperadoraIndisponivel(): PortaAtendimentoOperadora {
  return portaIndisponivel<PortaAtendimentoOperadora>(METODOS_PORTA_ATENDIMENTO);
}
