// Porta da portaria sobre o banco do cliente (M50, etapa 5), pelo @sgh/nucleo: leituras somente leitura e as gravações
// diretas numa operação do Executor (trilha, outbox e idempotência na mesma transação), nas tabelas do modelo:
// pessoa_portaria (o visitante; cadastro da rede inteira, sem estabelecimento), arquivo (o metadado da foto), visita e
// cracha_visitante, regra_visita_unidade, bloqueio_visitante (com motivo_bloqueio_visita), acompanhante_internacao,
// terminal_acesso (com ponto_acesso e modelo_terminal_acesso) e os domínios (tipo_visitante, tipo_visitado,
// forma_identificacao_visitante, situacao_acesso_visitante). Os internados vêm de internacao com a ocupação vigente do
// leito (ocupacao_leito) e o isolamento ativo (isolamento_paciente). Toda leitura filtra o estabelecimento da sessão e
// os registros excluídos; horários no fuso do estabelecimento (estabelecimento.fuso_horario), instantes no banco.
// Melhoria: a trava do paciente é a própria linha da internação (SELECT … FOR UPDATE), e a avaliação da visita é
// refeita na transação com o que foi relido; o crachá é uma etiqueta numerada do estabelecimento (cracha_visitante,
// única por número), devolvida na saída; a foto é um arquivo com hash e tamanho; o significado dos domínios vem do
// banco (identificação biométrica, destino "paciente"), não de códigos fixos.
// Melhoria: o motivo da revogação do bloqueio e do fim do acompanhamento vai à trilha da operação (motivo).
// Melhoria: o visitante bloqueado ou restrito no cadastro, ou com bloqueio da pessoa no estabelecimento, não entra;
// o bloqueio do paciente sem atendimento informado vale em qualquer internação dele.
// Melhoria: a visita a outro destino aponta o setor do estabelecimento quando o local é setor cadastrado; senão, o
// local vai a visita.local_destino (o banco exige um visitado).
// Melhoria: as gravações usam a Idempotency-Key do pedido: o reenvio devolve o mesmo resultado (visita "repetida").
// Melhoria: a regra guarda a idade mínima, a conduta no isolamento, a duração máxima e a observação; o bloqueio guarda
// o limite de visitantes (abrangência "limite" é o bloqueio do paciente com limite_visitantes), a inclusão do
// acompanhante e o documento da ordem judicial. A guarda do visitante vale por pessoa_portaria.guarda_ate (ou, sem ela,
// pela última visita mais o prazo padrão); o expurgo anonimiza o cadastro (anonimizada_em) e devolve as fotos a apagar.
// A passagem pela catraca grava evento_acesso_portaria, que se liga ao dispositivo de integração: o terminal da
// portaria (terminal_acesso) ainda não tem essa ligação no modelo (pedido em docs/obra/fatias/f24/saida/
// 24-misto-especialidades.json), e o registro da passagem recusa até lá, sem gravar nada.
import { RETENCAO_PADRAO_DIAS, type MotivoBloqueioVisita, type SentidoTerminal } from '@sgh/contratos';
import { regraDaUnidade, REGRA_PADRAO, type RegraVisita, validadeDoCracha } from '@sgh/dominio-internacao';
import {
  type ContextoNucleo,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  restricaoViolada,
  type TxOperacao,
  definirOperacao,
} from '@sgh/nucleo';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type ContextoPortaM18, portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import { civil, FUSO_PADRAO, instanteCivil, relogioNoFuso } from '../exames/relogio.js';
import { type ContextoPortaria, type GravadorPortaria, METODOS_PORTA_PORTARIA, type PortaPortaria } from './porta.js';
import {
  type AcompanhanteRegistrado,
  type BloqueioRelido,
  type BloqueioVisitaRegistrado,
  type DominiosDaPortaria,
  type InternadoPortaria,
  type RegraVisitaRegistrada,
  TETO_BUSCA_VISITANTE,
  TETO_INTERNADOS_PORTARIA,
  TETO_VISITAS_ABERTAS,
  TETO_VISITAS_PERIODO,
  type TerminalRegistrado,
  type VisitaRegistrada,
  type VisitanteRegistrado,
} from './tipos.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoPortaria = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const textoN = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
/** DATE do banco → "AAAA-MM-DD". */
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
const somarDias = (data: string, dias: number) =>
  new Date(Date.parse(`${data}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
const digitos = (t: string) => t.replace(/\D/g, '');

/** Instante do banco → "AAAA-MM-DDTHH:mm" no fuso do estabelecimento. */
function local(v: unknown, fuso: string): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  const c = civil(d, fuso);
  return `${c.data}T${c.hhmm.slice(0, 2)}:${c.hhmm.slice(2, 4)}`;
}
/** "AAAA-MM-DDTHH:mm" no fuso do estabelecimento → instante. */
const instante = (t: string, fuso: string): Date =>
  instanteCivil(t.slice(0, 10), `${t.slice(11, 13)}${t.slice(14, 16)}`, fuso);

const MOTIVOS: readonly MotivoBloqueioVisita[] = ['pedido', 'judicial', 'clinico', 'sigilo'];
/** Fundamento do acompanhante (contrato) ↔ direito legal (modelo). */
const DIREITO_DO_FUNDAMENTO = {
  idoso: 'idoso',
  crianca: 'crianca_adolescente',
  parto: 'gestante_parturiente',
  deficiencia: 'pessoa_com_deficiencia',
  autorizado: 'autorizacao_medica',
} as const;
const FUNDAMENTO_DO_DIREITO = Object.fromEntries(
  Object.entries(DIREITO_DO_FUNDAMENTO).map(([f, d]) => [d, f]),
) as Record<string, AcompanhanteRegistrado['fundamento']>;
/** Tipo do modelo de terminal → tipo do terminal instalado. */
const TIPO_TERMINAL: Readonly<Record<string, string>> = {
  catraca: 'catraca',
  cancela: 'cancela',
  totem: 'totem',
  leitor: 'leitor',
  porta: 'leitor',
  terminal: 'estacao',
};
/** Documento do visitante (contrato) → tipo de documento do acompanhante (modelo). */
const DOCUMENTO_ACOMPANHANTE: Readonly<Record<string, string>> = {
  cpf: 'cpf',
  rg: 'rg',
  passaporte: 'passaporte',
  cnh: 'outro',
  outro: 'outro',
};
const TIPOS_DOCUMENTO = ['cpf', 'rg', 'cnh', 'passaporte', 'outro'] as const;

/** Tabelas das gravações diretas da portaria. */
const TABELAS_GRAVACAO = [
  'pessoa_portaria',
  'arquivo',
  'visita',
  'cracha_visitante',
  'regra_visita_unidade',
  'bloqueio_visitante',
  'acompanhante_internacao',
  'terminal_acesso',
  'ponto_acesso',
] as const;

const modeloPendente = (o: string) =>
  new ErroOperacao(
    409,
    'modelo-pendente',
    'Recurso aguardando o modelo do banco',
    `${o} aguarda a coluna ou tabela no modelo do banco (pedido registrado): nada foi gravado.`,
  );

const SQL_LOCAL_INTERNACAO = `
    LEFT JOIN ocupacao_leito o ON o.internacao_vigente_id = i.id AND o.excluido_em IS NULL
    LEFT JOIN leito_hospitalar lh ON lh.id = COALESCE(o.leito_hospitalar_id, i.leito_hospitalar_id)
    LEFT JOIN acomodacao ac ON ac.id = COALESCE(o.acomodacao_id, lh.acomodacao_id, i.acomodacao_id)
    LEFT JOIN unidade_internacao ui ON ui.id = COALESCE(o.unidade_internacao_id, i.unidade_internacao_id)`;

const SQL_INTERNADOS = `
  SELECT i.id, i.paciente_id, pf.nome, pf.data_nascimento, ui.codigo AS unidade, ui.descricao AS unidade_nome,
         ac.codigo AS acomod, lh.codigo AS leito,
         EXISTS (SELECT 1 FROM isolamento_paciente ip
                  WHERE ip.paciente_id = i.paciente_id AND ip.estabelecimento_id = i.estabelecimento_id
                    AND ip.situacao = 'ativo' AND ip.data_hora_fim IS NULL AND ip.excluido_em IS NULL) AS isolamento
    FROM internacao i
    JOIN paciente p ON p.id = i.paciente_id
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    ${SQL_LOCAL_INTERNACAO}
   WHERE i.estabelecimento_id = ? AND i.situacao IN ('ativa', 'alta_medica') AND i.excluido_em IS NULL`;

// O visitante é da rede inteira (pessoa_portaria não tem estabelecimento): a mesma pessoa volta em qualquer unidade.
/** A guarda do cadastro venceu (parâmetro: o corte da guarda derivada, a data de hoje); sem visita aberta. */
const SQL_GUARDA_VENCIDA = `
  pp.excluido_em IS NULL AND pp.anonimizada_em IS NULL AND pp.situacao <> 'inativo'
  AND IF(pp.guarda_ate IS NULL,
         GREATEST(pp.criado_em, COALESCE((SELECT MAX(v.entrada_em) FROM visita v
               WHERE v.pessoa_portaria_id = pp.id AND v.excluido_em IS NULL), pp.criado_em)) < ?,
         pp.guarda_ate < ?)
  AND NOT EXISTS (SELECT 1 FROM visita a WHERE a.pessoa_portaria_id = pp.id AND a.saida_em IS NULL
        AND a.situacao = 'em_andamento' AND a.excluido_em IS NULL)`;

const SQL_VISITANTE = `
  SELECT pp.id, pp.nome, pp.cpf, td.codigo AS tipo_documento, pp.numero_documento, pp.data_nascimento, pp.telefone,
         pp.tipo_visitante_id, a.chave_armazenamento AS foto, pp.criado_em, pp.guarda_ate,
         (SELECT MAX(v.entrada_em) FROM visita v WHERE v.pessoa_portaria_id = pp.id AND v.excluido_em IS NULL) AS ultima
    FROM pessoa_portaria pp
    LEFT JOIN tipo_documento_identificacao td ON td.id = pp.tipo_documento_identificacao_id
    LEFT JOIN arquivo a ON a.id = pp.foto_arquivo_id AND a.excluido_em IS NULL
   WHERE pp.excluido_em IS NULL AND pp.situacao <> 'inativo'`;

const SQL_VISITAS = `
  SELECT v.id, v.pessoa_portaria_id, pp.nome, pp.cpf, td.codigo AS tipo_documento, pp.numero_documento, pp.telefone,
         pp.foto_arquivo_id, v.acompanhante_internacao_id, v.internacao_id, v.paciente_id, ui.codigo AS unidade,
         ac.codigo AS acomod, lh.codigo AS leito, v.tipo_visitado_id, v.forma_identificacao_visitante_id,
         cr.numero AS cracha, v.entrada_em, v.saida_em, v.observacao, u.login
    FROM visita v
    JOIN pessoa_portaria pp ON pp.id = v.pessoa_portaria_id
    LEFT JOIN tipo_documento_identificacao td ON td.id = pp.tipo_documento_identificacao_id
    LEFT JOIN cracha_visitante cr ON cr.id = v.cracha_visitante_id
    LEFT JOIN internacao i ON i.id = v.internacao_id
    ${SQL_LOCAL_INTERNACAO}
    LEFT JOIN usuario u ON u.id = v.entrada_usuario_id
   WHERE v.estabelecimento_id = ? AND v.excluido_em IS NULL`;

const SQL_ACOMPANHANTES = `
  SELECT a.id, a.internacao_id, i.paciente_id, ui.codigo AS unidade, a.nome, a.direito_legal, a.recebe_refeicao,
         a.pernoite, a.observacao, a.inicio_em, a.fim_em, u.login,
         (SELECT pp.id FROM pessoa_portaria pp
           WHERE pp.excluido_em IS NULL
             AND ((a.tipo_documento = 'cpf' AND pp.cpf = a.numero_documento)
               OR (a.tipo_documento <> 'cpf' AND pp.numero_documento = a.numero_documento))
           ORDER BY pp.id LIMIT 1) AS visitante,
         (SELECT x.id FROM acompanhante_internacao x
           WHERE x.internacao_id = a.internacao_id AND x.id <> a.id AND x.fim_em = a.inicio_em AND x.excluido_em IS NULL
           ORDER BY x.id DESC LIMIT 1) AS substitui
    FROM acompanhante_internacao a
    JOIN internacao i ON i.id = a.internacao_id
    ${SQL_LOCAL_INTERNACAO}
    LEFT JOIN usuario u ON u.id = a.criado_por
   WHERE i.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.fim_em IS NULL`;

const SQL_BLOQUEIOS = `
  SELECT b.id, b.abrangencia, b.pessoa_portaria_id, pp.nome AS pessoa_nome, b.paciente_id, b.inicio_em, b.fim_em,
         b.ativo, b.observacao, b.limite_visitantes, b.inclui_acompanhante, b.documento_referencia, m.codigo AS motivo,
         u.login, i.id AS internacao
    FROM bloqueio_visitante b
    JOIN motivo_bloqueio_visita m ON m.id = b.motivo_bloqueio_visita_id
    JOIN internacao i ON i.estabelecimento_id = b.estabelecimento_id AND i.excluido_em IS NULL
     AND (i.atendimento_id = b.atendimento_id
          OR (b.atendimento_id IS NULL AND i.paciente_id = b.paciente_id AND i.situacao IN ('ativa', 'alta_medica')))
    LEFT JOIN pessoa_portaria pp ON pp.id = b.pessoa_portaria_id
    LEFT JOIN usuario u ON u.id = b.determinante_usuario_id
   WHERE b.estabelecimento_id = ? AND b.ativo = TRUE AND b.excluido_em IS NULL AND b.abrangencia <> 'pessoa'`;

const SQL_REGRAS = `
  SELECT r.id, ui.codigo AS unidade, ui.intensiva, r.maximo_visitantes, r.horarios, r.versao, r.idade_minima_anos,
         r.duracao_maxima_minutos, r.conduta_isolamento, r.observacao,
         COALESCE(r.alterado_em, r.criado_em) AS em, COALESCE(ua.login, uc.login) AS login
    FROM regra_visita_unidade r
    LEFT JOIN unidade_internacao ui ON ui.id = r.unidade_internacao_id
    LEFT JOIN usuario ua ON ua.id = r.alterado_por
    LEFT JOIN usuario uc ON uc.id = r.criado_por
   WHERE r.estabelecimento_id = ? AND r.ativo = TRUE AND r.excluido_em IS NULL`;

/** Documento do visitante como a tela o vê. */
function documentoDe(r: Linha): { tipo: VisitanteRegistrado['tipoDocumento']; numero: string } {
  if (r['cpf']) return { tipo: 'cpf', numero: texto(r['cpf']) };
  const t = texto(r['tipo_documento']);
  return {
    tipo: (TIPOS_DOCUMENTO as readonly string[]).includes(t) ? (t as VisitanteRegistrado['tipoDocumento']) : 'outro',
    numero: texto(r['numero_documento']),
  };
}

/** Janela de visita da regra: a primeira janela do público "visitante" (horários iguais em todos os dias). */
function janelaDe(horarios: unknown): { inicio: string; fim: string } {
  let lista: unknown;
  try {
    lista = typeof horarios === 'string' ? JSON.parse(horarios) : horarios;
  } catch {
    lista = [];
  }
  const j = Array.isArray(lista)
    ? (lista as Linha[]).find((x) => texto(x['publico']) !== 'acompanhante') ?? (lista as Linha[])[0]
    : undefined;
  return {
    inicio: texto(j?.['inicio']).slice(0, 5) || REGRA_PADRAO.horaInicio,
    fim: texto(j?.['fim']).slice(0, 5) || REGRA_PADRAO.horaFim,
  };
}

/** A validade do crachá derivada da regra vigente (pendência: a coluna da validade na visita). */
function validadeDerivada(
  entrada: string,
  regras: readonly RegraVisitaRegistrada[],
  unidade: string | null,
  papel: VisitaRegistrada['papel'],
  excecao: boolean,
): string {
  if (unidade === null) return validadeDoCracha(entrada, { horaFim: '23:59', duracaoMaxMin: 120 }, 'visitante', false);
  return validadeDoCracha(entrada, regraDaUnidade(regras, unidade).regra, papel, excecao);
}

/** Gravações já feitas por pedido (a mesma requisição pode gravar mais de uma vez, sempre na mesma ordem). */
const GRAVACOES_DO_PEDIDO = new WeakMap<object, number>();

/**
 * Chave de idempotência da gravação: a Idempotency-Key do pedido (a primeira gravação usa a própria chave; as
 * seguintes, um hash dela com a ordem) ou, sem a chave do cliente, uma chave nova.
 */
function chaveDaGravacao(c: ContextoPortaM18): string {
  const pedido = (c as ContextoPortaria).chavePedido;
  if (!pedido) return `portaria:${randomUUID()}`;
  const ordem = (GRAVACOES_DO_PEDIDO.get(c) ?? 0) + 1;
  GRAVACOES_DO_PEDIDO.set(c, ordem);
  return ordem === 1 ? pedido : `portaria:${createHash('sha256').update(`${pedido}#${ordem}`).digest('hex').slice(0, 64)}`;
}

export class PortaPortariaPropria implements PortaPortaria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoPortaria,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPortaria, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), async (l) => fn(l, est, await fusoDe(l, est)));
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────

  /** A portaria não tem operação de tela pelo Executor: as gravações são diretas (gravarSgh). */
  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(): Promise<never> {
    throw recusa('operacao-desconhecida', 'A portaria grava pelas ações da própria tela.');
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorPortaria) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    if (c.usuario === null) throw recusa('sem-usuario', 'A gravação da portaria exige o usuário da sessão.');
    const usuario = c.usuario;
    let saida: { valor: T } | null = null;
    const extras: { motivo: string | null; dados: Record<string, unknown> } = { motivo: null, dados: {} };
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const op = definirOperacao({
      nome: 'portaria.gravacao-direta',
      tabelas: TABELAS_GRAVACAO,
      entrada: z.object({ chave: z.string() }),
      gravar: async (tx) => {
        const fuso = await fusoDe(tx, est);
        saida = { valor: await fn(gravadorSobre(tx, est, usuario, fuso, extras)) };
        // O resultado (ids e códigos) fica na idempotência: o reenvio do pedido o recebe sem gravar de novo.
        return { valor: JSON.stringify(saida.valor ?? null) } as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'visita', id: l?.entidadeId ?? null };
      },
      trilha: () => {
        const depois = linha()?.dadosDepois;
        const dados =
          depois && typeof depois === 'object' ? { ...(depois as object), ...extras.dados } : (depois ?? extras.dados);
        return { dados, motivo: extras.motivo ?? linha()?.motivo ?? null };
      },
    });
    const chave = chaveDaGravacao(c);
    const r = await this.executor.executar(op, c.cliente, { chave }, {
      ...contextoDe(c),
      chaveIdempotencia: chave,
    });
    if (r.repetida) {
      const anterior = JSON.parse(String(r.resultado['valor'] ?? 'null')) as T;
      // A visita repetida avisa a tela ("esta entrada já estava registrada").
      return anterior !== null && typeof anterior === 'object' && 'repetida' in (anterior as object)
        ? ({ ...(anterior as object), repetida: true } as T)
        : anterior;
    }
    if (!saida) throw new Error('Gravação da portaria sem resultado.');
    return (saida as { valor: T }).valor;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoPortaria): Promise<string> {
    return this.ler(c, async (_l, _e, fuso) => {
      const r = relogioNoFuso(fuso);
      return `${r.hoje}T${r.hhmm.slice(0, 2)}:${r.hhmm.slice(2, 4)}:00`;
    });
  }

  dominios(c: ContextoPortaria): Promise<DominiosDaPortaria> {
    // Os domínios são da rede inteira (sem estabelecimento).
    return this.ler(c, async (l) => {
      const [tv, td, fi, sa, mt] = await Promise.all([
        l.consultar('SELECT id, descricao, ativo FROM tipo_visitante ORDER BY descricao, id', [], { teto: 200 }),
        l.consultar('SELECT id, descricao, alvo FROM tipo_visitado WHERE ativo = TRUE ORDER BY descricao, id', [], {
          teto: 200,
        }),
        l.consultar(
          'SELECT id, descricao, biometrica FROM forma_identificacao_visitante WHERE ativo = TRUE ORDER BY descricao, id',
          [],
          { teto: 200 },
        ),
        l.consultar('SELECT id, descricao FROM situacao_acesso_visitante WHERE ativo = TRUE ORDER BY id', [], {
          teto: 200,
        }),
        l.consultar(
          `SELECT m.id, m.descricao, m.ativo, f.id AS fabricante, f.descricao AS fabricante_nome
             FROM modelo_terminal_acesso m JOIN fabricante_terminal_acesso f ON f.id = m.fabricante_terminal_acesso_id
            ORDER BY m.descricao, m.id`,
          [],
          { teto: 200 },
        ),
      ]);
      return {
        tiposVisitante: tv.map((r) => ({ codigo: n(r['id']), nome: texto(r['descricao']), ativo: verdadeiro(r['ativo']) })),
        tiposVisitado: td.map((r) => ({
          codigo: n(r['id']),
          nome: texto(r['descricao']),
          paciente: texto(r['alvo']) === 'paciente',
        })),
        identificacoes: fi.map((r) => ({
          codigo: n(r['id']),
          nome: texto(r['descricao']),
          biometrica: verdadeiro(r['biometrica']),
        })),
        situacoesAcesso: sa.map((r) => ({ codigo: n(r['id']), nome: texto(r['descricao']) })),
        tiposTerminal: mt.map((r) => ({
          codigo: n(r['id']),
          nome: texto(r['descricao']),
          fabricante: n(r['fabricante']),
          fabricanteNome: texto(r['fabricante_nome']),
          ativo: verdadeiro(r['ativo']),
        })),
      };
    });
  }

  unidades(c: ContextoPortaria): Promise<{ unidade: string; nome: string }[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT codigo, descricao FROM unidade_internacao
            WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY codigo`,
          [est],
          { teto: 500 },
        )
      ).map((r) => ({ unidade: texto(r['codigo']), nome: texto(r['descricao']) })),
    );
  }

  internados(c: ContextoPortaria): Promise<InternadoPortaria[]> {
    return this.ler(c, async (l, est) =>
      (await l.consultar(`${SQL_INTERNADOS} ORDER BY pf.nome, i.id`, [est], { teto: TETO_INTERNADOS_PORTARIA })).map(
        internadoDe,
      ),
    );
  }

  internado(c: ContextoPortaria, internacao: number): Promise<InternadoPortaria | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_INTERNADOS} AND i.id = ?`, [est, internacao]);
      return r ? internadoDe(r) : null;
    });
  }

  regras(c: ContextoPortaria): Promise<RegraVisitaRegistrada[]> {
    return this.ler(c, (l, est, fuso) => regrasDe(l, est, fuso));
  }

  bloqueios(c: ContextoPortaria, internacao?: number | null): Promise<BloqueioVisitaRegistrado[]> {
    return this.ler(c, async (l, est, fuso) => {
      const linhas = await l.consultar(
        `${SQL_BLOQUEIOS}${internacao != null ? ' AND i.id = ?' : ''} ORDER BY b.inicio_em, b.id`,
        internacao != null ? [est, internacao] : [est],
        { teto: 5_000 },
      );
      return linhas.flatMap((r) => {
        const motivo = texto(r['motivo']) as MotivoBloqueioVisita;
        if (!MOTIVOS.includes(motivo)) return [];
        return [
          {
            id: n(r['id']),
            internacao: n(r['internacao']),
            paciente: n(r['paciente_id']),
            motivo,
            abrangencia: abrangenciaDe(r),
            visitante: nn(r['pessoa_portaria_id']),
            visitanteNome: textoN(r['pessoa_nome']),
            limite: nn(r['limite_visitantes']),
            incluiAcompanhante: verdadeiro(r['inclui_acompanhante']),
            justificativa: texto(r['observacao']),
            documento: textoN(r['documento_referencia']),
            inicio: local(r['inicio_em'], fuso) ?? '',
            fim: local(r['fim_em'], fuso),
            revogado: !verdadeiro(r['ativo']),
            criadoPor: texto(r['login']),
          },
        ];
      });
    });
  }

  visitante(c: ContextoPortaria, id: number): Promise<VisitanteRegistrado | null> {
    return this.ler(c, async (l, _est, fuso) => {
      const r = await l.uma(`${SQL_VISITANTE} AND pp.id = ?`, [id]);
      return r ? visitanteDe(r, fuso) : null;
    });
  }

  buscarVisitantes(
    c: ContextoPortaria,
    b: { readonly documento: { tipo: string; numero: string } | null; readonly nomeBusca: string | null },
  ): Promise<VisitanteRegistrado[]> {
    return this.ler(c, async (l, _est, fuso) => {
      if (b.documento) {
        const linhas =
          b.documento.tipo === 'cpf'
            ? await l.consultar(`${SQL_VISITANTE} AND pp.cpf = ?`, [digitos(b.documento.numero)], { teto: 5 })
            : await l.consultar(`${SQL_VISITANTE} AND td.codigo = ? AND pp.numero_documento = ?`, [
                b.documento.tipo,
                b.documento.numero,
              ], { teto: 5 });
        return linhas.map((r) => visitanteDe(r, fuso));
      }
      if (!b.nomeBusca || b.nomeBusca.length < 3) return [];
      // A comparação do banco ignora caixa e acento: o começo do nome basta.
      return (
        await l.consultar(`${SQL_VISITANTE} AND pp.nome LIKE ? ORDER BY pp.nome, pp.id LIMIT ${TETO_BUSCA_VISITANTE}`, [
          `${b.nomeBusca.replace(/[%_\\]/g, '')}%`,
        ])
      ).map((r) => visitanteDe(r, fuso));
    });
  }

  vencidos(c: ContextoPortaria, hoje: string, retencaoDias: number = RETENCAO_PADRAO_DIAS): Promise<number> {
    // A guarda conta da última visita (ou do cadastro) em qualquer estabelecimento: o cadastro é da rede.
    return this.ler(c, async (l, _est, fuso) => {
      const corte = instante(`${somarDias(hoje, -retencaoDias)}T00:00`, fuso);
      const r = await l.uma<{ total: unknown }>(
        `SELECT COUNT(*) AS total FROM pessoa_portaria pp WHERE ${SQL_GUARDA_VENCIDA}`,
        [corte, hoje],
      );
      return n(r?.total);
    });
  }

  abertas(c: ContextoPortaria): Promise<VisitaRegistrada[]> {
    return this.ler(c, async (l, est, fuso) => {
      const regras = await regrasDe(l, est, fuso);
      const r = relogioNoFuso(fuso);
      // Como a tela: o crachá válido ou vencido há até 24 horas.
      const corte = local(new Date(instante(`${r.hoje}T${r.hhmm.slice(0, 2)}:${r.hhmm.slice(2)}`, fuso).getTime() - 86_400_000), fuso)!;
      return (
        await l.consultar(
          `${SQL_VISITAS} AND v.saida_em IS NULL AND v.situacao = 'em_andamento' ORDER BY v.entrada_em DESC, v.id DESC`,
          [est],
          { teto: TETO_VISITAS_ABERTAS },
        )
      )
        .map((x) => visitaDe(x, regras, fuso))
        .filter((v) => v.validoAte > corte);
    });
  }

  visita(c: ContextoPortaria, id: number): Promise<VisitaRegistrada | null> {
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.uma(`${SQL_VISITAS} AND v.id = ?`, [est, id]);
      return r ? visitaDe(r, await regrasDe(l, est, fuso), fuso) : null;
    });
  }

  visitasDoPeriodo(
    c: ContextoPortaria,
    f: { readonly internacao: number | null; readonly unidade: string | null; readonly de: string; readonly ate: string },
  ): Promise<VisitaRegistrada[]> {
    return this.ler(c, async (l, est, fuso) => {
      const de = instante(`${f.de}T00:00`, fuso);
      const ate = new Date(instante(`${f.ate}T23:59`, fuso).getTime() + 60_000);
      const filtro = f.internacao !== null ? ' AND v.internacao_id = ?' : ' AND ui.codigo = ?';
      const regras = await regrasDe(l, est, fuso);
      return (
        await l.consultar(
          `${SQL_VISITAS}${filtro} AND v.entrada_em < ? AND COALESCE(v.saida_em, v.entrada_em + INTERVAL 1 DAY) >= ?
            ORDER BY v.entrada_em, v.id`,
          [est, f.internacao ?? f.unidade, ate, de],
          { teto: TETO_VISITAS_PERIODO },
        )
      ).map((x) => visitaDe(x, regras, fuso));
    });
  }

  acompanhantes(c: ContextoPortaria, unidade?: string | null): Promise<AcompanhanteRegistrado[]> {
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `${SQL_ACOMPANHANTES}${unidade != null ? ' AND ui.codigo = ?' : ''} ORDER BY a.inicio_em, a.id`,
          unidade != null ? [est, unidade] : [est],
          { teto: 5_000 },
        )
      ).map((r) => ({
        id: n(r['id']),
        internacao: n(r['internacao_id']),
        paciente: n(r['paciente_id']),
        bloco: texto(r['unidade']),
        visitante: n(r['visitante']),
        visitanteNome: texto(r['nome']),
        fundamento: FUNDAMENTO_DO_DIREITO[texto(r['direito_legal'])] ?? 'autorizado',
        refeicao: verdadeiro(r['recebe_refeicao']),
        pernoite: verdadeiro(r['pernoite']),
        observacao: textoN(r['observacao']),
        inicio: local(r['inicio_em'], fuso) ?? '',
        fim: local(r['fim_em'], fuso),
        substitui: nn(r['substitui']),
        criadoPor: texto(r['login']),
      })),
    );
  }

  terminais(c: ContextoPortaria): Promise<TerminalRegistrado[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT t.id, t.nome, t.modelo_terminal_acesso_id, m.fabricante_terminal_acesso_id, p.nome AS local,
                  t.sentido, t.ativo, t.versao
             FROM terminal_acesso t
             JOIN ponto_acesso p ON p.id = t.ponto_acesso_id
             LEFT JOIN modelo_terminal_acesso m ON m.id = t.modelo_terminal_acesso_id
            WHERE p.estabelecimento_id = ? AND t.excluido_em IS NULL AND p.excluido_em IS NULL
            ORDER BY t.nome, t.id`,
          [est],
          { teto: 500 },
        )
      ).map((r) => ({
        id: n(r['id']),
        nome: texto(r['nome']),
        tipoTerminal: n(r['modelo_terminal_acesso_id']),
        fabricante: n(r['fabricante_terminal_acesso_id']),
        local: texto(r['local']),
        sentido: texto(r['sentido']) as SentidoTerminal,
        ativo: verdadeiro(r['ativo']),
        versao: n(r['versao']),
      })),
    );
  }

  /** Pendência de modelo: o evento da passagem ainda não se liga ao terminal da portaria (pedido do lote). */
  async eventos(): Promise<[]> {
    return [];
  }

  foto(c: ContextoPortaria, visitante: number): Promise<string | null> {
    return this.ler(c, async (l) => {
      const r = await l.uma<{ chave: unknown }>(
        `SELECT a.chave_armazenamento AS chave FROM pessoa_portaria pp JOIN arquivo a ON a.id = pp.foto_arquivo_id
          WHERE pp.id = ? AND pp.excluido_em IS NULL AND a.excluido_em IS NULL`,
        [visitante],
      );
      return textoN(r?.chave);
    });
  }
}

