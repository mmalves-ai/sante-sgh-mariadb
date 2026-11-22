// Porta dos registros clínicos sobre o banco PRÓPRIO do cliente (MariaDB, pelo @sgh/nucleo), só leitura nesta etapa:
// modelos publicados, selo da versão publicada, atendimentos do paciente, conferência do atendimento × paciente e o
// relógio do banco. Tabelas: modelo_documento_clinico, modelo_documento_versao, modelo_especialidade,
// tipo_documento_clinico, registro_assistencial (uso recente), atendimento, categoria_atendimento,
// unidade_assistencial e estabelecimento.
//
// O que ainda não tem adaptador próprio recusa com 501 `pendente-modelo-proprio` (falha fechada, nada lido nem
// gravado), e a gravação fica desligada em `podeGravar` (a tela abre em consulta):
//   - profissional do login: o modelo não liga `usuario` a `profissional` nem dá a ocupação (CBO) do profissional
//     (pedido do lote 01-06);
//   - rascunhos, histórico, respostas, prova e cabeçalho: os tipos ainda trazem a forma antiga da gravação (texto
//     formatado, XML, códigos de ordem e retratos); o redesenho sobre registro_assistencial_resposta e
//     modelo_campo é da onda do PEP (pedido do lote 01-06);
//   - gravações (registrar, rascunho, descarte, suspensão): pelo Executor, depois do redesenho acima.
// Melhoria: modelos e versões da tabela própria (situação publicada e hash da definição congelada), filtro por
// estabelecimento e por exclusão lógica em toda leitura, SQL parametrizado e cliente vindo da configuração.
// Melhoria: o modelo descontinuado é o aposentado (situação explícita), não o sem uso recente; o uso só ordena.
// Melhoria: datas e horas no fuso do estabelecimento (o banco guarda instantes em UTC), inclusive o "agora".
// Melhoria: o atendimento traz o tipo completo da categoria e se está em curso pela situação, saída e alta (sem a
// janela de dias desde a entrada).
import { ErroOperacao, type Leitor } from '@sgh/nucleo';
import type { ContextoRegistro, PortaRegistro } from './registro-porta.js';
import {
  type AtendimentoLido,
  type LiberacaoConsultada,
  type ModeloDoRegistro,
  type RetratosAtuais,
  type SituacaoAtendimento,
  type TipoAtendimento,
  atendimentoEmCurso,
} from './tipos-pep.js';

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoLeituraPep {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
}

/** Atendimentos devolvidos por paciente (a tela mostra os mais recentes). */
export const TETO_ATENDIMENTOS = 200;
/** Janela do "uso recente" que ordena os modelos. */
export const DIAS_USO_RECENTE = 90;

/** Fuso do estabelecimento sem fuso válido no cadastro (o mesmo padrão da coluna estabelecimento.fuso_horario). */
export const FUSO_PADRAO = 'America/Sao_Paulo';

export const MOTIVO_GRAVACAO_PENDENTE =
  'O registro clínico no banco próprio ainda não grava: a tela fica em consulta até o adaptador de gravação.';

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const textoOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const formatadores = new Map<string, Intl.DateTimeFormat>();
function formatador(fuso: string): Intl.DateTimeFormat {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatadores.set(fuso, f);
  }
  return f;
}
/** Fuso IANA válido do estabelecimento; inválido ou vazio cai no padrão. */
export function fusoValido(v: unknown): string {
  const f = textoOuNull(v);
  if (!f) return FUSO_PADRAO;
  try {
    formatador(f);
    return f;
  } catch {
    return FUSO_PADRAO;
  }
}
/**
 * Instante do banco (UTC) na data e hora civil do estabelecimento (AAAA-MM-DDTHH:MM:SS); null se vazio. Os getters
 * locais do processo não entram: o resultado não depende do TZ da máquina.
 */
