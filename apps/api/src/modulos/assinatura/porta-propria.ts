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
// Pendências de modelo (pedidos do lote 02-01, saida/02-01.json): o pedido de autorização do titular, a tentativa
// de assinatura com reprocessamento, a validação, a prévia exata, os avisos e a numeração da receita controlada não
// têm tabela; essas gravações respondem 503 "modelo-pendente" (indisponível, com o motivo) e as leituras voltam vazias. A parte pública do
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

/** Tabelas que as gravações desta porta podem tocar (a transação recusa as outras). */
export const TABELAS_ASSINATURA = [
  'certificado_usuario',
  'provedor_assinatura_nuvem',
  'consulta_verificacao_documento',
] as const;

/** Resultado da consulta pública no vocabulário do banco (CHECK ck_consulta_verificacao_documento_resultado). */
const RESULTADO_NO_BANCO: Readonly<Partial<Record<ResultadoVerificacao, string>>> = {
  valida: 'autentico',
  invalida: 'alterado',
  'nao-encontrado': 'nao_encontrado',
  barrada: 'bloqueado',
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

/** Os tipos de documento ICP na prioridade do domínio (DP-23), para o ORDER BY FIELD da fila. */
const TIPOS_POR_PRIORIDADE: readonly string[] = [...TIPOS_DOCUMENTO_ICP].sort(
  (a, b) => prioridadeIcp(a) - prioridadeIcp(b),
);

/** Recurso cuja tabela ainda não existe no modelo (pedido do lote 02-01): 503 explícito, sem gravar nada. */
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
}

const SQL_COLUNAS_OPCIONAIS = `
  SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND ((TABLE_NAME = 'certificado_usuario' AND COLUMN_NAME = 'certificado_der')
       OR (TABLE_NAME = 'provedor_assinatura_nuvem' AND COLUMN_NAME IN ('cliente_identificador', 'autoridades')))`;

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
    const pendente = (recurso: string) => async (): Promise<never> => {
      throw modeloPendente(recurso);
    };
    return {
      gravarCertificado: (x) => this.gravarCertificado(tx, x),
      inativarCertificado: (d) => this.inativarCertificado(tx, d),
      gravarPolitica: pendente('Política de assinatura por tipo, conselho e destino'),
      gravarProvedor: (p, v) => this.gravarProvedor(tx, c, p, v),
      gravarPedido: pendente('Pedido de assinatura'),
      consumirPedido: pendente('Pedido de assinatura'),
      gravarAssinatura: pendente('Assinatura ICP'),
      gravarValidacao: pendente('Validação da assinatura'),
      gravarPrevia: pendente('Prévia da assinatura'),
      gravarAssinaturaPdf: pendente('Prévia da assinatura'),
      registrarPdfAssinado: pendente('PDF assinado'),
      atualizarAssinatura: pendente('Reprocessamento da assinatura'),
      travarDocumentoParaAssinar: pendente('Assinatura ICP'),
      gravarEventoAssinadoIcp: pendente('Evento de assinatura do documento'),
      gravarAviso: pendente('Aviso de assinatura'),
      marcarAvisosLidos: pendente('Aviso de assinatura'),
      gravarSolicitacaoSncr: pendente('Numeração da receita controlada'),
      atualizarSolicitacaoSncr: pendente('Numeração da receita controlada'),
      gravarNumeroSncr: pendente('Numeração da receita controlada'),
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
    if (!resultado) throw modeloPendente(`Consulta pública com resultado "${x.resultado}"`);
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

  /** Pendência de modelo: a regra por conselho, destino e nível não cabe em politica_assinatura (pedido do lote). */
  async politicas(): Promise<[]> {
    return [];
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

  /** Pendência de modelo (tentativa de assinatura): nenhuma assinatura de conferência registrada ainda. */
  async assinaturas(): Promise<[]> {
    return [];
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
    if (tipos.length === 0 || teto < 1) return { itens: [], limitado: false };
    const ls = await this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      if (!est) return [];
      return l.consultar(
        `SELECT dp.id, t.codigo AS tipo, dp.paciente_id, dp.lancado_em
           FROM documento_prontuario dp
           JOIN tipo_documento_clinico t ON t.id = dp.tipo_documento_clinico_id
           JOIN situacao_documento_prontuario s ON s.id = dp.situacao_documento_prontuario_id
           JOIN usuario_vinculo_profissional v ON v.profissional_id = dp.profissional_id
                AND v.estabelecimento_id = dp.estabelecimento_id AND v.excluido_em IS NULL
                AND v.vigencia_inicio <= CURRENT_DATE AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
           JOIN usuario u ON u.id = v.usuario_id AND u.excluido_em IS NULL
          WHERE dp.estabelecimento_id = ? AND dp.excluido_em IS NULL AND dp.documento_assinado_id IS NULL
            AND u.login = ? AND t.codigo IN (${lista(tipos.length)})
            AND s.categoria IN (${lista(CATEGORIAS_ASSINAVEIS.length)})
          ORDER BY FIELD(t.codigo, ${lista(TIPOS_POR_PRIORIDADE.length)}), dp.id
          LIMIT ?`,
        [est, login, ...tipos, ...CATEGORIAS_ASSINAVEIS, ...TIPOS_POR_PRIORIDADE, teto + 1],
      );
    });
    const itens = ls.slice(0, teto).map((r) => ({
      documento: n(r['id']),
      tipo: texto(r['tipo']),
      paciente: n(r['paciente_id']),
      criadoEm: iso(r['lancado_em']) ?? '',
      assinatura: null,
      estado: null,
      tentativas: 0,
      falha: null,
      proximaEm: null,
    }));
    return { itens, limitado: ls.length > teto };
  }

  /** Pendência de modelo (tentativa de assinatura): nenhum documento com assinatura em andamento. */
  async assinaturasDosDocumentos(): Promise<Map<number, { id: number; estado: 'pendente' | 'assinada' | 'falha' }>> {
    return new Map();
  }

  async previaMaisRecente(): Promise<null> {
    return null;
  }

  async previa(): Promise<null> {
    return null;
  }

  async assinaturaDocumento(): Promise<null> {
    return null;
  }

  async pendentesVencidas(): Promise<[]> {
    return [];
  }

  async assinadosRecentes(): Promise<[]> {
    return [];
  }

  async contagemPendencias(): Promise<{ pendentes: number; falhas: number }> {
    return { pendentes: 0, falhas: 0 };
  }

  async avisos(): Promise<[]> {
    return [];
  }

  async solicitacoesSncr(): Promise<[]> {
    return [];
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
