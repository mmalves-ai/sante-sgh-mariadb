// Porta da enfermagem sobre o núcleo do legado (M25): leituras READ ONLY pelos repositórios de @sgh/legado; a checagem
// pelo EXECUTOR (receita enfermagem.checarAdministracao, com a trilha na mesma transação); as gravações só do novo em
// transação SGH_ com a SGH_TRILHA junto e, no conflito de sincronização, o aviso na SGH_OUTBOX (enfermeiro e
// farmácia). Em dev sobre a cópia compartilhada, o executor só de leitura recusa as gravações (como nos outros
// módulos).
import {
  type InternadoLido,
  alterarDispositivo,
  cancelarPlantao,
  excluirDispositivo,
  aprazamentosDosHorarios,
  atosDosHorarios,
  conflitosSync,
  dispositivoAutorizado,
  dispositivosDaBeiraLeito,
  eventosDeInfusao,
  type Executor,
  faixasDoHorario,
  type FonteCatalogo,
  gravarAprazamento,
  gravarDispositivo,
  gravarEventoInfusao,
  gravarRespostaExt,
  gravarSinalVital,
  gravarTrilha,
  hashAparelho,
  historicoDoHorario,
  horarioPorId,
  horariosDosAtendimentos,
  internadoDoAtendimento,
  internadosDaUnidade,
  laboratorioDoPaciente,
  type Leitor,
  marcarSincronismo,
  type MetricasExecutor,
  mudancasNaJanela,
  nomesDosVinculos,
  type NucleoLegado,
  operacao,
  passagensDePlantao,
  passarPlantao,
  registrarConflitoSync,
  registrarEstornoPedido,
  regrasDeHorario,
  relogioRecepcao,
  resolverConflitoSync,
  responderPlantao,
  retificarSinalVital,
  sinaisDoPaciente,
  sinalParaRetificar,
  situacoesDosHorarios,
  ultimosSinais,
  extrasDaContingencia,
  unidadesDeInternacao,
  vinculosDeEnfermagem,
} from '@sgh/legado';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoEnfermagem, METODOS_PORTA_ENFERMAGEM, type PortaEnfermagem } from './porta.js';

/** Hora local em texto → Date local (o processo roda em UTC: os componentes são os do banco). */
export function dataLocal(t: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(t);
  if (!m) throw new Error(`Hora inválida: ${t}`);
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
    Number(m[6] ?? 0),
  );
}

