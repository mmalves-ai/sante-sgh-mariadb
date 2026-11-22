// Porta do processo de enfermagem (SAE), da consulta de enfermagem, da receita do enfermeiro e da vacina aplicada (M45,
// etapa 4) sobre o banco do cliente pelo @sgh/nucleo. Leituras somente leitura (processo_enfermagem, os diagnósticos
// do paciente com as características, a avaliação dos resultados e o plano de intervenções; o atendimento da consulta;
// o cabeçalho da receita; a vacina aplicada e o envio à rede nacional); toda gravação é uma operação do Executor
// (trilha, outbox e idempotência pela chave do pedido na mesma transação). Toda leitura filtra o estabelecimento da
// sessão e os registros excluídos; os catálogos de enfermagem (diagnóstico, característica, resultado, intervenção) e o
// cadastro do paciente são da rede inteira.
// Melhoria: o processo é um só por atendimento, com a versão do registro como trava otimista (a versão vista na tela);
// o diagnóstico, a característica, o resultado e a intervenção têm de existir no catálogo (FK), sem texto solto; a
// direção da meta (aumentar, manter, diminuir) e a situação da evolução saem das notas (não são guardadas à parte,
// então não divergem); a dose única da vacina por paciente é conferida na gravação, só contra as doses vigentes; a
// retificação da vacina é um registro novo ligado ao original (o original fica, marcado), com o evento de substituição
// ou cancelamento na fila de saída.
// Melhoria: a linha da trilha da tela (evento auditável, recurso, paciente, estação) vai na trilha da operação, mesmo
// quando montada pelo resultado; a correção da vacina usa a chave do pedido (o reenvio não cria outra retificação nem
// outro evento na fila de saída); as versões do processo saem dos lotes de diagnóstico (início e fim de cada versão).
// Pendências de modelo (pedidos do lote 02-05): a atividade prescrita pelo enfermeiro com os horários e a checagem do
// cuidado (prescrever, suspender, checar e estornar), a receita do enfermeiro (protocolo, lista e segundo
// identificador) e a terminologia licenciada carregada por estabelecimento respondem 409 modelo-pendente; as leituras
// delas devolvem vazio.
import { randomUUID } from 'node:crypto';
import type { ChecagemCuidadoLida, DoseVacina, SistemaTerminologiaSae } from '@sgh/contratos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type EventoOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { type LiberacaoGravacao, portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import {
  booleano,
  civilDe,
  dataDe,
  estabelecimentoDe,
  exigirProfissional,
  fusoDe,
  instanteDe,
  type Linha,
  LOGIN_DE,
  marcadores,
  num,
  numOuNulo,
  texto,
  textoOuNulo,
} from './banco-apoio.js';
import { type ContextoSae, type GravadorSae, METODOS_PORTA_SAE, type PortaSae } from './sae-porta.js';
import { extrasDaTrilha, gravarSoTrilha, resolverTrilha, type TrilhaDaTela } from './trilha-da-tela.js';
import {
  type AtividadeVigente,
  type CabecalhoReceita,
  type ConsultaDeEnfermagem,
  type CorrecaoVacina,
  EVENTO_VACINA_CANCELADA,
  EVENTO_VACINA_SUBSTITUIDA,
  type ItemSae,
  type ReceitaDoEnfermeiro,
  type RecusaEnvioVacina,
  type SaeDoAtendimento,
  type TermoTerminologiaSae,
  type VacinaAplicada,
} from './sae-tipos.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoSae = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

export const EVENTO_VACINA_APLICADA = 'fato.vacina.aplicada';
export const TETO_EXTERNOS_DO_DIA = 200;

export const OPERACOES_SAE = {
  registrar: 'sae.registrar-processo',
  evoluir: 'sae.evoluir-resultados',
  vacina: 'vacina.registrar',
  corrigirVacina: 'vacina.corrigir',
  trilha: 'sae.registrar-trilha',
} as const;

const modeloPendente = (o: string) =>
  new ErroOperacao(
    409,
    'modelo-pendente',
    'Recurso aguardando o modelo do banco',
    `${o} aguarda a tabela no modelo do banco: nada foi gravado.`,
  );

const SAE_MUDOU = () =>
  recusa(
    'sae-mudou',
    'O processo de enfermagem mudou depois da sua leitura: recarregue e confira antes de gravar.',
  );

/** O sistema de classificação pela terminologia do catálogo (o código da terminologia no banco). */
const SISTEMA_DA_TERMINOLOGIA: Readonly<Record<string, SistemaTerminologiaSae>> = {
  nanda: 'NNN',
  nnn: 'NNN',
  cipe: 'CIPE',
};

/** A direção da meta pelas notas: 1 aumentar, 2 manter, 3 diminuir. */
export const direcaoDaMeta = (inicial: number, meta: number): number =>
  meta > inicial ? 1 : meta === inicial ? 2 : 3;

/** A situação da evolução pelas notas: atingida (chegou à meta), melhorou, mantida ou piorou (frente à anterior). */
export function situacaoDaEvolucao(meta: number, anterior: number, obtida: number): string {
  if (obtida === meta) return 'atingida';
  const antes = Math.abs(meta - anterior);
  const agora = Math.abs(meta - obtida);
  return agora < antes ? 'melhorou' : agora === antes ? 'mantida' : 'piorou';
}

/** Situação do envio da vacina no banco → o evento na fila de saída e a entrega do conector (as telas). */
function envioDaVacina(s: string): { evento: VacinaAplicada['evento']; entrega: VacinaAplicada['entrega'] } {
  switch (s) {
    case 'enviado':
      return { evento: 'publicado', entrega: 'enviado' };
    case 'falhou':
      return { evento: 'publicado', entrega: 'morto' };
    case 'dispensado':
      return { evento: 'publicado', entrega: 'descartado' };
    case 'na_fila':
      return { evento: 'publicado', entrega: 'pendente' };
    default:
      return { evento: 'pendente', entrega: null };
  }
}

interface Escrita<R extends ResultadoOperacao> {
  readonly nome: string;
  readonly tabelas: readonly string[];
  readonly chave: string | null;
  readonly entrada: Record<string, unknown>;
  readonly gravar: (tx: TxOperacao, est: number, fuso: string) => Promise<R>;
  readonly alvo: (r: R) => { tabela: string; id: number | null };
  readonly eventos?: (r: R) => readonly EventoOperacao[];
  /** O que a tela recebe do gravador (para a trilha montada pelo resultado); padrão: o resultado da operação. */
  readonly saida?: (r: R) => unknown;
}

