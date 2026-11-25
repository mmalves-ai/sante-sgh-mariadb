// Porta da gestão de pessoas sobre o banco do cliente (M52.1), pelo @sgh/nucleo: leituras somente leitura em
// colaborador, vinculo_trabalho, dependente, historico_cargo, inscricao_conselho, centro_custo, unidade_assistencial,
// tipo_rescisao, cargo, profissional e usuario; gravações diretas (`gravarSgh`) numa transação com a linha da trilha
// junto, e o bloqueio da conta no desligamento pelo Executor (trilha, saída e idempotência na mesma transação).
// Toda leitura filtra o estabelecimento da sessão e os registros excluídos; tipo de rescisão, cargo do quadro e
// conselho são catálogos da rede inteira (sem estabelecimento).
// Melhoria: o cargo do vínculo é sempre o do quadro de cargos (chave estrangeira), mudado só por `ligarCargo`; a
// matrícula é obrigatória; o retrato da validade do conselho é calculado na hora sobre as inscrições (não há cópia
// diária); as correções vão à trilha de auditoria com o valor anterior e o novo; o bloqueio da conta grava a linha do
// tempo da situação (usuario_situacao_historico).
// Melhoria: historico_cargo guarda só o que muda cargo ou função (fecha a linha anterior com data_fim e abre a nova
// com a vigência informada); lotação, jornada, desligamento e correções vão à trilha como eventos do vínculo, e a
// jornada também à vigencia_regime_colaborador. O piso da vigência (`ultimaVigencia`) só considera cargo, função,
// jornada e lotação, nunca correção. A mudança contratual confere cargo, função e regime de jornada nos catálogos.
// Melhoria: o colaborador e a conta são da rede; os vínculos da pessoa (`vinculosDaPessoa`) são lidos na rede inteira
// para o desligamento num estabelecimento não bloquear a conta de quem continua ativo em outro (o bloqueio também
// recusa, no Executor, a conta de quem tem vínculo ativo em outro estabelecimento).
// Melhoria: a conferência da habilitação trava pela versão lida na tela (quando vem) e guarda a observação na trilha.
// fecho-1: o dependente novo grava o tipo de dependente do eSocial (tabela 07) pelo parentesco da tela (o mesmo código),
// com a sequência por colaborador, o CPF como o do titular e a dependência a partir do dia da inclusão.
// C1-111: a admissão pela ficha rápida grava colaborador (ou reusa o do CPF na rede), vínculo e a linha inicial do
// histórico de cargo, com a ficha conferida no domínio (nascimento, sexo, grau de instrução, categoria, tipo de vínculo
// e salário); a alteração do dependente fecha a versão em vigor na véspera e abre a nova ligada a ela, com o tipo da
// tabela 07 do eSocial vigente na data. Pendências de modelo: as unidades onde o registro atende; e o índice
// do CPF por HMAC (até lá a busca por CPF compara o HMAC dos colaboradores do estabelecimento).
import {
  alterarAuditado,
  type ContextoOperacao,
  definirOperacao,
  type Escritor,
  type Executor,
  gravarTrilha,
  type Leitor,
  type NucleoProprio,
  recusa,
  restricaoUnicaViolada,
} from '@sgh/nucleo';
import { PARENTESCOS_DEPENDENTE } from '@sgh/contratos';
import { conferirFichaAdmissao } from '@sgh/dominio-pessoas';
import { z } from 'zod';
import {
  type GravacaoFeita,
  type LiberacaoGravacao,
  portaIndisponivel,
  type TrilhaDaGravacao,
} from '../exames/public-api.js';
import {
  carimboDe,
  type CifraDoCpf,
  contextoDe,
  correcoesDaTrilha,
  dataIso,
  desatualizado,
  exigirEstabelecimento,
  fusoDoEstabelecimento,
  instante,
  type Linha,
  localNoFuso,
  marcadores,
  n,
  nn,
  registrarCorrecaoNaTrilha,
  saidaIntegracao,
  texto,
  textoOuNulo,
  verdadeiro,
} from './banco-apoio.js';
import {
  type CargoQuadroLido,
  type CentroCustoPessoas,
  type ContextoPessoas,
  type GravadorPessoas,
  METODOS_PORTA_PESSOAS,
  type OpcaoCodigo,
  type PortaPessoas,
  type RegistroConselhoBase,
} from './porta.js';
import type {
  CatalogosAdmissao,
  DependenteColaborador,
  FiltroVinculos,
  HabilitacaoRegistro,
  HistoricoVinculo,
  PessoaPorCpf,
  ProfissionalCadastro,
  RegistroConselho,
  RegistroDoColaborador,
  RetratoConselhoDia,
  UnidadeDoRegistro,
  UsuarioDaPessoa,
  VinculoColaborador,
} from './tipos-pessoas.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoPessoas = Pick<NucleoProprio, 'lerSomente' | 'escrever' | 'criarExecutor'>;

/** Dias de antecedência do alerta de validade do conselho (o padrão da validade_conselho). */
const JANELA_CONSELHO_DIAS = 30;
const MOTIVOS_HISTORICO = new Set([
  'admissao',
  'promocao',
  'transferencia',
  'reenquadramento',
  'readaptacao',
  'funcao_confianca',
  'decisao_judicial',
  'correcao',
]);
const REGIMES_TRABALHISTAS = new Set(['clt', 'estatutario']);

const SQL_VINCULO_REDE = `
  SELECT vt.id, vt.estabelecimento_id, vt.colaborador_id, c.cpf, c.nome, c.profissional_id, c.usuario_id,
         vt.regime_trabalhista, vt.matricula, vt.cargo_id, cg.nome AS cargo, f.nome AS funcao,
         rj.carga_semanal_minutos, cg.carga_semanal_horas_padrao, vt.centro_custo_id,
         sf.unidade_assistencial_id, sf.nome AS setor, vt.data_admissao, vt.data_desligamento, vt.tipo_rescisao_id,
         vt.situacao, vt.observacao, vt.versao, vt.criado_em, uc.login AS criado_login, ua.login AS alterado_login
    FROM vinculo_trabalho vt
    JOIN colaborador c ON c.id = vt.colaborador_id
    JOIN cargo cg ON cg.id = vt.cargo_id
    LEFT JOIN funcao f ON f.id = vt.funcao_id AND f.excluido_em IS NULL
    LEFT JOIN regime_jornada rj ON rj.id = vt.regime_jornada_id
    LEFT JOIN setor_funcional sf ON sf.id = vt.setor_funcional_id AND sf.excluido_em IS NULL
    LEFT JOIN usuario uc ON uc.id = vt.criado_por
    LEFT JOIN usuario ua ON ua.id = vt.alterado_por
   WHERE vt.excluido_em IS NULL AND c.excluido_em IS NULL`;
const SQL_VINCULO = `${SQL_VINCULO_REDE} AND vt.estabelecimento_id = ?`;

/** Eventos do histórico que mudam cargo ou função (vão ao historico_cargo); os demais são eventos do vínculo na trilha. */
const EVENTOS_DE_CARGO = new Set([
  'cargo',
  'funcao',
  'admissao',
  'promocao',
  'transferencia',
  'reenquadramento',
  'readaptacao',
  'funcao_confianca',
  'decisao_judicial',
]);
/** Eventos do vínculo que servem de piso para a vigência de uma mudança nova (nunca a correção). */
const EVENTOS_COM_VIGENCIA = ['lotacao', 'jornada'];

