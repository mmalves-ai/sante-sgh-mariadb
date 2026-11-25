// Porta própria da declaração de saúde, da doença ou lesão preexistente com a cobertura parcial temporária e da
// portabilidade de carências do beneficiário (08-SGO L95, C2-113; F7) sobre o banco do cliente (RN ANS 162 e 438):
// - a declaração (declaracao_saude) com as respostas do questionário de finalidade "declaração de saúde"
//   (declaracao_saude_resposta) e as doenças informadas com o CID-10 (doenca_preexistente_declarada, em análise);
// - a decisão de cada doença (CPT, agravo ou sem restrição): a CPT nasce em cobertura_parcial_temporaria com o fim pela
//   adesão e fica ligada nos dois lados; decididas todas, a declaração fica analisada (quem e quando);
// - o encerramento ou cancelamento da CPT com motivo (nunca apagada);
// - o pedido de portabilidade (portabilidade_carencia) com número de negócio e prazo de resposta; a aprovação confere os
//   requisitos e aproveita todas as carências já geradas (carencia_aplicada ligada à portabilidade); as geradas depois
//   leem a portabilidade aprovada (porta do cadastro complementar);
// - a visão por beneficiário (carências, declarações, doenças, CPT, portabilidades e pedidos de cartão).
// A regra vem do domínio (declaracao-saude.ts); o banco só guarda. Cada gravação é uma operação do Executor (trilha na
// mesma transação). O escopo é o estabelecimento da sessão (fora, 404).
import {
  carenciasComPortabilidade,
  imcDaDeclaracao,
  mesesCompletos,
  passoDaPortabilidade,
  planoDaCpt,
  prazoRespostaPortabilidade,
  type ProblemaDeclaracaoSaude,
  problemasDaAprovacaoPortabilidade,
  problemasDaDeclaracaoSaude,
  problemasDaDecisaoDlp,
  problemasDaPortabilidade,
  problemasDoEncerramentoCpt,
} from '@sgh/dominio-operadora';
import {
  definirOperacao,
  ErroOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  booleano,
  contextoDireto,
  dataIso,
  estabelecimentoDaSessao,
  instanteIso,
  inteiro,
  type NucleoOperadora,
  numero,
  semEstabelecimento,
  texto,
  textoObrigatorio,
} from './apoio-banco.js';

export const PORTA_BENEFICIARIO_SAUDE = Symbol('PORTA_BENEFICIARIO_SAUDE_OPERADORA');

export const TABELAS_BENEFICIARIO_SAUDE = [
  'declaracao_saude',
  'declaracao_saude_resposta',
  'doenca_preexistente_declarada',
  'cobertura_parcial_temporaria',
  'portabilidade_carencia',
  'carencia_aplicada',
  'beneficiario_plano',
  'sequencia_negocio',
] as const;

export type Gravado = { readonly id: number; readonly versao: number } & Readonly<
  Record<string, string | number | boolean | null>
>;
type Trilha = (r: Gravado) => RegistroTrilhaTela;

const naoEncontrado = () =>
  new ErroOperacao(
    404,
    'nao-encontrado',
    'Registro não encontrado',
    'O registro não existe neste estabelecimento.',
  );
function exigir(problemas: readonly (ProblemaDeclaracaoSaude | null)[]): void {
  const lista = problemas.filter((x): x is ProblemaDeclaracaoSaude => x !== null);
  const p = lista[0];
  if (p) throw recusa(p.codigo, p.detalhe, { campos: [...new Set(lista.map((x) => x.campo))] });
}
const esquemaEntrada = z.record(z.string(), z.unknown());

