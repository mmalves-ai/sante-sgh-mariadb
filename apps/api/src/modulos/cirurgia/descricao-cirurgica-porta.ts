// Porta da descrição cirúrgica e das intercorrências do ato (04-CC linha 96; F3.4, fatia F3.4-4): a leitura do ato com
// as descrições (achados e adendos), as intercorrências e os catálogos; a gravação pelas operações do Executor. Só no
// banco (porta própria); sem banco, a porta indisponível (503, falha fechada).
import { randomUUID } from 'node:crypto';
import {
  type ContextoOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
} from '@sgh/nucleo';
import { funcaoDescreveCirurgia } from '@sgh/dominio-cirurgia';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { civil, FUSO_PADRAO, n, nn, textoOuNulo, texto, verdadeiro } from './banco-apoio.js';
import { OPERACOES_DESCRICAO } from './descricao-cirurgica-operacoes.js';

export const PORTA_DESCRICAO_CIRURGICA = Symbol('PORTA_DESCRICAO_CIRURGICA');

export interface DescricaoLida {
  readonly id: number;
  readonly cirurgiao: number;
  readonly cirurgiaoNome: string;
  readonly situacao: string;
  readonly versao: number;
  readonly descricaoTecnica: string | null;
  readonly achadosTexto: string | null;
  readonly riscoCirurgico: string | null;
  readonly acidentes: string | null;
  readonly orteseProtese: string | null;
  readonly atoAnestesico: string | null;
  readonly sangramentoMl: number | null;
  readonly envioAnatomopatologico: boolean;
  readonly descricaoPecas: string | null;
  readonly assinadaEm: string | null;
  readonly achados: { achado: number; rotulo: string; complemento: string | null }[];
  readonly adendos: { sequencia: number; texto: string; motivo: string; registradoEm: string | null }[];
}

export interface TelaDescricaoCirurgica {
  readonly ato: {
    id: number;
    numero: string;
    paciente: number;
    pacienteNome: string;
    sala: string;
    entrada: string | null;
    saida: string | null;
  };
  /** naEquipe: está na equipe viva do ato; descreve: a função dele descreve a cirurgia (cirurgião ou auxiliar médico). */
  readonly eu: { profissional: number | null; naEquipe: boolean; descreve: boolean };
  readonly equipe: { profissional: number; nome: string; funcao: string; descreve: boolean }[];
  readonly descricoes: DescricaoLida[];
  readonly intercorrencias: {
    sequencia: number;
    tipo: string;
    ocorridoEm: string | null;
    fase: string;
    gravidade: string;
    descricao: string | null;
    conduta: string | null;
    registradoPor: string;
    /** O protocolo da notificação de evento adverso aberta pela intercorrência, ou null. */
    notificacao: string | null;
  }[];
  readonly catalogos: {
    achados: { id: number; rotulo: string; textoSugerido: string | null }[];
    tipos: {
      id: number;
      rotulo: string;
      exigeConduta: boolean;
      eventoAdverso: boolean;
      gravidade: string | null;
    }[];
  };
}

export interface DescricaoDoPaciente {
  readonly ato: number;
  readonly numero: string;
  readonly inicio: string | null;
  readonly cirurgiao: string;
  readonly situacao: string;
  readonly assinadaEm: string | null;
  readonly adendos: number;
  readonly intercorrencias: number;
}

export interface PortaDescricaoCirurgica {
  readonly destino: 'banco' | 'indisponivel';
  tela(c: ContextoPortaM18, ato: number): Promise<TelaDescricaoCirurgica | null>;
  doPaciente(c: ContextoPortaM18, paciente: number): Promise<DescricaoDoPaciente[]>;
  executar(
    c: ContextoPortaM18,
    op: string,
    entrada: unknown,
    ctx: ContextoOperacao,
  ): Promise<{ resultado: ResultadoOperacao; repetida: boolean }>;
}

export type NucleoDescricao = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

const SQL_ATO = `
  SELECT a.id, a.numero, a.paciente_id, pf.nome AS paciente, s.codigo AS sala, a.entrada_sala_em, a.saida_sala_em
    FROM ato_cirurgico a
    JOIN paciente p ON p.id = a.paciente_id
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    JOIN sala_cirurgica s ON s.id = a.sala_cirurgica_id
   WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.situacao <> 'cancelado'`;
const NOME_PROF = `COALESCE(pr.nome_exibicao, pfp.nome)`;
const descreve = (e: Record<string, unknown>) =>
  funcaoDescreveCirurgia(textoOuNulo(e['grau_participacao_tiss']), verdadeiro(e['funcao_medica']));