// ── Leituras comuns ─────────────────────────────────────────────────────────────────────────────────

async function fusoDe(l: Leitor, est: number): Promise<string> {
  const r = await l.uma<{ fuso_horario: string | null }>('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
  return r?.fuso_horario || FUSO_PADRAO;
}

function contextoDe(c: ContextoPortaM18): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || 'portaria').slice(0, 64),
  };
}

function internadoDe(r: Linha): InternadoPortaria {
  const acomod = texto(r['acomod']);
  const leito = texto(r['leito']);
  const unidade = texto(r['unidade']);
  return {
    internacao: n(r['id']),
    paciente: n(r['paciente_id']),
    nome: texto(r['nome']),
    nascimento: dataIso(r['data_nascimento']),
    unidade,
    unidadeNome: texto(r['unidade_nome']) || unidade,
    acomod,
    leitoCodigo: leito,
    leito: [acomod, leito].filter(Boolean).join('-'),
    isolamento: verdadeiro(r['isolamento']),
  };
}

async function regrasDe(l: Leitor, est: number, fuso: string): Promise<RegraVisitaRegistrada[]> {
  return (await l.consultar(`${SQL_REGRAS} ORDER BY r.id`, [est], { teto: 500 })).map((r) => {
    const j = janelaDe(r['horarios']);
    return {
      id: n(r['id']),
      unidade: r['unidade'] === null || r['unidade'] === undefined ? '*' : texto(r['unidade']),
      horaInicio: j.inicio,
      horaFim: j.fim,
      maxSimultaneos: n(r['maximo_visitantes']),
      // A regra gravada antes das colunas (nulas) vale o padrão de mercado.
      idadeMinima: nn(r['idade_minima_anos']) ?? REGRA_PADRAO.idadeMinima,
      uti: verdadeiro(r['intensiva']),
      isolamento: texto(r['conduta_isolamento']) === 'bloquear' ? 'bloquear' : 'orientar',
      duracaoMaxMin: nn(r['duracao_maxima_minutos']) ?? REGRA_PADRAO.duracaoMaxMin,
      observacao: textoN(r['observacao']),
      versao: n(r['versao']),
      atualizadoPor: texto(r['login']),
      atualizadoEm: local(r['em'], fuso) ?? '',
    };
  });
}

