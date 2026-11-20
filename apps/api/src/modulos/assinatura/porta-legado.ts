// Porta da assinatura ICP sobre o núcleo do legado (M49, etapa 1): leituras READ ONLY (identidade, formas de
// assinatura, tipos de certificado, conselhos e as tabelas SGH_ do marco); gravações numa transação SGH_ com a SGH_TRILHA junto (nenhuma tabela do
// legado). `portaAssinaturaNaTransacao`: a mesma porta sobre UMA transação aberta (integração na cópia, desfeita).
import {
  assinadosIcpRecentes,
  assinaturaDocumentoPorId,
  assinaturasDoUsuario,
  assinaturasIcpDosDocumentos,
  assinaturasPendentesVencidas,
  atualizarAssinaturaIcp,
  atualizarSolicitacaoSncr,
  avisosAbertos,
  contagemPendenciasIcp,
  documentoSghPorId,
  documentosParaAssinarIcp,
  gravarAssinaturaPdf,
  gravarAvisoAssinatura,
  gravarEventoAssinadoIcp,
  travarDocumentoParaAssinarIcp,
  gravarNumeroSncr,
  gravarPreviaAssinatura,
  gravarSolicitacaoSncr,
  lerOidsDeConselho,
  marcarAvisosLidos,
  previaMaisRecente,
  previaPorId,
  registrarPdfAssinado,
  solicitacoesSncr,
  documentoDoCodigo,
  registrarConsultaPublica,
  resumoVerificacoes,
  certificadoPorId,
  certificadosDoUsuario,
  consumirPedidoAssinatura,
  type Escritor,
  gravarAssinaturaIcp,
  gravarCertificado,
  gravarPedidoAssinatura,
  gravarPolitica,
  gravarProvedorPsc,
  gravarTrilha,
  gravarValidacaoIcp,
  identidadeParaCertificado,
  inativarCertificado,
  type Leitor,
  lerConselhosProfissionais,
  lerFormasAssinaturaIcp,
  lerTiposCertificado,
  type NucleoLegado,
  politicasVigentes,
  provedorPscPorCodigo,
  provedoresPsc,
} from '@sgh/legado';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoAssinatura,
  type GravadorAssinatura,
  METODOS_PORTA_ASSINATURA,
  type PortaAssinaturaIcp,
  type TrilhaDaGravacao,
} from './porta.js';

function gravador(e: Escritor): GravadorAssinatura {
  return {
    gravarCertificado: (c) => gravarCertificado(e, c),
    inativarCertificado: (d) => inativarCertificado(e, d),
    gravarPolitica: (p) => gravarPolitica(e, p),
    gravarProvedor: (p, v) => gravarProvedorPsc(e, p, v),
    gravarPedido: (p) => gravarPedidoAssinatura(e, p),
    consumirPedido: (s, dono, agora) => consumirPedidoAssinatura(e, s, dono, agora),
    gravarAssinatura: (a) => gravarAssinaturaIcp(e, a),
    gravarValidacao: (v) => gravarValidacaoIcp(e, v),
    gravarPrevia: (p) => gravarPreviaAssinatura(e, p),
    gravarAssinaturaPdf: (a) => gravarAssinaturaPdf(e, a),
    registrarPdfAssinado: (a, agora) => registrarPdfAssinado(e, a, agora),
    atualizarAssinatura: (a, agora) => atualizarAssinaturaIcp(e, a, agora),
    travarDocumentoParaAssinar: (h, documento, exceto) =>
      travarDocumentoParaAssinarIcp(e, h, documento, exceto),
    gravarEventoAssinadoIcp: async (ctx, documento, comoSuporte) => {
      await gravarEventoAssinadoIcp(e, ctx, documento, comoSuporte);
    },
    gravarAviso: (a) => gravarAvisoAssinatura(e, a),
    marcarAvisosLidos: (h, avisos, por, agora) => marcarAvisosLidos(e, h, avisos, por, agora),
    gravarSolicitacaoSncr: (x) => gravarSolicitacaoSncr(e, x),
    atualizarSolicitacaoSncr: (x, agora) => atualizarSolicitacaoSncr(e, x, agora),
    gravarNumeroSncr: (h, d, n) => gravarNumeroSncr(e, h, d, n),
    registrarConsultaPublica: (c) => registrarConsultaPublica(e, c),
  };
}

