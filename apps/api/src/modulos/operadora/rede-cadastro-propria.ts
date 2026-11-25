// Porta própria do cadastro complementar do prestador da rede credenciada (08-SGO L101, C2-118; F7) sobre o banco do
// cliente:
// - os locais de atendimento (local_atendimento_rede): endereço, CNES, contato, acessibilidade, o principal e a
//   divulgação no guia; desligado com data e motivo, nunca apagado;
// - as especialidades atendidas (especialidade_atendida_rede) por local ou em todos, com os regimes, o público e o RQE;
//   encerradas, nunca apagadas;
// - a qualificação divulgada (qualificacao_prestador_rede) pelo catálogo de atributos (atributo_qualificacao_rede),
//   com a validade; encerrada pela data de fim;
// - a suspensão temporária (suspensao_prestador_rede) do prestador inteiro ou de um local, com motivo e período;
//   a reativação encerra (ou cancela a programada);
// - a leitura do registro do descredenciamento (descredenciamento_prestador), gravado pela porta da rede.
// A regra vem do domínio (rede-cadastro.ts); o banco só guarda. Cada gravação é uma operação do Executor (trilha na
// mesma transação). O escopo é o estabelecimento da sessão (prestador de outro estabelecimento: 404).
import {
  type AtributoQualificacao,
  cepNormalizado,
  chaveEspecialidade,
  type DesligamentoLocal,
  type EspecialidadeEntrada,
  type LocalAtendimentoEntrada,
  type ProblemaCadastroRede,
  problemasDaEspecialidade,
  problemasDaQualificacao,
  problemasDaReativacaoPrestador,
  problemasDaSuspensao,
  problemasDoDesligamento,
  problemasDoLocal,
  type QualificacaoEntrada,
  qualificacaoVigente,
  type SituacaoSuspensao,
  situacaoDaSuspensao,
  type SuspensaoEntrada,
} from '@sgh/dominio-operadora';
import {
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
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

export const PORTA_REDE_CADASTRO = Symbol('PORTA_REDE_CADASTRO_OPERADORA');

export const TABELAS_REDE_CADASTRO = [
  'prestador_rede',
  'local_atendimento_rede',
  'especialidade_atendida_rede',
  'qualificacao_prestador_rede',
  'suspensao_prestador_rede',
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
const desatualizado = () =>
  recusa('versao-desatualizada', 'O registro mudou desde a leitura: abra de novo e repita.');
function exigir(problemas: readonly ProblemaCadastroRede[]): void {
  const p = problemas[0];
  if (p) throw recusa(p.codigo, p.detalhe, { campos: [...new Set(problemas.map((x) => x.campo))] });
}
const esquemaEntrada = z.record(z.string(), z.unknown());
const nulo = (v: string | null | undefined) => (v ?? '').trim() || null;

// ---- leituras ----
export interface LocalLido extends LocalAtendimentoEntrada {
  id: number;
  versao: number;
  sequencia: number;
  ativo: boolean;
  desligadoEm: string | null;
  motivoDesligamento: string | null;
}
export interface EspecialidadeLida extends EspecialidadeEntrada {
  id: number;
  versao: number;
  descricao: string;
  situacao: string;
}
export interface QualificacaoLida extends QualificacaoEntrada {
  id: number;
  versao: number;
  codigoAtributo: string;
  descricaoAtributo: string;
  vigente: boolean;
}
export interface SuspensaoLida {
  id: number;
  versao: number;
  motivo: string;
  local: number | null;
  desde: string;
  reativadoEm: string | null;
  situacao: SituacaoSuspensao | 'cancelada';
  observacao: string | null;
}
export interface DescredenciamentoLido {
  id: number;
  tipoMotivo: string;
  motivo: string;
  avisoBeneficiariosEm: string;
  efetivoEm: string;
  substituto: number | null;
  nomeSubstituto: string | null;
  autorizacaoAns: string | null;
  situacao: string;
  registradoEm: string | null;
}
export interface FichaCadastroRede {
  prestador: { id: number; nome: string; pessoa: 'F' | 'J'; hospitalar: boolean; credenciado: boolean };
  locais: LocalLido[];
  especialidades: EspecialidadeLida[];
  qualificacoes: QualificacaoLida[];
  suspensoes: SuspensaoLida[];
  descredenciamentos: DescredenciamentoLido[];
  /** A suspensão que vale hoje para o prestador inteiro (null: atende). */
  suspensoHoje: boolean;
}
export interface ApoioCadastroRede {
  especialidades: { id: number; codigo: string; descricao: string }[];
  atributos: {
    id: number;
    codigo: string;
    descricao: string;
    sigla: string | null;
    pessoaFisica: boolean;
    pessoaJuridica: boolean;
    hospital: boolean;
  }[];
}

interface PrestadorBase {
  id: number;
  nome: string;
  pessoa: 'F' | 'J';
  hospitalar: boolean;
  credenciado: boolean;
}
async function lerPrestador(l: Leitor, est: number, id: number): Promise<PrestadorBase | null> {
  const p = await l.uma(
    `SELECT id, nome, pessoa, classificacao,
            (situacao = 'credenciado' OR (situacao = 'descredenciado' AND descredenciado_em > CURRENT_DATE)) AS credenciado
       FROM prestador_rede WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est],
  );
  if (!p) return null;
  return {
    id: Number(p['id']),
    nome: textoObrigatorio(p['nome']),
    pessoa: textoObrigatorio(p['pessoa']) === 'fisica' ? 'F' : 'J',
    hospitalar: textoObrigatorio(p['classificacao']) === 'assistencia_hospitalar',
    credenciado: booleano(p['credenciado']),
  };
}

async function lerLocais(l: Leitor, prestador: number): Promise<LocalLido[]> {
  const rs = await l.consultar(
    `SELECT la.*, mi.codigo_ibge FROM local_atendimento_rede la
       JOIN municipio_ibge mi ON mi.id = la.municipio_ibge_id
      WHERE la.prestador_rede_id = ? AND la.excluido_em IS NULL ORDER BY la.ativo DESC, la.principal DESC, la.sequencia`,
    [prestador],
    { teto: 500 },
  );
  return rs.map((x) => ({
    id: Number(x['id']),
    versao: Number(x['versao']),
    sequencia: Number(x['sequencia']),
    nome: texto(x['nome_local']),
    cnes: texto(x['cnes']),
    cep: textoObrigatorio(x['cep']),
    logradouro: textoObrigatorio(x['logradouro']),
    numero: texto(x['numero']),
    complemento: texto(x['complemento']),
    bairro: texto(x['bairro']),
    municipioIbge: Number(x['codigo_ibge']),
    latitude: numero(x['latitude']),
    longitude: numero(x['longitude']),
    telefone: texto(x['telefone']),
    email: texto(x['email']),
    acessivelCadeirante: booleano(x['acessivel_cadeirante']),
    estacionamento: booleano(x['possui_estacionamento']),
    principal: booleano(x['principal']),
    divulga: booleano(x['divulga_guia_rede']),
    ativo: booleano(x['ativo']),
    desligadoEm: dataIso(x['desligado_em']),
    motivoDesligamento: texto(x['motivo_desligamento']),
  }));
}

async function lerEspecialidades(l: Leitor, prestador: number): Promise<EspecialidadeLida[]> {
  const rs = await l.consultar(
    `SELECT ea.*, em.descricao FROM especialidade_atendida_rede ea
       JOIN especialidade_medica em ON em.id = ea.especialidade_medica_id
      WHERE ea.prestador_rede_id = ? AND ea.excluido_em IS NULL
      ORDER BY (ea.situacao = 'ativa') DESC, ea.principal DESC, em.descricao, ea.id`,
    [prestador],
    { teto: 1000 },
  );
  return rs.map((x) => ({
    id: Number(x['id']),
    versao: Number(x['versao']),
    especialidade: Number(x['especialidade_medica_id']),
    descricao: textoObrigatorio(x['descricao']),
    local: inteiro(x['local_atendimento_rede_id']),
    ambulatorio: booleano(x['atende_ambulatorio']),
    internacao: booleano(x['atende_internacao']),
    urgencia: booleano(x['atende_urgencia']),
    hospitalDia: booleano(x['atende_hospital_dia']),
    adulto: booleano(x['atende_adulto']),
    pediatrico: booleano(x['atende_pediatrico']),
    rqe: texto(x['registro_especialista']),
    principal: booleano(x['principal']),
    divulga: booleano(x['divulga_guia_medico']),
    situacao: textoObrigatorio(x['situacao']),
  }));
}

async function lerQualificacoes(l: Leitor, prestador: number, hoje: string): Promise<QualificacaoLida[]> {
  const rs = await l.consultar(
    `SELECT q.*, a.codigo_ans, a.descricao AS descricao_atributo FROM qualificacao_prestador_rede q
       JOIN atributo_qualificacao_rede a ON a.id = q.atributo_qualificacao_rede_id
      WHERE q.prestador_rede_id = ? AND q.excluido_em IS NULL ORDER BY q.vigencia_inicio DESC, q.id DESC`,
    [prestador],
    { teto: 500 },
  );
  return rs.map((x) => {
    const q = {
      atributo: Number(x['atributo_qualificacao_rede_id']),
      nivel: texto(x['nivel']),
      titulo: texto(x['titulo']),
      divulga: booleano(x['divulga']),
      vigenciaInicio: dataIso(x['vigencia_inicio']) ?? '',
      vigenciaFim: dataIso(x['vigencia_fim']),
    };
    return {
      ...q,
      id: Number(x['id']),
      versao: Number(x['versao']),
      codigoAtributo: textoObrigatorio(x['codigo_ans']),
      descricaoAtributo: textoObrigatorio(x['descricao_atributo']),
      vigente: qualificacaoVigente(q, hoje),
    };
  });
}

async function lerSuspensoes(l: Leitor, prestador: number, hoje: string): Promise<SuspensaoLida[]> {
  const rs = await l.consultar(
    `SELECT * FROM suspensao_prestador_rede WHERE prestador_rede_id = ? AND excluido_em IS NULL
      ORDER BY suspenso_desde DESC, id DESC`,
    [prestador],
    { teto: 500 },
  );
  return rs.map((x) => {
    const desde = dataIso(x['suspenso_desde']) ?? '';
    const reativadoEm = dataIso(x['reativado_em']);
    const gravada = textoObrigatorio(x['situacao']);
    return {
      id: Number(x['id']),
      versao: Number(x['versao']),
      motivo: textoObrigatorio(x['motivo']),
      local: inteiro(x['local_atendimento_rede_id']),
      desde,
      reativadoEm,
      situacao: gravada === 'cancelada' ? 'cancelada' : situacaoDaSuspensao(desde, reativadoEm, hoje),
      observacao: texto(x['observacao']),
    };
  });
}

async function lerDescredenciamentos(l: Leitor, prestador: number): Promise<DescredenciamentoLido[]> {
  const rs = await l.consultar(
    `SELECT d.*, s.nome AS nome_substituto FROM descredenciamento_prestador d
       LEFT JOIN prestador_rede s ON s.id = d.substituto_prestador_rede_id
      WHERE d.prestador_rede_id = ? AND d.excluido_em IS NULL ORDER BY d.efetivo_em DESC, d.id DESC`,
    [prestador],
    { teto: 200 },
  );
  return rs.map((x) => ({
    id: Number(x['id']),
    tipoMotivo: textoObrigatorio(x['tipo_motivo']),
    motivo: textoObrigatorio(x['motivo']),
    avisoBeneficiariosEm: dataIso(x['aviso_beneficiarios_em']) ?? '',
    efetivoEm: dataIso(x['efetivo_em']) ?? '',
    substituto: inteiro(x['substituto_prestador_rede_id']),
    nomeSubstituto: texto(x['nome_substituto']),
    autorizacaoAns: texto(x['autorizacao_ans_processo']),
    situacao: textoObrigatorio(x['situacao']),
    registradoEm: instanteIso(x['criado_em']),
  }));
}

export class PortaRedeCadastroPropria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoOperadora,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor, est: number, hoje: string) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.correlacao || 'operadora-rede-cadastro' },
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
    fn: (tx: TxOperacao, est: number, hoje: string) => Promise<Gravado>,
  ): Promise<Gravado> {
    const est = await this.ler(c, async (_l, e) => e);
    const operacao = definirOperacao<Record<string, unknown>, Gravado>({
      nome,
      tabelas: TABELAS_REDE_CADASTRO,
      entrada: esquemaEntrada,
      acao: 'operacao',
      gravar: async (tx) => {
        const h = await tx.uma<{ hoje: unknown }>('SELECT CURRENT_DATE AS hoje');
        return fn(tx, est, dataIso(h?.['hoje']) ?? new Date().toISOString().slice(0, 10));
      },
      alvo: (_e, r) => ({ tabela, id: r.id }),
      trilha: (_e, r) => {
        const l = trilha(r);
        return { dados: l.dadosDepois, motivo: l.motivo ?? null };
      },
    });
    const r = await this.executor.executar(
      operacao,
      this.cliente,
      {},
      contextoDireto(this.cliente, est, c, null),
    );
    return r.resultado;
  }

  /** O prestador do estabelecimento travado para a gravação (404 fora dele). */
  private async prestador(tx: TxOperacao, est: number, id: number): Promise<PrestadorBase> {
    const [p] = await tx.consultarParaAtualizar(
      'SELECT id FROM prestador_rede WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [id, est],
      { teto: 1 },
    );
    if (!p) throw naoEncontrado();
    const b = await lerPrestador(tx, est, id);
    if (!b) throw naoEncontrado();
    return b;
  }

  /** A linha filha travada (do prestador do estabelecimento), com a versão conferida. */
  private async filha(
    tx: TxOperacao,
    est: number,
    tabela:
      | 'local_atendimento_rede'
      | 'especialidade_atendida_rede'
      | 'qualificacao_prestador_rede'
      | 'suspensao_prestador_rede',
    id: number,
    versao: number,
  ) {
    let sql = 'SELECT t.* FROM local_atendimento_rede t';
    if (tabela === 'especialidade_atendida_rede') sql = 'SELECT t.* FROM especialidade_atendida_rede t';
    else if (tabela === 'qualificacao_prestador_rede') sql = 'SELECT t.* FROM qualificacao_prestador_rede t';
    else if (tabela === 'suspensao_prestador_rede') sql = 'SELECT t.* FROM suspensao_prestador_rede t';
    const [x] = await tx.consultarParaAtualizar(
      `${sql} JOIN prestador_rede p ON p.id = t.prestador_rede_id
        WHERE t.id = ? AND p.estabelecimento_id = ? AND t.excluido_em IS NULL`,
      [id, est],
      { teto: 1 },
    );
    if (!x) throw naoEncontrado();
    if (Number(x['versao']) !== versao) throw desatualizado();
    return x;
  }

  private async locaisAtivos(tx: Leitor, prestador: number): Promise<Set<number>> {
    const rs = await tx.consultar(
      'SELECT id FROM local_atendimento_rede WHERE prestador_rede_id = ? AND ativo = TRUE AND excluido_em IS NULL',
      [prestador],
      { teto: 500 },
    );
    return new Set(rs.map((x) => Number(x['id'])));
  }

  // ======== leituras ========
  apoio(c: ContextoPorta): Promise<ApoioCadastroRede> {
    return this.ler(c, async (l, _est, hoje) => ({
      especialidades: (
        await l.consultar(
          'SELECT id, codigo, descricao FROM especialidade_medica WHERE ativo = TRUE ORDER BY descricao',
          [],
          {
            teto: 2000,
          },
        )
      ).map((x) => ({
        id: Number(x['id']),
        codigo: textoObrigatorio(x['codigo']),
        descricao: textoObrigatorio(x['descricao']),
      })),
      atributos: (
        await l.consultar(
          `SELECT * FROM atributo_qualificacao_rede WHERE vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
            ORDER BY descricao`,
          [hoje, hoje],
          { teto: 500 },
        )
      ).map((x) => ({
        id: Number(x['id']),
        codigo: textoObrigatorio(x['codigo_ans']),
        descricao: textoObrigatorio(x['descricao']),
        sigla: texto(x['sigla']),
        pessoaFisica: booleano(x['aplica_pessoa_fisica']),
        pessoaJuridica: booleano(x['aplica_pessoa_juridica']),
        hospital: booleano(x['aplica_hospital']),
      })),
    }));
  }

  ficha(c: ContextoPorta, prestador: number): Promise<FichaCadastroRede> {
    return this.ler(c, async (l, est, hoje) => {
      const p = await lerPrestador(l, est, prestador);
      if (!p) throw naoEncontrado();
      const suspensoes = await lerSuspensoes(l, prestador, hoje);
      return {
        prestador: p,
        locais: await lerLocais(l, prestador),
        especialidades: await lerEspecialidades(l, prestador),
        qualificacoes: await lerQualificacoes(l, prestador, hoje),
        suspensoes,
        descredenciamentos: await lerDescredenciamentos(l, prestador),
        suspensoHoje: suspensoes.some((s) => s.local === null && s.situacao === 'ativa'),
      };
    });
  }

  // ======== locais ========
  incluirLocal(c: ContextoPorta, prestador: number, e: LocalAtendimentoEntrada, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.rede.local-incluir',
      'local_atendimento_rede',
      trilha,
      async (tx, est) => {
        await this.prestador(tx, est, prestador);
        exigir(problemasDoLocal(e));
        const mun = await tx.uma('SELECT id FROM municipio_ibge WHERE codigo_ibge = ?', [
          String(e.municipioIbge).padStart(7, '0'),
        ]);
        if (!mun)
          throw recusa('municipio-inexistente', 'O município não está no cadastro do IBGE do cliente.', {
            campos: ['municipioIbge'],
          });
        const seq = await tx.uma<{ s: unknown }>(
          'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM local_atendimento_rede WHERE prestador_rede_id = ?',
          [prestador],
        );
        // Um só principal: o anterior deixa de ser.
        const ativos = await tx.consultar(
          'SELECT id, versao, principal FROM local_atendimento_rede WHERE prestador_rede_id = ? AND ativo = TRUE AND excluido_em IS NULL',
          [prestador],
          { teto: 500 },
        );
        const principal = e.principal || ativos.length === 0;
        if (principal)
          for (const a of ativos.filter((x) => booleano(x['principal'])))
            await tx.alterar('local_atendimento_rede', Number(a['id']), Number(a['versao']), {
              principal: false,
            });
        const id = await tx.incluir('local_atendimento_rede', {
          prestador_rede_id: prestador,
          sequencia: Number(seq?.['s'] ?? 1),
          nome_local: nulo(e.nome),
          cnes: nulo(e.cnes),
          cep: cepNormalizado(e.cep),
          logradouro: e.logradouro.trim(),
          numero: nulo(e.numero),
          complemento: nulo(e.complemento),
          bairro: nulo(e.bairro),
          municipio_ibge_id: Number(mun['id']),
          latitude: e.latitude,
          longitude: e.longitude,
          telefone: nulo(e.telefone),
          email: nulo(e.email),
          acessivel_cadeirante: e.acessivelCadeirante,
          possui_estacionamento: e.estacionamento,
          principal,
          divulga_guia_rede: e.divulga,
          ativo: true,
        });
        return { id, versao: 1, principal };
      },
    );
  }

  desligarLocal(c: ContextoPorta, local: number, versao: number, d: DesligamentoLocal, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.rede.local-desligar',
      'local_atendimento_rede',
      trilha,
      async (tx, est, hoje) => {
        const x = await this.filha(tx, est, 'local_atendimento_rede', local, versao);
        const esp = await tx.uma<{ n: unknown }>(
          `SELECT COUNT(*) AS n FROM especialidade_atendida_rede
          WHERE local_atendimento_rede_id = ? AND situacao = 'ativa' AND excluido_em IS NULL`,
          [local],
        );
        exigir(
          problemasDoDesligamento(
            { ativo: booleano(x['ativo']), especialidadesAtivas: Number(esp?.['n'] ?? 0) },
            d,
            hoje,
          ),
        );
        const v = await tx.alterar('local_atendimento_rede', local, versao, {
          ativo: false,
          principal: false,
          desligado_em: d.desligadoEm,
          motivo_desligamento: d.motivo.trim(),
        });
        return { id: local, versao: v };
      },
    );
  }

  // ======== especialidades ========
  incluirEspecialidade(c: ContextoPorta, prestador: number, e: EspecialidadeEntrada, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.rede.especialidade-incluir',
      'especialidade_atendida_rede',
      trilha,
      async (tx, est) => {
        const p = await this.prestador(tx, est, prestador);
        const esp = await tx.uma('SELECT id FROM especialidade_medica WHERE id = ? AND ativo = TRUE', [
          e.especialidade,
        ]);
        if (!esp)
          throw recusa('especialidade-inexistente', 'A especialidade não está no cadastro.', {
            campos: ['especialidade'],
          });
        const ativas = await tx.consultar(
          `SELECT especialidade_medica_id, local_atendimento_rede_id FROM especialidade_atendida_rede
          WHERE prestador_rede_id = ? AND situacao = 'ativa' AND excluido_em IS NULL`,
          [prestador],
          { teto: 1000 },
        );
        exigir(
          problemasDaEspecialidade(e, {
            pessoa: p.pessoa,
            locaisAtivos: await this.locaisAtivos(tx, prestador),
            jaAtivas: new Set(
              ativas.map((x) =>
                chaveEspecialidade(
                  Number(x['especialidade_medica_id']),
                  inteiro(x['local_atendimento_rede_id']),
                ),
              ),
            ),
          }),
        );
        const id = await tx.incluir('especialidade_atendida_rede', {
          prestador_rede_id: prestador,
          local_atendimento_rede_id: e.local,
          especialidade_medica_id: e.especialidade,
          principal: e.principal,
          divulga_guia_medico: e.divulga,
          atende_ambulatorio: e.ambulatorio,
          atende_internacao: e.internacao,
          atende_urgencia: e.urgencia,
          atende_hospital_dia: e.hospitalDia,
          atende_adulto: e.adulto,
          atende_pediatrico: e.pediatrico,
          registro_especialista: nulo(e.rqe),
          situacao: 'ativa',
        });
        return { id, versao: 1 };
      },
    );
  }

  encerrarEspecialidade(c: ContextoPorta, id: number, versao: number, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.rede.especialidade-encerrar',
      'especialidade_atendida_rede',
      trilha,
      async (tx, est) => {
        const x = await this.filha(tx, est, 'especialidade_atendida_rede', id, versao);
        if (textoObrigatorio(x['situacao']) === 'encerrada')
          throw recusa('especialidade-encerrada', 'A especialidade já está encerrada.', {
            campos: ['especialidade'],
          });
        const v = await tx.alterar('especialidade_atendida_rede', id, versao, { situacao: 'encerrada' });
        return { id, versao: v };
      },
    );
  }

  // ======== qualificação ========
  incluirQualificacao(c: ContextoPorta, prestador: number, q: QualificacaoEntrada, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.rede.qualificacao-incluir',
      'qualificacao_prestador_rede',
      trilha,
      async (tx, est, hoje) => {
        const p = await this.prestador(tx, est, prestador);
        const a = await tx.uma('SELECT * FROM atributo_qualificacao_rede WHERE id = ?', [q.atributo]);
        const atributo: AtributoQualificacao | null = a
          ? {
              id: Number(a['id']),
              pessoaFisica: booleano(a['aplica_pessoa_fisica']),
              pessoaJuridica: booleano(a['aplica_pessoa_juridica']),
              hospital: booleano(a['aplica_hospital']),
              vigenciaInicio: dataIso(a['vigencia_inicio']) ?? '',
              vigenciaFim: dataIso(a['vigencia_fim']),
            }
          : null;
        const vigentes = await tx.consultar(
          `SELECT atributo_qualificacao_rede_id FROM qualificacao_prestador_rede
          WHERE prestador_rede_id = ? AND excluido_em IS NULL AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
          [prestador, hoje],
          { teto: 500 },
        );
        exigir(
          problemasDaQualificacao(
            q,
            atributo,
            p,
            new Set(vigentes.map((x) => Number(x['atributo_qualificacao_rede_id']))),
          ),
        );
        const seq = await tx.uma<{ s: unknown }>(
          'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM qualificacao_prestador_rede WHERE prestador_rede_id = ?',
          [prestador],
        );
        const id = await tx.incluir('qualificacao_prestador_rede', {
          prestador_rede_id: prestador,
          sequencia: Number(seq?.['s'] ?? 1),
          atributo_qualificacao_rede_id: q.atributo,
          nivel: nulo(q.nivel),
          titulo: nulo(q.titulo),
          divulga: q.divulga,
          vigencia_inicio: q.vigenciaInicio,
          vigencia_fim: q.vigenciaFim,
        });
        return { id, versao: 1 };
      },
    );
  }

  encerrarQualificacao(c: ContextoPorta, id: number, versao: number, fim: string, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.rede.qualificacao-encerrar',
      'qualificacao_prestador_rede',
      trilha,
      async (tx, est) => {
        const x = await this.filha(tx, est, 'qualificacao_prestador_rede', id, versao);
        const inicio = dataIso(x['vigencia_inicio']) ?? '';
        if (fim < inicio)
          throw recusa('vigencia-invertida', 'O fim da validade não pode ser antes do início.', {
            campos: ['vigenciaFim'],
          });
        const atual = dataIso(x['vigencia_fim']);
        if (atual !== null && atual <= fim)
          throw recusa('qualificacao-encerrada', 'A qualificação já termina nesta data ou antes.', {
            campos: ['vigenciaFim'],
          });
        const v = await tx.alterar('qualificacao_prestador_rede', id, versao, { vigencia_fim: fim });
        return { id, versao: v };
      },
    );
  }

  // ======== suspensão ========
  suspender(c: ContextoPorta, prestador: number, s: SuspensaoEntrada, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.rede.suspender',
      'suspensao_prestador_rede',
      trilha,
      async (tx, est, hoje) => {
        const p = await this.prestador(tx, est, prestador);
        const abertas = await tx.consultar(
          `SELECT local_atendimento_rede_id FROM suspensao_prestador_rede
          WHERE prestador_rede_id = ? AND excluido_em IS NULL AND situacao IN ('programada','ativa')
            AND (reativado_em IS NULL OR reativado_em > ?)`,
          [prestador, hoje],
          { teto: 500 },
        );
        exigir(
          problemasDaSuspensao(
            s,
            {
              credenciado: p.credenciado,
              locaisAtivos: await this.locaisAtivos(tx, prestador),
              abertas: abertas.map((x) => inteiro(x['local_atendimento_rede_id'])),
            },
            hoje,
          ),
        );
        const ativa = s.desde <= hoje;
        const id = await tx.incluir('suspensao_prestador_rede', {
          prestador_rede_id: prestador,
          local_atendimento_rede_id: s.local,
          motivo: s.motivo,
          suspenso_desde: s.desde,
          reativado_em: s.reativacaoPrevista,
          suspensao_executada_em: ativa ? new Date() : null,
          situacao: ativa ? 'ativa' : 'programada',
          observacao: nulo(s.observacao),
        });
        return { id, versao: 1, situacao: ativa ? 'ativa' : 'programada' };
      },
    );
  }

  reativar(c: ContextoPorta, id: number, versao: number, reativadoEm: string, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.rede.reativar',
      'suspensao_prestador_rede',
      trilha,
      async (tx, est, hoje) => {
        const x = await this.filha(tx, est, 'suspensao_prestador_rede', id, versao);
        const desde = dataIso(x['suspenso_desde']) ?? '';
        const gravada = textoObrigatorio(x['situacao']);
        const situacao =
          gravada === 'cancelada'
            ? 'cancelada'
            : situacaoDaSuspensao(desde, dataIso(x['reativado_em']), hoje);
        exigir(problemasDaReativacaoPrestador({ desde, situacao }, reativadoEm, hoje));
        const cols =
          situacao === 'programada'
            ? { situacao: 'cancelada', reativado_em: null }
            : {
                situacao: reativadoEm <= hoje ? 'encerrada' : 'ativa',
                reativado_em: reativadoEm,
                reativacao_executada_em: reativadoEm <= hoje ? new Date() : null,
              };
        const v = await tx.alterar('suspensao_prestador_rede', id, versao, cols);
        return { id, versao: v, situacao: cols.situacao };
      },
    );
  }
}

export const METODOS_REDE_CADASTRO: ReadonlySet<string> = new Set([
  'apoio',
  'ficha',
  'incluirLocal',
  'desligarLocal',
  'incluirEspecialidade',
  'encerrarEspecialidade',
  'incluirQualificacao',
  'encerrarQualificacao',
  'suspender',
  'reativar',
]);
