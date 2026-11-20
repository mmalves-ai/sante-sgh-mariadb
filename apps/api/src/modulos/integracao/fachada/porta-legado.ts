// M58-F4: a porta da fachada sobre o núcleo do legado. Leituras READ ONLY; a gravação da situação do convênio pelo
// EXECUTOR (receita convenio.alterarSituacao: compare-and-swap, pré-checagem do gatilho, autoria em SGH_ e a
// SGH_TRILHA na mesma transação), com o usuário de integração e a confirmação da proposta no lugar da
// reautenticação (D-REAUT-F4-58). Em dev sobre a cópia compartilhada, o executor só de leitura recusa a gravação.
import { CODIGOS_ERRO_FACHADA as E, USUARIO_INTEGRACAO_FACHADA } from '@sgh/contratos';
import { erroFachada, recusaDoBancoSituacao } from '@sgh/dominio-integracao';
import {
  type Escritor,
  type Executor,
  type FonteCatalogo,
  type Leitor,
  lerConvenioFachada,
  lerConveniosFachada,
  lerDiariaAcompanhante,
  lerImpactoConvenioFachada,
  lerRetratoConvenioFachada,
  lerSaudeBancoFachada,
  lerSituacaoConvenioFachada,
  type MetricasExecutor,
  type NucleoLegado,
  operacao,
  problemaDaOperacao,
} from '@sgh/legado';
import { portaIndisponivel } from '../../exames/public-api.js';
import { type ContextoFachada, METODOS_PORTA_FACHADA, type PortaFachada } from './porta.js';

const MUDOU = new Set(['conflito-versao', 'situacao-mudou', 'sem-efeito', 'situacao-desconhecida']);
const NAO_LIBERADA = new Set([
  'operacao-nao-liberada',
  'operacao-bloqueada',
  'schema-divergente',
  'reautenticacao-necessaria',
]);
const EM_EDICAO = new Set(['registro-em-edicao', 'requisicao-em-andamento', 'idempotencia-divergente']);

/** A recusa do executor no contrato de erro da fachada (nunca o texto do banco). */
export function falhaDoExecutor(e: unknown, cod: number, nome: string): Error {
  const p = problemaDaOperacao(e);
  const codigo = String((p as { codigo?: unknown }).codigo ?? '');
  if (MUDOU.has(codigo))
    return erroFachada(
      409,
      'O cadastro do convênio mudou entre a proposta e a gravação. Nada foi escrito. Refaça a proposta para ver o estado atual.',
      E.propostaDesatualizada,
    );
  if (codigo === 'diaria-acompanhante-invalida')
    return erroFachada(
      409,
      `O convênio ${cod} não pode ser alterado enquanto a diária de acompanhante apontada não for do tipo ` +
        'Diária/Acompanhante (tipo 1, subtipo 5). Nada foi escrito.',
      E.acaoSemEfeito,
      { motivo: 'bloqueado_pelo_gatilho_dth', convenio: cod },
    );
  if (NAO_LIBERADA.has(codigo))
    return erroFachada(
      409,
      'A gravação equivalente não está liberada neste estabelecimento. Nada foi escrito.',
      E.acaoSemEfeito,
      { motivo: 'gravacao_nao_liberada', convenio: cod },
    );
  if (EM_EDICAO.has(codigo))
    return erroFachada(
      409,
      'O convênio está sendo alterado agora por outra pessoa ou processo. Nada foi escrito. Tente de novo em instantes.',
      E.acaoSemEfeito,
      { motivo: 'registro_em_edicao', convenio: cod },
    );
  if (p.status === 409 || p.status === 422) return recusaDoBancoSituacao(cod, nome);
  return e instanceof Error ? e : new Error('falha na gravação');
}