async function naTransacao<T>(
  e: Escritor,
  trilha: TrilhaDaGravacao<T>,
  fn: (g: GravadorAssinatura) => Promise<T>,
) {
  const r = await fn(gravador(e));
  const linha = typeof trilha === 'function' ? trilha(r) : trilha;
  if (linha) await gravarTrilha(e, linha);
  return r;
}

type Ler = <T>(c: ContextoAssinatura, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaAssinaturaIcp, 'destino' | 'gravar'> {
  return {
    identidade: (c, login) => ler(c, (l) => identidadeParaCertificado(l, login)),
    formasIcp: (c) => ler(c, (l) => lerFormasAssinaturaIcp(l)),
    tiposCertificado: (c) => ler(c, (l) => lerTiposCertificado(l)),
    conselhos: (c) => ler(c, (l) => lerConselhosProfissionais(l)),
    certificados: (c, login) => ler(c, (l) => certificadosDoUsuario(l, c.hospital, login)),
    certificado: (c, id) => ler(c, (l) => certificadoPorId(l, c.hospital, id)),
    politicas: (c) => ler(c, (l) => politicasVigentes(l, c.hospital)),
    provedores: (c) => ler(c, (l) => provedoresPsc(l, c.hospital)),
    provedor: (c, codigo) => ler(c, (l) => provedorPscPorCodigo(l, c.hospital, codigo)),
    assinaturas: (c, login, origem) => ler(c, (l) => assinaturasDoUsuario(l, c.hospital, login, origem)),
    documentoEmitido: (c, id) => ler(c, (l) => documentoSghPorId(l, c.hospital, id)),
    filaIcp: (c, login, teto, tiposIcp) =>
      ler(c, (l) => documentosParaAssinarIcp(l, c.hospital, login, teto, tiposIcp)),
    assinaturasDosDocumentos: (c, ids) => ler(c, (l) => assinaturasIcpDosDocumentos(l, c.hospital, ids)),
    previaMaisRecente: (c, d, login) => ler(c, (l) => previaMaisRecente(l, c.hospital, d, login)),
    previa: (c, id) => ler(c, (l) => previaPorId(l, c.hospital, id)),
    assinaturaDocumento: (c, id) => ler(c, (l) => assinaturaDocumentoPorId(l, c.hospital, id)),
    pendentesVencidas: (c, agora, teto) =>
      ler(c, (l) => assinaturasPendentesVencidas(l, c.hospital, agora, teto)),
    assinadosRecentes: (c, login) => ler(c, (l) => assinadosIcpRecentes(l, c.hospital, login)),
    contagemPendencias: (c) => ler(c, (l) => contagemPendenciasIcp(l, c.hospital)),
    avisos: (c, para) => ler(c, (l) => avisosAbertos(l, c.hospital, para)),
    oidsDeConselho: (c) => ler(c, (l) => lerOidsDeConselho(l)),
    solicitacoesSncr: (c, d) => ler(c, (l) => solicitacoesSncr(l, c.hospital, d)),
    documentoDoCodigo: (c, codigo) => ler(c, (l) => documentoDoCodigo(l, c.hospital, codigo)),
    resumoVerificacoes: (c, desde) => ler(c, (l) => resumoVerificacoes(l, c.hospital, desde)),
  };
}

export function portaAssinaturaLegado(nucleo: NucleoLegado): PortaAssinaturaIcp {
  const ctx = (c: ContextoAssinatura) => ({ rede: c.rede, hospital: c.hospital, traceId: 'assinatura-icp' });
  return {
    destino: 'legado',
    gravar: (c, fn, trilha) => nucleo.gravarSgh(ctx(c), (e) => naTransacao(e, trilha, fn)),
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

export function portaAssinaturaNaTransacao(e: Escritor): PortaAssinaturaIcp {
  return {
    destino: 'legado',
    gravar: (_c, fn, trilha) => naTransacao(e, trilha, fn),
    ...leituras((_c, fn) => fn(e)),
  };
}

export function portaAssinaturaIndisponivel(): PortaAssinaturaIcp {
  return portaIndisponivel<PortaAssinaturaIcp>(METODOS_PORTA_ASSINATURA);
}
