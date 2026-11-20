// Porta das especialidades sob demanda e do lactário sobre o núcleo do legado (M45, etapa 6): leituras READ ONLY pelos
// repositórios de @sgh/legado; as gravações só do novo numa transação SGH_ com a SGH_TRILHA junto. Em dev sobre a cópia
// compartilhada, as gravações SGH_ são recusadas (`sghSoLeitura`), como nos outros módulos.
import {
  cadastrosOftalmologia,
  cicloOncologico,
  ciclosAValidar,
  ciclosDoPaciente,
  conferirOrdemLactarioSgh,
  type Executor,
  examesOftalmologicos,
  type FonteCatalogo,
  gravarTrilha,
  internacaoParaEspecialidade,
  internacoesAbertas,
  type Leitor,
  type MetricasExecutor,
  type NucleoLegado,
  operacao,
  ordemLactario,
  ordensLactarioDoDia,
  partogramaDaInternacao,
  prescricoesDaInternacaoNoDia,
  protocoloOncologico,
  protocolosOncologicos,
  publicarProtocoloOncologicoSgh,
  recemNascidosDaInternacao,
  registrarCicloOncologicoSgh,
  registrarExameOftalmologicoSgh,
  registrarOrdemLactarioSgh,
  registrarPartogramaSgh,
  registrarRecemNascidoSgh,
  relogioRecepcao,
  somenteSgh,
  tiposDeParto,
  tiposDeProtocoloOncologico,
  validarCicloOncologicoSgh,
  vincularPrescricaoCicloSgh,
  vinculosEspecialidadeDoLogin,
  ajustarCicloOncologicoSgh,
  alteracoesHot,
  alterarOrdemLactarioSgh,
  cancelarOrdemLactarioSgh,
  ciclosDaVersao,
  desligarPrescricaoCicloSgh,
  eventosDosCiclos,
  eventosDosProtocolos,
  marcarEtiquetaLactarioSgh,
  mudarAndamentoCicloSgh,
  registrarAlteracaoHotSgh,
  registrarEventoOncoSgh,
  revogarVersaoProtocoloSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type ContextoEspecialidades,
  METODOS_PORTA_ESPECIALIDADES,
  type PortaEspecialidades,
} from './porta.js';