/** A tabela própria da entidade que a tela põe na trilha (a linha só de trilha, sem escrita). */
const TABELA_DA_ENTIDADE: Readonly<Record<string, string>> = {
  SGH_PEP_SAE: 'processo_enfermagem',
  SGH_PEP_SAE_ITEM: 'avaliacao_resultado_enfermagem',
  SGH_PEP_VACINA_APLICADA: 'vacina_aplicada',
  SGH_PEP_VACINA_EVENTO: 'vacina_aplicada',
};

export class PortaSaePropria implements PortaSae {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoSae,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoSae, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    let est: number;
    try {
      est = estabelecimentoDe(c);
    } catch (e) {
      return Promise.reject(e);
    }
    return this.nucleo.lerSomente(contexto(c), async (l) => fn(l, est, await fusoDe(l, est)));
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────────

  async podeGravar(c: ContextoSae, op: string): Promise<LiberacaoGravacao> {
    void [c, op];
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(c: ContextoSae, op: string, entrada: unknown, ctx: ContextoOperacao): Promise<never> {
    void [c, entrada, ctx];
    throw recusa('operacao-desconhecida', `Operação ${op} não é do processo de enfermagem.`);
  }

  private async escrever<R extends ResultadoOperacao>(
    c: ContextoSae,
    trilha: TrilhaDaTela<unknown>,
    w: Escrita<R>,
  ): Promise<{ resultado: R; repetida: boolean; eventos: readonly number[] }> {
    const est = estabelecimentoDe(c);
    const op = definirOperacao<Record<string, unknown>, R>({
      nome: w.nome,
      tabelas: w.tabelas,
      entrada: z.record(z.string(), z.unknown()),
      async gravar(tx) {
        return w.gravar(tx, est, await fusoDe(tx, est));
      },
      alvo: (_e, r) => w.alvo(r),
      ...(w.eventos ? { eventos: (_e: Record<string, unknown>, r: R) => w.eventos!(r) } : {}),
      // A linha da tela, resolvida com o resultado da gravação, dentro da transação.
      trilha: (_e, r) => extrasDaTrilha(resolverTrilha(trilha, w.saida ? w.saida(r) : r)),
    });
    const r = await this.executor.executar(op, c.cliente, w.entrada, {
      ...contexto(c),
      estabelecimento: est,
      chaveIdempotencia: w.chave ?? `direta:${randomUUID()}`,
    });
    return { resultado: r.resultado, repetida: r.repetida, eventos: r.eventos };
  }

  async gravarSgh<T>(
    c: ContextoSae,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao) | null,
    fn: (g: GravadorSae) => Promise<T>,
  ): Promise<T> {
    // A linha da trilha da tela vai em cada operação (a função é resolvida com o resultado, dentro da transação).
    // Sem nenhuma escrita, a linha vai numa operação só de trilha.
    const linha = trilha as TrilhaDaTela<unknown>;
    let escritas = 0;
    const r = await fn(this.gravador(c, linha, () => escritas++));
    if (escritas === 0 && linha) {
      const l = resolverTrilha(linha, r);
      await gravarSoTrilha(
        this.executor,
        { ...contexto(c), estabelecimento: estabelecimentoDe(c) },
        OPERACOES_SAE.trilha,
        {
          tabela: (l?.entidade && TABELA_DA_ENTIDADE[l.entidade]) || 'processo_enfermagem',
          id: l?.entidadeId ?? null,
        },
        l,
      );
    }
    return r;
  }

