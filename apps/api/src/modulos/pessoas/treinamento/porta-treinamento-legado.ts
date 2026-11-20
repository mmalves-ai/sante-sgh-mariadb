// Porta dos treinamentos sobre o núcleo do legado (M52.6): leituras numa transação curta READ ONLY no banco do
// estabelecimento da sessão; gravações SGH_PES_* numa transação SGH_ (`somenteSgh`: nenhuma tabela do outro sistema) com
// a SGH_TRILHA junto. Em dev sobre a cópia compartilhada, as gravações são recusadas com o motivo (`sghSoLeitura`): a
// prova da gravação é a integração, sob a trava da cópia e desfeita. `portaTreinamentoNaTransacao`: a mesma porta sobre
// UMA transação aberta (integração na cópia, desfeita). Nenhuma operação do executor.
import {
  alterarCursoPesSgh,
  alterarTurmaPesSgh,
  correcoesPesSgh,
  registrarCorrecaoPesSgh,
  retirarInscricaoPesSgh,
  cienciasPopPesSgh,
  conclusoesPesSgh,
  cursoPesSgh,
  cursosPesSgh,
  type Escritor,
  gravarTrilha,
  incluirCienciaPopPesSgh,
  incluirCursoPesSgh,
  incluirParticipantePesSgh,
  incluirPopPesSgh,
  incluirTurmaPesSgh,
  type Leitor,
  type NucleoLegado,
  participacoesDoVinculoPesSgh,
  participantesPesSgh,
  popPesSgh,
  popsPesSgh,
  registrarParticipacaoPesSgh,
  relogioRecepcao,
  situacaoPopPesSgh,
  situacaoTurmaPesSgh,
  somenteSgh,
  turmaPesSgh,
  turmasPesSgh,
  vinculosAtivosTreinamentoPesSgh,
  vinculosPorIdsPesSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import { portaIndisponivel } from '../../exames/public-api.js';
import {
  type ContextoTreinamento,
  type GravadorTreinamento,
  METODOS_PORTA_TREINAMENTO,
  type PortaTreinamento,
} from './porta-treinamento.js';

type Ler = <T>(c: ContextoTreinamento, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaTreinamento, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    relogio: (c) =>
      ler(c, async (l) => {
        const r = await relogioRecepcao(l);
        return { hoje: r.hoje, agora: r.agora.slice(0, 16) };
      }),
    cursos: (c) => ler(c, (l) => cursosPesSgh(l, c.hospital)),
    curso: (c, id) => ler(c, (l) => cursoPesSgh(l, c.hospital, id)),
    turmas: (c, f) => ler(c, (l) => turmasPesSgh(l, c.hospital, f)),
    turma: (c, id) => ler(c, (l) => turmaPesSgh(l, c.hospital, id)),
    participantes: (c, t) => ler(c, (l) => participantesPesSgh(l, c.hospital, t)),
    participacoes: (c, v) => ler(c, (l) => participacoesDoVinculoPesSgh(l, c.hospital, v)),
    conclusoes: (c, vs) => ler(c, (l) => conclusoesPesSgh(l, c.hospital, vs)),
    pops: (c, f) => ler(c, (l) => popsPesSgh(l, c.hospital, f)),
    pop: (c, id) => ler(c, (l) => popPesSgh(l, c.hospital, id)),
    ciencias: (c, f) => ler(c, (l) => cienciasPopPesSgh(l, c.hospital, f)),
    ativos: (c, u) => ler(c, (l) => vinculosAtivosTreinamentoPesSgh(l, c.hospital, u)),
    vinculos: (c, ids) =>
      ids.length === 0 ? Promise.resolve([]) : ler(c, (l) => vinculosPorIdsPesSgh(l, c.hospital, ids)),
    correcoes: (c, tabela, rs) => ler(c, (l) => correcoesPesSgh(l, c.hospital, tabela, rs)),
  };
}

function gravador(e: Escritor, c: ContextoTreinamento): GravadorTreinamento {
  const h = c.hospital;
  return {
    curso: (id) => cursoPesSgh(e, h, id),
    turma: (id) => turmaPesSgh(e, h, id),
    participantes: (t) => participantesPesSgh(e, h, t),
    pop: (id) => popPesSgh(e, h, id),
    versoesPop: (codigo) => popsPesSgh(e, h, { codigo }),
    ciencias: (f) => cienciasPopPesSgh(e, h, f),
    incluirCurso: (x) => incluirCursoPesSgh(e, { hospital: h, ...x }),
    alterarCurso: (x) => alterarCursoPesSgh(e, { hospital: h, ...x }),
    incluirTurma: (x) => incluirTurmaPesSgh(e, { hospital: h, ...x }),
    situacaoTurma: (x) => situacaoTurmaPesSgh(e, { hospital: h, ...x }),
    incluirParticipante: (x) => incluirParticipantePesSgh(e, { hospital: h, ...x }),
    registrarParticipacao: (x) => registrarParticipacaoPesSgh(e, { hospital: h, ...x }),
    incluirPop: (x) => incluirPopPesSgh(e, { hospital: h, ...x }),
    situacaoPop: (x) => situacaoPopPesSgh(e, { hospital: h, ...x }),
    incluirCiencia: (x) => incluirCienciaPopPesSgh(e, { hospital: h, ...x }),
    alterarTurma: (x) => alterarTurmaPesSgh(e, { hospital: h, ...x }),
    retirarInscricao: (x) => retirarInscricaoPesSgh(e, { hospital: h, ...x }),
    registrarCorrecao: (x) => registrarCorrecaoPesSgh(e, { hospital: h, ...x }),
  };
}

const recusaSoLeitura = () =>
  Promise.reject(
    new ErroProblema(
      'recurso-desligado',
      403,
      'Gravação desligada neste ambiente',
      'Neste ambiente de desenvolvimento o banco é só de leitura: os treinamentos não gravam.',
      { codigo: 'somente-leitura' },
    ),
  );

const semExecutor = () =>
  Promise.reject(
    new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', 'Os treinamentos não usam o executor.'),
  );

export function portaTreinamentoLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente'> & Partial<Pick<NucleoLegado, 'gravarSgh'>>,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaTreinamento {
  const ctx = (c: ContextoTreinamento) => ({ rede: c.rede, hospital: c.hospital, traceId: 'treinamento' });
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: semExecutor,
    gravarSgh: (c, trilha, fn) => {
      const gravar = nucleo.gravarSgh?.bind(nucleo);
      if (opcoes.sghSoLeitura || !gravar) return recusaSoLeitura();
      return gravar(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const r = await fn(gravador(e, c));
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

/** A mesma porta sobre UMA transação aberta (integração na cópia, sempre desfeita). */
export function portaTreinamentoNaTransacao(e: Escritor): PortaTreinamento {
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: semExecutor,
    async gravarSgh(c, trilha, fn) {
      const s = somenteSgh(e);
      const r = await fn(gravador(s, c));
      await gravarTrilha(s, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e)),
  };
}

export function portaTreinamentoIndisponivel(): PortaTreinamento {
  return portaIndisponivel<PortaTreinamento>(METODOS_PORTA_TREINAMENTO);
}