function visitanteDe(r: Linha, fuso: string): VisitanteRegistrado {
  const doc = documentoDe(r);
  const ultima = local(r['ultima'], fuso);
  const base = (ultima ?? local(r['criado_em'], fuso) ?? '').slice(0, 10);
  return {
    id: n(r['id']),
    nome: texto(r['nome']),
    tipoDocumento: doc.tipo,
    documento: doc.numero,
    nascimento: dataIso(r['data_nascimento']),
    telefone: textoN(r['telefone']),
    tipoVisitante: n(r['tipo_visitante_id']),
    fotoChave: textoN(r['foto']),
    // O prazo de guarda gravado; sem ele, derivado da última visita e do prazo padrão.
    reterAte: dataIso(r['guarda_ate']) ?? (base ? somarDias(base, RETENCAO_PADRAO_DIAS) : ''),
    ultimaVisita: ultima,
  };
}

function visitaDe(r: Linha, regras: readonly RegraVisitaRegistrada[], fuso: string): VisitaRegistrada {
  const doc = documentoDe(r);
  const paraPaciente = r['internacao_id'] !== null && r['internacao_id'] !== undefined;
  const papel = r['acompanhante_internacao_id'] ? ('acompanhante' as const) : ('visitante' as const);
  const excecao = paraPaciente ? textoN(r['observacao']) : null;
  const entrada = local(r['entrada_em'], fuso) ?? '';
  const unidade = paraPaciente ? texto(r['unidade']) : null;
  return {
    id: n(r['id']),
    visitante: n(r['pessoa_portaria_id']),
    visitanteNome: texto(r['nome']),
    documento: doc.numero,
    tipoDocumento: doc.tipo,
    telefone: textoN(r['telefone']),
    temFoto: r['foto_arquivo_id'] !== null && r['foto_arquivo_id'] !== undefined,
    papel,
    internacao: nn(r['internacao_id']),
    paciente: nn(r['paciente_id']),
    bloco: paraPaciente ? textoN(r['unidade']) : null,
    acomod: paraPaciente ? textoN(r['acomod']) : null,
    leito: paraPaciente ? textoN(r['leito']) : null,
    tipoVisitado: n(r['tipo_visitado_id']),
    local: paraPaciente ? null : textoN(r['observacao']),
    identificacao: n(r['forma_identificacao_visitante_id']),
    cracha: texto(r['cracha']),
    entrada,
    validoAte: validadeDerivada(entrada, regras, unidade, papel, excecao !== null),
    saida: local(r['saida_em'], fuso),
    excecao,
    usuario: texto(r['login']),
  };
}