// ---- formas de entrada (validadas no controller) ----
export interface EntradaDeclaracao {
  questionario: number;
  preenchidaEm: string;
  pesoKg: number | null;
  alturaM: number | null;
  entrevistaQualificada: boolean;
  medicoOrientador: number | null;
  dispensouOrientacao: boolean;
  respostas: {
    pergunta: number;
    afirmativa: boolean | null;
    texto: string | null;
    complemento: string | null;
  }[];
  doencas: { termo: number; inicio: string; forma: string }[];
}
export interface EntradaDecisao {
  versao: number;
  decisao: string;
  prazoMeses: number | null;
  percentualAgravo: number | null;
  observacao: string | null;
}
export interface EntradaEncerramentoCpt {
  versao: number;
  situacao: 'encerrada' | 'cancelada';
  data: string;
  motivo: string;
}
export interface EntradaPortabilidade {
  direcao: string;
  modalidade: string;
  registroAnsOrigem: string;
  nomeOperadoraOrigem: string | null;
  registroProdutoOrigem: string | null;
  vinculoInicio: string | null;
  faixaPrecoCompativel: boolean;
  adimplente: boolean;
  solicitadoEm: string;
  observacao: string | null;
}
export interface EntradaDecisaoPortabilidade {
  versao: number;
  situacao: string;
  motivoRecusa: string | null;
  cumpriuCptNaOrigem: boolean;
  jaPortouAntes: boolean;
}

// ---- leituras ----
export interface PerguntaDeclaracao {
  id: number;
  sequencia: number;
  enunciado: string;
  tipoResposta: string;
  obrigatoria: boolean;
}
export interface QuestionarioDeclaracao {
  id: number;
  codigo: string;
  nome: string;
  perguntas: PerguntaDeclaracao[];
}
export interface PainelSaudeBeneficiario {
  beneficiario: {
    id: number;
    matricula: string;
    situacao: string;
    adesao: string | null;
    tipoContratacao: string | null;
    participantesNoContrato: number;
  };
  carencias: {
    id: number;
    categoria: string;
    dias: number;
    aproveitados: number;
    cumpridaEm: string;
    cumprida: boolean;
    portabilidade: number | null;
  }[];
  declaracoes: {
    id: number;
    versao: number;
    preenchidaEm: string;
    situacao: string;
    entrevistaQualificada: boolean;
    imc: number | null;
    respostasSim: number;
  }[];
  doencas: {
    id: number;
    versao: number;
    declaracao: number | null;
    cid: string;
    descricao: string;
    inicio: string;
    forma: string;
    decisao: string;
    percentualAgravo: number | null;
    cpt: number | null;
  }[];
  cpts: {
    id: number;
    versao: number;
    cid: string;
    inicio: string;
    fimPrevisto: string;
    prazoMeses: number;
    situacao: string;
    encerradaEm: string | null;
    vigenteHoje: boolean;
  }[];
  portabilidades: {
    id: number;
    versao: number;
    numero: string;
    direcao: string;
    modalidade: string;
    registroAnsOrigem: string;
    nomeOperadoraOrigem: string | null;
    solicitadoEm: string;
    prazoResposta: string | null;
    situacao: string;
    motivoRecusa: string | null;
    vencida: boolean;
  }[];
  cartoes: {
    id: number;
    numero: string;
    situacao: string;
    solicitadoEm: string | null;
    viaEmitida: number | null;
  }[];
}