export class PortaDescricaoCirurgicaPropria implements PortaDescricaoCirurgica {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoDescricao,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPortaM18, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(
      { cliente: c.cliente, correlacao: c.correlacao || 'cirurgia' },
      async (l) => {
        const f = await l.uma<{ fuso_horario: string | null }>(
          'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
          [est],
        );
        return fn(l, est, f?.fuso_horario || FUSO_PADRAO);
      },
    );
  }

  tela(c: ContextoPortaM18, ato: number): Promise<TelaDescricaoCirurgica | null> {
    return this.ler(c, async (l, est, fuso) => {
      const a = await l.uma(SQL_ATO, [ato, est]);
      if (!a) return null;
      const eu = await l.uma(
        `SELECT v.profissional_id FROM usuario_vinculo_profissional v
          WHERE v.usuario_id = ? AND v.estabelecimento_id = ? AND v.excluido_em IS NULL
            AND v.vigencia_inicio <= CURRENT_DATE AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
          ORDER BY v.vigencia_inicio DESC, v.id DESC LIMIT 1`,
        [c.usuario, est],
      );
      const equipe = await l.consultar(
        `SELECT pc.profissional_id, ${NOME_PROF} AS nome, f.descricao AS funcao, f.funcao_medica,
                f.grau_participacao_tiss
           FROM participante_cirurgia pc
           JOIN profissional pr ON pr.id = pc.profissional_id
           JOIN pessoa_fisica pfp ON pfp.id = pr.pessoa_fisica_id
           JOIN funcao_equipe_cirurgica f ON f.id = pc.funcao_equipe_cirurgica_id
          WHERE pc.ato_cirurgico_id = ? AND pc.excluido_em IS NULL ORDER BY pc.id`,
        [ato],
      );
      const ds = await l.consultar(
        `SELECT d.*, ${NOME_PROF} AS nome FROM descricao_cirurgica d
           JOIN profissional pr ON pr.id = d.cirurgiao_profissional_id
           JOIN pessoa_fisica pfp ON pfp.id = pr.pessoa_fisica_id
          WHERE d.ato_cirurgico_id = ? AND d.excluido_em IS NULL ORDER BY d.id`,
        [ato],
      );
      const descricoes: DescricaoLida[] = [];
      for (const d of ds) {
        const achados = await l.consultar(
          `SELECT x.achado_cirurgico_padrao_id, c.descricao, x.complemento FROM descricao_cirurgica_achado x
             JOIN achado_cirurgico_padrao c ON c.id = x.achado_cirurgico_padrao_id
            WHERE x.descricao_cirurgica_id = ? AND x.excluido_em IS NULL ORDER BY x.sequencia`,
          [d['id']],
        );
        const adendos = await l.consultar(
          'SELECT sequencia, texto, motivo, registrado_em FROM descricao_cirurgica_adendo WHERE descricao_cirurgica_id = ? ORDER BY sequencia',
          [d['id']],
        );
        descricoes.push({
          id: n(d['id']),
          cirurgiao: n(d['cirurgiao_profissional_id']),
          cirurgiaoNome: texto(d['nome']),
          situacao: texto(d['situacao']),
          versao: n(d['versao']),
          descricaoTecnica: textoOuNulo(d['descricao_tecnica']),
          achadosTexto: textoOuNulo(d['achados']),
          riscoCirurgico: textoOuNulo(d['risco_cirurgico']),
          acidentes: textoOuNulo(d['acidentes_intraoperatorios']),
          orteseProtese: textoOuNulo(d['ortese_protese']),
          atoAnestesico: textoOuNulo(d['ato_anestesico']),
          sangramentoMl: nn(d['sangramento_estimado_ml']),
          envioAnatomopatologico: verdadeiro(d['envio_anatomopatologico']),
          descricaoPecas: textoOuNulo(d['descricao_pecas']),
          assinadaEm: civil(d['assinada_em'], fuso),
          achados: achados.map((x) => ({
            achado: n(x['achado_cirurgico_padrao_id']),
            rotulo: texto(x['descricao']),
            complemento: textoOuNulo(x['complemento']),
          })),
          adendos: adendos.map((x) => ({
            sequencia: n(x['sequencia']),
            texto: texto(x['texto']),
            motivo: texto(x['motivo']),
            registradoEm: civil(x['registrado_em'], fuso),
          })),
        });
      }
      const ints = await l.consultar(
        `SELECT i.sequencia, t.descricao AS tipo, i.ocorrido_em, i.fase, i.gravidade, i.descricao, i.conduta,
                ${NOME_PROF} AS nome, ni.numero AS protocolo
           FROM intercorrencia_cirurgica i
           JOIN tipo_intercorrencia_cirurgica t ON t.id = i.tipo_intercorrencia_cirurgica_id
           LEFT JOIN notificacao_incidente ni ON ni.id = i.notificacao_incidente_id
           JOIN profissional pr ON pr.id = i.registrado_por_profissional_id
           JOIN pessoa_fisica pfp ON pfp.id = pr.pessoa_fisica_id
          WHERE i.ato_cirurgico_id = ? AND i.excluido_em IS NULL ORDER BY i.ocorrido_em, i.sequencia`,
        [ato],
      );
      const achadosCat = await l.consultar(
        'SELECT id, descricao, texto_sugerido FROM achado_cirurgico_padrao WHERE ativo = TRUE ORDER BY descricao LIMIT 500',
      );
      const tipos = await l.consultar(
        'SELECT id, descricao, exige_conduta, evento_adverso, gravidade_padrao FROM tipo_intercorrencia_cirurgica WHERE ativo = TRUE ORDER BY descricao LIMIT 500',
      );
      const profissional = nn(eu?.['profissional_id']);
      return {
        ato: {
          id: n(a['id']),
          numero: texto(a['numero']),
          paciente: n(a['paciente_id']),
          pacienteNome: texto(a['paciente']),
          sala: texto(a['sala']),
          entrada: civil(a['entrada_sala_em'], fuso),
          saida: civil(a['saida_sala_em'], fuso),
        },
        eu: {
          profissional,
          naEquipe: profissional !== null && equipe.some((e) => n(e['profissional_id']) === profissional),
          descreve:
            profissional !== null &&
            equipe.some((e) => n(e['profissional_id']) === profissional && descreve(e)),
        },
        equipe: equipe.map((e) => ({
          profissional: n(e['profissional_id']),
          nome: texto(e['nome']),
          funcao: texto(e['funcao']),
          descreve: descreve(e),
        })),
        descricoes,
        intercorrencias: ints.map((i) => ({
          sequencia: n(i['sequencia']),
          tipo: texto(i['tipo']),
          ocorridoEm: civil(i['ocorrido_em'], fuso),
          fase: texto(i['fase']),
          gravidade: texto(i['gravidade']),
          descricao: textoOuNulo(i['descricao']),
          conduta: textoOuNulo(i['conduta']),
          registradoPor: texto(i['nome']),
          notificacao: textoOuNulo(i['protocolo']),
        })),
        catalogos: {
          achados: achadosCat.map((x) => ({
            id: n(x['id']),
            rotulo: texto(x['descricao']),
            textoSugerido: textoOuNulo(x['texto_sugerido']),
          })),
          tipos: tipos.map((x) => ({
            id: n(x['id']),
            rotulo: texto(x['descricao']),
            exigeConduta: verdadeiro(x['exige_conduta']),
            eventoAdverso: verdadeiro(x['evento_adverso']),
            gravidade: textoOuNulo(x['gravidade_padrao']),
          })),
        },
      };
    });
  }

  doPaciente(c: ContextoPortaM18, paciente: number): Promise<DescricaoDoPaciente[]> {
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.consultar(
        `SELECT a.id, a.numero, a.inicio_cirurgia_em, ${NOME_PROF} AS nome, d.situacao, d.assinada_em,
                (SELECT COUNT(*) FROM descricao_cirurgica_adendo x WHERE x.descricao_cirurgica_id = d.id) AS adendos,
                (SELECT COUNT(*) FROM intercorrencia_cirurgica i WHERE i.ato_cirurgico_id = a.id AND i.excluido_em IS NULL) AS ints
           FROM ato_cirurgico a
           JOIN descricao_cirurgica d ON d.ato_cirurgico_id = a.id AND d.excluido_em IS NULL
           JOIN profissional pr ON pr.id = d.cirurgiao_profissional_id
           JOIN pessoa_fisica pfp ON pfp.id = pr.pessoa_fisica_id
          WHERE a.paciente_id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL
          ORDER BY a.inicio_cirurgia_em DESC, a.id DESC LIMIT 200`,
        [paciente, est],
      );
      return r.map((x) => ({
        ato: n(x['id']),
        numero: texto(x['numero']),
        inicio: civil(x['inicio_cirurgia_em'], fuso),
        cirurgiao: texto(x['nome']),
        situacao: texto(x['situacao']),
        assinadaEm: civil(x['assinada_em'], fuso),
        adendos: n(x['adendos']),
        intercorrencias: n(x['ints']),
      }));
    });
  }

  async executar(c: ContextoPortaM18, op: string, entrada: unknown, ctx: ContextoOperacao) {
    const operacao = OPERACOES_DESCRICAO[op];
    if (!operacao) throw recusa('operacao-desconhecida', 'Operação desconhecida na descrição cirúrgica.');
    const r = await this.executor.executar(operacao, c.cliente, entrada as never, {
      ...ctx,
      chaveIdempotencia: ctx.chaveIdempotencia || `descricao-${randomUUID()}`,
    });
    return { resultado: r.resultado, repetida: r.repetida };
  }
}

/** Sem banco: tudo responde 503 (falha fechada). */
export function portaDescricaoIndisponivel(): PortaDescricaoCirurgica {
  const fora = () =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'A descrição cirúrgica exige o banco do cliente.',
      ),
    );
  return { destino: 'indisponivel', tela: fora, doPaciente: fora, executar: fora };
}