// ── Gravador ────────────────────────────────────────────────────────────────────────────────────────

function gravadorSobre(
  tx: TxOperacao,
  est: number,
  usuario: number,
  fuso: string,
  extras: { motivo: string | null; dados: Record<string, unknown> },
): GravadorPortaria {
  const tipoDocumento = async (codigo: string): Promise<number> => {
    const r = await tx.uma<{ id: unknown }>(
      'SELECT id FROM tipo_documento_identificacao WHERE codigo = ? AND ativo = TRUE',
      [codigo],
    );
    if (!r)
      throw recusa('dominio-nao-configurado', `O tipo de documento "${codigo}" não está cadastrado no estabelecimento.`, {
        campos: ['tipoDocumento'],
      });
    return n(r.id);
  };

  /** A linha da internação travada: a trava do paciente (as gravações do mesmo paciente se enfileiram aqui). */
  const travarInternacao = async (internacao: number) => {
    const [r] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, atendimento_id, paciente_id, situacao FROM internacao
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [internacao, est],
    );
    return r ?? null;
  };

  const pessoaDe = async (id: number) =>
    (await tx.consultarParaAtualizar<Linha>(
      `SELECT pp.id, pp.nome, pp.cpf, pp.numero_documento, td.codigo AS tipo_documento, pp.telefone,
              pp.tipo_visitante_id, pp.pessoa_fisica_id, pp.situacao
         FROM pessoa_portaria pp LEFT JOIN tipo_documento_identificacao td ON td.id = pp.tipo_documento_identificacao_id
        WHERE pp.id = ? AND pp.excluido_em IS NULL AND pp.situacao <> 'inativo'`,
      [id],
    ))[0] ?? null;

  const visitasAbertas = (filtro: string, p: unknown[]) =>
    tx.consultarParaAtualizar<Linha>(
      `SELECT v.id, v.versao, v.cracha_visitante_id, v.internacao_id, v.acompanhante_internacao_id, v.entrada_em,
              v.observacao, ui.codigo AS unidade
         FROM visita v
         LEFT JOIN internacao i ON i.id = v.internacao_id
         ${SQL_LOCAL_INTERNACAO}
        WHERE v.estabelecimento_id = ? AND v.saida_em IS NULL AND v.situacao = 'em_andamento'
          AND v.excluido_em IS NULL ${filtro}`,
      [est, ...p],
    );

  const validadeDaLinha = (v: Linha, regras: readonly RegraVisitaRegistrada[]) => {
    const paraPaciente = v['internacao_id'] !== null && v['internacao_id'] !== undefined;
    return validadeDerivada(
      local(v['entrada_em'], fuso) ?? '',
      regras,
      paraPaciente ? texto(v['unidade']) : null,
      v['acompanhante_internacao_id'] ? 'acompanhante' : 'visitante',
      paraPaciente && textoN(v['observacao']) !== null,
    );
  };

  const fecharVisita = async (v: Linha, saida: Date) => {
    await tx.alterar('visita', n(v['id']), n(v['versao']), {
      saida_em: saida,
      saida_usuario_id: usuario,
      situacao: 'encerrada',
    });
    if (v['cracha_visitante_id']) {
      const [cr] = await tx.consultarParaAtualizar<Linha>('SELECT id, versao FROM cracha_visitante WHERE id = ?', [
        v['cracha_visitante_id'],
      ]);
      // A etiqueta é de uso único: devolvida, sai de circulação.
      if (cr) await tx.alterar('cracha_visitante', n(cr['id']), n(cr['versao']), { situacao: 'inativo' });
    }
  };

  const acompanhanteVigente = async (internacao: number) =>
    (await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, tipo_documento, numero_documento, direito_legal FROM acompanhante_internacao
        WHERE internacao_id = ? AND fim_em IS NULL AND excluido_em IS NULL ORDER BY inicio_em DESC, id DESC`,
      [internacao],
    ))[0] ?? null;

  /** O visitante (pessoa_portaria) do acompanhante, pelo documento (pendência: a ligação direta no modelo). */
  const pessoaDoAcompanhante = async (a: Linha): Promise<number | null> => {
    const r = await tx.uma<{ id: unknown }>(
      texto(a['tipo_documento']) === 'cpf'
        ? 'SELECT id FROM pessoa_portaria WHERE cpf = ? AND excluido_em IS NULL ORDER BY id LIMIT 1'
        : 'SELECT id FROM pessoa_portaria WHERE numero_documento = ? AND excluido_em IS NULL ORDER BY id LIMIT 1',
      [texto(a['numero_documento'])],
    );
    return r ? n(r.id) : null;
  };

  const mesmaPessoa = (a: Linha | null, p: Linha) =>
    !!a &&
    (p['cpf']
      ? texto(a['tipo_documento']) === 'cpf' && texto(a['numero_documento']) === texto(p['cpf'])
      : texto(a['numero_documento']) === texto(p['numero_documento']));

  const gravador: GravadorPortaria = {
    async registrarVisitante(v) {
      let cpf: string | null = null;
      let tipoDoc: number | null = null;
      let numero: string | null = null;
      if (v.tipoDocumento === 'cpf') {
        cpf = digitos(v.documento);
        if (cpf.length !== 11) throw recusa('documento-invalido', 'O CPF tem 11 dígitos.', { campos: ['documento'] });
      } else {
        tipoDoc = await tipoDocumento(v.tipoDocumento);
        numero = v.documento.trim().slice(0, 30);
      }
      const tipo = await tx.uma('SELECT id FROM tipo_visitante WHERE id = ? AND ativo = TRUE', [v.tipoVisitante]);
      if (!tipo) throw recusa('tipo-visitante-invalido', 'Escolha um tipo de visitante ativo.', { campos: ['tipoVisitante'] });
      const [ja] = await tx.consultarParaAtualizar<Linha>(
        cpf
          ? `SELECT pp.id, pp.versao, a.chave_armazenamento AS foto FROM pessoa_portaria pp
               LEFT JOIN arquivo a ON a.id = pp.foto_arquivo_id WHERE pp.cpf = ? AND pp.excluido_em IS NULL`
          : `SELECT pp.id, pp.versao, a.chave_armazenamento AS foto FROM pessoa_portaria pp
               LEFT JOIN arquivo a ON a.id = pp.foto_arquivo_id
              WHERE pp.tipo_documento_identificacao_id = ? AND pp.numero_documento = ? AND pp.excluido_em IS NULL`,
        cpf ? [cpf] : [tipoDoc, numero],
      );
      const fotoId = v.foto
        ? await tx.incluir('arquivo', {
            estabelecimento_id: est,
            entidade: 'pessoa_portaria',
            entidade_id: ja ? n(ja['id']) : null,
            finalidade: 'foto_visitante',
            nome_original: v.foto.chave.split('/').at(-1) ?? 'foto',
            tipo_mime: v.foto.tipoMime,
            tamanho_bytes: v.foto.tamanho,
            hash_sha256: v.foto.hash,
            chave_armazenamento: v.foto.chave,
          })
        : null;
      const valores = {
        nome: v.nome.slice(0, 150),
        tipo_visitante_id: v.tipoVisitante,
        ...(v.nascimento ? { data_nascimento: v.nascimento } : {}),
        ...(v.telefone ? { telefone: v.telefone.slice(0, 20) } : {}),
        ...(fotoId ? { foto_arquivo_id: fotoId } : {}),
      };
      if (ja) {
        const id = n(ja['id']);
        await tx.alterar('pessoa_portaria', id, n(ja['versao']), valores);
        const anterior = textoN(ja['foto']);
        return { id, novo: false, fotoAnterior: v.foto && anterior && anterior !== v.foto.chave ? anterior : null };
      }
      let id: number;
      try {
        id = await tx.incluir('pessoa_portaria', {
          ...valores,
          cpf,
          tipo_documento_identificacao_id: tipoDoc,
          numero_documento: numero,
        });
      } catch (x) {
        if (restricaoViolada(x)?.tipo === 'unica')
          throw recusa('visitante-em-uso', 'Outro cadastro com este documento acabou de ser gravado: busque o visitante.');
        throw x;
      }
      if (fotoId) await tx.executar('UPDATE arquivo SET entidade_id = ? WHERE id = ?', [id, fotoId]);
      return { id, novo: true, fotoAnterior: null };
    },

    async expurgarVisitantes(x) {
      // A anonimização apaga o que identifica a pessoa e guarda o instante; as visitas ficam, ligadas ao cadastro
      // anônimo (o histórico da portaria continua contável). As fotos voltam para o chamador apagar o arquivo.
      const corte = instante(`${somarDias(x.hoje, -(x.retencaoDias ?? RETENCAO_PADRAO_DIAS))}T00:00`, fuso);
      const vencidos = await tx.consultarParaAtualizar<Linha>(
        `SELECT pp.id, pp.versao, a.chave_armazenamento AS foto FROM pessoa_portaria pp
           LEFT JOIN arquivo a ON a.id = pp.foto_arquivo_id AND a.excluido_em IS NULL
          WHERE ${SQL_GUARDA_VENCIDA} ORDER BY pp.id LIMIT ${Math.max(1, Math.trunc(x.teto))}`,
        [corte, x.hoje],
        { teto: Math.max(1, Math.trunc(x.teto)) },
      );
      const ids: number[] = [];
      const fotos: string[] = [];
      for (const v of vencidos) {
        await tx.alterar('pessoa_portaria', n(v['id']), n(v['versao']), {
          nome: 'VISITANTE ANONIMIZADO',
          nome_social: null,
          usa_nome_social: false,
          data_nascimento: null,
          cpf: null,
          tipo_documento_identificacao_id: null,
          numero_documento: null,
          telefone: null,
          email: null,
          empresa_nome: null,
          foto_arquivo_id: null,
          restricao_motivo: null,
          anonimizada_em: new Date(),
        });
        ids.push(n(v['id']));
        const foto = textoN(v['foto']);
        if (foto) fotos.push(foto);
      }
      return { ids, fotos };
    },

    async registrarVisita(v, avaliar) {
      const pessoa = await pessoaDe(v.visitante);
      if (!pessoa) throw recusa('visitante-nao-encontrado', 'Visitante não encontrado: cadastre de novo.');
      if (pessoa['tipo_visitante_id'] === null)
        throw recusa('tipo-visitante-ausente', 'Informe o tipo de visitante no cadastro antes de registrar a visita.');
      const entrada = instante(v.entrada, fuso);
      // O visitante barrado no cadastro (bloqueado ou restrito) ou por bloqueio da pessoa no estabelecimento não entra.
      if (['bloqueado', 'restrito'].includes(texto(pessoa['situacao'])))
        throw recusa(
          'visitante-bloqueado',
          texto(pessoa['situacao']) === 'bloqueado'
            ? 'O visitante está bloqueado no cadastro da portaria.'
            : 'O visitante tem restrição no cadastro da portaria: procure a supervisão.',
        );
      const barrado = await tx.uma(
        `SELECT b.id FROM bloqueio_visitante b
          WHERE b.estabelecimento_id = ? AND b.pessoa_portaria_id = ? AND b.abrangencia = 'pessoa' AND b.ativo = TRUE
            AND b.excluido_em IS NULL AND b.inicio_em <= ? AND (b.fim_em IS NULL OR b.fim_em > ?)
          LIMIT 1`,
        [est, v.visitante, entrada, entrada],
      );
      if (barrado) throw recusa('visitante-bloqueado', 'O visitante está bloqueado neste estabelecimento.');
      // O outro destino é um setor do estabelecimento (o visitado exige paciente, setor ou colaborador).
      let setor: number | null = null;
      let localDestino: string | null = null;
      if (v.destino.tipo === 'outro') {
        const local = v.destino.local.trim();
        const s = local
          ? await tx.uma<{ id: unknown }>(
              `SELECT id FROM setor_funcional
                WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL
                  AND (codigo = ? OR sigla = ? OR nome = ?)
                ORDER BY codigo = ? DESC, id LIMIT 1`,
              [est, local, local, local, local],
            )
          : null;
        if (!local) throw recusa('destino-obrigatorio', 'Informe o local visitado.', { campos: ['destino'] });
        if (s) setor = n(s.id);
        else localDestino = local.slice(0, 150);
      }
      const regras = await regrasDe(tx, est, fuso);
      // A visita anterior do visitante com o crachá vencido e sem a saída: encerrada na validade (expirada).
      for (const x of await visitasAbertas('AND v.pessoa_portaria_id = ?', [v.visitante])) {
        const validade = validadeDaLinha(x, regras);
        if (validade <= v.entrada.slice(0, 16)) {
          await fecharVisita(x, instante(validade, fuso));
          extras.dados = { ...extras.dados, expiradas: [...((extras.dados['expiradas'] as number[]) ?? []), n(x['id'])] };
        }
      }
      let papel: VisitaRegistrada['papel'] = 'visitante';
      let internacao: Linha | null = null;
      let acompanhanteId: number | null = null;
      if (v.destino.tipo === 'paciente') {
        internacao = await travarInternacao(v.destino.internacao);
        const internado = !!internacao && ['ativa', 'alta_medica'].includes(texto(internacao['situacao']));
        if (!internado) throw recusa('sem-internacao', 'O paciente não está mais internado.');
        const abertasDoPaciente = await visitasAbertas('AND v.internacao_id = ?', [v.destino.internacao]);
        const acomp = await acompanhanteVigente(v.destino.internacao);
        acompanhanteId = acomp && mesmaPessoa(acomp, pessoa) ? n(acomp['id']) : null;
        const bloqueios = await bloqueiosRelidos(
          tx,
          est,
          n(internacao!['atendimento_id']),
          n(internacao!['paciente_id']),
          fuso,
        );
        const relido = {
          internado,
          bloqueios,
          abertas: abertasDoPaciente.filter(
            (x) => !x['acompanhante_internacao_id'] && validadeDaLinha(x, regras) > v.entrada.slice(0, 16),
          ).length,
          acompanhante: acomp ? await pessoaDoAcompanhante(acomp) : null,
          acompanhanteFundamento: acomp ? (FUNDAMENTO_DO_DIREITO[texto(acomp['direito_legal'])] ?? 'autorizado') : null,
          visitanteEmVisita: (await visitasAbertas('AND v.pessoa_portaria_id = ?', [v.visitante])).length > 0,
        };
        const a = avaliar(relido);
        if (!a.permitida) throw recusa(a.recusa, a.mensagem);
        papel = a.papel;
      }
      if ((await visitasAbertas('AND v.pessoa_portaria_id = ?', [v.visitante])).length > 0)
        throw recusa('ja-em-visita', 'Este visitante já tem uma visita em curso: registre a saída antes.');
      const ponto = await tx.uma<{ id: unknown }>(
        `SELECT id FROM ponto_acesso WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL
          ORDER BY tipo = 'portaria' DESC, id LIMIT 1`,
        [est],
      );
      if (!ponto)
        throw recusa('sem-ponto-acesso', 'Cadastre a portaria (ponto de acesso) do estabelecimento antes de registrar a visita.');
      let cracha: number;
      try {
        cracha = await tx.incluir('cracha_visitante', {
          estabelecimento_id: est,
          numero: v.cracha,
          codigo_leitura: v.cracha,
          tipo: papel === 'acompanhante' ? 'acompanhante' : 'visitante',
          situacao: 'em_uso',
        });
      } catch (x) {
        if (restricaoViolada(x)?.tipo === 'unica') throw recusa('cracha-em-uso', 'Este crachá já foi emitido: emita outro.');
        throw x;
      }
      const id = await tx.incluir('visita', {
        estabelecimento_id: est,
        pessoa_portaria_id: v.visitante,
        tipo_visitante_id: n(pessoa['tipo_visitante_id']),
        tipo_visitado_id: v.tipoVisitado,
        paciente_id: internacao ? n(internacao['paciente_id']) : null,
        setor_funcional_id: setor,
        local_destino: localDestino,
        atendimento_id: internacao ? nn(internacao['atendimento_id']) : null,
        internacao_id: internacao ? n(internacao['id']) : null,
        acompanhante_internacao_id: papel === 'acompanhante' ? acompanhanteId : null,
        forma_identificacao_visitante_id: v.identificacao,
        cracha_visitante_id: cracha,
        entrada_ponto_acesso_id: n(ponto.id),
        entrada_em: entrada,
        entrada_usuario_id: usuario,
        situacao: 'em_andamento',
        // A observação guarda a exceção autorizada (visita ao paciente) ou o local (outro destino).
        observacao: v.destino.tipo === 'outro' ? v.destino.local : v.excecao,
      });
      return { id, papel, repetida: false };
    },

    async encerrarVisita(x) {
      const [v] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, versao, cracha_visitante_id, entrada_em, saida_em FROM visita
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [x.id, est],
      );
      if (!v) throw recusa('nao-encontrado', 'Visita não encontrada.');
      if (v['saida_em'] !== null) throw recusa('visita-encerrada', 'A saída desta visita já foi registrada.');
      const saida = instante(x.saida, fuso);
      const ent = v['entrada_em'] instanceof Date ? (v['entrada_em'] as Date) : new Date(String(v['entrada_em']));
      await fecharVisita(v, saida < ent ? ent : saida);
      extras.dados = { ...extras.dados, origemSaida: x.origem };
      return x.id;
    },

    async definirRegra(r) {
      let unidade: number | null = null;
      if (r.unidade !== '*') {
        const u = await tx.uma<{ id: unknown }>(
          'SELECT id FROM unidade_internacao WHERE estabelecimento_id = ? AND codigo = ? AND excluido_em IS NULL',
          [est, r.unidade],
        );
        if (!u) throw recusa('unidade-desconhecida', 'Unidade de internação não encontrada.', { campos: ['unidade'] });
        unidade = n(u.id);
      }
      const [ja] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, versao FROM regra_visita_unidade
          WHERE estabelecimento_id = ? AND unidade_internacao_id <=> ? AND ativo = TRUE ORDER BY id LIMIT 1`,
        [est, unidade],
      );
      const mudou = () => recusa('regra-mudou', 'A regra desta unidade mudou depois que você abriu: abra de novo.');
      const valores = {
        maximo_visitantes: r.maxSimultaneos,
        idade_minima_anos: r.idadeMinima,
        duracao_maxima_minutos: r.duracaoMaxMin,
        conduta_isolamento: r.isolamento,
        observacao: r.observacao ?? null,
        horarios: JSON.stringify(
          [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dia_semana: d, publico: 'visitante', inicio: r.horaInicio, fim: r.horaFim })),
        ),
      };
      if (r.versao === null) {
        if (ja) throw mudou();
        const id = await tx.incluir('regra_visita_unidade', {
          estabelecimento_id: est,
          unidade_internacao_id: unidade,
          maximo_acompanhantes: 1,
          ...valores,
        });
        return { id, versao: 1 };
      }
      if (!ja || n(ja['versao']) !== r.versao) throw mudou();
      const versao = await tx.alterar('regra_visita_unidade', n(ja['id']), r.versao, valores);
      return { id: n(ja['id']), versao };
    },

    async bloquear(b) {
      if ((b.abrangencia === 'limite') !== (b.limite !== null))
        throw recusa('limite-invalido', 'O limite de visitantes vale só para o bloqueio por limite, e ele o exige.', {
          campos: ['limite'],
        });
      const i = await travarInternacao(b.internacao);
      if (!i) throw recusa('sem-internacao', 'O paciente não está mais internado.');
      const motivo = await tx.uma<{ id: unknown }>(
        'SELECT id FROM motivo_bloqueio_visita WHERE codigo = ? AND ativo = TRUE',
        [b.motivo],
      );
      if (!motivo)
        throw recusa('dominio-nao-configurado', `O motivo de bloqueio "${b.motivo}" não está cadastrado.`, {
          campos: ['motivo'],
        });
      if (b.visitante !== null && !(await pessoaDe(b.visitante)))
        throw recusa('visitante-nao-encontrado', 'Visitante não encontrado.');
      return tx.incluir('bloqueio_visitante', {
        estabelecimento_id: est,
        abrangencia: b.abrangencia === 'visitante' ? 'pessoa_paciente' : 'paciente',
        pessoa_portaria_id: b.abrangencia === 'visitante' ? b.visitante : null,
        paciente_id: n(i['paciente_id']),
        atendimento_id: nn(i['atendimento_id']),
        motivo_bloqueio_visita_id: n(motivo.id),
        inicio_em: instante(b.inicio, fuso),
        fim_em: b.fim ? instante(b.fim.length === 10 ? `${b.fim}T23:59` : b.fim, fuso) : null,
        determinante_usuario_id: usuario,
        observacao: b.justificativa.slice(0, 500),
        limite_visitantes: b.abrangencia === 'limite' ? b.limite : null,
        inclui_acompanhante: b.incluiAcompanhante,
        documento_referencia: b.documento,
      });
    },

    async revogarBloqueio(x) {
      const [b] = await tx.consultarParaAtualizar<Linha>(
        `SELECT b.id, b.versao, b.ativo, m.codigo AS motivo, i.id AS internacao
           FROM bloqueio_visitante b
           JOIN motivo_bloqueio_visita m ON m.id = b.motivo_bloqueio_visita_id
           LEFT JOIN internacao i ON i.atendimento_id = b.atendimento_id AND i.estabelecimento_id = b.estabelecimento_id
          WHERE b.id = ? AND b.estabelecimento_id = ? AND b.excluido_em IS NULL`,
        [x.id, est],
      );
      if (!b) throw recusa('nao-encontrado', 'Bloqueio não encontrado.');
      if (!verdadeiro(b['ativo'])) throw recusa('ja-revogado', 'Este bloqueio já foi revogado.');
      const motivo = texto(b['motivo']) as MotivoBloqueioVisita;
      if (x.exigeMotivo === 'clinico' && motivo !== 'clinico')
        throw recusa(
          'so-bloqueio-clinico',
          'Aqui só o bloqueio por decisão clínica: o sigilo, a ordem judicial e o pedido são revogados pela supervisão.',
        );
      if (motivo === 'clinico' && !x.podeClinico)
        throw recusa('bloqueio-clinico', 'O bloqueio por decisão clínica só é revogado pela enfermagem ou pelo médico.');
      await tx.alterar('bloqueio_visitante', n(b['id']), n(b['versao']), {
        ativo: false,
        inativado_em: new Date(),
        inativador_usuario_id: usuario,
      });
      extras.motivo = x.motivo.slice(0, 500);
      return { id: n(b['id']), internacao: n(b['internacao']), motivo };
    },

    async registrarAcompanhante(a) {
      const i = await travarInternacao(a.internacao);
      if (!i || !['ativa', 'alta_medica'].includes(texto(i['situacao'])))
        throw recusa('sem-internacao', 'O paciente não está mais internado.');
      const pessoa = await pessoaDe(a.visitante);
      if (!pessoa) throw recusa('visitante-nao-encontrado', 'Visitante não encontrado: cadastre de novo.');
      const vigente = await acompanhanteVigente(a.internacao);
      if (mesmaPessoa(vigente, pessoa))
        throw recusa('ja-acompanhante', 'Esta pessoa já é o acompanhante vigente deste paciente.');
      const inicio = instante(a.inicio, fuso);
      if (vigente) await tx.alterar('acompanhante_internacao', n(vigente['id']), n(vigente['versao']), { fim_em: inicio });
      const cpf = textoN(pessoa['cpf']);
      const id = await tx.incluir('acompanhante_internacao', {
        internacao_id: a.internacao,
        pessoa_fisica_id: nn(pessoa['pessoa_fisica_id']),
        nome: texto(pessoa['nome']).slice(0, 150),
        tipo_documento: cpf ? 'cpf' : (DOCUMENTO_ACOMPANHANTE[texto(pessoa['tipo_documento'])] ?? 'outro'),
        numero_documento: cpf ?? textoN(pessoa['numero_documento']),
        telefone: textoN(pessoa['telefone']),
        direito_legal: DIREITO_DO_FUNDAMENTO[a.fundamento],
        inicio_em: inicio,
        pernoite: a.pernoite,
        recebe_refeicao: a.refeicao,
        observacao: a.observacao,
      });
      return { id, substituido: vigente ? n(vigente['id']) : null };
    },

    async encerrarAcompanhante(x) {
      const [a] = await tx.consultarParaAtualizar<Linha>(
        `SELECT a.id, a.versao, a.internacao_id, a.inicio_em, a.fim_em FROM acompanhante_internacao a
           JOIN internacao i ON i.id = a.internacao_id
          WHERE a.id = ? AND i.estabelecimento_id = ? AND a.excluido_em IS NULL`,
        [x.id, est],
      );
      if (!a) throw recusa('nao-encontrado', 'Acompanhante não encontrado.');
      if (a['fim_em'] !== null) throw recusa('ja-encerrado', 'Este acompanhamento já foi encerrado.');
      const fim = instante(x.fim, fuso);
      const inicio = a['inicio_em'] instanceof Date ? (a['inicio_em'] as Date) : new Date(String(a['inicio_em']));
      await tx.alterar('acompanhante_internacao', n(a['id']), n(a['versao']), { fim_em: fim < inicio ? inicio : fim });
      extras.motivo = x.motivo.slice(0, 500);
      return { id: n(a['id']), internacao: n(a['internacao_id']) };
    },

    async configurarTerminal(t) {
      const modelo = await tx.uma<Linha>(
        'SELECT id, tipo, fabricante_terminal_acesso_id FROM modelo_terminal_acesso WHERE id = ?',
        [t.tipoTerminal],
      );
      if (!modelo) throw recusa('tipo-terminal-invalido', 'Escolha o tipo de terminal.', { campos: ['tipoTerminal'] });
      const local = t.local.trim().slice(0, 150);
      const pa = await tx.uma<{ id: unknown }>(
        'SELECT id FROM ponto_acesso WHERE estabelecimento_id = ? AND nome = ? AND excluido_em IS NULL ORDER BY id LIMIT 1',
        [est, local],
      );
      const ponto =
        pa !== null
          ? n(pa.id)
          : await tx.incluir('ponto_acesso', {
              estabelecimento_id: est,
              codigo: codigoDe(local),
              nome: local,
              tipo: 'portaria',
            });
      const valores = {
        ponto_acesso_id: ponto,
        nome: t.nome.slice(0, 150),
        tipo: TIPO_TERMINAL[texto(modelo['tipo'])] ?? 'catraca',
        modelo_terminal_acesso_id: n(modelo['id']),
        sentido: t.sentido,
        ativo: t.ativo,
      };
      const mudou = () => recusa('terminal-mudou', 'O terminal mudou depois que você abriu: abra de novo.');
      try {
        if (t.id === null) {
          const id = await tx.incluir('terminal_acesso', { ...valores, codigo: codigoDe(t.nome) });
          return { id, versao: 1 };
        }
        const [ja] = await tx.consultarParaAtualizar<Linha>(
          `SELECT t.id, t.versao FROM terminal_acesso t JOIN ponto_acesso p ON p.id = t.ponto_acesso_id
            WHERE t.id = ? AND p.estabelecimento_id = ? AND t.excluido_em IS NULL`,
          [t.id, est],
        );
        if (!ja || t.versao === null || n(ja['versao']) !== t.versao) throw mudou();
        const versao = await tx.alterar('terminal_acesso', t.id, t.versao, valores);
        return { id: t.id, versao };
      } catch (x) {
        if (restricaoViolada(x)?.tipo === 'unica')
          throw recusa('terminal-duplicado', 'Já existe um terminal com este nome nesta portaria.', { campos: ['nome'] });
        throw x;
      }
    },

    async registrarEventoCatraca() {
      throw modeloPendente('O registro da passagem pela catraca');
    },
  };
  return gravador;
}

