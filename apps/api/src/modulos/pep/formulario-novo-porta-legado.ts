// Porta do construtor de formulários novos sobre o núcleo do legado (M45, etapa 1): leituras READ ONLY pelos
// repositórios de @sgh/legado; as gravações só do novo (SGH_PEP_FORMNOVO*) numa transação SGH_ com a SGH_TRILHA junto;
// a publicação como modelo do prontuário pelo executor (receita `pep.publicarFormularioNovo`). Em dev sobre a cópia
// compartilhada, as gravações SGH_ são recusadas (`sghSoLeitura`), como nos outros módulos.
import {
  buscarPerguntasDoBanco,
  codigosDeModelo,
  codigosFormularioNovo,
  especialidadesDoModelo,
  eventosFormularioNovo,
  type Executor,
  type FonteCatalogo,
  formularioNovo,
  formulariosNovos,
  gravarTrilha,
  hojeFormularioNovo,
  type Leitor,
  type MetricasExecutor,
  mudarFormNovoSgh,
  type NucleoLegado,
  operacao,
  perguntasDoBancoPorId,
  respostasCadastradasPorTexto,
  salvarFormNovoSgh,
  somenteSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoFormularioNovo,
  METODOS_PORTA_FORMULARIO_NOVO,
  type PortaFormularioNovo,
} from './formulario-novo-porta.js';

export function portaFormularioNovoLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaFormularioNovo {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoFormularioNovo) => ({
    rede: c.rede,
    hospital: c.hospital,
    traceId: 'formulario-novo',
  });
  const ler = <T>(c: ContextoFormularioNovo, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx);
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: o formulário não é gravado.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const r = await fn({
          salvar: (p) => salvarFormNovoSgh(e, { hospital: c.hospital, ...p }),
          mudar: (m) => mudarFormNovoSgh(e, { hospital: c.hospital, ...m }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    versoes: (c) => ler(c, (l) => formulariosNovos(l, c.hospital)),
    versao: (c, id) => ler(c, (l) => formularioNovo(l, c.hospital, id)),
    eventos: (c, id) => ler(c, (l) => eventosFormularioNovo(l, c.hospital, id)),
    codigosEmUso: (c) =>
      ler(c, async (l) => {
        const s = await codigosDeModelo(l);
        for (const x of await codigosFormularioNovo(l, c.hospital)) s.add(x);
        return s;
      }),
    buscarPerguntas: (c, termo, tipos) => ler(c, (l) => buscarPerguntasDoBanco(l, termo, tipos)),
    especialidades: (c) => ler(c, (l) => especialidadesDoModelo(l)),
    hoje: (c) => ler(c, (l) => hojeFormularioNovo(l)),
    dadosDoPlano: (c, codigo, reusos, textos) =>
      ler(c, async (l) => {
        const codigosExistentes = await codigosDeModelo(l);
        for (const x of await codigosFormularioNovo(l, c.hospital))
          if (x !== codigo.toUpperCase()) codigosExistentes.add(x);
        return {
          codigosExistentes,
          banco: reusos.length ? await perguntasDoBancoPorId(l, reusos) : [],
          respostasCadastradas: textos.length ? await respostasCadastradasPorTexto(l, textos) : [],
        };
      }),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaFormularioNovoIndisponivel(): PortaFormularioNovo {
  return portaIndisponivel<PortaFormularioNovo>(METODOS_PORTA_FORMULARIO_NOVO);
}
