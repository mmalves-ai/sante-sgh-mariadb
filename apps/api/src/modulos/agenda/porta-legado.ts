// Porta da agenda sobre o núcleo do legado (M17): leituras READ ONLY pelos repositórios de @sgh/legado; gravações
// pelo EXECUTOR (receitas agenda.*, com a trilha na mesma transação); as gravações só do novo em transação SGH_ com
// a SGH_TRILHA junto. Fora de dev/ci, sem o núcleo, a porta indisponível responde 503 (falha fechada).
import {
  bloqueiosDoNovo,
  horariosDoBloqueio,
  buscarVagas,
  cancelamentos,
  cancelamentosPorMotivo,
  cancelarEscalaPlanejada,
  coberturaDasAgendas,
  confirmacoesDaMarcacao,
  contagensIndicadores,
  conveniosDaAgenda,
  encerrarBloqueios,
  encerrarEspera,
  type Escritor,
  escalaDaAgenda,
  escalasPlanejadas,
  especialidadesDaAgenda,
  type Executor,
  feriadosDoPeriodo,
  type FonteCatalogo,
  geracoesDaAgenda,
  geracoesDoNovo,
  lerGeracaoDoNovo,
  gravarBloqueio,
  gravarConfirmacao,
  gravarLigacao,
  gravarTrilha,
  horariosDaJanela,
  horasMarcadasNoDia,
  incluirEspera,
  type Leitor,
  lerAgenda,
  lerMarcacao,
  lerPacientesPorIds,
  ligacoesDasAgendas,
  listaEspera,
  listarAgendas,
  marcacoesDaJanela,
  marcacoesDoDia,
  marcacoesDoPaciente,
  marcacoesExt,
  type MetricasExecutor,
  type NucleoLegado,
  ofertarEspera,
  opcoesDaAgenda,
  operacao,
  planejarEscala,
  profissionaisParaLigacao,
  proximasVagas,
  relogioDaAgenda,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoAgenda, GravadorSghAgenda, PortaAgenda } from './porta.js';

function gravadorSgh(e: Escritor, hospital: string): GravadorSghAgenda {
  return {
    planejarEscala: (r) => planejarEscala(e, { hospital, ...r }),
    cancelarEscalaPlanejada: (r) => cancelarEscalaPlanejada(e, { hospital, ...r }),
    gravarConfirmacao: (r) => gravarConfirmacao(e, { hospital, ...r }),
    gravarBloqueioPeriodo: (r) => gravarBloqueio(e, { hospital, ...r, horarios: [] }),
    async encerrarBloqueio(r) {
      const n = await encerrarBloqueios(e, { hospital, agenda: r.agenda, ids: [r.id], usuario: r.usuario });
      if (n !== 1)
        throw new ErroProblema(
          'nao-encontrado',
          404,
          'Bloqueio não encontrado',
          'O bloqueio não existe ou já foi encerrado.',
        );
    },
    incluirEspera: (r) => incluirEspera(e, { hospital, ...r }),
    ofertarEspera: (r) => ofertarEspera(e, { hospital, ...r }),
    encerrarEspera: (r) => encerrarEspera(e, { hospital, ...r }),
    gravarLigacao: (r) => gravarLigacao(e, { hospital, ...r }),
  };
}