export const dataHora = (v: unknown, fuso: string): string | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  const partes = formatador(fuso).formatToParts(d);
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? '00';
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}`;
};
const TIPOS_ATENDIMENTO: readonly TipoAtendimento[] = [
  'ambulatorio',
  'pronto_atendimento',
  'externo',
  'internacao',
  'telessaude',
];
const SITUACOES_ATENDIMENTO: readonly SituacaoAtendimento[] = [
  'aberto',
  'em_atendimento',
  'em_observacao',
  'encerrado',
  'cancelado',
];
const deLista = <T extends string>(lista: readonly T[], v: unknown, campo: string): T => {
  if (lista.includes(v as T)) return v as T;
  // O CHECK do banco garante a lista; valor fora dela é defeito do modelo, não dado a adivinhar.
  throw new ErroOperacao(
    500,
    'valor-fora-do-dominio',
    'Valor fora do domínio',
    `O campo ${campo} veio fora da lista.`,
  );
};
/** Número de negócio do atendimento: só dígitos vira número; outro formato fica de fora (null). */
const numeroDoAtendimento = (v: unknown): number | null => {
  const t = textoOuNull(v);
  return t !== null && /^\d{1,15}$/.test(t) ? Number(t) : null;
};

export function recusaPendente(metodo: string): ErroOperacao {
  return new ErroOperacao(
    501,
    'pendente-modelo-proprio',
    'Ainda não disponível no banco próprio',
    `A leitura ou gravação "${metodo}" do registro clínico ainda não tem adaptador no banco próprio.`,
  );
}

/** Estabelecimento da sessão: id e fuso IANA em que as datas e horas são mostradas. */
interface Estabelecimento {
  readonly id: number;
  readonly fuso: string;
}

export class PortaRegistroPropria implements PortaRegistro {
  readonly destino = 'proprio' as const;

  constructor(
    private readonly nucleo: NucleoLeituraPep,
    /** Cliente desta API (configuração; um banco por cliente), quando o contexto da sessão não o traz. */
    private readonly cliente: string,
  ) {}

  private ler<T>(
    c: ContextoRegistro,
    rotulo: string,
    fn: (l: Leitor, estabelecimento: Estabelecimento) => Promise<T>,
  ) {
    return this.nucleo.lerSomente(
      { cliente: c.cliente || this.cliente, correlacao: `pep.registro.${rotulo}` },
      async (l) => fn(l, await this.estabelecimento(l, c.hospital)),
    );
  }

  private async estabelecimento(l: Leitor, codigo: string): Promise<Estabelecimento> {
    const e = await l.uma<{ id: unknown; fuso_horario: unknown }>(
      'SELECT id, fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
      [codigo],
    );
    if (!e)
      throw new ErroOperacao(
        404,
        'estabelecimento-inexistente',
        'Estabelecimento não encontrado',
        'O estabelecimento da sessão não existe neste cliente.',
      );
    return { id: num(e.id), fuso: fusoValido(e.fuso_horario) };
  }

  modelos(c: ContextoRegistro): Promise<ModeloDoRegistro[]> {
    return this.ler(c, 'modelos', async (l, est) => {
      // Os modelos são do cliente inteiro (o construtor publica para o cliente); o uso recente é do estabelecimento e
      // só ordena. Os aposentados vêm marcados (o registro antigo continua consultável; não se registra mais).
      const linhas = await l.consultar(
        `SELECT m.id, m.codigo, m.titulo, m.situacao, t.id AS tipo_id, t.descricao AS tipo_nome,
                (SELECT GROUP_CONCAT(me.especialidade_medica_id ORDER BY me.especialidade_medica_id)
                   FROM modelo_especialidade me
                  WHERE me.modelo_documento_clinico_id = m.id AND me.excluido_em IS NULL) AS especialidades,
                (SELECT COUNT(*) FROM registro_assistencial r
                  WHERE r.modelo_documento_clinico_id = m.id AND r.estabelecimento_id = ?
                    AND r.excluido_em IS NULL AND r.data_hora_lancamento >= NOW() - INTERVAL ? DAY) AS uso
           FROM modelo_documento_clinico m
           JOIN tipo_documento_clinico t ON t.id = m.tipo_documento_clinico_id
          WHERE m.situacao IN ('publicado', 'aposentado') AND m.apenas_impressao = FALSE AND m.excluido_em IS NULL
          ORDER BY uso DESC, m.titulo, m.id`,
        [est.id, DIAS_USO_RECENTE],
      );
      return linhas.map((x) => ({
        id: num(x['id']),
        codigo: textoOuNull(x['codigo']),
        nome: textoOuNull(x['titulo']),
        tipoComposicao: numOuNull(x['tipo_id']),
        nomeTipoComposicao: textoOuNull(x['tipo_nome']),
        especialidades: textoOuNull(x['especialidades'])?.split(',').map(Number) ?? [],
        aposentado: x['situacao'] === 'aposentado',
        usoRecente: num(x['uso']),
      }));
    });
  }

  selo(c: ContextoRegistro, modelo: number): Promise<string> {
    return this.ler(c, 'selo', async (l) => {
      const x = await l.uma(
        `SELECT v.hash_definicao, v.numero_versao
           FROM modelo_documento_clinico m
           JOIN modelo_documento_versao v ON v.id = m.publicada_modelo_documento_versao_id
          WHERE m.id = ? AND m.situacao IN ('publicado', 'aposentado') AND m.excluido_em IS NULL`,
        [modelo],
      );
      if (!x)
        throw new ErroOperacao(
          404,
          'modelo-inexistente',
          'Modelo não encontrado',
          'O modelo não está publicado.',
        );
      // A versão publicada sempre tem hash; sem ele, o número da versão ainda distingue as publicações.
      return textoOuNull(x['hash_definicao']) ?? `versao-${num(x['numero_versao'])}`;
    });
  }

  atendimentos(c: ContextoRegistro, paciente: number): Promise<AtendimentoLido[]> {
    return this.ler(c, 'atendimentos', async (l, est) => {
      const linhas = await l.consultar(
        `SELECT a.id, a.numero, k.tipo_base, a.situacao, a.entrada_em, u.nome AS unidade, a.alta_medica_em, a.saida_em
           FROM atendimento a
           JOIN categoria_atendimento k ON k.id = a.categoria_atendimento_id
           LEFT JOIN unidade_assistencial u ON u.id = a.unidade_assistencial_id
          WHERE a.paciente_id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL
          ORDER BY a.entrada_em DESC, a.id DESC
          LIMIT ${TETO_ATENDIMENTOS}`,
        [paciente, est.id],
      );
      return linhas.map((x) => {
        const altaMedica = dataHora(x['alta_medica_em'], est.fuso);
        const saida = dataHora(x['saida_em'], est.fuso);
        const situacao = deLista(SITUACOES_ATENDIMENTO, x['situacao'], 'situacao');
        return {
          id: num(x['id']),
          numero: numeroDoAtendimento(x['numero']),
          tipo: deLista(TIPOS_ATENDIMENTO, x['tipo_base'], 'tipo_base'),
          aberto: atendimentoEmCurso({ situacao, altaMedica, saida }),
          entrada: dataHora(x['entrada_em'], est.fuso),
          unidade: textoOuNull(x['unidade']),
          // O leito vem da ocupação de leito (internação), lida pela porta da internação: aqui fica vazio.
          leito: null,
          altaMedica,
          saida,
        };
      });
    });
  }

  /**
   * Conferência do atendimento × paciente. No banco próprio não há retratos: o atendimento e o paciente são os
   * próprios registros (os campos do tipo ficam com os mesmos ids até o redesenho da gravação).
   */
  retratos(c: ContextoRegistro, atendimento: number, paciente: number): Promise<RetratosAtuais | null> {
    return this.ler(c, 'retratos', async (l, est) => {
      const x = await l.uma(
        'SELECT paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [atendimento, est.id],
      );
      if (!x) return null;
      return {
        htAtendimento: atendimento,
        htPaciente: paciente,
        doPaciente: num(x['paciente_id']) === paciente,
      };
    });
  }

  agora(c: ContextoRegistro): Promise<string> {
    // O relógio é o do banco (instante em UTC), mostrado no fuso do estabelecimento: "hoje" e a tolerância de
    // lançamento retroativo do serviço comparam com a hora civil local.
    return this.ler(c, 'agora', async (l, est) => {
      const x = await l.uma('SELECT UTC_TIMESTAMP(3) AS agora');
      const v = x?.['agora'];
      const instante = v instanceof Date ? v : new Date(`${String(v).replace(' ', 'T')}Z`);
      return dataHora(instante, est.fuso) ?? '';
    });
  }

  /** A gravação fica desligada até o adaptador de gravação (a tela abre em consulta, com o motivo). */
  async podeGravar(): Promise<LiberacaoConsultada> {
    return { pode: false, codigo: 'pendente-modelo-proprio', motivo: MOTIVO_GRAVACAO_PENDENTE };
  }

  // ── Pendentes (pedidos do lote 01-06): recusa 501, nada lido nem gravado ──────────────────────────────
  profissional(): Promise<never> {
    return Promise.reject(recusaPendente('profissional'));
  }
  definicao(): Promise<never> {
    return Promise.reject(recusaPendente('definicao'));
  }
  rascunhosDoProfissional(): Promise<never> {
    return Promise.reject(recusaPendente('rascunhosDoProfissional'));
  }
  rascunhosDoPaciente(): Promise<never> {
    return Promise.reject(recusaPendente('rascunhosDoPaciente'));
  }
  lerRascunho(): Promise<never> {
    return Promise.reject(recusaPendente('lerRascunho'));
  }
  ultimoRegistro(): Promise<never> {
    return Promise.reject(recusaPendente('ultimoRegistro'));
  }
  historico(): Promise<never> {
    return Promise.reject(recusaPendente('historico'));
  }
  cabecalhoRegistro(): Promise<never> {
    return Promise.reject(recusaPendente('cabecalhoRegistro'));
  }
  respostasRegistro(): Promise<never> {
    return Promise.reject(recusaPendente('respostasRegistro'));
  }
  prova(): Promise<never> {
    return Promise.reject(recusaPendente('prova'));
  }
  cabecalhoDocumento(): Promise<never> {
    return Promise.reject(recusaPendente('cabecalhoDocumento'));
  }
  modelosImpressao(): Promise<never> {
    return Promise.reject(recusaPendente('modelosImpressao'));
  }
  registrar(): Promise<never> {
    return Promise.reject(recusaPendente('registrar'));
  }
  salvarRascunho(): Promise<never> {
    return Promise.reject(recusaPendente('salvarRascunho'));
  }
  descartarRascunho(): Promise<never> {
    return Promise.reject(recusaPendente('descartarRascunho'));
  }
  suspender(): Promise<never> {
    return Promise.reject(recusaPendente('suspender'));
  }
}
