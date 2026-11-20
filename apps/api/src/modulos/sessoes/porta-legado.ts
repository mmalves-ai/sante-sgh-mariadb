// Porta da agenda de sessões sobre o núcleo do legado (M50, etapa 6): leituras READ ONLY pelos repositórios de
// @sgh/legado; as gravações só do novo numa transação SGH_ com a SGH_TRILHA junto. Em dev sobre a cópia compartilhada,
// as gravações SGH_ são recusadas (`sghSoLeitura`), como nos outros módulos. Nenhuma operação do legado é chamada: a
// agenda de sessões não grava no outro sistema (podeGravar e executar recusam).
import {
  agendarSerieSgh,
  atualizarSessaoSgh,
  cancelarRestantesSgh,
  dominiosSessao,
  gravarTrilha,
  type Leitor,
  type NucleoLegado,
  nomesDosPacientes,
  ocupacoesDaSerie,
  pacienteParaSessao,
  recursosSessao,
  relogioRecepcao,
  serieSgh,
  sessaoSgh,
  sessoesDoPacienteSgh,
  sessoesDoPeriodo,
  somenteSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoSessoes, METODOS_PORTA_SESSOES, type PortaSessoes } from './porta.js';

const semOperacaoDoLegado = () =>
  new ErroProblema(
    'operacao-bloqueada',
    409,
    'Sem gravação no outro sistema',
    'A agenda de sessões grava só no novo (SGH_AGE_SESSAO).',
  );

export function portaSessoesLegado(
  nucleo: NucleoLegado,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaSessoes {
  const ctx = (c: ContextoSessoes) => ({ rede: c.rede, hospital: c.hospital, traceId: 'sessoes' });
  const ler = <T>(c: ContextoSessoes, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    podeGravar: async () => ({
      pode: false,
      codigo: 'sem-operacao',
      motivo: 'A agenda de sessões não grava no outro sistema.',
    }),
    executar: () => Promise.reject(semOperacaoDoLegado()),
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: a agenda de sessões não grava.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const h = c.hospital;
        const r = await fn({
          agendarSerie: (x) => agendarSerieSgh(e, { hospital: h, ...x }),
          atualizar: (x) => atualizarSessaoSgh(e, { hospital: h, ...x }),
          cancelarRestantes: (x) => cancelarRestantesSgh(e, { hospital: h, ...x }),
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
    recursos: (c) => ler(c, (l) => recursosSessao(l)),
    dominios: (c) => ler(c, (l) => dominiosSessao(l)),
    periodo: (c, de, ate, recursos) => ler(c, (l) => sessoesDoPeriodo(l, c.hospital, de, ate, recursos)),
    doPaciente: (c, paciente, desde) => ler(c, (l) => sessoesDoPacienteSgh(l, c.hospital, paciente, desde)),
    sessao: (c, id) => ler(c, (l) => sessaoSgh(l, c.hospital, id)),
    serie: (c, serie) => ler(c, (l) => serieSgh(l, c.hospital, serie)),
    ocupacoes: (c, alvo, horarios) => ler(c, (l) => ocupacoesDaSerie(l, c.hospital, alvo, horarios)),
    paciente: (c, id) => ler(c, (l) => pacienteParaSessao(l, id)),
    nomes: (c, ids) => ler(c, (l) => nomesDosPacientes(l, ids)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaSessoesIndisponivel(): PortaSessoes {
  return portaIndisponivel<PortaSessoes>(METODOS_PORTA_SESSOES);
}
