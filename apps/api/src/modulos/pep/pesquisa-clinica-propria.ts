// Pesquisa clínica (03-PEP L144; Res. CNS 466/2012, RDC ANVISA 9/2015; LGPD art. 11, II, c) no banco do cliente, pelo
// @sgh/nucleo, sempre no estabelecimento da sessão. Regras em @sgh/dominio-pep (pesquisa-clinica). Contrato de efeito:
//   - estudo: pesquisa_clinica (código, título, CAAE, registro do ensaio, fase, vigência, investigador principal), em
//     aprovação; o investigador entra na pesquisa_clinica_equipe como investigador principal;
//   - situação: a passagem do ciclo do estudo; fora de "em aprovação" com o CAAE e a data do parecer ético;
//   - equipe: pesquisa_clinica_equipe (profissional, papel, início); critério: pesquisa_clinica_criterio (sequência,
//     tipo, grupo, fonte e a referência ou a faixa); desativar o critério só o marca inativo;
//   - triagem: só no estudo que recruta; uma triagem_elegibilidade_pesquisa "identificado" por paciente sugerido, com
//     os critérios atendidos e os que a equipe confere. Automática (todos os pacientes com atendimento no
//     estabelecimento na janela do estudo) só com o parâmetro pep.pesquisa.triagemAutomatica ligado; manual (os
//     pacientes que o investigador indicar) sempre. Paciente já participante ou com triagem aberta não repete. A
//     execução vai à trilha (registro do acesso aos prontuários);
//   - avaliação: em avaliação, recusado, inelegível ou descartado (com quem e quando); a inclusão cria o
//     participante_pesquisa "incluido" com o TCLE (data e o anexo do prontuário do próprio paciente) e o evento
//     "inclusao", e liga a triagem ao participante;
//   - acompanhamento: a mudança de situação do participante (início e fim do tratamento, saída com motivo) e a visita,
//     cada uma com o seu participante_pesquisa_evento.
// Nada é apagado. Recusa da regra: 422, sem escrita. Outro estabelecimento: 404. Versão velha: 409.
import {
  conferirCriterio,
  conferirEstudo,
  conferirInclusao,
  conferirMudancaParticipante,
  conferirTransicaoEstudo,
  type CriterioAvaliavel,
  estudoRecruta,
  FASES_ESTUDO,
  FONTES_CRITERIO,
  idadeEmAnos,
  PAPEIS_EQUIPE_PESQUISA,
  participanteSaiu,
  type ProblemaPesquisa,
  SITUACOES_ESTUDO,
  SITUACOES_PARTICIPANTE,
  type SituacaoEstudo,
  type SituacaoParticipante,
  TIPOS_CRITERIO,
  triarPaciente,
} from '@sgh/dominio-pep';
import type { TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';
import type { NucleoPortaPropria } from '../../porta-estabelecimento-propria.js';

export const PORTA_PESQUISA_CLINICA = Symbol('PORTA_PESQUISA_CLINICA');

export const TABELAS_PESQUISA_CLINICA = [
  'pesquisa_clinica',
  'pesquisa_clinica_equipe',
  'pesquisa_clinica_criterio',
  'triagem_elegibilidade_pesquisa',
  'participante_pesquisa',
  'participante_pesquisa_evento',
] as const;

/** Janela padrão da triagem automática quando o estudo não fixa o intervalo (dias de atendimento). */
const JANELA_PADRAO_DIAS = 30;
/** Teto de pacientes avaliados por execução da triagem. */
const TETO_TRIAGEM = 500;

type Linha = Record<string, unknown>;
const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const texto = (n: number) => z.string().trim().max(n).nullable().default(null);

const esquemaEstudo = z
  .object({
    codigo: z.string().trim().min(1).max(30),
    titulo: z.string().trim().min(1).max(250),
    tituloResumido: texto(60),
    numeroCaae: texto(20),
    registroEnsaio: texto(40),
    fase: z.enum(FASES_ESTUDO).nullable().default(null),
    inicio: data,
    fim: data.nullable().default(null),
    investigador: id,
    diasProcessamento: z.number().int().min(1).max(365).nullable().default(null),
    observacao: texto(4000),
  })
  .strict();
const esquemaSituacao = z
  .object({
    versao: id,
    situacao: z.enum(SITUACOES_ESTUDO),
    numeroCaae: texto(20),
    aprovacaoEticaEm: data.nullable().default(null),
    aprovadoComite: z.boolean().default(false),
    aprovadoDiretoria: z.boolean().default(false),
  })
  .strict();
const esquemaMembro = z
  .object({ profissional: id, papel: z.enum(PAPEIS_EQUIPE_PESQUISA), inicio: data })
  .strict();
const esquemaCriterio = z
  .object({
    tipo: z.enum(TIPOS_CRITERIO),
    fonte: z.enum(FONTES_CRITERIO),
    grupo: z.number().int().min(1).max(99).default(1),
    descricao: z.string().trim().max(500),
    exame: id.nullable().default(null),
    item: id.nullable().default(null),
    parametroVital: id.nullable().default(null),
    valorTexto: texto(500),
    valorMinimo: z.number().nullable().default(null),
    valorMaximo: z.number().nullable().default(null),
  })
  .strict();
const esquemaVersao = z.object({ versao: id }).strict();
const esquemaTriar = z.object({ pacientes: z.array(id).max(100).default([]) }).strict();
const esquemaAvaliar = z
  .object({
    versao: id,
    decisao: z.enum(['em_avaliacao', 'incluido', 'recusado', 'inelegivel', 'descartado']),
    avaliador: id.nullable().default(null),
    observacao: texto(4000),
    consentimentoEm: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
      .nullable()
      .default(null),
    anexo: id.nullable().default(null),
    codigoParticipante: texto(30),
    braco: texto(60),
  })
  .strict();
const esquemaMudanca = z
  .object({
    versao: id,
    situacao: z.enum(SITUACOES_PARTICIPANTE),
    motivo: texto(500),
    inicioTratamento: data.nullable().default(null),
    fimTratamento: data.nullable().default(null),
  })
  .strict();
const esquemaVisita = z
  .object({ ocorridoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/), observacao: texto(500) })
  .strict();