export class PortaBeneficiarioSaudePropria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoOperadora & Pick<NucleoProprio, 'escrever'>,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor, est: number, hoje: string) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.correlacao || 'operadora-beneficiario-saude' },
      async (l) => {
        const est = await estabelecimentoDaSessao(c, l);
        if (est === null) throw semEstabelecimento();
        const h = await l.uma<{ hoje: unknown }>('SELECT CURRENT_DATE AS hoje');
        return fn(l, est, dataIso(h?.['hoje']) ?? new Date().toISOString().slice(0, 10));
      },
    );
  }

  private async gravar(
    c: ContextoPorta,
    nome: string,
    tabela: string,
    trilha: Trilha,
    fn: (tx: TxOperacao, est: number, hoje: string, agora: string) => Promise<Gravado>,
  ): Promise<Gravado> {
    const est = await this.ler(c, async (_l, e) => e);
    const operacao = definirOperacao<Record<string, unknown>, Gravado>({
      nome,
      tabelas: TABELAS_BENEFICIARIO_SAUDE,
      entrada: esquemaEntrada,
      acao: 'operacao',
      gravar: async (tx) => {
        const h = await tx.uma<{ hoje: unknown; agora: unknown }>(
          'SELECT CURRENT_DATE AS hoje, CURRENT_TIMESTAMP(3) AS agora',
        );
        const hoje = dataIso(h?.['hoje']) ?? new Date().toISOString().slice(0, 10);
        const agora = (instanteIso(h?.['agora']) ?? new Date().toISOString()).slice(0, 19).replace('T', ' ');
        return fn(tx, est, hoje, agora);
      },
      alvo: (_e, r) => ({ tabela, id: r.id }),
      trilha: (_e, r) => {
        const l = trilha(r);
        return { dados: l.dadosDepois, motivo: l.motivo ?? null };
      },
    });
    const ctx = contextoDireto(this.cliente, est, c, null);
    const r = await this.executor.executar(operacao, this.cliente, {}, ctx);
    return r.resultado;
  }

  /** O beneficiário do estabelecimento com a adesão, o tipo de contratação e os participantes ativos do contrato. */
  private static async beneficiario(l: Leitor, est: number, id: number) {
    const r = await l.uma(
      `SELECT b.id, b.versao, b.matricula, b.situacao, b.data_adesao, b.contrato_plano_id, cl.tipo_contratacao,
              (SELECT COUNT(*) FROM beneficiario_plano o WHERE o.contrato_plano_id = b.contrato_plano_id
                 AND o.excluido_em IS NULL AND o.situacao <> 'excluido') AS participantes
         FROM beneficiario_plano b JOIN contrato_plano cp ON cp.id = b.contrato_plano_id
         LEFT JOIN classificacao_plano cl ON cl.id = cp.classificacao_plano_id
        WHERE b.id = ? AND cp.estabelecimento_id = ? AND b.excluido_em IS NULL`,
      [id, est],
    );
    if (!r) throw naoEncontrado();
    return r;
  }

  // ======== leituras ========

  /** O beneficiário pela matrícula exata (para a tela abrir a visão por beneficiário). */
  buscar(
    c: ContextoPorta,
    matricula: string,
  ): Promise<{ id: number; matricula: string; situacao: string }[]> {
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        `SELECT b.id, b.matricula, b.situacao FROM beneficiario_plano b JOIN contrato_plano cp ON cp.id = b.contrato_plano_id
          WHERE cp.estabelecimento_id = ? AND b.matricula = ? AND b.excluido_em IS NULL ORDER BY b.id DESC`,
        [est, matricula.trim()],
        { teto: 20 },
      );
      return rs.map((r) => ({
        id: Number(r['id']),
        matricula: textoObrigatorio(r['matricula']),
        situacao: textoObrigatorio(r['situacao']),
      }));
    });
  }

  /** Os questionários vigentes de declaração de saúde com as perguntas. */
  questionarios(c: ContextoPorta): Promise<QuestionarioDeclaracao[]> {
    return this.ler(c, async (l, _est, hoje) => {
      const ms = await l.consultar(
        `SELECT id, codigo, nome FROM modelo_questionario_saude
          WHERE finalidade = 'declaracao_saude' AND ativo = TRUE AND vigencia_inicio <= ?
            AND (vigencia_fim IS NULL OR vigencia_fim >= ?) ORDER BY nome`,
        [hoje, hoje],
        { teto: 100 },
      );
      const r: QuestionarioDeclaracao[] = [];
      for (const m of ms) {
        const ps = await l.consultar(
          `SELECT id, sequencia, enunciado, tipo_resposta, obrigatoria FROM modelo_questionario_saude_pergunta
            WHERE modelo_questionario_saude_id = ? ORDER BY sequencia`,
          [m['id']],
          { teto: 300 },
        );
        r.push({
          id: Number(m['id']),
          codigo: textoObrigatorio(m['codigo']),
          nome: textoObrigatorio(m['nome']),
          perguntas: ps.map((p) => ({
            id: Number(p['id']),
            sequencia: Number(p['sequencia']),
            enunciado: textoObrigatorio(p['enunciado']),
            tipoResposta: textoObrigatorio(p['tipo_resposta']),
            obrigatoria: booleano(p['obrigatoria']),
          })),
        });
      }
      return r;
    });
  }

  /** A visão por beneficiário: carências, declarações, doenças com a decisão, CPT, portabilidades e cartões. */
  painel(c: ContextoPorta, beneficiario: number): Promise<PainelSaudeBeneficiario> {
    return this.ler(c, async (l, est, hoje) => {
      const b = await PortaBeneficiarioSaudePropria.beneficiario(l, est, beneficiario);
      const car = await l.consultar(
        `SELECT id, categoria, dias_carencia, dias_aproveitados, cumprida_em, cumprida_em <= CURRENT_DATE AS cumprida,
                portabilidade_carencia_id FROM carencia_aplicada
          WHERE beneficiario_plano_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
        [beneficiario],
        { teto: 200 },
      );
      const decs = await l.consultar(
        `SELECT d.id, d.versao, d.preenchida_em, d.situacao, d.entrevista_qualificada, d.peso_kg, d.altura_m,
                (SELECT COUNT(*) FROM declaracao_saude_resposta r WHERE r.declaracao_saude_id = d.id
                   AND r.resposta_afirmativa = TRUE AND r.excluido_em IS NULL) AS sim
           FROM declaracao_saude d WHERE d.beneficiario_plano_id = ? AND d.estabelecimento_id = ? AND d.excluido_em IS NULL
          ORDER BY d.preenchida_em DESC, d.id DESC`,
        [beneficiario, est],
        { teto: 100 },
      );
      const doe = await l.consultar(
        `SELECT x.id, x.versao, x.declaracao_saude_id, t.codigo_termo, t.descricao, x.data_inicio, x.forma_identificacao,
                x.decisao_cobertura, x.percentual_agravo, x.cobertura_parcial_temporaria_id
           FROM doenca_preexistente_declarada x JOIN termo_terminologia t ON t.id = x.termo_terminologia_id
          WHERE x.beneficiario_plano_id = ? AND x.excluido_em IS NULL ORDER BY x.sequencia`,
        [beneficiario],
        { teto: 200 },
      );
      const cpts = await l.consultar(
        `SELECT id, versao, codigo_cid, inicio, fim_previsto, prazo_meses, situacao, encerrada_em,
                (situacao = 'vigente' AND inicio <= CURRENT_DATE AND fim_previsto >= CURRENT_DATE) AS vigente_hoje
           FROM cobertura_parcial_temporaria WHERE beneficiario_plano_id = ? AND excluido_em IS NULL ORDER BY inicio, id`,
        [beneficiario],
        { teto: 200 },
      );
      const ports = await l.consultar(
        `SELECT id, versao, numero, direcao, modalidade, operadora_externa_registro_ans, operadora_externa_nome,
                solicitado_em, prazo_resposta, situacao, motivo_recusa
           FROM portabilidade_carencia WHERE beneficiario_plano_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
          ORDER BY solicitado_em DESC, id DESC`,
        [beneficiario, est],
        { teto: 100 },
      );
      const cartoes = await l.consultar(
        `SELECT p.id, p.numero, s.codigo AS situacao, p.solicitado_em,
                (SELECT MAX(v.via) FROM cartao_beneficiario v WHERE v.solicitacao_cartao_beneficiario_id = p.id) AS via
           FROM solicitacao_cartao_beneficiario p JOIN situacao_solicitacao_cartao s ON s.id = p.situacao_solicitacao_cartao_id
          WHERE p.beneficiario_plano_id = ? AND p.excluido_em IS NULL ORDER BY p.id DESC`,
        [beneficiario],
        { teto: 100 },
      );
      return {
        beneficiario: {
          id: Number(b['id']),
          matricula: textoObrigatorio(b['matricula']),
          situacao: textoObrigatorio(b['situacao']),
          adesao: dataIso(b['data_adesao']),
          tipoContratacao: texto(b['tipo_contratacao']),
          participantesNoContrato: Number(b['participantes'] ?? 0),
        },
        carencias: car.map((r) => ({
          id: Number(r['id']),
          categoria: textoObrigatorio(r['categoria']),
          dias: Number(r['dias_carencia']),
          aproveitados: Number(r['dias_aproveitados']),
          cumpridaEm: dataIso(r['cumprida_em']) ?? '',
          cumprida: booleano(r['cumprida']),
          portabilidade: inteiro(r['portabilidade_carencia_id']),
        })),
        declaracoes: decs.map((r) => ({
          id: Number(r['id']),
          versao: Number(r['versao']),
          preenchidaEm: (instanteIso(r['preenchida_em']) ?? '').slice(0, 10),
          situacao: textoObrigatorio(r['situacao']),
          entrevistaQualificada: booleano(r['entrevista_qualificada']),
          imc: imcDaDeclaracao(numero(r['peso_kg']), numero(r['altura_m'])),
          respostasSim: Number(r['sim'] ?? 0),
        })),
        doencas: doe.map((r) => ({
          id: Number(r['id']),
          versao: Number(r['versao']),
          declaracao: inteiro(r['declaracao_saude_id']),
          cid: textoObrigatorio(r['codigo_termo']),
          descricao: textoObrigatorio(r['descricao']),
          inicio: dataIso(r['data_inicio']) ?? '',
          forma: textoObrigatorio(r['forma_identificacao']),
          decisao: textoObrigatorio(r['decisao_cobertura']),
          percentualAgravo: numero(r['percentual_agravo']),
          cpt: inteiro(r['cobertura_parcial_temporaria_id']),
        })),
        cpts: cpts.map((r) => ({
          id: Number(r['id']),
          versao: Number(r['versao']),
          cid: textoObrigatorio(r['codigo_cid']),
          inicio: dataIso(r['inicio']) ?? '',
          fimPrevisto: dataIso(r['fim_previsto']) ?? '',
          prazoMeses: Number(r['prazo_meses']),
          situacao: textoObrigatorio(r['situacao']),
          encerradaEm: dataIso(r['encerrada_em']),
          vigenteHoje: booleano(r['vigente_hoje']),
        })),
        portabilidades: ports.map((r) => {
          const situacao = textoObrigatorio(r['situacao']);
          const prazo = dataIso(r['prazo_resposta']);
          return {
            id: Number(r['id']),
            versao: Number(r['versao']),
            numero: textoObrigatorio(r['numero']),
            direcao: textoObrigatorio(r['direcao']),
            modalidade: textoObrigatorio(r['modalidade']),
            registroAnsOrigem: textoObrigatorio(r['operadora_externa_registro_ans']),
            nomeOperadoraOrigem: texto(r['operadora_externa_nome']),
            solicitadoEm: (instanteIso(r['solicitado_em']) ?? '').slice(0, 10),
            prazoResposta: prazo,
            situacao,
            motivoRecusa: texto(r['motivo_recusa']),
            vencida: (situacao === 'recebida' || situacao === 'em_analise') && prazo !== null && prazo < hoje,
          };
        }),
        cartoes: cartoes.map((r) => ({
          id: Number(r['id']),
          numero: textoObrigatorio(r['numero']),
          situacao: textoObrigatorio(r['situacao']),
          solicitadoEm: (instanteIso(r['solicitado_em']) ?? '').slice(0, 10) || null,
          viaEmitida: inteiro(r['via']),
        })),
      };
    });
  }

  // ======== declaração de saúde ========

  /** Grava a declaração preenchida com as respostas e as doenças informadas (em análise). */
  registrarDeclaracao(c: ContextoPorta, beneficiario: number, e: EntradaDeclaracao, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.declaracao-saude.registrar',
      'declaracao_saude',
      trilha,
      async (tx, est, hoje) => {
        await PortaBeneficiarioSaudePropria.beneficiario(tx, est, beneficiario);
        const q = await tx.uma(
          `SELECT id FROM modelo_questionario_saude WHERE id = ? AND finalidade = 'declaracao_saude' AND ativo = TRUE`,
          [e.questionario],
        );
        if (!q)
          throw recusa(
            'questionario-invalido',
            'O questionário não é de declaração de saúde ou está inativo.',
            {
              campos: ['questionario'],
            },
          );
        const ps = await tx.consultar(
          'SELECT id, obrigatoria FROM modelo_questionario_saude_pergunta WHERE modelo_questionario_saude_id = ?',
          [e.questionario],
          { teto: 300 },
        );
        exigir(
          problemasDaDeclaracaoSaude({
            ...e,
            hoje,
            perguntas: ps.map((p) => Number(p['id'])),
            obrigatorias: ps.filter((p) => booleano(p['obrigatoria'])).map((p) => Number(p['id'])),
          }),
        );
        for (const d of e.doencas) {
          const t = await tx.uma(
            `SELECT t.id FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id
            WHERE t.id = ? AND g.codigo = 'cid10'`,
            [d.termo],
          );
          if (!t)
            throw recusa('cid-invalido', 'A doença precisa de um código do CID-10.', { campos: ['doencas'] });
        }
        const id = await tx.incluir('declaracao_saude', {
          estabelecimento_id: est,
          beneficiario_plano_id: beneficiario,
          modelo_questionario_saude_id: e.questionario,
          preenchida_em: `${e.preenchidaEm} 00:00:00`,
          peso_kg: e.pesoKg,
          altura_m: e.alturaM,
          entrevista_qualificada: e.entrevistaQualificada,
          medico_orientador_profissional_id: e.medicoOrientador,
          dispensou_orientacao_medica: e.dispensouOrientacao,
          situacao: e.doencas.length > 0 ? 'em_analise' : 'analisada',
          analisada_por_usuario_id: e.doencas.length > 0 ? null : tx.contexto.usuario,
          analisada_em: e.doencas.length > 0 ? null : `${hoje} 00:00:00`,
        });
        let seq = 1;
        for (const s of e.respostas)
          await tx.incluir('declaracao_saude_resposta', {
            declaracao_saude_id: id,
            sequencia: seq++,
            modelo_questionario_saude_pergunta_id: s.pergunta,
            resposta_afirmativa: s.afirmativa,
            resposta_texto: s.texto,
            complemento: s.complemento,
          });
        const m = await tx.uma<{ s: unknown }>(
          'SELECT COALESCE(MAX(sequencia), 0) AS s FROM doenca_preexistente_declarada WHERE beneficiario_plano_id = ?',
          [beneficiario],
        );
        let sd = (inteiro(m?.['s']) ?? 0) + 1;
        for (const d of e.doencas)
          await tx.incluir('doenca_preexistente_declarada', {
            beneficiario_plano_id: beneficiario,
            sequencia: sd++,
            declaracao_saude_id: id,
            termo_terminologia_id: d.termo,
            forma_identificacao: d.forma,
            data_inicio: d.inicio,
            decisao_cobertura: 'em_analise',
          });
        return { id, versao: 1, doencas: e.doencas.length };
      },
    );
  }

  /**
   * Decide a cobertura da doença: a CPT nasce com o prazo contado da adesão e fica ligada à doença; o agravo guarda o
   * percentual. Decididas todas as doenças da declaração, ela fica analisada.
   */
  decidirDoenca(c: ContextoPorta, doenca: number, e: EntradaDecisao, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.doenca-preexistente.decidir',
      'doenca_preexistente_declarada',
      trilha,
      async (tx, est, hoje, agora) => {
        const d = await tx.uma(
          `SELECT x.id, x.versao, x.beneficiario_plano_id, x.declaracao_saude_id, x.decisao_cobertura, x.grupo_patologia_id,
                t.codigo_termo FROM doenca_preexistente_declarada x JOIN termo_terminologia t ON t.id = x.termo_terminologia_id
          WHERE x.id = ? AND x.excluido_em IS NULL`,
          [doenca],
        );
        if (!d) throw naoEncontrado();
        const ben = Number(d['beneficiario_plano_id']);
        const b = await PortaBeneficiarioSaudePropria.beneficiario(tx, est, ben);
        const adesao = dataIso(b['data_adesao']) ?? '';
        exigir(
          problemasDaDecisaoDlp({
            decisaoAtual: textoObrigatorio(d['decisao_cobertura']),
            decisao: e.decisao,
            prazoMeses: e.prazoMeses,
            percentualAgravo: e.percentualAgravo,
            adesao,
            hoje,
            tipoContratacao: textoObrigatorio(b['tipo_contratacao']),
            participantesNoContrato: Number(b['participantes'] ?? 0),
          }),
        );
        let cpt: number | null = null;
        if (e.decisao === 'cobertura_parcial_temporaria') {
          const plano = planoDaCpt(adesao, e.prazoMeses ?? 0);
          cpt = await tx.incluir('cobertura_parcial_temporaria', {
            beneficiario_plano_id: ben,
            doenca_preexistente_declarada_id: doenca,
            grupo_patologia_id: d['grupo_patologia_id'] ?? null,
            codigo_cid: textoObrigatorio(d['codigo_termo']).slice(0, 10),
            inicio: plano.inicio,
            prazo_meses: e.prazoMeses,
            fim_previsto: plano.fimPrevisto,
            situacao: 'vigente',
            observacao: e.observacao,
          });
        }
        const versao = await tx.alterar('doenca_preexistente_declarada', doenca, e.versao, {
          decisao_cobertura: e.decisao,
          percentual_agravo: e.decisao === 'agravo' ? e.percentualAgravo : null,
          cobertura_parcial_temporaria_id: cpt,
        });
        const dec = inteiro(d['declaracao_saude_id']);
        if (dec !== null) {
          const pend = await tx.uma(
            `SELECT COUNT(*) AS n FROM doenca_preexistente_declarada
            WHERE declaracao_saude_id = ? AND decisao_cobertura = 'em_analise' AND excluido_em IS NULL`,
            [dec],
          );
          const ds = await tx.uma('SELECT versao, situacao FROM declaracao_saude WHERE id = ?', [dec]);
          if (ds && Number(pend?.['n'] ?? 0) === 0 && textoObrigatorio(ds['situacao']) !== 'analisada')
            await tx.alterar('declaracao_saude', dec, Number(ds['versao']), {
              situacao: 'analisada',
              analisada_por_usuario_id: tx.contexto.usuario,
              analisada_em: agora,
            });
        }
        return { id: doenca, versao, cpt };
      },
    );
  }

  /** Encerra (fim antecipado) ou cancela a CPT com motivo; a linha fica como histórico. */
  encerrarCpt(c: ContextoPorta, id: number, e: EntradaEncerramentoCpt, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.cpt.encerrar',
      'cobertura_parcial_temporaria',
      trilha,
      async (tx, est) => {
        const r = await tx.uma(
          'SELECT id, beneficiario_plano_id, inicio, situacao, observacao FROM cobertura_parcial_temporaria WHERE id = ? AND excluido_em IS NULL',
          [id],
        );
        if (!r) throw naoEncontrado();
        await PortaBeneficiarioSaudePropria.beneficiario(tx, est, Number(r['beneficiario_plano_id']));
        exigir(
          problemasDoEncerramentoCpt({
            situacao: textoObrigatorio(r['situacao']),
            inicio: dataIso(r['inicio']) ?? '',
            data: e.data,
            motivo: e.motivo,
          }),
        );
        const obs = [
          texto(r['observacao']),
          `${e.situacao === 'cancelada' ? 'Cancelada' : 'Encerrada'}: ${e.motivo.trim()}`,
        ]
          .filter(Boolean)
          .join(' | ')
          .slice(0, 1000);
        const versao = await tx.alterar('cobertura_parcial_temporaria', id, e.versao, {
          situacao: e.situacao,
          encerrada_em: e.data,
          observacao: obs,
        });
        return { id, versao };
      },
    );
  }

  // ======== portabilidade de carências ========

  registrarPortabilidade(c: ContextoPorta, beneficiario: number, e: EntradaPortabilidade, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.portabilidade.registrar',
      'portabilidade_carencia',
      trilha,
      async (tx, est, hoje) => {
        const b = await PortaBeneficiarioSaudePropria.beneficiario(tx, est, beneficiario);
        exigir(problemasDaPortabilidade({ ...e, hoje }));
        const aberto = await tx.uma(
          `SELECT 1 AS ok FROM portabilidade_carencia WHERE beneficiario_plano_id = ? AND direcao = ?
            AND situacao IN ('recebida','em_analise') AND excluido_em IS NULL LIMIT 1`,
          [beneficiario, e.direcao],
        );
        if (aberto)
          throw recusa(
            'portabilidade-em-aberto',
            'Já há pedido de portabilidade em aberto para este beneficiário.',
            {
              campos: ['beneficiario'],
            },
          );
        await garantirSequencia(
          tx,
          { tipo: 'portabilidade_carencia', estabelecimento: est },
          { usuario: tx.contexto.usuario, agora: new Date() },
        );
        const numero = await tx.proximoNumero('portabilidade_carencia');
        const prod = await tx.uma('SELECT produto_plano_id FROM contrato_plano WHERE id = ?', [
          b['contrato_plano_id'],
        ]);
        const id = await tx.incluir('portabilidade_carencia', {
          estabelecimento_id: est,
          numero: numero.formatado,
          direcao: e.direcao,
          modalidade: e.modalidade,
          beneficiario_plano_id: beneficiario,
          operadora_externa_registro_ans: e.registroAnsOrigem,
          operadora_externa_nome: e.nomeOperadoraOrigem,
          produto_externo_registro_ans: e.registroProdutoOrigem,
          produto_plano_id: prod?.['produto_plano_id'] ?? null,
          vinculo_inicio: e.vinculoInicio,
          permanencia_meses: null,
          faixa_preco_compativel: e.faixaPrecoCompativel,
          adimplente: e.adimplente,
          solicitado_em: `${e.solicitadoEm} 00:00:00`,
          prazo_resposta: prazoRespostaPortabilidade(e.solicitadoEm),
          situacao: 'recebida',
          observacao: e.observacao,
        });
        return { id, versao: 1, numero: numero.formatado };
      },
    );
  }

  /**
   * Passo do pedido: em análise, aprovada (requisitos conferidos; na recebida, as carências já geradas passam a
   * aproveitadas por inteiro e ligadas ao pedido), recusada (com motivo) ou cancelada.
   */
  decidirPortabilidade(c: ContextoPorta, id: number, e: EntradaDecisaoPortabilidade, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.portabilidade.decidir',
      'portabilidade_carencia',
      trilha,
      async (tx, est, _hoje, agora) => {
        const r = await tx.uma(
          `SELECT id, beneficiario_plano_id, direcao, modalidade, vinculo_inicio, solicitado_em, adimplente,
                faixa_preco_compativel, situacao FROM portabilidade_carencia
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [id, est],
        );
        if (!r) throw naoEncontrado();
        exigir([passoDaPortabilidade(textoObrigatorio(r['situacao']), e.situacao)]);
        const solicitado = (instanteIso(r['solicitado_em']) ?? '').slice(0, 10);
        const vinculo = dataIso(r['vinculo_inicio']);
        if (e.situacao === 'recusada' && !(e.motivoRecusa ?? '').trim())
          throw recusa('motivo-obrigatorio', 'Informe o motivo da recusa.', { campos: ['motivoRecusa'] });
        if (e.situacao === 'aprovada')
          exigir(
            problemasDaAprovacaoPortabilidade({
              modalidade: textoObrigatorio(r['modalidade']),
              vinculoInicio: vinculo,
              solicitadoEm: solicitado,
              adimplente: booleano(r['adimplente']),
              faixaPrecoCompativel: booleano(r['faixa_preco_compativel']),
              cumpriuCptNaOrigem: e.cumpriuCptNaOrigem,
              jaPortouAntes: e.jaPortouAntes,
            }),
          );
        const decidida = ['aprovada', 'recusada', 'cancelada'].includes(e.situacao);
        const versao = await tx.alterar('portabilidade_carencia', id, e.versao, {
          situacao: e.situacao,
          decidido_em: decidida ? agora : null,
          analisado_por_usuario_id: tx.contexto.usuario,
          motivo_recusa: e.situacao === 'recusada' ? (e.motivoRecusa ?? '').trim().slice(0, 500) : null,
          permanencia_meses:
            vinculo !== null && solicitado ? Math.min(65535, mesesCompletos(vinculo, solicitado)) : null,
        });
        let aproveitadas = 0;
        const ben = inteiro(r['beneficiario_plano_id']);
        if (e.situacao === 'aprovada' && textoObrigatorio(r['direcao']) === 'recebida' && ben !== null) {
          const cs = await tx.consultar(
            `SELECT id, versao, inicio_contagem, dias_carencia FROM carencia_aplicada
            WHERE beneficiario_plano_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
            [ben],
            { teto: 200 },
          );
          const versoes = new Map(cs.map((x) => [Number(x['id']), Number(x['versao'])]));
          const novas = carenciasComPortabilidade(
            cs.map((x) => ({
              id: Number(x['id']),
              inicio: dataIso(x['inicio_contagem']) ?? '',
              dias: Number(x['dias_carencia']),
            })),
          );
          for (const n of novas) {
            await tx.alterar('carencia_aplicada', n.id, versoes.get(n.id) ?? 0, {
              dias_aproveitados: n.aproveitados,
              cumprida_em: n.cumpridaEm,
              portabilidade_carencia_id: id,
            });
            aproveitadas++;
          }
        }
        return { id, versao, aproveitadas };
      },
    );
  }
}

export const METODOS_BENEFICIARIO_SAUDE: ReadonlySet<string> = new Set([
  'buscar',
  'questionarios',
  'painel',
  'registrarDeclaracao',
  'decidirDoenca',
  'encerrarCpt',
  'registrarPortabilidade',
  'decidirPortabilidade',
]);
