// Porta da assinatura ICP-Brasil sobre o banco do cliente (F2.2, lote 02-01), pelo @sgh/nucleo. Leituras somente
// leitura; gravações pelo Executor (trilha, outbox e idempotência na mesma transação; a linha da trilha leva o
// evento, o recurso e a chave da tela nos dados).
//   - Identidade: usuario (CPF da conta), usuario_vinculo_profissional → profissional → pessoa_fisica (CPF do
//     profissional) e inscricao_conselho (conselho_classe, unidade_federativa, ocupacao_cbo).
//   - Catálogos: formato_assinatura_icp, tipo_certificado, conselho_classe, oid_icp (da rede inteira: não têm
//     estabelecimento).
//   - Certificado: certificado_usuario (da pessoa, vale em todos os estabelecimentos do cliente; a chave privada
//     nunca é guardada). Provedor em nuvem: provedor_assinatura_nuvem (do estabelecimento ou de todos).
//   - Documento do prontuário a assinar: documento_prontuario (fila do autor e leitura por id).
//   - Verificador público: documento_assinado + assinatura_documento (leitura pelo código) e
//     consulta_verificacao_documento (cada consulta).
// Motor da assinatura (F2.4, lote 20): política por tipo (politica_assinatura + regra_politica_assinatura), pedido de
// autorização do titular (pedido_assinatura), tentativa com reprocessamento (assinatura_icp), validação
// (validacao_assinatura), prévia exata (previa_assinatura, PDF em arquivo), avisos (aviso_assinatura), numeração da
// receita controlada (pedido_numeracao_receita) e, ao concluir, o envelope do documento (documento_assinado +
// assinatura_documento) e o evento "assinatura" na cadeia do documento (documento_prontuario_evento). A parte pública do
// certificado (DER) e o identificador do cliente OAuth e as autoridades do provedor usam colunas pedidas: a porta
// as grava e lê quando o banco já as tem (conferência no information_schema, uma vez por porta).
// Melhoria: o certificado é identificado pela impressão digital SHA-256 do DER (único por usuário no banco), com
// titular, CPF e validade em colunas; o primeiro certificado ativo do usuário vira o padrão; desvincular é exclusão
// lógica auditada (o certificado continua legível por id para conferir assinaturas antigas).
// Melhoria: a consulta pública guarda o código informado e o resultado no vocabulário do banco (autêntico,
// alterado, não encontrado, bloqueado); a origem gravada é sempre a mascarada.
// Melhoria: a fila do autor sai já na prioridade do domínio (prioridadeIcp), ordenada no banco antes do teto.
// Melhoria: só documentos em situação assinável (lista positiva: lançado, validado, aguardando assinatura) entram na
// fila; rascunho, corrigido e arquivado são recusados como suspensos (regras-assinatura.ts).
// Melhoria: o verificador lê todas as assinaturas do envelope e só o declara válido com todas válidas e a quantidade
// exigida alcançada; mostra a data real da assinatura e o registro no conselho do signatário.
// Melhoria: o provedor em nuvem é do estabelecimento: a gravação exige o estabelecimento e só acha o do próprio
// estabelecimento (o provedor da rede inteira, estabelecimento nulo, é só leitura aqui).
import { createHash, randomUUID } from 'node:crypto';
import { lerCertificado, mascararCpf, prioridadeIcp, tipoPelaPolitica } from '@sgh/dominio-documento';
import {
  bloqueadoParaAssinatura,
  CATEGORIAS_ASSINAVEIS,
  estadoDoEnvelope,
  registroExibido,
} from './aplicacao/regras-assinatura.js';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  restricaoUnicaViolada,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import {
  type ContextoAssinatura,
  type GravadorAssinatura,
  type PortaAssinaturaIcp,
  type TrilhaDaGravacao,
} from './porta.js';
import {
  type AssinaturaDoDocumento,
  type AssinaturaRealizada,
  type AtualizacaoAssinatura,
  type AvisoAssinatura,
  type DocumentoAssinadoIcp,
  type EstadoAssinatura,
  type FormatoAssinatura,
  type NivelAssinatura,
  type PedidoAssinaturaAberto,
  type PedidoNumeracao,
  type PoliticaIcp,
  type PoliticaVigente,
  type PreviaDoDocumento,
  type ResultadoValidacao,
  type CertificadoVinculado,
  type DocumentoEmitidoIcp,
  type DocumentoNaFilaIcp,
  type DocumentoVerificado,
  ErroAssinatura,
  type FormaAssinaturaIcp,
  type IdentidadeParaCertificado,
  type MidiaCertificado,
  type ProvedorNuvem,
  type ResultadoVerificacao,
  type ResumoVerificacoes,
  TIPOS_DOCUMENTO_ICP,
  type TipoCertificado,
  type TrilhaAssinatura,
} from './tipos.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoAssinatura = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const textoOuNulo = (v: unknown) => (v === null || v === undefined ? null : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : new Date(String(v)).toISOString();
const sha256Hex = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const simNao = (v: unknown) => (v === null || v === undefined ? null : verdadeiro(v));
const base64 = (v: unknown) => (v instanceof Uint8Array ? Buffer.from(v).toString('base64') : null);
/** Lista de textos de uma coluna JSON (o driver devolve o texto). */
const textos = (v: unknown): string[] => {
  try {
    const x: unknown = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(x) ? x.map(String) : [];
  } catch {
    return [];
  }
};

/** Tabelas que as gravações desta porta podem tocar (a transação recusa as outras). */
export const TABELAS_ASSINATURA = [
  'certificado_usuario',
  'provedor_assinatura_nuvem',
  'consulta_verificacao_documento',
  'politica_assinatura',
  'regra_politica_assinatura',
  'pedido_assinatura',
  'assinatura_icp',
  'validacao_assinatura',
  'previa_assinatura',
  'aviso_assinatura',
  'pedido_numeracao_receita',
  'arquivo',
  'documento_prontuario',
  'documento_prontuario_evento',
  'documento_assinado',
  'assinatura_documento',
] as const;

/** Resultado da consulta pública no vocabulário do banco (CHECK ck_consulta_verificacao_documento_resultado). */
const RESULTADO_NO_BANCO: Readonly<Record<ResultadoVerificacao, string>> = {
  valida: 'autentico',
  invalida: 'alterado',
  'nao-encontrado': 'nao_encontrado',
  barrada: 'bloqueado',
  indeterminada: 'indeterminado',
  pendente: 'pendente',
};
const RESULTADO_DO_BANCO: Readonly<Record<string, ResultadoVerificacao>> = {
  autentico: 'valida',
  alterado: 'invalida',
  revogado: 'invalida',
  nao_encontrado: 'nao-encontrado',
  bloqueado: 'barrada',
  indeterminado: 'indeterminada',
  pendente: 'pendente',
};

const POLITICA_DO_FORMATO: Readonly<Record<string, 'AD-RB' | 'AD-RT'>> = { ad_rb: 'AD-RB', ad_rt: 'AD-RT' };
const POLITICA_ICP_NO_BANCO: Readonly<Record<PoliticaIcp, string>> = { 'AD-RB': 'ad_rb', 'AD-RT': 'ad_rt' };

/** Os tipos de documento ICP na prioridade do domínio (DP-23), para o ORDER BY FIELD da fila. */
const TIPOS_POR_PRIORIDADE: readonly string[] = [...TIPOS_DOCUMENTO_ICP].sort(
  (a, b) => prioridadeIcp(a) - prioridadeIcp(b),
);

/** Estrutura que ainda falta no modelo (coluna pedida): 503 explícito, sem gravar nada. */
export function modeloPendente(recurso: string): ErroOperacao {
  return new ErroOperacao(
    503,
    'modelo-pendente',
    'Recurso indisponível neste ambiente',
    `${recurso}: o banco do cliente ainda não tem a tabela deste registro (atualização do modelo pendente).`,
  );
}

/** Colunas pedidas ao modelo que a porta usa quando já existem. */
interface ColunasOpcionais {
  readonly certificadoDer: boolean;
  readonly clienteProvedor: boolean;
  readonly autoridadesProvedor: boolean;
  readonly versaoArquivo: boolean;
}

const SQL_COLUNAS_OPCIONAIS = `
  SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND ((TABLE_NAME = 'certificado_usuario' AND COLUMN_NAME = 'certificado_der')
       OR (TABLE_NAME = 'provedor_assinatura_nuvem' AND COLUMN_NAME IN ('cliente_identificador', 'autoridades'))
       OR (TABLE_NAME = 'arquivo' AND COLUMN_NAME = 'versao_objeto'))`;

/** A versão do objeto: a da coluna pedida, ou a que a emissão do documento registrou para a mesma chave. */
const versaoDoArquivo = (o: ColunasOpcionais, a: string) =>
  `COALESCE(${o.versaoArquivo ? `${a}.versao_objeto, ` : ''}(SELECT e.versao_objeto FROM emissao_documento e
     WHERE e.chave_objeto = ${a}.chave_armazenamento ORDER BY e.id DESC LIMIT 1))`;

const SQL_ASSINATURA = `
  SELECT a.id, a.origem_assinatura, a.documento_prontuario_id, a.hash_assinado, a.politica_icp, a.midia,
         a.certificado_usuario_id, a.situacao, a.tentativas, a.falha, a.carimbo_tempo_em, a.criado_em,
         pr.codigo AS provedor
    FROM assinatura_icp a
    JOIN usuario u ON u.id = a.usuario_id
    LEFT JOIN provedor_assinatura_nuvem pr ON pr.id = a.provedor_assinatura_nuvem_id`;

const SQL_PREVIA = (o: ColunasOpcionais) => `
  SELECT pv.id, pv.documento_prontuario_id, pv.certificado_usuario_id, pv.politica_icp, pv.hash_pdf,
         pv.codigo_verificacao, pv.assinar_em, pv.profissional_exibido, pv.registro_exibido, pv.criado_em, u.login,
         ar.chave_armazenamento, ${versaoDoArquivo(o, 'ar')} AS versao_objeto
    FROM previa_assinatura pv
    JOIN usuario u ON u.id = pv.usuario_id
    JOIN arquivo ar ON ar.id = pv.arquivo_id`;

const SQL_CERTIFICADO = (der: boolean) => `
  SELECT cu.id, cu.midia, cu.tipo_certificado_id, cu.numero_serie, cu.emissor, cu.valido_de, cu.valido_ate,
         cu.cpf_titular, cu.situacao, cu.excluido_em, cu.criado_em, u.login, p.codigo AS provedor
         ${der ? ', cu.certificado_der' : ''}
    FROM certificado_usuario cu
    JOIN usuario u ON u.id = cu.usuario_id
    LEFT JOIN provedor_assinatura_nuvem p ON p.id = cu.provedor_assinatura_nuvem_id`;