export function portaAgendaLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
): PortaAgenda {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoAgenda) => ({ rede: c.rede, hospital: c.hospital, traceId: 'agenda' });
  const ler = <T>(c: ContextoAgenda, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx);
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
    gravarSgh: (c, trilha, fn) =>
      nucleo.gravarSgh(ctx(c), async (e) => {
        const r = await fn(gravadorSgh(e, c.hospital));
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      }),
    relogio: (c) => ler(c, (l) => relogioDaAgenda(l)),
    agendas: (c) => ler(c, (l) => listarAgendas(l)),
    agenda: (c, id) => ler(c, (l) => lerAgenda(l, id)),
    conveniosDaAgenda: (c, id) => ler(c, (l) => conveniosDaAgenda(l, id)),
    cobertura: (c, ids) => ler(c, (l) => coberturaDasAgendas(l, ids)),
    especialidadesDaAgenda: (c, id) => ler(c, (l) => especialidadesDaAgenda(l, id)),
    opcoes: (c) => ler(c, (l) => opcoesDaAgenda(l)),
    escala: (c, nome, crm) => ler(c, (l) => escalaDaAgenda(l, nome, crm)),
    geracoes: (c, nome, crm) => ler(c, (l) => geracoesDaAgenda(l, nome, crm)),
    feriados: (c, de, ate) => ler(c, (l) => feriadosDoPeriodo(l, de, ate)),
    horarios: (c, nome, crm, de, ate) => ler(c, (l) => horariosDaJanela(l, nome, crm, de, ate)),
    horasMarcadas: (c, nome, crm, data) => ler(c, (l) => horasMarcadasNoDia(l, nome, crm, data)),
    marcacoesDaJanela: (c, nome, crm, de, ate) => ler(c, (l) => marcacoesDaJanela(l, nome, crm, de, ate)),
    marcacoesDoDia: (c, data) => ler(c, (l) => marcacoesDoDia(l, data)),
    marcacao: (c, id) => ler(c, (l) => lerMarcacao(l, id)),
    marcacoesDoPaciente: (c, id) => ler(c, (l) => marcacoesDoPaciente(l, id)),
    vagas: (c, f) => ler(c, (l) => buscarVagas(l, f)),
    proximasVagas: (c, ags, depois, ate) => ler(c, (l) => proximasVagas(l, ags, depois, ate)),
    cancelamentos: (c, f) => ler(c, (l) => cancelamentos(l, c.hospital, f)),
    indicadores: (c, de, ate) => ler(c, (l) => contagensIndicadores(l, de, ate)),
    pacientes: async (c, ids) =>
      ids.length === 0
        ? []
        : (await ler(c, (l) => lerPacientesPorIds(l, ids))).map((p) => ({
            id: p.id,
            nome: p.nome,
            prontuario: p.prontuario,
          })),
    marcacoesExt: (c, ids) => ler(c, (l) => marcacoesExt(l, c.hospital, ids)),
    geracoesDoNovo: (c, agenda) => ler(c, (l) => geracoesDoNovo(l, c.hospital, agenda)),
    agendaDaGeracao: async (c, id) =>
      (await ler(c, (l) => lerGeracaoDoNovo(l, c.hospital, id)))?.agenda ?? null,
    bloqueios: (c, f) => ler(c, (l) => bloqueiosDoNovo(l, c.hospital, f)),
    horariosDoBloqueio: (c, id) => ler(c, (l) => horariosDoBloqueio(l, c.hospital, id)),
    confirmacoes: (c, m) => ler(c, (l) => confirmacoesDaMarcacao(l, c.hospital, m)),
    escalasPlanejadas: (c, agenda) => ler(c, (l) => escalasPlanejadas(l, c.hospital, agenda)),
    espera: (c, f) => ler(c, (l) => listaEspera(l, c.hospital, f)),
    ligacoes: (c) => ler(c, (l) => ligacoesDasAgendas(l, c.hospital)),
    profissionais: (c) => ler(c, (l) => profissionaisParaLigacao(l)),
    cancelamentosPorMotivo: (c, de, ate) => ler(c, (l) => cancelamentosPorMotivo(l, c.hospital, de, ate)),
  };
}

const METODOS_DA_PORTA: ReadonlySet<string> = new Set([
  'executar',
  'gravarSgh',
  'relogio',
  'agendas',
  'agenda',
  'conveniosDaAgenda',
  'cobertura',
  'especialidadesDaAgenda',
  'opcoes',
  'escala',
  'geracoes',
  'feriados',
  'horarios',
  'horasMarcadas',
  'marcacoesDaJanela',
  'marcacoesDoDia',
  'marcacao',
  'marcacoesDoPaciente',
  'vagas',
  'proximasVagas',
  'cancelamentos',
  'indicadores',
  'pacientes',
  'marcacoesExt',
  'geracoesDoNovo',
  'agendaDaGeracao',
  'bloqueios',
  'horariosDoBloqueio',
  'confirmacoes',
  'escalasPlanejadas',
  'espera',
  'ligacoes',
  'profissionais',
  'cancelamentosPorMotivo',
]);

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaAgendaIndisponivel(): PortaAgenda {
  const recusa = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
      ),
    );
  const p = new Proxy(
    {},
    {
      get: (_t, chave) => {
        if (chave === 'destino') return 'legado';
        if (chave === 'podeGravar')
          return async () => ({
            pode: false,
            codigo: 'indisponivel',
            motivo: 'O banco do estabelecimento não está configurado: nada é gravado.',
          });
        // Só os métodos da porta: o Nest procura ganchos (onModuleInit…) e `then` em todo provedor.
        return typeof chave === 'string' && METODOS_DA_PORTA.has(chave) ? recusa : undefined;
      },
    },
  );
  return p as PortaAgenda;
}
