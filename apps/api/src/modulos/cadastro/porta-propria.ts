// Porta PRÓPRIA do cadastro (F2.2) sobre o MariaDB do cliente, pelo @sgh/nucleo: pacientes (paciente + pessoa_fisica,
// endereço, telefones, e-mail e documento), linha do tempo (paciente_versao), unificação (unificacao_cadastro), fila de
// duplicidades (suspeita_duplicidade), profissionais (profissional, inscricao_conselho, profissional_especialidade,
// profissional_versao), solicitantes externos (solicitante_externo), conselhos e CEP (logradouro_cep).
// Leituras: somente leitura (lerSomente). Gravações: sempre pelo Executor (definirOperacao), com trilha, outbox e
// idempotência na mesma transação; as gravações diretas da tela (fila de duplicidades) também, com a linha da trilha
// da tela nos dados. SQL sempre parametrizado; nomes de coluna literais.
// Dado da rede inteira (sem estabelecimento_id no modelo): paciente, pessoa, profissional, conselho, solicitante e CEP.
// Melhoria: versão do controle otimista pela coluna `versao` (inteiro), não por retrato de colunas.
// Melhoria: CPF e cartão nacional únicos por pessoa (UNIQUE no banco): a duplicidade por CPF deixa de existir; a fila
// trata homônimos (mesmo nome e nascimento).
// Melhoria: CEP validado contra a base postal e naturalidade contra o município do IBGE na gravação (recusa com o campo).
// Melhoria: o retrato da linha do tempo é gravado na mesma transação da alteração (paciente_versao), pelo nome do campo.
// Melhoria: a unificação transfere ao cadastro que fica TODO registro que aponta para o absorvido (lista do domínio,
// coberta contra as chaves do banco), linha a linha pela trava otimista, com um item de unificação por registro; chave
// não coberta ou registro repetido no que fica recusa (nada some da ficha do paciente).
// Melhoria: a pessoa já existente (profissional, carga) ganha o papel de paciente sem duplicar a pessoa; e-mail de volta
// a um valor antigo reativa a linha (sem violar a unicidade).
// Pendente (pedido ao orquestrador): busca fonética (índice de chaves de busca), consentimentos, a lotação e o vínculo
// do login do profissional e procedimentos da especialidade respondem 501 até o modelo e a regra chegarem.
import { createHash, randomUUID } from 'node:crypto';
import {
  type AlterarPacienteEntrada,
  type CadastrarPacienteEntrada,
  type CadastrarSolicitanteEntrada,
  type CampoBusca,
  type EnderecoCep,
  type EntidadeBusca,
  esquemaAlterarPaciente,
  esquemaCadastrarPaciente,
  esquemaCadastrarSolicitante,
  esquemaUnificarPaciente,
  esquemaDesfazerUnificacao,
  type DesfazerUnificacaoEntrada,
  type EstadoOperacao,
  type UnificarPacienteEntrada,
} from '@sgh/contratos';
import {
  conferirNome,
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  recusa,
  restricaoUnicaViolada,
  type TxOperacao,
} from '@sgh/nucleo';
import {
  chaveSolicitante,
  conferirRegistroDevolvido,
  planoDeDesfazer,
  RECUSA_REGISTRO_ALTERADO,
  planoDeUnificacao,
  tabelasDaUnificacao,
} from '@sgh/dominio-cadastro';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPorta, GravacaoFeita, PortaCadastro } from './porta.js';
import { CadastroProprioConsentimento } from './porta-propria-consentimento.js';
import type { OperacaoProfissionalTela } from './profissionais-memoria.js';
import { operacaoProfissionalPropria, vinculosDoProfissional } from './profissionais-proprio.js';
import type {
  ContextoGravacao,
  CriterioBuscaDireta,
  DadosProfissional,
  EventoVinculoProfissional,
  ExtrasFicha,
  FichaProfissionalCadastro,
  IdsEncontrados,
  LiberacaoOperacao,
  LoginCandidato,
  OpcoesEdicaoProfissional,
  PacienteFicha,
  ParCandidato,
  ParFila,
  PessoaEncontrada,
  ProfissionalCadastro,
  RegistroProfissional,
  RegistroTrilhaTela,
  SolicitanteCadastro,
  VersaoCadastro,
} from './tipos.js';

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoCadastro {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

/** Códigos dos domínios do cadastro que a porta usa (carga do produto no "criar cliente"; pedido da onda). */
export const CODIGOS_DOMINIO_CADASTRO = Object.freeze({
  telefoneFixo: 'fixo',
  telefoneCelular: 'celular',
  telefoneRecado: 'recado',
  enderecoResidencial: 'residencial',
  documentoIdentidade: 'rg',
});

const TETO_IDS = 5_000;
const TETO_LISTA = 500;

// ---- conversões (banco → negócio) ----

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};
const inteiro = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const doisDigitos = (n: number) => String(n).padStart(2, '0');
/** DATE do banco em AAAA-MM-DD (o driver entrega Date à meia-noite UTC ou texto). */
const dataIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date)
    return Number.isNaN(v.getTime())
      ? null
      : `${v.getUTCFullYear()}-${doisDigitos(v.getUTCMonth() + 1)}-${doisDigitos(v.getUTCDate())}`;
  const t = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
};
/** DATETIME(3) do banco em ISO (UTC, sem fuso: o processo roda em UTC). */
const instanteIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 23);
  const t = String(v).replace(' ', 'T');
  return /^\d{4}-\d{2}-\d{2}T/.test(t) ? t.slice(0, 23) : null;
};
const booleano = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 1n;
/** Versão opaca da tela: "v" + a coluna versao (o contrato pede ao menos 2 caracteres). */
const versaoTela = (v: unknown): string => `v${inteiro(v) ?? 0}`;
function versaoDaTela(versao: string): number {
  const m = /^v(\d{1,9})$/.exec(versao);
  if (!m)
    throw recusa('versao-invalida', 'A versão lida pela tela é inválida. Releia o cadastro.', {
      campos: ['versao'],
    });
  return Number(m[1]);
}
/** Nome da operação no núcleo (minúsculas e hífen): "cadastro.alterarPaciente" → "cadastro.alterar-paciente". */
export const nomeNoNucleo = (operacao: string): string =>
  operacao.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`).slice(0, 120);
const marcadores = (n: number) => Array.from({ length: n }, () => '?').join(', ');
const digitos = (v: string | null | undefined) => (v ?? '').replace(/\D+/g, '');

/** Telefone em dígitos (DDD + número) → partes do modelo (DDI 55). */
function partesTelefone(t: string): { ddd: string; numero: string } {
  const d = digitos(t);
  return { ddd: d.slice(0, 2), numero: d.slice(2) };
}

const pendente = (recurso: string): Promise<never> =>
  Promise.reject(
    new ErroProblema(
      'indisponivel',
      501,
      'Recurso em construção',
      `${recurso}: ainda não disponível sobre o banco do cliente. Nada foi lido nem gravado.`,
    ),
  );

// ---- leitura do paciente ----

const SELECT_PACIENTE = `
  SELECT p.id, p.numero_prontuario, p.situacao, p.sobrevivente_paciente_id, p.versao, p.criado_em, p.alterado_em,
         p.alergia_texto_legado AS alergia, p.medicamentos_texto_legado AS medicamentos,
         pf.id AS pessoa_id, pf.nome, pf.nome_social, pf.data_nascimento, sx.sigla AS sexo, pf.nome_mae,
         pf.mae_desconhecida, pf.nome_pai, pf.cpf, pf.cns, pf.estado_civil_id, pf.classificacao_raca_cor_id,
         pf.crenca_religiosa_id, pf.nacionalidade_id, nac.descricao AS nacionalidade, pf.data_obito,
         mn.nome AS naturalidade, ufn.sigla AS uf_naturalidade,
         en.cep, en.logradouro, en.numero AS numero_endereco, en.complemento,
         COALESCE(br.descricao, en.bairro_nome) AS bairro, me.nome AS cidade, ufe.sigla AS uf,
         (SELECT d.numero FROM documento_pessoa d
            JOIN tipo_documento_identificacao td ON td.id = d.tipo_documento_identificacao_id
           WHERE d.pessoa_fisica_id = pf.id AND td.codigo = ? AND d.excluido_em IS NULL
           ORDER BY d.principal DESC, d.sequencia LIMIT 1) AS identidade,
         (SELECT CONCAT(COALESCE(t.ddd, ''), t.numero) FROM telefone_pessoa t
            JOIN tipo_telefone tt ON tt.id = t.tipo_telefone_id
           WHERE t.pessoa_fisica_id = pf.id AND tt.codigo = ? AND t.excluido_em IS NULL
           ORDER BY t.principal DESC, t.sequencia LIMIT 1) AS telefone,
         (SELECT CONCAT(COALESCE(t.ddd, ''), t.numero) FROM telefone_pessoa t
            JOIN tipo_telefone tt ON tt.id = t.tipo_telefone_id
           WHERE t.pessoa_fisica_id = pf.id AND tt.codigo = ? AND t.excluido_em IS NULL
           ORDER BY t.principal DESC, t.sequencia LIMIT 1) AS celular,
         (SELECT CONCAT(COALESCE(t.ddd, ''), t.numero, '|', COALESCE(t.nome_contato, '')) FROM telefone_pessoa t
            JOIN tipo_telefone tt ON tt.id = t.tipo_telefone_id
           WHERE t.pessoa_fisica_id = pf.id AND tt.codigo = ? AND t.excluido_em IS NULL
           ORDER BY t.principal DESC, t.sequencia LIMIT 1) AS recado,
         (SELECT m.email FROM email_pessoa m WHERE m.pessoa_fisica_id = pf.id AND m.excluido_em IS NULL
           ORDER BY m.principal DESC, m.sequencia LIMIT 1) AS email
    FROM paciente p
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN sexo sx ON sx.id = pf.sexo_id
    LEFT JOIN nacionalidade nac ON nac.id = pf.nacionalidade_id
    LEFT JOIN municipio_ibge mn ON mn.id = pf.naturalidade_municipio_ibge_id
    LEFT JOIN unidade_federativa ufn ON ufn.id = mn.unidade_federativa_id
    LEFT JOIN endereco_pessoa en ON en.id = (
      SELECT e2.id FROM endereco_pessoa e2 WHERE e2.pessoa_fisica_id = pf.id AND e2.excluido_em IS NULL
       ORDER BY e2.principal DESC, e2.sequencia LIMIT 1)
    LEFT JOIN bairro br ON br.id = en.bairro_id
    LEFT JOIN municipio_ibge me ON me.id = en.municipio_ibge_id
    LEFT JOIN unidade_federativa ufe ON ufe.id = me.unidade_federativa_id
   WHERE p.excluido_em IS NULL`;
const PARAMETROS_PACIENTE = [
  CODIGOS_DOMINIO_CADASTRO.documentoIdentidade,
  CODIGOS_DOMINIO_CADASTRO.telefoneFixo,
  CODIGOS_DOMINIO_CADASTRO.telefoneCelular,
  CODIGOS_DOMINIO_CADASTRO.telefoneRecado,
];

export function pacienteDaLinha(l: Linha): PacienteFicha {
  const id = inteiro(l['id']) ?? 0;
  const situacao = texto(l['situacao']);
  const sobrevivente = inteiro(l['sobrevivente_paciente_id']);
  const sexo = texto(l['sexo']);
  const [recadoNumero, recadoNome] = (texto(l['recado']) ?? '|').split('|');
  return {
    id,
    prontuario: inteiro(l['numero_prontuario']) ?? 0,
    prontuarioAnterior: null,
    nome: texto(l['nome']) ?? '',
    nomeSocial: texto(l['nome_social']),
    nascimento: dataIso(l['data_nascimento']),
    sexo: sexo === 'F' || sexo === 'M' ? sexo : null,
    mae: texto(l['nome_mae']),
    maeDesconhecida: booleano(l['mae_desconhecida']),
    pai: texto(l['nome_pai']),
    cpf: texto(l['cpf']),
    cns: texto(l['cns']),
    identidade: texto(l['identidade']),
    estadoCivil: inteiro(l['estado_civil_id']),
    naturalidade: texto(l['naturalidade']),
    ufNaturalidade: texto(l['uf_naturalidade']),
    nacionalidade: texto(l['nacionalidade']),
    nacionalidadeCodigo: inteiro(l['nacionalidade_id']),
    cep: texto(l['cep']),
    logradouro: texto(l['logradouro']),
    numero: inteiro(l['numero_endereco']),
    complemento: texto(l['complemento']),
    bairro: texto(l['bairro']),
    cidade: texto(l['cidade']),
    uf: texto(l['uf']),
    telefone: texto(l['telefone']),
    celular: texto(l['celular']),
    email: texto(l['email']),
    contatoNome: texto(recadoNome),
    contatoTelefone: texto(recadoNumero),
    racaCor: inteiro(l['classificacao_raca_cor_id']),
    religiao: inteiro(l['crenca_religiosa_id']),
    responsavelLegal: null,
    ativo: situacao === 'ativo' || situacao === 'provisorio',
    unificadoEm:
      situacao === 'unificado' && sobrevivente !== null && sobrevivente !== id ? sobrevivente : null,
    obito: dataIso(l['data_obito']),
    cadastradoEm: dataIso(l['criado_em']),
    alteradoEm: dataIso(l['alterado_em']),
    alergia: texto(l['alergia']),
    medicamentos: texto(l['medicamentos']),
    carimbo: instanteIso(l['alterado_em']) ?? instanteIso(l['criado_em']),
    versao: versaoTela(l['versao']),
  };
}

/** Retrato do cadastro para a linha do tempo (pelo nome do campo da ficha; sem id interno). */
export function retratoDoPaciente(p: PacienteFicha): Record<string, unknown> {
  return {
    nome: p.nome,
    nomeSocial: p.nomeSocial,
    nascimento: p.nascimento,
    sexo: p.sexo,
    nomeMae: p.mae,
    nomePai: p.pai,
    maeDesconhecida: p.maeDesconhecida,
    cpf: p.cpf,
    cns: p.cns,
    identidade: p.identidade,
    estadoCivil: p.estadoCivil,
    naturalidade: p.naturalidade,
    ufNaturalidade: p.ufNaturalidade,
    cep: p.cep,
    logradouro: p.logradouro,
    numero: p.numero,
    complemento: p.complemento,
    bairro: p.bairro,
    email: p.email,
    racaCor: p.racaCor,
    religiao: p.religiao,
    obito: p.obito,
    telefones: [
      ...(p.telefone ? [{ tipo: 1, numero: p.telefone }] : []),
      ...(p.celular ? [{ tipo: 3, numero: p.celular }] : []),
      ...(p.contatoTelefone ? [{ tipo: 5, numero: p.contatoTelefone }] : []),
    ],
  };
}

async function lerPacientesPorIds(l: Leitor, ids: readonly number[]): Promise<PacienteFicha[]> {
  const unicos = [...new Set(ids.filter((i) => Number.isSafeInteger(i) && i > 0))].slice(0, TETO_IDS);
  if (unicos.length === 0) return [];
  const linhas = await l.consultar(
    `${SELECT_PACIENTE} AND p.id IN (${marcadores(unicos.length)}) ORDER BY pf.nome, p.id`,
    [...PARAMETROS_PACIENTE, ...unicos],
    { teto: TETO_IDS },
  );
  return linhas.map(pacienteDaLinha);
}

/** Coluna de busca por palavra (lista branca: nada vindo da tela vira nome de coluna). */
const COLUNAS_BUSCA: Readonly<Record<string, string>> = {
  'paciente:nome': 'pf.nome',
  'paciente:social': 'pf.nome_social',
  'paciente:mae': 'pf.nome_mae',
  'profissional:nome': 'pf.nome',
  'profissional:social': 'pf.nome_social',
};

const DOMINIOS_TELA: Readonly<Record<string, string>> = {
  estadoCivil: 'SELECT descricao FROM estado_civil WHERE id = ?',
  racaCor: 'SELECT descricao FROM classificacao_raca_cor WHERE id = ?',
  religiao: 'SELECT descricao FROM crenca_religiosa WHERE id = ?',
};

// ---- entradas das operações próprias da porta ----

const esquemaParesDuplicidade = z
  .object({
    pares: z
      .array(
        z.object({
          a: z.number().int().positive(),
          b: z.number().int().positive(),
          escore: z.number().int().min(0).max(100),
          criterios: z.array(z.enum(['cpf', 'fonetica', 'nascimento', 'mae', 'telefone'])).max(5),
        }),
      )
      .max(5_000),
    inativos: z.array(z.number().int().positive()).max(5_000),
  })
  .strict();
const esquemaDecisaoOutraPessoa = z
  .object({ par: z.number().int().positive(), justificativa: z.string().trim().min(5).max(400) })
  .strict();

export class PortaCadastroPropria implements PortaCadastro {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;
  /** Consentimentos (LGPD) e procedimentos da especialidade (porta-propria-consentimento.ts). */
  private readonly complemento: CadastroProprioConsentimento;

  constructor(
    private readonly nucleo: NucleoCadastro,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
    this.complemento = new CadastroProprioConsentimento(nucleo, cliente, this.executor);
  }

  // ---- apoio ----

  private ler<T>(c: ContextoPorta, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'cadastro' }, fn);
  }

  /** O estabelecimento da sessão pelo id (ou pelo código, quando o mapa ainda não o tinha). */
  private async estabelecimentoDe(c: ContextoPorta | ContextoGravacao, l?: Leitor): Promise<number | null> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const codigo = 'hospital' in c ? c.hospital : '';
    if (!codigo) return null;
    const buscar = (x: Leitor) =>
      x.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
        codigo,
      ]);
    const r = l ? await buscar(l) : await this.ler(c as ContextoPorta, buscar);
    return r ? Number(r.id) : null;
  }

  /** O ContextoOperacao do núcleo (o cliente é o da porta, nunca o da tela). */
  private async contextoNucleo(c: ContextoGravacao): Promise<ContextoOperacao> {
    return {
      cliente: this.cliente,
      estabelecimento: await this.estabelecimentoDe(c),
      usuario: c.usuario,
      correlacao: c.correlacao,
      chaveIdempotencia: c.chaveIdempotencia,
      ...(c.reautenticadoEm !== undefined ? { reautenticadoEm: c.reautenticadoEm } : {}),
    };
  }

  /** Contexto de uma gravação direta da tela (sem Idempotency-Key própria: chave única por chamada). */
  private async contextoDireto(c: ContextoPorta, trilha: RegistroTrilhaTela): Promise<ContextoOperacao> {
    return {
      cliente: this.cliente,
      estabelecimento: trilha.estabelecimento ?? (await this.estabelecimentoDe(c)),
      usuario: trilha.usuario ?? c.usuario,
      correlacao: (trilha.correlacao ?? c.correlacao).slice(0, 64) || 'cadastro',
      chaveIdempotencia: `direta:${randomUUID()}`,
    };
  }

  estado(): EstadoOperacao | null {
    return 'liberada';
  }

  versaoParaTela(versao: string): string {
    return versao;
  }

  async podeGravar(c: ContextoPorta, operacao: string): Promise<LiberacaoOperacao> {
    const r = await this.executor.liberacao(
      definirOperacao({
        nome: nomeNoNucleo(operacao),
        tabelas: ['paciente'],
        entrada: z.unknown(),
        gravar: async () => ({}),
        alvo: () => ({ tabela: 'paciente', id: null }),
      }),
      {
        cliente: this.cliente,
        estabelecimento: await this.estabelecimentoDe(c),
        usuario: c.usuario,
        correlacao: c.correlacao || 'liberacao',
        chaveIdempotencia: 'consulta-liberacao',
      },
    );
    return { pode: r.pode, codigo: r.codigo, motivo: r.motivo };
  }

  // ---- pacientes: leituras ----

  async buscarDireto(c: ContextoPorta, criterio: CriterioBuscaDireta, inativos: boolean) {
    const [cond, valor]: [string, unknown] =
      criterio.tipo === 'cpf'
        ? ['pf.cpf = ?', String(criterio.cpf).padStart(11, '0')]
        : criterio.tipo === 'prontuario'
          ? ['p.numero_prontuario = ?', criterio.prontuario]
          : criterio.tipo === 'cns'
            ? ['pf.cns = ?', digitos(criterio.cns)]
            : ['pf.data_nascimento = ?', criterio.data];
    const ativos = inativos ? '' : " AND p.situacao IN ('ativo', 'provisorio')";
    const linhas = await this.ler(c, (l) =>
      l.consultar(
        `${SELECT_PACIENTE} AND ${cond}${ativos} ORDER BY pf.nome, p.id LIMIT ${TETO_LISTA + 1}`,
        [...PARAMETROS_PACIENTE, valor],
        { teto: TETO_LISTA + 1 },
      ),
    );
    return {
      pacientes: linhas.slice(0, TETO_LISTA).map(pacienteDaLinha),
      truncado: linhas.length > TETO_LISTA,
    };
  }

  private async idsDasPalavras(
    c: ContextoPorta,
    entidade: EntidadeBusca,
    campos: readonly CampoBusca[],
    palavras: readonly string[],
    teto: number,
  ): Promise<{ ids: number[]; truncado: boolean }> {
    const limpas = palavras.map((p) => p.trim()).filter((p) => p !== '' && !/[%_\\]/.test(p));
    if (limpas.length === 0) return { ids: [], truncado: false };
    if (campos.includes('telefone')) {
      if (entidade !== 'paciente') return { ids: [], truncado: false };
      const fim = digitos(limpas[0]).slice(-8);
      if (fim.length < 8) return { ids: [], truncado: false };
      const linhas = await this.ler(c, (l) =>
        l.consultar<{ id: unknown }>(
          `SELECT DISTINCT p.id FROM paciente p JOIN telefone_pessoa t ON t.pessoa_fisica_id = p.pessoa_fisica_id
            WHERE p.excluido_em IS NULL AND t.excluido_em IS NULL AND RIGHT(CONCAT(COALESCE(t.ddd, ''), t.numero), 8) = ?
            LIMIT ${teto + 1}`,
          [fim],
          { teto: teto + 1 },
        ),
      );
      return { ids: linhas.slice(0, teto).map((x) => Number(x.id)), truncado: linhas.length > teto };
    }
    const colunas = campos.map((k) => COLUNAS_BUSCA[`${entidade}:${k}`]).filter((x): x is string => !!x);
    if (colunas.length === 0) return { ids: [], truncado: false };
    // Cada palavra no começo de uma palavra de algum dos campos (a colação ignora acento e maiúscula).
    const porPalavra = limpas.map(
      () =>
        `(${colunas.map((col) => `CONCAT(' ', COALESCE(${col}, ''), ' ') LIKE CONCAT('% ', ?, '%')`).join(' OR ')})`,
    );
    const params = limpas.flatMap((p) => colunas.map(() => p));
    const sql =
      entidade === 'profissional'
        ? `SELECT pr.id FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
            WHERE pr.excluido_em IS NULL AND ${porPalavra.join(' AND ')} LIMIT ${teto + 1}`
        : `SELECT p.id FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE p.excluido_em IS NULL AND ${porPalavra.join(' AND ')} LIMIT ${teto + 1}`;
    const linhas = await this.ler(c, (l) => l.consultar<{ id: unknown }>(sql, params, { teto: teto + 1 }));
    return { ids: linhas.slice(0, teto).map((x) => Number(x.id)), truncado: linhas.length > teto };
  }

  async idsPorPalavra(
    c: ContextoPorta,
    entidade: EntidadeBusca,
    campos: readonly CampoBusca[],
    palavra: string,
  ): Promise<IdsEncontrados> {
    const r = await this.idsDasPalavras(c, entidade, campos, [palavra], TETO_IDS);
    return { ids: new Set(r.ids), truncado: r.truncado };
  }

  /** Pendente: sem o índice de chaves fonéticas no modelo, a sugestão fonética não encontra nada (pedido da onda). */
  async idsPorFonetica(): Promise<IdsEncontrados> {
    return { ids: new Set<number>(), truncado: false };
  }

  idsPorPalavras(
    c: ContextoPorta,
    entidade: EntidadeBusca,
    campos: readonly CampoBusca[],
    palavras: readonly string[],
    teto: number,
  ) {
    return this.idsDasPalavras(c, entidade, campos, palavras, teto);
  }

  /** A busca por palavra lê o próprio cadastro (não depende de índice carregado). */
  async indiceTemLinhas(): Promise<boolean> {
    return true;
  }

  lerPacientes(c: ContextoPorta, ids: readonly number[]): Promise<PacienteFicha[]> {
    return this.ler(c, (l) => lerPacientesPorIds(l, ids));
  }

  extrasDaFicha(c: ContextoPorta, p: PacienteFicha): Promise<ExtrasFicha> {
    return this.ler(c, async (l) => {
      const conv = await l.consultar<{ id: unknown; nome: unknown }>(
        `SELECT DISTINCT f.id, f.nome FROM cobertura_paciente cp JOIN fonte_pagadora f ON f.id = cp.fonte_pagadora_id
          WHERE cp.paciente_id = ? AND cp.excluido_em IS NULL AND cp.situacao = 'ativa' ORDER BY f.nome LIMIT 50`,
        [p.id],
        { teto: 50 },
      );
      const rotulo = async (chave: string, v: number | null) =>
        v === null
          ? null
          : texto((await l.uma<{ descricao: unknown }>(DOMINIOS_TELA[chave] ?? '', [v]))?.descricao);
      return {
        carteirinhas: conv.map((x) => ({ convenio: Number(x.id), nome: texto(x.nome) ?? '' })),
        estadoCivil: await rotulo('estadoCivil', p.estadoCivil),
        racaCor: await rotulo('racaCor', p.racaCor),
        religiao: await rotulo('religiao', p.religiao),
      };
    });
  }

  historico(c: ContextoPorta, id: number, pagina: number, porPagina: number) {
    return this.ler(c, async (l) => {
      const total = Number(
        (await l.uma<{ n: unknown }>('SELECT COUNT(*) AS n FROM paciente_versao WHERE paciente_id = ?', [id]))
          ?.n ?? 0,
      );
      const por = Math.max(1, Math.min(porPagina, 200));
      const inicio = (Math.max(1, pagina) - 1) * por;
      const linhas = await l.consultar(
        `SELECT v.id, v.ocorrido_em, v.dados, u.login FROM paciente_versao v LEFT JOIN usuario u ON u.id = v.usuario_id
          WHERE v.paciente_id = ? ORDER BY v.ocorrido_em DESC, v.id DESC LIMIT ${por + 1} OFFSET ${inicio}`,
        [id],
        { teto: por + 1 },
      );
      const versoes = linhas.map(versaoDaLinha);
      return { versoes: versoes.slice(0, por), total, anterior: versoes[por] ?? null };
    });
  }

  unificacoes(c: ContextoPorta, id: number) {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT u.id, u.absorvido_paciente_id, u.mantido_paciente_id, u.unificado_em, u.situacao, u.reversivel,
                  u.revertido_em, u.motivo_reversao, r.login AS revertido_por
             FROM unificacao_cadastro u LEFT JOIN usuario r ON r.id = u.revertido_por_usuario_id
            WHERE (u.absorvido_paciente_id = ? OR u.mantido_paciente_id = ?) AND u.situacao IN ('efetivada', 'revertida')
              AND u.excluido_em IS NULL
            ORDER BY u.unificado_em DESC, u.id DESC LIMIT 100`,
          [id, id],
          { teto: 100 },
        )
      ).map((x) => ({
        id: Number(x['id']),
        absorvido: Number(x['absorvido_paciente_id']),
        sobrevivente: Number(x['mantido_paciente_id']),
        em: instanteIso(x['unificado_em']),
        situacao: String(x['situacao']) === 'revertida' ? ('revertida' as const) : ('efetivada' as const),
        reversivel: Boolean(Number(x['reversivel'])),
        revertidaEm: x['revertido_em'] ? instanteIso(x['revertido_em']) : null,
        motivoReversao: x['motivo_reversao'] ? String(x['motivo_reversao']) : null,
        revertidaPor: x['revertido_por'] ? String(x['revertido_por']) : null,
      })),
    );
  }

  /** Homônimos: outro paciente ativo com o mesmo nome e o mesmo nascimento. */
  homonimos(c: ContextoPorta, ids: readonly number[]): Promise<Set<number>> {
    const unicos = [...new Set(ids)].slice(0, TETO_IDS);
    if (unicos.length === 0) return Promise.resolve(new Set());
    return this.ler(c, async (l) => {
      const linhas = await l.consultar<{ id: unknown }>(
        `SELECT DISTINCT p.id FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE p.id IN (${marcadores(unicos.length)}) AND EXISTS (
            SELECT 1 FROM paciente p2 JOIN pessoa_fisica pf2 ON pf2.id = p2.pessoa_fisica_id
             WHERE p2.id <> p.id AND p2.excluido_em IS NULL AND p2.situacao IN ('ativo', 'provisorio')
               AND pf2.nome = pf.nome AND pf2.data_nascimento <=> pf.data_nascimento)`,
        unicos,
        { teto: TETO_IDS },
      );
      return new Set(linhas.map((x) => Number(x.id)));
    });
  }

  candidatosPorCpf(c: ContextoPorta, cpf: number): Promise<PacienteFicha[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `${SELECT_PACIENTE} AND pf.cpf = ? ORDER BY p.id LIMIT 20`,
          [...PARAMETROS_PACIENTE, String(cpf).padStart(11, '0')],
          { teto: 20 },
        )
      ).map(pacienteDaLinha),
    );
  }

  async cepExiste(c: ContextoPorta, cep: string): Promise<boolean> {
    return (await this.lerCep(c, cep)) !== null;
  }

  lerCep(c: ContextoPorta, cep: string): Promise<EnderecoCep | null> {
    const d = digitos(cep);
    if (d.length !== 8) return Promise.resolve(null);
    return this.ler(c, async (l) => {
      const x = await l.uma(
        `SELECT lc.codigo_cep, TRIM(CONCAT(COALESCE(es.descricao, ''), ' ', COALESCE(lc.logradouro, ''))) AS logradouro,
                b.descricao AS bairro, m.nome AS cidade, uf.sigla AS uf
           FROM logradouro_cep lc
           JOIN municipio_ibge m ON m.id = lc.municipio_ibge_id
           JOIN unidade_federativa uf ON uf.id = lc.unidade_federativa_id
           LEFT JOIN bairro b ON b.id = lc.bairro_id
           LEFT JOIN especie_logradouro es ON es.id = lc.especie_logradouro_id
          WHERE lc.codigo_cep = ? AND lc.ativo`,
        [d],
      );
      return x
        ? {
            cep: d,
            logradouro: texto(x['logradouro']),
            bairro: texto(x['bairro']),
            cidade: texto(x['cidade']),
            uf: texto(x['uf']),
          }
        : null;
    });
  }

  // ---- pacientes: gravações ----

  async cadastrar(
    _c: ContextoPorta,
    entrada: CadastrarPacienteEntrada,
    ctx: ContextoGravacao,
  ): Promise<GravacaoFeita<{ idPaciente: number; prontuario: number }>> {
    const r = await this.executor.executar(
      OPERACAO_CADASTRAR_PACIENTE,
      this.cliente,
      entrada,
      await this.contextoNucleo(ctx),
    );
    return {
      resultado: { idPaciente: Number(r.resultado.idPaciente), prontuario: Number(r.resultado.prontuario) },
      trilha: r.trilha,
    };
  }

  async alterar(
    _c: ContextoPorta,
    entrada: AlterarPacienteEntrada,
    ctx: ContextoGravacao,
  ): Promise<GravacaoFeita<{ idPaciente: number }>> {
    const r = await this.executor.executar(
      OPERACAO_ALTERAR_PACIENTE,
      this.cliente,
      entrada,
      await this.contextoNucleo(ctx),
    );
    return { resultado: { idPaciente: Number(r.resultado.idPaciente) }, trilha: r.trilha };
  }

  async desfazerUnificacao(
    _c: ContextoPorta,
    entrada: DesfazerUnificacaoEntrada,
    ctx: ContextoGravacao,
  ): Promise<GravacaoFeita<{ idAbsorvido: number; idSobrevivente: number }>> {
    const r = await this.executor.executar(
      OPERACAO_DESFAZER_UNIFICACAO,
      this.cliente,
      entrada,
      await this.contextoNucleo(ctx),
    );
    // A marca de não reversível ficou gravada; a recusa vai ao usuário.
    if (r.resultado.recusaCodigo)
      throw recusa(String(r.resultado.recusaCodigo), String(r.resultado.recusaMensagem));
    return {
      resultado: {
        idAbsorvido: Number(r.resultado.idAbsorvido),
        idSobrevivente: Number(r.resultado.idSobrevivente),
      },
      trilha: r.trilha,
    };
  }

  async unificar(
    _c: ContextoPorta,
    entrada: UnificarPacienteEntrada,
    ctx: ContextoGravacao,
  ): Promise<GravacaoFeita<{ idAbsorvido: number; idSobrevivente: number }>> {
    const r = await this.executor.executar(
      OPERACAO_UNIFICAR_PACIENTE,
      this.cliente,
      entrada,
      await this.contextoNucleo(ctx),
    );
    return {
      resultado: {
        idAbsorvido: Number(r.resultado.idAbsorvido),
        idSobrevivente: Number(r.resultado.idSobrevivente),
      },
      trilha: r.trilha,
    };
  }

  // ---- fila de duplicidades ----

  /** Grupos candidatos: homônimos ativos (mesmo nome e nascimento). Por CPF não há: o CPF é único por pessoa. */
  gruposCandidatos(c: ContextoPorta) {
    return this.ler(c, async (l) => {
      const linhas = await l.consultar<{ ids: unknown }>(
        `SELECT GROUP_CONCAT(p.id ORDER BY p.id) AS ids FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE p.excluido_em IS NULL AND p.situacao IN ('ativo', 'provisorio') AND pf.data_nascimento IS NOT NULL
          GROUP BY pf.nome, pf.data_nascimento HAVING COUNT(*) > 1 LIMIT 2000`,
        [],
        { teto: 2000 },
      );
      return {
        cpf: [] as number[][],
        fonetica: linhas.map((x) => String(x.ids).split(',').map(Number)),
      };
    });
  }

  lerFila(c: ContextoPorta, situacao: ParFila['situacao'], pagina: number, porPagina: number) {
    const sit = situacao;
    const por = Math.max(1, Math.min(porPagina, 200));
    return this.ler(c, async (l) => {
      const total = Number(
        (
          await l.uma<{ n: unknown }>(
            'SELECT COUNT(*) AS n FROM suspeita_duplicidade WHERE situacao = ? AND excluido_em IS NULL',
            [sit],
          )
        )?.n ?? 0,
      );
      const linhas = await l.consultar(
        `${SELECT_PAR} WHERE s.situacao = ? AND s.excluido_em IS NULL ORDER BY s.escore DESC, s.id
          LIMIT ${por} OFFSET ${(Math.max(1, pagina) - 1) * por}`,
        [sit],
        { teto: por },
      );
      return { itens: linhas.map(parDaLinha), total };
    });
  }

  lerPar(c: ContextoPorta, id: number): Promise<ParFila | null> {
    return this.ler(c, async (l) => {
      const x = await l.uma(`${SELECT_PAR} WHERE s.id = ? AND s.excluido_em IS NULL`, [id]);
      return x ? parDaLinha(x) : null;
    });
  }

  async gravarPares(
    c: ContextoPorta,
    pares: readonly ParCandidato[],
    inativos: readonly number[],
    trilha: RegistroTrilhaTela,
  ): Promise<number> {
    const entrada = {
      pares: pares.map((p) => ({
        a: Math.min(p.a.id, p.b.id),
        b: Math.max(p.a.id, p.b.id),
        escore: Math.round(p.escore),
        criterios: [...p.criterios],
      })),
      inativos: [...inativos],
    };
    const r = await this.executor.executar(
      operacaoParesDuplicidade(trilha),
      this.cliente,
      entrada,
      await this.contextoDireto(c, trilha),
    );
    return Number(r.resultado.incluidos);
  }

  async decidirOutraPessoa(
    c: ContextoPorta,
    id: number,
    _usuario: string,
    justificativa: string,
    trilha: RegistroTrilhaTela,
  ): Promise<{ a: number; b: number }> {
    const r = await this.executor.executar(
      operacaoOutraPessoa(trilha),
      this.cliente,
      { par: id, justificativa },
      await this.contextoDireto(c, trilha),
    );
    return { a: Number(r.resultado.a), b: Number(r.resultado.b) };
  }

  // ---- consentimentos (LGPD: termo, base legal e numeração; porta-propria-consentimento.ts) ----

  opcoesConsentimento() {
    return this.complemento.opcoesConsentimento();
  }
  consentimentos(c: ContextoPorta, id: number) {
    return this.complemento.consentimentos(c, id);
  }
  registrarConsentimento(
    c: ContextoPorta,
    r: Parameters<PortaCadastro['registrarConsentimento']>[1],
    trilha: RegistroTrilhaTela,
  ) {
    return this.complemento.registrarConsentimento(c, r, trilha);
  }
  revogarConsentimento(
    c: ContextoPorta,
    r: Parameters<PortaCadastro['revogarConsentimento']>[1],
    trilha: RegistroTrilhaTela,
  ) {
    return this.complemento.revogarConsentimento(c, r, trilha);
  }

  // ---- profissionais (dado da rede inteira) ----

  private async registrosDe(l: Leitor, ids: readonly number[]): Promise<RegistroProfissional[]> {
    if (ids.length === 0) return [];
    const linhas = await l.consultar(
      `SELECT ic.id, ic.profissional_id, cc.sigla AS conselho, ic.numero_inscricao, uf.sigla AS uf, cbo.codigo_cbo,
              cbo.descricao AS cbo_descricao, ic.situacao, ic.versao
         FROM inscricao_conselho ic
         JOIN conselho_classe cc ON cc.id = ic.conselho_classe_id
         JOIN unidade_federativa uf ON uf.id = ic.unidade_federativa_id
         LEFT JOIN ocupacao_cbo cbo ON cbo.id = ic.ocupacao_cbo_id
        WHERE ic.profissional_id IN (${marcadores(ids.length)}) AND ic.excluido_em IS NULL
        ORDER BY ic.profissional_id, ic.principal DESC, ic.sequencia`,
      ids,
      { teto: TETO_IDS },
    );
    return linhas.map((x) => {
      const numero = texto(x['numero_inscricao']);
      return {
        id: Number(x['id']),
        profissional: Number(x['profissional_id']),
        conselho: texto(x['conselho']),
        sigla: null,
        numero: numero && /^\d{1,9}$/.test(numero) ? Number(numero) : null,
        uf: texto(x['uf']),
        cbo: texto(x['codigo_cbo']),
        cboDescricao: texto(x['cbo_descricao']),
        ativo: ['ativa', 'provisoria'].includes(texto(x['situacao']) ?? ''),
        siglaId: null,
        versao: versaoTela(x['versao']),
      };
    });
  }

  private async profissionaisDe(l: Leitor, ids?: readonly number[]): Promise<ProfissionalCadastro[]> {
    const filtro = ids ? [...new Set(ids)].slice(0, TETO_IDS) : null;
    if (filtro && filtro.length === 0) return [];
    const linhas = await l.consultar(
      `SELECT pr.id, pf.nome, pf.nome_social, pr.situacao FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
        WHERE pr.excluido_em IS NULL${filtro ? ` AND pr.id IN (${marcadores(filtro.length)})` : ''} ORDER BY pf.nome, pr.id LIMIT ${TETO_IDS}`,
      filtro ?? [],
      { teto: TETO_IDS },
    );
    const registros = await this.registrosDe(
      l,
      linhas.map((x) => Number(x['id'])),
    );
    return linhas.map((x) => ({
      id: Number(x['id']),
      nome: texto(x['nome']) ?? '',
      nomeSocial: texto(x['nome_social']),
      situacao: texto(x['situacao']),
      registros: registros.filter((r) => r.profissional === Number(x['id'])),
    }));
  }

  listarProfissionais(c: ContextoPorta, ids?: readonly number[]) {
    return this.ler(c, (l) => this.profissionaisDe(l, ids));
  }

  fichaProfissional(c: ContextoPorta, id: number): Promise<FichaProfissionalCadastro | null> {
    return this.ler(c, async (l) => {
      const [p] = await this.profissionaisDe(l, [id]);
      if (!p) return null;
      const esp = await l.consultar(
        `SELECT pe.inscricao_conselho_id, em.id, em.descricao, pe.ativo FROM profissional_especialidade pe
           JOIN especialidade_medica em ON em.id = pe.especialidade_medica_id
          WHERE pe.profissional_id = ? AND pe.excluido_em IS NULL ORDER BY pe.principal DESC, em.descricao`,
        [id],
        { teto: 200 },
      );
      const est = await this.estabelecimentoDe(c, l);
      const logins = await l.consultar(
        `SELECT DISTINCT u.login FROM usuario_vinculo_profissional v JOIN usuario u ON u.id = v.usuario_id
          WHERE v.profissional_id = ? AND v.excluido_em IS NULL AND u.excluido_em IS NULL
            AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE) AND v.estabelecimento_id <=> ?
          ORDER BY u.login`,
        [id, est],
        { teto: 100 },
      );
      return {
        ...p,
        especialidades: esp.map((x) => ({
          registro: inteiro(x['inscricao_conselho_id']) ?? 0,
          codigo: Number(x['id']),
          nome: texto(x['descricao']) ?? '',
          ativo: booleano(x['ativo']),
        })),
        lotacao: [],
        credenciamentos: [],
        logins: logins.map((x) => ({ login: String(x['login']), origem: 'papel' as const })),
      };
    });
  }

  historicoProfissional(c: ContextoPorta, id: number, pagina: number, porPagina: number) {
    return this.ler(c, async (l) => {
      const nome = texto(
        (
          await l.uma(
            'SELECT pf.nome FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id WHERE pr.id = ?',
            [id],
          )
        )?.['nome'],
      );
      const total = Number(
        (
          await l.uma<{ n: unknown }>(
            'SELECT COUNT(*) AS n FROM profissional_versao WHERE profissional_id = ?',
            [id],
          )
        )?.n ?? 0,
      );
      const por = Math.max(1, Math.min(porPagina, 200));
      const linhas = await l.consultar(
        `SELECT v.id, v.ocorrido_em, v.dados, u.login FROM profissional_versao v LEFT JOIN usuario u ON u.id = v.usuario_id
          WHERE v.profissional_id = ? ORDER BY v.ocorrido_em DESC, v.id DESC LIMIT ${por + 1} OFFSET ${(Math.max(1, pagina) - 1) * por}`,
        [id],
        { teto: por + 1 },
      );
      const versoes = linhas.map(versaoDaLinha);
      return { versoes: versoes.slice(0, por), total, anterior: versoes[por] ?? null, nome };
    });
  }

  private async solicitantes(l: Leitor, where: string, params: readonly unknown[]) {
    const linhas = await l.consultar(
      `SELECT s.id, s.nome, cc.sigla AS conselho, s.numero_conselho, uf.sigla AS uf, cbo.codigo_cbo, s.ativo,
              (SELECT COUNT(*) FROM solicitante_externo_fonte_pagadora x WHERE x.solicitante_externo_id = s.id) AS convenios
         FROM solicitante_externo s
         JOIN conselho_classe cc ON cc.id = s.conselho_classe_id
         JOIN unidade_federativa uf ON uf.id = s.conselho_unidade_federativa_id
         LEFT JOIN ocupacao_cbo cbo ON cbo.id = s.ocupacao_cbo_id
        WHERE s.excluido_em IS NULL${where} ORDER BY s.nome, s.id LIMIT ${TETO_LISTA + 1}`,
      params,
      { teto: TETO_LISTA + 1 },
    );
    const itens: SolicitanteCadastro[] = linhas.slice(0, TETO_LISTA).map((x) => {
      const numero = texto(x['numero_conselho']);
      return {
        id: Number(x['id']),
        nome: texto(x['nome']) ?? '',
        conselho: texto(x['conselho']),
        numero: numero && /^\d{1,9}$/.test(numero) ? Number(numero) : null,
        uf: texto(x['uf']),
        cbo: texto(x['codigo_cbo']),
        ativo: booleano(x['ativo']),
        codigosConvenio: Number(x['convenios'] ?? 0),
      };
    });
    return { itens, truncado: linhas.length > TETO_LISTA };
  }

  listarSolicitantes(c: ContextoPorta, ids?: readonly number[]) {
    const filtro = ids ? [...new Set(ids)].slice(0, TETO_LISTA) : null;
    if (filtro && filtro.length === 0) return Promise.resolve({ itens: [], truncado: false });
    return this.ler(c, (l) =>
      this.solicitantes(l, filtro ? ` AND s.id IN (${marcadores(filtro.length)})` : '', filtro ?? []),
    );
  }

  solicitantesPorRegistro(
    c: ContextoPorta,
    r: { numero: number; conselho?: string | null; uf?: string | null },
  ) {
    let where = ' AND s.numero_conselho = ?';
    const params: unknown[] = [String(r.numero)];
    if (r.conselho) {
      where += ' AND cc.sigla = ?';
      params.push(r.conselho.toUpperCase());
    }
    if (r.uf) {
      where += ' AND uf.sigla = ?';
      params.push(r.uf.toUpperCase());
    }
    return this.ler(c, (l) => this.solicitantes(l, where, params));
  }

  /** Conselho, UF e número são únicos no banco (UNIQUE): não há solicitante repetido. */
  async chavesRepetidasSolicitante(): Promise<Set<string>> {
    return new Set();
  }

  buscarPessoas(c: ContextoPorta, documento: string): Promise<PessoaEncontrada[]> {
    const d = digitos(documento);
    if (d.length !== 11 && d.length !== 14) return Promise.resolve([]);
    return this.ler(c, async (l) => {
      if (d.length === 14) {
        const pj = await l.consultar(
          'SELECT id FROM pessoa_juridica WHERE cnpj = ? AND excluido_em IS NULL',
          [d],
          { teto: 5 },
        );
        return pj.map((x) => ({
          id: Number(x['id']),
          tipo: 'J' as const,
          documento: d,
          profissionais: 0,
          pacientes: 0,
        }));
      }
      const pf = await l.consultar(
        `SELECT pf.id,
                (SELECT COUNT(*) FROM profissional pr WHERE pr.pessoa_fisica_id = pf.id AND pr.excluido_em IS NULL) AS profissionais,
                (SELECT COUNT(*) FROM paciente p WHERE p.pessoa_fisica_id = pf.id AND p.excluido_em IS NULL) AS pacientes
           FROM pessoa_fisica pf WHERE pf.cpf = ? AND pf.excluido_em IS NULL`,
        [d],
        { teto: 5 },
      );
      return pf.map((x) => ({
        id: Number(x['id']),
        tipo: 'F' as const,
        documento: d,
        profissionais: Number(x['profissionais'] ?? 0),
        pacientes: Number(x['pacientes'] ?? 0),
      }));
    });
  }

  siglasDosConselhos(c: ContextoPorta) {
    return this.ler(c, async (l) =>
      (
        await l.consultar('SELECT id, sigla, descricao FROM conselho_classe WHERE ativo ORDER BY sigla', [], {
          teto: 200,
        })
      ).map((x) => ({ conselho: Number(x['id']), sigla: String(x['sigla']), nome: texto(x['descricao']) })),
    );
  }

  conselhoPorSigla(c: ContextoPorta, sigla: string): Promise<number | null> {
    return this.ler(c, async (l) => {
      const x = await l.uma('SELECT id FROM conselho_classe WHERE sigla = ? AND ativo', [
        sigla.trim().toUpperCase(),
      ]);
      return x ? Number(x['id']) : null;
    });
  }

  async cadastrarSolicitante(
    _c: ContextoPorta,
    entrada: CadastrarSolicitanteEntrada,
    ctx: ContextoGravacao,
  ): Promise<GravacaoFeita<{ solicitante: number }>> {
    const r = await this.executor.executar(
      OPERACAO_CADASTRAR_SOLICITANTE,
      this.cliente,
      entrada,
      await this.contextoNucleo(ctx),
    );
    return { resultado: { solicitante: Number(r.resultado.solicitante) }, trilha: r.trilha };
  }

  dadosProfissional(c: ContextoPorta, id: number): Promise<DadosProfissional | null> {
    return this.ler(c, async (l) => {
      const x = await l.uma(
        `SELECT sx.sigla AS sexo, pf.data_nascimento, pf.nome_mae, pr.email_profissional, pr.celular, pr.versao
           FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id LEFT JOIN sexo sx ON sx.id = pf.sexo_id
          WHERE pr.id = ? AND pr.excluido_em IS NULL`,
        [id],
      );
      return x
        ? {
            sexo: texto(x['sexo']),
            nascimento: dataIso(x['data_nascimento']),
            nomeMae: texto(x['nome_mae']),
            email: texto(x['email_profissional']),
            celular: texto(x['celular']),
            versao: versaoTela(x['versao']),
          }
        : null;
    });
  }

  opcoesProfissional(c: ContextoPorta): Promise<OpcoesEdicaoProfissional> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimentoDe(c, l);
      const lista = async (sql: string, p: readonly unknown[] = []) => l.consultar(sql, p, { teto: 10_000 });
      return {
        conselhos: (
          await lista('SELECT sigla, descricao FROM conselho_classe WHERE ativo ORDER BY sigla')
        ).map((x) => ({
          valor: String(x['sigla']),
          rotulo: `${String(x['sigla'])} - ${texto(x['descricao']) ?? ''}`,
        })),
        siglas: [],
        cbos: (
          await lista('SELECT id, codigo_cbo, descricao FROM ocupacao_cbo WHERE ativo ORDER BY descricao')
        ).map((x) => ({
          valor: Number(x['id']),
          rotulo: `${String(x['codigo_cbo'])} - ${texto(x['descricao']) ?? ''}`,
        })),
        especialidades: (
          await lista('SELECT id, descricao FROM especialidade_medica WHERE ativo ORDER BY descricao')
        ).map((x) => ({ valor: Number(x['id']), rotulo: texto(x['descricao']) ?? '' })),
        unidades: (
          await lista(
            'SELECT id, nome FROM unidade_assistencial WHERE estabelecimento_id <=> ? AND ativo AND excluido_em IS NULL ORDER BY nome',
            [est],
          )
        ).map((x) => ({ valor: Number(x['id']), rotulo: texto(x['nome']) ?? '' })),
        convenios: (
          await lista(
            "SELECT id, nome FROM fonte_pagadora WHERE situacao = 'ativa' AND excluido_em IS NULL ORDER BY nome",
          )
        ).map((x) => ({ valor: Number(x['id']), rotulo: texto(x['nome']) ?? '' })),
        ufs: (await lista('SELECT sigla FROM unidade_federativa WHERE ativo ORDER BY sigla')).map((x) =>
          String(x['sigla']),
        ),
      };
    });
  }

  /** D-PROF-39 (fecho-1): as gravações do profissional pelo Executor (profissionais-proprio.ts). */
  async gravarProfissional(
    _c: ContextoPorta,
    operacao: OperacaoProfissionalTela,
    entrada: unknown,
    ctx: ContextoGravacao,
  ): Promise<GravacaoFeita<Record<string, number>>> {
    const op = operacaoProfissionalPropria(operacao);
    if (!op)
      return pendente(
        operacao === 'cadastro.lotarProfissional'
          ? 'A lotação do profissional numa unidade'
          : 'O vínculo do login com o profissional',
      );
    const r = await this.executor.executar(op, this.cliente, entrada, await this.contextoNucleo(ctx));
    return { resultado: r.resultado, trilha: r.trilha };
  }

  /** As contas de pessoa ativas e o profissional a que cada uma está ligada no estabelecimento. */
  loginsProfissional(c: ContextoPorta): Promise<readonly LoginCandidato[]> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimentoDe(c, l);
      const linhas = await l.consultar(
        `SELECT u.login, u.nome,
                (SELECT v.profissional_id FROM usuario_vinculo_profissional v
                  WHERE v.usuario_id = u.id AND v.estabelecimento_id <=> ? AND v.excluido_em IS NULL
                    AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE) AND v.profissional_id IS NOT NULL
                  ORDER BY v.vigencia_inicio DESC LIMIT 1) AS profissional
           FROM usuario u WHERE u.situacao = 'ativo' AND u.tipo_conta = 'pessoa' AND u.excluido_em IS NULL
          ORDER BY u.login LIMIT ${TETO_IDS}`,
        [est],
        { teto: TETO_IDS },
      );
      return linhas.map((x) => ({
        login: String(x['login']),
        nome: texto(x['nome']),
        profissional: inteiro(x['profissional']),
      }));
    });
  }

  /** O login de cada registro: o vínculo da conta com o profissional (vale para o registro principal). */
  loginsDosRegistros(c: ContextoPorta, id: number) {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimentoDe(c, l);
      const linhas = await l.consultar(
        `SELECT ic.id AS registro, u.login FROM usuario_vinculo_profissional v
           JOIN usuario u ON u.id = v.usuario_id
           JOIN inscricao_conselho ic ON ic.profissional_id = v.profissional_id AND ic.principal AND ic.excluido_em IS NULL
          WHERE v.profissional_id = ? AND v.estabelecimento_id <=> ? AND v.excluido_em IS NULL
            AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)`,
        [id, est],
        { teto: 100 },
      );
      return linhas.map((x) => ({ registro: Number(x['registro']), login: String(x['login']) }));
    });
  }

  /** O histórico do vínculo da conta com o profissional (início e fim de cada vigência). */
  eventosProfissional(c: ContextoPorta, id: number): Promise<readonly EventoVinculoProfissional[]> {
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT u.login, v.vigencia_inicio, v.vigencia_fim, uc.login AS por FROM usuario_vinculo_profissional v
           JOIN usuario u ON u.id = v.usuario_id LEFT JOIN usuario uc ON uc.id = v.criado_por
          WHERE v.profissional_id = ? AND v.excluido_em IS NULL ORDER BY v.vigencia_inicio DESC LIMIT 200`,
        [id],
        { teto: 200 },
      );
      return linhas.flatMap((x) => {
        const login = String(x['login']);
        const por = texto(x['por']) ?? '';
        const inicio: EventoVinculoProfissional = {
          evento: 'vinculo',
          registro: null,
          loginAntes: null,
          loginDepois: login,
          motivo: null,
          usuario: por,
          em: dataIso(x['vigencia_inicio']) ?? '',
        };
        const fim = dataIso(x['vigencia_fim']);
        return fim
          ? [
              {
                evento: 'desvinculo',
                registro: null,
                loginAntes: login,
                loginDepois: null,
                motivo: null,
                usuario: por,
                em: fim,
              },
              inicio,
            ]
          : [inicio];
      });
    });
  }

  /** O que impede excluir o profissional (os grupos da memória): atendimentos, login ligado e histórico do login. */
  vinculosProfissional(c: ContextoPorta, id: number) {
    return this.ler(c, (l) => vinculosDoProfissional(l, id));
  }

  procedimentosDaEspecialidade(c: ContextoPorta, especialidade: number, pagina: number, porPagina: number) {
    return this.complemento.procedimentosDaEspecialidade(c, especialidade, pagina, porPagina);
  }
}

// ---- linhas → negócio ----

function versaoDaLinha(x: Linha): VersaoCadastro {
  let dados: Record<string, unknown> = {};
  try {
    const bruto = typeof x['dados'] === 'string' ? JSON.parse(x['dados']) : x['dados'];
    if (bruto && typeof bruto === 'object' && !Array.isArray(bruto)) dados = bruto as Record<string, unknown>;
  } catch {
    dados = {};
  }
  const { telefones, ...valores } = dados;
  return {
    id: Number(x['id']),
    em: instanteIso(x['ocorrido_em']),
    usuario: texto(x['login']),
    valores,
    telefones: Array.isArray(telefones)
      ? telefones
          .filter((t): t is { tipo: number; numero: string } => !!t && typeof t === 'object')
          .map((t) => ({ tipo: Number(t.tipo), numero: String(t.numero) }))
      : [],
  };
}

const SELECT_PAR = `
  SELECT s.id, s.primeiro_paciente_id, s.segundo_paciente_id, s.escore, s.criterio_cpf, s.criterio_fonetica,
         s.criterio_nascimento, s.criterio_mae, s.criterio_telefone, s.situacao, u.login AS decidido_por, s.decidido_em
    FROM suspeita_duplicidade s LEFT JOIN usuario u ON u.id = s.decidido_por_usuario_id`;

function parDaLinha(x: Linha): ParFila {
  const criterios = (['cpf', 'fonetica', 'nascimento', 'mae', 'telefone'] as const).filter((k) =>
    booleano(x[`criterio_${k}`]),
  );
  const sit = texto(x['situacao']);
  return {
    id: Number(x['id']),
    a: Number(x['primeiro_paciente_id']),
    b: Number(x['segundo_paciente_id']),
    escore: Number(x['escore'] ?? 0),
    criterios,
    situacao: sit === 'outra_pessoa' ? 'outra_pessoa' : sit === 'unificado' ? 'unificado' : 'aberto',
    decididoPor: texto(x['decidido_por']),
    decididoEm: instanteIso(x['decidido_em']),
  };
}

// ---- operações (Executor) ----

/** Ids dos domínios por código (a operação recusa o código que falta, com o campo). */
async function idDoDominio(
  tx: TxOperacao,
  tabela: 'tipo_telefone' | 'tipo_endereco' | 'tipo_documento_identificacao',
  codigo: string,
): Promise<number> {
  const x = await tx.uma<{ id: unknown }>(`SELECT id FROM ${tabela} WHERE codigo = ? AND ativo`, [codigo]);
  if (!x)
    throw new ErroOperacao(
      503,
      'dominio-nao-configurado',
      'Cadastro básico incompleto',
      `O domínio "${codigo}" não está configurado neste cliente. Nada foi gravado.`,
    );
  return Number(x.id);
}

async function idDoSexo(tx: TxOperacao, sigla: 'F' | 'M'): Promise<number> {
  const x = await tx.uma<{ id: unknown }>('SELECT id FROM sexo WHERE sigla = ? AND ativo', [sigla]);
  if (!x) throw recusa('sexo-inexistente', 'Sexo não configurado no cadastro básico.', { campos: ['sexo'] });
  return Number(x.id);
}

/** Endereço pela base postal: o CEP tem de existir (recusa com o campo). */
async function enderecoDoCep(tx: TxOperacao, cep: string) {
  const x = await tx.uma(
    `SELECT lc.id, lc.logradouro, lc.especie_logradouro_id, lc.bairro_id, lc.municipio_ibge_id, b.descricao AS bairro
       FROM logradouro_cep lc LEFT JOIN bairro b ON b.id = lc.bairro_id WHERE lc.codigo_cep = ? AND lc.ativo`,
    [cep],
  );
  if (!x)
    throw recusa('cep-inexistente', 'CEP não encontrado no cadastro de CEPs. Confira o CEP.', {
      campos: ['cep'],
    });
  return {
    id: Number(x['id']),
    logradouro: texto(x['logradouro']),
    especie: inteiro(x['especie_logradouro_id']),
    bairro: inteiro(x['bairro_id']),
    municipio: Number(x['municipio_ibge_id']),
  };
}

/** Naturalidade: o município do IBGE pelo nome (e a UF, quando informada). */
async function municipioDaNaturalidade(
  tx: TxOperacao,
  nome: string,
  uf: string | null | undefined,
): Promise<number> {
  const linhas = await tx.consultar<{ id: unknown }>(
    `SELECT m.id FROM municipio_ibge m JOIN unidade_federativa u ON u.id = m.unidade_federativa_id
      WHERE m.nome = ? AND (? IS NULL OR u.sigla = ?) AND m.ativo LIMIT 2`,
    [nome, uf ?? null, uf ?? null],
    { teto: 2 },
  );
  if (linhas.length !== 1)
    throw recusa(
      'naturalidade-inexistente',
      linhas.length === 0
        ? 'Naturalidade não encontrada entre os municípios. Confira o nome e a UF.'
        : 'Há mais de um município com este nome: informe a UF da naturalidade.',
      { campos: linhas.length === 0 ? ['naturalidade'] : ['ufNaturalidade'] },
    );
  return Number(linhas[0]!.id);
}

/** Lê e trava uma linha (SELECT ... FOR UPDATE pelo Escritor); null se não houver. */
async function travarUma<T extends Linha = Linha>(
  tx: TxOperacao,
  sql: string,
  p: readonly unknown[],
): Promise<T | null> {
  const [x] = await tx.consultarParaAtualizar<T>(sql, p, { teto: 1 });
  return x ?? null;
}

async function proximaSequencia(tx: TxOperacao, tabela: string, pessoa: number): Promise<number> {
  const x = await tx.uma<{ n: unknown }>(
    `SELECT COALESCE(MAX(sequencia), 0) + 1 AS n FROM ${tabela} WHERE pessoa_fisica_id = ?`,
    [pessoa],
  );
  return Number(x?.n ?? 1);
}

/** Nome para comparar a mesma pessoa: sem acento, maiúsculo, espaços simples. */
function normalizarNome(n: string): string {
  return n
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Grava o e-mail da pessoa: o mesmo endereço já usado (mesmo excluído) é reativado, nunca incluído de novo (UNIQUE). */
async function gravarEmail(tx: TxOperacao, pessoa: number, email: string): Promise<void> {
  const ja = await travarUma<{ id: unknown; versao: unknown; excluido_em: unknown }>(
    tx,
    'SELECT id, versao, excluido_em FROM email_pessoa WHERE pessoa_fisica_id = ? AND email = ?',
    [pessoa, email],
  );
  if (ja) {
    if (ja.excluido_em !== null && ja.excluido_em !== undefined)
      await tx.alterar('email_pessoa', Number(ja.id), Number(ja.versao), {
        excluido_em: null,
        excluido_por: null,
        principal: true,
      });
    return;
  }
  await tx
    .incluir('email_pessoa', {
      pessoa_fisica_id: pessoa,
      sequencia: await proximaSequencia(tx, 'email_pessoa', pessoa),
      email,
      finalidade: 'pessoal',
      principal: true,
    })
    .catch(recusaDeUnicidade);
}

async function incluirTelefone(
  tx: TxOperacao,
  pessoa: number,
  codigoTipo: string,
  numero: string,
  contato: string | null,
) {
  const { ddd, numero: n } = partesTelefone(numero);
  await tx.incluir('telefone_pessoa', {
    pessoa_fisica_id: pessoa,
    sequencia: await proximaSequencia(tx, 'telefone_pessoa', pessoa),
    tipo_telefone_id: await idDoDominio(tx, 'tipo_telefone', codigoTipo),
    ddi: '55',
    ddd,
    numero: n,
    nome_contato: contato,
    principal: false,
  });
}

/** Retrato da linha do tempo na mesma transação (dedup pelo hash dos dados). */
async function gravarRetrato(
  tx: TxOperacao,
  paciente: number,
  operacao: 'inclusao' | 'alteracao',
  motivo: string,
) {
  const [p] = await lerPacientesPorIds(tx, [paciente]);
  if (!p) return;
  const dados = JSON.stringify(retratoDoPaciente(p));
  const hash = createHash('sha256').update(dados).digest('hex');
  await tx.incluir('paciente_versao', {
    paciente_id: paciente,
    operacao,
    dados,
    ocorrido_em: new Date(),
    usuario_id: tx.contexto.usuario,
    motivo,
    estabelecimento_id: tx.contexto.estabelecimento,
    nome: p.nome,
    data_nascimento: p.nascimento,
    hash_dados: hash,
  });
}

const TABELAS_PACIENTE = [
  'pessoa_fisica',
  'paciente',
  'endereco_pessoa',
  'telefone_pessoa',
  'email_pessoa',
  'documento_pessoa',
  'paciente_versao',
] as const;

/** Violação de unicidade de CPF ou de cartão nacional vira a recusa de negócio com o campo. */
function recusaDeUnicidade(e: unknown): never {
  const r = restricaoUnicaViolada(e);
  if (r === 'uq_pessoa_fisica_cpf')
    throw recusa(
      'cpf-existente',
      'Já existe outra pessoa com este CPF. O sistema não unifica cadastros sozinho.',
      {
        campos: ['cpf'],
      },
    );
  if (r === 'uq_pessoa_fisica_cns')
    throw recusa('cns-existente', 'Já existe outra pessoa com este cartão nacional.', { campos: ['cns'] });
  if (r === 'uq_email_pessoa_fisica_email')
    throw recusa('email-repetido', 'Este e-mail já está no cadastro da pessoa.', { campos: ['email'] });
  throw e;
}

export const OPERACAO_CADASTRAR_PACIENTE = definirOperacao({
  nome: 'cadastro.cadastrar-paciente',
  tabelas: TABELAS_PACIENTE,
  entrada: esquemaCadastrarPaciente,
  acao: 'inclusao',
  async gravar(tx, e) {
    const existente = await travarUma<{ id: unknown; nome: unknown; nasc: unknown; paciente: unknown }>(
      tx,
      `SELECT pf.id, pf.nome, DATE_FORMAT(pf.data_nascimento, '%Y-%m-%d') AS nasc,
              (SELECT p.id FROM paciente p WHERE p.pessoa_fisica_id = pf.id AND p.excluido_em IS NULL LIMIT 1) AS paciente
         FROM pessoa_fisica pf WHERE pf.cpf = ?`,
      [e.cpf],
    );
    if (existente && existente.paciente !== null && existente.paciente !== undefined)
      throw recusa(
        'cpf-existente',
        'Já existe outro paciente com este CPF. O sistema não unifica cadastros.',
        { campos: ['cpf'] },
      );
    // A pessoa já existe sem o papel de paciente (profissional da casa, carga): só o papel é criado, se for a mesma pessoa.
    if (
      existente &&
      (normalizarNome(String(existente.nome)) !== normalizarNome(e.nome) ||
        (existente.nasc !== null && existente.nasc !== e.nascimento))
    )
      throw recusa(
        'cpf-de-outra-pessoa',
        'O CPF é de uma pessoa já cadastrada com outro nome ou nascimento: confira os dados.',
        {
          campos: ['cpf', 'nome', 'nascimento'],
        },
      );
    const endereco = await enderecoDoCep(tx, e.cep);
    const naturalidade = await municipioDaNaturalidade(tx, e.naturalidade, e.ufNaturalidade);
    const pessoa = existente
      ? Number(existente.id)
      : await tx
          .incluir('pessoa_fisica', {
            nome: e.nome,
            cpf: e.cpf,
            data_nascimento: e.nascimento,
            sexo_id: await idDoSexo(tx, e.sexo),
            nome_mae: e.nomeMae ?? null,
            mae_desconhecida: !e.nomeMae,
            naturalidade_municipio_ibge_id: naturalidade,
          })
          .catch(recusaDeUnicidade);
    const numero = await tx.proximoNumero('prontuario', { porCliente: true });
    const paciente = await tx.incluir('paciente', {
      pessoa_fisica_id: pessoa,
      numero_prontuario: numero.valor,
      cadastro_estabelecimento_id: tx.contexto.estabelecimento,
      situacao: 'ativo',
      nome_mae: e.nomeMae ?? null,
      mae_desconhecida: !e.nomeMae,
      naturalidade_municipio_ibge_id: naturalidade,
    });
    await tx.incluir('endereco_pessoa', {
      pessoa_fisica_id: pessoa,
      sequencia: existente ? await proximaSequencia(tx, 'endereco_pessoa', pessoa) : 1,
      tipo_endereco_id: await idDoDominio(tx, 'tipo_endereco', CODIGOS_DOMINIO_CADASTRO.enderecoResidencial),
      cep: e.cep,
      logradouro_cep_id: endereco.id,
      especie_logradouro_id: endereco.especie,
      logradouro: e.logradouro ?? endereco.logradouro ?? '',
      numero: e.numero !== undefined ? String(e.numero) : null,
      sem_numero: e.numero === undefined,
      complemento: e.complemento ?? null,
      bairro_id: e.bairro ? null : endereco.bairro,
      bairro_nome: e.bairro ?? null,
      municipio_ibge_id: endereco.municipio,
      principal: true,
    });
    if (e.telefone)
      await incluirTelefone(tx, pessoa, CODIGOS_DOMINIO_CADASTRO.telefoneFixo, e.telefone, null);
    if (e.celular)
      await incluirTelefone(tx, pessoa, CODIGOS_DOMINIO_CADASTRO.telefoneCelular, e.celular, null);
    if (e.contatoTelefone)
      await incluirTelefone(
        tx,
        pessoa,
        CODIGOS_DOMINIO_CADASTRO.telefoneRecado,
        e.contatoTelefone,
        e.contatoNome ?? null,
      );
    if (e.email) await gravarEmail(tx, pessoa, e.email);
    await gravarRetrato(tx, paciente, 'inclusao', 'alteracao_cadastro');
    return { idPaciente: paciente, prontuario: numero.valor };
  },
  eventos: (_e, r) => [{ tipo: 'cadastro.paciente.incluido', carga: { paciente: r.idPaciente } }],
  alvo: (_e, r) => ({ tabela: 'paciente', id: r.idPaciente }),
});

export const OPERACAO_ALTERAR_PACIENTE = definirOperacao({
  nome: 'cadastro.alterar-paciente',
  tabelas: TABELAS_PACIENTE,
  entrada: esquemaAlterarPaciente,
  acao: 'alteracao',
  travar: (e) => ({
    tabela: 'paciente',
    id: e.idPaciente,
    colunas: ['situacao', 'pessoa_fisica_id'],
    versaoEsperada: versaoDaTela(e.versao),
  }),
  async conferir(_tx, _e, _ctx, relido) {
    const sit = texto(relido?.['situacao']);
    if (sit === 'unificado' || sit === 'inativo')
      throw recusa(
        'cadastro-inativo',
        'Cadastro inativo (absorvido numa unificação): altere o cadastro que ficou ativo.',
      );
  },
  async gravar(tx, e) {
    const [atual] = await lerPacientesPorIds(tx, [e.idPaciente]);
    if (!atual) throw recusa('registro-inexistente', 'O registro não existe mais.');
    const pessoa = Number(
      (
        await tx.uma<{ p: unknown }>('SELECT pessoa_fisica_id AS p FROM paciente WHERE id = ?', [
          e.idPaciente,
        ])
      )?.p,
    );
    const a = e.alteracoes;
    const pf: Record<string, unknown> = {};
    if (a.nome !== undefined) pf['nome'] = a.nome;
    if (a.nascimento !== undefined) pf['data_nascimento'] = a.nascimento;
    if (a.sexo !== undefined) pf['sexo_id'] = await idDoSexo(tx, a.sexo);
    if (a.nomeMae !== undefined) {
      pf['nome_mae'] = a.nomeMae;
      pf['mae_desconhecida'] = a.nomeMae === null;
    }
    if (a.cpf !== undefined) pf['cpf'] = a.cpf;
    if (a.estadoCivil !== undefined) pf['estado_civil_id'] = a.estadoCivil;
    if (a.naturalidade !== undefined || a.ufNaturalidade !== undefined)
      pf['naturalidade_municipio_ibge_id'] = await municipioDaNaturalidade(
        tx,
        a.naturalidade ?? atual.naturalidade ?? '',
        a.ufNaturalidade === undefined ? atual.ufNaturalidade : a.ufNaturalidade,
      );
    let mudou = false;
    if (Object.keys(pf).length > 0) {
      const v = Number(
        (await tx.uma<{ v: unknown }>('SELECT versao AS v FROM pessoa_fisica WHERE id = ?', [pessoa]))?.v,
      );
      await tx.alterar('pessoa_fisica', pessoa, v, pf).catch(recusaDeUnicidade);
      mudou = true;
    }
    // O paciente guarda a mãe também (o papel de paciente): segue a pessoa.
    const doPaciente: Record<string, unknown> =
      a.nomeMae !== undefined ? { nome_mae: a.nomeMae, mae_desconhecida: a.nomeMae === null } : {};
    // Endereço (a linha principal): CEP pela base postal; logradouro, número, complemento e bairro digitados.
    const end: Record<string, unknown> = {};
    if (a.cep !== undefined) {
      const x = await enderecoDoCep(tx, a.cep);
      Object.assign(end, {
        cep: a.cep,
        logradouro_cep_id: x.id,
        especie_logradouro_id: x.especie,
        municipio_ibge_id: x.municipio,
        bairro_id: x.bairro,
        bairro_nome: null,
        logradouro: a.logradouro ?? x.logradouro ?? '',
      });
    }
    if (a.logradouro !== undefined) end['logradouro'] = a.logradouro;
    if (a.numero !== undefined) {
      end['numero'] = a.numero === null ? null : String(a.numero);
      end['sem_numero'] = a.numero === null;
    }
    if (a.complemento !== undefined) end['complemento'] = a.complemento;
    if (a.bairro !== undefined) {
      end['bairro_nome'] = a.bairro;
      end['bairro_id'] = null;
    }
    if (Object.keys(end).length > 0) {
      const linha = await tx.uma(
        'SELECT id, versao FROM endereco_pessoa WHERE pessoa_fisica_id = ? AND excluido_em IS NULL ORDER BY principal DESC, sequencia LIMIT 1',
        [pessoa],
      );
      if (!linha)
        throw recusa('endereco-inexistente', 'O paciente não tem endereço: informe o CEP.', {
          campos: ['cep'],
        });
      await tx.alterar('endereco_pessoa', Number(linha['id']), Number(linha['versao']), end);
      mudou = true;
    }
    // Telefones e e-mail: o informado substitui o do tipo; null apaga.
    const trocarTelefone = async (
      codigo: string,
      valor: string | null | undefined,
      contato: string | null,
    ) => {
      if (valor === undefined) return;
      const tipo = await idDoDominio(tx, 'tipo_telefone', codigo);
      await tx.executar(
        'UPDATE telefone_pessoa SET excluido_em = ?, excluido_por = ? WHERE pessoa_fisica_id = ? AND tipo_telefone_id = ? AND excluido_em IS NULL',
        [new Date(), tx.contexto.usuario, pessoa, tipo],
      );
      if (valor !== null) await incluirTelefone(tx, pessoa, codigo, valor, contato);
      mudou = true;
    };
    await trocarTelefone(CODIGOS_DOMINIO_CADASTRO.telefoneFixo, a.telefone, null);
    await trocarTelefone(CODIGOS_DOMINIO_CADASTRO.telefoneCelular, a.celular, null);
    await trocarTelefone(
      CODIGOS_DOMINIO_CADASTRO.telefoneRecado,
      a.contatoTelefone === undefined && a.contatoNome !== undefined
        ? atual.contatoTelefone
        : a.contatoTelefone,
      a.contatoNome === undefined ? atual.contatoNome : a.contatoNome,
    );
    if (a.email !== undefined && (a.email ?? null) !== (atual.email ?? null)) {
      // Sai o e-mail vigente (exclusão lógica); o novo é reativado se já foi usado (A→B→A) ou incluído.
      await tx.executar(
        'UPDATE email_pessoa SET excluido_em = ?, excluido_por = ? WHERE pessoa_fisica_id = ? AND excluido_em IS NULL AND NOT (email <=> ?)',
        [new Date(), tx.contexto.usuario, pessoa, a.email],
      );
      if (a.email !== null) await gravarEmail(tx, pessoa, a.email);
      mudou = true;
    }
    if (a.identidade !== undefined) {
      const tipo = await idDoDominio(
        tx,
        'tipo_documento_identificacao',
        CODIGOS_DOMINIO_CADASTRO.documentoIdentidade,
      );
      await tx.executar(
        'UPDATE documento_pessoa SET excluido_em = ?, excluido_por = ? WHERE pessoa_fisica_id = ? AND tipo_documento_identificacao_id = ? AND excluido_em IS NULL',
        [new Date(), tx.contexto.usuario, pessoa, tipo],
      );
      if (a.identidade !== null)
        await tx.incluir('documento_pessoa', {
          pessoa_fisica_id: pessoa,
          sequencia: await proximaSequencia(tx, 'documento_pessoa', pessoa),
          tipo_documento_identificacao_id: tipo,
          numero: a.identidade,
          principal: true,
        });
      mudou = true;
    }
    const [depois] = await lerPacientesPorIds(tx, [e.idPaciente]);
    const igual =
      depois && JSON.stringify(retratoDoPaciente(depois)) === JSON.stringify(retratoDoPaciente(atual));
    if (!mudou || igual) throw recusa('sem-alteracao', 'Nenhum campo mudou em relação ao cadastro.');
    // A versão do paciente sobe em toda alteração do cadastro (a tela relê pela coluna versao).
    await tx.alterar('paciente', e.idPaciente, versaoDaTela(e.versao), doPaciente);
    await gravarRetrato(tx, e.idPaciente, 'alteracao', 'alteracao_cadastro');
    return { idPaciente: e.idPaciente };
  },
  eventos: (e) => [{ tipo: 'cadastro.paciente.alterado', carga: { paciente: e.idPaciente } }],
  alvo: (e) => ({ tabela: 'paciente', id: e.idPaciente }),
});

/** As referências a paciente(id) que o banco do cliente declara (o catálogo do próprio banco). */
async function referenciasDoBanco(tx: TxOperacao): Promise<{ tabela: string; coluna: string }[]> {
  const linhas = await tx.consultar<{ t: unknown; c: unknown }>(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'paciente' AND REFERENCED_COLUMN_NAME = 'id'`,
    [],
    { teto: 2000 },
  );
  return linhas.map((x) => ({ tabela: String(x.t), coluna: String(x.c) }));
}

