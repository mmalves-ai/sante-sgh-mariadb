// Porta da anestesia (M46, etapa 1) sobre o núcleo do legado: leituras READ ONLY pelos repositórios de @sgh/legado; as
// gravações só do novo (SGH_CC_APA, SGH_CC_FA*, SGH_CC_SRPA, a pendência do M18 e o balanço hídrico do M45) numa
// transação SGH_ com a SGH_TRILHA junto (o escritor só das SGH_: nenhuma tabela do legado; regra 12). Em dev sobre a
// cópia compartilhada, as gravações SGH_ são recusadas (`sghSoLeitura`), como nos outros módulos.
import {
  abrirFichaSgh,
  adendoFichaSgh,
  apasDoAgendamento,
  assinarFichaSgh,
  contextoAnestesia,
  dominiosFicha,
  encerrarLancamentoFichaSgh,
  fichaDoAgendamento,
  gravarTrilha,
  justificarLacunaSgh,
  lancarFichaSgh,
  type Leitor,
  type NucleoLegado,
  passarResponsabilidadeSgh,
  profissionalDoUsuario,
  quadroSrpa,
  registrarApaSgh,
  agendamentoNaTransacaoSgh,
  registrarSrpaSgh,
  situacoesDaAnestesia,
  somenteSgh,
  srpaDoAgendamento,
  subirVersaoFichaSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { METODOS_PORTA_ANESTESIA, type PortaAnestesia } from './anestesia-porta.js';

export function portaAnestesiaLegado(
  nucleo: NucleoLegado,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaAnestesia {
  const ctx = (c: ContextoPortaM18) => ({ rede: c.rede, hospital: c.hospital, traceId: 'anestesia' });
  const ler = <T>(c: ContextoPortaM18, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    // Operações só do novo: nenhuma receita do executor (a liberação é a da funcionalidade, pela chave bloco.ficha).
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: (_c, op) =>
      Promise.reject(new Error(`Operação ${op} sem receita do executor: a anestesia grava só no novo.`)),
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
          agendamentoNaTransacao: (agendamento) => agendamentoNaTransacaoSgh(e, h, agendamento),
          registrarApa: (a) => registrarApaSgh(e, { hospital: h, ...a }),
          ficha: (agendamento) => fichaDoAgendamento(e, h, agendamento, { travar: true }),
          abrirFicha: (f) => abrirFichaSgh(e, { hospital: h, ...f }),
          subirVersao: (v) => subirVersaoFichaSgh(e, v),
          lancar: (l) => lancarFichaSgh(e, { hospital: h, ...l }),
          encerrar: (x) => encerrarLancamentoFichaSgh(e, { hospital: h, ...x }),
          passar: (p) => passarResponsabilidadeSgh(e, { hospital: h, ...p }),
          justificar: (j) => justificarLacunaSgh(e, { hospital: h, ...j }),
          assinar: (a) => assinarFichaSgh(e, { hospital: h, ...a }),
          adendo: (a) => adendoFichaSgh(e, { hospital: h, ...a }),
          srpa: (agendamento) => srpaDoAgendamento(e, h, agendamento),
          registrarSrpa: (s) => registrarSrpaSgh(e, { hospital: h, ...s }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    dominios: (c) => ler(c, (l) => dominiosFicha(l)),
    contexto: (c, a) => ler(c, (l) => contextoAnestesia(l, a)),
    profissional: async (c, login) => {
      const p = await ler(c, (l) => profissionalDoUsuario(l, login));
      return p ? { nome: p.nome, registros: p.cbos } : null;
    },
    apas: (c, a) => ler(c, (l) => apasDoAgendamento(l, c.hospital, a)),
    ficha: (c, a) => ler(c, (l) => fichaDoAgendamento(l, c.hospital, a)),
    srpa: (c, a) => ler(c, (l) => srpaDoAgendamento(l, c.hospital, a)),
    quadroSrpa: (c, desde) => ler(c, (l) => quadroSrpa(l, c.hospital, desde)),
    situacoes: (c, as) => ler(c, (l) => situacoesDaAnestesia(l, c.hospital, as)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaAnestesiaIndisponivel(): PortaAnestesia {
  return portaIndisponivel<PortaAnestesia>(METODOS_PORTA_ANESTESIA);
}
