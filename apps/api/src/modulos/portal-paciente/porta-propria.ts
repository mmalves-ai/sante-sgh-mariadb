// Porta PRÓPRIA do portal do paciente (M50, etapa 1) sobre o MariaDB do cliente, pelo @sgh/nucleo.
//   - Leitura: `nucleo.lerSomente` (o paciente e o responsável vigente do cadastro, as capacidades civis, os nomes de
//     quem acessou, os feriados do estabelecimento e as manifestações do paciente feitas pelo portal).
//   - Gravação: o Executor (`definirOperacao`), com a trilha, o outbox e a idempotência na mesma transação. O fato de
//     negócio que o serviço registra (RegistroTrilhaPortal) vai nos dados e no motivo da trilha da operação.
//   - O contexto do portal traz a rede (o código do cliente na plataforma) e o código do estabelecimento; a porta
//     resolve o id do estabelecimento uma vez por código.
//   - As 22 gravações da conta, da troca de e-mail, do vínculo, do consentimento, do pedido do titular e da cópia do
//     prontuário vêm de porta-propria-gravacao.ts (migração 17_INTG/91). As leituras ainda sem escritor próprio aqui
//     (conta, vínculo, consentimento, pedidos, cópias, documentos do portal, relatório de acessos) RECUSAM com 503
//     `recurso-sem-modelo`, nomeando a operação: nada é lido vazio nem gravado pela metade.
// Melhoria: o paciente vem do cadastro único (paciente + pessoa_fisica), com óbito, unificação e responsável legal
//   vigente (responsavel_paciente, papéis legais) sem trazer quem; só o primeiro nome sai da porta.
// Melhoria: os feriados estaduais (UF do município do estabelecimento) entram no prazo em dias úteis.
// Melhoria: a trilha aponta a tabela e o id que a transação gravou, e não o nome que o serviço informa.
// Melhoria: a manifestação do portal entra na ouvidoria única (manifestacao_ouvidoria), com número de negócio por
//   estabelecimento (sequencia_negocio), tipo, canal e motivo pelo catálogo, e prazo de resposta conferido no banco.
import { randomUUID } from 'node:crypto';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type Linha,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import {
  type ContextoPortal,
  type ContextoPortalNucleo,
  type DominiosConsentimento,
  type GravadorPortal,
  type ManifestacaoPortalLida,
  type ManifestacaoPortalParaGravar,
  METODOS_PORTA_PORTAL,
  type PortaPortalPaciente,
  type TrilhaDaGravacao,
} from './porta.js';
import { erroDeDominio, gravadorGravacaoPropria, TABELAS_GRAVACAO_PORTAL } from './porta-propria-gravacao.js';
import type { ItemDominioPortal, PacientePortal, RegistroTrilhaPortal } from './tipos.js';

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoPortal {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

/** Tabelas que a gravação do portal pode tocar (o executor recusa as outras). */
export const TABELAS_PORTAL: readonly string[] = [
  ...new Set(['manifestacao_ouvidoria', 'sequencia_negocio', ...TABELAS_GRAVACAO_PORTAL]),
];

/** Tipo da sequência do número da manifestação (por estabelecimento). */
export const SEQUENCIA_MANIFESTACAO = 'manifestacao_ouvidoria';
/** Código do canal da ouvidoria que identifica o portal do paciente (catálogo canal_ouvidoria). */
export const CANAL_OUVIDORIA_PORTAL = 'portal';
/** Teto das leituras de lista do portal. */
const TETO = 500;
/** Papéis do responsável que valem como guarda legal do paciente. */
const PAPEIS_LEGAIS = ['responsavel_legal', 'guardiao_legal', 'tutor', 'curador'] as const;

/** A operação que o modelo ainda não tem: 503 com o nome da operação (o DDL pedido fica na saída do lote). */
export function semModelo(operacao: string): ErroOperacao {
  return new ErroOperacao(
    503,
    'recurso-sem-modelo',
    'Recurso ainda sem modelo no banco',
    `A operação ${operacao} do portal do paciente ainda não tem tabela no banco do estabelecimento: nada foi lido nem gravado.`,
  );
}

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean => v === true || Number(v) === 1;
function dataIso(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
}
function instanteIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return new Date(String(v)).toISOString();
}
const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? '';