export const OPERACAO_UNIFICAR_PACIENTE = definirOperacao({
  nome: 'cadastro.unificar-paciente',
  tabelas: [
    ...new Set([
      'paciente',
      'unificacao_cadastro',
      'unificacao_cadastro_item',
      'suspeita_duplicidade',
      'paciente_versao',
      ...tabelasDaUnificacao(),
    ]),
  ],
  entrada: esquemaUnificarPaciente,
  acao: 'alteracao',
  async gravar(tx, e) {
    if (tx.contexto.usuario === null)
      throw recusa(
        'usuario-obrigatorio',
        'A unificação exige o usuário do cliente (quem unifica fica registrado).',
      );
    if (e.idAbsorvido === e.idSobrevivente)
      throw recusa('mesmo-cadastro', 'Escolha dois cadastros diferentes.');
    const linhas = await tx.consultarParaAtualizar<{ id: unknown; situacao: unknown; versao: unknown }>(
      'SELECT id, situacao, versao FROM paciente WHERE id IN (?, ?) AND excluido_em IS NULL ORDER BY id',
      [e.idAbsorvido, e.idSobrevivente],
      { teto: 2 },
    );
    const absorvido = linhas.find((x) => Number(x.id) === e.idAbsorvido);
    const sobrevivente = linhas.find((x) => Number(x.id) === e.idSobrevivente);
    if (!absorvido || !sobrevivente)
      throw recusa('registro-inexistente', 'Um dos cadastros não existe mais.');
    if (!['ativo', 'provisorio'].includes(String(sobrevivente.situacao)))
      throw recusa('destino-inativo', 'O cadastro que fica está inativo ou já foi unificado.');
    if (String(absorvido.situacao) === 'unificado')
      throw recusa('ja-unificado', 'O cadastro absorvido já foi unificado.');
    // A lista do domínio tem de cobrir toda chave do banco para paciente: a que faltar recusa (nada fica escondido).
    const plano = planoDeUnificacao(await referenciasDoBanco(tx));
    if (plano.naoCobertas.length > 0)
      throw recusa(
        'unificacao-tabela-nao-coberta',
        `O banco tem registros ligados ao paciente que a unificação ainda não sabe transferir (${plano.naoCobertas.join(', ')}). Nada foi unificado.`,
      );
    const unificacao = await tx.incluir('unificacao_cadastro', {
      mantido_paciente_id: e.idSobrevivente,
      absorvido_paciente_id: e.idAbsorvido,
      suspeita_duplicidade_id: e.par ?? null,
      unificado_em: new Date(),
      unificado_por_usuario_id: tx.contexto.usuario,
      justificativa: e.justificativa ?? 'Unificação de prontuário duplicado',
      situacao: 'efetivada',
    });
    // Cada registro do absorvido passa ao que fica pela trava otimista (versão, alterado_em/por) e vira um item.
    let seq = 0;
    for (const ref of plano.transferir) {
      const tabela = conferirNome(ref.tabela);
      const coluna = conferirNome(ref.coluna);
      const regs = await tx.consultarParaAtualizar<{ id: unknown; versao: unknown }>(
        `SELECT id, versao FROM ${tabela} WHERE ${coluna} = ? ORDER BY id`,
        [e.idAbsorvido],
        { teto: 100_000 },
      );
      for (const r of regs) {
        await tx
          .alterar(tabela, Number(r.id), Number(r.versao), { [coluna]: e.idSobrevivente })
          .catch((x: unknown) => {
            if (restricaoUnicaViolada(x))
              throw recusa(
                'unificacao-conflito',
                `O cadastro que fica já tem um registro igual em ${tabela}: resolva a repetição antes de unificar. Nada foi unificado.`,
              );
            throw x;
          });
        await tx.incluir('unificacao_cadastro_item', {
          unificacao_cadastro_id: unificacao,
          sequencia: ++seq,
          tabela,
          registro_id: Number(r.id),
          coluna,
          // A versão do registro depois desta transferência: desfazer recusa quando ela mudou.
          versao_registro: Number(r.versao) + 1,
          situacao: 'transferido',
        });
      }
    }
    if (seq > 0) {
      const u = await tx.uma<{ versao: unknown }>('SELECT versao FROM unificacao_cadastro WHERE id = ?', [
        unificacao,
      ]);
      await tx.alterar('unificacao_cadastro', unificacao, Number(u?.versao ?? 1), {
        quantidade_registros: seq,
      });
    }
    await tx.alterar('paciente', e.idAbsorvido, Number(absorvido.versao), {
      situacao: 'unificado',
      sobrevivente_paciente_id: e.idSobrevivente,
    });
    const [p1, p2] = [Math.min(e.idAbsorvido, e.idSobrevivente), Math.max(e.idAbsorvido, e.idSobrevivente)];
    await tx.executar(
      `UPDATE suspeita_duplicidade SET situacao = 'unificado', decidido_por_usuario_id = ?, decidido_em = ?, unificacao_cadastro_id = ?
        WHERE primeiro_paciente_id = ? AND segundo_paciente_id = ? AND situacao = 'aberto' AND excluido_em IS NULL`,
      [tx.contexto.usuario, new Date(), unificacao, p1, p2],
    );
    await gravarRetrato(tx, e.idAbsorvido, 'alteracao', 'unificacao');
    return { idAbsorvido: e.idAbsorvido, idSobrevivente: e.idSobrevivente, unificacao };
  },
  eventos: (e) => [
    {
      tipo: 'cadastro.paciente.unificado',
      carga: { absorvido: e.idAbsorvido, sobrevivente: e.idSobrevivente },
    },
  ],
  alvo: (e) => ({ tabela: 'paciente', id: e.idAbsorvido }),
});

