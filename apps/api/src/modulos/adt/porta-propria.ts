// Porta da internação, dos leitos, da higienização e do SAME (M21) sobre o banco do cliente, pelo @sgh/nucleo: leituras
// somente leitura (internacao, ocupacao_leito, leito_hospitalar, acomodacao, bloco_internacao, alta_hospitalar,
// alta_medica, agendamento_internacao, periodo_situacao_leito, solicitacao_limpeza, reserva_leito, movimento_prontuario
// e os cadastros de apoio) e gravações pelo Executor (operacoes.ts e as gravações diretas, numa operação com trilha,
// outbox e idempotência na mesma transação). Toda leitura filtra o estabelecimento da sessão e os excluídos; os
// cadastros de apoio sem estabelecimento (fonte pagadora, especialidade, motivos, categorias) são da rede inteira.
// Melhoria: o mapa e a internação leem o mesmo banco que gravam (sem espelho): a alta pede a limpeza terminal e abre
// o período de higienização (operacoes.ts); a ocupação de leito bloqueado ou reservado é recusada na gravação, por
// isso não há registro de conflito; as etapas da limpeza saem dos instantes da solicitação e da inspeção; a etapa
// "liberado" é a mesma liberação da ação "Liberar leito".
// Melhoria: os estados do leito são períodos de situação com o motivo de bloqueio e o isolamento pelas chaves do
// modelo (motivo_bloqueio_leito_id, isolamento_paciente_id); `dados` fica só como retrato; a situação atual do leito
// (leito_hospitalar.situacao_leito_id) acompanha o período na mesma transação.
// Melhoria: a gravação direta leva a chave de idempotência da requisição (apoio-idempotente.ts) e confere a versão
// vista pela tela quando ela a envia.
// Melhoria: horas no fuso do estabelecimento; a alta médica é a alta médica do prontuário (alta_medica), com o
// destino codificado e o cancelamento com motivo; os atributos do leito são as colunas do próprio leito.
// Os registros do SAME sem movimento (remessa, aceite, cobrança, exclusão, ocorrência e descarte) ficam em
// ocorrencia_arquivo_prontuario, gravados e lidos aqui. Pendências (pedidos do lote 03-01 e da F2.4, lote 16): foto da
// etapa da limpeza; as fichas da internação leem a configuração de documentos quando houver (por ora nenhuma ficha extra).
import { randomUUID } from 'node:crypto';
import {
  type ApoioInternacaoTela,
  chaveTextoLeito,
  type DestinoAlta,
  diariasFaturaveis,
  type EstadoLeitoNovo,
  type EtapaLimpeza,
  type HistoricoOcupacao,
  type InternacaoResumo,
  type LeiturasPainel,
  type LocalizacaoConta,
  type PreInternacaoItem,
} from '@sgh/contratos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ProfissionalDaSessao } from '../atendimento/porta.js';
import type { DestinoPorta, LiberacaoGravacao, TrilhaDaGravacao } from '../exames/public-api.js';
import { civil, FUSO_PADRAO, instanteCivil, relogioNoFuso } from '../exames/relogio.js';
import { FonteInternacaoPropria } from '../internacao/fonte-propria.js';
import {
  apoio,
  carimboVersao,
  clinicaDaClassificacao,
  ETAPA_DA_SITUACAO,
  informadoOuUnico,
  leitoDaChave,
  liberarSolicitacao,
  n,
  nn,
  OPERACOES_ADT_BANCO,
  situacaoDoLeitoPorBase,
  situacaoLimpeza,
  situarLeito,
  texto,
} from './operacoes.js';
import { chaveDaGravacaoDireta, type ComIdempotencia } from './apoio-idempotente.js';
import { PortaDocumentosInternacao } from './documentos-internacao.js';
import type {
  AltaMedicaDecidida,
  ContextoAdt,
  DadosImpressoInternacao,
  EtapaDaLimpeza,
  GravadorSghAdt,
  OpcoesListaInternacoes,
  PortaAdt,
} from './porta.js';
import type {
  DetalheInternacao,
  EstadosDoMapa,
  ItemIncoerencia,
  LimpezaGiro,
  SolicitacaoLimpezaFila,
} from './tipos.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoAdt = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const TETO_LISTA = 500;

/** Estado do leito da tela → situação base do cadastro de situações do leito. */
const BASE_DO_ESTADO: Readonly<Record<EstadoLeitoNovo, string>> = {
  bloqueio: 'bloqueado',
  precaucao: 'interditado',
  extra: 'livre',
  higienizacao: 'higienizacao',
};
const ESTADO_DA_BASE: Readonly<Record<string, EstadoLeitoNovo>> = {
  bloqueado: 'bloqueio',
  interditado: 'precaucao',
  manutencao: 'bloqueio',
  higienizacao: 'higienizacao',
};
/** Destino da alta médica (tela) → destino do prontuário. */
const DESTINO_MEDICO: Readonly<Record<DestinoAlta, string>> = {
  domicilio: 'domicilio',
  internacaoDomiciliar: 'atencao_domiciliar',
  transferenciaExterna: 'transferencia_hospital',
  obito: 'obito',
  aPedido: 'a_pedido',
  administrativo: 'outro',
};
const DESTINO_DA_TELA = Object.fromEntries(Object.entries(DESTINO_MEDICO).map(([a, b]) => [b, a]));
const CRITICIDADES = ['baixa', 'media', 'alta', 'intensiva'] as const;
/** Natureza da clínica assistencial → clínica da tela (só as três que a tela conhece). */
const CLINICA_DA_NATUREZA: Readonly<Record<string, string>> = {
  medica: 'M',
  cirurgica: 'C',
  pediatrica: 'N',
};
const SEXO_DO_LEITO: Readonly<Record<string, string>> = { M: 'masculino', F: 'feminino', A: 'qualquer' };

const TABELAS_DIRETAS = [
  'alta_medica',
  'internacao',
  'periodo_situacao_leito',
  'leito_hospitalar',
  'reserva_leito',
  'solicitacao_limpeza',
  'solicitacao_limpeza_local',
  'inspecao_limpeza',
  'atributo_categoria_acomodacao',
  'ocorrencia_arquivo_prontuario',
];

const SQL_RESUMO = `
  SELECT i.id, i.versao, i.paciente_id, p.numero_prontuario, COALESCE(p.nome_social, pf.nome) AS nome,
         i.data_hora_entrada, i.data_hora_alta, i.situacao, i.fonte_pagadora_id, fp.nome AS convenio,
         i.especialidade_medica_id, em.descricao AS especialidade, mi.classificacao,
         COALESCE(pm.nome_exibicao, pfm.nome) AS medico, COALESCE(b.codigo, '') AS bloco, ac.codigo AS acomodacao,
         lh.codigo AS leito, ca.descricao AS tipo_acomodacao, ca.terapia_intensiva, ca.id AS tipo_id,
         EXISTS (SELECT 1 FROM isolamento_paciente ip WHERE ip.internacao_id = i.id AND ip.situacao = 'ativo'
                   AND ip.excluido_em IS NULL) AS isolamento,
         am.motivo_saida_hospitalar_id AS am_motivo, am.destino AS am_destino, am.alta_medica_em AS am_em,
         COALESCE(pam.nome_exibicao, pfam.nome) AS am_medico
    FROM internacao i
    JOIN paciente p ON p.id = i.paciente_id
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    JOIN fonte_pagadora fp ON fp.id = i.fonte_pagadora_id
    JOIN especialidade_medica em ON em.id = i.especialidade_medica_id
    JOIN modalidade_internacao mi ON mi.id = i.modalidade_internacao_id
    JOIN profissional pm ON pm.id = i.medico_assistente_profissional_id
    JOIN pessoa_fisica pfm ON pfm.id = pm.pessoa_fisica_id
    LEFT JOIN leito_hospitalar lh ON lh.id = i.leito_hospitalar_id
    LEFT JOIN acomodacao ac ON ac.id = COALESCE(lh.acomodacao_id, i.acomodacao_id)
    LEFT JOIN bloco_internacao b ON b.id = COALESCE(lh.bloco_internacao_id, ac.bloco_internacao_id)
    LEFT JOIN categoria_acomodacao ca ON ca.id = ac.categoria_acomodacao_id
    LEFT JOIN alta_medica am ON am.id = (SELECT MAX(a2.id) FROM alta_medica a2 WHERE a2.internacao_id = i.id
                                          AND a2.situacao IN ('prevista','programada') AND a2.excluido_em IS NULL)
    LEFT JOIN profissional pam ON pam.id = am.profissional_id
    LEFT JOIN pessoa_fisica pfam ON pfam.id = pam.pessoa_fisica_id
   WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL AND i.situacao <> 'cancelada'`;

export class PortaAdtPropria implements PortaAdt {
  readonly destino: DestinoPorta = 'banco';
  private readonly executor: Executor;
  private readonly painel: FonteInternacaoPropria;

  constructor(
    private readonly nucleo: NucleoAdt,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
    this.painel = new FonteInternacaoPropria(nucleo);
  }