const SQL_PACIENTE = `SELECT p.id, p.numero_prontuario, pf.data_nascimento, p.situacao, p.falecido, p.sobrevivente_paciente_id,
    p.capacidade_civil_id, pf.nome, p.nome_social, p.usa_nome_social,
    EXISTS (SELECT 1 FROM responsavel_paciente r
             WHERE r.paciente_id = p.id AND r.excluido_em IS NULL AND r.papel IN (${PAPEIS_LEGAIS.map(() => '?').join(', ')})
               AND r.vigencia_inicio <= CURRENT_DATE AND (r.vigencia_fim IS NULL OR r.vigencia_fim >= CURRENT_DATE)) AS tem_guardiao
  FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
 WHERE p.excluido_em IS NULL AND pf.excluido_em IS NULL`;

function pacienteDaLinha(x: Linha): PacientePortal {
  const situacao = String(x['situacao']);
  const nome = bool(x['usa_nome_social']) && x['nome_social'] ? String(x['nome_social']) : String(x['nome']);
  return {
    id: num(x['id']),
    prontuario: num(x['numero_prontuario']),
    nascimento: dataIso(x['data_nascimento']),
    ativo: situacao === 'ativo' || situacao === 'provisorio',
    obito: bool(x['falecido']) || situacao === 'obito',
    unificadoEm: situacao === 'unificado' ? numOuNull(x['sobrevivente_paciente_id']) : null,
    primeiroNome: primeiroNome(nome),
    capacidadeCivil: numOuNull(x['capacidade_civil_id']),
    temGuardiao: bool(x['tem_guardiao']),
  };
}

/** A entrada da operação genérica do portal: o que gravar vai na função; a entrada só leva a correlação. */
const entradaGravacao = z.object({ correlacao: z.string().min(1).max(64) }).strict();

export class PortaPortalPropria implements PortaPortalPaciente {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;
  private readonly estabelecimentos = new Map<string, number>();