/** A véspera de uma data ISO (fim da linha anterior do histórico). */
function vespera(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Uma linha única do catálogo pelo nome, ou a recusa (inexistente ou nome repetido). */
async function unicoPorNome(
  l: Leitor,
  sql: string,
  p: unknown[],
  oque: string,
  codigo: string,
): Promise<number> {
  const linhas = await l.consultar(sql, p);
  if (linhas.length === 0) throw recusa(`${codigo}-inexistente`, `${oque} inexistente ou inativo.`);
  if (linhas.length > 1)
    throw recusa(
      `${codigo}-ambiguo`,
      `Há mais de um registro ativo de ${oque.toLowerCase()} com este nome: corrija o catálogo.`,
    );
  return n(linhas[0]!['id']);
}

const SQL_USUARIO =
  'SELECT u.id, u.login, u.situacao, u.tipo_conta FROM usuario u WHERE u.excluido_em IS NULL';

function usuarioDe(r: Linha): UsuarioDaPessoa {
  const situacao = texto(r['situacao']);
  const tipo = texto(r['tipo_conta']);
  return {
    id: n(r['id']),
    login: texto(r['login']),
    bloqueado: situacao === 'bloqueado',
    ativo: situacao !== 'inativo',
    grupo: tipo && tipo !== 'pessoa' ? tipo : null,
  };
}

const numeroInscricao = (v: unknown) => (/^\d{1,15}$/.test(texto(v)) ? Number(v) : null);

/** O bloqueio da conta do colaborador desligado (o acesso deixa de entrar; a linha do tempo da situação junto). */
const OP_BLOQUEAR_USUARIO = definirOperacao({
  nome: 'pessoas.desligamento.bloquear-usuario',
  tabelas: ['usuario', 'usuario_situacao_historico'],
  entrada: z.object({ login: z.string().trim().min(1).max(60) }),
  async gravar(tx, e, ctx) {
    const [u] = await tx.consultarParaAtualizar<{ id: number; situacao: string; versao: number }>(
      'SELECT id, situacao, versao FROM usuario WHERE login = ? AND excluido_em IS NULL',
      [e.login],
    );
    if (!u) throw recusa('usuario-inexistente', 'Usuário inexistente.');
    const id = Number(u.id);
    if (ctx.usuario !== null && id === ctx.usuario)
      throw recusa('a-si-mesmo', 'Ninguém bloqueia nem desbloqueia a si mesmo.');
    if (u.situacao === 'bloqueado') throw recusa('ja-bloqueado', 'O usuário já está bloqueado.');
    // A conta é da rede: quem continua ativo em outro estabelecimento mantém o acesso (o desligamento é local).
    const outro = await tx.uma(
      `SELECT vt.id FROM colaborador c JOIN vinculo_trabalho vt ON vt.colaborador_id = c.id
        WHERE c.usuario_id = ? AND c.excluido_em IS NULL AND vt.excluido_em IS NULL AND vt.data_desligamento IS NULL
          AND NOT (vt.estabelecimento_id <=> ?) LIMIT 1`,
      [id, ctx.estabelecimento],
    );
    if (outro)
      throw recusa(
        'vinculo-ativo-em-outro-estabelecimento',
        'A pessoa continua ativa em outro estabelecimento da rede: a conta não é bloqueada.',
      );
    const agora = new Date();
    await tx.alterar('usuario', id, Number(u.versao), { situacao: 'bloqueado', bloqueado_em: agora });
    await tx.incluir('usuario_situacao_historico', {
      usuario_id: id,
      operacao: 'alteracao',
      situacao_anterior: u.situacao,
      situacao_nova: 'bloqueado',
      evento: 'bloqueio',
      motivo: 'Desligamento do colaborador',
      ocorrido_em: agora,
      responsavel_usuario_id: ctx.usuario,
    });
    return { idUsuario: id };
  },
  alvo: (_e, r) => ({ tabela: 'usuario', id: Number(r.idUsuario) }),
});

/** Operações do Executor que a porta conhece (nome da tela → operação do núcleo). */
const OPERACOES: Readonly<Record<string, typeof OP_BLOQUEAR_USUARIO>> = {
  'acesso.bloquearUsuario': OP_BLOQUEAR_USUARIO,
};

export class PortaPessoasPropria implements PortaPessoas {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoPessoas,
    private readonly cifra: CifraDoCpf,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPessoas, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    let est: number;
    try {
      est = exigirEstabelecimento(c);
    } catch (e) {
      return Promise.reject(e);
    }
    return this.nucleo.lerSomente(contextoDe(c), (l) => fn(l, est));
  }

  private vinculoDe(r: Linha): VinculoColaborador {
    const desligado = r['data_desligamento'] !== null && r['data_desligamento'] !== undefined;
    const minutos = nn(r['carga_semanal_minutos']);
    return {
      id: n(r['id']),
      estabelecimento: n(r['estabelecimento_id']),
      pessoa: n(r['colaborador_id']),
      cpfCifrado: this.cifra.cifrar(texto(r['cpf'])),
      nome: texto(r['nome']),
      profissional: nn(r['profissional_id']),
      usuario: nn(r['usuario_id']),
      tipo: texto(r['regime_trabalhista']),
      matricula: textoOuNulo(r['matricula']),
      cargo: texto(r['cargo']),
      idCargo: nn(r['cargo_id']),
      funcao: textoOuNulo(r['funcao']),
      cargaSemanal: minutos !== null ? Math.round(minutos / 60) : n(r['carga_semanal_horas_padrao']),
      centroCusto: nn(r['centro_custo_id']),
      unidade: nn(r['unidade_assistencial_id']),
      setor: textoOuNulo(r['setor']),
      admissao: dataIso(r['data_admissao']) ?? '',
      desligamento: dataIso(r['data_desligamento']),
      tipoRescisao: nn(r['tipo_rescisao_id']),
      motivoDesligamento: desligado ? textoOuNulo(r['observacao']) : null,
      desligadoPor: desligado ? textoOuNulo(r['alterado_login']) : null,
      versao: n(r['versao']),
      criadoPor: texto(r['criado_login']),
      criadoEm: (instante(r['criado_em']) ?? new Date(0)).toISOString().slice(0, 19),
    };
  }

  private async vinculos(
    l: Leitor,
    est: number,
    filtro = '',
    p: unknown[] = [],
  ): Promise<VinculoColaborador[]> {
    const linhas = await l.consultar(`${SQL_VINCULO}${filtro} ORDER BY vt.id`, [est, ...p]);
    return linhas.map((r) => this.vinculoDe(r));
  }

  /** Os vínculos do estabelecimento cujo CPF tem o HMAC pedido (o modelo guarda o CPF; pendência: índice por HMAC). */
  private async vinculosDoHmac(l: Leitor, est: number, hmac: string): Promise<VinculoColaborador[]> {
    const linhas = await l.consultar(`${SQL_VINCULO} ORDER BY vt.id`, [est]);
    return linhas.filter((r) => this.cifra.hmac(texto(r['cpf'])) === hmac).map((r) => this.vinculoDe(r));
  }

  // ── Gravação ────────────────────────────────────────────────────────────────────────────────────────────

  /** A liberação da funcionalidade é a chave do estabelecimento (ApoioGravacao); a porta não bloqueia mais nada. */
  async podeGravar(): Promise<LiberacaoGravacao> {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(
    c: ContextoPessoas,
    op: string,
    entrada: unknown,
    ctx: ContextoOperacao,
  ): Promise<GravacaoFeita> {
    const operacao = OPERACOES[op];
    if (!operacao) throw recusa('operacao-desconhecida', 'Operação fora da gestão de pessoas.');
    const r = await this.executor.executar(operacao, c.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha ?? null };
  }

  gravarSgh<T>(
    c: ContextoPessoas,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorPessoas) => Promise<T>,
  ): Promise<T> {
    let est: number;
    try {
      est = exigirEstabelecimento(c);
    } catch (e) {
      return Promise.reject(e);
    }
    return this.nucleo.escrever(contextoDe(c), async (e) => {
      const r = await fn(this.gravador(e, c, est));
      const t = typeof trilha === 'function' ? trilha(r) : trilha;
      await gravarTrilha(e, { ...t, ocorridoEm: t.ocorridoEm ?? new Date() });
      return r;
    });
  }

  private gravador(e: Escritor, c: ContextoPessoas, est: number): GravadorPessoas {
    const releitura = async (id: number) => {
      const [v] = await this.vinculos(e, est, ' AND vt.id = ?', [id]);
      return v ?? null;
    };
    const vigente = async (id: number, versao: number) => {
      const v = await releitura(id);
      if (!v || v.versao !== versao) throw desatualizado();
      return v;
    };
    type Evento = {
      vinculo: number;
      tipo: string;
      vigencia: string;
      antes: string | null;
      depois: string | null;
      motivo: string | null;
    };
    /** Evento do vínculo que não muda cargo nem função: só na trilha (com a vigência), nunca no histórico de cargo. */
    const eventoNaTrilha = (h: Evento) =>
      gravarTrilha(e, {
        estabelecimento: est,
        usuario: c.usuario,
        acao: 'alteracao',
        entidade: 'vinculo_trabalho',
        entidadeId: h.vinculo,
        dadosDepois: { evento: h.tipo, vigencia: h.vigencia, antes: h.antes, depois: h.depois },
        motivo: h.motivo?.slice(0, 500) ?? null,
        correlacao: c.correlacao,
        ocorridoEm: new Date(),
      });
    /** A linha aberta do histórico de cargo do vínculo (travada para a mudança). */
    const linhaAberta = async (vinculo: number) => {
      const [l] = await e.consultarParaAtualizar<{
        id: number;
        data_inicio: unknown;
        versao: number;
        dados: unknown;
      }>(
        `SELECT id, data_inicio, versao, dados FROM historico_cargo WHERE vinculo_trabalho_id = ? AND data_fim IS NULL
          ORDER BY data_inicio DESC, id DESC LIMIT 1`,
        [vinculo],
      );
      return l ?? null;
    };
    /** Mudança de cargo ou função: fecha a linha anterior na véspera da vigência e abre a nova com cargo e função atuais. */
    const linhaDeCargo = async (h: Evento): Promise<number> => {
      const atual = await e.uma<{ cargo_id: number; funcao_id: number | null }>(
        'SELECT cargo_id, funcao_id FROM vinculo_trabalho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [h.vinculo, est],
      );
      if (!atual) throw desatualizado();
      const dados = { tipo: h.tipo, antes: h.antes, depois: h.depois };
      const aberta = await linhaAberta(h.vinculo);
      const inicio = aberta ? dataIso(aberta.data_inicio) : null;
      if (aberta && inicio !== null && inicio > h.vigencia)
        throw recusa('vigencia-anterior', 'A vigência vem antes da última mudança de cargo registrada.');
      if (aberta && inicio === h.vigencia) {
        // Mesma vigência (cargo e função mudados juntos, ou acerto no mesmo dia): a linha do período é a mesma.
        await alterarAuditado(
          e,
          'historico_cargo',
          Number(aberta.id),
          Number(aberta.versao),
          {
            cargo_id: atual.cargo_id,
            funcao_id: atual.funcao_id,
            operacao: 'alteracao',
            dados: JSON.stringify(dados),
          },
          carimboDe(c),
        );
        return Number(aberta.id);
      }
      if (aberta)
        await alterarAuditado(
          e,
          'historico_cargo',
          Number(aberta.id),
          Number(aberta.versao),
          { data_fim: vespera(h.vigencia) },
          carimboDe(c),
        );
      const agora = new Date();
      return e.inserir(
        `INSERT INTO historico_cargo (vinculo_trabalho_id, cargo_id, funcao_id, data_inicio, motivo, descricao_motivo,
           operacao, dados, ocorrido_em, usuario_id, criado_em, criado_por, versao)
         VALUES (?, ?, ?, ?, ?, ?, 'inclusao', ?, ?, ?, ?, ?, 1)`,
        [
          h.vinculo,
          atual.cargo_id,
          atual.funcao_id,
          h.vigencia,
          // Pendência de contrato: a tela não manda o motivo do eSocial (promoção, reenquadramento...); fica "outro"
          // com o texto digitado até o contrato trazer o código.
          MOTIVOS_HISTORICO.has(h.tipo) ? h.tipo : 'outro',
          h.motivo?.slice(0, 500) ?? null,
          JSON.stringify(dados),
          agora,
          c.usuario,
          agora,
          c.usuario,
        ],
      );
    };
    /** Mudança de jornada: a vigência do regime do colaborador (fecha a anterior) e o evento na trilha. */
    const vigenciaDoRegime = async (h: Evento): Promise<number> => {
      const r = await e.uma<{ colaborador_id: number; regime_jornada_id: number | null }>(
        'SELECT colaborador_id, regime_jornada_id FROM vinculo_trabalho WHERE id = ? AND estabelecimento_id = ?',
        [h.vinculo, est],
      );
      if (!r) throw desatualizado();
      if (r.regime_jornada_id !== null) {
        const [ant] = await e.consultarParaAtualizar<{
          id: number;
          vigencia_inicio: unknown;
          versao: number;
        }>(
          `SELECT id, vigencia_inicio, versao FROM vigencia_regime_colaborador
            WHERE colaborador_id = ? AND vigencia_fim IS NULL ORDER BY vigencia_inicio DESC LIMIT 1`,
          [r.colaborador_id],
        );
        const inicio = ant ? dataIso(ant.vigencia_inicio) : null;
        const agora = new Date();
        if (ant && inicio === h.vigencia) {
          await alterarAuditado(
            e,
            'vigencia_regime_colaborador',
            Number(ant.id),
            Number(ant.versao),
            {
              regime_jornada_id: r.regime_jornada_id,
              operacao: 'alteracao',
              motivo: h.motivo?.slice(0, 500) ?? null,
            },
            carimboDe(c),
          );
        } else {
          if (ant && inicio !== null && inicio < h.vigencia)
            await alterarAuditado(
              e,
              'vigencia_regime_colaborador',
              Number(ant.id),
              Number(ant.versao),
              { vigencia_fim: vespera(h.vigencia) },
              carimboDe(c),
            );
          await e.inserir(
            `INSERT INTO vigencia_regime_colaborador (colaborador_id, regime_jornada_id, vigencia_inicio, motivo, operacao,
               ocorrido_em, usuario_id, criado_em, criado_por, versao) VALUES (?, ?, ?, ?, 'inclusao', ?, ?, ?, ?, 1)`,
            [
              r.colaborador_id,
              r.regime_jornada_id,
              h.vigencia,
              h.motivo?.slice(0, 500) ?? null,
              agora,
              c.usuario,
              agora,
              c.usuario,
            ],
          );
        }
      }
      return eventoNaTrilha(h);
    };
    const historico = (h: Evento): Promise<number> =>
      EVENTOS_DE_CARGO.has(h.tipo)
        ? linhaDeCargo(h)
        : h.tipo === 'jornada'
          ? vigenciaDoRegime(h)
          : eventoNaTrilha(h);
    return {
      vinculo: releitura,
      vinculosPorCpf: (h) => this.vinculosDoHmac(e, est, h),
      vinculosAtivosDoUsuario: async (u) =>
        (await this.vinculos(e, est, ' AND c.usuario_id = ? AND vt.data_desligamento IS NULL', [u])).map(
          (v) => ({
            id: v.id,
            pessoa: v.pessoa,
          }),
        ),
      ultimaVigencia: async (v) => {
        // Só cargo e função (historico_cargo, sem as linhas de correção) e os eventos de lotação e jornada da trilha.
        const cargo = await e.uma<{ d: unknown }>(
          `SELECT MAX(hc.data_inicio) AS d FROM historico_cargo hc
             JOIN vinculo_trabalho vt ON vt.id = hc.vinculo_trabalho_id
            WHERE hc.vinculo_trabalho_id = ? AND vt.estabelecimento_id = ? AND hc.motivo <> 'correcao'`,
          [v, est],
        );
        const evento = await e.uma<{ d: unknown }>(
          `SELECT MAX(JSON_VALUE(t.dados_depois, '$.vigencia')) AS d FROM trilha_auditoria t
            WHERE t.estabelecimento_id = ? AND t.entidade = 'vinculo_trabalho' AND t.entidade_id = ?
              AND JSON_VALUE(t.dados_depois, '$.evento') IN (${marcadores(EVENTOS_COM_VIGENCIA.length)})`,
          [est, v, ...EVENTOS_COM_VIGENCIA],
        );
        const datas = [dataIso(cargo?.d), dataIso(evento?.d)].filter((d): d is string => d !== null).sort();
        return datas.at(-1) ?? null;
      },
      incluirVinculo: async (v) => {
        // A ficha da admissão (regra do domínio) e o tipo de contrato que o modelo aceita.
        const ficha = conferirFichaAdmissao({
          nascimento: v.nascimento,
          admissao: v.admissao,
          grauInstrucao: v.grauInstrucao,
          salario: v.salario,
        });
        if (!ficha.ok) throw recusa(ficha.recusa, ficha.mensagem, { campos: [ficha.campo] });
        if (!REGIMES_TRABALHISTAS.has(v.tipo))
          throw recusa(
            'tipo-invalido',
            'O contrato de trabalho é CLT ou estatutário; residente, estagiário e prestador entram pelo cadastro próprio.',
            { campos: ['tipo'] },
          );
        if (!v.matricula)
          throw recusa('matricula-obrigatoria', 'Informe a matrícula do colaborador.', {
            campos: ['matricula'],
          });
        // Catálogos conferidos ativos e vigentes no dia da admissão (o id vem da lista da tela).
        const doCatalogo = async (
          achado: unknown,
          idc: number | null | undefined,
          campo: string,
          oque: string,
        ) => {
          if (!idc || !achado)
            throw recusa(`${campo}-inexistente`, `${oque}: escolha uma opção da lista.`, { campos: [campo] });
          return idc;
        };
        const sexo = await doCatalogo(
          v.sexo ? await e.uma('SELECT id FROM sexo WHERE id = ? AND ativo', [v.sexo]) : null,
          v.sexo,
          'sexo',
          'Sexo',
        );
        const categoria = await doCatalogo(
          v.categoria
            ? await e.uma(
                `SELECT id FROM categoria_trabalhador WHERE id = ?
                   AND (vigencia_inicio IS NULL OR vigencia_inicio <= ?) AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
                [v.categoria, v.admissao, v.admissao],
              )
            : null,
          v.categoria,
          'categoria',
          'Categoria do trabalhador',
        );
        const tipoVinculo = await doCatalogo(
          v.tipoVinculoTrabalho
            ? await e.uma(
                `SELECT id FROM tipo_vinculo_trabalho WHERE id = ? AND ativo
                   AND (vigencia_inicio IS NULL OR vigencia_inicio <= ?) AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
                [v.tipoVinculoTrabalho, v.admissao, v.admissao],
              )
            : null,
          v.tipoVinculoTrabalho,
          'tipoVinculoTrabalho',
          'Tipo de vínculo',
        );
        // Cargo do quadro (rede), função, regime de jornada, centro de custo e setor: as mesmas regras da mudança.
        const cargo = await unicoPorNome(
          e,
          'SELECT id FROM cargo WHERE nome = ? AND ativo AND excluido_em IS NULL',
          [v.cargo],
          'Cargo do quadro',
          'cargo',
        );
        const funcao =
          v.funcao === null
            ? null
            : await unicoPorNome(
                e,
                'SELECT id FROM funcao WHERE estabelecimento_id = ? AND nome = ? AND ativo AND excluido_em IS NULL',
                [est, v.funcao],
                'Função',
                'funcao',
              );
        const cg = await e.uma<{ p: number | null }>(
          'SELECT carga_semanal_horas_padrao AS p FROM cargo WHERE id = ?',
          [cargo],
        );
        let regime: number | null = null;
        if (cg?.p === null || cg?.p === undefined || Number(cg.p) !== v.cargaSemanal) {
          const regimes = await e.consultar(
            'SELECT id FROM regime_jornada WHERE carga_semanal_minutos = ? AND ativo',
            [v.cargaSemanal * 60],
          );
          if (regimes.length !== 1)
            throw recusa(
              'regime-de-jornada-indefinido',
              `Não há um regime de jornada único de ${v.cargaSemanal} h semanais: cadastre ou escolha o regime de jornada.`,
              { campos: ['cargaSemanalHoras'] },
            );
          regime = n(regimes[0]!['id']);
        }
        const cc = await e.uma(
          'SELECT id FROM centro_custo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND ativo',
          [v.centroCusto, est],
        );
        if (!cc) throw recusa('centro-de-custo-inexistente', 'Centro de custo inexistente ou inativo.');
        let setor: number | null = null;
        if (v.setor) {
          const porUnidade = v.unidade !== null ? ' AND unidade_assistencial_id = ?' : '';
          setor = await unicoPorNome(
            e,
            `SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND nome = ? AND excluido_em IS NULL AND ativo${porUnidade}`,
            v.unidade !== null ? [est, v.setor, v.unidade] : [est, v.setor],
            'Setor (nesta unidade)',
            'setor',
          );
        } else if (v.unidade !== null)
          throw recusa(
            'setor-obrigatorio',
            'A lotação numa unidade é pelo setor: escolha o setor da unidade.',
          );
        // A pessoa da rede: a do vínculo achado ou a do mesmo CPF (pode ter vínculo só em outro estabelecimento).
        const cpf = this.cifra.decifrar(v.cpfCifrado);
        if (!cpf || this.cifra.hmac(cpf) !== v.cpfHmac)
          throw recusa('cpf-ilegivel', 'O CPF não confere com a chave deste ambiente.', { campos: ['cpf'] });
        const agora = new Date();
        const [ja] = await e.consultarParaAtualizar<{
          id: number;
          profissional_id: number | null;
          usuario_id: number | null;
          versao: number;
        }>(
          'SELECT id, profissional_id, usuario_id, versao FROM colaborador WHERE cpf = ? AND excluido_em IS NULL',
          [cpf],
        );
        let pessoa: number;
        if (ja) {
          pessoa = Number(ja.id);
          // A conta e o profissional achados na prévia passam a apontar a pessoa (nunca troca um já ligado).
          const ligar: Record<string, unknown> = {};
          if (ja.profissional_id === null && v.profissional !== null)
            ligar['profissional_id'] = v.profissional;
          if (ja.usuario_id === null && v.usuario !== null) ligar['usuario_id'] = v.usuario;
          if (Object.keys(ligar).length)
            await alterarAuditado(e, 'colaborador', pessoa, Number(ja.versao), ligar, carimboDe(c));
        } else
          pessoa = await e.inserir(
            `INSERT INTO colaborador (nome, cpf, data_nascimento, sexo_id, grau_instrucao, profissional_id, usuario_id,
               origem, criado_em, criado_por, versao) VALUES (?, ?, ?, ?, ?, ?, ?, 'sistema', ?, ?, 1)`,
            [v.nome, cpf, v.nascimento, sexo, v.grauInstrucao, v.profissional, v.usuario, agora, c.usuario],
          );
        const id = await e
          .inserir(
            `INSERT INTO vinculo_trabalho (estabelecimento_id, colaborador_id, matricula, tipo_vinculo_trabalho_id,
               categoria_trabalhador_id, cargo_id, funcao_id, setor_funcional_id, centro_custo_id, regime_jornada_id,
               data_admissao, regime_trabalhista, salario_base, situacao, origem, criado_em, criado_por, versao)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ativo', 'sistema', ?, ?, 1)`,
            [
              est,
              pessoa,
              v.matricula,
              tipoVinculo,
              categoria,
              cargo,
              funcao,
              setor,
              v.centroCusto,
              regime,
              v.admissao,
              v.tipo,
              v.salario,
              agora,
              c.usuario,
            ],
          )
          .catch((x: unknown) => {
            const k = restricaoUnicaViolada(x);
            if (k === 'uq_vinculo_trabalho_matricula')
              throw recusa(
                'matricula-em-uso',
                'Já existe colaborador com esta matrícula neste estabelecimento.',
                {
                  campos: ['matricula'],
                },
              );
            if (k === 'uq_vinculo_trabalho_colaborador_admissao')
              throw recusa(
                'admissao-repetida',
                'Esta pessoa já tem vínculo admitido nesta data neste estabelecimento.',
                {
                  campos: ['admissao'],
                },
              );
            throw x;
          });
        // A linha inicial do histórico de cargo (motivo admissão), com a vigência da admissão.
        await historico({
          vinculo: id,
          tipo: 'admissao',
          vigencia: v.admissao,
          antes: null,
          depois: v.cargo,
          motivo: 'Admissão',
        });
        return { id, pessoa };
      },
      alterarVinculo: async (m) => {
        const v = await vigente(m.id, m.versao);
        if (v.desligamento !== null) throw desatualizado();
        const mudar: Record<string, unknown> = {};
        // Cargo do quadro (catálogo da rede), função e regime de jornada (catálogos) conferidos ativos; a linha do
        // histórico de cargo e a vigência do regime vêm depois, por `incluirHistorico`, com a vigência informada.
        let cargaPadrao: number | null = null;
        if (m.cargo !== v.cargo) {
          const id = await unicoPorNome(
            e,
            'SELECT id FROM cargo WHERE nome = ? AND ativo AND excluido_em IS NULL',
            [m.cargo],
            'Cargo do quadro',
            'cargo',
          );
          mudar['cargo_id'] = id;
          const cg = await e.uma<{ p: number | null }>(
            'SELECT carga_semanal_horas_padrao AS p FROM cargo WHERE id = ?',
            [id],
          );
          cargaPadrao = cg?.p === null || cg?.p === undefined ? null : Number(cg.p);
        }
        if (m.funcao !== v.funcao)
          mudar['funcao_id'] =
            m.funcao === null
              ? null
              : await unicoPorNome(
                  e,
                  'SELECT id FROM funcao WHERE estabelecimento_id = ? AND nome = ? AND ativo AND excluido_em IS NULL',
                  [est, m.funcao],
                  'Função',
                  'funcao',
                );
        const rj = await e.uma<{ m: number | null }>(
          `SELECT rj.carga_semanal_minutos AS m FROM vinculo_trabalho vt
             LEFT JOIN regime_jornada rj ON rj.id = vt.regime_jornada_id WHERE vt.id = ?`,
          [m.id],
        );
        const minutos = rj?.m === null || rj?.m === undefined ? null : Number(rj.m);
        const cargaEfetiva = minutos !== null ? Math.round(minutos / 60) : (cargaPadrao ?? v.cargaSemanal);
        if (m.cargaSemanal !== cargaEfetiva) {
          if (!Number.isInteger(m.cargaSemanal) || m.cargaSemanal < 1 || m.cargaSemanal > 72)
            throw recusa('carga-invalida', 'A carga semanal vai de 1 a 72 horas.');
          const regimes = await e.consultar(
            'SELECT id FROM regime_jornada WHERE carga_semanal_minutos = ? AND ativo',
            [m.cargaSemanal * 60],
          );
          if (regimes.length !== 1)
            throw recusa(
              'regime-de-jornada-indefinido',
              `Não há um regime de jornada único de ${m.cargaSemanal} h semanais: cadastre ou escolha o regime de jornada.`,
            );
          mudar['regime_jornada_id'] = n(regimes[0]!['id']);
        }
        const cc = await e.uma(
          'SELECT id FROM centro_custo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND ativo',
          [m.centroCusto, est],
        );
        if (!cc) throw recusa('centro-de-custo-inexistente', 'Centro de custo inexistente ou inativo.');
        let setor: number | null = null;
        if (m.setor) {
          const porUnidade = m.unidade !== null ? ' AND unidade_assistencial_id = ?' : '';
          setor = await unicoPorNome(
            e,
            `SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND nome = ? AND excluido_em IS NULL AND ativo${porUnidade}`,
            m.unidade !== null ? [est, m.setor, m.unidade] : [est, m.setor],
            'Setor (nesta unidade)',
            'setor',
          );
        } else if (m.unidade !== null)
          throw recusa(
            'setor-obrigatorio',
            'A lotação numa unidade é pelo setor: escolha o setor da unidade.',
          );
        await alterarAuditado(
          e,
          'vinculo_trabalho',
          m.id,
          m.versao,
          { ...mudar, centro_custo_id: m.centroCusto, setor_funcional_id: setor },
          carimboDe(c),
        );
      },
      desligarVinculo: async (d) => {
        const v = await vigente(d.id, d.versao);
        if (v.desligamento !== null) throw desatualizado();
        const tipo = await e.uma('SELECT id FROM tipo_rescisao WHERE id = ? AND ativo', [d.tipoRescisao]);
        if (!tipo) throw recusa('tipo-rescisao-inexistente', 'Tipo de rescisão inexistente ou inativo.');
        await alterarAuditado(
          e,
          'vinculo_trabalho',
          d.id,
          d.versao,
          {
            situacao: 'desligado',
            data_desligamento: d.data,
            tipo_rescisao_id: d.tipoRescisao,
            observacao: d.motivo.slice(0, 1000),
          },
          carimboDe(c),
        );
        await historico({
          vinculo: d.id,
          tipo: 'desligamento',
          vigencia: d.data,
          antes: 'ativo',
          depois: 'desligado',
          motivo: d.motivo,
        });
      },
      incluirHistorico: (h) => historico(h),
      incluirDependente: async (d) => {
        // O colaborador do vínculo do estabelecimento, travado: a sequência do dependente é por colaborador.
        const [col] = await e.consultarParaAtualizar<{ id: number }>(
          `SELECT c.id FROM vinculo_trabalho vt JOIN colaborador c ON c.id = vt.colaborador_id
            WHERE vt.id = ? AND vt.estabelecimento_id = ? AND c.excluido_em IS NULL`,
          [d.vinculo, est],
        );
        if (!col) throw desatualizado();
        const hoje = localNoFuso(new Date(), await fusoDoEstabelecimento(e, est)).slice(0, 10);
        const tipo = await tipoDependenteEsocial(e, d.parentesco, hoje);
        // O CPF chega cifrado (como o do titular) e vai ao modelo como o do colaborador; a leitura volta HMAC e cifra.
        const cpf = d.cpfCifrado ? this.cifra.decifrar(d.cpfCifrado) : null;
        if (d.cpfCifrado && !cpf)
          throw recusa('cpf-ilegivel', 'O CPF do dependente não decifra com a chave deste ambiente.');
        if (cpf && d.cpfHmac && this.cifra.hmac(cpf) !== d.cpfHmac)
          throw recusa('cpf-ilegivel', 'O CPF do dependente não confere com a chave de busca.');
        const seq = await e.uma<{ s: unknown }>(
          'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM dependente WHERE colaborador_id = ?',
          [col.id],
        );
        const agora = new Date();
        return e
          .inserir(
            `INSERT INTO dependente (colaborador_id, sequencia, nome, cpf, data_nascimento,
               tipo_dependente_codigo_esocial_id, descricao_dependencia, dependente_irrf, dependente_salario_familia,
               data_inicio_dependencia, origem, criado_em, criado_por, versao)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sistema', ?, ?, 1)`,
            [
              n(col.id),
              n(seq?.s),
              d.nome,
              cpf,
              d.nascimento,
              tipo,
              d.parentesco === PARENTESCO_OUTROS ? PARENTESCOS_DEPENDENTE[PARENTESCO_OUTROS] : null,
              d.dependenteIr,
              d.dependenteSalarioFamilia,
              // A dependência vale da inclusão (nunca antes do nascimento: CHECK do modelo).
              hoje < d.nascimento ? d.nascimento : hoje,
              agora,
              c.usuario,
            ],
          )
          .catch((x: unknown) => {
            if (restricaoUnicaViolada(x) === 'uq_dependente_colaborador_cpf_vigente')
              throw recusa('cpf-repetido', 'Este CPF já é de outro dependente deste colaborador.', {
                campos: ['cpf'],
              });
            throw x;
          });
      },
      encerrarDependente: async (d) => {
        const x = await e.uma<{ id: number; versao: number }>(
          `SELECT dp.id, dp.versao FROM dependente dp
             JOIN vinculo_trabalho vt ON vt.colaborador_id = dp.colaborador_id
            WHERE dp.id = ? AND vt.id = ? AND vt.estabelecimento_id = ? AND dp.excluido_em IS NULL
              AND dp.data_fim_dependencia IS NULL`,
          [d.id, d.vinculo, est],
        );
        if (!x) throw desatualizado();
        await alterarAuditado(
          e,
          'dependente',
          d.id,
          Number(x.versao),
          { data_fim_dependencia: d.ate },
          carimboDe(c),
        );
      },
      gravarHabilitacao: async (h) => {
        const [i] = await e.consultarParaAtualizar<{ id: number; versao: number }>(
          'SELECT id, versao FROM inscricao_conselho WHERE id = ? AND excluido_em IS NULL',
          [h.registro],
        );
        if (!i) throw recusa('registro-inexistente', 'Registro do conselho inexistente.');
        // Trava otimista pela versão que a tela leu (sem ela, a linha travada acima serializa as conferências).
        await alterarAuditado(
          e,
          'inscricao_conselho',
          h.registro,
          h.versao ?? Number(i.versao),
          { validade: h.validade, verificada_em: new Date(`${h.conferidoEm.slice(0, 10)}T12:00:00Z`) },
          carimboDe(c),
        );
        // A conferência (quem, quando, validade e observação) fica na trilha: o histórico das conferências.
        await gravarTrilha(e, {
          estabelecimento: est,
          usuario: c.usuario,
          acao: 'alteracao',
          entidade: 'inscricao_conselho',
          entidadeId: h.registro,
          dadosDepois: {
            conferencia: {
              validade: h.validade,
              conferidoEm: h.conferidoEm.slice(0, 10),
              observacao: h.observacao,
            },
          },
          motivo: 'Conferência da habilitação',
          correlacao: c.correlacao,
          ocorridoEm: new Date(),
        });
        return { id: h.registro };
      },
      corrigirVinculo: async (x) => {
        const v = await vigente(x.id, x.versao);
        if (!x.matricula) throw recusa('matricula-obrigatoria', 'Informe a matrícula do colaborador.');
        if (!REGIMES_TRABALHISTAS.has(x.tipo))
          throw recusa('tipo-invalido', 'O tipo do vínculo é CLT ou estatutário.');
        const outra = await e.uma(
          'SELECT id FROM vinculo_trabalho WHERE estabelecimento_id = ? AND matricula = ? AND id <> ? AND excluido_em IS NULL',
          [est, x.matricula, x.id],
        );
        if (outra)
          throw recusa('matricula-em-uso', 'Já existe colaborador com esta matrícula neste estabelecimento.');
        await alterarAuditado(
          e,
          'vinculo_trabalho',
          x.id,
          x.versao,
          { matricula: x.matricula, regime_trabalhista: x.tipo, data_admissao: x.admissao },
          carimboDe(c),
        );
        if (x.nome !== v.nome) {
          const col = await e.uma<{ versao: number }>('SELECT versao FROM colaborador WHERE id = ?', [
            v.pessoa,
          ]);
          await alterarAuditado(
            e,
            'colaborador',
            v.pessoa,
            Number(col?.versao ?? 0),
            { nome: x.nome },
            carimboDe(c),
          );
        }
      },
      cargoQuadro: (id) => this.lerCargo(e, id),
      ligarCargo: async (x) => {
        await vigente(x.id, x.versao);
        if (x.cargo === null)
          throw recusa('cargo-obrigatorio', 'O vínculo sempre tem um cargo do quadro: escolha outro cargo.');
        await alterarAuditado(e, 'vinculo_trabalho', x.id, x.versao, { cargo_id: x.cargo }, carimboDe(c));
        // Correção do cargo ligado (não é promoção): o período vigente do histórico passa a apontar o cargo certo; a
        // mudança com vigência e motivo é a de `alterarVinculo`. O valor anterior e o novo ficam na trilha.
        const aberta = await linhaAberta(x.id);
        if (aberta)
          await alterarAuditado(
            e,
            'historico_cargo',
            Number(aberta.id),
            Number(aberta.versao),
            { cargo_id: x.cargo, operacao: 'alteracao' },
            carimboDe(c),
          );
      },
      versionarDependente: async (d) => {
        // A versão em vigor, do colaborador do vínculo do estabelecimento, travada: fecha na véspera da alteração.
        const [x] = await e.consultarParaAtualizar<{
          id: number;
          colaborador_id: number;
          versao: number;
          data_inicio_dependencia: unknown;
        }>(
          `SELECT dp.id, dp.colaborador_id, dp.versao, dp.data_inicio_dependencia FROM dependente dp
             JOIN vinculo_trabalho vt ON vt.colaborador_id = dp.colaborador_id
            WHERE dp.id = ? AND vt.id = ? AND vt.estabelecimento_id = ? AND dp.excluido_em IS NULL
              AND dp.data_fim_dependencia IS NULL`,
          [d.anterior, d.vinculo, est],
        );
        if (!x) throw desatualizado();
        const inicio = dataIso(x.data_inicio_dependencia);
        if (inicio !== null && inicio >= d.desde)
          throw recusa(
            'desde-antes-da-versao',
            `A versão atual vale desde ${inicio}: a alteração precisa valer depois.`,
            {
              campos: ['desde'],
            },
          );
        // O tipo de dependente do eSocial (tabela 07) vigente na data da versão nova: o parentesco escolhido é o código.
        const tipo = await tipoDependenteEsocial(e, d.parentesco, d.desde);
        const cpf = d.cpfCifrado ? this.cifra.decifrar(d.cpfCifrado) : null;
        if (d.cpfCifrado && !cpf)
          throw recusa('cpf-ilegivel', 'O CPF do dependente não decifra com a chave deste ambiente.');
        if (cpf && d.cpfHmac && this.cifra.hmac(cpf) !== d.cpfHmac)
          throw recusa('cpf-ilegivel', 'O CPF do dependente não confere com a chave de busca.');
        await alterarAuditado(
          e,
          'dependente',
          Number(x.id),
          Number(x.versao),
          { data_fim_dependencia: vespera(d.desde) },
          carimboDe(c),
        );
        const seq = await e.uma<{ s: unknown }>(
          'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM dependente WHERE colaborador_id = ?',
          [x.colaborador_id],
        );
        const agora = new Date();
        return e
          .inserir(
            `INSERT INTO dependente (colaborador_id, dependente_anterior_id, sequencia, nome, cpf, data_nascimento,
               tipo_dependente_codigo_esocial_id, descricao_dependencia, dependente_irrf, dependente_salario_familia,
               data_inicio_dependencia, origem, criado_em, criado_por, versao)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sistema', ?, ?, 1)`,
            [
              n(x.colaborador_id),
              n(x.id),
              n(seq?.s),
              d.nome,
              cpf,
              d.nascimento,
              tipo,
              d.parentesco === PARENTESCO_OUTROS ? PARENTESCOS_DEPENDENTE[PARENTESCO_OUTROS] : null,
              d.dependenteIr,
              d.dependenteSalarioFamilia,
              d.desde,
              agora,
              c.usuario,
            ],
          )
          .catch((y: unknown) => {
            if (restricaoUnicaViolada(y) === 'uq_dependente_colaborador_cpf_vigente')
              throw recusa('cpf-repetido', 'Este CPF já é de outro dependente deste colaborador.', {
                campos: ['cpf'],
              });
            throw y;
          });
      },
      registrarCorrecao: async ({ vinculo, ...x }) => {
        if (!(await releitura(vinculo))) throw desatualizado();
        await registrarCorrecaoNaTrilha(e, c, { tabela: 'vinculo_trabalho', registro: vinculo, ...x });
      },
      outbox: (ev) => saidaIntegracao(e, c, ev),
    };
  }

  private async lerCargo(l: Leitor, id: number): Promise<CargoQuadroLido | null> {
    const r = await l.uma(
      `SELECT cg.id, cg.nome, o.codigo_cbo, cg.ativo FROM cargo cg JOIN ocupacao_cbo o ON o.id = cg.ocupacao_cbo_id
        WHERE cg.id = ? AND cg.excluido_em IS NULL`,
      [id],
    );
    return r
      ? { id: n(r['id']), nome: texto(r['nome']), cbo: texto(r['codigo_cbo']), ativo: verdadeiro(r['ativo']) }
      : null;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  hoje(c: ContextoPessoas): Promise<string> {
    return this.ler(c, async (l, est) =>
      localNoFuso(new Date(), await fusoDoEstabelecimento(l, est)).slice(0, 10),
    );
  }

  centrosDeCusto(c: ContextoPessoas): Promise<CentroCustoPessoas[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          'SELECT id, nome, ativo FROM centro_custo WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome, id',
          [est],
        )
      ).map((r) => ({ codigo: n(r['id']), nome: texto(r['nome']), ativo: verdadeiro(r['ativo']) })),
    );
  }

  unidades(c: ContextoPessoas): Promise<OpcaoCodigo[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          'SELECT id, nome FROM unidade_assistencial WHERE estabelecimento_id = ? AND excluido_em IS NULL AND ativo ORDER BY nome, id',
          [est],
        )
      ).map((r) => ({ codigo: n(r['id']), nome: texto(r['nome']) })),
    );
  }

  /** Catálogo da rede inteira (o tipo de rescisão não tem estabelecimento). */
  catalogosAdmissao(c: ContextoPessoas): Promise<CatalogosAdmissao> {
    return this.ler(c, async (l, est) => {
      const hoje = localNoFuso(new Date(), await fusoDoEstabelecimento(l, est)).slice(0, 10);
      const vigente =
        '(vigencia_inicio IS NULL OR vigencia_inicio <= ?) AND (vigencia_fim IS NULL OR vigencia_fim >= ?)';
      const opcoes = (rs: Linha[]) => rs.map((r) => ({ codigo: n(r['id']), nome: texto(r['nome']) }));
      return {
        sexos: opcoes(
          await l.consultar('SELECT id, descricao AS nome FROM sexo WHERE ativo ORDER BY descricao, id'),
        ),
        categorias: opcoes(
          await l.consultar(
            `SELECT id, CONCAT(codigo_esocial, ' - ', descricao) AS nome FROM categoria_trabalhador WHERE ${vigente}
              ORDER BY codigo_esocial, id`,
            [hoje, hoje],
          ),
        ),
        tiposVinculo: opcoes(
          await l.consultar(
            `SELECT id, descricao AS nome FROM tipo_vinculo_trabalho WHERE ativo AND ${vigente} ORDER BY codigo_cnes, id`,
            [hoje, hoje],
          ),
        ),
      };
    });
  }

  tiposRescisao(c: ContextoPessoas): Promise<OpcaoCodigo[]> {
    return this.ler(c, async (l) =>
      (await l.consultar('SELECT id, descricao FROM tipo_rescisao WHERE ativo ORDER BY descricao, id')).map(
        (r) => ({
          codigo: n(r['id']),
          nome: texto(r['descricao']),
        }),
      ),
    );
  }

  pessoaPorCpf(c: ContextoPessoas, cpf: number): Promise<PessoaPorCpf> {
    const d = String(cpf).padStart(11, '0');
    return this.ler(c, async (l) => {
      const profissionais = await l.consultar(
        `SELECT p.id, COALESCE(p.nome_exibicao, pf.nome) AS nome,
                (SELECT COUNT(*) FROM inscricao_conselho i WHERE i.profissional_id = p.id AND i.excluido_em IS NULL) AS registros
           FROM profissional p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE pf.cpf = ? AND p.excluido_em IS NULL AND pf.excluido_em IS NULL ORDER BY p.id`,
        [d],
      );
      const usuarios = await l.consultar(`${SQL_USUARIO} AND u.cpf = ? ORDER BY u.id`, [d]);
      return {
        profissionais: profissionais.map((r) => ({
          id: n(r['id']),
          nome: texto(r['nome']),
          registros: n(r['registros']),
        })),
        usuarios: usuarios.map(usuarioDe),
      };
    });
  }

  usuariosDoProfissional(c: ContextoPessoas, profissional: number): Promise<UsuarioDaPessoa[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `${SQL_USUARIO} AND u.id IN (SELECT uvp.usuario_id FROM usuario_vinculo_profissional uvp
              WHERE uvp.profissional_id = ? AND uvp.estabelecimento_id = ? AND uvp.excluido_em IS NULL
                AND (uvp.vigencia_fim IS NULL OR uvp.vigencia_fim >= CURRENT_DATE)) ORDER BY u.id`,
          [profissional, est],
        )
      ).map(usuarioDe),
    );
  }

  usuarioPorId(c: ContextoPessoas, id: number): Promise<UsuarioDaPessoa | null> {
    return this.ler(c, async (l) => {
      const r = await l.uma(`${SQL_USUARIO} AND u.id = ?`, [id]);
      return r ? usuarioDe(r) : null;
    });
  }

  profissionais(c: ContextoPessoas, ids: readonly number[]): Promise<ProfissionalCadastro[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l) => {
      const ps = await l.consultar(
        `SELECT p.id, COALESCE(p.nome_exibicao, pf.nome) AS nome, pf.nome_social, p.situacao
           FROM profissional p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE p.id IN (${marcadores(ids.length)}) AND p.excluido_em IS NULL ORDER BY p.id`,
        [...ids],
      );
      const regs = await this.registros(l, ' AND i.profissional_id IN (' + marcadores(ids.length) + ')', [
        ...ids,
      ]);
      return ps.map((r) => ({
        id: n(r['id']),
        nome: texto(r['nome']),
        nomeSocial: textoOuNulo(r['nome_social']),
        situacao: textoOuNulo(r['situacao']),
        registros: regs.filter((g) => g.profissional === n(r['id'])),
      }));
    });
  }

  private async registros(l: Leitor, filtro: string, p: unknown[]): Promise<RegistroConselho[]> {
    const linhas = await l.consultar(
      `SELECT i.id, i.profissional_id, cc.sigla, i.numero_inscricao, i.situacao, o.codigo_cbo, o.descricao AS cbo_descricao
         FROM inscricao_conselho i
         JOIN conselho_classe cc ON cc.id = i.conselho_classe_id
         LEFT JOIN ocupacao_cbo o ON o.id = i.ocupacao_cbo_id
        WHERE i.excluido_em IS NULL${filtro} ORDER BY i.profissional_id, i.sequencia`,
      p,
    );
    return linhas.map((r) => ({
      id: n(r['id']),
      profissional: n(r['profissional_id']),
      conselho: textoOuNulo(r['sigla']),
      sigla: textoOuNulo(r['sigla']),
      numero: numeroInscricao(r['numero_inscricao']),
      // Pendência: a UF da inscrição (unidade_federativa) entra quando a tela a pedir; hoje a ficha não a mostra.
      uf: null,
      cbo: textoOuNulo(r['codigo_cbo']),
      cboDescricao: textoOuNulo(r['cbo_descricao']),
      ativo: texto(r['situacao']) === 'ativa',
    }));
  }

  vinculosPorCpf(c: ContextoPessoas, cpfHmac: string): Promise<VinculoColaborador[]> {
    return this.ler(c, (l, est) => this.vinculosDoHmac(l, est, cpfHmac));
  }

  vinculo(c: ContextoPessoas, id: number): Promise<VinculoColaborador | null> {
    return this.ler(c, async (l, est) => (await this.vinculos(l, est, ' AND vt.id = ?', [id]))[0] ?? null);
  }

  /**
   * Os vínculos da pessoa na REDE inteira (exceção à regra do estabelecimento da sessão): colaborador e conta são da
   * rede, e o desligamento num estabelecimento só bloqueia a conta de quem não tem vínculo ativo em outro. Cada vínculo
   * traz o `estabelecimento` de onde é.
   */
  vinculosDaPessoa(c: ContextoPessoas, pessoa: number): Promise<VinculoColaborador[]> {
    return this.ler(c, async (l) =>
      (await l.consultar(`${SQL_VINCULO_REDE} AND vt.colaborador_id = ? ORDER BY vt.id`, [pessoa])).map((r) =>
        this.vinculoDe(r),
      ),
    );
  }

  listarVinculos(
    c: ContextoPessoas,
    f: FiltroVinculos,
  ): Promise<{ itens: VinculoColaborador[]; depois: number | null }> {
    return this.ler(c, async (l, est) => {
      const w: string[] = [];
      const p: unknown[] = [];
      if (f.estado === 'ativo') w.push('vt.data_desligamento IS NULL');
      if (f.estado === 'desligado') w.push('vt.data_desligamento IS NOT NULL');
      if (f.centroCusto !== undefined) {
        w.push('vt.centro_custo_id = ?');
        p.push(f.centroCusto);
      }
      if (f.unidade !== undefined) {
        w.push('sf.unidade_assistencial_id = ?');
        p.push(f.unidade);
      }
      if (f.setor?.trim()) {
        w.push('sf.nome LIKE ?');
        p.push(`%${f.setor.trim()}%`);
      }
      if (f.tipo) {
        w.push('vt.regime_trabalhista = ?');
        p.push(f.tipo);
      }
      const termo = f.cpfHmac ? undefined : f.termo?.trim();
      if (termo) {
        w.push('(c.nome LIKE ? OR vt.matricula = ?)');
        p.push(`%${termo}%`, termo);
      }
      if (f.depois !== undefined) {
        w.push('vt.id > ?');
        p.push(f.depois);
      }
      const filtro = w.length ? ` AND ${w.join(' AND ')}` : '';
      const limite = Math.max(1, Math.min(f.limite, 1000));
      let todos: VinculoColaborador[];
      if (f.cpfHmac) {
        const h = f.cpfHmac;
        const linhas = await l.consultar(`${SQL_VINCULO}${filtro} ORDER BY vt.id`, [est, ...p]);
        todos = linhas.filter((r) => this.cifra.hmac(texto(r['cpf'])) === h).map((r) => this.vinculoDe(r));
      } else {
        const linhas = await l.consultar(`${SQL_VINCULO}${filtro} ORDER BY vt.id LIMIT ?`, [
          est,
          ...p,
          limite + 1,
        ]);
        todos = linhas.map((r) => this.vinculoDe(r));
      }
      const itens = todos.slice(0, limite);
      return { itens, depois: todos.length > limite ? (itens.at(-1)?.id ?? null) : null };
    });
  }

  historico(c: ContextoPessoas, vinculo: number): Promise<HistoricoVinculo[]> {
    return this.ler(c, async (l, est) => {
      const fuso = await fusoDoEstabelecimento(l, est);
      const linhas = await l.consultar(
        `SELECT hc.id, hc.motivo, hc.descricao_motivo, hc.data_inicio, hc.dados, hc.ocorrido_em, cg.nome AS cargo, u.login
           FROM historico_cargo hc
           JOIN vinculo_trabalho vt ON vt.id = hc.vinculo_trabalho_id
           JOIN cargo cg ON cg.id = hc.cargo_id
           LEFT JOIN usuario u ON u.id = hc.usuario_id
          WHERE hc.vinculo_trabalho_id = ? AND vt.estabelecimento_id = ?
          ORDER BY hc.data_inicio DESC, hc.id DESC`,
        [vinculo, est],
      );
      const eventos = await l.consultar(
        `SELECT t.id, t.dados_depois, t.motivo, t.ocorrido_em, u.login FROM trilha_auditoria t
           LEFT JOIN usuario u ON u.id = t.usuario_id
          WHERE t.estabelecimento_id = ? AND t.entidade = 'vinculo_trabalho' AND t.entidade_id = ?
            AND JSON_VALUE(t.dados_depois, '$.evento') IS NOT NULL`,
        [est, vinculo],
      );
      const daTrilha: HistoricoVinculo[] = eventos.map((r) => {
        const d = (
          typeof r['dados_depois'] === 'string' ? JSON.parse(r['dados_depois']) : r['dados_depois']
        ) as Record<string, unknown>;
        return {
          id: n(r['id']),
          tipo: texto(d['evento']),
          vigencia: texto(d['vigencia']),
          antes: textoOuNulo(d['antes']),
          depois: textoOuNulo(d['depois']),
          motivo: textoOuNulo(r['motivo']),
          registradoPor: texto(r['login']),
          registradoEm: localNoFuso(instante(r['ocorrido_em']) ?? new Date(0), fuso),
        };
      });
      const doCargo: HistoricoVinculo[] = linhas.map((r) => {
        const bruto = r['dados'];
        let d: Record<string, unknown>;
        try {
          d = (typeof bruto === 'string' ? JSON.parse(bruto) : (bruto ?? {})) as Record<string, unknown>;
        } catch {
          d = {};
        }
        return {
          id: n(r['id']),
          tipo: texto(d['tipo'] ?? r['motivo']),
          vigencia: dataIso(r['data_inicio']) ?? '',
          antes: textoOuNulo(d['antes']),
          depois: d['depois'] === undefined ? texto(r['cargo']) : textoOuNulo(d['depois']),
          motivo: textoOuNulo(r['descricao_motivo']),
          registradoPor: texto(r['login']),
          registradoEm: localNoFuso(instante(r['ocorrido_em']) ?? new Date(0), fuso),
        };
      });
      return [...doCargo, ...daTrilha].sort(
        (a, b) => b.vigencia.localeCompare(a.vigencia) || b.registradoEm.localeCompare(a.registradoEm),
      );
    });
  }

  dependentes(c: ContextoPessoas, vinculo: number): Promise<DependenteColaborador[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT dp.id, dp.nome, dp.data_nascimento, dp.descricao_dependencia, dp.cpf, dp.dependente_irrf,
                  dp.dependente_salario_familia, dp.data_inicio_dependencia, ce.codigo_esocial AS parentesco
             FROM dependente dp JOIN vinculo_trabalho vt ON vt.colaborador_id = dp.colaborador_id
             LEFT JOIN codigo_esocial ce ON ce.id = dp.tipo_dependente_codigo_esocial_id
            WHERE vt.id = ? AND vt.estabelecimento_id = ? AND dp.excluido_em IS NULL AND dp.data_fim_dependencia IS NULL
            ORDER BY dp.sequencia, dp.id`,
          [vinculo, est],
        )
      ).map((r) => {
        const cpf = textoOuNulo(r['cpf']);
        return {
          id: n(r['id']),
          nome: texto(r['nome']),
          nascimento: dataIso(r['data_nascimento']) ?? '',
          parentesco: r['parentesco']
            ? texto(r['parentesco']).padStart(2, '0')
            : texto(r['descricao_dependencia']),
          cpfHmac: cpf ? this.cifra.hmac(cpf) : null,
          cpfCifrado: cpf ? this.cifra.cifrar(cpf) : null,
          dependenteIr: verdadeiro(r['dependente_irrf']),
          dependenteSalarioFamilia: verdadeiro(r['dependente_salario_familia']),
          desde: dataIso(r['data_inicio_dependencia']),
        };
      }),
    );
  }

  correcoes(c: ContextoPessoas, vinculo: number) {
    return this.ler(c, async (l, est) =>
      correcoesDaTrilha(l, est, 'vinculo_trabalho', [vinculo], await fusoDoEstabelecimento(l, est)),
    );
  }

  habilitacoes(c: ContextoPessoas, registros: readonly number[]): Promise<Map<number, HabilitacaoRegistro>> {
    if (registros.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l, est) => {
      const fuso = await fusoDoEstabelecimento(l, est);
      const linhas = await l.consultar(
        `SELECT i.id, i.numero_inscricao, cc.sigla, i.validade, i.verificada_em, i.versao, u.login,
                (SELECT JSON_VALUE(t.dados_depois, '$.conferencia.observacao') FROM trilha_auditoria t
                  WHERE t.entidade = 'inscricao_conselho' AND t.entidade_id = i.id AND t.estabelecimento_id = ?
                    AND JSON_EXISTS(t.dados_depois, '$.conferencia') ORDER BY t.id DESC LIMIT 1) AS observacao
           FROM inscricao_conselho i JOIN conselho_classe cc ON cc.id = i.conselho_classe_id
           LEFT JOIN usuario u ON u.id = i.alterado_por
          WHERE i.id IN (${marcadores(registros.length)}) AND i.excluido_em IS NULL AND i.verificada_em IS NOT NULL`,
        [est, ...registros],
      );
      return new Map(
        linhas.map((r) => [
          n(r['id']),
          {
            registro: n(r['id']),
            numero: numeroInscricao(r['numero_inscricao']),
            conselho: textoOuNulo(r['sigla']),
            validade: dataIso(r['validade']),
            conferidoEm: localNoFuso(instante(r['verificada_em']) ?? new Date(0), fuso).slice(0, 10),
            conferidoPor: texto(r['login']),
            observacao: textoOuNulo(r['observacao']),
            versao: n(r['versao']),
          },
        ]),
      );
    });
  }

  private async registrosAtivos(
    l: Leitor,
    est: number,
  ): Promise<(RegistroDoColaborador & { validade: string | null })[]> {
    const linhas = await l.consultar(
      `SELECT i.id, i.profissional_id, cc.sigla, i.numero_inscricao, i.situacao, i.validade, MIN(vt.id) AS vinculo,
              MIN(c.nome) AS nome
         FROM vinculo_trabalho vt
         JOIN colaborador c ON c.id = vt.colaborador_id
         JOIN inscricao_conselho i ON i.profissional_id = c.profissional_id
         JOIN conselho_classe cc ON cc.id = i.conselho_classe_id
        WHERE vt.estabelecimento_id = ? AND vt.data_desligamento IS NULL AND vt.excluido_em IS NULL
          AND c.excluido_em IS NULL AND i.excluido_em IS NULL
        GROUP BY i.id, i.profissional_id, cc.sigla, i.numero_inscricao, i.situacao, i.validade
        ORDER BY i.id`,
      [est],
    );
    return linhas.map((r) => ({
      registro: n(r['id']),
      profissional: n(r['profissional_id']),
      conselho: textoOuNulo(r['sigla']),
      numero: numeroInscricao(r['numero_inscricao']),
      ativo: texto(r['situacao']) === 'ativa',
      vinculo: n(r['vinculo']),
      nome: texto(r['nome']),
      validade: dataIso(r['validade']),
    }));
  }

  registrosDosColaboradoresAtivos(c: ContextoPessoas): Promise<RegistroDoColaborador[]> {
    return this.ler(c, async (l, est) =>
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- o campo é descartado de propósito
      (await this.registrosAtivos(l, est)).map(({ validade: _v, ...r }) => r),
    );
  }

  registroConselho(c: ContextoPessoas, registro: number): Promise<RegistroConselhoBase | null> {
    return this.ler(c, async (l) => {
      const [r] = await this.registros(l, ' AND i.id = ?', [registro]);
      return r
        ? { registro: r.id, profissional: r.profissional, numero: r.numero, conselho: r.conselho }
        : null;
    });
  }

  /**
   * Pendência de modelo (pedido do lote 03-09): onde cada registro atende (inscrição × unidade assistencial). Até lá o
   * mapa volta vazio e a ficha mostra "sem unidade informada".
   */
  unidadesDosRegistros(
    c: ContextoPessoas,
    registros: readonly number[],
  ): Promise<Map<number, UnidadeDoRegistro[]>> {
    void c;
    void registros;
    return Promise.resolve(new Map());
  }

  /** O retrato do dia calculado na hora sobre as inscrições dos colaboradores ativos (não há cópia diária). */
  ultimoRetrato(c: ContextoPessoas): Promise<RetratoConselhoDia | null> {
    return this.ler(c, async (l, est) => {
      const dia = localNoFuso(new Date(), await fusoDoEstabelecimento(l, est)).slice(0, 10);
      const limite = new Date(`${dia}T12:00:00Z`);
      limite.setUTCDate(limite.getUTCDate() + JANELA_CONSELHO_DIAS);
      const ate = limite.toISOString().slice(0, 10);
      const regs = await this.registrosAtivos(l, est);
      return {
        dia,
        janelaDias: JANELA_CONSELHO_DIAS,
        registros: regs.length,
        vencidos: regs.filter((r) => r.validade !== null && r.validade < dia).length,
        aVencer: regs.filter((r) => r.validade !== null && r.validade >= dia && r.validade <= ate).length,
        semValidade: regs.filter((r) => r.validade === null).length,
      };
    });
  }

  /** O cargo do quadro (catálogo da rede inteira). */
  cargoQuadro(c: ContextoPessoas, id: number): Promise<CargoQuadroLido | null> {
    return this.ler(c, (l) => this.lerCargo(l, id));
  }
}

export function portaPessoasIndisponivel(): PortaPessoas {
  return portaIndisponivel<PortaPessoas>(METODOS_PORTA_PESSOAS);
}

/** Agregado/outros: o único tipo do eSocial que leva a descrição da dependência. */
const PARENTESCO_OUTROS = '99';
/** Tabela 07 do eSocial (tipos de dependente), com e sem o zero à esquerda conforme a carga. */
const TABELA_TIPO_DEPENDENTE = ['07', '7'] as const;

/**
 * O parentesco da tela é o código do tipo de dependente do eSocial (tabela 07): o ID do catálogo oficial carregado no
 * cliente, vigente no dia. Sem o código no catálogo, recusa (nunca grava tipo inventado).
 */
async function tipoDependenteEsocial(l: Leitor, parentesco: string, dia: string): Promise<number> {
  const x = await l.uma<{ id: unknown }>(
    `SELECT c.id FROM codigo_esocial c JOIN tabela_esocial t ON t.id = c.tabela_esocial_id
      WHERE t.fonte = 'esocial' AND t.codigo_oficial IN (?, ?) AND c.codigo_esocial IN (?, ?)
        AND (c.vigencia_inicio IS NULL OR c.vigencia_inicio <= ?) AND (c.vigencia_fim IS NULL OR c.vigencia_fim >= ?)
      ORDER BY c.vigencia_inicio DESC, c.id DESC LIMIT 1`,
    [...TABELA_TIPO_DEPENDENTE, parentesco, String(Number(parentesco)), dia, dia],
  );
  if (!x)
    throw recusa(
      'catalogo-pendente',
      `O tipo de dependente ${parentesco} não está na tabela 07 do eSocial carregada neste cliente.`,
      { campos: ['parentesco'] },
    );
  return n(x.id);
}