const recusa = (titulo: string, p: readonly ProblemaPesquisa[]) => {
  if (p.length) throw recusaRegra(titulo, p);
};
const dia = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
const instante = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 16) : v ? String(v).replace(' ', 'T').slice(0, 16) : null;
const json = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : v);

export interface EstudoResumo {
  readonly id: number;
  readonly codigo: string;
  readonly titulo: string;
  readonly situacao: SituacaoEstudo;
  readonly fase: string | null;
  readonly numeroCaae: string | null;
  readonly investigador: string | null;
  readonly inicio: string | null;
  readonly fim: string | null;
  readonly participantes: number;
  readonly candidatos: number;
  readonly versao: number;
}

export class PesquisaClinicaPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: NucleoPortaPropria, cliente: string) {
    super(nucleo, cliente, TABELAS_PESQUISA_CLINICA, 'pep.pesquisa');
  }

  /** Estudos do estabelecimento, com os participantes ativos e os candidatos em aberto. */
  painel(c: ContextoPortaPropria): Promise<{ estudos: EstudoResumo[] }> {
    return this.ler(c, 'painel', async (l, est) => {
      const r = (await l.consultar(
        `SELECT p.id, p.codigo, p.titulo, p.situacao, p.fase, p.numero_caae, p.inicio, p.fim, p.versao,
                pf.nome AS investigador,
                (SELECT COUNT(*) FROM participante_pesquisa x WHERE x.pesquisa_clinica_id = p.id
                    AND x.situacao IN ('incluido','em_tratamento','em_acompanhamento')) AS participantes,
                (SELECT COUNT(*) FROM triagem_elegibilidade_pesquisa t WHERE t.pesquisa_clinica_id = p.id
                    AND t.situacao IN ('identificado','em_avaliacao') AND t.excluido_em IS NULL) AS candidatos
           FROM pesquisa_clinica p
           LEFT JOIN profissional pr ON pr.id = p.investigador_principal_profissional_id
           LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
          WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL
          ORDER BY p.situacao = 'encerrada', p.codigo LIMIT 500`,
        [est.id],
      )) as Linha[];
      return {
        estudos: r.map((x) => ({
          id: num(x['id']),
          codigo: String(x['codigo']),
          titulo: String(x['titulo']),
          situacao: String(x['situacao']) as SituacaoEstudo,
          fase: txtOuNull(x['fase']),
          numeroCaae: txtOuNull(x['numero_caae']),
          investigador: txtOuNull(x['investigador']),
          inicio: dia(x['inicio']),
          fim: dia(x['fim']),
          participantes: num(x['participantes']),
          candidatos: num(x['candidatos']),
          versao: num(x['versao']),
        })),
      };
    });
  }

  /** O estudo com equipe, critérios, candidatos da triagem e participantes. */
  estudo(c: ContextoPortaPropria, estudo: number) {
    return this.ler(c, 'estudo', async (l, est) => {
      const p = (await l.uma(
        `SELECT * FROM pesquisa_clinica WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [estudo, est.id],
      )) as Linha | null;
      if (!p) throw naoEncontrado('Estudo');
      const nomeProf = `(SELECT pf.nome FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
                          WHERE pr.id = %s)`;
      const nomePac = `(SELECT pf.nome FROM paciente pa JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
                          WHERE pa.id = %s)`;
      const equipe = (await l.consultar(
        `SELECT e.id, e.profissional_id, e.papel, e.inicio, e.fim, ${nomeProf.replace('%s', 'e.profissional_id')} AS nome
           FROM pesquisa_clinica_equipe e WHERE e.pesquisa_clinica_id = ? AND e.excluido_em IS NULL ORDER BY e.id`,
        [estudo],
      )) as Linha[];
      const criterios = (await l.consultar(
        `SELECT id, sequencia, tipo, grupo_logico, descricao, fonte_dado, exame_id, item_prescritivel_id,
                parametro_vital_id, valor_texto, valor_minimo, valor_maximo, ativo, versao
           FROM pesquisa_clinica_criterio WHERE pesquisa_clinica_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
        [estudo],
      )) as Linha[];
      const triagens = (await l.consultar(
        `SELECT t.id, t.paciente_id, t.modo_geracao, t.processado_em, t.criterios_atendidos, t.situacao, t.versao,
                t.avaliado_em, t.observacao, ${nomePac.replace('%s', 't.paciente_id')} AS paciente
           FROM triagem_elegibilidade_pesquisa t
          WHERE t.pesquisa_clinica_id = ? AND t.estabelecimento_id = ? AND t.excluido_em IS NULL
          ORDER BY t.situacao NOT IN ('identificado','em_avaliacao'), t.processado_em DESC LIMIT 300`,
        [estudo, est.id],
      )) as Linha[];
      const participantes = (await l.consultar(
        `SELECT x.id, x.paciente_id, x.codigo_participante, x.braco, x.situacao, x.consentimento_em, x.incluido_em,
                x.inicio_tratamento, x.fim_tratamento, x.saida_em, x.motivo_saida, x.versao,
                ${nomePac.replace('%s', 'x.paciente_id')} AS paciente,
                (SELECT MAX(ev.ocorrido_em) FROM participante_pesquisa_evento ev
                  WHERE ev.participante_pesquisa_id = x.id AND ev.evento = 'visita') AS ultima_visita
           FROM participante_pesquisa x WHERE x.pesquisa_clinica_id = ? AND x.excluido_em IS NULL ORDER BY x.id`,
        [estudo],
      )) as Linha[];
      return {
        id: num(p['id']),
        codigo: String(p['codigo']),
        titulo: String(p['titulo']),
        tituloResumido: txtOuNull(p['titulo_resumido']),
        numeroCaae: txtOuNull(p['numero_caae']),
        registroEnsaio: txtOuNull(p['registro_ensaio']),
        fase: txtOuNull(p['fase']),
        situacao: String(p['situacao']) as SituacaoEstudo,
        aprovacaoEticaEm: dia(p['aprovacao_etica_em']),
        aprovadoComite: bool(p['aprovado_comite']),
        aprovadoDiretoria: bool(p['aprovado_diretoria']),
        inicio: dia(p['inicio']),
        fim: dia(p['fim']),
        diasProcessamento: numOuNull(p['dias_processamento_criterios']),
        recruta: estudoRecruta(String(p['situacao']) as SituacaoEstudo, bool(p['permite_inclusao_paciente'])),
        versao: num(p['versao']),
        equipe: equipe.map((e) => ({
          id: num(e['id']),
          profissional: num(e['profissional_id']),
          nome: txtOuNull(e['nome']),
          papel: String(e['papel']),
          inicio: dia(e['inicio']),
          fim: dia(e['fim']),
        })),
        criterios: criterios.map((x) => ({
          id: num(x['id']),
          sequencia: num(x['sequencia']),
          tipo: String(x['tipo']),
          grupo: num(x['grupo_logico']),
          descricao: String(x['descricao']),
          fonte: String(x['fonte_dado']),
          valorTexto: txtOuNull(x['valor_texto']),
          valorMinimo: numOuNull(x['valor_minimo']),
          valorMaximo: numOuNull(x['valor_maximo']),
          ativo: bool(x['ativo']),
          versao: num(x['versao']),
        })),
        triagens: triagens.map((t) => {
          const j = json(t['criterios_atendidos']) as { atendidos?: unknown[]; aConferir?: unknown[] } | null;
          return {
            id: num(t['id']),
            paciente: num(t['paciente_id']),
            nome: txtOuNull(t['paciente']),
            modo: String(t['modo_geracao']),
            processadoEm: instante(t['processado_em']),
            atendidos: (j?.atendidos ?? []) as { criterio: number; valor: string }[],
            aConferir: (j?.aConferir ?? []) as number[],
            situacao: String(t['situacao']),
            avaliadoEm: instante(t['avaliado_em']),
            observacao: txtOuNull(t['observacao']),
            versao: num(t['versao']),
          };
        }),
        participantes: participantes.map((x) => ({
          id: num(x['id']),
          paciente: num(x['paciente_id']),
          nome: txtOuNull(x['paciente']),
          codigo: txtOuNull(x['codigo_participante']),
          braco: txtOuNull(x['braco']),
          situacao: String(x['situacao']) as SituacaoParticipante,
          consentimentoEm: instante(x['consentimento_em']),
          incluidoEm: instante(x['incluido_em']),
          inicioTratamento: dia(x['inicio_tratamento']),
          fimTratamento: dia(x['fim_tratamento']),
          saidaEm: instante(x['saida_em']),
          motivoSaida: txtOuNull(x['motivo_saida']),
          ultimaVisita: instante(x['ultima_visita']),
          versao: num(x['versao']),
        })),
      };
    });
  }

  /** Profissionais (investigador, equipe e avaliador) pela busca. */
  profissionais(c: ContextoPortaPropria, termo: string) {
    return this.ler(c, 'profissionais', async (l) => {
      const t = `%${termo.trim()}%`;
      const r = (await l.consultar(
        `SELECT pr.id, pf.nome FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
          WHERE pr.excluido_em IS NULL AND pf.nome LIKE ? ORDER BY pf.nome LIMIT 30`,
        [t],
      )) as Linha[];
      return r.map((x) => ({ id: num(x['id']), nome: String(x['nome']) }));
    });
  }

  /** Pacientes com atendimento no estabelecimento, pela busca (indicação manual à triagem). */
  pacientes(c: ContextoPortaPropria, termo: string) {
    return this.ler(c, 'pacientes', async (l, est) => {
      const r = (await l.consultar(
        `SELECT pa.id, pf.nome, pa.numero_prontuario FROM paciente pa JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
          WHERE pa.excluido_em IS NULL AND pf.nome LIKE ?
            AND EXISTS (SELECT 1 FROM atendimento a WHERE a.paciente_id = pa.id AND a.estabelecimento_id = ?)
          ORDER BY pf.nome LIMIT 30`,
        [`%${termo.trim()}%`, est.id],
      )) as Linha[];
      return r.map((x) => ({
        id: num(x['id']),
        nome: String(x['nome']),
        prontuario: num(x['numero_prontuario']),
      }));
    });
  }

  /** Anexos do prontuário do paciente (o TCLE assinado é anexado no prontuário e indicado na inclusão). */
  anexos(c: ContextoPortaPropria, paciente: number) {
    return this.ler(c, 'anexos', async (l) => {
      const r = (await l.consultar(
        `SELECT id, titulo, criado_em FROM anexo_prontuario
          WHERE paciente_id = ? AND excluido_em IS NULL AND suspenso_em IS NULL ORDER BY id DESC LIMIT 50`,
        [paciente],
      )) as Linha[];
      return r.map((x) => ({ id: num(x['id']), nome: txtOuNull(x['titulo']), em: instante(x['criado_em']) }));
    });
  }

  async cadastrarEstudo(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaEstudo, entrada);
    recusa('Estudo recusado', conferirEstudo({ ...e, aprovacaoEticaEm: null }, 'em_aprovacao'));
    return this.gravar(
      c,
      'pep.pesquisa.estudo',
      ['pesquisa_clinica', 'pesquisa_clinica_equipe'],
      async (tx, est) => {
        await this.existe(tx, 'profissional', e.investigador, 'Investigador');
        if (
          await tx.uma('SELECT id FROM pesquisa_clinica WHERE estabelecimento_id = ? AND codigo = ?', [
            est.id,
            e.codigo,
          ])
        )
          throw recusaRegra('Estudo recusado', [
            { campo: 'codigo', mensagem: 'Já há estudo com este código.' },
          ]);
        const estudo = await tx.incluir('pesquisa_clinica', {
          estabelecimento_id: est.id,
          codigo: e.codigo,
          titulo: e.titulo,
          titulo_resumido: e.tituloResumido,
          numero_caae: e.numeroCaae,
          registro_ensaio: e.registroEnsaio,
          fase: e.fase,
          inicio: e.inicio,
          fim: e.fim,
          investigador_principal_profissional_id: e.investigador,
          situacao: 'em_aprovacao',
          dias_processamento_criterios: e.diasProcessamento,
          observacao: e.observacao,
        });
        await tx.incluir('pesquisa_clinica_equipe', {
          pesquisa_clinica_id: estudo,
          profissional_id: e.investigador,
          papel: 'investigador_principal',
          inicio: e.inicio,
        });
        return { tabela: 'pesquisa_clinica', id: estudo, estudo };
      },
    );
  }

  async mudarSituacao(c: ContextoPortaPropria, estudo: number, entrada: unknown) {
    const e = entradaValida(esquemaSituacao, entrada);
    return this.gravar(c, 'pep.pesquisa.situacao', ['pesquisa_clinica'], async (tx, est) => {
      const p = await this.estudoDoEst(tx, est.id, estudo);
      const de = String(p['situacao']) as SituacaoEstudo;
      const caae = e.numeroCaae ?? txtOuNull(p['numero_caae']);
      const aprov = e.aprovacaoEticaEm ?? dia(p['aprovacao_etica_em']);
      recusa('Situação recusada', [
        ...conferirTransicaoEstudo(de, e.situacao),
        ...conferirEstudo(
          {
            codigo: String(p['codigo']),
            titulo: String(p['titulo']),
            inicio: dia(p['inicio']) ?? '',
            fim: dia(p['fim']),
            numeroCaae: caae,
            aprovacaoEticaEm: aprov,
          },
          e.situacao,
        ),
      ]);
      await tx.alterar('pesquisa_clinica', estudo, e.versao, {
        situacao: e.situacao,
        numero_caae: caae,
        aprovacao_etica_em: aprov,
        aprovado_comite: e.aprovadoComite || bool(p['aprovado_comite']),
        aprovado_diretoria: e.aprovadoDiretoria || bool(p['aprovado_diretoria']),
      });
      return { tabela: 'pesquisa_clinica', id: estudo, situacao: e.situacao };
    });
  }

  async incluirMembro(c: ContextoPortaPropria, estudo: number, entrada: unknown) {
    const e = entradaValida(esquemaMembro, entrada);
    return this.gravar(c, 'pep.pesquisa.equipe', ['pesquisa_clinica_equipe'], async (tx, est) => {
      await this.estudoDoEst(tx, est.id, estudo);
      await this.existe(tx, 'profissional', e.profissional, 'Profissional');
      const dup = await tx.uma(
        `SELECT id FROM pesquisa_clinica_equipe WHERE pesquisa_clinica_id = ? AND profissional_id = ?
            AND excluido_em IS NULL AND fim IS NULL`,
        [estudo, e.profissional],
      );
      if (dup)
        throw recusaRegra('Membro recusado', [
          { campo: 'profissional', mensagem: 'O profissional já está na equipe do estudo.' },
        ]);
      const membro = await tx.incluir('pesquisa_clinica_equipe', {
        pesquisa_clinica_id: estudo,
        profissional_id: e.profissional,
        papel: e.papel,
        inicio: e.inicio,
      });
      return { tabela: 'pesquisa_clinica_equipe', id: membro, membro };
    });
  }

  async incluirCriterio(c: ContextoPortaPropria, estudo: number, entrada: unknown) {
    const e = entradaValida(esquemaCriterio, entrada);
    recusa('Critério recusado', conferirCriterio(e));
    return this.gravar(c, 'pep.pesquisa.criterio', ['pesquisa_clinica_criterio'], async (tx, est) => {
      await this.estudoDoEst(tx, est.id, estudo);
      if (e.exame !== null) await this.existe(tx, 'exame', e.exame, 'Exame');
      if (e.item !== null) await this.existe(tx, 'item_prescritivel', e.item, 'Item prescritível');
      if (
        e.parametroVital !== null &&
        !(await tx.uma('SELECT id FROM parametro_vital WHERE id = ?', [e.parametroVital]))
      )
        throw naoEncontrado('Parâmetro vital');
      const s = await tx.uma(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM pesquisa_clinica_criterio WHERE pesquisa_clinica_id = ?',
        [estudo],
      );
      const criterio = await tx.incluir('pesquisa_clinica_criterio', {
        pesquisa_clinica_id: estudo,
        sequencia: num(s?.['s'] ?? 1),
        tipo: e.tipo,
        grupo_logico: e.grupo,
        descricao: e.descricao,
        fonte_dado: e.fonte,
        item_prescritivel_id: e.item,
        exame_id: e.exame,
        parametro_vital_id: e.parametroVital,
        valor_texto: e.valorTexto,
        valor_minimo: e.valorMinimo,
        valor_maximo: e.valorMaximo,
      });
      return { tabela: 'pesquisa_clinica_criterio', id: criterio, criterio };
    });
  }

  async desativarCriterio(c: ContextoPortaPropria, estudo: number, criterio: number, entrada: unknown) {
    const e = entradaValida(esquemaVersao, entrada);
    return this.gravar(
      c,
      'pep.pesquisa.criterio.desativar',
      ['pesquisa_clinica_criterio'],
      async (tx, est) => {
        await this.estudoDoEst(tx, est.id, estudo);
        const x = await tx.uma(
          'SELECT id FROM pesquisa_clinica_criterio WHERE id = ? AND pesquisa_clinica_id = ?',
          [criterio, estudo],
        );
        if (!x) throw naoEncontrado('Critério');
        await tx.alterar('pesquisa_clinica_criterio', criterio, e.versao, { ativo: false });
        return { tabela: 'pesquisa_clinica_criterio', id: criterio };
      },
    );
  }

  /**
   * Triagem de elegibilidade: com `automatica`, todos os pacientes com atendimento no estabelecimento na janela do
   * estudo; sem, só os indicados. Grava um candidato por paciente sugerido; nunca inclui.
   */
  async triar(c: ContextoPortaPropria, estudo: number, entrada: unknown, automatica: boolean) {
    const e = entradaValida(esquemaTriar, entrada);
    if (!automatica && !e.pacientes.length)
      throw recusaRegra('Triagem recusada', [
        {
          campo: 'pacientes',
          mensagem:
            'A triagem automática está desligada neste estabelecimento: indique os pacientes a avaliar.',
        },
      ]);
    return this.gravar(c, 'pep.pesquisa.triagem', ['triagem_elegibilidade_pesquisa'], async (tx, est) => {
      const p = await this.estudoDoEst(tx, est.id, estudo);
      if (!estudoRecruta(String(p['situacao']) as SituacaoEstudo, bool(p['permite_inclusao_paciente'])))
        throw recusaRegra('Triagem recusada', [
          { campo: 'situacao', mensagem: 'Só o estudo que recruta recebe triagem de elegibilidade.' },
        ]);
      const criterios: CriterioAvaliavel[] = (
        (await tx.consultar(
          `SELECT id, tipo, grupo_logico, descricao, fonte_dado, exame_id, item_prescritivel_id, parametro_vital_id,
                  valor_texto, valor_minimo, valor_maximo
             FROM pesquisa_clinica_criterio WHERE pesquisa_clinica_id = ? AND ativo = TRUE AND excluido_em IS NULL`,
          [estudo],
        )) as Linha[]
      ).map((x) => ({
        id: num(x['id']),
        grupo: num(x['grupo_logico']),
        tipo: String(x['tipo']) as CriterioAvaliavel['tipo'],
        fonte: String(x['fonte_dado']) as CriterioAvaliavel['fonte'],
        descricao: String(x['descricao']),
        exame: numOuNull(x['exame_id']),
        item: numOuNull(x['item_prescritivel_id']),
        parametroVital: numOuNull(x['parametro_vital_id']),
        valorTexto: txtOuNull(x['valor_texto']),
        valorMinimo: numOuNull(x['valor_minimo']),
        valorMaximo: numOuNull(x['valor_maximo']),
      }));
      const janela = numOuNull(p['dias_processamento_criterios']) ?? JANELA_PADRAO_DIAS;
      const filtroPac = e.pacientes.length
        ? `AND a.paciente_id IN (${e.pacientes.map(() => '?').join(',')})`
        : '';
      const candidatos = (await tx.consultar(
        `SELECT a.paciente_id, MAX(a.id) AS atendimento, pf.data_nascimento, sx.sigla AS sexo
           FROM atendimento a
           JOIN paciente pa ON pa.id = a.paciente_id
           JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
           LEFT JOIN sexo sx ON sx.id = pf.sexo_id
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND pa.excluido_em IS NULL
            AND (a.saida_em IS NULL OR a.entrada_em >= DATE_SUB(NOW(3), INTERVAL ? DAY)) ${filtroPac}
            AND NOT EXISTS (SELECT 1 FROM participante_pesquisa x WHERE x.pesquisa_clinica_id = ? AND x.paciente_id = a.paciente_id)
            AND NOT EXISTS (SELECT 1 FROM triagem_elegibilidade_pesquisa t WHERE t.pesquisa_clinica_id = ?
                  AND t.paciente_id = a.paciente_id AND t.situacao IN ('identificado','em_avaliacao') AND t.excluido_em IS NULL)
          GROUP BY a.paciente_id, pf.data_nascimento, sx.sigla
          ORDER BY a.paciente_id LIMIT ${TETO_TRIAGEM}`,
        [est.id, janela, ...e.pacientes, estudo, estudo],
      )) as Linha[];
      const agora = new Date();
      const hoje = agora.toISOString().slice(0, 10);
      let sugeridos = 0;
      for (const cand of candidatos) {
        const paciente = num(cand['paciente_id']);
        const cids = (
          (await tx.consultar(
            `SELECT tt.codigo_termo FROM diagnostico_atendimento d JOIN termo_terminologia tt ON tt.id = d.cid_termo_terminologia_id
              WHERE d.paciente_id = ? AND d.estabelecimento_id = ? AND d.excluido_em IS NULL
             UNION SELECT tt.codigo_termo FROM atendimento a JOIN termo_terminologia tt ON tt.id = a.cid_principal_termo_terminologia_id
              WHERE a.paciente_id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
            [paciente, est.id, paciente, est.id],
          )) as Linha[]
        ).map((x) => String(x['codigo_termo']));
        const r = triarPaciente(criterios, {
          idadeAnos: idadeEmAnos(dia(cand['data_nascimento']), hoje),
          sexo: txtOuNull(cand['sexo']),
          cids,
        });
        if (!r.sugerido) continue;
        await tx.incluir('triagem_elegibilidade_pesquisa', {
          estabelecimento_id: est.id,
          pesquisa_clinica_id: estudo,
          paciente_id: paciente,
          atendimento_id: num(cand['atendimento']),
          processado_em: agora,
          modo_geracao: e.pacientes.length ? 'manual' : 'automatica',
          fase_criterio: 'entrada',
          criterios_atendidos: JSON.stringify({ atendidos: r.atendidos, aConferir: r.aConferir }),
          situacao: 'identificado',
        });
        sugeridos += 1;
      }
      return { tabela: 'pesquisa_clinica', id: estudo, avaliados: candidatos.length, sugeridos };
    });
  }

  /** Avaliação do candidato pela equipe; a inclusão cria o participante com o TCLE. */
  async avaliar(c: ContextoPortaPropria, triagem: number, entrada: unknown) {
    const e = entradaValida(esquemaAvaliar, entrada);
    if (e.decisao === 'incluido')
      recusa(
        'Inclusão recusada',
        conferirInclusao({ consentimentoEm: e.consentimentoEm, termoArquivo: e.anexo }),
      );
    return this.gravar(
      c,
      'pep.pesquisa.avaliacao',
      ['triagem_elegibilidade_pesquisa', 'participante_pesquisa', 'participante_pesquisa_evento'],
      async (tx, est, usuario) => {
        const t = (
          await tx.consultarParaAtualizar<Linha>(
            `SELECT t.id, t.pesquisa_clinica_id, t.paciente_id, t.situacao, p.situacao AS situacao_estudo,
                    p.permite_inclusao_paciente
               FROM triagem_elegibilidade_pesquisa t JOIN pesquisa_clinica p ON p.id = t.pesquisa_clinica_id
              WHERE t.id = ? AND t.estabelecimento_id = ? AND t.excluido_em IS NULL`,
            [triagem, est.id],
          )
        )[0];
        if (!t) throw naoEncontrado('Candidato da triagem');
        if (!['identificado', 'em_avaliacao'].includes(String(t['situacao'])))
          throw recusaRegra('Avaliação recusada', [
            { campo: 'decisao', mensagem: 'O candidato já foi avaliado.' },
          ]);
        if (e.avaliador !== null) await this.existe(tx, 'profissional', e.avaliador, 'Avaliador');
        const agora = new Date();
        let participante: number | null = null;
        if (e.decisao === 'incluido') {
          if (
            !estudoRecruta(
              String(t['situacao_estudo']) as SituacaoEstudo,
              bool(t['permite_inclusao_paciente']),
            )
          )
            throw recusaRegra('Inclusão recusada', [
              { campo: 'decisao', mensagem: 'Só o estudo que recruta inclui participantes.' },
            ]);
          const anexo = await tx.uma(
            'SELECT arquivo_id FROM anexo_prontuario WHERE id = ? AND paciente_id = ? AND excluido_em IS NULL AND suspenso_em IS NULL',
            [e.anexo, t['paciente_id']],
          );
          if (!anexo?.['arquivo_id'])
            throw recusaRegra('Inclusão recusada', [
              { campo: 'anexo', mensagem: 'O termo indicado não é anexo do prontuário deste paciente.' },
            ]);
          participante = await tx.incluir('participante_pesquisa', {
            pesquisa_clinica_id: num(t['pesquisa_clinica_id']),
            paciente_id: num(t['paciente_id']),
            codigo_participante: e.codigoParticipante,
            braco: e.braco,
            situacao: 'incluido',
            elegivel_em: agora,
            consentimento_em: `${e.consentimentoEm!.replace('T', ' ').slice(0, 16)}:00`,
            termo_consentimento_arquivo_id: num(anexo['arquivo_id']),
            incluido_em: agora,
            responsavel_profissional_id: e.avaliador,
            observacao: e.observacao,
          });
          await tx.incluir('participante_pesquisa_evento', {
            participante_pesquisa_id: participante,
            operacao: 'inclusao',
            evento: 'inclusao',
            situacao_nova: 'incluido',
            dados: JSON.stringify({ triagem }),
            ocorrido_em: agora,
            usuario_id: usuario,
          });
        }
        await tx.alterar('triagem_elegibilidade_pesquisa', triagem, e.versao, {
          situacao: e.decisao,
          participante_pesquisa_id: participante,
          avaliador_profissional_id: e.avaliador,
          avaliado_em: e.decisao === 'em_avaliacao' ? null : agora,
          observacao: e.observacao,
        });
        return { tabela: 'triagem_elegibilidade_pesquisa', id: triagem, participante };
      },
    );
  }

  /** Acompanhamento: mudança de situação do participante (tratamento, conclusão ou saída com motivo). */
  async mudarParticipante(c: ContextoPortaPropria, participante: number, entrada: unknown) {
    const e = entradaValida(esquemaMudanca, entrada);
    return this.gravar(
      c,
      'pep.pesquisa.participante',
      ['participante_pesquisa', 'participante_pesquisa_evento'],
      async (tx, est, usuario) => {
        const x = await this.participanteDoEst(tx, est.id, participante);
        const de = String(x['situacao']) as SituacaoParticipante;
        recusa('Mudança recusada', conferirMudancaParticipante(de, e.situacao, e.motivo));
        const inicio = e.inicioTratamento ?? dia(x['inicio_tratamento']);
        const fim = e.fimTratamento ?? dia(x['fim_tratamento']);
        if (inicio && fim && fim < inicio)
          throw recusaRegra('Mudança recusada', [
            { campo: 'fimTratamento', mensagem: 'O fim do tratamento não pode ser antes do início.' },
          ]);
        const agora = new Date();
        const saiu = participanteSaiu(e.situacao);
        await tx.alterar('participante_pesquisa', participante, e.versao, {
          situacao: e.situacao,
          inicio_tratamento: inicio,
          fim_tratamento: fim,
          ...(saiu || e.situacao === 'concluido' ? { saida_em: agora, motivo_saida: e.motivo } : {}),
        });
        await tx.incluir('participante_pesquisa_evento', {
          participante_pesquisa_id: participante,
          operacao: 'alteracao',
          evento: saiu ? 'saida' : e.situacao === 'recusou' ? 'recusa' : 'mudanca_situacao',
          situacao_anterior: de,
          situacao_nova: e.situacao,
          motivo: e.motivo,
          ocorrido_em: agora,
          usuario_id: usuario,
        });
        return { tabela: 'participante_pesquisa', id: participante, situacao: e.situacao };
      },
    );
  }

  /** Visita do participante ativo no estudo (acompanhamento). */
  async registrarVisita(c: ContextoPortaPropria, participante: number, entrada: unknown) {
    const e = entradaValida(esquemaVisita, entrada);
    return this.gravar(
      c,
      'pep.pesquisa.visita',
      ['participante_pesquisa', 'participante_pesquisa_evento'],
      async (tx, est, usuario) => {
        const x = await this.participanteDoEst(tx, est.id, participante);
        const s = String(x['situacao']) as SituacaoParticipante;
        if (!['incluido', 'em_tratamento', 'em_acompanhamento'].includes(s))
          throw recusaRegra('Visita recusada', [
            { campo: 'situacao', mensagem: 'Só o participante ativo no estudo recebe visita.' },
          ]);
        const evento = await tx.incluir('participante_pesquisa_evento', {
          participante_pesquisa_id: participante,
          operacao: 'inclusao',
          evento: 'visita',
          situacao_anterior: s,
          situacao_nova: s,
          motivo: e.observacao,
          ocorrido_em: `${e.ocorridoEm.replace('T', ' ').slice(0, 16)}:00`,
          usuario_id: usuario,
        });
        return { tabela: 'participante_pesquisa_evento', id: evento, evento };
      },
    );
  }

  private async existe(tx: TxOperacao, tabela: string, id: number, nome: string) {
    if (!(await tx.uma(`SELECT id FROM ${tabela} WHERE id = ? AND excluido_em IS NULL`, [id])))
      throw naoEncontrado(nome);
  }

  private async estudoDoEst(tx: TxOperacao, est: number, estudo: number): Promise<Linha> {
    const p = (
      await tx.consultarParaAtualizar<Linha>(
        'SELECT * FROM pesquisa_clinica WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [estudo, est],
      )
    )[0];
    if (!p) throw naoEncontrado('Estudo');
    return p;
  }

  private async participanteDoEst(tx: TxOperacao, est: number, participante: number): Promise<Linha> {
    const x = (
      await tx.consultarParaAtualizar<Linha>(
        `SELECT x.* FROM participante_pesquisa x JOIN pesquisa_clinica p ON p.id = x.pesquisa_clinica_id
          WHERE x.id = ? AND p.estabelecimento_id = ? AND x.excluido_em IS NULL`,
        [participante, est],
      )
    )[0];
    if (!x) throw naoEncontrado('Participante');
    return x;
  }
}