  private contexto(c: ContextoAdt): ContextoNucleo {
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: c.correlacao,
    };
  }

  private ler<T>(c: ContextoAdt, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(this.contexto(c), async (l) => {
      const f = await l.uma<{ fuso_horario: string | null }>(
        'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
        [est],
      );
      return fn(l, est, f?.fuso_horario || FUSO_PADRAO);
    });
  }

  /** Leitura no estabelecimento da sessão com o fuso dele (registros da internação, F3.4). */
  lerNoEstabelecimento<T>(
    c: ContextoAdt,
    fn: (l: Leitor, est: number, fuso: string) => Promise<T>,
  ): Promise<T> {
    return this.ler(c, fn);
  }

  // ── Gravação ─────────────────────────────────────────────────────────────────────────────────

  async podeGravar(c: ContextoAdt, op: string): Promise<LiberacaoGravacao> {
    const operacao = OPERACOES_ADT_BANCO[op];
    if (!operacao) return { pode: false, codigo: 'operacao-desconhecida', motivo: 'Operação desconhecida.' };
    return this.executor.liberacao(operacao, {
      ...this.contexto(c),
      chaveIdempotencia: 'consulta.liberacao',
    });
  }

  async executar(c: ContextoAdt, op: string, entrada: unknown, ctx: ContextoOperacao) {
    const operacao = OPERACOES_ADT_BANCO[op];
    if (!operacao) throw recusa('operacao-desconhecida', 'Operação desconhecida na internação.');
    void c;
    const r = await this.executor.executar(operacao, ctx.cliente, entrada as never, ctx);
    return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
  }

  async gravarSgh<T>(
    c: ContextoAdt,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorSghAdt) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    let saida: { valor: T } | null = null;
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const op = definirOperacao({
      nome: 'internacao.gravacao-direta',
      tabelas: TABELAS_DIRETAS,
      entrada: z.object({ chave: z.string() }),
      gravar: async (tx) => {
        saida = { valor: await fn(gravador(tx, est)) };
        return { valor: saida.valor } as unknown as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'internacao', id: l?.entidadeId ?? null };
      },
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = chaveDaGravacaoDireta(c as ComIdempotencia, 'internacao', randomUUID);
    const ctx: ContextoOperacao = {
      ...this.contexto(c),
      correlacao: c.correlacao || 'internacao',
      chaveIdempotencia: chave,
    };
    const r = await this.executor.executar(op, c.cliente, { chave }, ctx);
    return (r.resultado as unknown as { valor: T }).valor;
  }

  // ── Leituras ─────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoAdt) {
    return this.ler(c, async (_l, _est, fuso) => {
      const r = relogioNoFuso(fuso);
      const hms = new Intl.DateTimeFormat('en-GB', {
        timeZone: fuso,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date());
      return { hoje: r.hoje, agora: `${r.hoje}T${hms}` };
    });
  }

  private resumoDe(r: Linha, fuso: string, hoje: string): InternacaoResumo {
    const e = civil(r['data_hora_entrada'] as Date, fuso);
    const s = r['data_hora_alta'] ? civil(r['data_hora_alta'] as Date, fuso) : null;
    return {
      reg: n(r['id']),
      paciente: n(r['paciente_id']),
      prontuario: n(r['numero_prontuario']),
      nome: texto(r['nome']),
      leito: { bloco: texto(r['bloco']), acomodacao: texto(r['acomodacao']), leito: texto(r['leito']) },
      tipoAcomodacao: texto(r['tipo_acomodacao']),
      intensiva: verdadeiro(r['terapia_intensiva']),
      entrada: e.data,
      horaEntrada: e.hora,
      alta: s?.data ?? null,
      horaSaida: s?.hora ?? null,
      convenio: { codigo: n(r['fonte_pagadora_id']), nome: texto(r['convenio']) },
      clinica: clinicaDaClassificacao(r['classificacao']),
      especialidade: { codigo: n(r['especialidade_medica_id']), nome: texto(r['especialidade']) },
      medicoAssistente: texto(r['medico']),
      diasInternacao: diariasFaturaveis(e.data, s?.data ?? hoje, s?.hora ?? '00:00'),
      isolamento: verdadeiro(r['isolamento']),
      altaMedica:
        r['am_em'] !== null && r['am_em'] !== undefined && r['situacao'] !== 'alta'
          ? {
              motivo: n(r['am_motivo']),
              destino: DESTINO_DA_TELA[texto(r['am_destino'])] ?? texto(r['am_destino']),
              decididaEm: (r['am_em'] as Date).toISOString(),
              medico: texto(r['am_medico']),
            }
          : null,
      versao: carimboVersao(r['versao']),
    };
  }

  internacoes(c: ContextoAdt, o: OpcoesListaInternacoes) {
    return this.ler(c, async (l, est, fuso) => {
      const hoje = relogioNoFuso(fuso).hoje;
      const cond: string[] = [];
      const p: unknown[] = [est];
      const sit = o.situacao ?? 'internados';
      if (sit === 'internados') cond.push("i.situacao IN ('ativa','alta_medica')");
      else if (sit === 'alta') cond.push("i.situacao = 'alta'");
      if (sit !== 'internados' && o.altaDe) {
        cond.push('(i.data_hora_alta IS NULL OR i.data_hora_alta >= ?)');
        p.push(`${o.altaDe} 00:00:00`);
      }
      if (sit !== 'internados' && o.altaAte) {
        cond.push('(i.data_hora_alta IS NULL OR i.data_hora_alta <= ?)');
        p.push(`${o.altaAte} 23:59:59.999`);
      }
      if (o.bloco) {
        cond.push("COALESCE(b.codigo, '') = ?");
        p.push(o.bloco);
      }
      if (o.termo) {
        const t = o.termo.trim();
        if (/^\d+$/.test(t)) {
          cond.push('(i.id = ? OR p.numero_prontuario = ?)');
          p.push(Number(t), Number(t));
        } else {
          cond.push('UPPER(pf.nome) LIKE ?');
          p.push(`%${t.toUpperCase()}%`);
        }
      }
      const sql = `${SQL_RESUMO}${cond.length ? ` AND ${cond.join(' AND ')}` : ''} ORDER BY i.data_hora_entrada DESC LIMIT ${TETO_LISTA + 1}`;
      const linhas = await l.consultar(sql, p);
      return {
        itens: linhas.slice(0, TETO_LISTA).map((r) => this.resumoDe(r, fuso, hoje)),
        cortada: linhas.length > TETO_LISTA,
      };
    });
  }

  detalhe(c: ContextoAdt, reg: number): Promise<DetalheInternacao | null> {
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.uma(`${SQL_RESUMO} AND i.id = ?`, [est, reg]);
      if (!r) return null;
      const hoje = relogioNoFuso(fuso).hoje;
      const extra = await l.uma(
        `SELECT i.numero, i.numero_carteira, i.validade_carteira, i.numero_guia, i.senha_autorizacao, i.diarias_autorizadas,
                i.motivo_saida_hospitalar_id, ms.descricao AS motivo_nome, ca.urgencia, i.atendimento_id,
                COALESCE(i.procedimento_solicitado_procedimento_sigtap_id, i.procedimento_solicitado_item_faturavel_id) AS proc,
                t.codigo_termo AS cid, COALESCE(ps.nome_exibicao, pfs.nome) AS solicitante,
                i.medico_assistente_profissional_id, i.diarias_previstas
           FROM internacao i
           JOIN carater_admissao ca ON ca.id = i.carater_admissao_id
           LEFT JOIN motivo_saida_hospitalar ms ON ms.id = i.motivo_saida_hospitalar_id
           LEFT JOIN termo_terminologia t ON t.id = i.cid_principal_termo_terminologia_id
           LEFT JOIN profissional ps ON ps.id = i.medico_solicitante_profissional_id
           LEFT JOIN pessoa_fisica pfs ON pfs.id = ps.pessoa_fisica_id
          WHERE i.id = ?`,
        [reg],
      );
      const trechos = await l.consultar(
        `SELECT o.data_hora_inicio, o.data_hora_fim, COALESCE(b.codigo, '') AS bloco, ac.codigo AS acomodacao,
                lh.codigo AS leito, ca.id AS tipo, ca.descricao AS tipo_nome
           FROM ocupacao_leito o
           JOIN leito_hospitalar lh ON lh.id = o.leito_hospitalar_id
           JOIN acomodacao ac ON ac.id = o.acomodacao_id
           LEFT JOIN bloco_internacao b ON b.id = COALESCE(lh.bloco_internacao_id, ac.bloco_internacao_id)
           JOIN categoria_acomodacao ca ON ca.id = ac.categoria_acomodacao_id
          WHERE o.internacao_id = ? AND o.situacao <> 'cancelada' AND o.excluido_em IS NULL
          ORDER BY o.data_hora_inicio`,
        [reg],
      );
      const trocas = await l.consultar(
        `SELECT t.ocorrido_em, tt.dado_trocado, fa.nome AS fa, fn.nome AS fn, ea.descricao AS ea, en.descricao AS en,
                COALESCE(pa.nome_exibicao, pfa.nome) AS pa, COALESCE(pn.nome_exibicao, pfn.nome) AS pn, u.login
           FROM troca_internacao t
           JOIN tipo_troca_internacao tt ON tt.id = t.tipo_troca_internacao_id
           LEFT JOIN fonte_pagadora fa ON fa.id = t.anterior_fonte_pagadora_id
           LEFT JOIN fonte_pagadora fn ON fn.id = t.nova_fonte_pagadora_id
           LEFT JOIN especialidade_medica ea ON ea.id = t.anterior_especialidade_medica_id
           LEFT JOIN especialidade_medica en ON en.id = t.nova_especialidade_medica_id
           LEFT JOIN profissional pa ON pa.id = t.anterior_profissional_id
           LEFT JOIN pessoa_fisica pfa ON pfa.id = pa.pessoa_fisica_id
           LEFT JOIN profissional pn ON pn.id = t.novo_profissional_id
           LEFT JOIN pessoa_fisica pfn ON pfn.id = pn.pessoa_fisica_id
           LEFT JOIN usuario u ON u.id = t.usuario_id
          WHERE t.internacao_id = ? ORDER BY t.ocorrido_em`,
        [reg],
      );
      const historico = await l.consultar(
        `SELECT id, data_hora_entrada, data_hora_alta, motivo_saida_hospitalar_id FROM internacao
          WHERE paciente_id = ? AND estabelecimento_id = ? AND id <> ? AND excluido_em IS NULL AND situacao <> 'cancelada'
          ORDER BY data_hora_entrada DESC LIMIT 50`,
        [n(r['paciente_id']), est, reg],
      );
      const resumo = this.resumoDe(r, fuso, hoje);
      const dia = (v: unknown) => (v ? civil(v as Date, fuso) : null);
      const tipoTroca = (d: string) =>
        d === 'fonte_pagadora'
          ? 'convenio'
          : d === 'especialidade'
            ? 'especialidade'
            : d === 'modalidade'
              ? 'clinica'
              : 'medico';
      return {
        resumo,
        cabecalho: texto(extra?.['numero']),
        procedimento: n(extra?.['proc']),
        cid: extra?.['cid'] === null || extra?.['cid'] === undefined ? null : texto(extra['cid']),
        medicoSolicitante: texto(extra?.['solicitante']),
        acomodacaoPlano: resumo.tipoAcomodacao,
        matricula: texto(extra?.['numero_carteira']),
        validadeCarteira: extra?.['validade_carteira']
          ? (extra['validade_carteira'] as Date).toISOString().slice(0, 10)
          : null,
        carater: verdadeiro(extra?.['urgencia']) ? 'urgencia' : 'eletivo',
        motivo: nn(extra?.['motivo_saida_hospitalar_id']),
        motivoNome: texto(extra?.['motivo_nome']),
        permanen: n(extra?.['diarias_previstas']),
        vinculoAssistente: n(extra?.['medico_assistente_profissional_id']),
        trechos: trechos.map((t) => {
          const a = dia(t['data_hora_inicio'])!;
          const b = dia(t['data_hora_fim']);
          return {
            leito: { bloco: texto(t['bloco']), acomodacao: texto(t['acomodacao']), leito: texto(t['leito']) },
            tipo: { codigo: n(t['tipo']), nome: texto(t['tipo_nome']) },
            entrada: a.data,
            horaEntrada: a.hora,
            saida: b?.data ?? null,
            horaSaida: b?.hora ?? null,
          };
        }),
        guias: extra?.['numero_guia']
          ? [
              {
                conta: n(extra['atendimento_id']),
                guia: texto(extra['numero_guia']),
                inicio: resumo.entrada,
                fim: null,
                validadeDias: n(extra['diarias_autorizadas']),
                temSenha: extra['senha_autorizacao'] !== null,
              },
            ]
          : [],
        trocas: trocas.map((t) => {
          const d = dia(t['ocorrido_em'])!;
          const tipo = tipoTroca(texto(t['dado_trocado']));
          const [de, para] =
            tipo === 'convenio'
              ? [t['fa'], t['fn']]
              : tipo === 'especialidade'
                ? [t['ea'], t['en']]
                : [t['pa'], t['pn']];
          return {
            tipo,
            data: d.data,
            hora: d.hora,
            de: texto(de),
            para: texto(para),
            usuario: texto(t['login']),
          };
        }) as DetalheInternacao['trocas'],
        contas: [
          {
            conta: n(extra?.['atendimento_id']),
            inicio: resumo.entrada,
            fim: resumo.alta,
            tipo: 'internacao',
            guias: extra?.['numero_guia'] ? 1 : 0,
          },
        ],
        procedimentosExtras: [],
        historicoPaciente: historico.map((h) => ({
          reg: n(h['id']),
          entrada: dia(h['data_hora_entrada'])!.data,
          alta: dia(h['data_hora_alta'])?.data ?? null,
          motivo: nn(h['motivo_saida_hospitalar_id']),
        })),
      };
    });
  }

  private altasDe(l: Leitor, regs: readonly number[]) {
    if (regs.length === 0) return Promise.resolve([] as Linha[]);
    return l.consultar(
      `SELECT a.id, a.internacao_id, a.profissional_id, a.motivo_saida_hospitalar_id, a.destino, a.alta_medica_em, u.login
         FROM alta_medica a LEFT JOIN usuario u ON u.id = a.criado_por
        WHERE a.internacao_id IN (${lista(regs.length)}) AND a.situacao IN ('prevista','programada') AND a.excluido_em IS NULL
        ORDER BY a.id`,
      [...regs],
    );
  }

  private altaDe(r: Linha): AltaMedicaDecidida {
    return {
      id: n(r['id']),
      vinculo: n(r['profissional_id']),
      motivo: n(r['motivo_saida_hospitalar_id']),
      destino: DESTINO_DA_TELA[texto(r['destino'])] ?? texto(r['destino']),
      decididaEm: r['alta_medica_em'] ? (r['alta_medica_em'] as Date).toISOString() : '',
      decididaPor: texto(r['login']),
    };
  }

  altaMedica(c: ContextoAdt, reg: number) {
    return this.ler(c, async (l, est) => {
      if (!(await l.uma('SELECT id FROM internacao WHERE id = ? AND estabelecimento_id = ?', [reg, est])))
        return null;
      const [a] = (await this.altasDe(l, [reg])).slice(-1);
      return a ? this.altaDe(a) : null;
    });
  }

  altasMedicas(c: ContextoAdt, regs: readonly number[]) {
    return this.ler(c, async (l, est) => {
      const daqui = regs.length
        ? (
            await l.consultar(
              `SELECT id FROM internacao WHERE estabelecimento_id = ? AND id IN (${lista(regs.length)})`,
              [est, ...regs],
            )
          ).map((x) => n(x['id']))
        : [];
      const m = new Map<number, AltaMedicaDecidida>();
      for (const a of await this.altasDe(l, daqui)) m.set(n(a['internacao_id']), this.altaDe(a));
      return m;
    });
  }

  preInternacoes(c: ContextoAdt, o: { situacao?: 'pendente' | 'todas'; problema?: 'saneamento' }) {
    return this.ler(c, async (l, est, fuso) => {
      const linhas = await l.consultar(
        `SELECT a.paciente_id, p.numero_prontuario, COALESCE(p.nome_social, pf.nome) AS nome, a.previsto_para, a.situacao,
                a.fonte_pagadora_id, fp.nome AS convenio, a.especialidade_medica_id, em.descricao AS especialidade,
                COALESCE(pm.nome_exibicao, pfm.nome) AS medico, ca.descricao AS acomodacao, a.versao,
                COALESCE(itf.codigo, ps.codigo_sigtap) AS procedimento
           FROM agendamento_internacao a
           LEFT JOIN item_faturavel itf ON itf.id = a.item_faturavel_id
           LEFT JOIN procedimento_sigtap ps ON ps.id = a.procedimento_sigtap_id
           JOIN paciente p ON p.id = a.paciente_id
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           JOIN fonte_pagadora fp ON fp.id = a.fonte_pagadora_id
           LEFT JOIN especialidade_medica em ON em.id = a.especialidade_medica_id
           JOIN profissional pm ON pm.id = a.medico_profissional_id
           JOIN pessoa_fisica pfm ON pfm.id = pm.pessoa_fisica_id
           LEFT JOIN categoria_acomodacao ca ON ca.id = a.categoria_acomodacao_id
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL
          ORDER BY a.previsto_para IS NULL, a.previsto_para LIMIT ${TETO_LISTA + 1}`,
        [est],
      );
      const pendente = (s: unknown) =>
        ['solicitado', 'aguardando_autorizacao', 'autorizado', 'confirmado', 'em_espera'].includes(texto(s));
      const todos: PreInternacaoItem[] = linhas.slice(0, TETO_LISTA).map((r) => {
        const semData = r['situacao'] === 'em_espera';
        const d = semData || r['previsto_para'] === null ? null : civil(r['previsto_para'] as Date, fuso);
        return {
          paciente: n(r['paciente_id']),
          prontuario: n(r['numero_prontuario']),
          nome: texto(r['nome']),
          dataPrevista: d ? d.data : null,
          horaPrevista: d ? d.hora : '',
          situacao: pendente(r['situacao']) ? 'pendente' : 'outra',
          problema: semData ? 'sem-data' : null,
          convenio: { codigo: n(r['fonte_pagadora_id']), nome: texto(r['convenio']) },
          especialidade: { codigo: n(r['especialidade_medica_id']), nome: texto(r['especialidade']) },
          medico: texto(r['medico']),
          acomodacao: r['acomodacao'] === null ? null : texto(r['acomodacao']),
          procedimento: r['procedimento'] === null ? null : Number(texto(r['procedimento'])) || null,
          versao: n(r['versao']),
        };
      });
      const itens = todos.filter(
        (x) =>
          (o.situacao === 'todas' || x.situacao === 'pendente') &&
          (o.problema !== 'saneamento' || x.problema !== null),
      );
      return {
        itens,
        cortada: linhas.length > TETO_LISTA,
        contagens: {
          pendentes: todos.filter((x) => x.situacao === 'pendente').length,
          semData: todos.filter((x) => x.problema === 'sem-data').length,
          impossiveis: 0,
        },
      };
    });
  }

  preDoPaciente(c: ContextoAdt, paciente: number) {
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.uma(
        `SELECT a.previsto_para, a.situacao, a.fonte_pagadora_id, a.especialidade_medica_id, cl.natureza, ca.urgencia,
                a.solicitante_profissional_id, a.medico_profissional_id, a.numero_carteira, pl.descricao AS plano,
                COALESCE(itf.codigo, ps.codigo_sigtap) AS procedimento
           FROM agendamento_internacao a
           LEFT JOIN item_faturavel itf ON itf.id = a.item_faturavel_id
           LEFT JOIN procedimento_sigtap ps ON ps.id = a.procedimento_sigtap_id
           JOIN carater_admissao ca ON ca.id = a.carater_admissao_id
           LEFT JOIN plano_fonte_pagadora pl ON pl.id = a.plano_fonte_pagadora_id
           LEFT JOIN clinica_assistencial cl ON cl.id = a.clinica_assistencial_id
          WHERE a.estabelecimento_id = ? AND a.paciente_id = ? AND a.excluido_em IS NULL
            AND a.situacao IN ('solicitado','aguardando_autorizacao','autorizado','confirmado','em_espera')
          ORDER BY a.id DESC LIMIT 1`,
        [est, paciente],
      );
      if (!r) return null;
      return {
        dataPrevista:
          r['situacao'] === 'em_espera' || r['previsto_para'] === null
            ? null
            : civil(r['previsto_para'] as Date, fuso).data,
        convenio: n(r['fonte_pagadora_id']),
        especialidade: n(r['especialidade_medica_id']),
        clinica: CLINICA_DA_NATUREZA[texto(r['natureza'])] ?? null,
        carater: verdadeiro(r['urgencia']) ? 'urgencia' : 'eletivo',
        procedimento: r['procedimento'] === null ? null : Number(texto(r['procedimento'])) || null,
        vinculoSolicitante: n(r['solicitante_profissional_id']),
        vinculoAssistente: n(r['medico_profissional_id']),
        matricula: texto(r['numero_carteira']),
        plano: texto(r['plano']),
      };
    });
  }

  leiturasPainel(c: ContextoAdt): Promise<LeiturasPainel> {
    return this.painel.leiturasPainel({
      rede: c.rede,
      hospital: c.hospital,
      traceId: c.correlacao,
      porta: this.contexto(c),
    });
  }

  estadosDoMapa(c: ContextoAdt): Promise<EstadosDoMapa> {
    return this.ler(c, async (l, est) => {
      const posicao = `COALESCE(b.codigo, '') AS bloco, ac.codigo AS acomodacao, lh.codigo AS leito`;
      const juntar = `JOIN acomodacao ac ON ac.id = lh.acomodacao_id
           LEFT JOIN bloco_internacao b ON b.id = COALESCE(lh.bloco_internacao_id, ac.bloco_internacao_id)`;
      const chave = (r: Linha) =>
        chaveTextoLeito({
          bloco: texto(r['bloco']),
          acomodacao: texto(r['acomodacao']),
          leito: texto(r['leito']),
        });
      const periodos = await l.consultar(
        `SELECT p.id, p.data_hora_inicio, p.data_hora_prevista_fim, p.solicitacao_limpeza_id, p.observacao, p.dados,
                s.situacao_base, mb.descricao AS motivo, ${posicao}
           FROM periodo_situacao_leito p
           JOIN situacao_leito s ON s.id = p.situacao_leito_id
           LEFT JOIN motivo_bloqueio_leito mb ON mb.id = p.motivo_bloqueio_leito_id
           JOIN leito_hospitalar lh ON lh.id = p.leito_hospitalar_id ${juntar}
          WHERE lh.estabelecimento_id = ? AND lh.excluido_em IS NULL AND p.data_hora_fim IS NULL`,
        [est],
      );
      const limpezas = await l.consultar(
        `SELECT s.id, sl.etapa, ${posicao}, m.tempo_previsto_minutos, s.solicitada_em
           FROM solicitacao_limpeza s
           JOIN situacao_limpeza sl ON sl.id = s.situacao_limpeza_id
           JOIN modalidade_limpeza m ON m.id = s.modalidade_limpeza_id
           JOIN solicitacao_limpeza_local x ON x.solicitacao_limpeza_id = s.id AND x.excluido_em IS NULL
           JOIN leito_hospitalar lh ON lh.id = x.leito_hospitalar_id ${juntar}
          WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL AND s.concluida_em IS NULL AND s.cancelada_em IS NULL`,
        [est],
      );
      const atributos = await l.consultar(
        `SELECT ${posicao}, lh.sexo_permitido, lh.criticidade FROM leito_hospitalar lh ${juntar}
          WHERE lh.estabelecimento_id = ? AND lh.excluido_em IS NULL AND (lh.sexo_permitido <> 'qualquer' OR lh.criticidade <> 'baixa')`,
        [est],
      );
      const reservas = await l.consultar(
        `SELECT r.id, r.pedido_leito_id, r.valida_ate, r.situacao, r.conflito_em, ${posicao}
           FROM reserva_leito r JOIN leito_hospitalar lh ON lh.id = r.leito_hospitalar_id ${juntar}
          WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND r.situacao IN ('ativa','confirmada')`,
        [est],
      );
      const dados = (v: unknown): Record<string, unknown> => {
        if (!v) return {};
        try {
          return typeof v === 'string'
            ? (JSON.parse(v) as Record<string, unknown>)
            : (v as Record<string, unknown>);
        } catch {
          return {};
        }
      };
      const iso = (v: unknown) => (v ? (v as Date).toISOString() : null);
      return {
        estados: periodos.flatMap((p) => {
          const d = dados(p['dados']);
          const estado =
            (d['estado'] as EstadoLeitoNovo | undefined) ?? ESTADO_DA_BASE[texto(p['situacao_base'])];
          if (!estado) return [];
          return [
            {
              chave: chave(p),
              estado,
              motivo:
                (d['motivo'] as string | undefined) ?? (p['motivo'] === null ? null : texto(p['motivo'])),
              precaucao: (d['precaucao'] as string | undefined) ?? null,
              previsaoFim: iso(p['data_hora_prevista_fim']),
              desde: iso(p['data_hora_inicio']) ?? '',
              solicitacao: nn(p['solicitacao_limpeza_id']),
              conflitoReg: nn(d['conflitoReg']),
              conflitoEm: (d['conflitoEm'] as string | undefined) ?? null,
              observacao: p['observacao'] === null ? null : texto(p['observacao']),
            },
          ];
        }),
        limpezas: limpezas.map((x) => ({
          chave: chave(x),
          solicitacao: n(x['id']),
          etapa: texto(x['etapa']),
          prazo: new Date(
            (x['solicitada_em'] as Date).getTime() + n(x['tempo_previsto_minutos']) * 60_000,
          ).toISOString(),
        })),
        atributos: atributos.map((a) => ({
          chave: chave(a),
          sexo: a['sexo_permitido'] === 'masculino' ? 'M' : a['sexo_permitido'] === 'feminino' ? 'F' : null,
          idadeMinima: null,
          idadeMaxima: null,
          criticidade:
            CRITICIDADES.indexOf(texto(a['criticidade']) as (typeof CRITICIDADES)[number]) + 1 || null,
        })),
        reservas: reservas.map((r) => ({
          chave: chave(r),
          id: n(r['id']),
          solicitacao: n(r['pedido_leito_id']),
          validaAte: iso(r['valida_ate']) ?? '',
          confirmada: r['situacao'] === 'confirmada',
          conflitoEm: iso(r['conflito_em']),
        })),
      };
    });
  }

  historico(
    c: ContextoAdt,
    o: { inicio: string; fim: string; bloco?: string; pagina: number; porPagina: number },
  ): Promise<HistoricoOcupacao> {
    return this.ler(c, async (l, est, fuso) => {
      const filtro = `FROM ocupacao_leito o
           JOIN leito_hospitalar lh ON lh.id = o.leito_hospitalar_id
           JOIN acomodacao ac ON ac.id = o.acomodacao_id
           LEFT JOIN bloco_internacao b ON b.id = COALESCE(lh.bloco_internacao_id, ac.bloco_internacao_id)
           JOIN categoria_acomodacao ca ON ca.id = ac.categoria_acomodacao_id
          WHERE o.estabelecimento_id = ? AND o.excluido_em IS NULL AND o.situacao <> 'cancelada'
            AND o.data_hora_inicio <= ? AND (o.data_hora_fim IS NULL OR o.data_hora_fim >= ?)
            ${o.bloco ? "AND COALESCE(b.codigo, '') = ?" : ''}`;
      const p: unknown[] = [
        est,
        `${o.fim} 23:59:59.999`,
        `${o.inicio} 00:00:00`,
        ...(o.bloco ? [o.bloco] : []),
      ];
      const total = n((await l.uma(`SELECT COUNT(*) AS q ${filtro}`, p))?.['q']);
      const linhas = await l.consultar(
        `SELECT o.internacao_id, o.data_hora_inicio, o.data_hora_fim, COALESCE(b.codigo, '') AS bloco, ac.codigo AS acomodacao,
                lh.codigo AS leito, ca.id AS tipo, ca.descricao AS tipo_nome ${filtro}
          ORDER BY o.data_hora_inicio DESC, o.id DESC LIMIT ? OFFSET ?`,
        [...p, o.porPagina, Math.max(0, (o.pagina - 1) * o.porPagina)],
      );
      const agora = Date.now();
      return {
        itens: linhas.map((r) => {
          const a = civil(r['data_hora_inicio'] as Date, fuso);
          const b = r['data_hora_fim'] ? civil(r['data_hora_fim'] as Date, fuso) : null;
          const fim = r['data_hora_fim'] ? (r['data_hora_fim'] as Date).getTime() : agora;
          return {
            internacao: n(r['internacao_id']),
            leito: { bloco: texto(r['bloco']), acomodacao: texto(r['acomodacao']), leito: texto(r['leito']) },
            tipo: { codigo: n(r['tipo']), nome: texto(r['tipo_nome']) },
            entrada: a.data,
            horaEntrada: a.hora,
            saida: b?.data ?? null,
            horaSaida: b?.hora ?? null,
            horas: Math.round(((fim - (r['data_hora_inicio'] as Date).getTime()) / 3_600_000) * 10) / 10,
          };
        }),
        total,
        pagina: o.pagina,
        porPagina: o.porPagina,
      };
    });
  }

  solicitacoes(
    c: ContextoAdt,
  ): Promise<{ itens: SolicitacaoLimpezaFila[]; paradasAntigas: number; cortada: boolean }> {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT s.id, s.solicitada_em, s.motivo_geracao, sl.etapa, COALESCE(b.codigo, '') AS bloco, ac.codigo AS acomodacao,
                lh.codigo AS leito, a.numero AS atendimento
           FROM solicitacao_limpeza s
           JOIN situacao_limpeza sl ON sl.id = s.situacao_limpeza_id
           JOIN solicitacao_limpeza_local x ON x.solicitacao_limpeza_id = s.id AND x.excluido_em IS NULL
           JOIN leito_hospitalar lh ON lh.id = x.leito_hospitalar_id
           JOIN acomodacao ac ON ac.id = lh.acomodacao_id
           LEFT JOIN bloco_internacao b ON b.id = COALESCE(lh.bloco_internacao_id, ac.bloco_internacao_id)
           LEFT JOIN atendimento a ON a.id = s.atendimento_id
          WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL AND s.concluida_em IS NULL AND s.cancelada_em IS NULL
          ORDER BY s.solicitada_em LIMIT ${TETO_LISTA + 1}`,
        [est],
      );
      return {
        itens: linhas.slice(0, TETO_LISTA).map((r) => ({
          solicitacao: n(r['id']),
          leito: { bloco: texto(r['bloco']), acomodacao: texto(r['acomodacao']), leito: texto(r['leito']) },
          situacaoCodigo: r['etapa'] === 'em_higienizacao' ? 3 : r['motivo_geracao'] === 'alta' ? 1 : 2,
          solicitadaEm: (r['solicitada_em'] as Date).toISOString(),
          atendimento: r['atendimento'] === null ? null : texto(r['atendimento']),
        })),
        // No banco único toda solicitação aberta está na fila: não há pedido antigo parado fora dela.
        paradasAntigas: 0,
        cortada: linhas.length > TETO_LISTA,
      };
    });
  }

  /** As etapas da limpeza pelos instantes da solicitação, da execução e da inspeção. */
  private async etapasDe(l: Leitor, ids: readonly number[]): Promise<Map<number, EtapaDaLimpeza[]>> {
    const m = new Map<number, EtapaDaLimpeza[]>();
    if (ids.length === 0) return m;
    const linhas = await l.consultar(
      `SELECT s.id, s.solicitada_em, s.fim_aguardando_em, s.inicio_higienizacao_em, s.fim_higienizacao_em, s.concluida_em,
              s.cancelada_em, s.modalidade_limpeza_id, s.profissional_higienizacao_id, s.motivo_geracao, m.tempo_previsto_minutos,
              u.login, i.inspecionado_em, i.resultado, i.checklist
         FROM solicitacao_limpeza s
         JOIN modalidade_limpeza m ON m.id = s.modalidade_limpeza_id
         LEFT JOIN usuario u ON u.id = s.solicitante_usuario_id
         LEFT JOIN inspecao_limpeza i ON i.id = (SELECT MAX(i2.id) FROM inspecao_limpeza i2 WHERE i2.solicitacao_limpeza_id = s.id AND i2.excluido_em IS NULL)
        WHERE s.id IN (${lista(ids.length)})`,
      [...ids],
    );
    for (const r of linhas) {
      const base = {
        tipoLimpeza: nn(r['modalidade_limpeza_id']),
        profissional: nn(r['profissional_higienizacao_id']),
        precaucao: null,
        checklist: [] as string[],
        foto: null,
        registradoPor: texto(r['login']),
        aparelho: null,
        origem: r['motivo_geracao'] === 'alta' ? ('alta' as const) : ('manual' as const),
      };
      const solicitada = r['solicitada_em'] as Date;
      const prazo = new Date(solicitada.getTime() + n(r['tempo_previsto_minutos']) * 60_000).toISOString();
      const marcos: [EtapaLimpeza, unknown][] = [
        ['solicitado', solicitada],
        ['atribuido', r['fim_aguardando_em']],
        ['emExecucao', r['inicio_higienizacao_em']],
        ['concluido', r['fim_higienizacao_em']],
        [r['resultado'] === 'reprovada' ? 'reprovado' : 'inspecionado', r['inspecionado_em']],
        ['liberado', r['concluida_em']],
        ['cancelado', r['cancelada_em']],
      ];
      let checklist: string[] = [];
      try {
        const c = typeof r['checklist'] === 'string' ? JSON.parse(r['checklist']) : r['checklist'];
        if (Array.isArray(c)) checklist = c.map(String);
      } catch {
        checklist = [];
      }
      m.set(
        n(r['id']),
        marcos
          .filter(([, em]) => em instanceof Date)
          .map(([etapa, em], k) => ({
            ...base,
            id: n(r['id']) * 10 + k,
            etapa,
            prazo: etapa === 'solicitado' ? prazo : null,
            checklist: etapa === 'inspecionado' || etapa === 'reprovado' ? checklist : [],
            registradoEm: (em as Date).toISOString(),
          })),
      );
    }
    return m;
  }

  etapas(c: ContextoAdt, solicitacao: number) {
    return this.ler(c, async (l, est) => {
      if (
        !(await l.uma('SELECT id FROM solicitacao_limpeza WHERE id = ? AND estabelecimento_id = ?', [
          solicitacao,
          est,
        ]))
      )
        return [];
      return (await this.etapasDe(l, [solicitacao])).get(solicitacao) ?? [];
    });
  }

  limpezasLiberadas(
    c: ContextoAdt,
    de: string,
    ate: string,
  ): Promise<{ itens: LimpezaGiro[]; areas: Record<string, string> }> {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT s.id, s.solicitada_em, COALESCE(b.codigo, '') AS bloco, b.nome AS bloco_nome
           FROM solicitacao_limpeza s
           JOIN solicitacao_limpeza_local x ON x.solicitacao_limpeza_id = s.id AND x.excluido_em IS NULL
           JOIN leito_hospitalar lh ON lh.id = x.leito_hospitalar_id
           JOIN acomodacao ac ON ac.id = lh.acomodacao_id
           LEFT JOIN bloco_internacao b ON b.id = COALESCE(lh.bloco_internacao_id, ac.bloco_internacao_id)
          WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL AND s.concluida_em BETWEEN ? AND ?
          LIMIT 20000`,
        [est, `${de} 00:00:00`, `${ate} 23:59:59.999`],
      );
      const etapas = await this.etapasDe(
        l,
        linhas.map((r) => n(r['id'])),
      );
      const areas: Record<string, string> = {};
      for (const r of linhas) areas[texto(r['bloco'])] = texto(r['bloco_nome']);
      return {
        itens: linhas.map((r) => ({
          solicitacao: n(r['id']),
          solicitadaEm: (r['solicitada_em'] as Date).toISOString(),
          area: texto(r['bloco']),
          etapas: (etapas.get(n(r['id'])) ?? []).map((e) => ({
            etapa: e.etapa,
            em: e.registradoEm,
            prazo: e.prazo,
            tipoLimpeza: e.tipoLimpeza,
            profissional: e.profissional,
          })),
        })),
        areas,
      };
    });
  }

  leitoDaSolicitacao(c: ContextoAdt, solicitacao: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT lh.id, COALESCE(b.codigo, '') AS bloco, ac.codigo AS acomodacao, lh.codigo AS leito, lh.criticidade,
                sl.etapa, s.motivo_geracao
           FROM solicitacao_limpeza s
           JOIN situacao_limpeza sl ON sl.id = s.situacao_limpeza_id
           JOIN solicitacao_limpeza_local x ON x.solicitacao_limpeza_id = s.id AND x.excluido_em IS NULL
           JOIN leito_hospitalar lh ON lh.id = x.leito_hospitalar_id
           JOIN acomodacao ac ON ac.id = lh.acomodacao_id
           LEFT JOIN bloco_internacao b ON b.id = COALESCE(lh.bloco_internacao_id, ac.bloco_internacao_id)
          WHERE s.id = ? AND s.estabelecimento_id = ? AND s.excluido_em IS NULL LIMIT 1`,
        [solicitacao, est],
      );
      if (!r) return null;
      return {
        leito: { bloco: texto(r['bloco']), acomodacao: texto(r['acomodacao']), leito: texto(r['leito']) },
        espelho: n(r['id']),
        criticidade:
          CRITICIDADES.indexOf(texto(r['criticidade']) as (typeof CRITICIDADES)[number]) + 1 || null,
        situacaoCodigo:
          r['etapa'] === 'liberada'
            ? 4
            : r['etapa'] === 'em_higienizacao'
              ? 3
              : r['motivo_geracao'] === 'alta'
                ? 1
                : 2,
      };
    });
  }

  contaDoCodigo(c: ContextoAdt, codigo: number) {
    return this.ler(c, async (l, est) => {
      // O código lido é o número do atendimento; o id só vale quando não há número igual. Número repetido é recusa.
      const porNumero = await l.consultar(
        'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ? AND excluido_em IS NULL ORDER BY id LIMIT 2',
        [est, String(codigo)],
      );
      if (porNumero.length > 1)
        throw recusa(
          'codigo-ambiguo',
          'Mais de um atendimento com esse número: informe o atendimento pela lista.',
        );
      if (porNumero.length === 1) return n(porNumero[0]?.['id']);
      const porId = await l.uma(
        'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND id = ? AND excluido_em IS NULL',
        [est, codigo],
      );
      return porId ? n(porId['id']) : null;
    });
  }

  localizacao(
    c: ContextoAdt,
    conta: number,
    o: { setorSame: number; prazoDias: number },
  ): Promise<LocalizacaoConta | null> {
    return this.ler(c, async (l, est, fuso) => {
      const a = await l.uma(
        `SELECT a.id, a.numero, a.paciente_id, p.numero_prontuario, COALESCE(p.nome_social, pf.nome) AS nome,
                EXISTS (SELECT 1 FROM internacao i WHERE i.atendimento_id = a.id) AS internacao
           FROM atendimento a JOIN paciente p ON p.id = a.paciente_id JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
        [conta, est],
      );
      if (!a) return null;
      // Os movimentos da conta (os do atendimento e os do volume sem atendimento), com os registros do arquivo
      // ligados a cada um: exclusão, remessa (protocolo e prazo), aceite e cobrança.
      const oc = (tipo: string, col: string) =>
        `(SELECT o.${col} FROM ocorrencia_arquivo_prontuario o WHERE o.movimento_prontuario_id = m.id AND o.tipo = '${tipo}' AND o.excluido_em IS NULL ORDER BY o.id DESC LIMIT 1)`;
      const movs = await l.consultar(
        `SELECT m.id, m.movimentado_em, m.saida_setor_funcional_id, so.nome AS so_nome, m.destino_setor_funcional_id,
                sd.nome AS sd_nome, op.codigo AS operacao, op.descricao AS operacao_nome, m.responsavel_nome,
                m.previsao_retorno, m.excluido_em, u.login,
                ${oc('exclusao', 'id')} AS exclusao_id, ${oc('exclusao', 'motivo')} AS motivo_exclusao,
                ${oc('remessa', 'protocolo')} AS protocolo, ${oc('remessa', 'prazo_devolucao')} AS prazo_devolucao,
                ${oc('aceite', 'id')} AS aceite_id, ${oc('cobranca', 'id')} AS cobranca_id
           FROM movimento_prontuario m
           JOIN operacao_movimento_prontuario op ON op.id = m.operacao_movimento_prontuario_id
           LEFT JOIN setor_funcional so ON so.id = m.saida_setor_funcional_id
           LEFT JOIN setor_funcional sd ON sd.id = m.destino_setor_funcional_id
           LEFT JOIN usuario u ON u.id = m.movimentado_por_usuario_id
          WHERE m.estabelecimento_id = ? AND m.paciente_id = ? AND (m.atendimento_id = ? OR m.atendimento_id IS NULL)
          ORDER BY m.movimentado_em DESC, m.id DESC LIMIT 201`,
        [est, n(a['paciente_id']), n(a['id'])],
      );
      const ocorrencias = await l.consultar(
        `SELECT o.motivo, o.registrado_em, u.login
           FROM ocorrencia_arquivo_prontuario o LEFT JOIN usuario u ON u.id = o.usuario_id
          WHERE o.estabelecimento_id = ? AND o.atendimento_id = ? AND o.tipo = 'ocorrencia' AND o.excluido_em IS NULL
          ORDER BY o.registrado_em DESC, o.id DESC LIMIT 200`,
        [est, n(a['id'])],
      );
      const instante = (d: Date) => {
        const x = civil(d, fuso);
        return `${x.data}T${x.hora}:00`;
      };
      const dataCivil = (v: unknown) =>
        v === null || v === undefined
          ? null
          : v instanceof Date
            ? v.toISOString().slice(0, 10)
            : texto(v).slice(0, 10);
      const excluido = (m: Linha) => m['excluido_em'] !== null || m['exclusao_id'] !== null;
      const ultimo = movs.find((m) => !excluido(m));
      const ondeEsta = ultimo
        ? {
            setor: {
              codigo: n(ultimo['destino_setor_funcional_id'] ?? ultimo['saida_setor_funcional_id']),
              nome: texto(ultimo['sd_nome'] ?? ultimo['so_nome']),
            },
            desde: instante(ultimo['movimentado_em'] as Date),
            operacao: texto(ultimo['operacao_nome']),
          }
        : null;
      // O prazo é o da remessa (até o fim do dia), senão a previsão de retorno, senão o prazo padrão do arquivo.
      const prazoDe = (m: Linha) => {
        const rem = dataCivil(m['prazo_devolucao']);
        if (rem) return instanteCivil(rem, '23:59', fuso).getTime();
        const prev = m['previsao_retorno'] as Date | null;
        return prev ? prev.getTime() : (m['movimentado_em'] as Date).getTime() + o.prazoDias * 86_400_000;
      };
      const atrasada =
        !!ultimo &&
        n(ultimo['destino_setor_funcional_id'] ?? o.setorSame) !== o.setorSame &&
        Date.now() > prazoDe(ultimo);
      return {
        conta: n(a['id']),
        numero: Number(texto(a['numero']).replace(/\D/g, '')) || n(a['id']),
        atendimento: n(a['id']),
        tipo: verdadeiro(a['internacao']) ? 'internacao' : 'externo',
        paciente: texto(a['nome']),
        prontuario: n(a['numero_prontuario']),
        local: ondeEsta,
        devolucaoAtrasada: atrasada,
        linhaDoTempo: movs.slice(0, 200).map((m) => ({
          id: n(m['id']),
          operacao: { codigo: Number(texto(m['operacao'])) || 0, nome: texto(m['operacao_nome']) },
          origem: { codigo: n(m['saida_setor_funcional_id']), nome: texto(m['so_nome']) },
          destino: { codigo: n(m['destino_setor_funcional_id']), nome: texto(m['sd_nome']) },
          em: instante(m['movimentado_em'] as Date),
          usuario: texto(m['login']),
          responsavel: texto(m['responsavel_nome']),
          excluido: excluido(m),
          motivoExclusao: m['motivo_exclusao'] === null ? null : texto(m['motivo_exclusao']),
          protocolo: m['protocolo'] === null ? null : texto(m['protocolo']),
          prazoDevolucao: dataCivil(m['prazo_devolucao']),
          aceito: m['aceite_id'] !== null,
          cobrada: m['cobranca_id'] !== null,
        })),
        ocorrencias: ocorrencias.map((r) => ({
          motivo: texto(r['motivo']),
          em: instante(r['registrado_em'] as Date),
          por: texto(r['login']),
        })),
        cortada: movs.length > 200,
      };
    });
  }

  devolucoesAtrasadas(c: ContextoAdt, o: { setorSame: number; prazoDias: number }) {
    return this.ler(c, async (l, est, fuso) => {
      const linhas = await l.consultar(
        `SELECT m.id, m.atendimento_id, m.destino_setor_funcional_id, s.nome, m.movimentado_em, m.previsao_retorno,
                (SELECT o.prazo_devolucao FROM ocorrencia_arquivo_prontuario o
                  WHERE o.movimento_prontuario_id = m.id AND o.tipo = 'remessa' AND o.excluido_em IS NULL ORDER BY o.id DESC LIMIT 1) AS prazo_devolucao,
                EXISTS (SELECT 1 FROM ocorrencia_arquivo_prontuario o
                  WHERE o.movimento_prontuario_id = m.id AND o.tipo = 'cobranca' AND o.excluido_em IS NULL) AS cobrada
           FROM movimento_prontuario m
           JOIN setor_funcional s ON s.id = m.destino_setor_funcional_id
          WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL AND m.devolvido_em IS NULL
            AND m.destino_setor_funcional_id <> ?
            AND m.id = (SELECT MAX(m2.id) FROM movimento_prontuario m2
                         WHERE m2.volume_prontuario_id = m.volume_prontuario_id AND m2.excluido_em IS NULL
                           AND NOT EXISTS (SELECT 1 FROM ocorrencia_arquivo_prontuario x
                                            WHERE x.movimento_prontuario_id = m2.id AND x.tipo = 'exclusao' AND x.excluido_em IS NULL))
          HAVING COALESCE(DATE_ADD(prazo_devolucao, INTERVAL 10 HOUR), m.previsao_retorno, DATE_ADD(m.movimentado_em, INTERVAL ? DAY)) < NOW(3)
          ORDER BY m.movimentado_em LIMIT ${TETO_LISTA + 1}`,
        [est, o.setorSame, o.prazoDias],
      );
      const hoje = Date.now();
      // O banco filtra com folga de fuso (o fim do dia do prazo da remessa cai entre 10h do dia e 14h do dia seguinte
      // em UTC); o corte exato é aqui, no fuso do estabelecimento. O prazo é o da remessa (até o fim do dia), senão a
      // previsão de retorno, senão o prazo padrão do arquivo.
      const prazoDe = (r: Linha) => {
        const v = r['prazo_devolucao'];
        const rem =
          v === null || v === undefined
            ? null
            : v instanceof Date
              ? v.toISOString().slice(0, 10)
              : texto(v).slice(0, 10);
        if (rem) return instanteCivil(rem, '23:59', fuso);
        return (
          (r['previsao_retorno'] as Date | null) ??
          new Date((r['movimentado_em'] as Date).getTime() + o.prazoDias * 86_400_000)
        );
      };
      const atrasadas = linhas.filter((r) => prazoDe(r).getTime() < hoje);
      return {
        itens: atrasadas.slice(0, TETO_LISTA).map((r) => {
          const prazo = prazoDe(r);
          return {
            conta: n(r['atendimento_id']),
            movimento: n(r['id']),
            setor: { codigo: n(r['destino_setor_funcional_id']), nome: texto(r['nome']) },
            desde: civil(r['movimentado_em'] as Date, fuso).data,
            prazo: civil(prazo, fuso).data,
            diasAtraso: Math.max(0, Math.floor((hoje - prazo.getTime()) / 86_400_000)),
            cobrada: verdadeiro(r['cobrada']),
          };
        }),
        cortada: atrasadas.length > TETO_LISTA || linhas.length > TETO_LISTA,
      };
    });
  }

  apoio(c: ContextoAdt): Promise<ApoioInternacaoTela> {
    return this.ler(c, async (l, est) => {
      const cn = (rs: Linha[]) => rs.map((r) => ({ codigo: n(r['id']), nome: texto(r['nome']) }));
      const clinicas = await l.consultar(
        'SELECT id, descricao AS nome FROM clinica_assistencial WHERE ativo = TRUE ORDER BY descricao',
      );
      const [conv, esp, mot, acom, tipos, prof, set, ops, exc, uni, cc] = await Promise.all([
        l.consultar(
          "SELECT id, nome FROM fonte_pagadora WHERE situacao = 'ativa' AND excluido_em IS NULL ORDER BY nome",
        ),
        l.consultar(
          'SELECT id, descricao AS nome FROM especialidade_medica WHERE ativo = TRUE ORDER BY descricao',
        ),
        l.consultar(
          'SELECT id, descricao AS nome, tipo_saida FROM motivo_saida_hospitalar WHERE ativo = TRUE ORDER BY descricao',
        ),
        l.consultar(
          `SELECT COALESCE(b.codigo, '') AS bloco, ac.codigo, ac.nome, ac.categoria_acomodacao_id FROM acomodacao ac
             LEFT JOIN bloco_internacao b ON b.id = ac.bloco_internacao_id
            WHERE ac.estabelecimento_id = ? AND ac.excluido_em IS NULL AND ac.ativo = TRUE ORDER BY bloco, ac.codigo`,
          [est],
        ),
        l.consultar(
          'SELECT id, descricao AS nome FROM modalidade_limpeza WHERE ativo = TRUE ORDER BY descricao',
        ),
        l.consultar(
          'SELECT id, nome FROM profissional_higienizacao WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY nome',
          [est],
        ),
        l.consultar(
          'SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY nome',
          [est],
        ),
        l.consultar(
          'SELECT codigo, descricao AS nome FROM operacao_movimento_prontuario WHERE ativo = TRUE ORDER BY codigo',
        ),
        l.consultar(
          'SELECT id, descricao AS nome FROM motivo_cancelamento_internacao WHERE ativo = TRUE ORDER BY descricao',
        ),
        l.consultar(
          'SELECT id, descricao AS nome FROM unidade_internacao WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY descricao',
          [est],
        ),
        l.consultar(
          'SELECT id, nome FROM centro_custo WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY nome',
          [est],
        ),
      ]);
      return {
        convenios: cn(conv),
        especialidades: cn(esp),
        clinicas: cn(clinicas),
        motivosAlta: mot.map((r) => ({
          codigo: n(r['id']),
          nome: texto(r['nome']),
          grupo: texto(r['tipo_saida']),
        })),
        acomodacoes: acom.map((r) => ({
          bloco: texto(r['bloco']),
          acomodacao: texto(r['codigo']),
          nome: texto(r['nome']),
          tipo: n(r['categoria_acomodacao_id']),
        })),
        tiposLimpeza: cn(tipos),
        profissionaisLimpeza: cn(prof),
        setores: cn(set),
        operacoesSame: ops.map((r) => ({ codigo: Number(texto(r['codigo'])) || 0, nome: texto(r['nome']) })),
        motivosSame: [],
        motivosExclusao: cn(exc),
        unidades: cn(uni),
        centrosCusto: cn(cc),
      };
    });
  }

  medicos(c: ContextoAdt, termo: string) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT pr.id, COALESCE(pr.nome_exibicao, pf.nome) AS nome, ic.numero_inscricao, em.descricao AS especialidade
             FROM profissional pr
             JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
             JOIN usuario_vinculo_profissional v ON v.profissional_id = pr.id AND v.estabelecimento_id = ? AND v.excluido_em IS NULL
             LEFT JOIN inscricao_conselho ic ON ic.id = (SELECT i2.id FROM inscricao_conselho i2 WHERE i2.profissional_id = pr.id AND i2.excluido_em IS NULL ORDER BY i2.principal DESC, i2.sequencia LIMIT 1)
             LEFT JOIN especialidade_medica em ON em.id = (SELECT pe.especialidade_medica_id FROM profissional_especialidade pe WHERE pe.profissional_id = pr.id AND pe.excluido_em IS NULL ORDER BY pe.id LIMIT 1)
            WHERE pr.situacao = 'ativo' AND pr.excluido_em IS NULL AND (UPPER(pf.nome) LIKE ? OR ic.numero_inscricao = ?)
            GROUP BY pr.id ORDER BY nome LIMIT 30`,
          [est, `%${termo.trim().toUpperCase()}%`, termo.trim()],
        )
      ).map((r) => ({
        vinculo: n(r['id']),
        nome: texto(r['nome']),
        conselho: texto(r['numero_inscricao']),
        especialidade: texto(r['especialidade']),
      })),
    );
  }

  cid(c: ContextoAdt, termo: string) {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT t.id, t.codigo_termo, t.descricao FROM termo_terminologia t JOIN terminologia tt ON tt.id = t.terminologia_id
            WHERE tt.codigo = 'cid10' AND t.ativo = TRUE AND (t.codigo_termo LIKE ? OR UPPER(t.descricao) LIKE ?)
            ORDER BY t.codigo_termo LIMIT 30`,
          [`${termo.trim().toUpperCase()}%`, `%${termo.trim().toUpperCase()}%`],
        )
      ).map((r) => ({ id: n(r['id']), codigo: texto(r['codigo_termo']), nome: texto(r['descricao']) })),
    );
  }

  /** Conferências de consistência do próprio banco (alta antes da entrada e internado sem ocupação aberta). */
  incoerencias(c: ContextoAdt) {
    return this.ler(c, async (l, est, fuso) => {
      const item = (r: Linha): ItemIncoerencia => {
        const e = civil(r['data_hora_entrada'] as Date, fuso);
        const s = r['data_hora_alta'] ? civil(r['data_hora_alta'] as Date, fuso) : null;
        return {
          reg: n(r['id']),
          prontuario: n(r['numero_prontuario']),
          entrada: e.data,
          horaEntrada: e.hora,
          alta: s?.data ?? null,
          horaSaida: s?.hora ?? null,
        };
      };
      const semTrecho = await l.consultar(
        `SELECT i.id, p.numero_prontuario, i.data_hora_entrada, i.data_hora_alta FROM internacao i JOIN paciente p ON p.id = i.paciente_id
          WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL AND i.situacao IN ('ativa','alta_medica')
            AND NOT EXISTS (SELECT 1 FROM ocupacao_leito o WHERE o.internacao_id = i.id AND o.situacao = 'ativa' AND o.data_hora_fim IS NULL AND o.excluido_em IS NULL)
          LIMIT 200`,
        [est],
      );
      const altaAntes = await l.consultar(
        `SELECT i.id, p.numero_prontuario, i.data_hora_entrada, i.data_hora_alta FROM internacao i JOIN paciente p ON p.id = i.paciente_id
          WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL AND i.data_hora_alta IS NOT NULL AND i.data_hora_alta < i.data_hora_entrada
          LIMIT 200`,
        [est],
      );
      const leitos = n(
        (
          await l.uma(
            'SELECT COUNT(*) AS q FROM leito_hospitalar WHERE estabelecimento_id = ? AND excluido_em IS NULL',
            [est],
          )
        )?.['q'],
      );
      return {
        altaAntesDaEntrada: altaAntes.map((r) => n(r['id'])),
        listaAltaAntes: altaAntes.map(item),
        leitosCadastro: leitos,
        // Não há registro de conferência à parte: o cadastro é a única fonte (pedido: tirar o campo do contrato).
        leitosEspelho: leitos,
        internadosSemTrechoAberto: semTrecho.length,
        listaSemTrecho: semTrecho.map(item),
      };
    });
  }

  impresso(c: ContextoAdt, reg: number): Promise<DadosImpressoInternacao | null> {
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.uma(
        `SELECT i.id, i.paciente_id, p.numero_prontuario, pf.nome, p.nome_social, pf.data_nascimento, fp.nome AS convenio,
                i.data_hora_entrada, COALESCE(b.codigo, '') AS bloco, ac.codigo AS acomodacao, lh.codigo AS leito,
                COALESCE(pm.nome_exibicao, pfm.nome) AS medico,
                EXISTS (SELECT 1 FROM alergia_paciente ap WHERE ap.paciente_id = i.paciente_id AND ap.ativa = TRUE AND ap.tipo_registro IN ('alergia','intolerancia') AND ap.excluido_em IS NULL) AS alergia
           FROM internacao i
           JOIN paciente p ON p.id = i.paciente_id JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           JOIN fonte_pagadora fp ON fp.id = i.fonte_pagadora_id
           JOIN profissional pm ON pm.id = i.medico_assistente_profissional_id JOIN pessoa_fisica pfm ON pfm.id = pm.pessoa_fisica_id
           LEFT JOIN leito_hospitalar lh ON lh.id = i.leito_hospitalar_id
           LEFT JOIN acomodacao ac ON ac.id = COALESCE(lh.acomodacao_id, i.acomodacao_id)
           LEFT JOIN bloco_internacao b ON b.id = COALESCE(lh.bloco_internacao_id, ac.bloco_internacao_id)
          WHERE i.id = ? AND i.estabelecimento_id = ? AND i.excluido_em IS NULL`,
        [reg, est],
      );
      if (!r) return null;
      const e = civil(r['data_hora_entrada'] as Date, fuso);
      return {
        reg: n(r['id']),
        idPaciente: n(r['paciente_id']),
        prontuario: n(r['numero_prontuario']),
        nome: texto(r['nome']),
        nomeSocial: r['nome_social'] === null ? null : texto(r['nome_social']),
        nascimento: r['data_nascimento'] ? (r['data_nascimento'] as Date).toISOString().slice(0, 10) : null,
        convenio: texto(r['convenio']),
        entrada: e.data,
        hora: e.hora,
        leito: chaveTextoLeito({
          bloco: texto(r['bloco']),
          acomodacao: texto(r['acomodacao']),
          leito: texto(r['leito']),
        }),
        medico: texto(r['medico']),
        alergia: verdadeiro(r['alergia']),
      };
    });
  }

  pacienteParaLeito(c: ContextoAdt, q: { paciente?: number; reg?: number }) {
    return this.ler(c, async (l, est) => {
      const r =
        q.paciente !== undefined
          ? await l.uma(
              `SELECT p.id, sx.sigla AS sexo, pf.data_nascimento FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
                 LEFT JOIN sexo sx ON sx.id = pf.sexo_id WHERE p.id = ? AND p.excluido_em IS NULL`,
              [q.paciente],
            )
          : q.reg !== undefined
            ? await l.uma(
                `SELECT p.id, sx.sigla AS sexo, pf.data_nascimento FROM internacao i JOIN paciente p ON p.id = i.paciente_id
                   JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id LEFT JOIN sexo sx ON sx.id = pf.sexo_id
                  WHERE i.id = ? AND i.estabelecimento_id = ?`,
                [q.reg, est],
              )
            : null;
      if (!r) return null;
      return {
        paciente: n(r['id']),
        sexo: r['sexo'] === null ? null : texto(r['sexo']),
        nascimento: r['data_nascimento'] ? (r['data_nascimento'] as Date).toISOString().slice(0, 10) : null,
      };
    });
  }

  /** Os documentos da internação pela regra de convênio, especialidade e modalidade (F3.4, 04-INT linha 69). */
  async fichas(
    c: ContextoAdt,
    reg: number,
  ): Promise<
    {
      modelo: number;
      grafica: boolean;
      nome: string;
      copias: number;
      texto?: string;
      obrigatorio?: boolean;
    }[]
  > {
    const docs = await new PortaDocumentosInternacao(this.nucleo, this.executor).documentos(
      c,
      reg,
      'admissao',
    );
    return (docs ?? []).map((d) => ({
      modelo: d.modelo,
      grafica: true,
      nome: d.titulo,
      copias: d.copias,
      texto: d.texto,
      obrigatorio: d.obrigatorio,
    }));
  }

  profissional(c: ContextoAdt, login: string): Promise<ProfissionalDaSessao | null> {
    return this.ler(c, async (l, est) => {
      const x = await l.uma(
        `SELECT pr.id, pf.nome, ic.numero_inscricao, ic.situacao AS situacao_inscricao, cbo.codigo_cbo
           FROM usuario u
           JOIN usuario_vinculo_profissional v ON v.usuario_id = u.id AND v.estabelecimento_id = ? AND v.excluido_em IS NULL
                AND v.vigencia_inicio <= CURRENT_DATE AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
           JOIN profissional pr ON pr.id = v.profissional_id AND pr.excluido_em IS NULL
           JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
           LEFT JOIN inscricao_conselho ic ON ic.id = (
             SELECT i2.id FROM inscricao_conselho i2 WHERE i2.profissional_id = pr.id AND i2.excluido_em IS NULL
              ORDER BY i2.principal DESC, i2.sequencia LIMIT 1)
           LEFT JOIN ocupacao_cbo cbo ON cbo.id = ic.ocupacao_cbo_id
          WHERE u.login = ? AND u.excluido_em IS NULL
          ORDER BY v.vigencia_inicio DESC LIMIT 1`,
        [est, login],
      );
      if (!x) return null;
      const num = texto(x['numero_inscricao']);
      return {
        vinculo: n(x['id']),
        crm: num && /^\d{1,9}$/.test(num) ? Number(num) : 0,
        nome: texto(x['nome']),
        codigoCbo: texto(x['codigo_cbo']),
        conselhoAtivo: ['ativa', 'provisoria'].includes(texto(x['situacao_inscricao'])),
      };
    });
  }

  profissionalLimpeza(c: ContextoAdt, login: string) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT ph.id FROM profissional_higienizacao ph JOIN usuario u ON u.id = ph.usuario_id
          WHERE ph.estabelecimento_id = ? AND u.login = ? AND ph.ativo = TRUE AND ph.excluido_em IS NULL LIMIT 1`,
        [est, login],
      );
      return r ? n(r['id']) : null;
    });
  }
}

// ── Gravações diretas (na transação da operação "internacao.gravacao-direta") ──────────────────────

/** Idade da tela (anos, 0 a 130) → dias do atributo do tipo de acomodação (o banco guarda a faixa etária em dias). */
const DIAS_POR_ANO = 365;
const anosParaDias = (anos: number | null | undefined): number | null =>
  anos === null || anos === undefined ? null : anos * DIAS_POR_ANO;

/** Tipo de acomodação (categoria) da chave do atributo por tipo: o id do cadastro, como a tela o recebe em `apoio`. */
async function categoriaDaChave(tx: TxOperacao, chave: string): Promise<number> {
  const id = Number(chave);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw recusa('tipo-acomodacao-inexistente', 'Informe o tipo de acomodação.', { campos: ['chave'] });
  const r = await tx.uma('SELECT id FROM categoria_acomodacao WHERE id = ?', [id]);
  if (!r)
    throw recusa('tipo-acomodacao-inexistente', 'O tipo de acomodação não existe.', { campos: ['chave'] });
  return id;
}

function gravador(tx: TxOperacao, est: number): GravadorSghAdt {
  const usuario = () => {
    if (tx.contexto.usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
    return tx.contexto.usuario;
  };
  const internacao = async (reg: number) => {
    const [i] = await tx.consultarParaAtualizar(
      'SELECT id, versao, situacao, atendimento_id, paciente_id, data_hora_entrada FROM internacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [reg, est],
    );
    if (!i)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Internação não encontrada',
        'A internação não existe neste estabelecimento.',
      );
    return i;
  };
  const periodoAberto = async (leito: number) => {
    const [p] = await tx.consultarParaAtualizar(
      `SELECT p.id, p.versao, p.dados, s.situacao_base FROM periodo_situacao_leito p JOIN situacao_leito s ON s.id = p.situacao_leito_id
        WHERE p.leito_hospitalar_id = ? AND p.data_hora_fim IS NULL`,
      [leito],
    );
    return p ?? null;
  };
  const conferirVersao = (vista: number | null | undefined, atual: unknown, oque: string) => {
    if (vista !== undefined && vista !== null && vista !== n(atual))
      throw new ErroOperacao(
        409,
        'conflito-versao',
        'Registro alterado',
        `${oque} mudou desde a leitura. Releia e confira antes de salvar.`,
        {
          colunas: ['versao'],
        },
      );
  };
  /** O motivo de bloqueio pelo código do cadastro (motivo_bloqueio_leito); código sem cadastro é configuração incompleta. */
  const motivoBloqueio = async (codigo: string | null | undefined) =>
    codigo
      ? apoio(
          tx,
          'SELECT id FROM motivo_bloqueio_leito WHERE codigo = ? AND ativo = TRUE',
          [codigo],
          `o motivo de bloqueio "${codigo}"`,
        )
      : null;
  /** O isolamento ativo no leito (a precaução do período aponta para ele). */
  const isolamentoNoLeito = async (leito: number) =>
    nn(
      (
        await tx.uma(
          "SELECT id FROM isolamento_paciente WHERE leito_hospitalar_id = ? AND situacao = 'ativo' AND excluido_em IS NULL ORDER BY data_hora_inicio DESC LIMIT 1",
          [leito],
        )
      )?.['id'],
    );
  const estadoDe = (p: Linha): string => {
    try {
      const d = typeof p['dados'] === 'string' ? JSON.parse(p['dados']) : p['dados'];
      if (d && typeof d === 'object' && 'estado' in d)
        return String((d as Record<string, unknown>)['estado']);
    } catch {
      /* dados sem o estado: vale a situação base */
    }
    return ESTADO_DA_BASE[texto(p['situacao_base'])] ?? '';
  };
  return {
    async registrarAltaMedica(r) {
      const i = await internacao(r.reg);
      if (i['situacao'] !== 'ativa')
        throw recusa('internacao-sem-alta-medica', 'A internação não está aberta para a alta médica.');
      if (!(await tx.uma('SELECT id FROM motivo_saida_hospitalar WHERE id = ? AND ativo = TRUE', [r.motivo])))
        throw recusa('motivo-inexistente', 'O motivo da alta não existe.', { campos: ['motivo'] });
      const agora = new Date();
      const id = await tx.incluir('alta_medica', {
        estabelecimento_id: est,
        atendimento_id: n(i['atendimento_id']),
        paciente_id: n(i['paciente_id']),
        internacao_id: r.reg,
        profissional_id: r.vinculo,
        situacao: 'programada',
        programada_em: agora,
        alta_medica_em: agora,
        lancada_em: agora,
        motivo_saida_hospitalar_id: r.motivo,
        destino: DESTINO_MEDICO[r.destino],
        obito: r.destino === 'obito',
        documento_prontuario_id: null,
        observacao: r.observacao,
      });
      await tx.alterar('internacao', r.reg, n(i['versao']), {
        situacao: 'alta_medica',
        data_hora_alta_medica: agora,
        alta_medica_profissional_id: r.vinculo,
      });
      return id;
    },
    async cancelarAltaMedica(r) {
      const i = await internacao(r.reg);
      const [a] = await tx.consultarParaAtualizar(
        "SELECT id, versao FROM alta_medica WHERE internacao_id = ? AND situacao IN ('prevista','programada') AND excluido_em IS NULL ORDER BY id DESC LIMIT 1",
        [r.reg],
      );
      if (!a) throw recusa('sem-alta-medica', 'A internação não tem alta médica a cancelar.');
      conferirVersao(r.versao, a['versao'], 'A alta médica');
      const motivo = await informadoOuUnico(
        tx,
        'SELECT id FROM motivo_cancelamento_alta WHERE ativo = TRUE',
        [],
        r.motivoCodigo,
        'motivoCancelamento',
        'o motivo de cancelamento de alta',
      );
      await tx.alterar('alta_medica', n(a['id']), n(a['versao']), {
        situacao: 'cancelada',
        cancelada_em: new Date(),
        cancelada_por_usuario_id: usuario(),
        motivo_cancelamento_alta_id: motivo,
        justificativa_cancelamento: r.motivo,
      });
      if (i['situacao'] === 'alta_medica')
        await tx.alterar('internacao', r.reg, n(i['versao']), {
          situacao: 'ativa',
          data_hora_alta_medica: null,
          alta_medica_profissional_id: null,
        });
      return n(a['id']);
    },
    async abrirEstadoLeito(r) {
      const leito = await leitoDaChave(tx, est, r.leito);
      if (await periodoAberto(n(leito['id'])))
        throw recusa(
          'leito-com-estado',
          'O leito já tem um estado aberto (bloqueio, precaução, extra ou higienização): encerre-o antes.',
        );
      const base = BASE_DO_ESTADO[r.estado];
      const situacao = await situacaoDoLeitoPorBase(tx, base);
      const agora = new Date();
      const id = await tx.incluir('periodo_situacao_leito', {
        leito_hospitalar_id: n(leito['id']),
        situacao_leito_id: situacao,
        motivo_bloqueio_leito_id: await motivoBloqueio(r.motivo),
        isolamento_paciente_id: r.estado === 'precaucao' ? await isolamentoNoLeito(n(leito['id'])) : null,
        data_hora_inicio: agora,
        data_hora_prevista_fim: r.previsaoFim ? new Date(r.previsaoFim) : null,
        solicitacao_limpeza_id: r.solicitacao ?? null,
        observacao: r.observacao ?? null,
        operacao: 'inclusao',
        dados: JSON.stringify({ estado: r.estado, motivo: r.motivo ?? null, precaucao: r.precaucao ?? null }),
        ocorrido_em: agora,
        usuario_id: usuario(),
      });
      await situarLeito(tx, n(leito['id']));
      return id;
    },
    async encerrarEstadoLeito(r) {
      const leito = await leitoDaChave(tx, est, r.leito);
      const p = await periodoAberto(n(leito['id']));
      if (!p || estadoDe(p) !== r.estado)
        throw recusa('estado-inexistente', 'O leito não tem esse estado aberto.');
      conferirVersao(r.versao, p['versao'], 'O estado do leito');
      const agora = new Date();
      await tx.alterar('periodo_situacao_leito', n(p['id']), n(p['versao']), {
        data_hora_fim: agora,
        operacao: 'alteracao',
        ocorrido_em: agora,
        usuario_id: usuario(),
      });
      await situarLeito(tx, n(leito['id']));
      return n(p['id']);
    },
    async alterarEstadoLeito(r) {
      const leito = await leitoDaChave(tx, est, r.leito);
      const p = await periodoAberto(n(leito['id']));
      if (!p || estadoDe(p) !== r.estado)
        throw recusa('estado-inexistente', 'O leito não tem esse estado aberto.');
      conferirVersao(r.versao, p['versao'], 'O estado do leito');
      const agora = new Date();
      await tx.alterar('periodo_situacao_leito', n(p['id']), n(p['versao']), {
        motivo_bloqueio_leito_id: await motivoBloqueio(r.motivo),
        data_hora_prevista_fim: r.previsaoFim ? new Date(r.previsaoFim) : null,
        observacao: r.observacao ?? null,
        operacao: 'alteracao',
        dados: JSON.stringify({
          estado: r.estado,
          motivo: r.motivo ?? null,
          precaucao: r.precaucao ?? null,
          justificativa: r.justificativa,
        }),
        ocorrido_em: agora,
        usuario_id: usuario(),
      });
      return n(p['id']);
    },
    async limparAtributos(r) {
      if (r.escopo === 'tipo') {
        // O tipo volta ao padrão: os atributos ficam nulos (a linha e a versão guardam o histórico na trilha).
        const cat = await categoriaDaChave(tx, r.chave);
        const [a] = await tx.consultarParaAtualizar(
          'SELECT id, versao FROM atributo_categoria_acomodacao WHERE estabelecimento_id = ? AND categoria_acomodacao_id = ?',
          [est, cat],
        );
        if (!a)
          throw recusa(
            'atributos-inexistentes',
            'O tipo de acomodação não tem atributos próprios: já vale o padrão.',
          );
        await tx.alterar('atributo_categoria_acomodacao', n(a['id']), n(a['versao']), {
          sexo_permitido: null,
          criticidade: null,
          idade_minima_dias: null,
          idade_maxima_dias: null,
          andar: null,
          ramal: null,
          terapia_intensiva: null,
        });
        return n(a['id']);
      }
      const chave = r.chave.split('|');
      const leito = await leitoDaChave(tx, est, {
        bloco: chave[0] ?? '',
        acomodacao: chave[1] ?? '',
        leito: chave[2] ?? '',
      });
      const v = await tx.uma('SELECT versao FROM leito_hospitalar WHERE id = ?', [n(leito['id'])]);
      await tx.alterar('leito_hospitalar', n(leito['id']), n(v?.['versao']), {
        sexo_permitido: 'qualquer',
        criticidade: 'baixa',
      });
      return n(leito['id']);
    },
    async gravarAtributo(r) {
      if (r.escopo === 'tipo') {
        const cat = await categoriaDaChave(tx, r.chave);
        const campos: Record<string, unknown> = {
          ...(r.andar !== undefined ? { andar: r.andar } : {}),
          ...(r.sexo !== undefined
            ? { sexo_permitido: r.sexo === null ? null : (SEXO_DO_LEITO[r.sexo] ?? null) }
            : {}),
          ...(r.criticidade !== undefined
            ? { criticidade: r.criticidade ? (CRITICIDADES[r.criticidade - 1] ?? null) : null }
            : {}),
          ...(r.ramal !== undefined ? { ramal: r.ramal === null ? null : String(r.ramal) } : {}),
          ...(r.idadeMinima !== undefined ? { idade_minima_dias: anosParaDias(r.idadeMinima) } : {}),
          ...(r.idadeMaxima !== undefined ? { idade_maxima_dias: anosParaDias(r.idadeMaxima) } : {}),
          ...(r.intensiva !== undefined ? { terapia_intensiva: r.intensiva } : {}),
        };
        const [a] = await tx.consultarParaAtualizar(
          `SELECT id, versao, sexo_permitido, criticidade, idade_minima_dias, idade_maxima_dias, andar, ramal, terapia_intensiva
             FROM atributo_categoria_acomodacao WHERE estabelecimento_id = ? AND categoria_acomodacao_id = ?`,
          [est, cat],
        );
        if (!a) {
          await tx.incluir('atributo_categoria_acomodacao', {
            estabelecimento_id: est,
            categoria_acomodacao_id: cat,
            ...campos,
          });
          return;
        }
        const proprios = [
          'sexo_permitido',
          'criticidade',
          'idade_minima_dias',
          'idade_maxima_dias',
          'andar',
          'ramal',
          'terapia_intensiva',
        ].some((c) => a[c] !== null);
        if (proprios && !r.motivo)
          throw recusa(
            'motivo-obrigatorio',
            'Informe o motivo da mudança dos atributos do tipo de acomodação.',
            { campos: ['motivo'] },
          );
        await tx.alterar('atributo_categoria_acomodacao', n(a['id']), n(a['versao']), campos);
        return;
      }
      const chave = r.chave.split('|');
      const leito = await leitoDaChave(tx, est, {
        bloco: chave[0] ?? '',
        acomodacao: chave[1] ?? '',
        leito: chave[2] ?? '',
      });
      const atual = await tx.uma(
        'SELECT versao, sexo_permitido, criticidade FROM leito_hospitalar WHERE id = ?',
        [n(leito['id'])],
      );
      const proprios = atual && (atual['sexo_permitido'] !== 'qualquer' || atual['criticidade'] !== 'baixa');
      if (proprios && !r.motivo)
        throw recusa('motivo-obrigatorio', 'Informe o motivo da mudança dos atributos do leito.', {
          campos: ['motivo'],
        });
      await tx.alterar('leito_hospitalar', n(leito['id']), n(atual?.['versao']), {
        ...(r.andar !== undefined ? { andar: r.andar } : {}),
        ...(r.sexo !== undefined
          ? { sexo_permitido: r.sexo === null ? 'qualquer' : (SEXO_DO_LEITO[r.sexo] ?? 'qualquer') }
          : {}),
        ...(r.criticidade !== undefined
          ? { criticidade: r.criticidade ? (CRITICIDADES[r.criticidade - 1] ?? 'baixa') : 'baixa' }
          : {}),
        ...(r.ramal !== undefined ? { ramal: r.ramal === null ? null : String(r.ramal) } : {}),
      });
    },
    async gravarEtapaLimpeza(r) {
      const [s] = await tx.consultarParaAtualizar(
        'SELECT id, versao, inicio_higienizacao_em, fim_higienizacao_em, concluida_em, cancelada_em FROM solicitacao_limpeza WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [r.solicitacao, est],
      );
      if (!s)
        throw new ErroOperacao(
          404,
          'registro-inexistente',
          'Solicitação não encontrada',
          'A solicitação de limpeza não existe.',
        );
      if (s['concluida_em'] !== null || s['cancelada_em'] !== null)
        throw recusa('limpeza-encerrada', 'A limpeza já foi liberada ou cancelada.');
      const agora = new Date();
      const etapa = ETAPA_DA_SITUACAO[r.etapa] ?? 'aguardando';
      const muda: Record<string, unknown> = { situacao_limpeza_id: await situacaoLimpeza(tx, etapa) };
      if (r.profissional) muda['profissional_higienizacao_id'] = r.profissional;
      if (r.tipoLimpeza) muda['modalidade_limpeza_id'] = r.tipoLimpeza;
      if (r.etapa === 'atribuido') muda['fim_aguardando_em'] = agora;
      if (r.etapa === 'emExecucao' && s['inicio_higienizacao_em'] === null)
        muda['inicio_higienizacao_em'] = agora;
      if (r.etapa === 'concluido') {
        if (s['inicio_higienizacao_em'] === null) muda['inicio_higienizacao_em'] = agora;
        muda['fim_higienizacao_em'] = agora;
      }
      if (r.etapa === 'cancelado') {
        muda['cancelada_em'] = agora;
        muda['cancelamento_usuario_id'] = usuario();
        muda['motivo_cancelamento'] = r.observacao ?? 'Cancelada na higienização';
      }
      if (r.observacao && r.etapa !== 'cancelado') muda['observacao'] = r.observacao;
      // A liberação é o mesmo caminho da ação "Liberar leito": locais, período de higienização e situação do leito.
      if (r.etapa === 'liberado') {
        await liberarSolicitacao(tx, r.solicitacao, s, usuario(), muda);
        return r.solicitacao;
      }
      await tx.alterar('solicitacao_limpeza', r.solicitacao, n(s['versao']), muda);
      // O cancelamento encerra o período de higienização ligado à solicitação.
      if (r.etapa === 'cancelado') {
        const periodos = await tx.consultarParaAtualizar(
          'SELECT id, versao, leito_hospitalar_id FROM periodo_situacao_leito WHERE solicitacao_limpeza_id = ? AND data_hora_fim IS NULL',
          [r.solicitacao],
        );
        for (const p of periodos) {
          await tx.alterar('periodo_situacao_leito', n(p['id']), n(p['versao']), {
            data_hora_fim: agora,
            operacao: 'alteracao',
            ocorrido_em: agora,
            usuario_id: usuario(),
          });
          await situarLeito(tx, n(p['leito_hospitalar_id']));
        }
      }
      if (r.etapa === 'inspecionado' || r.etapa === 'reprovado')
        return tx.incluir('inspecao_limpeza', {
          estabelecimento_id: est,
          solicitacao_limpeza_id: r.solicitacao,
          inspetor_usuario_id: usuario(),
          inspecionado_em: agora,
          resultado: r.etapa === 'inspecionado' ? 'aprovada' : 'reprovada',
          motivo_reprovacao: r.etapa === 'reprovado' ? (r.observacao ?? 'Reprovada na inspeção') : null,
          checklist: r.checklist ? JSON.stringify(r.checklist) : null,
          exige_nova_limpeza: r.etapa === 'reprovado',
        });
      return r.solicitacao;
    },
    async gravarSameExt(r) {
      // Ocorrência do arquivo de prontuários que não é movimento físico do volume (remessa, aceite, cobrança,
      // exclusão, ocorrência e descarte). A conta é o atendimento; o movimento, quando vier, é desta conta (do
      // atendimento ou, sem atendimento, do volume do mesmo paciente).
      const a = await tx.uma(
        'SELECT id, paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [r.conta, est],
      );
      if (!a)
        throw new ErroOperacao(
          404,
          'registro-inexistente',
          'Conta não encontrada',
          'O atendimento não existe neste estabelecimento.',
        );
      if (r.movimento !== null) {
        const m = await tx.uma(
          `SELECT id FROM movimento_prontuario
            WHERE id = ? AND estabelecimento_id = ? AND paciente_id = ? AND (atendimento_id = ? OR atendimento_id IS NULL)
              AND excluido_em IS NULL`,
          [r.movimento, est, n(a['paciente_id']), r.conta],
        );
        if (!m)
          throw recusa('movimento-inexistente', 'O movimento não é desta conta ou foi desfeito.', {
            campos: ['movimento'],
          });
      }
      const motivo = r.motivo?.trim() || null;
      if (['exclusao', 'descarte', 'ocorrencia'].includes(r.tipo) && !motivo)
        throw recusa('motivo-obrigatorio', 'Informe o motivo do registro.', { campos: ['motivo'] });
      const aval = r.avalComissao?.trim() || null;
      if (r.tipo === 'descarte' && !aval)
        throw recusa('aval-obrigatorio', 'O descarte exige o aval da comissão de revisão de prontuários.', {
          campos: ['avalComissao'],
        });
      const prazo = r.prazoDevolucao ?? null;
      if (prazo !== null && !/^\d{4}-\d{2}-\d{2}$/.test(prazo))
        throw recusa('data.formato', 'O prazo de devolução é uma data AAAA-MM-DD.', {
          campos: ['prazoDevolucao'],
        });
      return tx.incluir('ocorrencia_arquivo_prontuario', {
        estabelecimento_id: est,
        atendimento_id: r.conta,
        movimento_prontuario_id: r.movimento,
        tipo: r.tipo,
        motivo,
        protocolo: r.protocolo?.trim() || null,
        prazo_devolucao: prazo,
        aval_comissao: aval,
        registrado_em: new Date(),
        usuario_id: usuario(),
      });
    },
  };
}
