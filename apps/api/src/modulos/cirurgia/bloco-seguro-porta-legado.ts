// Porta da cirurgia segura e do rastreio (M46, etapa 2) sobre o núcleo do legado: leituras READ ONLY pelos repositórios
// de @sgh/legado; as gravações só do novo (SGH_CC_CHECKLIST, SGH_CC_CHECKLIST_ITEM, SGH_CC_MOVIMENTO,
// SGH_CC_PAINEL_CODIGO e a marcação do estado do M18) numa transação SGH_ com a SGH_TRILHA junto (o escritor só das SGH_:
// nenhuma tabela do legado; regra 12). Em dev sobre a cópia compartilhada, as gravações SGH_ são recusadas
// (`sghSoLeitura`), como nos outros módulos.
import {
  abrirChecklistSgh,
  agendamentoNaTransacaoSgh,
  agendamentosMovidosDesde,
  checklistDoAgendamento,
  checklistsDosAgendamentos,
  codigosDoPainel,
  concluirMomentoChecklistSgh,
  confirmacaoPelaChaveSgh,
  confirmarItensChecklistSgh,
  dominiosRastreio,
  estadoParaRastreio,
  gravarTrilha,
  type Leitor,
  movimentosDoAgendamento,
  movimentoPelaChaveSgh,
  movimentosDosAgendamentos,
  moverPacienteBlocoSgh,
  type NucleoLegado,
  registrarExcecaoIncisaoSgh,
  somenteSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { METODOS_PORTA_BLOCO_SEGURO, type PortaBlocoSeguro } from './bloco-seguro-porta.js';

export function portaBlocoSeguroLegado(
  nucleo: NucleoLegado,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaBlocoSeguro {
  const ctx = (c: ContextoPortaM18) => ({ rede: c.rede, hospital: c.hospital, traceId: 'bloco-seguro' });
  const ler = <T>(c: ContextoPortaM18, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    // Operações só do novo: nenhuma receita do executor (a liberação é a da funcionalidade, pelas chaves bloco.*).
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: (_c, op) =>
      Promise.reject(new Error(`Operação ${op} sem receita do executor: o bloco seguro grava só no novo.`)),
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
          checklist: (agendamento) => checklistDoAgendamento(e, h, agendamento, { travar: true }),
          confirmacaoPelaChave: (chave, item) => confirmacaoPelaChaveSgh(e, h, chave, item),
          movimentoPelaChave: (chave) => movimentoPelaChaveSgh(e, h, chave),
          abrirChecklist: (a) => abrirChecklistSgh(e, { hospital: h, ...a }),
          confirmarItens: (x) => confirmarItensChecklistSgh(e, { hospital: h, ...x }),
          concluirMomento: ({ cirurgia, ...x }) =>
            concluirMomentoChecklistSgh(e, {
              ...x,
              ...(cirurgia ? { cirurgia: { hospital: h, ...cirurgia } } : {}),
            }),
          registrarExcecao: (x) => registrarExcecaoIncisaoSgh(e, x),
          movimentos: (agendamento) => movimentosDoAgendamento(e, h, agendamento),
          estadoDoAgendamento: (agendamento) => estadoParaRastreio(e, h, agendamento),
          mover: (m) => moverPacienteBlocoSgh(e, { hospital: h, ...m }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    dominios: (c) => ler(c, (l) => dominiosRastreio(l)),
    checklist: (c, a) => ler(c, (l) => checklistDoAgendamento(l, c.hospital, a)),
    checklists: (c, as) => ler(c, (l) => checklistsDosAgendamentos(l, c.hospital, as)),
    movimentos: (c, a) => ler(c, (l) => movimentosDoAgendamento(l, c.hospital, a)),
    movimentosDe: (c, as) => ler(c, (l) => movimentosDosAgendamentos(l, c.hospital, as)),
    movidosDesde: (c, desde) => ler(c, (l) => agendamentosMovidosDesde(l, c.hospital, desde)),
    codigos: (c, agora, as) => ler(c, (l) => codigosDoPainel(l, c.hospital, agora, as)),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaBlocoSeguroIndisponivel(): PortaBlocoSeguro {
  return portaIndisponivel<PortaBlocoSeguro>(METODOS_PORTA_BLOCO_SEGURO);
}
