// Porta da anestesia no bloco (M46.1: APA, ficha anestésica e SRPA) sobre o banco do cliente, pelo @sgh/nucleo: leituras
// somente leitura em avaliacao_pre_anestesica, ficha_anestesica (+ lancamento_ficha_anestesica, marco_ficha_anestesica),
// registro_recuperacao_anestesica (+ avaliacao_recuperacao_anestesica) e nos cadastros da ficha. Toda leitura filtra o
// estabelecimento da sessão (pelo agendamento ou pelo ato) e os registros excluídos; os cadastros são da rede inteira.
// Melhoria: a ficha e a SRPA ligam-se ao ato e ao agendamento do modelo, sem chave natural em texto; os marcos são linhas
// próprias (marco_ficha_anestesica), não colunas por marco.
// Pendência registrada (pedidos do lote 03-01, saida/03-01.json): as GRAVAÇÕES da APA, da ficha e da SRPA recusam com 409
// modelo-pendente — a ficha e o checklist exigem o ato cirúrgico (ato_cirurgico_id NOT NULL), que só nasce no registro;
// a APA não tem colunas para o jejum, os critérios de Lee e o plano estruturado; a ficha não tem passagem de
// responsabilidade, lacuna justificada nem adendo. A tela fica em consulta, com o motivo.
import { ErroOperacao, type Leitor, recusa } from '@sgh/nucleo';
import type { DestinoAltaSrpa, MarcoFicha, MomentoSrpa } from '@sgh/contratos';
import { type ContextoPortaM18, type LiberacaoGravacao, portaIndisponivel } from '../exames/public-api.js';
import {
  type GravadorAnestesia,
  METODOS_PORTA_ANESTESIA,
  type PortaAnestesia,
  type ProfissionalDaSessao,
} from './anestesia-porta.js';
import { civil, FUSO_PADRAO, instante, lista, n, nn, texto, textoOuNulo, verdadeiro } from './banco-apoio.js';
import { contextoDe, type NucleoCirurgia } from './porta-propria.js';
import { MARCO_FICHA, MARCOS_SEM_CONTRATO, PARTE_FICHA, SITUACAO_FICHA } from './vocabulario-banco.js';
import type {
  AvaliacaoPreAnestesica,
  AvaliacaoRecuperacao,
  ContextoAnestesia,
  DominiosFicha,
  FichaAnestesica,
  LancamentoDaFicha,
} from './tipos.js';

type Linha = Record<string, unknown>;
export const MOTIVO_ANESTESIA_PENDENTE =
  'As gravações da APA, da ficha anestésica e da SRPA no banco próprio aguardam o modelo (ficha ligada ao agendamento antes do ato, colunas do jejum, de Lee e do plano, passagem, lacuna e adendo da ficha): a tela fica em consulta.';

export class PortaAnestesiaPropria implements PortaAnestesia {
  readonly destino = 'banco' as const;
  constructor(private readonly nucleo: Pick<NucleoCirurgia, 'lerSomente'>) {}