  constructor(
    private readonly nucleo: NucleoPortal,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPortal, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: c.rede, correlacao: 'portal-paciente' }, fn);
  }

  /** O id do estabelecimento pelo código da sessão (guardado por código; estabelecimento inexistente: 404). */
  async estabelecimento(c: ContextoPortal): Promise<number> {
    const chave = `${c.rede}:${c.hospital}`;
    const guardado = this.estabelecimentos.get(chave);
    if (guardado) return guardado;
    const l = await this.ler(c, (x) =>
      x.uma<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
        c.hospital,
      ]),
    );
    if (!l)
      throw new ErroOperacao(
        404,
        'estabelecimento-inexistente',
        'Estabelecimento inexistente',
        'O estabelecimento da sessão não existe neste cliente.',
      );
    this.estabelecimentos.set(chave, num(l.id));
    return num(l.id);
  }

  async contexto(c: ContextoPortal): Promise<ContextoPortalNucleo> {
    const estabelecimento = await this.estabelecimento(c);
    return {
      cliente: c.rede,
      estabelecimento,
      usuario: null,
      correlacao: 'portal-paciente',
      rede: c.rede,
      hospital: c.hospital,
    };
  }

  async gravar<T>(
    c: ContextoPortal,
    fn: (g: GravadorPortal) => Promise<T>,
    trilha: TrilhaDaGravacao<T>,
  ): Promise<T> {
    const estabelecimento = await this.estabelecimento(c);
    const correlacao = `portal-${randomUUID()}`.slice(0, 64);
    const contexto: ContextoOperacao = {
      cliente: c.rede,
      estabelecimento,
      // O portal grava em nome do paciente (sem usuário do hospital): o fato e a conta vão nos dados da trilha.
      usuario: null,
      correlacao,
      chaveIdempotencia: correlacao,
    };
    let resultado!: T;
    let registro: RegistroTrilhaPortal | null = null;
    // O registro que o pedido do titular e a cópia trazem prontos (vale quando o serviço não informa a trilha).
    let trilhaDoGravador: RegistroTrilhaPortal | null = null;
    // O erro de domínio (ErroPortal, ErroPedido) que o executor traduziria em 500 volta ao serviço após o ROLLBACK.
    let dominio: Error | null = null;
    // A trilha aponta a linha que a transação gravou de fato (nunca o nome de tabela que o serviço informa).
    const escrita: { tabela: string; id: number | null } = { tabela: 'manifestacao_ouvidoria', id: null };
    const op = definirOperacao<{ correlacao: string }, { gravado: boolean }>({
      nome: 'portal-paciente.gravar',
      tabelas: [...TABELAS_PORTAL],
      entrada: entradaGravacao,
      gravar: async (tx) => {
        try {
          resultado = await fn(
            gravadorProprio(tx, estabelecimento, escrita, (r) => {
              trilhaDoGravador = r;
            }),
          );
        } catch (e) {
          dominio = erroDeDominio(e);
          throw e;
        }
        registro = (typeof trilha === 'function' ? trilha(resultado) : trilha) ?? trilhaDoGravador;
        return { gravado: true };
      },
      alvo: () => ({ tabela: escrita.tabela, id: escrita.id }),
      trilha: () => {
        const r = registro as RegistroTrilhaPortal | null;
        if (!r) return {};
        return {
          motivo: r.evento,
          dados: {
            evento: r.evento,
            recurso: r.recurso,
            operacao: r.operacao,
            resultado: r.resultado,
            chave: r.chaveNaturalAlvo,
            paciente: r.idPaciente ?? null,
            atendimento: r.atendimento ?? null,
            origem: r.origem ?? null,
            estacao: r.estacao,
          },
        };
      },
    });
    try {
      await this.executor.executar(op, c.rede, { correlacao }, contexto);
    } catch (e) {
      throw dominio ?? e;
    }
    return resultado;
  }

  // ---------------------------------------------------------------- leituras do modelo

  paciente(c: ContextoPortal, id: number): Promise<PacientePortal | null> {
    // O cadastro do paciente é da rede inteira (um cadastro por pessoa no cliente): sem filtro de estabelecimento.
    return this.ler(c, async (l) => {
      const x = await l.uma(`${SQL_PACIENTE} AND p.id = ?`, [...PAPEIS_LEGAIS, id]);
      return x ? pacienteDaLinha(x) : null;
    });
  }

  pacientesPorProntuario(c: ContextoPortal, prontuario: number): Promise<PacientePortal[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `${SQL_PACIENTE} AND p.numero_prontuario = ? ORDER BY p.id`,
          [...PAPEIS_LEGAIS, prontuario],
          { teto: 10 },
        )
      ).map(pacienteDaLinha),
    );
  }

  capacidadesCivis(c: ContextoPortal): Promise<ItemDominioPortal[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar('SELECT id, descricao FROM capacidade_civil WHERE ativo ORDER BY descricao', [], {
          teto: TETO,
        })
      ).map((x) => ({ id: num(x['id']), descricao: String(x['descricao']) })),
    );
  }

  /** O responsável confere com a guarda legal vigente do titular quando é a mesma pessoa do cadastro. */
  guardiaoConfere(c: ContextoPortal, titular: number, responsavel: number): Promise<boolean> {
    return this.ler(c, async (l) => {
      const x = await l.uma<{ n: number }>(
        `SELECT COUNT(*) AS n FROM responsavel_paciente r JOIN paciente pr ON pr.id = ? AND pr.pessoa_fisica_id = r.pessoa_fisica_id
          WHERE r.paciente_id = ? AND r.excluido_em IS NULL AND r.papel IN (${PAPEIS_LEGAIS.map(() => '?').join(', ')})
            AND r.vigencia_inicio <= CURRENT_DATE AND (r.vigencia_fim IS NULL OR r.vigencia_fim >= CURRENT_DATE)`,
        [responsavel, titular, ...PAPEIS_LEGAIS],
      );
      return num(x?.n ?? 0) > 0;
    });
  }

  nomes(c: ContextoPortal, logins: readonly string[]): Promise<Map<string, string>> {
    const unicos = [...new Set(logins.filter((x) => x))].slice(0, TETO);
    if (unicos.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT login, nome FROM usuario WHERE excluido_em IS NULL AND login IN (${unicos.map(() => '?').join(', ')})`,
        unicos,
        { teto: TETO },
      );
      return new Map(linhas.map((x) => [String(x['login']), String(x['nome'])]));
    });
  }

  async feriados(
    c: ContextoPortal,
    de: string,
    ate: string,
  ): Promise<readonly { data: string; nome: string }[]> {
    const est = await this.estabelecimento(c);
    // Os nacionais, os do estado e os do município do estabelecimento, e os do próprio estabelecimento.
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT f.data, f.nome FROM feriado f
            WHERE f.ativo AND f.excluido_em IS NULL AND f.data BETWEEN ? AND ?
              AND (f.abrangencia = 'nacional'
                   OR (f.abrangencia = 'estabelecimento' AND f.estabelecimento_id = ?)
                   OR (f.abrangencia = 'municipal' AND f.municipio_ibge_id = (SELECT e.municipio_ibge_id FROM estabelecimento e WHERE e.id = ?))
                   OR (f.abrangencia = 'estadual' AND f.uf = (SELECT uf.sigla FROM estabelecimento e
                                                                JOIN municipio_ibge mi ON mi.id = e.municipio_ibge_id
                                                                JOIN unidade_federativa uf ON uf.id = mi.unidade_federativa_id
                                                               WHERE e.id = ?)))
            ORDER BY f.data`,
          [de, ate, est, est, est],
          { teto: TETO },
        )
      ).map((x) => ({ data: dataIso(x['data']) ?? '', nome: String(x['nome']) })),
    );
  }

  async manifestacoes(c: ContextoPortal, paciente: number): Promise<ManifestacaoPortalLida[]> {
    const est = await this.estabelecimento(c);
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT m.id, m.numero, t.codigo AS tipo, mm.codigo AS area, m.relato, m.recebida_em, m.prazo_resposta, m.situacao,
                  m.resposta, m.respondida_em, m.encerrada_em
             FROM manifestacao_ouvidoria m
             JOIN tipo_manifestacao_ouvidoria t ON t.id = m.tipo_manifestacao_ouvidoria_id
             JOIN canal_ouvidoria co ON co.id = m.canal_ouvidoria_id AND co.codigo = ?
             LEFT JOIN motivo_manifestacao mm ON mm.id = m.motivo_manifestacao_id
            WHERE m.estabelecimento_id = ? AND m.paciente_id = ? AND m.excluido_em IS NULL
            ORDER BY m.recebida_em DESC, m.id DESC`,
          [CANAL_OUVIDORIA_PORTAL, est, paciente],
          { teto: TETO },
        )
      ).map((x) => ({
        id: num(x['id']),
        protocolo: String(x['numero']),
        tipo: String(x['tipo']),
        area: x['area'] === null || x['area'] === undefined ? '' : String(x['area']),
        relato: String(x['relato']),
        recebidaEm: instanteIso(x['recebida_em']),
        prazoEm: dataIso(x['prazo_resposta']) ?? '',
        situacao: String(x['situacao']),
        resposta: x['resposta'] === null || x['resposta'] === undefined ? null : String(x['resposta']),
        respondidaEm: x['respondida_em'] ? instanteIso(x['respondida_em']) : null,
        canceladaEm:
          String(x['situacao']) === 'cancelada' && x['encerrada_em'] ? instanteIso(x['encerrada_em']) : null,
      })),
    );
  }

  // ---------------------------------------------------------------- sem modelo (recusa nomeada)

  conta(): Promise<never> {
    return Promise.reject(semModelo('conta'));
  }
  contaPorEmail(): Promise<never> {
    return Promise.reject(semModelo('contaPorEmail'));
  }
  contaPorConvite(): Promise<never> {
    return Promise.reject(semModelo('contaPorConvite'));
  }
  trocaEmailPorToken(): Promise<never> {
    return Promise.reject(semModelo('trocaEmailPorToken'));
  }
  trocaEmailPendente(): Promise<never> {
    return Promise.reject(semModelo('trocaEmailPendente'));
  }
  contaDoPaciente(): Promise<never> {
    return Promise.reject(semModelo('contaDoPaciente'));
  }
  contasAbertas(): Promise<never> {
    return Promise.reject(semModelo('contasAbertas'));
  }
  vinculosDaConta(): Promise<never> {
    return Promise.reject(semModelo('vinculosDaConta'));
  }
  vinculosDoTitular(): Promise<never> {
    return Promise.reject(semModelo('vinculosDoTitular'));
  }
  vinculo(): Promise<never> {
    return Promise.reject(semModelo('vinculo'));
  }
  filaVinculos(): Promise<never> {
    return Promise.reject(semModelo('filaVinculos'));
  }
  vinculosAtivos(): Promise<never> {
    return Promise.reject(semModelo('vinculosAtivos'));
  }
  dominiosConsentimento(): Promise<DominiosConsentimento> {
    return Promise.reject(semModelo('dominiosConsentimento'));
  }
  consentimentos(): Promise<never> {
    return Promise.reject(semModelo('consentimentos'));
  }
  pedidos(): Promise<never> {
    return Promise.reject(semModelo('pedidos'));
  }
  documentos(): Promise<never> {
    return Promise.reject(semModelo('documentos'));
  }
  leituras(): Promise<never> {
    return Promise.reject(semModelo('leituras'));
  }
  filaCopias(): Promise<never> {
    return Promise.reject(semModelo('filaCopias'));
  }
  atosCopia(): Promise<never> {
    return Promise.reject(semModelo('atosCopia'));
  }
}

/** As gravações sobre a transação da operação: as 22 do portal (porta-propria-gravacao.ts) e a manifestação. */
function gravadorProprio(
  tx: TxOperacao,
  estabelecimento: number,
  escrita: { tabela: string; id: number | null },
  aoTrilhar: (r: RegistroTrilhaPortal) => void,
): GravadorPortal {
  return {
    ...gravadorGravacaoPropria(tx, estabelecimento, escrita, aoTrilhar),
    registrarManifestacao: async (m) => {
      const r = await registrarManifestacao(tx, estabelecimento, m);
      escrita.tabela = 'manifestacao_ouvidoria';
      escrita.id = r.id;
      return r;
    },
  };
}

async function idDoCatalogo(
  tx: TxOperacao,
  tabela: 'tipo_manifestacao_ouvidoria' | 'canal_ouvidoria',
  codigo: string,
) {
  const sql = {
    tipo_manifestacao_ouvidoria: 'SELECT id FROM tipo_manifestacao_ouvidoria WHERE codigo = ? AND ativo',
    canal_ouvidoria: 'SELECT id FROM canal_ouvidoria WHERE codigo = ? AND ativo',
  }[tabela];
  const l = await tx.uma<{ id: number }>(sql, [codigo]);
  return l ? num(l.id) : null;
}

/** Código do motivo geral (o assunto padrão do portal; ver AREA_OUVIDORIA_PORTAL no serviço). */
const AREA_PADRAO_PORTAL = 'geral';

async function motivoDoAssunto(tx: TxOperacao, assunto: string): Promise<number | null> {
  const l = await tx.uma<{ id: number }>(
    `SELECT id FROM motivo_manifestacao
      WHERE ativo AND (codigo = ? OR LOWER(descricao) = LOWER(?))
      ORDER BY codigo = ? DESC, id LIMIT 1`,
    [assunto, assunto, assunto],
  );
  return l ? num(l.id) : null;
}

/** A manifestação do portal na ouvidoria única: identificada, com o paciente da sessão, canal do portal. */
async function registrarManifestacao(
  tx: TxOperacao,
  estabelecimento: number,
  m: ManifestacaoPortalParaGravar,
): Promise<{ id: number; protocolo: string }> {
  const tipo = await idDoCatalogo(tx, 'tipo_manifestacao_ouvidoria', m.tipo);
  if (tipo === null)
    throw new ErroOperacao(
      422,
      'tipo-invalido',
      'Tipo de manifestação desconhecido',
      'O tipo da manifestação não está no catálogo da ouvidoria.',
      { campos: ['tipo'] },
    );
  const canal = await idDoCatalogo(tx, 'canal_ouvidoria', CANAL_OUVIDORIA_PORTAL);
  if (canal === null)
    throw new ErroOperacao(
      503,
      'canal-portal-ausente',
      'Canal do portal não cadastrado',
      `Cadastre o canal "${CANAL_OUVIDORIA_PORTAL}" no catálogo de canais da ouvidoria.`,
    );
  // O assunto: o motivo do catálogo pelo código ou pela descrição; o texto livre que não bate vai no relato (a
  // ouvidoria classifica na triagem). Nunca recusa a manifestação por causa do assunto.
  const area = m.area?.trim() ?? '';
  const motivo = area ? await motivoDoAssunto(tx, area) : null;
  const relato =
    area && motivo === null && area !== AREA_PADRAO_PORTAL
      ? `Assunto informado: ${area}\n\n${m.relato}`
      : m.relato;
  await garantirSequencia(
    tx,
    { tipo: SEQUENCIA_MANIFESTACAO, estabelecimento },
    { usuario: tx.contexto.usuario, agora: new Date() },
  );
  const numero = await tx.proximoNumero(SEQUENCIA_MANIFESTACAO);
  const protocolo = m.protocoloDe(numero.valor);
  const id = await tx.incluir('manifestacao_ouvidoria', {
    estabelecimento_id: estabelecimento,
    numero: protocolo,
    instancia: 'hospital',
    tipo_manifestacao_ouvidoria_id: tipo,
    canal_ouvidoria_id: canal,
    motivo_manifestacao_id: motivo,
    identificada: true,
    sigilosa: false,
    paciente_id: m.paciente,
    deseja_retorno: false,
    relato,
    recebida_em: new Date(m.recebidaEm),
    prioridade: 'media',
    prazo_resposta: m.prazoEm.slice(0, 10),
    situacao: 'aberta',
  });
  return { id, protocolo };
}

/** Porta sem banco configurado: 503 em toda leitura e gravação (falha fechada). */
export function portaPortalIndisponivel(): PortaPortalPaciente {
  return indisponivel<PortaPortalPaciente>(METODOS_PORTA_PORTAL);
}

export function indisponivel<P extends object>(metodos: ReadonlySet<string>): P {
  const recusar = (): Promise<never> =>
    Promise.reject(
      new ErroOperacao(
        503,
        'indisponivel',
        'Banco do estabelecimento indisponível',
        'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
      ),
    );
  return new Proxy({} as P, {
    get: (_t, chave) => {
      if (chave === 'destino') return 'banco';
      if (typeof chave !== 'string' || !metodos.has(chave)) return undefined;
      return recusar;
    },
  });
}