const SQL_PROVEDOR = (o: ColunasOpcionais) => `
  SELECT p.id, p.codigo, p.nome, p.url_servico, p.referencia_cofre, p.ativo, p.versao,
         COALESCE(p.alterado_em, p.criado_em) AS alterado_em, u.login AS alterado_por
         ${o.clienteProvedor ? ', p.cliente_identificador' : ''}${o.autoridadesProvedor ? ', p.autoridades' : ''}
    FROM provedor_assinatura_nuvem p
    LEFT JOIN usuario u ON u.id = COALESCE(p.alterado_por, p.criado_por)
   WHERE (p.estabelecimento_id = ? OR p.estabelecimento_id IS NULL)`;

/** O do estabelecimento antes do da rede inteira, quando os dois têm o mesmo código. */
const ORDEM_PROVEDOR = 'ORDER BY (p.estabelecimento_id IS NULL), p.codigo';

/** O autor do documento: a conta ligada ao profissional no estabelecimento do documento, vigente. */
const SQL_LOGIN_DO_AUTOR = `
  (SELECT u.login FROM usuario_vinculo_profissional v JOIN usuario u ON u.id = v.usuario_id
    WHERE v.profissional_id = dp.profissional_id AND v.estabelecimento_id = dp.estabelecimento_id
      AND v.excluido_em IS NULL AND u.excluido_em IS NULL
      AND v.vigencia_inicio <= CURRENT_DATE AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
    ORDER BY v.vigencia_inicio DESC LIMIT 1)`;

const SQL_DOCUMENTO = `
  SELECT dp.id, t.codigo AS tipo, dp.entidade_origem, dp.entidade_origem_id, dp.paciente_id, dp.atendimento_id,
         dp.lancado_em, dp.conteudo, s.categoria, da.hash_conteudo, da.nivel_exigido, da.concluido_em,
         ${SQL_LOGIN_DO_AUTOR} AS autor
    FROM documento_prontuario dp
    JOIN tipo_documento_clinico t ON t.id = dp.tipo_documento_clinico_id
    JOIN situacao_documento_prontuario s ON s.id = dp.situacao_documento_prontuario_id
    LEFT JOIN documento_assinado da ON da.id = dp.documento_assinado_id AND da.excluido_em IS NULL
   WHERE dp.id = ? AND dp.estabelecimento_id = ? AND dp.excluido_em IS NULL`;


export class PortaAssinaturaPropria implements PortaAssinaturaIcp {
  readonly destino = 'proprio' as const;
  private readonly executor: Executor;
  private colunas: Promise<ColunasOpcionais> | null = null;

