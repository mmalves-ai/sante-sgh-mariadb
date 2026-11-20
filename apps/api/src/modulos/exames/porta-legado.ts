// Porta da agenda de exames sobre o núcleo do legado (M18): leituras READ ONLY pelos repositórios de @sgh/legado;
// gravações pelo EXECUTOR (receitas agenda.*Exame, com a trilha na mesma transação); a cobertura por exame (só do
// novo) em transação SGH_ com a SGH_TRILHA junto. Fora de dev/ci, sem o núcleo, a porta indisponível responde 503.
import {
  cancelamentosExame,
  coberturaExameDoNovo,
  conveniosDaAgendaExame,
  encerrarCoberturaExame,
  type Executor,
  escalaExameLida,
  extensoesExame,
  feriadosDoPeriodo,
  type FonteCatalogo,
  geracoesExame,
  gravarTrilha,
  horariosExame,
  incluirCoberturaExame,
  type Leitor,
  lerAgendaExame,
  lerMarcacaoExame,
  listarAgendasExame,
  marcacoesExameDoDia,
  marcacoesExameDoPaciente,
  type MetricasExecutor,
  type NucleoLegado,
  operacao,
  opcoesExame,
  relogioDaAgenda,
  residuoExame,
  vagasExame,
} from '@sgh/legado';
import { type ContextoPortaM18, portaIndisponivel } from './apoio-gravacao.js';
import { METODOS_PORTA_EXAME, type PortaExame } from './porta.js';

export function portaExameLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
): PortaExame {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoPortaM18) => ({ rede: c.rede, hospital: c.hospital, traceId: 'exame' });
  const ler = <T>(c: ContextoPortaM18, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
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
        const r = await fn({
          incluirCobertura: (x) => incluirCoberturaExame(e, { hospital: c.hospital, ...x }),
          encerrarCobertura: (x) => encerrarCoberturaExame(e, { hospital: c.hospital, ...x }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      }),
    relogio: (c) => ler(c, (l) => relogioDaAgenda(l)),
    agendas: (c) => ler(c, (l) => listarAgendasExame(l)),
    agenda: (c, id) => ler(c, (l) => lerAgendaExame(l, id)),
    convenios: (c, id) => ler(c, (l) => conveniosDaAgendaExame(l, id)),
    escala: (c, nome, crm) => ler(c, (l) => escalaExameLida(l, nome, crm)),
    geracoes: (c, nome, crm) => ler(c, (l) => geracoesExame(l, nome, crm)),
    feriados: (c, de, ate) => ler(c, (l) => feriadosDoPeriodo(l, de, ate)),
    horarios: (c, nome, crm, de, ate) => ler(c, (l) => horariosExame(l, nome, crm, de, ate)),
    vagas: (c, f) => ler(c, (l) => vagasExame(l, f)),
    marcacoesDoDia: (c, data, agenda) => ler(c, (l) => marcacoesExameDoDia(l, data, agenda)),
    marcacoesDoPaciente: (c, id) => ler(c, (l) => marcacoesExameDoPaciente(l, id)),
    marcacao: (c, id) => ler(c, (l) => lerMarcacaoExame(l, id)),
    cancelamentos: (c, f) => ler(c, (l) => cancelamentosExame(l, f)),
    residuo: (c, de, ate) => ler(c, (l) => residuoExame(l, de, ate)),
    opcoes: (c) => ler(c, (l) => opcoesExame(l)),
    extensoes: (c, ids) => ler(c, (l) => extensoesExame(l, c.hospital, ids)),
    cobertura: (c, agenda) => ler(c, (l) => coberturaExameDoNovo(l, c.hospital, agenda)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaExameIndisponivel(): PortaExame {
  return portaIndisponivel<PortaExame>(METODOS_PORTA_EXAME);
}