  private gravador(c: ContextoSae, linha: TrilhaDaTela<unknown>, marcar: () => void): GravadorSae {
    const esc = <R extends ResultadoOperacao>(w: Escrita<R>) => {
      marcar();
      return this.escrever(c, linha, w);
    };
    return {
      registrarSae: async (p) => {
        let itens = 0;
        const s = await esc({
          nome: OPERACOES_SAE.registrar,
          tabelas: [
            'processo_enfermagem',
            'diagnostico_enfermagem_paciente',
            'diagnostico_enfermagem_paciente_caracteristica',
            'avaliacao_resultado_enfermagem',
            'plano_intervencao_enfermagem',
          ],
          chave: p.chave,
          entrada: { ...p },
          alvo: (r) => ({ tabela: 'processo_enfermagem', id: Number(r['id']) }),
          gravar: async (tx, est) => {
            const prof = await exigirProfissional(tx, c, est);
            const agora = new Date();
            const [atual] = await tx.consultarParaAtualizar<{ id: number; versao: number }>(
              `SELECT id, versao FROM processo_enfermagem
                WHERE atendimento_id = ? AND estabelecimento_id = ? AND situacao = 'aberto' AND excluido_em IS NULL
                ORDER BY id DESC LIMIT 1`,
              [p.atendimento, est],
            );
            if ((atual ? Number(atual.versao) : 0) !== p.versaoVista) throw SAE_MUDOU();
            let id: number;
            let versao: number;
            if (atual) {
              id = Number(atual.id);
              versao = await tx.alterar('processo_enfermagem', id, Number(atual.versao), {
                avaliacao: p.avaliacao,
                etapa_atual: 'planejamento',
              });
              await encerrarDiagnosticos(tx, p.atendimento, est, agora);
            } else {
              id = await tx.incluir('processo_enfermagem', {
                estabelecimento_id: est,
                paciente_id: p.paciente,
                atendimento_id: p.atendimento,
                enfermeiro_profissional_id: prof,
                inicio_em: agora,
                etapa_atual: 'planejamento',
                situacao: 'aberto',
                avaliacao: p.avaliacao,
              });
              versao = 1;
            }
            for (const [i, d] of p.diagnosticos.entries()) {
              const diag = await catalogo(tx, 'diagnostico_enfermagem', d.codigo, 'diagnóstico');
              const dep = await tx.incluir('diagnostico_enfermagem_paciente', {
                estabelecimento_id: est,
                paciente_id: p.paciente,
                atendimento_id: p.atendimento,
                diagnostico_enfermagem_id: diag,
                profissional_id: prof,
                prioridade: i + 1,
                inicio_em: agora,
                situacao: 'ativo',
              });
              itens++;
              for (const cd of [...new Set([...d.caracteristicas, ...d.fatores])])
                await tx.incluir('diagnostico_enfermagem_paciente_caracteristica', {
                  diagnostico_enfermagem_paciente_id: dep,
                  caracteristica_diagnostico_enfermagem_id: await catalogo(
                    tx,
                    'caracteristica_diagnostico_enfermagem',
                    cd,
                    'característica ou fator',
                  ),
                });
              for (const [k, r] of d.resultados.entries()) {
                await tx.incluir('avaliacao_resultado_enfermagem', {
                  diagnostico_enfermagem_paciente_id: dep,
                  sequencia: k + 1,
                  resultado_enfermagem_id: await catalogo(tx, 'resultado_enfermagem', r.codigo, 'resultado'),
                  nota_inicial: r.escalaAtual,
                  nota_meta: r.escalaMeta,
                  avaliado_em: agora,
                  profissional_id: prof,
                  situacao: 'em_andamento',
                });
                itens++;
              }
              for (const [k, iv] of d.intervencoes.entries()) {
                await tx.incluir('plano_intervencao_enfermagem', {
                  diagnostico_enfermagem_paciente_id: dep,
                  sequencia: k + 1,
                  intervencao_enfermagem_id: await catalogo(
                    tx,
                    'intervencao_enfermagem',
                    iv.codigo,
                    'intervenção',
                  ),
                  situacao: 'planejada',
                  responsavel_profissional_id: prof,
                });
                itens++;
              }
            }
            return { id, versao, itens };
          },
        });
        return {
          id: Number(s.resultado['id']),
          versao: Number(s.resultado['versao']),
          itens: s.repetida ? 0 : itens,
          repetida: s.repetida,
        };
      },

      evoluir: async (x) => {
        const s = await esc({
          nome: OPERACOES_SAE.evoluir,
          tabelas: ['avaliacao_resultado_enfermagem'],
          chave: x.chave,
          entrada: { ...x },
          alvo: () => ({ tabela: 'processo_enfermagem', id: x.sae }),
          saida: (r) => ({
            ids: String(r['ids'] ?? '')
              .split(',')
              .filter(Boolean)
              .map(Number),
          }),
          gravar: async (tx, est) => {
            const prof = await exigirProfissional(tx, c, est);
            const proc = await tx.uma<{ id: number }>(
              `SELECT id FROM processo_enfermagem WHERE id = ? AND atendimento_id = ? AND estabelecimento_id = ?
                  AND situacao = 'aberto' AND excluido_em IS NULL`,
              [x.sae, x.atendimento, est],
            );
            if (!proc) throw SAE_MUDOU();
            const ids: number[] = [];
            for (const r of x.resultados) {
              const [base] = await tx.consultarParaAtualizar<Linha>(
                `SELECT a.id, a.diagnostico_enfermagem_paciente_id, a.resultado_enfermagem_id, a.nota_inicial, a.nota_meta,
                        a.escala_resultado_enfermagem_id
                   FROM avaliacao_resultado_enfermagem a
                   JOIN diagnostico_enfermagem_paciente d ON d.id = a.diagnostico_enfermagem_paciente_id
                  WHERE a.id = ? AND d.atendimento_id = ? AND d.estabelecimento_id = ? AND d.situacao = 'ativo'
                    AND a.excluido_em IS NULL AND d.excluido_em IS NULL`,
                [r.resultado, x.atendimento, est],
              );
              if (!base)
                throw recusa('resultado-de-outro-processo', 'O resultado não é do processo vigente.');
              const seq = await tx.uma<{ s: number }>(
                'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM avaliacao_resultado_enfermagem WHERE diagnostico_enfermagem_paciente_id = ?',
                [base['diagnostico_enfermagem_paciente_id']],
              );
              const agora = new Date();
              const atingida = r.situacao === 'atingida';
              ids.push(
                await tx.incluir('avaliacao_resultado_enfermagem', {
                  diagnostico_enfermagem_paciente_id: base['diagnostico_enfermagem_paciente_id'],
                  sequencia: num(seq?.s ?? 1),
                  resultado_enfermagem_id: base['resultado_enfermagem_id'],
                  escala_resultado_enfermagem_id: base['escala_resultado_enfermagem_id'] ?? null,
                  nota_inicial: base['nota_inicial'],
                  nota_meta: base['nota_meta'],
                  nota_obtida: r.escala,
                  avaliado_em: agora,
                  finalizado_em: atingida ? agora : null,
                  profissional_id: prof,
                  evolucao: x.nota,
                  situacao: atingida ? 'finalizada' : 'em_andamento',
                }),
              );
            }
            return { ids: ids.join(',') };
          },
        });
        return {
          ids: String(s.resultado['ids'] ?? '')
            .split(',')
            .filter(Boolean)
            .map(Number),
          repetida: s.repetida,
        };
      },

      registrarVacina: async (v) => {
        const s = await esc({
          nome: OPERACOES_SAE.vacina,
          tabelas: ['vacina_aplicada'],
          chave: v.chave,
          entrada: { ...v },
          alvo: (r) => ({ tabela: 'vacina_aplicada', id: Number(r['id']) }),
          eventos: (r) => [
            {
              tipo: EVENTO_VACINA_APLICADA,
              carga: { vacina: Number(r['id']), paciente: v.paciente, atendimento: v.atendimento },
            },
          ],
          gravar: async (tx, est, fuso) => {
            const prof = await exigirProfissional(tx, c, est);
            const imuno = await catalogo(tx, 'imunobiologico', v.imunobiologico, 'imunobiológico');
            if (v.chaveDose) {
              const ja = await tx.consultarParaAtualizar(
                `SELECT id FROM vacina_aplicada WHERE paciente_id = ? AND imunobiologico_id = ? AND dose = ?
                    AND situacao = 'ativa' AND excluido_em IS NULL`,
                [v.paciente, imuno, v.dose],
              );
              if (ja.length > 0)
                throw recusa(
                  'dose-ja-registrada',
                  `A dose ${v.dose} deste imunobiológico já foi registrada para o paciente.`,
                );
            }
            const id = await tx.incluir('vacina_aplicada', {
              estabelecimento_id: est,
              paciente_id: v.paciente,
              atendimento_id: v.atendimento,
              imunobiologico_id: imuno,
              dose: v.dose,
              lote: v.lote,
              fabricante: v.fabricante,
              validade_lote: v.validadeLote.slice(0, 10),
              via_de_uso_id: await catalogo(tx, 'via_de_uso', v.via, 'via de aplicação'),
              regiao_corporal_id: await catalogo(tx, 'regiao_corporal', v.local, 'local de aplicação'),
              aplicador_profissional_id: prof,
              aplicada_em: instanteDe(v.aplicadaEm, fuso),
              situacao: 'ativa',
              situacao_envio: 'aguardando_conector',
              prazo_envio_em: instanteDe(v.prazoEnvio, fuso),
            });
            return { id };
          },
        });
        return {
          id: Number(s.resultado['id']),
          evento: s.eventos[0] !== undefined ? String(s.eventos[0]) : `vacina-${String(s.resultado['id'])}`,
          repetida: s.repetida,
        };
      },

      corrigirVacina: async (v) => {
        const s = await esc({
          nome: OPERACOES_SAE.corrigirVacina,
          tabelas: ['vacina_aplicada'],
          chave: v.chave ?? null,
          entrada: { ...v },
          alvo: () => ({ tabela: 'vacina_aplicada', id: v.id }),
          saida: (r) => ({ id: v.id, versao: Number(r['versao']) }),
          eventos: (r) => [
            {
              tipo: v.tipo === 'estorno' ? EVENTO_VACINA_CANCELADA : EVENTO_VACINA_SUBSTITUIDA,
              carga: { vacina: v.id, versao: Number(r['versao']), paciente: v.paciente },
            },
          ],
          gravar: async (tx, est, fuso) => {
            const [o] = await tx.consultarParaAtualizar<Linha>(
              `SELECT * FROM vacina_aplicada WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ?
                  AND vacina_aplicada_original_id IS NULL AND excluido_em IS NULL`,
              [v.id, v.paciente, est],
            );
            if (!o) throw recusa('vacina-inexistente', 'A vacina não foi encontrada para este paciente.');
            const vigente = await vacinaVigente(tx, v.id);
            if (o['situacao'] === 'estornada' || vigente?.['situacao'] === 'estornada')
              throw recusa('vacina-estornada', 'A vacina já foi estornada.');
            const atual = vigente ?? o;
            const correcoes = num(
              (
                await tx.uma<{ n: number }>(
                  'SELECT COUNT(*) AS n FROM vacina_aplicada WHERE vacina_aplicada_original_id = ?',
                  [v.id],
                )
              )?.n,
            );
            if (v.tipo === 'estorno') {
              await tx.alterar('vacina_aplicada', num(atual['id']), num(atual['versao']), {
                situacao: 'estornada',
                motivo_correcao: v.motivo,
              });
              return { versao: correcoes + 1 };
            }
            const d = v.dados;
            if (!d || Object.values(d).every((x) => x === undefined))
              throw recusa('retificacao-vazia', 'Informe o que a retificação corrige.');
            if (d.dose && ['D1', 'D2', 'D3', 'D4', 'DU'].includes(d.dose)) {
              const ja = await tx.uma(
                `SELECT id FROM vacina_aplicada WHERE paciente_id = ? AND imunobiologico_id = ? AND dose = ?
                    AND situacao = 'ativa' AND id <> ? AND COALESCE(vacina_aplicada_original_id, 0) <> ? AND excluido_em IS NULL`,
                [v.paciente, atual['imunobiologico_id'], d.dose, v.id, v.id],
              );
              if (ja)
                throw recusa(
                  'dose-ja-registrada',
                  `A dose ${d.dose} deste imunobiológico já está registrada em outra aplicação do paciente.`,
                );
            }
            await tx.alterar('vacina_aplicada', num(atual['id']), num(atual['versao']), {
              situacao: 'retificada',
              motivo_correcao: v.motivo,
            });
            await tx.incluir('vacina_aplicada', {
              estabelecimento_id: est,
              paciente_id: atual['paciente_id'],
              atendimento_id: atual['atendimento_id'],
              imunobiologico_id: atual['imunobiologico_id'],
              dose: d.dose ?? atual['dose'],
              lote: d.lote ?? atual['lote'],
              fabricante: d.fabricante !== undefined ? d.fabricante : atual['fabricante'],
              validade_lote: d.validadeLote ? d.validadeLote.slice(0, 10) : atual['validade_lote'],
              via_de_uso_id: d.via
                ? await catalogo(tx, 'via_de_uso', d.via, 'via de aplicação')
                : atual['via_de_uso_id'],
              regiao_corporal_id: d.local
                ? await catalogo(tx, 'regiao_corporal', d.local, 'local de aplicação')
                : atual['regiao_corporal_id'],
              aplicador_profissional_id: atual['aplicador_profissional_id'],
              aplicada_em: d.aplicadaEm ? instanteDe(d.aplicadaEm, fuso) : atual['aplicada_em'],
              situacao: 'ativa',
              vacina_aplicada_original_id: v.id,
              motivo_correcao: v.motivo,
              situacao_envio: 'aguardando_conector',
              prazo_envio_em: atual['prazo_envio_em'],
            });
            return { versao: correcoes + 1 };
          },
        });
        const evento = s.eventos[0] !== undefined ? String(s.eventos[0]) : '';
        return { id: v.id, versao: Number(s.resultado['versao']), evento, outbox: evento };
      },

      prescrever: async () => {
        throw modeloPendente('A prescrição de enfermagem com os horários da atividade');
      },
      suspender: async () => {
        throw modeloPendente('A suspensão da atividade prescrita pelo enfermeiro');
      },
      checar: async () => {
        throw modeloPendente('A checagem do cuidado prescrito pelo enfermeiro');
      },
      estornar: async () => {
        throw modeloPendente('O estorno da checagem do cuidado');
      },
      carregarTerminologia: async () => {
        throw modeloPendente('A terminologia licenciada carregada por estabelecimento');
      },
      prescreverMedicamento: async () => {
        throw modeloPendente('A receita do enfermeiro (protocolo, lista e segundo identificador)');
      },
      inativarReceita: async () => {
        throw modeloPendente('A suspensão ou o cancelamento da receita do enfermeiro');
      },
    };
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  async dominios(c: ContextoSae) {
    void c;
    // A escala dos resultados é de 1 a 5 (CHECK do modelo); a direção da meta sai das notas.
    return {
      escala: [1, 2, 3, 4, 5].map((n) => ({ codigo: n, rotulo: String(n) })),
      metas: [
        { codigo: 1, rotulo: 'Aumentar para' },
        { codigo: 2, rotulo: 'Manter em' },
        { codigo: 3, rotulo: 'Diminuir para' },
      ],
    };
  }

  /** O catálogo de enfermagem da rede (diagnósticos, características, resultados e intervenções ativos). */
  terminologia(c: ContextoSae): Promise<TermoTerminologiaSae[]> {
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT 'diagnostico' AS tipo, codigo, NULL AS pai, descricao, tipo = 'risco' AS risco FROM diagnostico_enfermagem WHERE ativo = TRUE
         UNION ALL
         SELECT CASE WHEN tipo = 'caracteristica_definidora' THEN 'caracteristica' ELSE 'fator' END, codigo, NULL, descricao, FALSE
           FROM caracteristica_diagnostico_enfermagem WHERE ativo = TRUE
         UNION ALL
         SELECT 'resultado', codigo, NULL, descricao, FALSE FROM resultado_enfermagem WHERE ativo = TRUE
         UNION ALL
         SELECT 'intervencao', codigo, NULL, descricao, FALSE FROM intervencao_enfermagem WHERE ativo = TRUE
         ORDER BY 1, 2 LIMIT 20000`,
      );
      return linhas.map((t) => ({
        sistema: 'NNN' as const,
        versao: '',
        licenca: '',
        tipo: texto(t['tipo']),
        codigo: texto(t['codigo']),
        pai: textoOuNulo(t['pai']),
        descricao: texto(t['descricao']),
        risco: booleano(t['risco']),
      }));
    });
  }

  sae(c: ContextoSae, atendimento: number): Promise<SaeDoAtendimento> {
    return this.ler(c, async (l, est, fuso) => {
      const p = await l.uma(
        `SELECT pe.id, pe.versao, pe.avaliacao, COALESCE(pe.alterado_em, pe.criado_em) AS em,
                ${LOGIN_DE('COALESCE(pe.alterado_por, pe.criado_por)')} AS login, pe.registro_assistencial_id
           FROM processo_enfermagem pe
          WHERE pe.atendimento_id = ? AND pe.estabelecimento_id = ? AND pe.situacao = 'aberto' AND pe.excluido_em IS NULL
          ORDER BY pe.id DESC LIMIT 1`,
        [atendimento, est],
      );
      if (!p) return { versoes: [], cabecalho: null, itens: [] };
      const diags = await l.consultar(
        `SELECT d.id, de.codigo, de.descricao, d.criado_em, ${LOGIN_DE('d.criado_por')} AS login,
                (SELECT t.codigo FROM termo_terminologia tt JOIN terminologia t ON t.id = tt.terminologia_id
                  WHERE tt.id = de.termo_terminologia_id) AS terminologia
           FROM diagnostico_enfermagem_paciente d JOIN diagnostico_enfermagem de ON de.id = d.diagnostico_enfermagem_id
          WHERE d.atendimento_id = ? AND d.estabelecimento_id = ? AND d.situacao = 'ativo' AND d.excluido_em IS NULL
          ORDER BY d.prioridade, d.id`,
        [atendimento, est],
      );
      const ids = diags.map((d) => num(d['id']));
      const em = (v: unknown) => civilDe(v, fuso) ?? '';
      const vazio = {
        codigo: null,
        caracteristicas: [] as string[],
        fatores: [] as string[],
        escala: null,
        meta: null,
        escalaMeta: null,
        frequencia: null,
        horarios: [] as string[],
        inicio: null,
        fim: null,
        situacao: null,
        nota: null,
        chave: null,
      };
      const itens: ItemSae[] = [];
      if (ids.length) {
        const caract = await l.consultar(
          `SELECT x.diagnostico_enfermagem_paciente_id AS d, cd.codigo, cd.tipo
             FROM diagnostico_enfermagem_paciente_caracteristica x
             JOIN caracteristica_diagnostico_enfermagem cd ON cd.id = x.caracteristica_diagnostico_enfermagem_id
            WHERE x.diagnostico_enfermagem_paciente_id IN (${marcadores(ids.length)}) AND x.excluido_em IS NULL`,
          ids,
        );
        const avals = await l.consultar(
          `SELECT a.id, a.diagnostico_enfermagem_paciente_id AS d, a.sequencia, a.resultado_enfermagem_id, r.codigo,
                  r.descricao, a.nota_inicial, a.nota_meta, a.nota_obtida, a.evolucao, a.avaliado_em,
                  ${LOGIN_DE('a.criado_por')} AS login
             FROM avaliacao_resultado_enfermagem a JOIN resultado_enfermagem r ON r.id = a.resultado_enfermagem_id
            WHERE a.diagnostico_enfermagem_paciente_id IN (${marcadores(ids.length)}) AND a.situacao <> 'cancelada'
              AND a.excluido_em IS NULL
            ORDER BY a.sequencia`,
          ids,
        );
        const planos = await l.consultar(
          `SELECT pl.id, pl.diagnostico_enfermagem_paciente_id AS d, i.codigo, i.descricao, pl.criado_em,
                  ${LOGIN_DE('pl.criado_por')} AS login
             FROM plano_intervencao_enfermagem pl JOIN intervencao_enfermagem i ON i.id = pl.intervencao_enfermagem_id
            WHERE pl.diagnostico_enfermagem_paciente_id IN (${marcadores(ids.length)}) AND pl.situacao <> 'cancelada'
              AND pl.excluido_em IS NULL
            ORDER BY pl.sequencia`,
          ids,
        );
        for (const d of diags) {
          const id = num(d['id']);
          const cs = caract.filter((x) => num(x['d']) === id);
          itens.push({
            ...vazio,
            id,
            tipo: 'diagnostico',
            pai: null,
            codigo: texto(d['codigo']),
            descricao: texto(d['descricao']),
            caracteristicas: cs
              .filter((x) => x['tipo'] === 'caracteristica_definidora')
              .map((x) => texto(x['codigo'])),
            fatores: cs
              .filter((x) => x['tipo'] !== 'caracteristica_definidora')
              .map((x) => texto(x['codigo'])),
            usuario: texto(d['login']),
            em: em(d['criado_em']),
          });
          // O primeiro registro de cada resultado é a avaliação inicial; os seguintes, as evoluções dele.
          const primeiros = new Map<number, Linha>();
          const ultimaNota = new Map<number, number>();
          for (const a of avals.filter((x) => num(x['d']) === id)) {
            const r = num(a['resultado_enfermagem_id']);
            const base = primeiros.get(r);
            if (!base) {
              primeiros.set(r, a);
              ultimaNota.set(r, num(a['nota_inicial']));
              itens.push({
                ...vazio,
                id: num(a['id']),
                tipo: 'resultado',
                pai: id,
                codigo: texto(a['codigo']),
                descricao: texto(a['descricao']),
                escala: num(a['nota_inicial']),
                meta: direcaoDaMeta(num(a['nota_inicial']), num(a['nota_meta'])),
                escalaMeta: num(a['nota_meta']),
                usuario: texto(a['login']),
                em: em(a['avaliado_em']),
              });
              continue;
            }
            const obtida = num(a['nota_obtida']);
            itens.push({
              ...vazio,
              id: num(a['id']),
              tipo: 'evolucao',
              pai: num(base['id']),
              descricao: texto(a['descricao']),
              escala: obtida,
              situacao: situacaoDaEvolucao(num(a['nota_meta']), ultimaNota.get(r) ?? obtida, obtida),
              nota: textoOuNulo(a['evolucao']),
              usuario: texto(a['login']),
              em: em(a['avaliado_em']),
            });
            ultimaNota.set(r, obtida);
          }
          for (const pl of planos.filter((x) => num(x['d']) === id))
            itens.push({
              ...vazio,
              id: num(pl['id']),
              tipo: 'intervencao',
              pai: id,
              codigo: texto(pl['codigo']),
              descricao: texto(pl['descricao']),
              usuario: texto(pl['login']),
              em: em(pl['criado_em']),
            });
        }
      }
      const sistema = SISTEMA_DA_TERMINOLOGIA[texto(diags[0]?.['terminologia']).toLowerCase()] ?? 'SINT';
      const versao = num(p['versao']);
      // As versões do processo: cada registro grava um lote de diagnósticos com o mesmo início (a versão anterior fica
      // inativada com o fim); a última é a versão atual do processo.
      const lotes = await l.consultar(
        `SELECT v.inicio_em, ${LOGIN_DE('v.por')} AS login
           FROM (SELECT inicio_em, MIN(criado_por) AS por FROM diagnostico_enfermagem_paciente
                  WHERE atendimento_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
                  GROUP BY inicio_em) v
          ORDER BY v.inicio_em`,
        [atendimento, est],
      );
      const versoes = lotes.length
        ? lotes.map((x, i) => ({
            id: num(p['id']),
            versao: Math.max(1, versao - (lotes.length - 1 - i)),
            usuario: texto(x['login']),
            em: em(x['inicio_em']),
          }))
        : [{ id: num(p['id']), versao, usuario: texto(p['login']), em: em(p['em']) }];
      return {
        versoes,
        cabecalho: {
          id: num(p['id']),
          versao,
          avaliacao: texto(p['avaliacao']),
          sistema,
          versaoTerminologia: '',
          usuario: texto(p['login']),
          em: em(p['em']),
          registroProntuario: numOuNulo(p['registro_assistencial_id']),
        },
        itens,
      };
    });
  }

  /** Pendência de modelo: a atividade prescrita pelo enfermeiro (com os horários) ainda não tem tabela. */
  async atividadesVigentes(c: ContextoSae, atendimentos: readonly number[]): Promise<AtividadeVigente[]> {
    void [c, atendimentos];
    return [];
  }

  async atividade(
    c: ContextoSae,
    id: number,
  ): Promise<(AtividadeVigente & { readonly paciente: number; readonly revisadoEm: string | null }) | null> {
    void [c, id];
    return null;
  }

  async checagens(
    c: ContextoSae,
    o: { readonly atividades: readonly number[]; readonly de: string; readonly ate: string },
  ): Promise<{ itens: (ChecagemCuidadoLida & { atendimento: number })[]; cortada: boolean }> {
    void [c, o];
    return { itens: [], cortada: false };
  }

  async checagem(
    c: ContextoSae,
    id: number,
  ): Promise<(ChecagemCuidadoLida & { atendimento: number }) | null> {
    void [c, id];
    return null;
  }

  consulta(c: ContextoSae, atendimento: number): Promise<ConsultaDeEnfermagem | null> {
    return this.ler(c, async (l, est, fuso) => {
      const a = await l.uma(`${SQL_ATENDIMENTO} AND a.id = ?`, [est, atendimento]);
      return a ? consultaDe(a, fuso) : null;
    });
  }

  consultasDoProfissional(c: ContextoSae, o: { readonly vinculos: readonly number[]; readonly dia: string }) {
    if (o.vinculos.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est, fuso) => {
      const inicio = instanteDe(`${o.dia}T00:00`, fuso);
      const fim = new Date(inicio.getTime() + 86_400_000);
      return (
        await l.consultar(
          `${SQL_ATENDIMENTO} AND ca.tipo_base <> 'internacao' AND a.situacao <> 'cancelado'
              AND a.profissional_id IN (${marcadores(o.vinculos.length)}) AND a.entrada_em >= ? AND a.entrada_em < ?
            ORDER BY a.entrada_em, a.id LIMIT 500`,
          [est, ...o.vinculos, inicio, fim],
        )
      ).map((a) => externoDe(a, fuso));
    });
  }

  externosDoDia(c: ContextoSae, dia: string) {
    return this.ler(c, async (l, est, fuso) => {
      const inicio = instanteDe(`${dia}T00:00`, fuso);
      const rs = await l.consultar(
        `${SQL_ATENDIMENTO} AND ca.tipo_base <> 'internacao' AND a.situacao IN ('aberto','em_atendimento','em_observacao')
            AND a.entrada_em >= ? AND a.entrada_em < ?
          ORDER BY a.entrada_em DESC, a.id DESC LIMIT ${TETO_EXTERNOS_DO_DIA + 1}`,
        [est, inicio, new Date(inicio.getTime() + 86_400_000)],
      );
      return {
        itens: rs.slice(0, TETO_EXTERNOS_DO_DIA).map((a) => externoDe(a, fuso)),
        cortada: rs.length > TETO_EXTERNOS_DO_DIA,
      };
    });
  }

  cabecalhoReceita(
    c: ContextoSae,
    o: { readonly paciente: number; readonly vinculo: number },
  ): Promise<CabecalhoReceita> {
    return this.ler(c, async (l, est) => {
      const e = await l.uma('SELECT razao_social, nome_fantasia, cnpj FROM estabelecimento WHERE id = ?', [
        est,
      ]);
      const p = await l.uma(
        `SELECT COALESCE(NULLIF(pa.nome_social, ''), pf.nome) AS nome, pf.data_nascimento, pf.cpf
           FROM paciente pa JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id WHERE pa.id = ? AND pa.excluido_em IS NULL`,
        [o.paciente],
      );
      const pr = await l.uma(
        `SELECT COALESCE(pr.nome_exibicao, pf.nome) AS nome, cc.sigla, uf.sigla AS uf, ic.numero_inscricao
           FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
           LEFT JOIN inscricao_conselho ic ON ic.profissional_id = pr.id AND ic.principal = TRUE AND ic.excluido_em IS NULL
           LEFT JOIN conselho_classe cc ON cc.id = ic.conselho_classe_id
           LEFT JOIN unidade_federativa uf ON uf.id = ic.unidade_federativa_id
          WHERE pr.id = ? AND pr.excluido_em IS NULL`,
        [o.vinculo],
      );
      const sigla = textoOuNulo(pr?.['sigla']);
      return {
        instituicao: texto(e?.['razao_social'] ?? e?.['nome_fantasia']),
        cnpj: textoOuNulo(e?.['cnpj']),
        paciente: texto(p?.['nome']),
        nascimento: dataDe(p?.['data_nascimento']),
        cpf: textoOuNulo(p?.['cpf']),
        prescritor: texto(pr?.['nome']),
        conselho: sigla ? `${sigla}-${texto(pr?.['uf'])} ${texto(pr?.['numero_inscricao'])}` : null,
        categoria: sigla === 'COREN' ? 'Enfermeiro' : sigla === 'CRM' ? 'Médico' : null,
      };
    });
  }

  /** Pendência de modelo: a receita do enfermeiro ainda não tem os campos dela. */
  async receitas(c: ContextoSae, atendimento: number): Promise<ReceitaDoEnfermeiro[]> {
    void [c, atendimento];
    return [];
  }

  vacinas(c: ContextoSae, paciente: number): Promise<VacinaAplicada[]> {
    return this.ler(c, async (l, est, fuso) => {
      const linhas = await l.consultar(
        `SELECT v.id, v.vacina_aplicada_original_id AS original, v.dose, v.lote, v.fabricante, v.validade_lote,
                v.aplicada_em, v.prazo_envio_em, v.situacao, v.situacao_envio, v.motivo_correcao, v.criado_em,
                v.alterado_em, i.codigo AS imuno, i.descricao AS imuno_nome, vu.codigo AS via, rc.codigo AS local,
                ${LOGIN_DE('v.criado_por')} AS login, ${LOGIN_DE('v.alterado_por')} AS login_alteracao
           FROM vacina_aplicada v
           JOIN imunobiologico i ON i.id = v.imunobiologico_id
           JOIN via_de_uso vu ON vu.id = v.via_de_uso_id
           JOIN regiao_corporal rc ON rc.id = v.regiao_corporal_id
          WHERE v.paciente_id = ? AND v.estabelecimento_id = ? AND v.excluido_em IS NULL
          ORDER BY v.aplicada_em DESC, v.id`,
        [paciente, est],
      );
      const originais = linhas.filter((v) => v['original'] === null);
      return originais.map((o): VacinaAplicada => {
        const id = num(o['id']);
        const rets = linhas
          .filter((v) => num(v['original']) === id)
          .sort((a, b) => num(a['id']) - num(b['id']));
        const correcoes: CorrecaoVacina[] = [];
        let anterior = o;
        for (const r of rets) {
          correcoes.push({
            versao: correcoes.length + 1,
            tipo: 'retificacao',
            motivo: texto(r['motivo_correcao']),
            dados: diferencas(anterior, r, fuso),
            usuario: texto(r['login']),
            em: (civilDe(r['criado_em'], fuso) ?? '').slice(0, 16),
            ...envioDaVacina(texto(r['situacao_envio'])),
          });
          anterior = r;
        }
        if (anterior['situacao'] === 'estornada')
          correcoes.push({
            versao: correcoes.length + 1,
            tipo: 'estorno',
            motivo: texto(anterior['motivo_correcao']),
            dados: null,
            usuario: texto(anterior['login_alteracao']),
            em: (civilDe(anterior['alterado_em'], fuso) ?? '').slice(0, 16),
            evento: 'pendente',
            entrega: null,
          });
        return {
          id,
          imunobiologico: texto(o['imuno']),
          nome: texto(o['imuno_nome']),
          lote: texto(o['lote']),
          fabricante: textoOuNulo(o['fabricante']),
          validadeLote: dataDe(o['validade_lote']) ?? '',
          dose: texto(o['dose']) as DoseVacina,
          via: texto(o['via']),
          local: texto(o['local']),
          aplicadaEm: (civilDe(o['aplicada_em'], fuso) ?? '').slice(0, 16),
          prazoEnvio: (civilDe(o['prazo_envio_em'], fuso) ?? '').slice(0, 16),
          ...envioDaVacina(texto(o['situacao_envio'])),
          usuario: texto(o['login']),
          em: civilDe(o['criado_em'], fuso) ?? '',
          correcoes,
        };
      });
    });
  }

  recusasRia(c: ContextoSae): Promise<RecusaEnvioVacina[]> {
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `SELECT e.id, e.vacina_aplicada_id, e.versao_atual, e.situacao, e.tentativas, e.codigo_erro, e.mensagem_erro,
                  e.criado_em, e.alterado_em,
                  (SELECT ev.tipo_versao FROM envio_rnds_versao ev WHERE ev.envio_rnds_id = e.id
                    ORDER BY ev.numero_versao DESC LIMIT 1) AS tipo_versao
             FROM envio_rnds e
            WHERE e.estabelecimento_id = ? AND e.tipo_documento = 'imunizacao' AND e.situacao IN ('rejeitado','erro')
              AND e.excluido_em IS NULL
            ORDER BY e.alterado_em DESC, e.id DESC LIMIT 500`,
          [est],
        )
      ).map((e) => {
        const morto = e['situacao'] === 'rejeitado';
        const tv = texto(e['tipo_versao']);
        return {
          envio: num(e['id']),
          evento: tv === 'cancelamento' ? 'cancelada' : tv === 'substituicao' ? 'substituida' : 'aplicada',
          vacina: numOuNulo(e['vacina_aplicada_id']),
          versao: num(e['versao_atual']),
          situacao: morto ? 'morto' : 'pendente',
          tentativas: num(e['tentativas']),
          motivo: texto(e['mensagem_erro'] ?? e['codigo_erro']),
          proximaTentativaEm: null,
          mortoEm: morto ? civilDe(e['alterado_em'], fuso) : null,
          criadoEm: civilDe(e['criado_em'], fuso) ?? '',
        } satisfies RecusaEnvioVacina;
      }),
    );
  }
}

// ── Apoio ─────────────────────────────────────────────────────────────────────────────────────────────────────

const contexto = (c: ContextoNucleo): ContextoNucleo => ({
  cliente: c.cliente,
  estabelecimento: c.estabelecimento,
  usuario: c.usuario,
  correlacao: c.correlacao || 'sae',
});

/** Tabelas de catálogo consultadas pelo código (lista branca: o nome entra literal no SQL). */
const CATALOGOS = new Set([
  'diagnostico_enfermagem',
  'caracteristica_diagnostico_enfermagem',
  'resultado_enfermagem',
  'intervencao_enfermagem',
  'imunobiologico',
  'via_de_uso',
  'regiao_corporal',
]);

async function catalogo(tx: TxOperacao, tabela: string, codigo: string, nome: string): Promise<number> {
  if (!CATALOGOS.has(tabela)) throw new Error('Catálogo fora da lista.');
  const r = await tx.uma<{ id: number }>(`SELECT id FROM ${tabela} WHERE codigo = ? AND ativo = TRUE`, [
    codigo,
  ]);
  if (!r) throw recusa('termo-nao-cadastrado', `O código ${codigo} (${nome}) não está no catálogo ativo.`);
  return Number(r.id);
}

/** Encerra os diagnósticos ativos do atendimento (a nova versão do processo os substitui). */
async function encerrarDiagnosticos(
  tx: TxOperacao,
  atendimento: number,
  est: number,
  agora: Date,
): Promise<void> {
  for (const d of await tx.consultarParaAtualizar<{ id: number; versao: number }>(
    `SELECT id, versao FROM diagnostico_enfermagem_paciente
      WHERE atendimento_id = ? AND estabelecimento_id = ? AND situacao = 'ativo' AND excluido_em IS NULL`,
    [atendimento, est],
  ))
    await tx.alterar('diagnostico_enfermagem_paciente', Number(d.id), Number(d.versao), {
      situacao: 'inativado',
      fim_em: agora,
    });
}

async function vacinaVigente(tx: TxOperacao, original: number): Promise<Linha | null> {
  const [v] = await tx.consultarParaAtualizar<Linha>(
    `SELECT * FROM vacina_aplicada WHERE vacina_aplicada_original_id = ? AND excluido_em IS NULL
      ORDER BY id DESC LIMIT 1`,
    [original],
  );
  return v ?? null;
}

/** Os campos que a retificação mudou (no vocabulário da tela). */
function diferencas(a: Linha, b: Linha, fuso: string): Record<string, string | null> {
  const d: Record<string, string | null> = {};
  const par = (campo: string, x: unknown, y: unknown) => {
    if (texto(x) !== texto(y)) d[campo] = textoOuNulo(y);
  };
  par('dose', a['dose'], b['dose']);
  par('lote', a['lote'], b['lote']);
  par('fabricante', a['fabricante'], b['fabricante']);
  par('validadeLote', dataDe(a['validade_lote']), dataDe(b['validade_lote']));
  par('via', a['via'], b['via']);
  par('local', a['local'], b['local']);
  par(
    'aplicadaEm',
    civilDe(a['aplicada_em'], fuso)?.slice(0, 16),
    civilDe(b['aplicada_em'], fuso)?.slice(0, 16),
  );
  return d;
}

const SQL_ATENDIMENTO = `
  SELECT a.id, a.paciente_id, pa.numero_prontuario, COALESCE(NULLIF(pa.nome_social, ''), pf.nome) AS nome,
         ca.tipo_base, a.entrada_em, a.profissional_id, oc.codigo_cbo, a.situacao
    FROM atendimento a
    JOIN paciente pa ON pa.id = a.paciente_id
    JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
    JOIN categoria_atendimento ca ON ca.id = a.categoria_atendimento_id
    LEFT JOIN ocupacao_cbo oc ON oc.id = a.ocupacao_cbo_id
   WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL`;

function consultaDe(a: Linha, fuso: string): ConsultaDeEnfermagem {
  return {
    atendimento: num(a['id']),
    paciente: num(a['paciente_id']),
    numero: num(a['numero_prontuario']),
    nome: texto(a['nome']),
    // E: atendimento externo (consulta, pronto atendimento, exame); I: internação (o vocabulário da porta da enfermagem).
    tipo: a['tipo_base'] === 'internacao' ? 'I' : 'E',
    entrada: civilDe(a['entrada_em'], fuso)?.slice(0, 16) ?? null,
    vinculoDoAtendimento: numOuNulo(a['profissional_id']),
    cboDoAtendimento: textoOuNulo(a['codigo_cbo']),
    ativo: !['encerrado', 'cancelado'].includes(texto(a['situacao'])),
  };
}

function externoDe(a: Linha, fuso: string) {
  return {
    atendimento: num(a['id']),
    paciente: num(a['paciente_id']),
    numero: num(a['numero_prontuario']),
    nome: texto(a['nome']),
    entrada: civilDe(a['entrada_em'], fuso)?.slice(0, 16) ?? null,
  };
}

/** Porta indisponível (fora de dev/ci sem o núcleo): 503 em tudo. */
export const portaSaeIndisponivel = (): PortaSae => portaIndisponivel<PortaSae>(METODOS_PORTA_SAE);
