// Porta da digitalização certificada sobre o núcleo do legado (M50, etapa 6): leituras READ ONLY pelos repositórios de
// @sgh/legado; as gravações só do novo numa transação SGH_ com a SGH_TRILHA junto (a assinatura e a validação do M49
// gravadas junto com o documento "assinado"). Em dev sobre a cópia compartilhada, as gravações SGH_ são recusadas
// (`sghSoLeitura`). Nenhuma operação do legado é chamada (o anexo ao prontuário do outro sistema é condicional e fica
// desligado: a DP-22 do M49 não pediu o documento assinado visível lá).
import {
  assinarDigitalizacaoSgh,
  capturarDigitalizacaoSgh,
  conferirDigitalizacaoSgh,
  digitalizacaoSgh,
  digitalizacoesDoProntuario,
  digitalizacoesPorIds,
  filaDigitalizacaoSgh,
  gravarAssinaturaIcp,
  gravarTrilha,
  gravarValidacaoIcp,
  type Leitor,
  hashDigitalizacaoExiste,
  loteDigitalizacaoExiste,
  type NucleoLegado,
  nomesDosPacientes,
  pacienteParaDigitalizacao,
  prontuarioDaInternacao,
  relogioRecepcao,
  somenteSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoDigitalizacao, METODOS_PORTA_DIGITALIZACAO, type PortaDigitalizacao } from './porta.js';

export function portaDigitalizacaoLegado(
  nucleo: NucleoLegado,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaDigitalizacao {
  const ctx = (c: ContextoDigitalizacao) => ({
    rede: c.rede,
    hospital: c.hospital,
    traceId: 'digitalizacao',
  });
  const ler = <T>(c: ContextoDigitalizacao, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    podeGravar: async () => ({
      pode: false,
      codigo: 'sem-operacao',
      motivo: 'A digitalização grava só no novo.',
    }),
    executar: () =>
      Promise.reject(
        new ErroProblema(
          'operacao-bloqueada',
          409,
          'Sem gravação no outro sistema',
          'A digitalização certificada grava só no novo (SGH_HOT_DIGITALIZACAO).',
        ),
      ),
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: a digitalização não grava.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const h = c.hospital;
        const r = await fn({
          capturar: (x) => capturarDigitalizacaoSgh(e, { hospital: h, ...x }),
          conferir: (x) => conferirDigitalizacaoSgh(e, { hospital: h, ...x }),
          assinar: async (x) => {
            const a = await gravarAssinaturaIcp(e, { hospital: h, ...x.assinatura });
            await gravarValidacaoIcp(e, { assinatura: a.id, ...x.validacao });
            await assinarDigitalizacaoSgh(e, {
              hospital: h,
              id: x.id,
              assinatura: a.id,
              carimboEm: x.assinatura.carimboEm,
              usuario: x.usuario,
            });
            return a.id;
          },
          registrarFalha: async (x) => {
            const a = await gravarAssinaturaIcp(e, { hospital: h, ...x.assinatura });
            await gravarValidacaoIcp(e, { assinatura: a.id, ...x.validacao });
            return a.id;
          },
          registrarEvento: async (linha) => {
            await gravarTrilha(e, linha);
          },
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    relogio: async (c) => {
      const r = await ler(c, (l) => relogioRecepcao(l));
      return { agora: r.agora.slice(0, 16), hoje: r.hoje };
    },
    fila: (c, situacao) => ler(c, (l) => filaDigitalizacaoSgh(l, c.hospital, situacao)),
    documento: (c, id) => ler(c, (l) => digitalizacaoSgh(l, c.hospital, id)),
    porIds: (c, ids) => ler(c, (l) => digitalizacoesPorIds(l, c.hospital, ids)),
    doProntuario: (c, pront) => ler(c, (l) => digitalizacoesDoProntuario(l, c.hospital, pront)),
    loteExiste: (c, lote) => ler(c, (l) => loteDigitalizacaoExiste(l, c.hospital, lote)),
    hashExiste: (c, hash) => ler(c, (l) => hashDigitalizacaoExiste(l, c.hospital, hash)),
    paciente: (c, pront) => ler(c, (l) => pacienteParaDigitalizacao(l, pront)),
    prontuarioDaInternacao: (c, reg) => ler(c, (l) => prontuarioDaInternacao(l, reg)),
    nomes: (c, ids) => ler(c, (l) => nomesDosPacientes(l, ids)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaDigitalizacaoIndisponivel(): PortaDigitalizacao {
  return portaIndisponivel<PortaDigitalizacao>(METODOS_PORTA_DIGITALIZACAO);
}
