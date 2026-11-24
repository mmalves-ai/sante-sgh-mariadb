// Porta PRÓPRIA das obrigações da operadora com a ANS (F2.2, lote 02-09) sobre o MariaDB do cliente, pelo @sgh/nucleo:
//   - envio = envio_ans (obrigação, período, sequência, situação, recibo), com os registros em envio_ans_item (o que a
//     tela mostra de cada registro fica em `dados`, JSON) e o retorno em envio_ans_retorno (resumo e críticas);
//   - o histórico do envio vem das datas do próprio envio e dos retornos (gerado, enviado, cada retorno);
//   - o código de controle operacional (CCO) aceito no retorno do SIB vai ao beneficiário
//     (beneficiario_plano.codigo_controle_ans, único no banco);
//   - domínios: motivos de movimentação cadastral (motivo_movimento_cadastral com o código da ANS), valores da TPS
//     (taxa_saude_suplementar_vigencia), grupos do SIP pela porta da F1; os campos do leiaute do SIB são do leiaute.
// O destino do envio (simulador ou ANS) é o do ambiente do processo: um banco de cliente vive num ambiente só.
// O número sequencial do banco é por operadora e obrigação (único); o sequencial que a tela mostra é a ordem do envio
// dentro do mesmo período (original 1, retificadores 2, 3...).
// Dado da rede inteira: os domínios da ANS (motivos e valores da TPS). Envios filtram pelo estabelecimento da sessão.
// Melhoria: o retorno aceito exige o recibo (CHECK no banco); o retificador aponta o envio que substitui (CHECK); o
// envio substituído muda de situação na mesma transação do novo.
// Complemento do SIB = complemento_sib_beneficiario (nascido vivo, residência no exterior, itens excluídos, motivo de
// cancelamento e o último envio aceito), mais o CCO e a cobertura parcial temporária do beneficiário. O endereço é o do
// cadastro da pessoa (endereco_pessoa, o principal ou o primeiro): uma fonte só; o complemento não o regrava e recusa o
// endereço diferente do cadastro. O retrato aceito é o registro do beneficiário no último envio SIB aceito (os dados do
// envio_ans_item), gravado no retorno.
// Base do DIOPS (eventos) = as contas médicas recebidas da rede (lote_conta_recebida) no período e os pagamentos dela.
// Ressarcimento ao SUS: o aviso gera a cobrança (cobranca_ressarcimento_sus: ofício, prazo da impugnação) e um
// atendimento por item (ressarcimento_sus_atendimento), ligados ao envio e aos itens; a GRU paga fica na cobrança; a
// decisão de cada atendimento marca o atendimento (impugnado ou devido) e abre a impugnação em elaboração.
// A GRU da TPS (Taxa de Saúde Suplementar) fica no próprio envio da obrigação `tps` (número, valor, pagamento).
// Bases das obrigações (pendências do SIB, SIP, DIOPS, monitoramento, beneficiários do aviso de ressarcimento): pelas
// portas próprias irmãs (ans-bases-proprias.ts), com a regra da porta de memória.
import { MOTIVOS_IMPUGNACAO_SUS, type MotivoImpugnacaoSus } from '@sgh/contratos';
import { createHash, randomUUID } from 'node:crypto';
import {
  type ArmazemArquivos,
  definirOperacao,
  type Escritor,
  type Leitor,
  type Linha,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { BasesAnsProprias, type FontesAnsProprias } from './ans-bases-proprias.js';
import type { ArquivoGravado, ContextoAns, GravadorAns, PortaAnsOperadora } from './ans-porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import type { ContextoGravacaoOperadora } from './contexto-gravacao.js';
import {
  BasePortaOperadoraPropria,
  bool,
  data,
  exigirOperadora,
  inexistente,
  instante,
  type NucleoOperadora,
  num,
  numOuNulo,
  pendente,
  txt,
  txtOuNulo,
  versaoDe,
} from './apoio-porta-propria.js';
import { CONTRATACAO } from './cobranca-porta-propria.js';
import {
  CAMPOS_SIB,
  type DadosAtivos,
  type DadosBeneficiarioDaOperadora,
  type DadosComplementoSib,
  type EntradaComplementoSib,
  type DadosEnvioAns,
  type DadosEnvioAnsResumo,
  type DadosEnvioExistente,
  type DadosEventoEnvioAns,
  type DadosItemEnvioAns,
  type DadosObrigacao,
  type EntradaGeracaoEnvio,
  type FiltroEnviosPorta,
  LIMITE_PAGINA_ENVIOS,
  type SituacaoEnvioPorta,
  type TotaisEnvios,
} from './dados-portas.js';
import type { PortaOperadora } from './porta.js';

export const TABELAS_ANS = [
  'envio_ans',
  'envio_ans_item',
  'envio_ans_retorno',
  'beneficiario_plano',
  'complemento_sib_beneficiario',
  'cobranca_ressarcimento_sus',
  'ressarcimento_sus_atendimento',
  'impugnacao_ressarcimento_sus',
] as const;

/** Motivo da impugnação (código da tela) → natureza no banco: de cadastro do beneficiário ou técnico-assistencial. */
const NATUREZA_MOTIVO: Readonly<Record<string, 'tecnico' | 'administrativo'>> = {
  naoBeneficiario: 'administrativo',
  foraDaVigencia: 'administrativo',
  carencia: 'administrativo',
  cartaoDesconto: 'administrativo',
  duplicidade: 'administrativo',
  cpt: 'tecnico',
  segmentacao: 'tecnico',
  abrangencia: 'tecnico',
  outro: 'administrativo',
};

/** O endereço residencial do beneficiário no cadastro da pessoa (o principal, senão o primeiro vigente). */
const SELECT_ENDERECO_BENEFICIARIO = `
  SELECT e.logradouro, e.numero, e.complemento, COALESCE(e.bairro_nome, ba.descricao) AS bairro, e.cep,
         mu.codigo_ibge
    FROM beneficiario_plano b
    JOIN endereco_pessoa e ON e.pessoa_fisica_id = b.pessoa_fisica_id AND e.excluido_em IS NULL
                          AND (e.vigencia_fim IS NULL OR e.vigencia_fim >= CURRENT_DATE)
    LEFT JOIN bairro ba ON ba.id = e.bairro_id
    LEFT JOIN municipio_ibge mu ON mu.id = e.municipio_ibge_id
   WHERE b.id = ?
   ORDER BY e.principal DESC, e.sequencia
   LIMIT 1`;

const textoOuNulo = (v: unknown): string | null => {
  const t = txtOuNulo(v)?.trim() ?? '';
  return t === '' ? null : t.toUpperCase();
};

export const OBRIGACAO: Readonly<Record<DadosObrigacao, string>> = {
  SIB: 'sib',
  SIP: 'sip',
  DIOPS: 'diops',
  TPS: 'tps',
  MONITORAMENTO_TISS: 'monitoramento_tiss',
  RESSARCIMENTO_SUS: 'ressarcimento_sus',
};
const OBRIGACAO_DO_BANCO: Readonly<Record<string, DadosObrigacao>> = Object.fromEntries(
  Object.entries(OBRIGACAO).map(([k, v]) => [v, k as DadosObrigacao]),
);
const SITUACAO: Readonly<Record<SituacaoEnvioPorta, string>> = {
  gerado: 'gerado',
  enviado: 'enviado',
  aceito: 'aceito',
  aceitoParcial: 'aceito_parcial',
  rejeitado: 'rejeitado',
  substituido: 'substituido',
};
const SITUACAO_DO_BANCO: Readonly<Record<string, SituacaoEnvioPorta>> = Object.fromEntries(
  Object.entries(SITUACAO).map(([k, v]) => [v, k as SituacaoEnvioPorta]),
);
/** O tipo do registro na tela → o tipo do registro no banco (o tipo da tela fica nos dados do registro). */
const TIPO_REGISTRO: Readonly<Record<string, string>> = {
  beneficiario: 'beneficiario',
  guia: 'guia',
  atendimento: 'guia',
  grupo: 'quadro_assistencial',
  quadro: 'quadro_contabil',
  plano: 'contrato',
  contrato: 'contrato',
  prestador: 'prestador',
};

const dois = (n: number) => String(n).padStart(2, '0');
const ultimoDiaDoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

/** A competência da tela (AAAA-MM, AAAA-Tn ou AAAA-MM-DD) → o período, o mês, o ano e o trimestre do banco. */
export function periodoDaCompetencia(competencia: string): {
  inicio: string;
  fim: string;
  competencia: string | null;
  ano: number;
  trimestre: number | null;
} {
  const ano = Number(competencia.slice(0, 4));
  const tri = /^\d{4}-T([1-4])$/.exec(competencia);
  if (tri) {
    const t = Number(tri[1]);
    const mi = (t - 1) * 3 + 1;
    return {
      inicio: `${ano}-${dois(mi)}-01`,
      fim: `${ano}-${dois(mi + 2)}-${ultimoDiaDoMes(ano, mi + 2)}`,
      competencia: null,
      ano,
      trimestre: t,
    };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(competencia))
    return { inicio: competencia, fim: competencia, competencia: null, ano, trimestre: null };
  if (!/^\d{4}-\d{2}$/.test(competencia))
    throw recusa('competencia-invalida', 'Competência inválida.', { campos: ['competencia'] });
  const mes = Number(competencia.slice(5, 7));
  return {
    inicio: `${competencia}-01`,
    fim: `${competencia}-${ultimoDiaDoMes(ano, mes)}`,
    competencia: `${competencia}-01`,
    ano,
    trimestre: null,
  };
}

/** O período do banco → a competência da tela. */
function competenciaDoEnvio(e: Linha): string {
  const tri = numOuNulo(e['trimestre']);
  if (tri) return `${num(e['ano'])}-T${tri}`;
  if (e['competencia'] !== null && e['competencia'] !== undefined)
    return (data(e['competencia']) ?? '').slice(0, 7);
  return data(e['periodo_inicio']) ?? '';
}

const SELECT_ENVIO = `
  SELECT e.*, o.nome AS operadora_nome, o.registro_ans, u.login AS gerado_login,
         (SELECT COUNT(*) FROM envio_ans_item i WHERE i.envio_ans_id = e.id AND i.excluido_em IS NULL) AS registros,
         (SELECT SUM(i.valor) FROM envio_ans_item i WHERE i.envio_ans_id = e.id AND i.excluido_em IS NULL) AS valor_total,
         (SELECT COUNT(*) FROM envio_ans x
           WHERE x.operadora_saude_id = e.operadora_saude_id AND x.obrigacao = e.obrigacao
             AND x.periodo_inicio = e.periodo_inicio AND x.periodo_fim = e.periodo_fim AND x.id <= e.id
             AND x.excluido_em IS NULL) AS sequencial,
         (SELECT MAX(r.recebido_em) FROM envio_ans_retorno r WHERE r.envio_ans_id = e.id) AS retorno_em,
         (SELECT r.descricao FROM envio_ans_retorno r
           WHERE r.envio_ans_id = e.id AND r.tipo = 'resumo_processamento' ORDER BY r.sequencia DESC LIMIT 1)
           AS retorno_resumo,
         a.nome_original AS arquivo_nome, a.tamanho_bytes AS arquivo_bytes, a.hash_sha256 AS arquivo_hash,
         cr.numero_oficio AS aviso_numero, cr.oficio_em AS aviso_recebido_em, cr.prazo_impugnacao AS aviso_prazo,
         COALESCE(cr.numero_gru, e.numero_gru) AS gru_numero, COALESCE(cr.pago_em, e.gru_paga_em) AS gru_pago_em,
         COALESCE(cr.valor_pago, e.valor_pago_gru) AS gru_valor_pago
    FROM envio_ans e
    JOIN operadora_saude o ON o.id = e.operadora_saude_id
    LEFT JOIN usuario u ON u.id = COALESCE(e.gerado_por_usuario_id, e.criado_por)
    LEFT JOIN arquivo a ON a.id = e.arquivo_id
    LEFT JOIN cobranca_ressarcimento_sus cr ON cr.id = e.cobranca_ressarcimento_sus_id`;

/** Liga o arquivo guardado ao envio (alteração auditada: versão, alterado_em/por e trilha da operação). */
const LIGAR_ARQUIVO = definirOperacao({
  nome: 'operadora.ans.arquivo-ligado',
  tabelas: ['envio_ans'],
  entrada: z.object({
    envio: z.number().int().positive(),
    arquivo: z.number().int().positive(),
    estabelecimento: z.number().int().nonnegative(),
  }),
  gravar: async (tx, x) => {
    const e = await versaoDe(tx, 'envio_ans', x.envio, 'O envio');
    if (num(e['estabelecimento_id']) !== x.estabelecimento) throw inexistente('O envio');
    return {
      id: x.envio,
      versao: await tx.alterar('envio_ans', x.envio, num(e['versao']), { arquivo_id: x.arquivo }),
    };
  },
  alvo: (x) => ({ tabela: 'envio_ans', id: x.envio }),
});

export class PortaAnsOperadoraPropria
  extends BasePortaOperadoraPropria<GravadorAns>
  implements PortaAnsOperadora
{
  constructor(
    nucleo: NucleoOperadora & Pick<NucleoProprio, 'escrever'>,
    cliente: string,
    private readonly f1: Pick<PortaOperadora, 'gruposSip'>,
    /** O destino dos envios deste ambiente (o do serviço: simulador fora de produção). */
    private readonly destinoEnvios: 'simulador' | 'ans',
    /** As portas próprias irmãs das bases das obrigações (SIB, SIP, DIOPS, monitoramento, ressarcimento). */
    fontes: FontesAnsProprias | null = null,
    /**
     * O armazenamento de arquivos da instalação (ADR 0004: disco local, metadado na tabela `arquivo`). Sem ele (sem
     * ARQUIVOS_RAIZ), o envio é gerado sem guardar o arquivo e abrir o arquivo responde 501.
     */
    private readonly armazem: ArmazemArquivos | null = null,
  ) {
    super(nucleo, cliente, 'operadora.ans', TABELAS_ANS);
    this.escrever = (ctx, fn) => nucleo.escrever(ctx, fn);
    this.bases = fontes ? new BasesAnsProprias(fontes, (c, b) => this.complementoSib(c, b)) : null;
  }

  private readonly bases: BasesAnsProprias | null;
  private readonly escrever: (
    ctx: { readonly cliente: string; readonly correlacao: string },
    fn: (e: Escritor) => Promise<unknown>,
  ) => Promise<unknown>;
  /**
   * Os arquivos que a gravação em curso pediu para guardar, pela chave de idempotência do pedido. O registro do arquivo
   * é ele mesmo uma operação do Executor (trilha, idempotência), que não roda DENTRO de outra operação (o ponto de
   * salvamento é um só por nível e a transação da operação só grava nas tabelas dela): por isso o gravador confere o
   * arquivo e o anota aqui, e `gravar` guarda e liga ao envio logo DEPOIS da operação, na MESMA transação.
   */
  private readonly arquivosPedidos = new Map<string, { envio: number; arquivo: ArquivoGravado }[]>();

  /**
   * Com o armazenamento ligado, a gravação da tela, a guarda do arquivo (disco + registro) e a ligação do arquivo ao
   * envio (`envio_ans.arquivo_id`, alteração auditada com versão e trilha) ficam numa transação só: tudo ou nada.
   */
  override async gravar<T>(
    c: ContextoGravacaoOperadora,
    trilha: RegistroTrilhaTela | ((r: T) => RegistroTrilhaTela),
    fn: (g: GravadorAns) => Promise<T>,
  ): Promise<T> {
    const armazem = this.armazem;
    const chave = c.chaveIdempotencia;
    if (!armazem || !chave) return super.gravar(c, trilha, fn);
    const correlacao = (c.correlacao || 'operadora.ans').slice(0, 64);
    return (await this.escrever({ cliente: this.cliente, correlacao }, async (e) => {
      this.arquivosPedidos.set(chave, []);
      try {
        let r = await super.gravar(c, trilha, fn, { escritor: e });
        for (const [i, p] of (this.arquivosPedidos.get(chave) ?? []).entries()) {
          const ctxOp = {
            cliente: this.cliente,
            estabelecimento: c.estabelecimento,
            usuario: c.usuario,
            correlacao,
            chaveIdempotencia: `${chave}:arquivo:${i}`.slice(0, 128),
          };
          const g = await armazem.guardar(
            {
              conteudo: Buffer.from(p.arquivo.base64, 'base64'),
              nomeOriginal: p.arquivo.nome.slice(0, 255),
              tipoMime: 'application/xml',
              finalidade: 'envio_ans',
              entidade: 'envio_ans',
              entidadeId: p.envio,
              imutavel: true,
            },
            { ...ctxOp, chaveIdempotencia: `ans-arquivo:${p.envio}:${randomUUID()}` },
            { escritor: e },
          );
          const ligado = await this.executor.executar(
            LIGAR_ARQUIVO,
            this.cliente,
            { envio: p.envio, arquivo: g.id, estabelecimento: c.estabelecimento ?? 0 },
            ctxOp,
            { escritor: e },
          );
          // O resultado da tela leva a versão do envio depois da ligação (a que a próxima gravação espera).
          if (r && typeof r === 'object' && (r as { id?: unknown }).id === p.envio && 'versao' in r)
            r = { ...r, versao: ligado.resultado.versao };
        }
        return r;
      } finally {
        this.arquivosPedidos.delete(chave);
      }
    })) as T;
  }

  /** As bases das obrigações; sem as portas irmãs (montagem parcial), 501 com o nome do recurso. */
  private base(recurso: string): BasesAnsProprias {
    return this.bases ?? pendente(recurso);
  }

  private envioDe(e: Linha): DadosEnvioAns {
    const resumo: DadosEnvioAnsResumo = {
      id: num(e['id']),
      versao: num(e['versao']),
      operadora: {
        id: num(e['operadora_saude_id']),
        nome: txt(e['operadora_nome']),
        registroAns: txt(e['registro_ans']),
      },
      obrigacao: OBRIGACAO_DO_BANCO[txt(e['obrigacao'])] ?? 'SIB',
      competencia: competenciaDoEnvio(e),
      sequencial: num(e['sequencial']),
      retificador: txt(e['tipo_envio']) !== 'original',
      destino: this.destinoEnvios,
      leiaute: txt(e['versao_leiaute']),
      situacao: SITUACAO_DO_BANCO[txt(e['situacao'])] ?? 'gerado',
      registros: num(e['registros']),
      valorTotal: numOuNulo(e['valor_total']),
      arquivoNome: txtOuNulo(e['arquivo_nome']),
      arquivoBytes: numOuNulo(e['arquivo_bytes']),
      hash: txtOuNulo(e['arquivo_hash']),
      recibo: txtOuNulo(e['numero_recibo']),
      criadoEm: instante(e['gerado_em'] ?? e['criado_em']) ?? '',
      criadoPor: txt(e['gerado_login']),
      enviadoEm: instante(e['enviado_em']),
      retornoEm: instante(e['retorno_em']),
      aviso: txtOuNulo(e['aviso_numero']),
      recebidoEm: data(e['aviso_recebido_em']),
      prazo: data(e['aviso_prazo']),
      gru: txtOuNulo(e['gru_numero']),
      pagoEm: data(e['gru_pago_em']),
      valorPago: numOuNulo(e['gru_valor_pago']),
    };
    return { ...resumo, quadros: null, retornoResumo: txtOuNulo(e['retorno_resumo']) };
  }

  // ---- domínios ----

  async motivosSib(c: ContextoAns): Promise<{ codigo: number; nome: string; grupo: number }[]> {
    const linhas = await this.ler(c, (l) =>
      l.consultar(
        `SELECT codigo_ans, descricao, tipo_movimento FROM motivo_movimento_cadastral
          WHERE codigo_ans IS NOT NULL AND ativo = TRUE ORDER BY codigo_ans`,
      ),
    );
    const grupo = (t: string) =>
      t.startsWith('inclus') ? 1 : t.startsWith('exclus') || t.startsWith('cancel') ? 3 : 2;
    return linhas
      .filter((m) => /^\d+$/.test(txt(m['codigo_ans'])))
      .map((m) => ({
        codigo: Number(m['codigo_ans']),
        nome: txt(m['descricao']),
        grupo: grupo(txt(m['tipo_movimento'])),
      }));
  }

  async camposSib(): Promise<{ codigo: number; nome: string }[]> {
    return CAMPOS_SIB.map((x) => ({ ...x }));
  }

  async valoresTps(
    c: ContextoAns,
  ): Promise<{ vigencia: string; valorAnual: number; valorTrimestral: number }[]> {
    const linhas = await this.ler(c, (l) =>
      l.consultar(
        `SELECT vigencia_inicio, valor_anual, valor_trimestral FROM taxa_saude_suplementar_vigencia
          ORDER BY vigencia_inicio`,
      ),
    );
    return linhas.map((v) => ({
      vigencia: data(v['vigencia_inicio']) ?? '',
      valorAnual: num(v['valor_anual']),
      valorTrimestral: num(v['valor_trimestral']),
    }));
  }

  gruposSip(c: ContextoAns): Promise<{ id: number; nome: string }[]> {
    return this.f1.gruposSip(c) as Promise<{ id: number; nome: string }[]>;
  }

  // ---- envios ----

  envios(
    c: ContextoAns,
    f: FiltroEnviosPorta,
  ): Promise<{ itens: DadosEnvioAnsResumo[]; proxima: number | null }> {
    const limite = Math.min(f.limite ?? LIMITE_PAGINA_ENVIOS, LIMITE_PAGINA_ENVIOS);
    const cond = ['e.estabelecimento_id = ?', 'e.excluido_em IS NULL'];
    const p: unknown[] = [c.estabelecimento ?? 0];
    if (f.operadora !== undefined) {
      cond.push('e.operadora_saude_id = ?');
      p.push(f.operadora);
    }
    if (f.obrigacao) {
      cond.push('e.obrigacao = ?');
      p.push(OBRIGACAO[f.obrigacao]);
    }
    if (f.competencia) {
      const per = periodoDaCompetencia(f.competencia);
      cond.push('e.periodo_inicio = ? AND e.periodo_fim = ?');
      p.push(per.inicio, per.fim);
    }
    if (f.situacao) {
      cond.push('e.situacao = ?');
      p.push(SITUACAO[f.situacao]);
    }
    if (f.apos) {
      cond.push('e.id < ?');
      p.push(f.apos);
    }
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `${SELECT_ENVIO} WHERE ${cond.join(' AND ')} ORDER BY e.id DESC LIMIT ${limite + 1}`,
        p,
      );
      const itens = linhas.slice(0, limite).map((e) => this.envioDe(e));
      return { itens, proxima: linhas.length > limite ? (itens.at(-1)?.id ?? null) : null };
    });
  }

  totais(c: ContextoAns): Promise<TotaisEnvios> {
    return this.ler(c, async (l) => {
      const t = await l.uma(
        `SELECT SUM(situacao = 'gerado') AS gerados, SUM(situacao = 'enviado') AS aguardando,
                SUM(situacao = 'rejeitado') AS rejeitados
           FROM envio_ans WHERE estabelecimento_id = ? AND excluido_em IS NULL`,
        [c.estabelecimento ?? 0],
      );
      const r = await l.uma(
        `SELECT COUNT(*) AS n FROM cobranca_ressarcimento_sus
          WHERE estabelecimento_id = ? AND situacao IN ('notificada','em_impugnacao')
            AND prazo_impugnacao >= CURRENT_DATE AND excluido_em IS NULL`,
        [c.estabelecimento ?? 0],
      );
      return {
        gerados: num(t?.['gerados']),
        aguardandoRetorno: num(t?.['aguardando']),
        rejeitados: num(t?.['rejeitados']),
        ressarcimentosEmPrazo: num(r?.['n']),
      };
    });
  }

  envio(c: ContextoAns, id: number): Promise<DadosEnvioAns | null> {
    return this.ler(c, async (l) => {
      const e = await l.uma(
        `${SELECT_ENVIO} WHERE e.id = ? AND e.estabelecimento_id = ? AND e.excluido_em IS NULL`,
        [id, c.estabelecimento ?? 0],
      );
      return e ? this.envioDe(e) : null;
    });
  }

  /** O arquivo guardado do envio do estabelecimento (sem arquivo ou de outro estabelecimento: null). */
  async arquivo(
    c: ContextoAns,
    id: number,
  ): Promise<{ nome: string; base64: string; sha256: string } | null> {
    // Sem o armazenamento ligado (a ligação no modulo.ts aguarda a prova da gravação), 501 com o nome do recurso.
    if (!this.armazem) return pendente('Arquivo do envio à ANS (armazenamento de arquivos)');
    const est = c.estabelecimento ?? 0;
    const e = await this.ler(c, (l) =>
      l.uma(
        'SELECT arquivo_id FROM envio_ans WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [id, est],
      ),
    );
    const arq = numOuNulo(e?.['arquivo_id']);
    if (!arq) return null;
    const r = await this.armazem.ler(
      {
        cliente: this.cliente,
        estabelecimento: est,
        usuario: null,
        correlacao: c.correlacao || 'operadora.ans',
      },
      arq,
    );
    if (r.metadado.estabelecimento !== est) return null;
    return { nome: r.metadado.nomeOriginal, base64: r.conteudo.toString('base64'), sha256: r.metadado.hash };
  }

  /**
   * Guarda o arquivo do envio no armazenamento (imutável, ligado ao envio) e devolve o id do metadado. O conteúdo é
   * conferido pelo hash que a geração calculou: divergência recusa (nunca guarda arquivo diferente do declarado).
   */
  private pedirArquivo(tx: TxOperacao, envio: number, a: ArquivoGravado): void {
    const pedidos = this.arquivosPedidos.get(tx.contexto.chaveIdempotencia);
    if (!this.armazem || !pedidos) return;
    const conteudo = Buffer.from(a.base64, 'base64');
    // Confere antes de guardar: o arquivo divergente nunca chega ao disco (e a operação inteira volta).
    if (createHash('sha256').update(conteudo).digest('hex') !== a.sha256.toLowerCase())
      throw recusa(
        'arquivo-divergente',
        'O conteúdo do arquivo não confere com o resumo calculado na geração.',
      );
    pedidos.push({ envio, arquivo: a });
  }

  itens(c: ContextoAns, id: number): Promise<DadosItemEnvioAns[]> {
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT i.id, i.sequencia, i.tipo_registro, i.beneficiario_plano_id, i.valor, i.dados, i.situacao,
                b.codigo_controle_ans,
                (SELECT r.descricao FROM envio_ans_retorno r
                  WHERE r.envio_ans_item_id = i.id AND r.tipo = 'critica_registro'
                  ORDER BY r.sequencia DESC LIMIT 1) AS erro
           FROM envio_ans_item i
           JOIN envio_ans e ON e.id = i.envio_ans_id
           LEFT JOIN beneficiario_plano b ON b.id = i.beneficiario_plano_id
          WHERE i.envio_ans_id = ? AND e.estabelecimento_id = ? AND i.excluido_em IS NULL
          ORDER BY i.sequencia`,
        [id, c.estabelecimento ?? 0],
      );
      return linhas.map((i) => {
        const d = lerDados(i['dados']);
        const situacao = txt(i['situacao']);
        const resultado: DadosItemEnvioAns['resultado'] =
          situacao === 'aceito' ? 'aceito' : situacao === 'rejeitado' ? 'rejeitado' : 'enviado';
        return {
          id: num(i['id']),
          ordem: num(i['sequencia']),
          tipo: txt(d['tipo'] ?? i['tipo_registro']),
          referencia: txt(d['referencia']),
          descricao: txt(d['descricao']),
          beneficiario: numOuNulo(i['beneficiario_plano_id']),
          valor: numOuNulo(i['valor']),
          dados: txtOuNulo(d['dados']),
          resultado,
          erro: resultado === 'rejeitado' ? txtOuNulo(i['erro']) : null,
          cco: resultado === 'aceito' ? txtOuNulo(i['codigo_controle_ans']) : null,
          sugestao: txtOuNulo(d['sugestao']),
          decisao: (txtOuNulo(d['decisao']) as DadosItemEnvioAns['decisao']) ?? null,
          motivo: txtOuNulo(d['motivo']),
          justificativa: txtOuNulo(d['justificativa']),
          decididoEm: txtOuNulo(d['decididoEm']),
          decididoPor: txtOuNulo(d['decididoPor']),
        };
      });
    });
  }

  eventos(c: ContextoAns, id: number): Promise<DadosEventoEnvioAns[]> {
    return this.ler(c, async (l) => {
      const e = await l.uma(
        `SELECT e.situacao, e.gerado_em, e.criado_em, e.enviado_em, e.numero_recibo, ug.login AS gerado_login,
                ua.login AS alterado_login
           FROM envio_ans e
           LEFT JOIN usuario ug ON ug.id = COALESCE(e.gerado_por_usuario_id, e.criado_por)
           LEFT JOIN usuario ua ON ua.id = e.alterado_por
          WHERE e.id = ? AND e.estabelecimento_id = ? AND e.excluido_em IS NULL`,
        [id, c.estabelecimento ?? 0],
      );
      if (!e) return [];
      const r: DadosEventoEnvioAns[] = [
        {
          evento: 'gerado',
          situacao: 'gerado',
          texto: null,
          por: txt(e['gerado_login']),
          em: instante(e['gerado_em'] ?? e['criado_em']) ?? '',
        },
      ];
      if (e['enviado_em'])
        r.push({
          evento: 'enviado',
          situacao: 'enviado',
          texto: txtOuNulo(e['numero_recibo']) ? `Recibo ${txt(e['numero_recibo'])}` : null,
          por: txt(e['alterado_login']),
          em: instante(e['enviado_em']) ?? '',
        });
      const retornos = await l.consultar(
        `SELECT r.descricao, r.recebido_em, u.login FROM envio_ans_retorno r LEFT JOIN usuario u ON u.id = r.criado_por
          WHERE r.envio_ans_id = ? AND r.tipo = 'resumo_processamento' ORDER BY r.sequencia`,
        [id],
      );
      for (const x of retornos)
        r.push({
          evento: 'retorno',
          situacao: SITUACAO_DO_BANCO[txt(e['situacao'])] ?? 'enviado',
          texto: txtOuNulo(x['descricao']),
          por: txt(x['login']),
          em: instante(x['recebido_em']) ?? '',
        });
      return r;
    });
  }

  existentes(
    c: ContextoAns,
    operadora: number,
    obrigacao: DadosObrigacao,
    competencia: string,
  ): Promise<DadosEnvioExistente[]> {
    const per = periodoDaCompetencia(competencia);
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `${SELECT_ENVIO}
          WHERE e.estabelecimento_id = ? AND e.operadora_saude_id = ? AND e.obrigacao = ?
            AND e.periodo_inicio = ? AND e.periodo_fim = ? AND e.excluido_em IS NULL
          ORDER BY e.id`,
        [c.estabelecimento ?? 0, operadora, OBRIGACAO[obrigacao], per.inicio, per.fim],
      );
      return linhas.map((e) => {
        const x = this.envioDe(e);
        return {
          id: x.id,
          obrigacao: x.obrigacao,
          competencia: x.competencia,
          sequencial: x.sequencial,
          situacao: x.situacao,
        };
      });
    });
  }

  // ---- bases das obrigações ----

  beneficiariosSib(c: ContextoAns, operadora: number, apos: number) {
    return this.base('Pendências do SIB').beneficiariosSib(c, operadora, apos);
  }

  complementoSib(c: ContextoAns, beneficiario: number): Promise<DadosComplementoSib | null> {
    return this.ler(c, (l) => lerComplementoSib(l, c.estabelecimento ?? 0, beneficiario));
  }

  beneficiarioDaOperadora(
    c: ContextoAns,
    beneficiario: number,
  ): Promise<DadosBeneficiarioDaOperadora | null> {
    return this.ler(c, async (l) => {
      const b = await l.uma(
        `SELECT b.id, k.operadora_saude_id, b.matricula, pf.nome
           FROM beneficiario_plano b
           JOIN contrato_plano k ON k.id = b.contrato_plano_id
           JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id
          WHERE b.id = ? AND k.estabelecimento_id = ? AND b.excluido_em IS NULL`,
        [beneficiario, c.estabelecimento ?? 0],
      );
      return b
        ? {
            id: num(b['id']),
            operadora: num(b['operadora_saude_id']),
            carteirinha: txt(b['matricula']),
            nome: txt(b['nome']),
          }
        : null;
    });
  }

  ativosNaData(c: ContextoAns, operadora: number, dia: string): Promise<DadosAtivos[]> {
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT p.id, p.nome, p.numero_registro_ans, p.tipo_contratacao, COUNT(*) AS quantidade
           FROM beneficiario_plano b
           JOIN contrato_plano k ON k.id = b.contrato_plano_id
           JOIN produto_plano p ON p.id = k.produto_plano_id
          WHERE k.operadora_saude_id = ? AND k.estabelecimento_id = ? AND b.excluido_em IS NULL
            AND b.inicio_vigencia <= ? AND (b.data_exclusao IS NULL OR b.data_exclusao > ?)
          GROUP BY p.id, p.nome, p.numero_registro_ans, p.tipo_contratacao
          ORDER BY p.nome`,
        [operadora, c.estabelecimento ?? 0, dia, dia],
      );
      return linhas.map((p) => ({
        produto: num(p['id']),
        nome: txt(p['nome']),
        registroAns: txtOuNulo(p['numero_registro_ans']),
        segmentacao: null,
        tipoContratacao: CONTRATACAO[txt(p['tipo_contratacao'])] ?? 1,
        quantidade: num(p['quantidade']),
      }));
    });
  }

  planos(
    c: ContextoAns,
    operadora: number,
  ): Promise<{ produto: number; nome: string; registroAns: string | null }[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT DISTINCT p.id, p.nome, p.numero_registro_ans
             FROM produto_plano p JOIN contrato_plano k ON k.produto_plano_id = p.id
            WHERE k.operadora_saude_id = ? AND k.estabelecimento_id = ? AND p.excluido_em IS NULL
            ORDER BY p.nome`,
          [operadora, c.estabelecimento ?? 0],
        )
      ).map((p) => ({
        produto: num(p['id']),
        nome: txt(p['nome']),
        registroAns: txtOuNulo(p['numero_registro_ans']),
      })),
    );
  }

  itensSip(c: ContextoAns, operadora: number, inicio: string, fim: string, apos: number) {
    return this.base('Base do SIP').itensSip(c, operadora, inicio, fim, apos);
  }

  vigenciasSip(c: ContextoAns, procedimentos: readonly number[]) {
    return this.base('Vigência dos procedimentos no SIP').vigenciasSip(c, procedimentos);
  }

  cobrancasDiops(c: ContextoAns, operadora: number, meses: readonly string[], inicio: string, fim: string) {
    return this.base('Base do DIOPS').cobrancasDiops(c, operadora, meses, inicio, fim);
  }

  contasDiops(
    c: ContextoAns,
    operadora: number,
    inicio: string,
    fim: string,
  ): Promise<{
    contas: {
      recebidaEm: string;
      apresentado: number;
      glosado: number;
      situacao: 'recebida' | 'analisada' | 'paga' | 'devolvida';
    }[];
    pagamentos: { pagoEm: string; valor: number }[];
  }> {
    return this.ler(c, async (l) => {
      const contas = await l.consultar(
        `SELECT DATE(recebido_em) AS recebida, valor_apresentado, valor_glosado, situacao
           FROM lote_conta_recebida
          WHERE estabelecimento_id = ? AND operadora_saude_id = ? AND excluido_em IS NULL
            AND situacao <> 'cancelada' AND recebido_em >= ? AND recebido_em < DATE_ADD(?, INTERVAL 1 DAY)
          ORDER BY recebido_em, id`,
        [c.estabelecimento ?? 0, operadora, inicio, fim],
      );
      const pagos = await l.consultar(
        `SELECT pago_em, valor_pago FROM lote_conta_recebida
          WHERE estabelecimento_id = ? AND operadora_saude_id = ? AND excluido_em IS NULL
            AND pago_em IS NOT NULL AND pago_em BETWEEN ? AND ?
          ORDER BY pago_em, id`,
        [c.estabelecimento ?? 0, operadora, inicio, fim],
      );
      return {
        contas: contas.map((k) => ({
          recebidaEm: data(k['recebida']) ?? '',
          apresentado: num(k['valor_apresentado']),
          glosado: num(k['valor_glosado']),
          situacao: txt(k['situacao']) as 'recebida' | 'analisada' | 'paga' | 'devolvida',
        })),
        pagamentos: pagos.map((p) => ({ pagoEm: data(p['pago_em']) ?? '', valor: num(p['valor_pago']) })),
      };
    });
  }

  guiasMonitoramento(c: ContextoAns, operadora: number, inicio: string, fim: string, teto: number) {
    return this.base('Base do monitoramento TISS').guiasMonitoramento(c, operadora, inicio, fim, teto);
  }

  beneficiariosRessarcimento(c: ContextoAns, operadora: number, identificacoes: readonly string[]) {
    return this.base('Identificação dos beneficiários do ressarcimento ao SUS').beneficiariosRessarcimento(
      c,
      operadora,
      identificacoes,
    );
  }

  async atendimentosJaCobrados(
    c: ContextoAns,
    atendimentos: readonly { tipo: string; numero: string }[],
  ): Promise<Set<string>> {
    if (atendimentos.length === 0) return new Set();
    const linhas = await this.ler(c, (l) =>
      l.consultar(
        `SELECT a.tipo_atendimento, a.numero_atendimento
           FROM ressarcimento_sus_atendimento a
           JOIN cobranca_ressarcimento_sus r ON r.id = a.cobranca_ressarcimento_sus_id
          WHERE r.estabelecimento_id = ? AND a.excluido_em IS NULL
            AND a.numero_atendimento IN (${atendimentos.map(() => '?').join(', ')})`,
        [c.estabelecimento ?? 0, ...atendimentos.map((a) => a.numero)],
      ),
    );
    return new Set(linhas.map((a) => `${txt(a['tipo_atendimento'])}|${txt(a['numero_atendimento'])}`));
  }

  // ---- gravação ----

  protected gravador(tx: TxOperacao): GravadorAns {
    const est = tx.contexto.estabelecimento ?? 0;
    const envio = async (id: number) => {
      const e = await versaoDe(tx, 'envio_ans', id, 'O envio');
      if (num(e['estabelecimento_id']) !== est) throw inexistente('O envio');
      return e;
    };
    return {
      gerar: async (g) => {
        const r = await gerarEnvio(tx, est, g);
        if (g.arquivo) this.pedirArquivo(tx, r.id, g.arquivo);
        return r;
      },
      transmitir: async (a) => {
        const e = await envio(a.id);
        if (txt(e['situacao']) !== 'gerado')
          throw recusa('envio-transmitido', 'Só o envio gerado pode ser transmitido.');
        // O arquivo do protocolo da transmissão, quando houver, passa a ser o arquivo do envio.
        if (a.arquivo) this.pedirArquivo(tx, a.id, a.arquivo);
        const versao = await tx.alterar('envio_ans', a.id, a.versao, {
          situacao: 'enviado',
          enviado_em: new Date(),
          numero_recibo: a.recibo,
        });
        // Cada item pendente passa a enviado pela alteração auditada (versão, alterado_em/por, trilha).
        const pendentes = await tx.consultarParaAtualizar(
          "SELECT id, versao FROM envio_ans_item WHERE envio_ans_id = ? AND situacao = 'pendente' AND excluido_em IS NULL",
          [a.id],
        );
        for (const it of pendentes)
          await tx.alterar('envio_ans_item', num(it['id']), num(it['versao']), { situacao: 'enviado' });
        return { id: a.id, versao };
      },
      async retorno(a) {
        const e = await envio(a.id);
        if (txt(e['situacao']) !== 'enviado')
          throw recusa('envio-sem-transmissao', 'O retorno só vale para o envio transmitido.');
        if (a.situacao !== 'rejeitado' && !txtOuNulo(e['numero_recibo']))
          throw recusa('recibo-ausente', 'O envio aceito precisa do recibo da transmissão.');
        const versao = await tx.alterar('envio_ans', a.id, a.versao, { situacao: SITUACAO[a.situacao] });
        let seq = num(
          (
            await tx.uma('SELECT MAX(sequencia) AS s FROM envio_ans_retorno WHERE envio_ans_id = ?', [a.id])
          )?.['s'],
        );
        const agora = new Date();
        await tx.incluir('envio_ans_retorno', {
          envio_ans_id: a.id,
          sequencia: ++seq,
          tipo: 'resumo_processamento',
          recebido_em: agora,
          descricao: (a.resumo ?? a.texto).slice(0, 2000),
          quantidade_incluidos: a.itens.filter((i) => i.aceito).length,
          quantidade_com_erro: a.itens.filter((i) => !i.aceito).length,
        });
        for (const i of a.itens) {
          const item = await tx.uma(
            'SELECT id, versao, beneficiario_plano_id FROM envio_ans_item WHERE id = ? AND envio_ans_id = ?',
            [i.id, a.id],
          );
          if (!item) throw inexistente('O registro do envio');
          await tx.alterar('envio_ans_item', i.id, num(item['versao']), {
            situacao: i.aceito ? 'aceito' : 'rejeitado',
          });
          if (!i.aceito && i.erro)
            await tx.incluir('envio_ans_retorno', {
              envio_ans_id: a.id,
              sequencia: ++seq,
              envio_ans_item_id: i.id,
              tipo: 'critica_registro',
              recebido_em: agora,
              descricao: i.erro.slice(0, 2000),
            });
          const benef = numOuNulo(item['beneficiario_plano_id']);
          if (a.sib && i.aceito && i.cco && benef) {
            const b = await tx.uma('SELECT versao FROM beneficiario_plano WHERE id = ?', [benef]);
            if (b)
              await tx.alterar('beneficiario_plano', benef, num(b['versao']), { codigo_controle_ans: i.cco });
          }
          // O retrato aceito pela ANS: o registro deste envio, apontado no complemento do beneficiário.
          if (a.sib && i.aceito && benef) {
            const [k] = await tx.consultarParaAtualizar(
              'SELECT id, versao FROM complemento_sib_beneficiario WHERE beneficiario_plano_id = ? AND excluido_em IS NULL',
              [benef],
            );
            if (k)
              await tx.alterar('complemento_sib_beneficiario', num(k['id']), num(k['versao']), {
                aceito_envio_ans_id: a.id,
                aceito_em: agora,
              });
            else
              await tx.incluir('complemento_sib_beneficiario', {
                beneficiario_plano_id: benef,
                aceito_envio_ans_id: a.id,
                aceito_em: agora,
              });
          }
        }
        return { id: a.id, versao };
      },
      pagar: (a) => pagarGru(tx, est, a),
      decidir: (a) => decidirAtendimento(tx, est, a),
      complemento: (x) => gravarComplementoSib(tx, est, x),
    };
  }
}

/** O complemento do SIB do beneficiário do estabelecimento (null: beneficiário de fora; versão 0: sem complemento). */
async function lerComplementoSib(
  l: Leitor,
  est: number,
  beneficiario: number,
): Promise<DadosComplementoSib | null> {
  const b = await l.uma(
    `SELECT b.id, b.codigo_controle_ans, b.cobertura_parcial_temporaria,
            k.versao AS versao_complemento, k.declaracao_nascido_vivo, k.reside_exterior, k.itens_excluidos_cobertura,
            k.aceito_envio_ans_id, k.aceito_em, mm.codigo_ans AS motivo
       FROM beneficiario_plano b
       JOIN contrato_plano kp ON kp.id = b.contrato_plano_id
       LEFT JOIN complemento_sib_beneficiario k ON k.beneficiario_plano_id = b.id AND k.excluido_em IS NULL
       LEFT JOIN motivo_movimento_cadastral mm ON mm.id = k.motivo_movimento_cadastral_id
      WHERE b.id = ? AND kp.estabelecimento_id = ? AND b.excluido_em IS NULL`,
    [beneficiario, est],
  );
  if (!b) return null;
  const e = await l.uma(SELECT_ENDERECO_BENEFICIARIO, [beneficiario]);
  const envio = numOuNulo(b['aceito_envio_ans_id']);
  const registro = envio
    ? await l.uma(
        `SELECT dados FROM envio_ans_item
          WHERE envio_ans_id = ? AND beneficiario_plano_id = ? AND situacao = 'aceito' AND excluido_em IS NULL
          ORDER BY sequencia DESC LIMIT 1`,
        [envio, beneficiario],
      )
    : null;
  const retrato = registro ? lerDados(registro['dados'])['dados'] : null;
  const motivo = txtOuNulo(b['motivo']);
  return {
    beneficiario,
    versao: num(b['versao_complemento']),
    logradouro: txtOuNulo(e?.['logradouro']),
    numero: txtOuNulo(e?.['numero']),
    complemento: txtOuNulo(e?.['complemento']),
    bairro: txtOuNulo(e?.['bairro']),
    municipio: numOuNulo(e?.['codigo_ibge']),
    cep: txtOuNulo(e?.['cep']),
    resideExterior: bool(b['reside_exterior']),
    dnv: txtOuNulo(b['declaracao_nascido_vivo']),
    coberturaParcial: bool(b['cobertura_parcial_temporaria']),
    itensExcluidos: bool(b['itens_excluidos_cobertura']),
    cco: txtOuNulo(b['codigo_controle_ans']),
    motivoCancelamento: motivo && /^\d+$/.test(motivo) ? Number(motivo) : null,
    aceito:
      retrato === null || retrato === undefined
        ? null
        : typeof retrato === 'string'
          ? retrato
          : JSON.stringify(retrato),
    aceitoEm: instante(b['aceito_em']),
  };
}

/**
 * Grava o complemento do SIB sobre a versão vista (0: ainda sem complemento), o CCO e a cobertura parcial temporária
 * no beneficiário. O endereço é o do cadastro da pessoa: diferente dele, recusa (o cadastro é a fonte única).
 */
async function gravarComplementoSib(
  tx: TxOperacao,
  est: number,
  x: Omit<EntradaComplementoSib, 'hospital'>,
): Promise<{ id: number; versao: number }> {
  const atual = await lerComplementoSib(tx as Leitor, est, x.beneficiario);
  if (!atual) throw inexistente('O beneficiário');
  const mesmo = (a: unknown, b: unknown) => textoOuNulo(a) === textoOuNulo(b);
  const enderecoInformado = [x.logradouro, x.numero, x.complemento, x.bairro, x.cep, x.municipio].some(
    (v) => v !== null && v !== '',
  );
  if (
    enderecoInformado &&
    !(
      mesmo(x.logradouro, atual.logradouro) &&
      mesmo(x.numero, atual.numero) &&
      mesmo(x.complemento, atual.complemento) &&
      mesmo(x.bairro, atual.bairro) &&
      mesmo(x.cep, atual.cep) &&
      (x.municipio ?? null) === atual.municipio
    )
  )
    throw recusa(
      'endereco-do-cadastro',
      'O endereço do beneficiário é o do cadastro da pessoa: altere-o no cadastro e volte ao complemento.',
      { campos: ['logradouro'] },
    );
  let motivo: number | null = null;
  if (x.motivoCancelamento !== null) {
    const m = await tx.uma(
      'SELECT id FROM motivo_movimento_cadastral WHERE codigo_ans = ? AND excluido_em IS NULL LIMIT 1',
      [String(x.motivoCancelamento)],
    );
    if (!m)
      throw recusa(
        'dominio-nao-cadastrado',
        'O cadastro de motivos de movimentação não tem o código informado.',
        {
          campos: ['motivoCancelamento'],
        },
      );
    motivo = num(m['id']);
  }
  const b = await versaoDe(tx, 'beneficiario_plano', x.beneficiario, 'O beneficiário');
  const op = await tx.uma('SELECT operadora_saude_id FROM contrato_plano WHERE id = ?', [
    num(b['contrato_plano_id']),
  ]);
  if (x.cco !== null) {
    const outro = await tx.uma(
      `SELECT b.id FROM beneficiario_plano b JOIN contrato_plano k ON k.id = b.contrato_plano_id
        WHERE b.codigo_controle_ans = ? AND b.id <> ? AND k.operadora_saude_id = ? AND b.excluido_em IS NULL LIMIT 1`,
      [x.cco, x.beneficiario, num(op?.['operadora_saude_id'])],
    );
    if (outro)
      throw recusa('cco-em-uso', 'Este CCO já é de outro beneficiário da operadora.', { campos: ['cco'] });
  }
  if (
    txtOuNulo(b['codigo_controle_ans']) !== x.cco ||
    bool(b['cobertura_parcial_temporaria']) !== x.coberturaParcial
  )
    await tx.alterar('beneficiario_plano', x.beneficiario, num(b['versao']), {
      codigo_controle_ans: x.cco,
      cobertura_parcial_temporaria: x.coberturaParcial,
    });
  const campos = {
    declaracao_nascido_vivo: x.dnv,
    reside_exterior: x.resideExterior,
    itens_excluidos_cobertura: x.itensExcluidos,
    motivo_movimento_cadastral_id: motivo,
  };
  const [k] = await tx.consultarParaAtualizar(
    'SELECT id, versao FROM complemento_sib_beneficiario WHERE beneficiario_plano_id = ? AND excluido_em IS NULL',
    [x.beneficiario],
  );
  if ((k ? num(k['versao']) : 0) !== x.versao)
    throw recusa('envio-desatualizado', 'O complemento mudou depois que você abriu. Abra de novo e confira.');
  if (!k) {
    await tx.incluir('complemento_sib_beneficiario', { beneficiario_plano_id: x.beneficiario, ...campos });
    return { id: x.beneficiario, versao: 1 };
  }
  const versao = await tx.alterar('complemento_sib_beneficiario', num(k['id']), x.versao, campos);
  return { id: x.beneficiario, versao };
}

function lerDados(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  if (typeof v === 'object') return v as Record<string, unknown>;
  try {
    const d = JSON.parse(String(v)) as unknown;
    return d && typeof d === 'object' ? (d as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function gerarEnvio(
  tx: TxOperacao,
  est: number,
  g: Omit<EntradaGeracaoEnvio, 'hospital'>,
): Promise<{ id: number; versao: number }> {
  await exigirOperadora(tx as Leitor, est, g.operadora);
  const obrigacao = OBRIGACAO[g.obrigacao as DadosObrigacao];
  if (!obrigacao) throw recusa('obrigacao-invalida', 'Obrigação inválida.', { campos: ['obrigacao'] });
  const per = periodoDaCompetencia(g.competencia);
  const substituidos: number[] = [];
  for (const id of g.substituir) {
    const s = await versaoDe(tx, 'envio_ans', id, 'O envio substituído');
    if (num(s['estabelecimento_id']) !== est || num(s['operadora_saude_id']) !== g.operadora)
      throw inexistente('O envio substituído');
    await tx.alterar('envio_ans', id, num(s['versao']), { situacao: 'substituido' });
    substituidos.push(id);
  }
  if (g.retificador && substituidos.length === 0)
    throw recusa('retificador-sem-original', 'O retificador precisa do envio que ele substitui.');
  const ultimo = await tx.consultarParaAtualizar(
    'SELECT MAX(numero_sequencial) AS n FROM envio_ans WHERE operadora_saude_id = ? AND obrigacao = ?',
    [g.operadora, obrigacao],
  );
  // O aviso do ressarcimento ao SUS: a cobrança (ofício, prazo da impugnação), ligada ao envio desde a geração.
  let cobranca: number | null = null;
  if (obrigacao === 'ressarcimento_sus' && g.aviso) {
    cobranca = await tx.incluir('cobranca_ressarcimento_sus', {
      estabelecimento_id: est,
      operadora_saude_id: g.operadora,
      numero_oficio: caber(g.aviso.numero, 30, 'aviso'),
      oficio_em: g.aviso.recebidoEm,
      valor_oficio: Math.round(g.itens.reduce((t, i) => t + (i.valor ?? 0), 0) * 100) / 100,
      competencia_inicio: per.competencia ?? per.inicio,
      competencia_fim: per.competencia ?? per.inicio,
      prazo_impugnacao: g.aviso.prazo,
      situacao: 'notificada',
    });
  }
  const id = await tx.incluir('envio_ans', {
    estabelecimento_id: est,
    operadora_saude_id: g.operadora,
    obrigacao,
    cobranca_ressarcimento_sus_id: cobranca,
    numero_sequencial: num(ultimo[0]?.['n']) + 1,
    tipo_envio: g.retificador ? 'retificador' : 'original',
    substituido_envio_ans_id: g.retificador ? substituidos[0] : null,
    periodo_inicio: per.inicio,
    periodo_fim: per.fim,
    competencia: per.competencia,
    ano: per.ano,
    trimestre: per.trimestre,
    versao_leiaute: g.leiaute.slice(0, 20),
    periodo_fechado: true,
    sem_movimento: g.itens.length === 0,
    situacao: 'gerado',
    gerado_em: new Date(),
    gerado_por_usuario_id: tx.contexto.usuario,
  });
  // Um atendimento do aviso por item, ligado ao item do envio.
  const atendimentos = new Map<number, number>();
  if (cobranca !== null) {
    for (const i of g.itens) {
      const d = lerJson(i.dados);
      const inicio = typeof d['inicio'] === 'string' && d['inicio'] ? d['inicio'].slice(0, 10) : null;
      if (!inicio)
        throw recusa(
          'atendimento-sem-data',
          `O atendimento ${i.referencia} do aviso não tem a data de início.`,
        );
      const fim = typeof d['fim'] === 'string' && d['fim'] ? d['fim'].slice(0, 10) : null;
      atendimentos.set(
        i.ordem,
        await tx.incluir('ressarcimento_sus_atendimento', {
          cobranca_ressarcimento_sus_id: cobranca,
          sequencia: i.ordem,
          beneficiario_plano_id: i.beneficiario,
          tipo_atendimento: i.tipo === 'APAC' ? 'ambulatorial' : 'internacao',
          numero_atendimento: caber(i.referencia, 20, 'itens'),
          competencia: `${inicio.slice(0, 7)}-01`,
          data_inicio: inicio,
          data_fim: fim,
          valor_procedimento: i.valor,
          valor_total: i.valor ?? 0,
          situacao_validacao: 'pendente',
        }),
      );
    }
  }
  for (const i of g.itens)
    await tx.incluir('envio_ans_item', {
      ressarcimento_sus_atendimento_id: atendimentos.get(i.ordem) ?? null,
      envio_ans_id: id,
      sequencia: i.ordem,
      tipo_registro: TIPO_REGISTRO[i.tipo] ?? 'quadro_contabil',
      operacao: 'informacao',
      beneficiario_plano_id: i.beneficiario,
      valor: i.valor,
      dados: JSON.stringify({
        tipo: i.tipo,
        referencia: i.referencia,
        descricao: i.descricao,
        dados: i.dados,
        sugestao: i.sugestao ?? null,
        decisao: i.decisao ?? null,
      }),
      situacao: 'pendente',
    });
  return { id, versao: 1 };
}

/** O texto no tamanho da coluna (nunca cortado: o maior recusa com o campo). */
function caber(v: string, max: number, campo: string): string {
  const t = v.trim();
  if (t.length > max) throw recusa('texto-longo', `O campo passa de ${max} caracteres.`, { campos: [campo] });
  return t;
}

/** O texto JSON guardado (objeto vazio quando não é JSON). */
function lerJson(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  if (typeof v === 'object') return v as Record<string, unknown>;
  try {
    const o: unknown = JSON.parse(String(v));
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** O envio do estabelecimento, travado, na versão vista pela tela, com a cobrança do ressarcimento. */
async function envioDoRessarcimento(tx: TxOperacao, est: number, id: number, versao: number): Promise<Linha> {
  const e = await versaoDe(tx, 'envio_ans', id, 'O envio');
  if (num(e['estabelecimento_id']) !== est) throw inexistente('O envio');
  if (num(e['versao']) !== versao)
    throw recusa('conflito-versao', 'O envio mudou depois que você abriu: abra de novo.');
  return e;
}

/**
 * O pagamento da GRU: no ressarcimento ao SUS, a cobrança do aviso guarda a GRU, o valor e a data do pagamento (paga);
 * na TPS, o próprio envio da obrigação guarda a GRU e o pagamento (uma vez só).
 */
async function pagarGru(
  tx: TxOperacao,
  est: number,
  a: { id: number; versao: number; gru: string; valor: number; data: string },
): Promise<{ id: number; versao: number }> {
  const e = await envioDoRessarcimento(tx, est, a.id, a.versao);
  if (txt(e['obrigacao']) === 'tps') {
    if (e['numero_gru'] !== null && e['numero_gru'] !== undefined)
      throw recusa('situacao-nao-permite', 'A GRU desta TPS já foi registrada.');
    const versao = await tx.alterar('envio_ans', a.id, a.versao, {
      numero_gru: caber(a.gru, 30, 'gru'),
      valor_gru: a.valor,
      gru_paga_em: a.data,
      valor_pago_gru: a.valor,
    });
    return { id: a.id, versao };
  }
  if (txt(e['obrigacao']) !== 'ressarcimento_sus')
    throw recusa('situacao-nao-permite', 'Só a TPS e o ressarcimento ao SUS têm GRU.');
  const cobranca = numOuNulo(e['cobranca_ressarcimento_sus_id']);
  if (cobranca === null)
    throw recusa('aviso-sem-cobranca', 'O envio do ressarcimento não tem o aviso registrado.');
  const cr = await versaoDe(tx, 'cobranca_ressarcimento_sus', cobranca, 'A cobrança do ressarcimento');
  if (cr['numero_gru'] !== null && cr['numero_gru'] !== undefined)
    throw recusa('situacao-nao-permite', 'A GRU deste aviso já foi registrada.');
  await tx.alterar('cobranca_ressarcimento_sus', cobranca, num(cr['versao']), {
    numero_gru: caber(a.gru, 30, 'gru'),
    valor_gru: a.valor,
    pago_em: a.data,
    valor_pago: a.valor,
    situacao: 'paga',
  });
  const versao = await tx.alterar('envio_ans', a.id, a.versao, { situacao: txt(e['situacao']) });
  return { id: a.id, versao };
}

/**
 * A decisão de um atendimento do aviso: impugnar abre a impugnação (em elaboração, com o motivo e o valor) e marca o
 * atendimento impugnado; aceitar marca o atendimento devido e desiste da impugnação aberta. A decisão, o motivo, a
 * justificativa, quando e quem ficam no item do envio.
 */
async function decidirAtendimento(
  tx: TxOperacao,
  est: number,
  a: {
    id: number;
    versao: number;
    item: number;
    decisao: 'impugnar' | 'aceitar';
    motivo: string | null;
    justificativa: string | null;
    usuario: string;
  },
): Promise<{ id: number; versao: number }> {
  const e = await envioDoRessarcimento(tx, est, a.id, a.versao);
  if (txt(e['obrigacao']) !== 'ressarcimento_sus' || txt(e['situacao']) !== 'gerado')
    throw recusa('situacao-nao-permite', 'Só o aviso do ressarcimento ainda não enviado recebe a decisão.');
  const [it] = await tx.consultarParaAtualizar<Linha>(
    'SELECT id, versao, dados, ressarcimento_sus_atendimento_id FROM envio_ans_item WHERE id = ? AND envio_ans_id = ? AND excluido_em IS NULL',
    [a.item, a.id],
  );
  if (!it) throw recusa('item-de-outro-envio', 'O atendimento não está neste aviso.');
  const d = lerJson(it['dados']);
  if (d['decisao'] === null || d['decisao'] === undefined)
    throw recusa('item-de-outro-envio', 'O atendimento não está neste aviso.');
  const impugnar = a.decisao === 'impugnar';
  if (impugnar && !a.motivo)
    throw recusa('motivo-obrigatorio', 'Escolha o motivo da impugnação.', { campos: ['motivo'] });
  const agora = new Date();
  await tx.alterar('envio_ans_item', num(it['id']), num(it['versao']), {
    dados: JSON.stringify({
      ...d,
      decisao: a.decisao,
      motivo: impugnar ? a.motivo : null,
      justificativa: a.justificativa,
      decididoEm: agora.toISOString().slice(0, 19),
      decididoPor: a.usuario,
    }),
  });
  const atendimento = numOuNulo(it['ressarcimento_sus_atendimento_id']);
  if (atendimento !== null) {
    const at = await versaoDe(tx, 'ressarcimento_sus_atendimento', atendimento, 'O atendimento do aviso');
    await tx.alterar('ressarcimento_sus_atendimento', atendimento, num(at['versao']), {
      situacao_validacao: impugnar ? 'impugnado' : 'devido',
      validado_em: agora,
    });
    const abertas = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao FROM impugnacao_ressarcimento_sus
        WHERE ressarcimento_sus_atendimento_id = ? AND situacao = 'em_elaboracao' AND excluido_em IS NULL`,
      [atendimento],
    );
    for (const x of abertas)
      await tx.alterar('impugnacao_ressarcimento_sus', num(x['id']), num(x['versao']), {
        situacao: 'desistida',
      });
    if (impugnar) {
      const prazo = await tx.uma('SELECT prazo_impugnacao FROM cobranca_ressarcimento_sus WHERE id = ?', [
        num(e['cobranca_ressarcimento_sus_id']),
      ]);
      const seq = await tx.uma(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM impugnacao_ressarcimento_sus WHERE ressarcimento_sus_atendimento_id = ?',
        [atendimento],
      );
      await tx.incluir('impugnacao_ressarcimento_sus', {
        ressarcimento_sus_atendimento_id: atendimento,
        sequencia: num(seq?.['s']) || 1,
        instancia: 'impugnacao',
        natureza_motivo: NATUREZA_MOTIVO[a.motivo ?? ''] ?? 'administrativo',
        // O código oficial do motivo na ANS fica vazio: o motivo é o da tela, pela descrição do contrato.
        codigo_motivo: null,
        motivo:
          MOTIVOS_IMPUGNACAO_SUS[a.motivo as MotivoImpugnacaoSus] ?? caber(String(a.motivo), 500, 'motivo'),
        fundamentacao: a.justificativa,
        prazo_final: data(prazo?.['prazo_impugnacao']),
        valor_impugnado: num(at['valor_total']),
        situacao: 'em_elaboracao',
        responsavel_usuario_id: tx.contexto.usuario,
      });
    }
  }
  const versao = await tx.alterar('envio_ans', a.id, a.versao, { situacao: 'gerado' });
  return { id: a.id, versao };
}