  private ler<T>(c: ContextoPortaM18, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), async (l) => {
      const f = await l.uma<{ fuso_horario: string | null }>(
        'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
        [est],
      );
      return fn(l, est, f?.fuso_horario || FUSO_PADRAO);
    });
  }

  async podeGravar(): Promise<LiberacaoGravacao> {
    return { pode: false, codigo: 'modelo-pendente', motivo: MOTIVO_ANESTESIA_PENDENTE };
  }
  executar(_c: ContextoPortaM18, op: string): Promise<never> {
    return Promise.reject(
      recusa('operacao-desconhecida', `Operação ${op} sem gravação pelo Executor na anestesia.`),
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta; a gravação aguarda o modelo
  gravarSgh<T>(_c: ContextoPortaM18, _t: unknown, _fn: (g: GravadorAnestesia) => Promise<T>): Promise<T> {
    return Promise.reject(
      new ErroOperacao(409, 'modelo-pendente', 'Gravação aguardando o modelo', MOTIVO_ANESTESIA_PENDENTE),
    );
  }

  dominios(c: ContextoPortaM18): Promise<DominiosFicha> {
    // Cadastros da rede inteira (sem estabelecimento).
    return this.ler(c, async (l) => {
      const item = async (sql: string) =>
        (await l.consultar(sql)).map((x) => ({
          id: n(x['id']),
          rotulo: texto(x['descricao']),
          sigla: textoOuNulo(x['sigla']),
          ativo: verdadeiro(x['ativo']),
        }));
      return {
        tiposAnestesia: await item(
          'SELECT id, descricao, codigo AS sigla, ativo FROM tipo_anestesia ORDER BY descricao',
        ),
        posicoes: await item(
          'SELECT id, descricao, NULL AS sigla, ativo FROM posicao_cirurgica ORDER BY descricao',
        ),
        modosRespiratorios: await item(
          'SELECT id, descricao, sigla, ativo FROM modo_ventilatorio ORDER BY descricao',
        ),
        funcoesEquipe: await item(
          'SELECT id, descricao, codigo AS sigla, ativo FROM funcao_equipe_cirurgica ORDER BY ordem, descricao',
        ),
        tiposSinal: await item(
          'SELECT id, descricao, sigla, ativo FROM tipo_sinal_monitorado ORDER BY ordem_exibicao, descricao',
        ),
        // Utilização de material na ficha: o cadastro não existe no modelo (pedido do lote 03-01).
        utilizacoes: [],
      };
    });
  }

  contexto(c: ContextoPortaM18, agendamento: number): Promise<ContextoAnestesia | null> {
    return this.ler(c, async (l, est, fuso) => {
      const a = await l.uma(
        `SELECT a.id, a.atendimento_id, a.paciente_id, a.sala_cirurgica_id, a.inicio_previsto_em, a.tipo_anestesia_id,
                (SELECT ap.procedimento_cirurgico_id FROM agendamento_cirurgico_procedimento ap
                  WHERE ap.agendamento_cirurgico_id = a.id AND ap.principal = TRUE AND ap.excluido_em IS NULL LIMIT 1) AS procedimento,
                (SELECT e.profissional_id FROM agendamento_cirurgico_equipe e JOIN funcao_equipe_cirurgica f ON f.id = e.funcao_equipe_cirurgica_id
                  WHERE e.agendamento_cirurgico_id = a.id AND e.excluido_em IS NULL AND f.codigo = 'anestesista' LIMIT 1) AS anestesista,
                (SELECT v.peso_kg FROM avaliacao_pre_anestesica v WHERE v.agendamento_cirurgico_id = a.id AND v.excluido_em IS NULL ORDER BY v.avaliado_em DESC LIMIT 1) AS peso,
                (SELECT v.altura_cm FROM avaliacao_pre_anestesica v WHERE v.agendamento_cirurgico_id = a.id AND v.excluido_em IS NULL ORDER BY v.avaliado_em DESC LIMIT 1) AS altura
           FROM agendamento_cirurgico a WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
        [agendamento, est],
      );
      if (!a) return null;
      // Alergias, exames recentes e medicações vêm do prontuário (outra unidade): ficam vazios aqui, com pedido de porta.
      return {
        agendamento,
        reg: n(a['atendimento_id']),
        atendimento: nn(a['atendimento_id']),
        paciente: nn(a['paciente_id']),
        sala: n(a['sala_cirurgica_id']),
        inicio: civil(a['inicio_previsto_em'], fuso) ?? '',
        procedimento: n(a['procedimento']),
        tipoAnestesiaAgendado: nn(a['tipo_anestesia_id']),
        anestesistaAgendado: nn(a['anestesista']),
        alergias: [],
        pesoKg: nn(a['peso']),
        alturaCm: nn(a['altura']),
        creatinina: null,
        exames: [],
        examesTruncado: false,
        medicacoes: [],
        medicacoesTruncado: false,
      };
    });
  }

  profissional(c: ContextoPortaM18, login: string): Promise<ProfissionalDaSessao | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar(
        `SELECT v.profissional_id, COALESCE(pr.nome_exibicao, pf.nome) AS nome FROM usuario_vinculo_profissional v
           JOIN usuario u ON u.id = v.usuario_id
           JOIN profissional pr ON pr.id = v.profissional_id
           JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
          WHERE u.login = ? AND v.estabelecimento_id = ? AND v.excluido_em IS NULL AND pr.situacao = 'ativo'
            AND v.vigencia_inicio <= CURRENT_DATE AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)`,
        [login, est],
      );
      if (r.length === 0) return null;
      return { nome: textoOuNulo(r[0]?.['nome']), registros: r.map((x) => n(x['profissional_id'])) };
    });
  }

  apas(c: ContextoPortaM18, agendamento: number): Promise<AvaliacaoPreAnestesica[]> {
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `SELECT v.*, ca.classe, u.login FROM avaliacao_pre_anestesica v
             LEFT JOIN classificacao_asa ca ON ca.id = v.classificacao_asa_id
             LEFT JOIN usuario u ON u.id = v.criado_por
            WHERE v.agendamento_cirurgico_id = ? AND v.estabelecimento_id = ? AND v.excluido_em IS NULL
            ORDER BY v.avaliado_em DESC, v.id DESC`,
          [agendamento, est],
        )
      ).map((x) => ({
        id: n(x['id']),
        agendamento,
        versao: n(x['versao']),
        avaliadoEm: civil(x['avaliado_em'], fuso) ?? '',
        profissional: n(x['anestesista_profissional_id']),
        asa: n(x['classe']),
        emergencia: verdadeiro(x['asa_emergencia']),
        pesoKg: nn(x['peso_kg']),
        alturaCm: nn(x['altura_cm']),
        viaAerea: {
          mallampati: nn(x['mallampati']),
          aberturaBucalCm: nn(x['abertura_bucal_cm']),
          distanciaTireomentonianaCm: nn(x['distancia_tireomentoniana_cm']),
          mobilidadeCervicalReduzida: verdadeiro(x['mobilidade_cervical_reduzida']),
          historicoViaAereaDificil: verdadeiro(x['historico_via_aerea_dificil']),
          protesesOuDentesSoltos: verdadeiro(x['proteses_ou_dentes_soltos']),
        },
        jejum: {
          ultimaIngestaoEm: civil(x['ultima_ingestao_em'], fuso),
          tipo: textoOuNulo(x['tipo_ultima_ingestao']),
        },
        criteriosLee: [],
        leePontos: n(x['indice_lee']),
        alergiasConferidas: verdadeiro(x['alergias_conferidas']),
        comorbidades: null,
        medicacoes: null,
        exames: textoOuNulo(x['exames_avaliados']),
        anestesiasAnteriores: textoOuNulo(x['anestesias_anteriores']),
        plano: { texto: textoOuNulo(x['plano_anestesico']) },
        tipoAnestesia: n(x['tipo_anestesia_id']),
        conclusao: texto(x['conclusao']),
        ressalvas: textoOuNulo(x['observacao']),
        registroProntuario: null,
        usuario: texto(x['login']),
        criadoEm: civil(x['criado_em'], fuso) ?? '',
      })),
    );
  }

  private async fichaDe(
    l: Leitor,
    est: number,
    fuso: string,
    agendamento: number,
  ): Promise<FichaAnestesica | null> {
    const f = await l.uma(
      `SELECT f.*, t.sala_cirurgica_id, t.atendimento_id, t.paciente_id, t.entrada_sala_em, a.inicio_previsto_em
         FROM ficha_anestesica f JOIN ato_cirurgico t ON t.id = f.ato_cirurgico_id
         LEFT JOIN agendamento_cirurgico a ON a.id = t.agendamento_cirurgico_id
        WHERE t.agendamento_cirurgico_id = ? AND t.estabelecimento_id = ? AND f.excluido_em IS NULL AND t.excluido_em IS NULL
        ORDER BY f.id DESC LIMIT 1`,
      [agendamento, est],
    );
    if (!f) return null;
    const id = n(f['id']);
    const marcos: Partial<Record<MarcoFicha, string>> = {};
    for (const m of await l.consultar(
      'SELECT marco, momento FROM marco_ficha_anestesica WHERE ficha_anestesica_id = ? AND marco_vigente IS NOT NULL AND excluido_em IS NULL ORDER BY sequencia',
      [id],
    )) {
      const codigo = texto(m['marco']);
      if (MARCOS_SEM_CONTRATO.includes(codigo)) continue;
      marcos[MARCO_FICHA.doBanco(codigo)] = civil(m['momento'], fuso) ?? '';
    }
    const lancs = await l.consultar(
      `SELECT x.*, u.login FROM lancamento_ficha_anestesica x LEFT JOIN usuario u ON u.id = x.criado_por
        WHERE x.ficha_anestesica_id = ? AND x.excluido_em IS NULL ORDER BY x.momento_inicio, x.sequencia LIMIT 2001`,
      [id],
    );
    const lancamentos: LancamentoDaFicha[] = lancs.slice(0, 2000).map((x) => ({
      id: n(x['id']),
      parte: PARTE_FICHA.doBanco(texto(x['parte'])),
      momento: civil(x['momento_inicio'], fuso) ?? '',
      fim: civil(x['momento_fim'], fuso),
      dados: {
        tipo: nn(x['tipo_sinal_monitorado_id']),
        valor: nn(x['valor_numerico']),
        item: nn(x['insumo_id']),
        dose: nn(x['dose']),
        unidade: nn(x['unidade_medida_id']),
        via: nn(x['via_de_uso_id']),
        vazao: nn(x['vazao']),
        gas: textoOuNulo(x['gas']),
        fluido: textoOuNulo(x['fluido']),
        volumeMl: nn(x['volume_ml']),
        perda: textoOuNulo(x['perda']),
        evento: textoOuNulo(x['evento']),
        modo: nn(x['modo_ventilatorio_id']),
        posicao: nn(x['posicao_cirurgica_id']),
        funcao: nn(x['funcao_equipe_cirurgica_id']),
        descricao: textoOuNulo(x['descricao']),
        resultado: textoOuNulo(x['resultado']),
        quantidade: nn(x['quantidade']),
        observacao: textoOuNulo(x['observacao']),
      },
      profissional: nn(x['profissional_id']),
      usuario: texto(x['login']),
      registradoEm: civil(x['criado_em'], fuso) ?? '',
      balanco: null,
    }));
    return {
      id,
      agendamento,
      sala: n(f['sala_cirurgica_id']),
      dataHora: (civil(f['inicio_previsto_em'] ?? f['entrada_sala_em'], fuso) ?? '').replace(' ', 'T'),
      reg: n(f['atendimento_id']),
      paciente: nn(f['paciente_id']),
      situacao: SITUACAO_FICHA.doBanco(texto(f['situacao'])),
      versao: n(f['versao']),
      abertura: n(f['anestesista_profissional_id']),
      abertaEm: civil(f['criado_em'], fuso) ?? '',
      marcos,
      assinadaPor: f['assinada_em'] ? n(f['anestesista_profissional_id']) : null,
      assinadaUsuario: null,
      assinadaEm: civil(f['assinada_em'], fuso),
      hash: null,
      registroProntuario: null,
      lancamentos,
      passagens: [],
      lacunas: [],
      adendos: [],
      truncado: lancs.length > 2000,
    };
  }

  ficha(c: ContextoPortaM18, agendamento: number): Promise<FichaAnestesica | null> {
    return this.ler(c, (l, est, fuso) => this.fichaDe(l, est, fuso, agendamento));
  }

  private async series(l: Leitor, fuso: string, registros: Linha[]): Promise<AvaliacaoRecuperacao[][]> {
    if (registros.length === 0) return [];
    const ids = registros.map((r) => n(r['id']));
    const av = await l.consultar(
      `SELECT v.*, u.login FROM avaliacao_recuperacao_anestesica v LEFT JOIN usuario u ON u.id = v.criado_por
        WHERE v.registro_recuperacao_anestesica_id IN (${lista(ids.length)}) AND v.excluido_em IS NULL ORDER BY v.sequencia`,
      ids,
    );
    return registros.map((r) =>
      av
        .filter((v) => n(v['registro_recuperacao_anestesica_id']) === n(r['id']))
        .map((v) => ({
          id: n(v['id']),
          agendamento: n(r['agendamento_cirurgico_id']),
          sala: n(r['sala_cirurgica_id']),
          momento: texto(v['momento']) as MomentoSrpa,
          em: civil(v['avaliado_em'], fuso) ?? '',
          aldrete: {
            atividade: n(v['aldrete_atividade']),
            respiracao: n(v['aldrete_respiracao']),
            circulacao: n(v['aldrete_circulacao']),
            consciencia: n(v['aldrete_consciencia']),
            saturacao: n(v['aldrete_saturacao']),
          },
          total: n(v['escore_aldrete']),
          dor: n(v['dor']),
          nvpo: n(v['nausea_vomito']),
          destino:
            v['momento'] === 'alta' ? ((textoOuNulo(r['destino']) as DestinoAltaSrpa | null) ?? null) : null,
          regraVersao: null,
          profissional: nn(v['profissional_id']),
          usuario: texto(v['login']),
        })),
    );
  }

  private readonly SQL_SRPA = `SELECT r.id, r.agendamento_cirurgico_id, r.destino, a.sala_cirurgica_id FROM registro_recuperacao_anestesica r
      LEFT JOIN agendamento_cirurgico a ON a.id = r.agendamento_cirurgico_id
     WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND r.situacao <> 'cancelado'`;

  srpa(c: ContextoPortaM18, agendamento: number): Promise<AvaliacaoRecuperacao[]> {
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.consultar(
        `${this.SQL_SRPA} AND r.agendamento_cirurgico_id = ? ORDER BY r.id DESC LIMIT 1`,
        [est, agendamento],
      );
      return (await this.series(l, fuso, r))[0] ?? [];
    });
  }

  quadroSrpa(c: ContextoPortaM18, desde: string) {
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.consultar(
        `${this.SQL_SRPA} AND (r.situacao = 'em_recuperacao' OR r.entrada_em >= ?) ORDER BY r.entrada_em LIMIT 201`,
        [est, instante(desde, fuso)],
      );
      return { series: await this.series(l, fuso, r.slice(0, 200)), truncado: r.length > 200 };
    });
  }

  async situacoes(c: ContextoPortaM18, agendamentos: readonly number[]) {
    const m = new Map<number, { apa: string | null; ficha: string | null; srpa: string | null }>();
    if (agendamentos.length === 0) return m;
    const r = await this.ler(c, (l, est) =>
      l.consultar(
        `SELECT a.id,
                (SELECT v.situacao FROM avaliacao_pre_anestesica v WHERE v.agendamento_cirurgico_id = a.id AND v.excluido_em IS NULL ORDER BY v.avaliado_em DESC LIMIT 1) AS apa,
                (SELECT f.situacao FROM ficha_anestesica f JOIN ato_cirurgico t ON t.id = f.ato_cirurgico_id
                  WHERE t.agendamento_cirurgico_id = a.id AND f.excluido_em IS NULL ORDER BY f.id DESC LIMIT 1) AS ficha,
                (SELECT s.situacao FROM registro_recuperacao_anestesica s WHERE s.agendamento_cirurgico_id = a.id AND s.excluido_em IS NULL ORDER BY s.id DESC LIMIT 1) AS srpa
           FROM agendamento_cirurgico a WHERE a.estabelecimento_id = ? AND a.id IN (${lista(agendamentos.length)})`,
        [est, ...agendamentos],
      ),
    );
    for (const x of r)
      m.set(n(x['id']), {
        apa: textoOuNulo(x['apa']),
        ficha: textoOuNulo(x['ficha']),
        srpa: textoOuNulo(x['srpa']),
      });
    return m;
  }
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaAnestesiaIndisponivel(): PortaAnestesia {
  return portaIndisponivel<PortaAnestesia>(METODOS_PORTA_ANESTESIA);
}