/**
 * F3.1 (02-CAD linha 7): desfaz a unificação pelos itens que ela registrou, na ordem inversa. Regra no domínio
 * (planoDeDesfazer, conferirRegistroDevolvido); tudo ou nada: um registro movido de novo recusa a reversão inteira.
 * O absorvido volta a ativo, a unificação fica revertida (com motivo e responsável) e o par da fila volta a aberto.
 */
export const OPERACAO_DESFAZER_UNIFICACAO = definirOperacao({
  nome: 'cadastro.desfazer-unificacao',
  tabelas: [
    ...new Set([
      'paciente',
      'unificacao_cadastro',
      'unificacao_cadastro_item',
      'suspeita_duplicidade',
      'paciente_versao',
      ...tabelasDaUnificacao(),
    ]),
  ],
  entrada: esquemaDesfazerUnificacao,
  acao: 'alteracao',
  async gravar(tx, e) {
    if (tx.contexto.usuario === null)
      throw recusa('usuario-obrigatorio', 'Desfazer a unificação exige o usuário do cliente.');
    const [u] = await tx.consultarParaAtualizar<Record<string, unknown>>(
      `SELECT id, situacao, reversivel, mantido_paciente_id, absorvido_paciente_id, versao FROM unificacao_cadastro
        WHERE id = ? AND excluido_em IS NULL`,
      [e.idUnificacao],
      { teto: 1 },
    );
    if (!u) throw recusa('registro-inexistente', 'A unificação não existe.');
    const mantido = Number(u['mantido_paciente_id']);
    const absorvido = Number(u['absorvido_paciente_id']);
    const itens = (
      await tx.consultarParaAtualizar<Record<string, unknown>>(
        `SELECT id, sequencia, tabela, registro_id, coluna, situacao, versao, versao_registro FROM unificacao_cadastro_item
          WHERE unificacao_cadastro_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
        [e.idUnificacao],
        { teto: 100_000 },
      )
    ).map((x) => ({
      id: Number(x['id']),
      sequencia: Number(x['sequencia']),
      tabela: String(x['tabela']),
      registroId: Number(x['registro_id']),
      coluna: String(x['coluna']),
      situacao: String(x['situacao']),
      versao: Number(x['versao']),
      versaoRegistro: x['versao_registro'] === null ? null : Number(x['versao_registro']),
    }));
    const plano = planoDeDesfazer(
      { situacao: String(u['situacao']), reversivel: Boolean(Number(u['reversivel'])), mantido, absorvido },
      itens,
      e.motivo,
    );
    if (!plano.ok) throw recusa(plano.recusa.codigo, plano.recusa.mensagem);
    const permitidas = new Set(tabelasDaUnificacao());
    const agora = new Date();
    const versaoDoItem = new Map(itens.map((i) => [i.id, i.versao]));
    // 1ª passada: confere todos os registros antes de mexer em qualquer um (tudo ou nada).
    const atuais: {
      item: (typeof plano.devolver)[number];
      tabela: string;
      coluna: string;
      versao: number;
    }[] = [];
    const alterados: { item: (typeof plano.devolver)[number]; mensagem: string }[] = [];
    for (const item of plano.devolver) {
      if (!permitidas.has(item.tabela))
        throw recusa('desfazer-conflito', `A tabela ${item.tabela} não é mais coberta pela unificação.`);
      const tabela = conferirNome(item.tabela);
      const coluna = conferirNome(item.coluna);
      const [r] = await tx.consultarParaAtualizar<Record<string, unknown>>(
        `SELECT id, versao, ${coluna} AS alvo FROM ${tabela} WHERE id = ?`,
        [item.registroId],
        { teto: 1 },
      );
      const conflito = conferirRegistroDevolvido(
        item,
        r ? { apontaPara: Number(r['alvo']), versao: Number(r['versao']) } : null,
        mantido,
      );
      if (conflito?.codigo === RECUSA_REGISTRO_ALTERADO)
        alterados.push({ item, mensagem: conflito.mensagem });
      else if (conflito) throw recusa(conflito.codigo, conflito.mensagem);
      else atuais.push({ item, tabela, coluna, versao: Number(r!['versao']) });
    }
    if (alterados.length > 0) {
      // Registro alterado depois da unificação: nada volta; os itens ficam em conflito e a unificação, não reversível
      // (gravado; a recusa vai ao usuário depois da transação).
      for (const a of alterados)
        await tx.alterar('unificacao_cadastro_item', a.item.id, Number(versaoDoItem.get(a.item.id)), {
          situacao: 'conflito',
        });
      await tx.alterar('unificacao_cadastro', e.idUnificacao, Number(u['versao']), { reversivel: false });
      return {
        idAbsorvido: absorvido,
        idSobrevivente: mantido,
        unificacao: e.idUnificacao,
        recusaCodigo: RECUSA_REGISTRO_ALTERADO,
        recusaMensagem: alterados[0]!.mensagem,
      };
    }
    // 2ª passada: devolve na ordem inversa.
    for (const { item, tabela, coluna, versao } of atuais) {
      await tx.alterar(tabela, item.registroId, versao, { [coluna]: absorvido }).catch((x: unknown) => {
        if (restricaoUnicaViolada(x))
          throw recusa(
            'desfazer-conflito',
            `O cadastro absorvido já tem um registro igual em ${tabela}: nada foi desfeito.`,
          );
        throw x;
      });
      await tx.alterar('unificacao_cadastro_item', item.id, Number(versaoDoItem.get(item.id)), {
        situacao: 'revertido',
        revertido_em: agora,
      });
    }
    const [p] = await tx.consultarParaAtualizar<{
      situacao: unknown;
      sobrevivente_paciente_id: unknown;
      versao: unknown;
    }>(
      'SELECT situacao, sobrevivente_paciente_id, versao FROM paciente WHERE id = ? AND excluido_em IS NULL',
      [absorvido],
      { teto: 1 },
    );
    if (!p || String(p.situacao) !== 'unificado' || Number(p.sobrevivente_paciente_id) !== mantido)
      throw recusa(
        'desfazer-conflito',
        'O cadastro absorvido não está mais unificado neste: nada foi desfeito.',
      );
    await tx.alterar('paciente', absorvido, Number(p.versao), {
      situacao: 'ativo',
      sobrevivente_paciente_id: null,
    });
    await tx.alterar('unificacao_cadastro', e.idUnificacao, Number(u['versao']), {
      situacao: 'revertida',
      revertido_em: agora,
      revertido_por_usuario_id: tx.contexto.usuario,
      motivo_reversao: e.motivo.trim(),
    });
    // O par da fila volta a aberto (a decisão de unificar foi desfeita; o analista decide de novo).
    await tx.executar(
      `UPDATE suspeita_duplicidade SET situacao = 'aberto', decidido_por_usuario_id = NULL, decidido_em = NULL,
          unificacao_cadastro_id = NULL, alterado_em = ?, alterado_por = ?, versao = versao + 1
        WHERE unificacao_cadastro_id = ? AND situacao = 'unificado' AND excluido_em IS NULL`,
      [agora, tx.contexto.usuario, e.idUnificacao],
    );
    // O retrato do desfazer tem motivo próprio (a linha do tempo distingue unificado de unificação desfeita).
    await gravarRetrato(tx, absorvido, 'alteracao', 'unificacao_desfeita');
    return {
      idAbsorvido: absorvido,
      idSobrevivente: mantido,
      unificacao: e.idUnificacao,
      recusaCodigo: null,
      recusaMensagem: null,
    };
  },
  eventos: (e) => [{ tipo: 'cadastro.paciente.unificacao_desfeita', carga: { unificacao: e.idUnificacao } }],
  alvo: (e) => ({ tabela: 'unificacao_cadastro', id: e.idUnificacao }),
});

export const OPERACAO_CADASTRAR_SOLICITANTE = definirOperacao({
  nome: 'cadastro.cadastrar-solicitante',
  tabelas: ['solicitante_externo'],
  entrada: esquemaCadastrarSolicitante,
  acao: 'inclusao',
  async gravar(tx, e) {
    const conselho = await tx.uma('SELECT id, sigla FROM conselho_classe WHERE id = ? AND ativo', [
      e.conselho,
    ]);
    if (!conselho)
      throw recusa('conselho-inexistente', 'Conselho não encontrado no cadastro de conselhos.', {
        campos: ['conselho'],
      });
    const uf = await tx.uma('SELECT id FROM unidade_federativa WHERE sigla = ?', [e.uf]);
    if (!uf) throw recusa('uf-inexistente', 'UF não encontrada.', { campos: ['uf'] });
    if (e.cbo !== undefined && !(await tx.uma('SELECT id FROM ocupacao_cbo WHERE id = ?', [e.cbo])))
      throw recusa('cbo-inexistente', 'Ocupação (CBO) não encontrada.', { campos: ['cbo'] });
    // Repetição pela chave do domínio (conselho, UF e número normalizados: "012345" e "12345" são o mesmo registro),
    // não pela comparação exata do texto gravado.
    const sigla = String(conselho['sigla']);
    const chave = chaveSolicitante({ conselho: sigla, uf: e.uf, numero: e.numero });
    const candidatos = await tx.consultar(
      `SELECT id, numero_conselho FROM solicitante_externo
        WHERE conselho_classe_id = ? AND conselho_unidade_federativa_id = ?
          AND (numero_conselho = ? OR TRIM(LEADING '0' FROM TRIM(numero_conselho)) = ?)`,
      [e.conselho, Number(uf['id']), String(e.numero), String(e.numero)],
    );
    const repetido = candidatos.find((r) => {
      const n = String(r['numero_conselho'] ?? '').trim();
      return /^\d+$/.test(n) && chaveSolicitante({ conselho: sigla, uf: e.uf, numero: Number(n) }) === chave;
    });
    if (repetido)
      throw recusa(
        'solicitante-existente',
        `Já existe um solicitante com este conselho, UF e número (cadastro ${Number(repetido['id'])}).`,
        { campos: ['numero'] },
      );
    const id = await tx.incluir('solicitante_externo', {
      nome: e.nome,
      conselho_classe_id: e.conselho,
      numero_conselho: String(e.numero),
      conselho_unidade_federativa_id: Number(uf['id']),
      ocupacao_cbo_id: e.cbo ?? null,
      ativo: true,
    });
    return { solicitante: id };
  },
  alvo: (_e, r) => ({ tabela: 'solicitante_externo', id: r.solicitante }),
});

/** Inclusão dos pares novos da fila (os já registrados ficam) com a linha da trilha da tela nos dados. */
function operacaoParesDuplicidade(trilha: RegistroTrilhaTela) {
  return definirOperacao({
    nome: 'cadastro.registrar-pares-duplicidade',
    tabelas: ['suspeita_duplicidade'],
    entrada: esquemaParesDuplicidade,
    acao: 'operacao',
    async gravar(tx, e) {
      const inativos = new Set(e.inativos);
      let incluidos = 0;
      for (const p of e.pares) {
        if (inativos.has(p.a) || inativos.has(p.b)) continue;
        const ja = await tx.uma(
          'SELECT id FROM suspeita_duplicidade WHERE primeiro_paciente_id = ? AND segundo_paciente_id = ?',
          [p.a, p.b],
        );
        if (ja) continue;
        await tx.incluir('suspeita_duplicidade', {
          primeiro_paciente_id: p.a,
          segundo_paciente_id: p.b,
          escore: p.escore,
          criterio_cpf: p.criterios.includes('cpf'),
          criterio_fonetica: p.criterios.includes('fonetica'),
          criterio_nascimento: p.criterios.includes('nascimento'),
          criterio_mae: p.criterios.includes('mae'),
          criterio_telefone: p.criterios.includes('telefone'),
          detectado_em: new Date(),
          situacao: 'aberto',
        });
        incluidos++;
      }
      return { incluidos };
    },
    alvo: () => ({ tabela: 'suspeita_duplicidade', id: null }),
    trilha: () => ({ dados: trilha.dadosDepois }),
  });
}

function operacaoOutraPessoa(trilha: RegistroTrilhaTela) {
  return definirOperacao({
    nome: 'cadastro.decidir-outra-pessoa',
    tabelas: ['suspeita_duplicidade'],
    entrada: esquemaDecisaoOutraPessoa,
    acao: 'alteracao',
    travar: (e) => ({
      tabela: 'suspeita_duplicidade',
      id: e.par,
      colunas: ['situacao', 'primeiro_paciente_id', 'segundo_paciente_id'],
    }),
    async conferir(_tx, _e, _ctx, relido) {
      if (texto(relido?.['situacao']) !== 'aberto') throw recusa('par-decidido', 'Este par já foi decidido.');
    },
    async gravar(tx, e) {
      const x = await tx.uma(
        'SELECT primeiro_paciente_id, segundo_paciente_id, versao FROM suspeita_duplicidade WHERE id = ?',
        [e.par],
      );
      if (!x) throw recusa('registro-inexistente', 'O par não existe mais.');
      await tx.alterar('suspeita_duplicidade', e.par, Number(x['versao']), {
        situacao: 'outra_pessoa',
        decidido_por_usuario_id: tx.contexto.usuario,
        decidido_em: new Date(),
        justificativa: e.justificativa,
      });
      return { a: Number(x['primeiro_paciente_id']), b: Number(x['segundo_paciente_id']) };
    },
    alvo: (e) => ({ tabela: 'suspeita_duplicidade', id: e.par }),
    trilha: () => ({ dados: trilha.dadosDepois, motivo: null }),
  });
}
