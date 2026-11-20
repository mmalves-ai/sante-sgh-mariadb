// Porta da agência transfusional (M47, etapa 1) sobre o núcleo do legado: leituras READ ONLY pelos repositórios de
// @sgh/legado; as gravações só do novo (SGH_SADT_HEMO_*, os sinais em SGH_PEP_SINAL_VITAL e o ganho em SGH_PEP_BALANCO)
// numa transação SGH_ com a SGH_TRILHA junto (o escritor só das SGH_: nenhuma tabela do legado). Em dev sobre a cópia
// compartilhada, as gravações SGH_ são recusadas (`sghSoLeitura`), como nos outros módulos. O início com o horário da
// prescrição pendente não passa por aqui: vai pela checagem do M25 (porta da enfermagem, executor).
import {
  adendoAtoTransfusionalSgh,
  adendosDosAtos,
  alterarRequisicaoTransfusaoSgh,
  atosTransfusionais,
  bolsaJaUsada,
  cancelarRequisicaoSgh,
  concluirTransfusaoSgh,
  gravadoPelaChave,
  gravarTrilha,
  horariosDoItemHemoterapia,
  iniciarTransfusaoSgh,
  itemHemoterapiaPorId,
  itensHemoterapiaAAtender,
  type Leitor,
  marcarNotificacaoEnviadaSgh,
  type NucleoLegado,
  reacoesTransfusionais,
  registrarAmostraTransfusionalSgh,
  registrarReacaoTransfusionalSgh,
  registrarSinaisTransfusaoSgh,
  requisicaoTransfusional,
  requisicoesTransfusionais,
  requisitarTransfusaoSgh,
  sexoENascimento,
  somenteSgh,
  tclesDoPaciente,
  tipagemDoCadastro,
  versoesDaRequisicao,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoTransfusao,
  METODOS_PORTA_TRANSFUSAO,
  type PortaTransfusao,
} from './transfusao-porta.js';

const data = (agora: string) => new Date(`${agora.slice(0, 19)}`);

export function portaTransfusaoLegado(
  nucleo: NucleoLegado,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaTransfusao {
  const ctx = (c: ContextoTransfusao) => ({ rede: c.rede, hospital: c.hospital, traceId: 'transfusao' });
  const ler = <T>(c: ContextoTransfusao, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    // Operações só do novo: nenhuma receita do executor (a liberação é a da funcionalidade, pela chave).
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: (_c, op) =>
      Promise.reject(
        new Error(`Operação ${op} sem receita do executor nesta porta: a checagem vai pela enfermagem.`),
      ),
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: nada é gravado.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const h = c.hospital;
        const r = await fn({
          requisitar: (x) => requisitarTransfusaoSgh(e, { hospital: h, ...x }),
          cancelar: (x) => cancelarRequisicaoSgh(e, { hospital: h, ...x }),
          amostra: (x) => registrarAmostraTransfusionalSgh(e, { hospital: h, ...x }),
          iniciar: (x) => iniciarTransfusaoSgh(e, { hospital: h, ...x }),
          sinais: (x) => registrarSinaisTransfusaoSgh(e, { hospital: h, ...x }),
          concluir: (x) => concluirTransfusaoSgh(e, { hospital: h, ...x }),
          reacao: (x) => registrarReacaoTransfusionalSgh(e, { hospital: h, ...x }),
          notificada: (x) => marcarNotificacaoEnviadaSgh(e, { hospital: h, ...x }),
          alterar: (x) => alterarRequisicaoTransfusaoSgh(e, { hospital: h, ...x }),
          adendo: (x) => adendoAtoTransfusionalSgh(e, { hospital: h, ...x }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    itensAAtender: (c, o) =>
      ler(c, async (l) => {
        // Os já requisitados saem na própria consulta (antes do teto).
        const r = await itensHemoterapiaAAtender(l, {
          agora: data(o.agora),
          hospital: c.hospital,
          ...(o.atendimento !== undefined ? { atendimento: o.atendimento } : {}),
        });
        return { itens: [...r.itens], cortada: r.cortada };
      }),
    item: (c, item) => ler(c, (l) => itemHemoterapiaPorId(l, item)),
    horarios: (c, item) => ler(c, async (l) => [...(await horariosDoItemHemoterapia(l, item))]),
    tipagem: (c, p) => ler(c, (l) => tipagemDoCadastro(l, p)),
    termos: (c, p) => ler(c, (l) => tclesDoPaciente(l, c.hospital, p)),
    requisicoes: (c, f) =>
      ler(c, async (l) => {
        const r = await requisicoesTransfusionais(l, { hospital: c.hospital, ...f });
        return { itens: [...r.itens], cortada: r.cortada };
      }),
    requisicao: (c, id, agora) => ler(c, (l) => requisicaoTransfusional(l, c.hospital, id, agora)),
    atos: (c, f) => ler(c, async (l) => [...(await atosTransfusionais(l, { hospital: c.hospital, ...f }))]),
    reacoes: (c, f) =>
      ler(c, async (l) => [...(await reacoesTransfusionais(l, { hospital: c.hospital, ...f }))]),
    bolsaUsada: (c, n) => ler(c, (l) => bolsaJaUsada(l, c.hospital, n)),
    pessoa: (c, p) => ler(c, (l) => sexoENascimento(l, p)),
    versoesRequisicao: (c, id) => ler(c, async (l) => [...(await versoesDaRequisicao(l, c.hospital, id))]),
    adendos: (c, atos) =>
      ler(c, async (l) => [...(await adendosDosAtos(l, c.hospital, atos)).values()].flat()),
    gravadoPorChave: (c, o) =>
      ler(c, (l) =>
        gravadoPelaChave(l, o.tipo === 'ato' ? 'SGH_SADT_HEMO_ATO' : 'SGH_SADT_HEMO_REQ', o.chave, o.usuario),
      ),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaTransfusaoIndisponivel(): PortaTransfusao {
  return portaIndisponivel<PortaTransfusao>(METODOS_PORTA_TRANSFUSAO);
}
