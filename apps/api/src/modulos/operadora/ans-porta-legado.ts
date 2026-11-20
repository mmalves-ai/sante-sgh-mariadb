// Porta das obrigações com a ANS sobre o núcleo do legado (M56, etapa 7, F6): cada leitura numa transação curta READ
// ONLY no banco do estabelecimento; as gravações só do novo (SGH_OPE_ENVIO_ANS, _ITEM, _EVT e SGH_OPE_BENEF_SIB) numa
// transação SGH_ com a SGH_TRILHA junto (`somenteSgh` recusa qualquer escrita fora de SGH_). Em dev sobre a cópia
// compartilhada, as gravações são recusadas (`sghSoLeitura`).
import {
  arquivoEnvioAnsSgh,
  atendimentosJaCobradosSgh,
  ativosNaDataSgh,
  beneficiarioDaOperadoraSgh,
  beneficiariosRessarcimentoSgh,
  beneficiariosSibSgh,
  camposSibLidos,
  cobrancasDiopsSgh,
  complementoSibSgh,
  contasDiopsSgh,
  decidirItemRessarcimentoSgh,
  envioAnsSgh,
  enviosAnsSgh,
  enviosExistentesSgh,
  eventosEnvioAnsSgh,
  gerarEnvioAnsSgh,
  gravarComplementoSibSgh,
  gravarTrilha,
  gruposSip,
  guiasMonitoramentoSgh,
  itensEnvioAnsSgh,
  itensSipSgh,
  type Leitor,
  motivosSibLidos,
  type NucleoLegado,
  operadorasSgh,
  pagarGruAnsSgh,
  planosDaOperadoraSgh,
  registrarRetornoAnsSgh,
  relogioRecepcao,
  somenteSgh,
  totaisEnviosAnsSgh,
  transmitirEnvioAnsSgh,
  valoresTpsLidos,
  vigenciasSipSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoAns, METODOS_PORTA_ANS, type PortaAnsOperadora } from './ans-porta.js';

export function portaAnsOperadoraLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente' | 'gravarSgh'>,
  opcoes: { readonly sghSoLeitura?: boolean } = {},
): PortaAnsOperadora {
  const ctx = (c: ContextoAns) => ({ rede: c.rede, hospital: c.hospital, traceId: 'operadora-ans' });
  const ler = <T>(c: ContextoAns, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    relogio: (c) =>
      ler(c, async (l) => {
        const r = await relogioRecepcao(l);
        return { hoje: r.hoje, agora: r.agora.slice(0, 19).replace(' ', 'T') };
      }),
    operadoras: (c) => ler(c, (l) => operadorasSgh(l, c.hospital)),
    motivosSib: (c) => ler(c, (l) => motivosSibLidos(l)),
    camposSib: (c) => ler(c, (l) => camposSibLidos(l)),
    valoresTps: (c) => ler(c, (l) => valoresTpsLidos(l)),
    gruposSip: (c) => ler(c, (l) => gruposSip(l)),
    envios: (c, f) => ler(c, (l) => enviosAnsSgh(l, c.hospital, f)),
    totais: (c) => ler(c, (l) => totaisEnviosAnsSgh(l, c.hospital)),
    envio: (c, id) => ler(c, (l) => envioAnsSgh(l, c.hospital, id)),
    arquivo: (c, id) => ler(c, (l) => arquivoEnvioAnsSgh(l, c.hospital, id)),
    itens: (c, id) => ler(c, (l) => itensEnvioAnsSgh(l, c.hospital, id)),
    eventos: (c, id) => ler(c, (l) => eventosEnvioAnsSgh(l, c.hospital, id)),
    existentes: (c, o, ob, comp) => ler(c, (l) => enviosExistentesSgh(l, c.hospital, o, ob, comp)),
    beneficiariosSib: (c, o, apos) => ler(c, (l) => beneficiariosSibSgh(l, c.hospital, o, apos)),
    complementoSib: (c, b) => ler(c, (l) => complementoSibSgh(l, c.hospital, b)),
    beneficiarioDaOperadora: (c, b) => ler(c, (l) => beneficiarioDaOperadoraSgh(l, c.hospital, b)),
    ativosNaData: (c, o, d) => ler(c, (l) => ativosNaDataSgh(l, c.hospital, o, d)),
    planos: (c, o) => ler(c, (l) => planosDaOperadoraSgh(l, c.hospital, o)),
    itensSip: (c, o, i, f, apos) => ler(c, (l) => itensSipSgh(l, c.hospital, o, i, f, apos)),
    vigenciasSip: (c, ps) => ler(c, (l) => vigenciasSipSgh(l, ps)),
    cobrancasDiops: (c, o, m, i, f) => ler(c, (l) => cobrancasDiopsSgh(l, c.hospital, o, m, i, f)),
    contasDiops: (c, o, i, f) => ler(c, (l) => contasDiopsSgh(l, c.hospital, o, i, f)),
    guiasMonitoramento: (c, o, i, f, t) => ler(c, (l) => guiasMonitoramentoSgh(l, c.hospital, o, i, f, t)),
    beneficiariosRessarcimento: (c, o, ids) =>
      ler(c, (l) => beneficiariosRessarcimentoSgh(l, c.hospital, o, ids)),
    atendimentosJaCobrados: (c, a) => ler(c, (l) => atendimentosJaCobradosSgh(l, c.hospital, a)),
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: os envios à ANS não são gravados.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const h = c.hospital;
        const r = await fn({
          gerar: (x) => gerarEnvioAnsSgh(e, { hospital: h, ...x }),
          transmitir: (x) => transmitirEnvioAnsSgh(e, { hospital: h, ...x }),
          retorno: (x) => registrarRetornoAnsSgh(e, { hospital: h, ...x }),
          pagar: (x) => pagarGruAnsSgh(e, { hospital: h, ...x }),
          decidir: (x) => decidirItemRessarcimentoSgh(e, { hospital: h, ...x }),
          complemento: (x) => gravarComplementoSibSgh(e, { hospital: h, ...x }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
  };
}

/** Fora de dev/ci sem o núcleo: 503 em tudo (falha fechada). */
export function portaAnsOperadoraIndisponivel(): PortaAnsOperadora {
  return portaIndisponivel<PortaAnsOperadora>(METODOS_PORTA_ANS);
}