export function portaEnfermagemLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
): PortaEnfermagem {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoEnfermagem) => ({ rede: c.rede, hospital: c.hospital, traceId: 'enfermagem' });
  const ler = <T>(c: ContextoEnfermagem, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    podeGravar: (c, op, usuarioLegado) =>
      executor.liberacao(operacao(op), { rede: c.rede, hospital: c.hospital, usuarioLegado }),
    async executar(c, op, entrada, octx) {
      const r = await executor.executar(operacao(op), c.hospital, entrada, octx);
      return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
    },
    gravarSgh: (c, trilha, fn) =>
      nucleo.gravarSghComOutbox(ctx(c), async (e, outbox) => {
        const h = c.hospital;
        // O conflito já registrado pela mesma chave do ato (repetição da sincronização): nada vai à trilha.
        let semEfeito = false;
        const r = await fn({
          gravarSinal: (x) => gravarSinalVital(e, { hospital: h, ...x }),
          retificarSinal: (x) => retificarSinalVital(e, { hospital: h, ...x }),
          gravarEventoInfusao: (x) => gravarEventoInfusao(e, { hospital: h, ...x }),
          gravarAprazamento: (x) => gravarAprazamento(e, { hospital: h, ...x }),
          registrarConflito: async (x) => {
            const k = await registrarConflitoSync(e, { hospital: h, ...x });
            semEfeito = !k.novo;
            // Regra 8: o enfermeiro e a farmácia são avisados (a fila do relay leva o aviso; nada de dado clínico).
            if (k.novo)
              await outbox({
                tipo: 'enfermagem.conflito.aberto',
                chave: `conflito:${h}:${k.id}`,
                carga: { horario: String(x.horario), paciente: String(x.paciente), tipo: x.tipo },
              });
            return k;
          },
          resolverConflito: (x) => resolverConflitoSync(e, { hospital: h, ...x }),
          passarPlantao: (x) => passarPlantao(e, { hospital: h, ...x }),
          responderPlantao: (x) => responderPlantao(e, { hospital: h, ...x }),
          cancelarPlantao: (x) => cancelarPlantao(e, { hospital: h, ...x }),
          excluirDispositivo: (x) => excluirDispositivo(e, { hospital: h, ...x }),
          gravarDispositivo: (x) => gravarDispositivo(e, { hospital: h, ...x }),
          alterarDispositivo: (x) => alterarDispositivo(e, { hospital: h, ...x }),
          marcarSincronismo: (x) => marcarSincronismo(e, { hospital: h, ...x }),
          registrarEstornoPedido: (x) => registrarEstornoPedido(e, { hospital: h, ...x }),
          gravarRespostaExt: (x) => gravarRespostaExt(e, { hospital: h, ...x }),
        });
        if (!semEfeito) await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      }),
    relogio: async (c) => (await ler(c, (l) => relogioRecepcao(l))).agora,
    unidades: (c) => ler(c, (l) => unidadesDeInternacao(l)),
    // Os internados da unidade mudam devagar (admissão, alta, troca de leito): guardados por 30 s por unidade, para a
    // linha do tempo do turno de vários aparelhos não reler o censo a cada abertura (D-K6-25).
    internados: (c, u) =>
      internadosEmCache(c.rede, c.hospital, u, () => ler(c, (l) => internadosDaUnidade(l, u))),
    internado: (c, a) => ler(c, (l) => internadoDoAtendimento(l, a)),
    horarios: (c, o) =>
      ler(c, (l) =>
        horariosDosAtendimentos(l, {
          atendimentos: o.atendimentos,
          inicio: dataLocal(o.inicio),
          fim: dataLocal(o.fim),
          teto: o.teto,
          hospital: c.hospital,
        }),
      ),
    horario: (c, id) => ler(c, (l) => horarioPorId(l, id, c.hospital)),
    faixasDoHorario: (c, h) => ler(c, (l) => faixasDoHorario(l, h)),
    historico: (c, id) => ler(c, (l) => historicoDoHorario(l, id)),
    situacoes: (c, ids) => ler(c, (l) => situacoesDosHorarios(l, ids)),
    mudancas: (c, o) =>
      ler(c, (l) =>
        mudancasNaJanela(l, {
          inicio: dataLocal(o.inicio),
          fim: dataLocal(o.fim),
          desde: dataLocal(o.desde),
        }),
      ),
    vinculos: (c, login) => ler(c, (l) => vinculosDeEnfermagem(l, login)),
    nomesVinculos: (c, cbos) => ler(c, (l) => nomesDosVinculos(l, cbos)),
    laboratorio: (c, o) =>
      ler(c, (l) =>
        laboratorioDoPaciente(l, { paciente: o.paciente, de: dataLocal(o.de), ate: dataLocal(o.ate) }),
      ),
    regrasHorario: (c) => ler(c, (l) => regrasDeHorario(l)),
    atos: (c, hs) => ler(c, (l) => atosDosHorarios(l, c.hospital, hs)),
    eventosInfusao: (c, hs) => ler(c, (l) => eventosDeInfusao(l, c.hospital, hs)),
    sinais: (c, o) =>
      ler(c, (l) =>
        sinaisDoPaciente(l, c.hospital, { paciente: o.paciente, de: dataLocal(o.de), ate: dataLocal(o.ate) }),
      ),
    sinalPorId: (c, id) => ler(c, (l) => sinalParaRetificar(l, c.hospital, id)),
    ultimosSinais: (c, ps) => ler(c, (l) => ultimosSinais(l, c.hospital, ps)),
    aprazamentos: (c, hs) => ler(c, (l) => aprazamentosDosHorarios(l, c.hospital, hs)),
    conflitos: (c, o) => ler(c, (l) => conflitosSync(l, c.hospital, o)),
    passagens: (c, o) => ler(c, (l) => passagensDePlantao(l, c.hospital, o)),
    dispositivos: (c) => ler(c, (l) => dispositivosDaBeiraLeito(l, c.hospital)),
    dispositivoAutorizado: (c, id) =>
      ler(c, (l) => dispositivoAutorizado(l, c.hospital, hashAparelho(c.hospital, id))),
    extrasContingencia: (c, o) => ler(c, (l) => extrasDaContingencia(l, c.hospital, o)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaEnfermagemIndisponivel(): PortaEnfermagem {
  return portaIndisponivel<PortaEnfermagem>(METODOS_PORTA_ENFERMAGEM);
}

const INTERNADOS_TTL_MS = 30_000;
const cacheInternados = new Map<string, { ate: number; valor: Promise<InternadoLido[]> }>();

/** Os internados da unidade guardados por 30 s por rede, estabelecimento e unidade (a falha não fica guardada). */
export function internadosEmCache(
  rede: string,
  hospital: string,
  unidade: string,
  ler: () => Promise<InternadoLido[]>,
  agora = Date.now(),
): Promise<InternadoLido[]> {
  const k = `${rede}|${hospital}|${unidade}`;
  const c = cacheInternados.get(k);
  if (c && c.ate > agora) return c.valor;
  const valor = ler();
  cacheInternados.set(k, { ate: agora + INTERNADOS_TTL_MS, valor });
  valor.catch(() => cacheInternados.delete(k));
  return valor;
}
