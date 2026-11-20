// Porta da autorização de guias sobre o núcleo do legado (M56, etapa 5, F4): cada leitura numa transação curta READ ONLY
// no banco do estabelecimento; as gravações só do novo (SGH_OPE_AUTORIZACAO, _ITEM, _EVT e SGH_OPE_AUDITOR) numa
// transação SGH_ com a SGH_TRILHA junto (`somenteSgh` recusa qualquer escrita fora de SGH_). Em dev sobre a cópia
// compartilhada, as gravações são recusadas (`sghSoLeitura`).
import {
  abrirJuntaSgh,
  alterarAuditorSgh,
  anexoDoComplemento,
  anexosDoComplemento,
  auditoresSgh,
  auditorPorId,
  autorizacaoSgh,
  autorizacoesSgh,
  buscarProcedimentosTuss,
  cancelarAutorizacaoSgh,
  decidirAutorizacaoSgh,
  designacoesDoUsuario,
  designarAuditorSgh,
  dominiosDaAutorizacao,
  elegibilidadeSgh,
  encerrarAuditorSgh,
  eventosAutorizacaoSgh,
  gravarTrilha,
  itensAutorizacaoSgh,
  type Leitor,
  nomeDoCid,
  type NucleoLegado,
  operadorasSgh,
  pedirComplementoSgh,
  prestadoresParaAutorizacao,
  prestadorPorId,
  procedimentosTussPorCodigo,
  proximaSequenciaProtocolo,
  proximaSequenciaSenha,
  registrarAutorizacaoSgh,
  relogioRecepcao,
  responderComplementoPortalSgh,
  responderComplementoSgh,
  somenteSgh,
  totaisAutorizacoesSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoAutorizacao,
  METODOS_PORTA_AUTORIZACAO,
  type PortaAutorizacaoOperadora,
} from './autorizacao-porta.js';

export function portaAutorizacaoOperadoraLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente' | 'gravarSgh'>,
  opcoes: { readonly sghSoLeitura?: boolean } = {},
): PortaAutorizacaoOperadora {
  const ctx = (c: ContextoAutorizacao) => ({
    rede: c.rede,
    hospital: c.hospital,
    traceId: 'operadora-autorizacao',
  });
  const ler = <T>(c: ContextoAutorizacao, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    relogio: (c) =>
      ler(c, async (l) => {
        const r = await relogioRecepcao(l);
        return { hoje: r.hoje, agora: r.agora.slice(0, 19).replace(' ', 'T') };
      }),
    dominios: (c) => ler(c, (l) => dominiosDaAutorizacao(l)),
    operadoras: (c) => ler(c, (l) => operadorasSgh(l, c.hospital)),
    prestadores: (c) => ler(c, (l) => prestadoresParaAutorizacao(l, c.hospital)),
    prestador: (c, id) => ler(c, (l) => prestadorPorId(l, c.hospital, id)),
    elegibilidade: (c, carteirinha) => ler(c, (l) => elegibilidadeSgh(l, c.hospital, carteirinha)),
    procedimentosTuss: (c, codigos) => ler(c, (l) => procedimentosTussPorCodigo(l, codigos)),
    buscarTuss: (c, termo) => ler(c, (l) => buscarProcedimentosTuss(l, termo)),
    nomeDoCid: (c, codigo) => ler(c, (l) => nomeDoCid(l, codigo)),
    autorizacoes: (c, f) => ler(c, (l) => autorizacoesSgh(l, c.hospital, f)),
    totais: (c) => ler(c, (l) => totaisAutorizacoesSgh(l, c.hospital)),
    autorizacao: (c, id) => ler(c, (l) => autorizacaoSgh(l, c.hospital, id)),
    itens: (c, id) => ler(c, (l) => itensAutorizacaoSgh(l, c.hospital, id)),
    eventos: (c, id) => ler(c, (l) => eventosAutorizacaoSgh(l, c.hospital, id)),
    anexosDoComplemento: (c, id) => ler(c, (l) => anexosDoComplemento(l, c.hospital, id)),
    anexoDoComplemento: (c, anexo, prestador) =>
      ler(c, (l) => anexoDoComplemento(l, c.hospital, anexo, prestador)),
    auditores: (c) => ler(c, (l) => auditoresSgh(l, c.hospital)),
    auditor: (c, id) => ler(c, (l) => auditorPorId(l, c.hospital, id)),
    designacoes: (c, login) => ler(c, (l) => designacoesDoUsuario(l, c.hospital, login)),
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: as autorizações não são gravadas.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const h = c.hospital;
        const r = await fn({
          proximoProtocolo: () => proximaSequenciaProtocolo(e),
          proximaSenha: () => proximaSequenciaSenha(e),
          registrar: (x) => registrarAutorizacaoSgh(e, { hospital: h, ...x }),
          pedirComplemento: (x) => pedirComplementoSgh(e, { hospital: h, ...x }),
          responderComplemento: (x) => responderComplementoSgh(e, { hospital: h, ...x }),
          responderComplementoPortal: (x) => responderComplementoPortalSgh(e, { hospital: h, ...x }),
          abrirJunta: (x) => abrirJuntaSgh(e, { hospital: h, ...x }),
          decidir: (x) => decidirAutorizacaoSgh(e, { hospital: h, ...x }),
          cancelar: (x) => cancelarAutorizacaoSgh(e, { hospital: h, ...x }),
          designar: (x) => designarAuditorSgh(e, { hospital: h, ...x }),
          encerrar: (x) => encerrarAuditorSgh(e, { hospital: h, ...x }),
          alterar: (x) => alterarAuditorSgh(e, { hospital: h, ...x }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
  };
}

/** Fora de dev/ci sem o núcleo: 503 em tudo (falha fechada). */
export function portaAutorizacaoOperadoraIndisponivel(): PortaAutorizacaoOperadora {
  return portaIndisponivel<PortaAutorizacaoOperadora>(METODOS_PORTA_AUTORIZACAO);
}
