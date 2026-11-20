// Porta da cobrança da operadora sobre o núcleo do legado (M56, etapa 3, F2): cada leitura numa transação curta READ
// ONLY no banco do estabelecimento; as gravações só do novo (SGH_OPE_COBRANCA, SGH_OPE_COBRANCA_ITEM e
// SGH_OPE_REAJUSTE) numa transação SGH_ com a SGH_TRILHA junto (`somenteSgh` recusa qualquer escrita fora de SGH_). Em
// dev sobre a cópia compartilhada, as gravações são recusadas (`sghSoLeitura`).
import {
  baixarCobrancaSgh,
  baseMensalidadesSgh,
  beneficiarioParaCobrarSgh,
  cancelarCobrancaSgh,
  cancelarReajusteSgh,
  cobrancaSgh,
  cobrancasDoContratoSgh,
  cobrancasSgh,
  contratoParaCobrarSgh,
  contratosInadimplentesSgh,
  estornarBaixaSgh,
  gravarTrilha,
  hojeDoBancoSgh,
  incluirCobrancaSgh,
  itensDaCobrancaSgh,
  type Leitor,
  notificarCobrancasSgh,
  type NucleoLegado,
  operadorasSgh,
  proximoAcordoSgh,
  reajusteSgh,
  reajustesSgh,
  registrarReajusteSgh,
  renegociadasNoAcordoSgh,
  renegociarCobrancaSgh,
  situacaoReajusteDoContratoSgh,
  somenteSgh,
  titularDoContratoSgh,
  totaisCobrancaSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoCobranca,
  METODOS_PORTA_COBRANCA,
  type PortaCobrancaOperadora,
} from './cobranca-porta.js';

export function portaCobrancaOperadoraLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente'> & Partial<Pick<NucleoLegado, 'gravarSgh'>>,
  opcoes: { readonly sghSoLeitura?: boolean } = {},
): PortaCobrancaOperadora {
  const ctx = (c: ContextoCobranca) => ({
    rede: c.rede,
    hospital: c.hospital,
    traceId: 'operadora-cobranca',
  });
  const ler = <T>(c: ContextoCobranca, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    hoje: (c) => ler(c, (l) => hojeDoBancoSgh(l)),
    operadoras: (c) => ler(c, (l) => operadorasSgh(l, c.hospital)),
    baseMensalidades: (c, f) => ler(c, (l) => baseMensalidadesSgh(l, c.hospital, f)),
    contrato: (c, id) => ler(c, (l) => contratoParaCobrarSgh(l, c.hospital, id)),
    beneficiario: (c, id) => ler(c, (l) => beneficiarioParaCobrarSgh(l, c.hospital, id)),
    titular: (c, k) => ler(c, (l) => titularDoContratoSgh(l, c.hospital, k)),
    cobrancas: (c, f) => ler(c, (l) => cobrancasSgh(l, c.hospital, f)),
    cobranca: (c, id) => ler(c, (l) => cobrancaSgh(l, c.hospital, id)),
    itens: (c, id) => ler(c, (l) => itensDaCobrancaSgh(l, c.hospital, id)),
    renegociadas: (c, a) => ler(c, (l) => renegociadasNoAcordoSgh(l, c.hospital, a)),
    doContrato: (c, ks, desde) => ler(c, (l) => cobrancasDoContratoSgh(l, c.hospital, ks, desde)),
    totais: (c, o, hoje) => ler(c, (l) => totaisCobrancaSgh(l, c.hospital, o, hoje)),
    inadimplentes: (c, f) => ler(c, (l) => contratosInadimplentesSgh(l, c.hospital, f)),
    reajustes: (c, f) => ler(c, (l) => reajustesSgh(l, c.hospital, f)),
    reajuste: (c, id) => ler(c, (l) => reajusteSgh(l, c.hospital, id)),
    situacaoReajuste: (c, k) => ler(c, (l) => situacaoReajusteDoContratoSgh(l, c.hospital, k)),
    gravarSgh: (c, trilha, fn) => {
      const gravar = nucleo.gravarSgh?.bind(nucleo);
      if (opcoes.sghSoLeitura || !gravar)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: a cobrança da operadora não é gravada.',
            { codigo: 'somente-leitura' },
          ),
        );
      return gravar(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const h = c.hospital;
        const r = await fn({
          incluir: (x) => incluirCobrancaSgh(e, { hospital: h, ...x }),
          baixar: (x) => baixarCobrancaSgh(e, { hospital: h, ...x }),
          cancelar: (x) => cancelarCobrancaSgh(e, { hospital: h, ...x }),
          estornar: (x) => estornarBaixaSgh(e, { hospital: h, ...x }),
          proximoAcordo: () => proximoAcordoSgh(e),
          renegociar: (x) => renegociarCobrancaSgh(e, { hospital: h, ...x }),
          notificar: (x) => notificarCobrancasSgh(e, { hospital: h, ...x }),
          registrarReajuste: (x) => registrarReajusteSgh(e, { hospital: h, ...x }),
          cancelarReajuste: (x) => cancelarReajusteSgh(e, { hospital: h, ...x }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
  };
}

/** Fora de dev/ci sem o núcleo: 503 em tudo (falha fechada). */
export function portaCobrancaOperadoraIndisponivel(): PortaCobrancaOperadora {
  return portaIndisponivel<PortaCobrancaOperadora>(METODOS_PORTA_COBRANCA);
}