/** Os bloqueios vigentes do atendimento da internação, relidos na transação (para a avaliação). */
async function bloqueiosRelidos(
  tx: TxOperacao,
  est: number,
  atendimento: number,
  paciente: number,
  fuso: string,
): Promise<BloqueioRelido[]> {
  // O bloqueio do atendimento ou, sem atendimento informado, o do paciente (vale em qualquer internação dele).
  const linhas = await tx.consultar(
    `SELECT b.id, b.abrangencia, b.pessoa_portaria_id, b.inicio_em, b.fim_em, b.ativo, b.limite_visitantes,
            b.inclui_acompanhante, m.codigo AS motivo
       FROM bloqueio_visitante b JOIN motivo_bloqueio_visita m ON m.id = b.motivo_bloqueio_visita_id
      WHERE b.estabelecimento_id = ? AND b.ativo = TRUE AND b.excluido_em IS NULL AND b.abrangencia <> 'pessoa'
        AND (b.atendimento_id = ? OR (b.atendimento_id IS NULL AND b.paciente_id = ?))`,
    [est, atendimento, paciente],
    { teto: 500 },
  );
  return linhas.flatMap((r) => {
    const motivo = texto(r['motivo']) as MotivoBloqueioVisita;
    if (!MOTIVOS.includes(motivo)) return [];
    return [
      {
        id: n(r['id']),
        motivo,
        abrangencia: abrangenciaDe(r),
        visitante: nn(r['pessoa_portaria_id']),
        limite: nn(r['limite_visitantes']),
        incluiAcompanhante: verdadeiro(r['inclui_acompanhante']),
        inicio: local(r['inicio_em'], fuso) ?? '',
        fim: local(r['fim_em'], fuso),
        revogado: false,
      },
    ];
  });
}

/** Abrangência da tela: o bloqueio do visitante; o do paciente com limite de visitantes; ou o de todos. */
function abrangenciaDe(r: Linha): 'visitante' | 'limite' | 'todos' {
  if (texto(r['abrangencia']) === 'pessoa_paciente') return 'visitante';
  return r['limite_visitantes'] === null || r['limite_visitantes'] === undefined ? 'todos' : 'limite';
}

/** Código de negócio a partir do nome (letras, dígitos e hífen; até 30). */
function codigoDe(nome: string): string {
  const c = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  return c || 'TERMINAL';
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaPortariaIndisponivel(): PortaPortaria {
  return portaIndisponivel<PortaPortaria>(METODOS_PORTA_PORTARIA);
}

/** Regra efetiva de uma unidade (exportada para os testes da porta). */
export const regraEfetiva = (regras: readonly RegraVisitaRegistrada[], unidade: string): RegraVisita =>
  regraDaUnidade(regras, unidade).regra;