  constructor(
    private readonly nucleo: NucleoAssinatura,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  /** Os códigos dos estabelecimentos ativos do cliente (onde o verificador público procura o código). */
  async estabelecimentosAtivos(): Promise<string[]> {
    const ls = await this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'assinatura-estabelecimentos' }, (l) =>
      l.consultar('SELECT codigo FROM estabelecimento WHERE ativo AND excluido_em IS NULL ORDER BY id', []),
    );
    return ls.map((r) => texto(r['codigo']));
  }

  // ---- apoio ----

  private correlacao(c: ContextoAssinatura): string {
    return (c.correlacao ?? '').slice(0, 64) || 'assinatura-icp';
  }

  private ler<T>(c: ContextoAssinatura, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: this.correlacao(c) }, fn);
  }

  /** O estabelecimento da chamada pelo id da sessão, ou pelo código (agendador e verificador público). */
  private async estabelecimento(c: ContextoAssinatura, l: Leitor): Promise<number | null> {
    if (c.estabelecimento) return c.estabelecimento;
    if (!c.hospital) return null;
    const r = await l.uma<{ id: unknown }>(
      'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
      [c.hospital],
    );
    return r ? n(r.id) : null;
  }

  private opcionais(l: Leitor): Promise<ColunasOpcionais> {
    this.colunas ??= l
      .consultar(SQL_COLUNAS_OPCIONAIS, [])
      .then((ls) => {
        const tem = (t: string, c: string) => ls.some((x) => x['t'] === t && x['c'] === c);
        return {
          certificadoDer: tem('certificado_usuario', 'certificado_der'),
          clienteProvedor: tem('provedor_assinatura_nuvem', 'cliente_identificador'),
          autoridadesProvedor: tem('provedor_assinatura_nuvem', 'autoridades'),
          versaoArquivo: tem('arquivo', 'versao_objeto'),
        };
      })
      .catch((e: unknown) => {
        this.colunas = null;
        throw e;
      });
    return this.colunas;
  }

  // ---- gravação ----

  async gravar<T>(
    c: ContextoAssinatura,
    fn: (g: GravadorAssinatura) => Promise<T>,
    trilha: TrilhaDaGravacao<T>,
  ): Promise<T> {
    const estabelecimento = c.estabelecimento ?? (await this.ler(c, (l) => this.estabelecimento(c, l)));
    const contexto: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento,
      usuario: c.usuario ?? null,
      correlacao: this.correlacao(c),
      chaveIdempotencia: `assinatura:${randomUUID()}`,
      ...(c.enderecoIp !== undefined ? { enderecoIp: c.enderecoIp } : {}),
    };
    let feito: { r: T } | null = null;
    let linha: TrilhaAssinatura | null = null;
    let erroNegocio: ErroAssinatura | null = null;
    const op = definirOperacao({
      nome: 'assinatura.gravar',
      tabelas: TABELAS_ASSINATURA,
      entrada: z.object({}).strict(),
      gravar: async (tx: TxOperacao) => {
        try {
          const r = await fn(this.gravador(tx, c));
          feito = { r };
          linha = typeof trilha === 'function' ? trilha(r) : trilha;
        } catch (e) {
          if (e instanceof ErroAssinatura) erroNegocio = e;
          throw e;
        }
        return { gravado: linha !== null };
      },
      alvo: () => ({
        tabela: (linha as TrilhaAssinatura | null)?.entidade ?? 'certificado_usuario',
        id: (linha as TrilhaAssinatura | null)?.entidadeId ?? null,
      }),
      trilha: () => {
        const l = linha as TrilhaAssinatura | null;
        return {
          ...(l ? { acao: l.acao } : {}),
          motivo: l?.motivo ?? null,
          dados: l ? { ...(l.dadosDepois as object), resultado: l.resultado ?? 'sucesso' } : { semAlteracao: true },
        };
      },
    });
    try {
      await this.executor.executar(op, this.cliente, {}, contexto);
    } catch (e) {
      if (erroNegocio) throw erroNegocio;
      throw e;
    }
    return (feito as { r: T } | null)!.r;
  }

  private gravador(tx: TxOperacao, c: ContextoAssinatura): GravadorAssinatura {
    const est = () => this.estDaGravacao(tx, c.hospital);
    return {
      gravarCertificado: (x) => this.gravarCertificado(tx, x),
      inativarCertificado: (d) => this.inativarCertificado(tx, d),
      gravarPolitica: (p) => this.gravarPolitica(tx, p),
      gravarProvedor: (p, v) => this.gravarProvedor(tx, c, p, v),
      gravarPedido: (p) => this.gravarPedido(tx, p),
      consumirPedido: (h, dono, agora) => this.consumirPedido(tx, h, dono, agora),
      gravarAssinatura: (a) => this.gravarAssinatura(tx, a),
      gravarValidacao: async (v) => this.gravarValidacao(tx, await est(), v),
      gravarPrevia: (p) => this.gravarPrevia(tx, p),
      gravarAssinaturaPdf: async (a) => this.gravarAssinaturaPdf(tx, await est(), a),
      registrarPdfAssinado: async (a) => this.registrarPdfAssinado(tx, await est(), a),
      atualizarAssinatura: (a) => this.atualizarAssinatura(tx, a),
      travarDocumentoParaAssinar: (h, d, x) => this.travarDocumentoParaAssinar(tx, h, d, x),
      gravarEventoAssinadoIcp: (ctx, d, suporte) => this.gravarEventoAssinadoIcp(tx, ctx, d, suporte),
      gravarAviso: (a) => this.gravarAviso(tx, a),
      marcarAvisosLidos: (h, avs, por, agora) => this.marcarAvisosLidos(tx, h, avs, por, agora),
      gravarSolicitacaoSncr: (x) => this.gravarSolicitacaoSncr(tx, x),
      atualizarSolicitacaoSncr: (x) => this.atualizarSolicitacaoSncr(tx, x),
      gravarNumeroSncr: (h, d, num) => this.gravarNumeroSncr(tx, h, d, num),
      registrarConsultaPublica: (x) => this.registrarConsultaPublica(tx, x),
    };
  }

  private async usuarioDoLogin(e: Leitor, login: string): Promise<{ id: number; nome: string; cpf: string | null }> {
    const u = await e.uma('SELECT id, nome, cpf FROM usuario WHERE login = ? AND excluido_em IS NULL', [login]);
    if (!u) throw recusa('usuario-desconhecido', 'A conta da sessão não existe mais.');
    return { id: n(u['id']), nome: texto(u['nome']), cpf: textoOuNulo(u['cpf']) };
  }

  private async gravarCertificado(
    tx: TxOperacao,
    x: Parameters<GravadorAssinatura['gravarCertificado']>[0],
  ): Promise<{ id: number }> {
    const u = await this.usuarioDoLogin(tx, x.usuario);
    // O CPF do certificado já foi conferido com o da conta (domínio); o banco exige o CPF ou o CNPJ do titular.
    if (!u.cpf) throw recusa('cpf-ausente', 'A conta não tem CPF: o certificado não pode ser vinculado.');
    const der = Buffer.from(x.certificadoDer, 'base64');
    const impressao = sha256Hex(der);
    const ja = await tx.uma('SELECT id FROM certificado_usuario WHERE usuario_id = ? AND impressao_digital = ?', [
      u.id,
      impressao,
    ]);
    if (ja) throw new ErroAssinatura('certificado-ja-vinculado', 'Este certificado já está vinculado à sua conta.');
    const provedor = x.provedor
      ? await tx.uma(
          `SELECT id FROM provedor_assinatura_nuvem
            WHERE codigo = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
            ORDER BY (estabelecimento_id IS NULL) LIMIT 1`,
          [x.provedor, tx.contexto.estabelecimento],
        )
      : null;
    if (x.provedor && !provedor) throw recusa('provedor-desconhecido', 'O provedor do certificado não existe.');
    const outroAtivo = await tx.uma(
      "SELECT id FROM certificado_usuario WHERE usuario_id = ? AND situacao = 'ativo' AND excluido_em IS NULL LIMIT 1",
      [u.id],
    );
    const col = await this.opcionais(tx);
    const id = await tx
      .incluir('certificado_usuario', {
        usuario_id: u.id,
        tipo_certificado_id: x.idTipoCertificado,
        midia: x.midia,
        provedor_assinatura_nuvem_id: provedor ? n(provedor['id']) : null,
        nome_titular: u.nome.slice(0, 150),
        cpf_titular: u.cpf,
        emissor: x.emissorHash,
        numero_serie: x.serie.slice(0, 64),
        impressao_digital: impressao,
        valido_de: x.validoDe,
        valido_ate: x.validoAte,
        padrao: !outroAtivo,
        situacao: 'ativo',
        origem: 'sistema',
        ...(col.certificadoDer ? { certificado_der: der } : {}),
      })
      .catch((e: unknown) => {
        if (restricaoUnicaViolada(e))
          throw new ErroAssinatura('certificado-ja-vinculado', 'Este certificado já está vinculado à sua conta.');
        throw e;
      });
    return { id };
  }

  private async inativarCertificado(
    tx: TxOperacao,
    d: Parameters<GravadorAssinatura['inativarCertificado']>[0],
  ): Promise<boolean> {
    const [r] = await tx.consultarParaAtualizar(
      `SELECT cu.id, cu.versao FROM certificado_usuario cu JOIN usuario u ON u.id = cu.usuario_id
        WHERE cu.id = ? AND u.login = ? AND cu.excluido_em IS NULL AND cu.situacao = 'ativo'`,
      [d.id, d.usuario],
    );
    if (!r) return false;
    await tx.alterar('certificado_usuario', n(r['id']), n(r['versao']), {
      excluido_em: d.em,
      excluido_por: tx.contexto.usuario,
      padrao: false,
    });
    return true;
  }

  private async gravarProvedor(
    tx: TxOperacao,
    c: ContextoAssinatura,
    p: Parameters<GravadorAssinatura['gravarProvedor']>[0],
    versaoEsperada: number | null,
  ): Promise<{ id: number; versao: number }> {
    const col = await this.opcionais(tx);
    const extras = {
      ...(col.clienteProvedor ? { cliente_identificador: p.clientId.slice(0, 200) } : {}),
      ...(col.autoridadesProvedor ? { autoridades: JSON.stringify([...p.autoridades]) } : {}),
    };
    const estabelecimento = tx.contexto.estabelecimento ?? (await this.estabelecimento(c, tx));
    // O provedor é do estabelecimento (as credenciais no cofre também): sem estabelecimento resolvido, recusa, em vez
    // de criar um provedor para a rede inteira.
    if (!estabelecimento)
      throw recusa('estabelecimento-ausente', 'Escolha o estabelecimento antes de cadastrar o provedor.');
    // Só o provedor deste estabelecimento: o de outro, ou o da rede inteira, não é alterado por aqui.
    const [atual] = await tx.consultarParaAtualizar(
      'SELECT id, versao FROM provedor_assinatura_nuvem WHERE codigo = ? AND estabelecimento_id = ?',
      [p.codigo, estabelecimento],
    );
    if (versaoEsperada === null) {
      if (atual) throw new ErroAssinatura('provedor-repetido', 'Já existe um provedor com este código.');
      const tipo = await tx.uma(
        `SELECT id FROM tipo_certificado WHERE ativo AND (codigo = ? OR modalidade = 'nuvem')
          ORDER BY (codigo = ?) DESC, id LIMIT 1`,
        [p.codigo, p.codigo],
      );
      if (!tipo)
        throw recusa(
          'tipo-certificado-ausente',
          'Cadastre o tipo de certificado em nuvem antes de cadastrar o provedor.',
        );
      const id = await tx
        .incluir('provedor_assinatura_nuvem', {
          estabelecimento_id: estabelecimento,
          codigo: p.codigo,
          nome: p.nome.slice(0, 150),
          tipo_certificado_id: n(tipo['id']),
          url_servico: p.uriBase,
          referencia_cofre: p.segredoRef,
          ambiente: 'producao',
          homologado: false,
          ativo: p.ativo,
          ...extras,
        })
        .catch((e: unknown) => {
          if (restricaoUnicaViolada(e))
            throw new ErroAssinatura('provedor-repetido', 'Já existe um provedor com este código.');
          throw e;
        });
      return { id, versao: 1 };
    }
    if (!atual || n(atual['versao']) !== versaoEsperada)
      throw new ErroAssinatura('versao-desatualizada', 'O provedor foi alterado por outra pessoa. Abra de novo.');
    const versao = await tx.alterar('provedor_assinatura_nuvem', n(atual['id']), versaoEsperada, {
      nome: p.nome.slice(0, 150),
      url_servico: p.uriBase,
      ativo: p.ativo,
      ...extras,
    });
    return { id: n(atual['id']), versao };
  }

  private async registrarConsultaPublica(
    tx: TxOperacao,
    x: Parameters<GravadorAssinatura['registrarConsultaPublica']>[0],
  ): Promise<{ id: number }> {
    const resultado = RESULTADO_NO_BANCO[x.resultado];
    const id = await tx.incluir('consulta_verificacao_documento', {
      documento_assinado_id: x.previa,
      codigo_informado: x.codigo.slice(0, 64),
      canal: 'portal',
      resultado,
      ocorrido_em: new Date(),
      endereco_ip: x.origemMascarada.slice(0, 45),
    });
    return { id };
  }

  // ---- motor da assinatura ICP: política, pedido, tentativa, validação, prévia, avisos e numeração ----

  /** O estabelecimento da gravação: o da sessão, ou o do código (agendador, reprocessamento). */
  private async estDaGravacao(tx: TxOperacao, hospital: string): Promise<number> {
    const est = tx.contexto.estabelecimento ?? (await this.estabelecimento({ rede: '', hospital }, tx));
    if (!est) throw recusa('estabelecimento-ausente', 'Escolha o estabelecimento antes de assinar.');
    return est;
  }

  private async idDoLogin(e: Leitor, login: string | null): Promise<number | null> {
    if (!login) return null;
    const u = await e.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [login]);
    return u ? n(u['id']) : null;
  }

  private async idProvedor(e: Leitor, est: number, codigo: string | null): Promise<number | null> {
    if (!codigo) return null;
    const r = await e.uma(
      `SELECT id FROM provedor_assinatura_nuvem
        WHERE codigo = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
        ORDER BY (estabelecimento_id IS NULL) LIMIT 1`,
      [codigo, est],
    );
    if (!r) throw recusa('provedor-desconhecido', 'O provedor de assinatura não existe neste estabelecimento.');
    return n(r['id']);
  }

  /**
   * Política por tipo de documento: o cabeçalho (politica_assinatura, um vigente por tipo e estabelecimento) e a
   * regra por destino e conselho (regra_politica_assinatura, uma vigente por chave). Mudar a regra encerra a vigente
   * na véspera e abre outra hoje; a segunda mudança no mesmo dia altera a de hoje (versão nova, trilha completa).
   */
  private async gravarPolitica(
    tx: TxOperacao,
    p: Parameters<GravadorAssinatura['gravarPolitica']>[0],
  ): Promise<{ id: number }> {
    const est = await this.estDaGravacao(tx, p.hospital);
    const tipo = await tx.uma('SELECT id FROM tipo_documento_clinico WHERE codigo = ?', [p.tipoDocumento]);
    if (!tipo) throw recusa('tipo-documento-desconhecido', 'O tipo de documento não existe no catálogo.');
    const conselho = p.conselho
      ? await tx.uma('SELECT id FROM conselho_classe WHERE sigla = ?', [p.conselho])
      : null;
    if (p.conselho && !conselho) throw recusa('conselho-desconhecido', 'O conselho profissional não existe.');
    const datas = await tx.uma<{ hoje: unknown; ontem: unknown }>(
      'SELECT CURRENT_DATE AS hoje, CURRENT_DATE - INTERVAL 1 DAY AS ontem',
      [],
    );
    const [cab] = await tx.consultarParaAtualizar(
      `SELECT id FROM politica_assinatura
        WHERE estabelecimento_id = ? AND tipo_documento_clinico_id = ? AND ativo AND vigencia_fim IS NULL
        ORDER BY vigencia_inicio DESC LIMIT 1`,
      [est, n(tipo['id'])],
    );
    const politica = cab
      ? n(cab['id'])
      : await tx.incluir('politica_assinatura', {
          estabelecimento_id: est,
          tipo_documento_clinico_id: n(tipo['id']),
          exige_assinatura: true,
          padrao_assinatura: p.politicaIcp ? POLITICA_ICP_NO_BANCO[p.politicaIcp] : 'ad_rb',
          quem_assina: 'autor',
          vigencia_inicio: datas?.hoje,
          ativo: true,
        });
    const escopo = conselho ? n(conselho['id']) : 0;
    const chave = 'politica_assinatura_id = ? AND destino = ? AND escopo_conselho = ?';
    const [deHoje] = await tx.consultarParaAtualizar(
      `SELECT id, versao FROM regra_politica_assinatura WHERE ${chave} AND vigencia_inicio = CURRENT_DATE`,
      [politica, p.destino, escopo],
    );
    const [vigente] = await tx.consultarParaAtualizar(
      `SELECT id, versao FROM regra_politica_assinatura WHERE ${chave} AND vigente = 1 AND id <> ?`,
      [politica, p.destino, escopo, deHoje ? n(deHoje['id']) : 0],
    );
    if (vigente)
      await tx.alterar('regra_politica_assinatura', n(vigente['id']), n(vigente['versao']), {
        vigencia_fim: datas?.ontem,
      });
    const valores = {
      nivel: p.nivel,
      padrao_assinatura: p.politicaIcp ? POLITICA_ICP_NO_BANCO[p.politicaIcp] : null,
      formato: p.formato,
      justificativa: p.justificativa.slice(0, 500),
      ativo: p.ativa,
    };
    if (deHoje) {
      await tx.alterar('regra_politica_assinatura', n(deHoje['id']), n(deHoje['versao']), {
        ...valores,
        vigencia_fim: null,
      });
      return { id: n(deHoje['id']) };
    }
    const id = await tx.incluir('regra_politica_assinatura', {
      politica_assinatura_id: politica,
      conselho_classe_id: conselho ? n(conselho['id']) : null,
      destino: p.destino,
      vigencia_inicio: datas?.hoje,
      ...valores,
    });
    return { id };
  }

  private async gravarPedido(
    tx: TxOperacao,
    p: Parameters<GravadorAssinatura['gravarPedido']>[0],
  ): Promise<{ id: number }> {
    const est = await this.estDaGravacao(tx, p.hospital);
    const u = await this.usuarioDoLogin(tx, p.usuario);
    const id = await tx
      .incluir('pedido_assinatura', {
        estabelecimento_id: est,
        usuario_id: u.id,
        finalidade: p.finalidade,
        midia: p.midia,
        provedor_assinatura_nuvem_id: await this.idProvedor(tx, est, p.provedor),
        certificado_usuario_id: p.certificado,
        hash_estado: p.stateHash,
        verificador_pkce_cifrado: p.pkceCifrado,
        hashes: JSON.stringify([...p.hashes]),
        documentos: JSON.stringify([...p.documentos]),
        expira_em: p.expiraEm,
      })
      .catch((e: unknown) => {
        if (restricaoUnicaViolada(e)) throw new ErroAssinatura('pedido-repetido', 'Pedido de assinatura repetido.');
        throw e;
      });
    return { id };
  }

  /** Uso único: só o pedido aberto do estabelecimento e da conta; o vencido também é gasto (e volta marcado). */
  private async consumirPedido(
    tx: TxOperacao,
    stateHash: string,
    dono: { hospital: string; usuario: string },
    agora: Date,
  ): Promise<(PedidoAssinaturaAberto & { vencido: boolean }) | null> {
    const est = await this.estDaGravacao(tx, dono.hospital);
    const [r] = await tx.consultarParaAtualizar(
      `SELECT pa.id, pa.versao, pa.finalidade, pa.midia, pa.certificado_usuario_id, pa.hash_estado,
              pa.verificador_pkce_cifrado, pa.hashes, pa.documentos, pa.expira_em, pr.codigo AS provedor
         FROM pedido_assinatura pa
         JOIN usuario u ON u.id = pa.usuario_id
         LEFT JOIN provedor_assinatura_nuvem pr ON pr.id = pa.provedor_assinatura_nuvem_id
        WHERE pa.hash_estado = ? AND pa.estabelecimento_id = ? AND u.login = ? AND pa.consumido_em IS NULL`,
      [stateHash, est, dono.usuario],
    );
    if (!r) return null;
    await tx.alterar('pedido_assinatura', n(r['id']), n(r['versao']), { consumido_em: agora });
    const expira = new Date(r['expira_em'] as string | Date);
    return {
      id: n(r['id']),
      hospital: dono.hospital,
      usuario: dono.usuario,
      finalidade: texto(r['finalidade']) as PedidoAssinaturaAberto['finalidade'],
      midia: texto(r['midia']) as MidiaCertificado,
      provedor: textoOuNulo(r['provedor']),
      certificado: nn(r['certificado_usuario_id']),
      stateHash: texto(r['hash_estado']),
      pkceCifrado: textoOuNulo(r['verificador_pkce_cifrado']),
      hashes: textos(r['hashes']),
      documentos: textos(r['documentos']).map(Number),
      expiraEm: expira.toISOString(),
      vencido: expira.getTime() <= agora.getTime(),
    };
  }

  private async documentoDoEstabelecimento(tx: TxOperacao, est: number, documento: number | null): Promise<void> {
    if (documento === null) return;
    const d = await tx.uma('SELECT id FROM documento_prontuario WHERE id = ? AND estabelecimento_id = ?', [
      documento,
      est,
    ]);
    if (!d) throw new ErroAssinatura('nao-encontrado', 'O documento não existe neste estabelecimento.');
  }

  private async gravarAssinatura(
    tx: TxOperacao,
    a: Parameters<GravadorAssinatura['gravarAssinatura']>[0],
  ): Promise<{ id: number }> {
    const est = await this.estDaGravacao(tx, a.hospital);
    const u = await this.usuarioDoLogin(tx, a.usuario);
    await this.documentoDoEstabelecimento(tx, est, a.documento);
    const id = await tx.incluir('assinatura_icp', {
      estabelecimento_id: est,
      origem_assinatura: a.origem,
      documento_prontuario_id: a.documento,
      usuario_id: u.id,
      certificado_usuario_id: a.certificado,
      provedor_assinatura_nuvem_id: await this.idProvedor(tx, est, a.provedor),
      midia: a.midia,
      formato: a.formato,
      politica_icp: a.politicaIcp,
      hash_assinado: a.hash,
      situacao: a.estado,
      tentativas: a.tentativas,
      falha: a.falha?.slice(0, 60) ?? null,
      proxima_tentativa_em: a.proximaEm,
      assinatura_cms: a.assinatura ? Buffer.from(a.assinatura, 'base64') : null,
      carimbo_tempo: a.carimboToken ? Buffer.from(a.carimboToken, 'base64') : null,
      carimbo_tempo_em: a.carimboEm,
      carimbo_tempo_serie: a.carimboSerie?.slice(0, 64) ?? null,
    });
    return { id };
  }

  private async gravarValidacao(
    tx: TxOperacao,
    est: number,
    v: Parameters<GravadorAssinatura['gravarValidacao']>[0],
  ): Promise<{ id: number }> {
    const a = await tx.uma('SELECT id FROM assinatura_icp WHERE id = ? AND estabelecimento_id = ?', [
      v.assinatura,
      est,
    ]);
    if (!a) throw new ErroAssinatura('nao-encontrado', 'A assinatura não existe neste estabelecimento.');
    const id = await tx.incluir('validacao_assinatura', {
      assinatura_icp_id: v.assinatura,
      momento: v.momento,
      resultado: v.resultado,
      cadeia_ok: v.cadeia,
      vigencia_ok: v.vigencia,
      revogacao_ok: v.revogacao,
      cpf_ok: v.cpf,
      assinatura_ok: v.assinaturaConfere,
      carimbo_ok: v.carimbo,
      motivos: JSON.stringify([...v.motivos]),
      usuario_id: await this.idDoLogin(tx, v.usuario),
      validada_em: v.em,
    });
    return { id };
  }

  /**
   * O PDF no armazenamento vira uma linha de `arquivo` (imutável). A versão do objeto vai na coluna pedida
   * (arquivo.versao_objeto) quando o banco já a tem; sem ela, só a versão que a emissão do documento registrou para a
   * mesma chave (emissao_documento) é aceita, porque a leitura sai de lá. Outra versão: 503 explícito, sem gravar.
   */
  private async gravarArquivoPdf(
    tx: TxOperacao,
    est: number,
    x: { entidade: string; entidadeId: number | null; finalidade: string; nome: string; chave: string; versao: string; hash: string },
  ): Promise<number> {
    const col = await this.opcionais(tx);
    if (!col.versaoArquivo && x.versao) {
      const emitida = await tx.uma('SELECT id FROM emissao_documento WHERE chave_objeto = ? AND versao_objeto = ?', [
        x.chave,
        x.versao,
      ]);
      if (!emitida) throw modeloPendente('Versão do PDF no armazenamento (arquivo.versao_objeto)');
    }
    return tx.incluir('arquivo', {
      estabelecimento_id: est,
      entidade: x.entidade,
      entidade_id: x.entidadeId,
      finalidade: x.finalidade,
      nome_original: x.nome.slice(0, 255),
      tipo_mime: 'application/pdf',
      // O tamanho não chega à porta (o armazenamento guarda o objeto); o resumo SHA-256 identifica o conteúdo.
      tamanho_bytes: 0,
      hash_sha256: x.hash,
      chave_armazenamento: x.chave,
      imutavel: true,
      origem: 'sistema',
      ...(col.versaoArquivo ? { versao_objeto: x.versao.slice(0, 100) } : {}),
    });
  }

  private async gravarPrevia(
    tx: TxOperacao,
    p: Parameters<GravadorAssinatura['gravarPrevia']>[0],
  ): Promise<{ id: number }> {
    const est = await this.estDaGravacao(tx, p.hospital);
    const u = await this.usuarioDoLogin(tx, p.usuario);
    await this.documentoDoEstabelecimento(tx, est, p.documento);
    const arquivo = await this.gravarArquivoPdf(tx, est, {
      entidade: 'documento_prontuario',
      entidadeId: p.documento,
      finalidade: 'previa_assinatura',
      nome: `previa-${p.codigo}.pdf`,
      chave: p.chaveS3,
      versao: p.versaoS3,
      hash: p.hashPdf,
    });
    const id = await tx.incluir('previa_assinatura', {
      estabelecimento_id: est,
      documento_prontuario_id: p.documento,
      usuario_id: u.id,
      certificado_usuario_id: p.certificado,
      politica_icp: p.politicaIcp,
      arquivo_id: arquivo,
      hash_pdf: p.hashPdf,
      codigo_verificacao: p.codigo,
      assinar_em: new Date(p.assinarEm),
      profissional_exibido: p.profissional?.slice(0, 150) ?? null,
      registro_exibido: p.registro?.slice(0, 60) ?? null,
    });
    return { id };
  }

  private async assinaturaTravada(tx: TxOperacao, est: number, id: number, extra = ''): Promise<Linha | null> {
    const [r] = await tx.consultarParaAtualizar(
      `SELECT id, versao, situacao, tentativas, documento_prontuario_id, previa_assinatura_id, arquivo_assinado_id,
              assinatura_documento_id
         FROM assinatura_icp WHERE id = ? AND estabelecimento_id = ? ${extra}`,
      [id, est],
    );
    return r ?? null;
  }

  private async gravarAssinaturaPdf(tx: TxOperacao, est: number, a: { assinatura: number; previa: number }): Promise<void> {
    const r = await this.assinaturaTravada(tx, est, a.assinatura);
    if (!r) throw new ErroAssinatura('nao-encontrado', 'A assinatura não existe neste estabelecimento.');
    const pv = await tx.uma('SELECT id FROM previa_assinatura WHERE id = ? AND estabelecimento_id = ?', [a.previa, est]);
    if (!pv) throw new ErroAssinatura('nao-encontrado', 'A prévia não existe neste estabelecimento.');
    await tx.alterar('assinatura_icp', a.assinatura, n(r['versao']), { previa_assinatura_id: a.previa });
  }

  /** Uma vez só: o PDF com a assinatura embutida; também no envelope do documento, quando já concluído. */
  private async registrarPdfAssinado(
    tx: TxOperacao,
    est: number,
    a: { assinatura: number; chaveS3: string; versaoS3: string; hashPdf: string },
  ): Promise<boolean> {
    const r = await this.assinaturaTravada(tx, est, a.assinatura);
    if (!r || r['arquivo_assinado_id'] !== null) return false;
    const arquivo = await this.gravarArquivoPdf(tx, est, {
      entidade: 'assinatura_icp',
      entidadeId: a.assinatura,
      finalidade: 'documento_assinado',
      nome: `assinado-${a.assinatura}.pdf`,
      chave: a.chaveS3,
      versao: a.versaoS3,
      hash: a.hashPdf,
    });
    await tx.alterar('assinatura_icp', a.assinatura, n(r['versao']), { arquivo_assinado_id: arquivo });
    if (r['assinatura_documento_id'] !== null) {
      const [env] = await tx.consultarParaAtualizar(
        `SELECT da.id, da.versao FROM documento_assinado da JOIN assinatura_documento ad ON ad.documento_assinado_id = da.id
          WHERE ad.id = ? AND da.arquivo_assinado_id IS NULL`,
        [n(r['assinatura_documento_id'])],
      );
      if (env) await tx.alterar('documento_assinado', n(env['id']), n(env['versao']), { arquivo_assinado_id: arquivo });
    }
    return true;
  }

  /** Controle otimista: só muda a tentativa no estado e na contagem lidos (duas instâncias não repetem). */
  private async atualizarAssinatura(tx: TxOperacao, a: AtualizacaoAssinatura): Promise<boolean> {
    const est = await this.estDaGravacao(tx, a.hospital);
    const [r] = await tx.consultarParaAtualizar(
      'SELECT id, versao FROM assinatura_icp WHERE id = ? AND estabelecimento_id = ? AND situacao = ? AND tentativas = ?',
      [a.id, est, a.estadoLido, a.tentativasLidas],
    );
    if (!r) return false;
    await tx.alterar('assinatura_icp', a.id, n(r['versao']), {
      situacao: a.estado,
      tentativas: a.tentativas,
      falha: a.falha?.slice(0, 60) ?? null,
      proxima_tentativa_em: a.proximaEm,
      ...(a.carimboToken !== null ? { carimbo_tempo: Buffer.from(a.carimboToken, 'base64') } : {}),
      ...(a.carimboEm !== null ? { carimbo_tempo_em: a.carimboEm } : {}),
      ...(a.carimboSerie !== null ? { carimbo_tempo_serie: a.carimboSerie.slice(0, 64) } : {}),
    });
    return true;
  }

  private async travarDocumentoParaAssinar(
    tx: TxOperacao,
    hospital: string,
    documento: number,
    exceto: number | null,
  ): Promise<'assinada' | 'pendente' | null> {
    const est = await this.estDaGravacao(tx, hospital);
    const [d] = await tx.consultarParaAtualizar(
      'SELECT id FROM documento_prontuario WHERE id = ? AND estabelecimento_id = ?',
      [documento, est],
    );
    if (!d) throw new ErroAssinatura('nao-encontrado', 'O documento não existe neste estabelecimento.');
    const ls = await tx.consultar(
      `SELECT situacao FROM assinatura_icp
        WHERE documento_prontuario_id = ? AND origem_assinatura = 'documento' AND id <> ?
          AND situacao IN ('assinada', 'pendente')`,
      [documento, exceto ?? 0],
    );
    return ls.some((x) => x['situacao'] === 'assinada') ? 'assinada' : ls.length ? 'pendente' : null;
  }

  /**
   * A conclusão ICP na cadeia do documento: o envelope do documento assinado (documento_assinado, com o código e o PDF
   * da prévia) e a assinatura nele (assinatura_documento), ligados à tentativa e ao documento do prontuário, e o evento
   * "assinatura" na cadeia (documento_prontuario_evento). Documento que já tem envelope: só o evento.
   */
  private async gravarEventoAssinadoIcp(
    tx: TxOperacao,
    ctx: { hospital: string; usuario: string },
    documento: number,
    comoSuporte: boolean,
  ): Promise<void> {
    const est = await this.estDaGravacao(tx, ctx.hospital);
    const u = await this.usuarioDoLogin(tx, ctx.usuario);
    const [d] = await tx.consultarParaAtualizar(
      `SELECT dp.id, dp.versao, dp.situacao_documento_prontuario_id, dp.documento_assinado_id, dp.paciente_id,
              dp.atendimento_id, dp.profissional_id, dp.titulo, t.codigo AS tipo
         FROM documento_prontuario dp JOIN tipo_documento_clinico t ON t.id = dp.tipo_documento_clinico_id
        WHERE dp.id = ? AND dp.estabelecimento_id = ?`,
      [documento, est],
    );
    if (!d) throw new ErroAssinatura('nao-encontrado', 'O documento não existe neste estabelecimento.');
    const [a] = await tx.consultarParaAtualizar(
      `SELECT id, versao, certificado_usuario_id, formato, politica_icp, hash_assinado, carimbo_tempo_em,
              previa_assinatura_id, arquivo_assinado_id, assinatura_documento_id
         FROM assinatura_icp
        WHERE documento_prontuario_id = ? AND estabelecimento_id = ? AND origem_assinatura = 'documento'
          AND situacao = 'assinada'
        ORDER BY id DESC LIMIT 1`,
      [documento, est],
    );
    if (!a) throw recusa('assinatura-ausente', 'O documento não tem assinatura ICP concluída.');
    const agora = new Date();
    const pv = a['previa_assinatura_id']
      ? await tx.uma(
          'SELECT codigo_verificacao, arquivo_id, profissional_exibido, criado_em FROM previa_assinatura WHERE id = ?',
          [n(a['previa_assinatura_id'])],
        )
      : null;
    if (d['documento_assinado_id'] === null && pv && a['assinatura_documento_id'] === null) {
      const cert = await tx.uma(
        'SELECT nome_titular, cpf_titular, numero_serie, emissor, valido_ate FROM certificado_usuario WHERE id = ?',
        [n(a['certificado_usuario_id'])],
      );
      const envelope = await tx.incluir('documento_assinado', {
        estabelecimento_id: est,
        codigo_verificacao: texto(pv['codigo_verificacao']),
        tipo_documento: texto(d['tipo']).slice(0, 60),
        entidade: 'documento_prontuario',
        entidade_id: documento,
        paciente_id: nn(d['paciente_id']),
        atendimento_id: nn(d['atendimento_id']),
        titulo: texto(d['titulo']).slice(0, 200) || texto(d['tipo']),
        hash_conteudo: texto(a['hash_assinado']),
        arquivo_id: n(pv['arquivo_id']),
        arquivo_assinado_id: nn(a['arquivo_assinado_id']),
        destino: 'interno',
        nivel_exigido: 'icp-brasil',
        formato: texto(a['formato']),
        politica_icp: texto(a['politica_icp']),
        assinaturas_exigidas: 1,
        gerado_em: pv['criado_em'],
        concluido_em: agora,
        situacao: 'assinado',
        origem: 'sistema',
      });
      const cpf = textoOuNulo(cert?.['cpf_titular'] ?? null);
      const assinatura = await tx.incluir('assinatura_documento', {
        documento_assinado_id: envelope,
        sequencia: 1,
        signatario_usuario_id: u.id,
        profissional_id: comoSuporte ? null : nn(d['profissional_id']),
        papel: 'autor',
        nome_signatario: (textoOuNulo(pv['profissional_exibido']) ?? texto(cert?.['nome_titular']) ?? u.nome).slice(0, 150) || u.nome.slice(0, 150),
        cpf_signatario: cpf && /^\d{11}$/.test(cpf) ? cpf : null,
        certificado_usuario_id: n(a['certificado_usuario_id']),
        nivel: 'icp-brasil',
        formato: texto(a['formato']),
        politica_icp: texto(a['politica_icp']),
        numero_serie_certificado: textoOuNulo(cert?.['numero_serie'] ?? null),
        emissor_certificado: textoOuNulo(cert?.['emissor'] ?? null)?.slice(0, 500) ?? null,
        certificado_valido_ate: cert?.['valido_ate'] ?? null,
        hash_assinado: texto(a['hash_assinado']),
        assinado_em: agora,
        carimbo_tempo_em: a['carimbo_tempo_em'] ?? null,
        situacao: 'valida',
        verificada_em: agora,
        origem: 'sistema',
      });
      await tx.alterar('assinatura_icp', n(a['id']), n(a['versao']), { assinatura_documento_id: assinatura });
      await tx.alterar('documento_prontuario', documento, n(d['versao']), { documento_assinado_id: envelope });
    }
    await tx.incluir('documento_prontuario_evento', {
      documento_prontuario_id: documento,
      operacao: 'alteracao',
      acao: 'assinatura',
      situacao_documento_prontuario_id: n(d['situacao_documento_prontuario_id']),
      profissional_id: comoSuporte ? null : nn(d['profissional_id']),
      evento_em: agora,
      dados: JSON.stringify({ nivel: 'icp-brasil', assinatura: n(a['id']), comoSuporte }),
      ocorrido_em: agora,
      usuario_id: u.id,
    });
  }

  private async gravarAviso(tx: TxOperacao, a: Parameters<GravadorAssinatura['gravarAviso']>[0]): Promise<{ id: number }> {
    const est = await this.estDaGravacao(tx, a.hospital);
    const id = await tx.incluir('aviso_assinatura', {
      estabelecimento_id: est,
      assinatura_icp_id: a.assinatura,
      destinatario: a.destinatario,
      usuario_id: await this.idDoLogin(tx, a.usuario),
      situacao_assinatura: a.estado,
      falha: a.falha?.slice(0, 60) ?? null,
    });
    return { id };
  }

  private async marcarAvisosLidos(
    tx: TxOperacao,
    hospital: string,
    avisos: readonly number[],
    por: { login: string; diretorTecnico: boolean },
    agora: Date,
  ): Promise<number> {
    if (avisos.length === 0) return 0;
    const est = await this.estDaGravacao(tx, hospital);
    const ls = await tx.consultarParaAtualizar(
      `SELECT av.id, av.versao FROM aviso_assinatura av LEFT JOIN usuario u ON u.id = av.usuario_id
        WHERE av.estabelecimento_id = ? AND av.id IN (${lista(avisos.length)}) AND av.lido_em IS NULL
          AND ((av.destinatario = 'autor' AND u.login = ?) OR (? AND av.destinatario = 'diretor-tecnico'))`,
      [est, ...avisos, por.login, por.diretorTecnico],
    );
    const leitor = await this.idDoLogin(tx, por.login);
    for (const r of ls) await tx.alterar('aviso_assinatura', n(r['id']), n(r['versao']), { lido_em: agora, lido_por: leitor });
    return ls.length;
  }

  private async gravarSolicitacaoSncr(
    tx: TxOperacao,
    s: Parameters<GravadorAssinatura['gravarSolicitacaoSncr']>[0],
  ): Promise<{ id: number }> {
    const est = await this.estDaGravacao(tx, s.hospital);
    const u = await this.usuarioDoLogin(tx, s.usuario);
    await this.documentoDoEstabelecimento(tx, est, s.documento);
    const id = await tx.incluir('pedido_numeracao_receita', {
      estabelecimento_id: est,
      documento_prontuario_id: s.documento,
      entidade_origem_id: s.origemId,
      tipo_receita: s.tipo,
      medicamentos: s.medicamentos,
      situacao: 'pendente',
      tentativas: 0,
      usuario_id: u.id,
    });
    return { id };
  }

  private async atualizarSolicitacaoSncr(
    tx: TxOperacao,
    s: Parameters<GravadorAssinatura['atualizarSolicitacaoSncr']>[0],
  ): Promise<boolean> {
    const est = await this.estDaGravacao(tx, s.hospital);
    const [r] = await tx.consultarParaAtualizar(
      "SELECT id, versao FROM pedido_numeracao_receita WHERE id = ? AND estabelecimento_id = ? AND situacao = 'pendente'",
      [s.id, est],
    );
    if (!r) return false;
    await tx.alterar('pedido_numeracao_receita', s.id, n(r['versao']), {
      situacao: s.situacao,
      tentativas: s.tentativas,
      numero: s.numero?.slice(0, 40) ?? null,
      retorno: s.retorno?.slice(0, 60) ?? null,
    });
    return true;
  }

  /**
   * O número da receita fica no próprio pedido numerado (pedido_numeracao_receita.numero). O documento aceita um número
   * só: outro pedido do mesmo documento já numerado com número diferente recusa (false).
   */
  private async gravarNumeroSncr(tx: TxOperacao, hospital: string, documento: number, numero: string): Promise<boolean> {
    const est = await this.estDaGravacao(tx, hospital);
    const outro = await tx.uma(
      `SELECT id FROM pedido_numeracao_receita
        WHERE estabelecimento_id = ? AND documento_prontuario_id = ? AND situacao = 'numerada' AND numero <> ? LIMIT 1`,
      [est, documento, numero],
    );
    return !outro;
  }

  // ---- identidade e catálogos ----

  async identidade(c: ContextoAssinatura, login: string): Promise<IdentidadeParaCertificado | null> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const u = await l.uma(
        `SELECT u.cpf, pf.cpf AS cpf_profissional, p.id AS profissional
           FROM usuario u
           LEFT JOIN usuario_vinculo_profissional v ON v.usuario_id = u.id AND v.estabelecimento_id = ?
                 AND v.profissional_id IS NOT NULL AND v.excluido_em IS NULL
                 AND v.vigencia_inicio <= CURRENT_DATE AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
           LEFT JOIN profissional p ON p.id = v.profissional_id AND p.excluido_em IS NULL
           LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id AND pf.excluido_em IS NULL
          WHERE u.login = ? AND u.excluido_em IS NULL
          ORDER BY v.vigencia_inicio DESC LIMIT 1`,
        [est, login],
      );
      if (!u) return null;
      const profissional = nn(u['profissional']);
      const registros = profissional
        ? await l.consultar(
            `SELECT cc.sigla, uf.sigla AS uf, i.numero_inscricao, o.codigo_cbo
               FROM inscricao_conselho i
               JOIN conselho_classe cc ON cc.id = i.conselho_classe_id
               LEFT JOIN unidade_federativa uf ON uf.id = i.unidade_federativa_id
               LEFT JOIN ocupacao_cbo o ON o.id = i.ocupacao_cbo_id
              WHERE i.profissional_id = ? AND i.excluido_em IS NULL AND i.situacao IN ('ativa', 'provisoria')
              ORDER BY i.principal DESC, i.sequencia`,
            [profissional],
          )
        : [];
      return {
        cpf: textoOuNulo(u['cpf']),
        cpfProfissional: textoOuNulo(u['cpf_profissional']),
        registros: registros.map((r) => ({
          cbo: textoOuNulo(r['codigo_cbo']),
          sigla: textoOuNulo(r['sigla']),
          uf: textoOuNulo(r['uf']),
          numero: textoOuNulo(r['numero_inscricao']),
        })),
      };
    });
  }

  /** Catálogo da rede inteira (sem estabelecimento). */
  async formasIcp(c: ContextoAssinatura): Promise<FormaAssinaturaIcp[]> {
    const ls = await this.ler(c, (l) =>
      l.consultar('SELECT id, descricao, politica FROM formato_assinatura_icp WHERE ativo ORDER BY id', []),
    );
    return ls.map((r) => ({
      id: n(r['id']),
      descricao: texto(r['descricao']),
      politica: POLITICA_DO_FORMATO[texto(r['politica'])] ?? null,
    }));
  }

  /** Catálogo da rede inteira (sem estabelecimento). */
  async tiposCertificado(c: ContextoAssinatura): Promise<TipoCertificado[]> {
    const ls = await this.ler(c, (l) =>
      l.consultar('SELECT id, descricao, ativo FROM tipo_certificado ORDER BY id', []),
    );
    return ls.map((r) => ({ id: n(r['id']), nome: texto(r['descricao']), ativo: verdadeiro(r['ativo']) }));
  }

  /** Catálogo da rede inteira (sem estabelecimento). */
  async conselhos(c: ContextoAssinatura): Promise<string[]> {
    const ls = await this.ler(c, (l) =>
      l.consultar('SELECT sigla FROM conselho_classe WHERE ativo ORDER BY sigla', []),
    );
    return ls.map((r) => texto(r['sigla']));
  }

  /** Catálogo da rede inteira (sem estabelecimento). */
  async oidsDeConselho(c: ContextoAssinatura): Promise<{ oid: string; conselho: string }[]> {
    const ls = await this.ler(c, (l) =>
      l.consultar(
        `SELECT o.oid, cc.sigla FROM oid_icp o JOIN conselho_classe cc ON cc.id = o.conselho_classe_id
          WHERE o.ativo AND o.tipo_oid = 'registro_conselho' ORDER BY o.oid`,
        [],
      ),
    );
    return ls.map((r) => ({ oid: texto(r['oid']), conselho: texto(r['sigla']) }));
  }

  // ---- certificados ----

  private certificadoDaLinha(c: ContextoAssinatura, r: Linha, comDer: boolean): CertificadoVinculado {
    const der = r['certificado_der'];
    const bytes = der instanceof Uint8Array ? der : null;
    let tipoIcp: string | null = null;
    if (bytes) {
      try {
        tipoIcp = tipoPelaPolitica(lerCertificado(bytes).politicas);
      } catch {
        tipoIcp = null;
      }
    }
    const cpf = textoOuNulo(r['cpf_titular']);
    return {
      id: n(r['id']),
      hospital: c.hospital,
      usuario: texto(r['login']),
      midia: texto(r['midia']) as MidiaCertificado,
      provedor: textoOuNulo(r['provedor']),
      idTipoCertificado: nn(r['tipo_certificado_id']),
      serie: texto(r['numero_serie']),
      emissorHash: texto(r['emissor']),
      tipoIcp,
      validoDe: iso(r['valido_de']) ?? '',
      validoAte: iso(r['valido_ate']) ?? '',
      cpfMascarado: cpf ? mascararCpf(cpf) : '',
      ativo: texto(r['situacao']) === 'ativo' && (r['excluido_em'] === null || r['excluido_em'] === undefined),
      criadoEm: iso(r['criado_em']) ?? '',
      certificadoDer: comDer && bytes ? Buffer.from(bytes).toString('base64') : null,
    };
  }

  /** Os certificados vigentes do usuário (os desvinculados ficam de fora). */
  async certificados(c: ContextoAssinatura, login: string): Promise<CertificadoVinculado[]> {
    return this.ler(c, async (l) => {
      const col = await this.opcionais(l);
      const ls = await l.consultar(
        `${SQL_CERTIFICADO(col.certificadoDer)} WHERE u.login = ? AND cu.excluido_em IS NULL ORDER BY cu.id DESC`,
        [login],
      );
      return ls.map((r) => this.certificadoDaLinha(c, r, false));
    });
  }

  /** Por id, também o desvinculado (a conferência de uma assinatura antiga precisa da parte pública dele). */
  async certificado(c: ContextoAssinatura, id: number): Promise<CertificadoVinculado | null> {
    return this.ler(c, async (l) => {
      const col = await this.opcionais(l);
      const r = await l.uma(`${SQL_CERTIFICADO(col.certificadoDer)} WHERE cu.id = ?`, [id]);
      return r ? this.certificadoDaLinha(c, r, true) : null;
    });
  }

  // ---- política e provedores ----

  /** As regras vigentes (uma por tipo, destino e conselho), com a forma ICP do catálogo pela família e política. */
  async politicas(c: ContextoAssinatura): Promise<PoliticaVigente[]> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      if (!est) return [];
      const ls = await l.consultar(
        `SELECT r.id, t.codigo AS tipo, cc.sigla AS conselho, r.destino, r.nivel, r.padrao_assinatura, r.formato,
                r.ativo, r.criado_em, u.login,
                (SELECT f.id FROM formato_assinatura_icp f
                  WHERE f.ativo AND f.familia = COALESCE(r.formato, 'pades') AND f.politica = r.padrao_assinatura
                  ORDER BY f.id LIMIT 1) AS forma
           FROM regra_politica_assinatura r
           JOIN politica_assinatura p ON p.id = r.politica_assinatura_id
           JOIN tipo_documento_clinico t ON t.id = p.tipo_documento_clinico_id
           LEFT JOIN conselho_classe cc ON cc.id = r.conselho_classe_id
           LEFT JOIN usuario u ON u.id = COALESCE(r.alterado_por, r.criado_por)
          WHERE p.estabelecimento_id = ? AND p.ativo AND r.vigente = 1
          ORDER BY t.codigo, r.id`,
        [est],
      );
      return ls.map((r) => ({
        id: n(r['id']),
        tipoDocumento: texto(r['tipo']),
        conselho: textoOuNulo(r['conselho']),
        destino: texto(r['destino']) as PoliticaVigente['destino'],
        nivel: texto(r['nivel']) as NivelAssinatura,
        politicaIcp: POLITICA_DO_FORMATO[texto(r['padrao_assinatura'])] ?? null,
        idFormaIcp: nn(r['forma']),
        formato: (textoOuNulo(r['formato']) ?? 'pades') as FormatoAssinatura,
        ativa: verdadeiro(r['ativo']),
        usuario: texto(r['login']),
        criadoEm: iso(r['criado_em']) ?? '',
      }));
    });
  }

  private provedorDaLinha(r: Linha): ProvedorNuvem {
    let autoridades: string[] = [];
    const bruto = r['autoridades'];
    if (bruto !== undefined && bruto !== null) {
      try {
        const v: unknown = typeof bruto === 'string' ? JSON.parse(bruto) : bruto;
        if (Array.isArray(v)) autoridades = v.map(String);
      } catch {
        autoridades = [];
      }
    }
    return {
      id: n(r['id']),
      codigo: texto(r['codigo']),
      nome: texto(r['nome']),
      uriBase: texto(r['url_servico']),
      clientId: texto(r['cliente_identificador']),
      autoridades,
      ativo: verdadeiro(r['ativo']),
      segredoRef: texto(r['referencia_cofre']),
      versao: n(r['versao']),
      alteradoPor: texto(r['alterado_por']),
      alteradoEm: iso(r['alterado_em']) ?? '',
    };
  }

  async provedores(c: ContextoAssinatura): Promise<ProvedorNuvem[]> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const col = await this.opcionais(l);
      const ls = await l.consultar(`${SQL_PROVEDOR(col)} ${ORDEM_PROVEDOR}`, [est]);
      // Mesmo código no estabelecimento e na rede inteira: vale o do estabelecimento.
      const vistos = new Set<string>();
      return ls
        .filter((r) => (vistos.has(texto(r['codigo'])) ? false : (vistos.add(texto(r['codigo'])), true)))
        .map((r) => this.provedorDaLinha(r));
    });
  }

  async provedor(c: ContextoAssinatura, codigo: string): Promise<ProvedorNuvem | null> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const col = await this.opcionais(l);
      const r = await l.uma(`${SQL_PROVEDOR(col)} AND p.codigo = ? ${ORDEM_PROVEDOR} LIMIT 1`, [est, codigo]);
      return r ? this.provedorDaLinha(r) : null;
    });
  }

  /** As validações mais recentes de cada tentativa (para juntar à leitura). */
  private async ultimasValidacoes(l: Leitor, ids: readonly number[]): Promise<Map<number, Linha>> {
    if (ids.length === 0) return new Map();
    const ls = await l.consultar(
      `SELECT v.* FROM validacao_assinatura v
        WHERE v.id IN (SELECT MAX(id) FROM validacao_assinatura WHERE assinatura_icp_id IN (${lista(ids.length)})
                        GROUP BY assinatura_icp_id)`,
      [...ids],
    );
    return new Map(ls.map((v) => [n(v['assinatura_icp_id']), v]));
  }

  async assinaturas(c: ContextoAssinatura, login: string, origem: 'teste' | 'documento'): Promise<AssinaturaRealizada[]> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      if (!est) return [];
      const ls = await l.consultar(
        `${SQL_ASSINATURA} WHERE a.estabelecimento_id = ? AND u.login = ? AND a.origem_assinatura = ?
          ORDER BY a.id DESC LIMIT 20`,
        [est, login, origem],
      );
      const vs = await this.ultimasValidacoes(l, ls.map((r) => n(r['id'])));
      return ls.map((a) => {
        const v = vs.get(n(a['id']));
        return {
          id: n(a['id']),
          origem: texto(a['origem_assinatura']) as AssinaturaRealizada['origem'],
          documento: nn(a['documento_prontuario_id']),
          hash: texto(a['hash_assinado']),
          politicaIcp: texto(a['politica_icp']) as PoliticaIcp,
          midia: texto(a['midia']) as MidiaCertificado,
          provedor: textoOuNulo(a['provedor']),
          certificado: n(a['certificado_usuario_id']),
          estado: texto(a['situacao']) as EstadoAssinatura,
          tentativas: n(a['tentativas']),
          falha: textoOuNulo(a['falha']),
          carimboEm: iso(a['carimbo_tempo_em']),
          criadoEm: iso(a['criado_em']) ?? '',
          validacao: v
            ? {
                resultado: texto(v['resultado']) as ResultadoValidacao,
                em: iso(v['validada_em']) ?? '',
                cadeia: simNao(v['cadeia_ok']),
                vigencia: simNao(v['vigencia_ok']),
                revogacao: simNao(v['revogacao_ok']),
                cpf: simNao(v['cpf_ok']),
                assinaturaConfere: simNao(v['assinatura_ok']),
                carimbo: simNao(v['carimbo_ok']),
                motivos: textos(v['motivos']),
              }
            : null,
        };
      });
    });
  }

  // ---- documentos do prontuário ----

  async documentoEmitido(c: ContextoAssinatura, id: number): Promise<DocumentoEmitidoIcp | null> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      if (!est) return null;
      const r = await l.uma(SQL_DOCUMENTO, [id, est]);
      if (!r) return null;
      const conteudo = r['conteudo'];
      return {
        id: n(r['id']),
        tipo: texto(r['tipo']),
        origemTabela: texto(r['entidade_origem']),
        origemId: n(r['entidade_origem_id']),
        paciente: n(r['paciente_id']),
        atendimento: nn(r['atendimento_id']),
        usuario: texto(r['autor']),
        // O resumo do documento assinado; antes da assinatura, o do conteúdo estruturado.
        hash:
          textoOuNulo(r['hash_conteudo']) ??
          sha256Hex(typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo ?? null)),
        nivel: textoOuNulo(r['nivel_exigido']) ?? 'eletronica-simples',
        criadoEm: iso(r['lancado_em']),
        assinadoEm: iso(r['concluido_em']),
        // Fora das situações assináveis (rascunho, corrigido, arquivado, suspenso, cancelado): recusado.
        suspenso: bloqueadoParaAssinatura(texto(r['categoria'])),
        comoSuporte: false,
      };
    });
  }

  async filaIcp(
    c: ContextoAssinatura,
    login: string,
    teto: number,
    tiposIcp: readonly string[],
  ): Promise<{ itens: DocumentoNaFilaIcp[]; limitado: boolean }> {
    const tipos = tiposIcp.filter((t) => (TIPOS_DOCUMENTO_ICP as readonly string[]).includes(t));
    if (teto < 1) return { itens: [], limitado: false };
    // Sem assinatura: só os tipos que a política manda assinar com ICP; com tentativa pendente ou em falha: sempre.
    const semAssinatura = tipos.length ? `x.tipo IN (${lista(tipos.length)})` : 'FALSE';
    const ls = await this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      if (!est) return [];
      return l.consultar(
        `SELECT x.id, x.tipo, x.paciente_id, x.lancado_em, a.id AS assinatura, a.situacao, a.tentativas, a.falha,
                a.proxima_tentativa_em
           FROM (
             SELECT dp.id, t.codigo AS tipo, dp.paciente_id, dp.lancado_em,
                    (SELECT ai.id FROM assinatura_icp ai
                      WHERE ai.documento_prontuario_id = dp.id AND ai.origem_assinatura = 'documento'
                      ORDER BY (ai.situacao = 'assinada') DESC, ai.id DESC LIMIT 1) AS ultima
               FROM documento_prontuario dp
               JOIN tipo_documento_clinico t ON t.id = dp.tipo_documento_clinico_id
               JOIN situacao_documento_prontuario s ON s.id = dp.situacao_documento_prontuario_id
               JOIN usuario_vinculo_profissional v ON v.profissional_id = dp.profissional_id
                    AND v.estabelecimento_id = dp.estabelecimento_id AND v.excluido_em IS NULL
                    AND v.vigencia_inicio <= CURRENT_DATE AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
               JOIN usuario u ON u.id = v.usuario_id AND u.excluido_em IS NULL
              WHERE dp.estabelecimento_id = ? AND dp.excluido_em IS NULL AND dp.documento_assinado_id IS NULL
                AND u.login = ? AND t.codigo IN (${lista(TIPOS_DOCUMENTO_ICP.length)})
                AND s.categoria IN (${lista(CATEGORIAS_ASSINAVEIS.length)})
           ) x
           LEFT JOIN assinatura_icp a ON a.id = x.ultima
          WHERE (a.id IS NULL AND ${semAssinatura}) OR a.situacao IN ('pendente', 'falha')
          ORDER BY FIELD(x.tipo, ${lista(TIPOS_POR_PRIORIDADE.length)}), x.id
          LIMIT ?`,
        [
          est,
          login,
          ...TIPOS_DOCUMENTO_ICP,
          ...CATEGORIAS_ASSINAVEIS,
          ...tipos,
          ...TIPOS_POR_PRIORIDADE,
          teto + 1,
        ],
      );
    });
    const itens = ls.slice(0, teto).map((r) => ({
      documento: n(r['id']),
      tipo: texto(r['tipo']),
      paciente: n(r['paciente_id']),
      criadoEm: iso(r['lancado_em']) ?? '',
      assinatura: nn(r['assinatura']),
      estado: (textoOuNulo(r['situacao']) as 'pendente' | 'falha' | null) ?? null,
      tentativas: n(r['tentativas']),
      falha: textoOuNulo(r['falha']),
      proximaEm: iso(r['proxima_tentativa_em']),
    }));
    return { itens, limitado: ls.length > teto };
  }

  /** A tentativa de cada documento: a assinada, se houver; senão, a mais recente. */
  async assinaturasDosDocumentos(
    c: ContextoAssinatura,
    documentos: readonly number[],
  ): Promise<Map<number, { id: number; estado: 'pendente' | 'assinada' | 'falha' }>> {
    const m = new Map<number, { id: number; estado: 'pendente' | 'assinada' | 'falha' }>();
    if (documentos.length === 0) return m;
    const ls = await this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      if (!est) return [];
      return l.consultar(
        `SELECT id, documento_prontuario_id, situacao FROM assinatura_icp
          WHERE estabelecimento_id = ? AND origem_assinatura = 'documento'
            AND documento_prontuario_id IN (${lista(documentos.length)})
          ORDER BY documento_prontuario_id, (situacao = 'assinada') DESC, id DESC`,
        [est, ...documentos],
      );
    });
    for (const r of ls) {
      const d = n(r['documento_prontuario_id']);
      if (!m.has(d)) m.set(d, { id: n(r['id']), estado: texto(r['situacao']) as EstadoAssinatura });
    }
    return m;
  }

  private previaDaLinha(c: ContextoAssinatura, r: Linha): PreviaDoDocumento {
    return {
      id: n(r['id']),
      hospital: c.hospital,
      documento: n(r['documento_prontuario_id']),
      usuario: texto(r['login']),
      certificado: n(r['certificado_usuario_id']),
      politicaIcp: texto(r['politica_icp']) as PoliticaIcp,
      hashPdf: texto(r['hash_pdf']),
      chaveS3: texto(r['chave_armazenamento']),
      versaoS3: texto(r['versao_objeto']),
      codigo: texto(r['codigo_verificacao']),
      assinarEm: iso(r['assinar_em']) ?? '',
      profissional: textoOuNulo(r['profissional_exibido']),
      registro: textoOuNulo(r['registro_exibido']),
      criadoEm: iso(r['criado_em']) ?? '',
    };
  }

  async previaMaisRecente(c: ContextoAssinatura, documento: number, login: string): Promise<PreviaDoDocumento | null> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      if (!est) return null;
      const col = await this.opcionais(l);
      const r = await l.uma(
        `${SQL_PREVIA(col)} WHERE pv.estabelecimento_id = ? AND pv.documento_prontuario_id = ? AND u.login = ?
          ORDER BY pv.id DESC LIMIT 1`,
        [est, documento, login],
      );
      return r ? this.previaDaLinha(c, r) : null;
    });
  }

  async previa(c: ContextoAssinatura, id: number): Promise<PreviaDoDocumento | null> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      if (!est) return null;
      const col = await this.opcionais(l);
      const r = await l.uma(`${SQL_PREVIA(col)} WHERE pv.estabelecimento_id = ? AND pv.id = ?`, [est, id]);
      return r ? this.previaDaLinha(c, r) : null;
    });
  }

  async assinaturaDocumento(c: ContextoAssinatura, id: number): Promise<AssinaturaDoDocumento | null> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      if (!est) return null;
      const col = await this.opcionais(l);
      const a = await l.uma(
        `SELECT a.id, a.documento_prontuario_id, a.hash_assinado, a.politica_icp, a.midia, a.certificado_usuario_id,
                a.situacao, a.tentativas, a.falha, a.proxima_tentativa_em, a.assinatura_cms, a.carimbo_tempo,
                a.carimbo_tempo_em, a.criado_em, a.previa_assinatura_id, u.login, pr.codigo AS provedor,
                ar.chave_armazenamento, ar.hash_sha256, ${versaoDoArquivo(col, 'ar')} AS versao_objeto
           FROM assinatura_icp a
           JOIN usuario u ON u.id = a.usuario_id
           LEFT JOIN provedor_assinatura_nuvem pr ON pr.id = a.provedor_assinatura_nuvem_id
           LEFT JOIN arquivo ar ON ar.id = a.arquivo_assinado_id
          WHERE a.id = ? AND a.estabelecimento_id = ? AND a.origem_assinatura = 'documento'`,
        [id, est],
      );
      if (!a) return null;
      const chave = textoOuNulo(a['chave_armazenamento']);
      return {
        id: n(a['id']),
        hospital: c.hospital,
        documento: n(a['documento_prontuario_id']),
        hash: texto(a['hash_assinado']),
        politicaIcp: texto(a['politica_icp']) as PoliticaIcp,
        midia: texto(a['midia']) as MidiaCertificado,
        provedor: textoOuNulo(a['provedor']),
        certificado: n(a['certificado_usuario_id']),
        usuario: texto(a['login']),
        estado: texto(a['situacao']) as EstadoAssinatura,
        tentativas: n(a['tentativas']),
        falha: textoOuNulo(a['falha']),
        proximaEm: iso(a['proxima_tentativa_em']),
        assinatura: base64(a['assinatura_cms']),
        carimboToken: base64(a['carimbo_tempo']),
        carimboEm: iso(a['carimbo_tempo_em']),
        criadoEm: iso(a['criado_em']) ?? '',
        previa: nn(a['previa_assinatura_id']),
        pdf: chave
          ? { chaveS3: chave, versaoS3: texto(a['versao_objeto']), hashPdf: texto(a['hash_sha256']) }
          : null,
      };
    });
  }

  async pendentesVencidas(c: ContextoAssinatura, agora: Date, teto: number): Promise<{ id: number; usuario: string }[]> {
    const ls = await this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      if (!est || teto < 1) return [];
      return l.consultar(
        `SELECT a.id, u.login FROM assinatura_icp a JOIN usuario u ON u.id = a.usuario_id
          WHERE a.estabelecimento_id = ? AND a.origem_assinatura = 'documento' AND a.situacao = 'pendente'
            AND a.proxima_tentativa_em IS NOT NULL AND a.proxima_tentativa_em <= ?
          ORDER BY a.proxima_tentativa_em, a.id LIMIT ?`,
        [est, agora, teto],
      );
    });
    return ls.map((r) => ({ id: n(r['id']), usuario: texto(r['login']) }));
  }

  async assinadosRecentes(c: ContextoAssinatura, login: string): Promise<DocumentoAssinadoIcp[]> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      if (!est) return [];
      const ls = await l.consultar(
        `SELECT a.id, a.documento_prontuario_id, a.politica_icp, a.carimbo_tempo_em, a.arquivo_assinado_id,
                COALESCE(a.alterado_em, a.criado_em) AS assinado_em, t.codigo AS tipo, dp.paciente_id,
                pv.codigo_verificacao
           FROM assinatura_icp a
           JOIN usuario u ON u.id = a.usuario_id
           JOIN documento_prontuario dp ON dp.id = a.documento_prontuario_id
           JOIN tipo_documento_clinico t ON t.id = dp.tipo_documento_clinico_id
           LEFT JOIN previa_assinatura pv ON pv.id = a.previa_assinatura_id
          WHERE a.estabelecimento_id = ? AND u.login = ? AND a.origem_assinatura = 'documento'
            AND a.situacao = 'assinada'
          ORDER BY a.id DESC LIMIT 20`,
        [est, login],
      );
      const vs = await this.ultimasValidacoes(l, ls.map((r) => n(r['id'])));
      return ls.map((a) => ({
        assinatura: n(a['id']),
        documento: n(a['documento_prontuario_id']),
        tipo: texto(a['tipo']),
        paciente: n(a['paciente_id']),
        politicaIcp: texto(a['politica_icp']) as PoliticaIcp,
        assinadoEm: iso(a['assinado_em']) ?? '',
        carimboEm: iso(a['carimbo_tempo_em']),
        codigo: textoOuNulo(a['codigo_verificacao']),
        temPdf: a['arquivo_assinado_id'] !== null && a['arquivo_assinado_id'] !== undefined,
        resultado: (textoOuNulo(vs.get(n(a['id']))?.['resultado'] ?? null) as ResultadoValidacao | null) ?? null,
      }));
    });
  }

  /** As tentativas em aberto (pendente ou em falha) de documentos ainda sem assinatura concluída. */
  async contagemPendencias(c: ContextoAssinatura): Promise<{ pendentes: number; falhas: number }> {
    const ls = await this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      if (!est) return [];
      return l.consultar(
        `SELECT a.situacao, COUNT(*) AS q FROM assinatura_icp a
          WHERE a.estabelecimento_id = ? AND a.origem_assinatura = 'documento' AND a.situacao IN ('pendente', 'falha')
            AND NOT EXISTS (SELECT 1 FROM assinatura_icp b WHERE b.documento_prontuario_id = a.documento_prontuario_id
                              AND b.situacao = 'assinada')
          GROUP BY a.situacao`,
        [est],
      );
    });
    const q = (s: string) => n(ls.find((r) => r['situacao'] === s)?.['q']);
    return { pendentes: q('pendente'), falhas: q('falha') };
  }

  async avisos(c: ContextoAssinatura, para: { autor: string } | 'diretor-tecnico'): Promise<AvisoAssinatura[]> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      if (!est) return [];
      const ls = await l.consultar(
        `SELECT av.id, av.assinatura_icp_id, av.destinatario, av.situacao_assinatura, av.falha, av.criado_em,
                a.documento_prontuario_id, ua.login AS autor
           FROM aviso_assinatura av
           JOIN assinatura_icp a ON a.id = av.assinatura_icp_id
           JOIN usuario ua ON ua.id = a.usuario_id
           LEFT JOIN usuario ud ON ud.id = av.usuario_id
          WHERE av.estabelecimento_id = ? AND av.lido_em IS NULL
            AND ${para === 'diretor-tecnico' ? "av.destinatario = 'diretor-tecnico'" : "av.destinatario = 'autor' AND ud.login = ?"}
          ORDER BY av.id DESC`,
        para === 'diretor-tecnico' ? [est] : [est, para.autor],
      );
      return ls.map((v) => ({
        id: n(v['id']),
        assinatura: n(v['assinatura_icp_id']),
        documento: nn(v['documento_prontuario_id']),
        destinatario: texto(v['destinatario']) as AvisoAssinatura['destinatario'],
        estado: texto(v['situacao_assinatura']) as AvisoAssinatura['estado'],
        falha: textoOuNulo(v['falha']),
        autor: texto(v['autor']),
        criadoEm: iso(v['criado_em']) ?? '',
      }));
    });
  }

  async solicitacoesSncr(c: ContextoAssinatura, documento: number): Promise<PedidoNumeracao[]> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      if (!est) return [];
      const ls = await l.consultar(
        `SELECT id, documento_prontuario_id, situacao, tentativas, numero, retorno FROM pedido_numeracao_receita
          WHERE estabelecimento_id = ? AND documento_prontuario_id = ? ORDER BY id DESC`,
        [est, documento],
      );
      return ls.map((x) => ({
        id: n(x['id']),
        documento: n(x['documento_prontuario_id']),
        situacao: texto(x['situacao']) as PedidoNumeracao['situacao'],
        tentativas: n(x['tentativas']),
        numero: textoOuNulo(x['numero']),
        retorno: textoOuNulo(x['retorno']),
      }));
    });
  }

  // ---- verificador público ----

  async documentoDoCodigo(c: ContextoAssinatura, codigo: string): Promise<DocumentoVerificado | null> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      if (!est) return null;
      const d = await l.uma(
        `SELECT da.id, da.entidade, da.entidade_id, da.tipo_documento, da.gerado_em, da.situacao, da.politica_icp,
                da.hash_conteudo, da.assinaturas_exigidas
           FROM documento_assinado da
          WHERE da.codigo_verificacao = ? AND da.estabelecimento_id = ? AND da.excluido_em IS NULL`,
        [codigo, est],
      );
      if (!d) return null;
      // Todas as assinaturas não excluídas do envelope: o resultado é do conjunto (regras-assinatura.ts).
      const as = await l.consultar(
        `SELECT id, sequencia, profissional_id, nome_signatario, situacao, assinado_em, carimbo_tempo_em,
                hash_assinado, verificada_em
           FROM assinatura_documento
          WHERE documento_assinado_id = ? AND excluido_em IS NULL
          ORDER BY sequencia`,
        [n(d['id'])],
      );
      const estado = estadoDoEnvelope({
        situacao: texto(d['situacao']),
        assinaturasExigidas: n(d['assinaturas_exigidas']),
        assinaturas: as.map((a) => ({ situacao: texto(a['situacao']) })),
      });
      // O autor (primeira assinatura) no selo; a data, o carimbo e o resumo são os da última assinatura aplicada.
      const autor = as[0] ?? null;
      const ultima = as[as.length - 1] ?? null;
      const profissional = autor ? nn(autor['profissional_id']) : null;
      const inscricao = profissional
        ? await l.uma(
            `SELECT cc.sigla, uf.sigla AS uf, i.numero_inscricao
               FROM inscricao_conselho i
               JOIN conselho_classe cc ON cc.id = i.conselho_classe_id
               LEFT JOIN unidade_federativa uf ON uf.id = i.unidade_federativa_id
              WHERE i.profissional_id = ? AND i.excluido_em IS NULL AND i.situacao IN ('ativa', 'provisoria')
              ORDER BY i.principal DESC, i.sequencia LIMIT 1`,
            [profissional],
          )
        : null;
      const verificadas = as.map((a) => iso(a['verificada_em'])).filter((v): v is string => v !== null);
      return {
        previa: n(d['id']),
        documento: n(d['entidade_id']),
        tipo: texto(d['tipo_documento']),
        emitidoEm: iso(d['gerado_em']),
        suspenso: ['cancelado', 'invalidado'].includes(texto(d['situacao'])),
        politicaIcp: textoOuNulo(d['politica_icp']) === 'AD-RT' ? 'AD-RT' : 'AD-RB',
        assinarEm: (ultima ? iso(ultima['assinado_em']) : null) ?? '',
        profissional: autor ? textoOuNulo(autor['nome_signatario']) : null,
        registro: inscricao
          ? registroExibido({
              sigla: textoOuNulo(inscricao['sigla']),
              uf: textoOuNulo(inscricao['uf']),
              numero: textoOuNulo(inscricao['numero_inscricao']),
            })
          : null,
        assinatura:
          estado && ultima
            ? {
                id: n(ultima['id']),
                estado: estado.estado,
                carimboEm: iso(ultima['carimbo_tempo_em']),
                hashPdf: textoOuNulo(ultima['hash_assinado']),
              }
            : null,
        validacao:
          estado?.resultado
            ? {
                resultado: estado.resultado,
                momento: 'assinar',
                // A validação do conjunto vale a partir da conferência mais recente.
                em: verificadas.sort().pop() ?? null,
              }
            : null,
      };
    });
  }

  /**
   * As consultas desde `desde`, por dia e resultado. A consulta sem documento achado (não encontrado, barrada) não
   * tem estabelecimento no modelo (pedido do lote): entra no painel de todos os estabelecimentos do cliente.
   */
  async resumoVerificacoes(c: ContextoAssinatura, desde: Date): Promise<ResumoVerificacoes[]> {
    const ls = await this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      return l.consultar(
        `SELECT DATE_FORMAT(cv.ocorrido_em, '%Y-%m-%d') AS dia, cv.resultado, COUNT(*) AS consultas
           FROM consulta_verificacao_documento cv
           LEFT JOIN documento_assinado da ON da.id = cv.documento_assinado_id
          WHERE cv.ocorrido_em >= ? AND (da.id IS NULL OR da.estabelecimento_id = ?)
          GROUP BY dia, cv.resultado
          ORDER BY dia, cv.resultado`,
        [desde, est],
      );
    });
    return ls.map((r) => ({
      dia: texto(r['dia']),
      resultado: RESULTADO_DO_BANCO[texto(r['resultado'])] ?? 'indeterminada',
      consultas: n(r['consultas']),
    }));
  }
}