export function portaEspecialidadesLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaEspecialidades {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoEspecialidades) => ({
    rede: c.rede,
    hospital: c.hospital,
    traceId: 'especialidades',
  });
  const ler = <T>(c: ContextoEspecialidades, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
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
            'Neste ambiente de desenvolvimento o banco é só de leitura: as especialidades e o lactário não gravam.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const h = c.hospital;
        const r = await fn({
          registrarExame: (x) => registrarExameOftalmologicoSgh(e, { hospital: h, ...x }),
          publicarProtocolo: (x) => publicarProtocoloOncologicoSgh(e, { hospital: h, ...x }),
          registrarCiclo: (x) => registrarCicloOncologicoSgh(e, { hospital: h, ...x }),
          validarCiclo: (x) => validarCicloOncologicoSgh(e, { hospital: h, ...x }),
          vincularPrescricao: (x) => vincularPrescricaoCicloSgh(e, { hospital: h, ...x }),
          registrarPartograma: (x) => registrarPartogramaSgh(e, { hospital: h, ...x }),
          registrarRecemNascido: (x) => registrarRecemNascidoSgh(e, { hospital: h, ...x }),
          registrarOrdem: (x) => registrarOrdemLactarioSgh(e, { hospital: h, ...x }),
          conferirOrdem: (x) => conferirOrdemLactarioSgh(e, { hospital: h, ...x }),
          registrarEventoOnco: (x) => registrarEventoOncoSgh(e, { hospital: h, ...x }),
          revogarVersao: (x) => revogarVersaoProtocoloSgh(e, { hospital: h, ...x }),
          mudarAndamentoCiclo: (x) => mudarAndamentoCicloSgh(e, { hospital: h, ...x }),
          ajustarCiclo: (x) => ajustarCicloOncologicoSgh(e, { hospital: h, ...x }),
          desligarPrescricao: (x) => desligarPrescricaoCicloSgh(e, { hospital: h, ...x }),
          alterarOrdem: (x) => alterarOrdemLactarioSgh(e, { hospital: h, ...x }),
          cancelarOrdem: (x) => cancelarOrdemLactarioSgh(e, { hospital: h, ...x }),
          marcarEtiqueta: (x) => marcarEtiquetaLactarioSgh(e, { hospital: h, ...x }),
          registrarAlteracao: (x) => registrarAlteracaoHotSgh(e, { hospital: h, ...x }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    relogio: async (c) => {
      const r = await ler(c, (l) => relogioRecepcao(l));
      return { agora: r.agora.slice(0, 16), hoje: r.hoje };
    },
    vinculos: (c, login) => ler(c, (l) => vinculosEspecialidadeDoLogin(l, login)),
    internacoes: async (c, termo) => {
      const r = await ler(c, (l) => internacoesAbertas(l, { termo, intensivas: [] }));
      return {
        itens: r.itens.map((i) => ({
          reg: i.reg,
          prontuario: i.prontuario,
          nome: i.nome,
          leito: i.leito,
          entrada: `${i.entrada}T${i.horaEntrada.slice(0, 2)}:${i.horaEntrada.slice(2, 4)}`,
        })),
        cortada: r.cortada,
      };
    },
    internacao: (c, reg) => ler(c, (l) => internacaoParaEspecialidade(l, reg)),
    cadastrosOftalmologia: (c) => ler(c, (l) => cadastrosOftalmologia(l)),
    tiposProtocolo: (c) => ler(c, (l) => tiposDeProtocoloOncologico(l)),
    tiposParto: (c) => ler(c, (l) => tiposDeParto(l)),
    exames: (c, reg) => ler(c, (l) => examesOftalmologicos(l, c.hospital, reg)),
    protocolos: (c) => ler(c, (l) => protocolosOncologicos(l, c.hospital)),
    protocolo: (c, id) => ler(c, (l) => protocoloOncologico(l, c.hospital, id)),
    ciclosDoPaciente: (c, paciente) => ler(c, (l) => ciclosDoPaciente(l, c.hospital, paciente)),
    ciclo: (c, id) => ler(c, (l) => cicloOncologico(l, c.hospital, id)),
    ciclosAValidar: (c) => ler(c, (l) => ciclosAValidar(l, c.hospital)),
    prescricoesDoDia: (c, reg, paciente, dia) =>
      ler(c, (l) => prescricoesDaInternacaoNoDia(l, reg, paciente, dia)),
    partograma: (c, reg) => ler(c, (l) => partogramaDaInternacao(l, c.hospital, reg)),
    recemNascidos: (c, reg) => ler(c, (l) => recemNascidosDaInternacao(l, c.hospital, reg)),
    ordensDoDia: (c, dia) => ler(c, (l) => ordensLactarioDoDia(l, c.hospital, dia)),
    ordem: (c, id) => ler(c, (l) => ordemLactario(l, c.hospital, id)),
    eventosProtocolos: (c) => ler(c, (l) => eventosDosProtocolos(l, c.hospital)),
    eventosCiclos: (c, ids) => ler(c, (l) => eventosDosCiclos(l, c.hospital, ids)),
    ciclosDaVersao: (c, protocolo) => ler(c, (l) => ciclosDaVersao(l, c.hospital, protocolo)),
    alteracoesOrdens: (c, ids) => ler(c, (l) => alteracoesHot(l, c.hospital, 'SGH_HOT_LACTARIO_ORDEM', ids)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaEspecialidadesIndisponivel(): PortaEspecialidades {
  return portaIndisponivel<PortaEspecialidades>(METODOS_PORTA_ESPECIALIDADES);
}