type Ler = <T>(c: ContextoFachada, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler) {
  return {
    convenios: (c: ContextoFachada) => ler(c, (l) => lerConveniosFachada(l)),
    convenio: (c: ContextoFachada, cod: number) => ler(c, (l) => lerConvenioFachada(l, cod)),
    saudeBanco: (c: ContextoFachada) => ler(c, (l) => lerSaudeBancoFachada(l)),
    retratoConvenio: (c: ContextoFachada, cod: number) => ler(c, (l) => lerRetratoConvenioFachada(l, cod)),
    diariaConvenio: (c: ContextoFachada, cod: number) => ler(c, (l) => lerDiariaAcompanhante(l, cod)),
    impactoConvenio: (c: ContextoFachada, cod: number) => ler(c, (l) => lerImpactoConvenioFachada(l, cod)),
  };
}

export function portaFachadaLegado(
  nucleo: NucleoLegado,
  catalogo: FonteCatalogo,
  metricas?: MetricasExecutor,
  executorPronto?: Executor,
): PortaFachada {
  const executor = executorPronto ?? nucleo.criarExecutor({ catalogo, ...(metricas ? { metricas } : {}) });
  const ctx = (c: ContextoFachada) => ({ rede: c.rede, hospital: c.hospital, traceId: 'fachada' });
  const ler: Ler = (c, fn) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    estado: (op, hospital) => catalogo.estado(op, hospital),
    ...leituras(ler),
    async gravarSituacaoConvenio(c, g) {
      try {
        await executor.executar(
          operacao('convenio.alterarSituacao'),
          c.hospital,
          { convenio: g.cod, operacao: g.operacao, justificativa: g.justificativa },
          {
            rede: c.rede,
            hospital: c.hospital,
            traceId: `fachada-${g.chave}`.slice(0, 64),
            usuarioLegado: USUARIO_INTEGRACAO_FACHADA,
            idempotencyKey: g.chave,
            estacao: 'fachada-hal-ai',
            // A confirmação da proposta, com o token da superfície, é o segundo tempo da decisão (D-REAUT-F4-58).
            reautenticadoEm: Date.now(),
          },
        );
      } catch (e) {
        throw falhaDoExecutor(e, g.cod, `convênio ${g.cod}`);
      }
      return ler(c, (l) => lerSituacaoConvenioFachada(l, g.cod));
    },
  };
}

/** A porta sobre uma transação aberta (testes de integração na cópia, desfeita no fim). */
export function portaFachadaNaTransacao(
  e: Escritor,
  executor: Executor,
  catalogo: FonteCatalogo,
): PortaFachada {
  return {
    destino: 'legado',
    estado: (op, hospital) => catalogo.estado(op, hospital),
    ...leituras((_c, fn) => fn(e)),
    async gravarSituacaoConvenio(c, g) {
      try {
        await executor.executar(
          operacao('convenio.alterarSituacao'),
          c.hospital,
          { convenio: g.cod, operacao: g.operacao, justificativa: g.justificativa },
          {
            rede: c.rede,
            hospital: c.hospital,
            traceId: `fachada-${g.chave}`.slice(0, 64),
            usuarioLegado: USUARIO_INTEGRACAO_FACHADA,
            idempotencyKey: g.chave,
            estacao: 'fachada-hal-ai',
            reautenticadoEm: Date.now(),
          },
          { escritor: e },
        );
      } catch (x) {
        throw falhaDoExecutor(x, g.cod, `convênio ${g.cod}`);
      }
      return lerSituacaoConvenioFachada(e, g.cod);
    },
  };
}

export function portaFachadaIndisponivel(): PortaFachada {
  const p = portaIndisponivel<PortaFachada>(METODOS_PORTA_FACHADA);
  return {
    destino: 'legado',
    // O estado é síncrono: sem banco, nenhuma operação equivalente conta como provada.
    estado: () => null,
    convenios: (c) => p.convenios(c),
    convenio: (c, cod) => p.convenio(c, cod),
    saudeBanco: (c) => p.saudeBanco(c),
    retratoConvenio: (c, cod) => p.retratoConvenio(c, cod),
    diariaConvenio: (c, cod) => p.diariaConvenio(c, cod),
    impactoConvenio: (c, cod) => p.impactoConvenio(c, cod),
    gravarSituacaoConvenio: (c, g) => p.gravarSituacaoConvenio(c, g),
  };
}

export { METODOS_PORTA_FACHADA };
