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
// Pendente (pedido ao orquestrador, ver a saída do lote): arquivo do envio (armazenamento de arquivos), GRU e decisão do
// ressarcimento (o aviso do ressarcimento ainda não liga o envio à cobrança), pendências do SIB, bases do SIP, das
// contraprestações do DIOPS, do monitoramento e do ressarcimento respondem 501 `modelo-pendente`.
import { type Leitor, type Linha, recusa, type TxOperacao } from '@sgh/nucleo';
import type { ContextoAns, GravadorAns, PortaAnsOperadora } from './ans-porta.js';
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
] as const;

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
  if (e['competencia'] !== null && e['competencia'] !== undefined) return (data(e['competencia']) ?? '').slice(0, 7);
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
         a.nome_original AS arquivo_nome, a.tamanho_bytes AS arquivo_bytes, a.hash_sha256 AS arquivo_hash
    FROM envio_ans e
    JOIN operadora_saude o ON o.id = e.operadora_saude_id
    LEFT JOIN usuario u ON u.id = COALESCE(e.gerado_por_usuario_id, e.criado_por)
    LEFT JOIN arquivo a ON a.id = e.arquivo_id`;

export class PortaAnsOperadoraPropria extends BasePortaOperadoraPropria<GravadorAns> implements PortaAnsOperadora {
  constructor(
    nucleo: NucleoOperadora,
    cliente: string,
    private readonly f1: Pick<PortaOperadora, 'gruposSip'>,
    /** O destino dos envios deste ambiente (o do serviço: simulador fora de produção). */
    private readonly destinoEnvios: 'simulador' | 'ans',
  ) {
    super(nucleo, cliente, 'operadora.ans', TABELAS_ANS);
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
      aviso: null,
      recebidoEm: null,
      prazo: null,
      gru: null,
      pagoEm: null,
      valorPago: null,
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
    const grupo = (t: string) => (t.startsWith('inclus') ? 1 : t.startsWith('exclus') || t.startsWith('cancel') ? 3 : 2);
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

  async valoresTps(c: ContextoAns): Promise<{ vigencia: string; valorAnual: number; valorTrimestral: number }[]> {
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

  envios(c: ContextoAns, f: FiltroEnviosPorta): Promise<{ itens: DadosEnvioAnsResumo[]; proxima: number | null }> {
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
      const linhas = await l.consultar(`${SELECT_ENVIO} WHERE ${cond.join(' AND ')} ORDER BY e.id DESC LIMIT ${limite + 1}`, p);
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
      const e = await l.uma(`${SELECT_ENVIO} WHERE e.id = ? AND e.estabelecimento_id = ? AND e.excluido_em IS NULL`, [
        id,
        c.estabelecimento ?? 0,
      ]);
      return e ? this.envioDe(e) : null;
    });
  }

  async arquivo(): Promise<{ nome: string; base64: string; sha256: string } | null> {
    return pendente('Arquivo do envio à ANS (armazenamento de arquivos)');
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
          motivo: null,
          justificativa: null,
          decididoEm: null,
          decididoPor: null,
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

  async beneficiariosSib(): Promise<never> {
    return pendente('Pendências do SIB (complemento cadastral do beneficiário)');
  }

  complementoSib(c: ContextoAns, beneficiario: number): Promise<DadosComplementoSib | null> {
    return this.ler(c, (l) => lerComplementoSib(l, c.estabelecimento ?? 0, beneficiario));
  }

  beneficiarioDaOperadora(c: ContextoAns, beneficiario: number): Promise<DadosBeneficiarioDaOperadora | null> {
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

  planos(c: ContextoAns, operadora: number): Promise<{ produto: number; nome: string; registroAns: string | null }[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT DISTINCT p.id, p.nome, p.numero_registro_ans
             FROM produto_plano p JOIN contrato_plano k ON k.produto_plano_id = p.id
            WHERE k.operadora_saude_id = ? AND k.estabelecimento_id = ? AND p.excluido_em IS NULL
            ORDER BY p.nome`,
          [operadora, c.estabelecimento ?? 0],
        )
      ).map((p) => ({ produto: num(p['id']), nome: txt(p['nome']), registroAns: txtOuNulo(p['numero_registro_ans']) })),
    );
  }

  async itensSip(): Promise<never> {
    return pendente('Base do SIP (eventos assistenciais por grupo)');
  }

  async vigenciasSip(): Promise<never> {
    return pendente('Vigência dos procedimentos no SIP');
  }

  async cobrancasDiops(): Promise<never> {
    return pendente('Base do DIOPS (contraprestações)');
  }

  contasDiops(
    c: ContextoAns,
    operadora: number,
    inicio: string,
    fim: string,
  ): Promise<{
    contas: { recebidaEm: string; apresentado: number; glosado: number; situacao: 'recebida' | 'analisada' | 'paga' | 'devolvida' }[];
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

  async guiasMonitoramento(): Promise<never> {
    return pendente('Base do monitoramento TISS');
  }

  async beneficiariosRessarcimento(): Promise<never> {
    return pendente('Identificação dos beneficiários do ressarcimento ao SUS');
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
      gerar: (g) => gerarEnvio(tx, est, g),
      async transmitir(a) {
        const e = await envio(a.id);
        if (txt(e['situacao']) !== 'gerado') throw recusa('envio-transmitido', 'Só o envio gerado pode ser transmitido.');
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
        let seq = num((await tx.uma('SELECT MAX(sequencia) AS s FROM envio_ans_retorno WHERE envio_ans_id = ?', [a.id]))?.['s']);
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
          await tx.alterar('envio_ans_item', i.id, num(item['versao']), { situacao: i.aceito ? 'aceito' : 'rejeitado' });
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
            if (b) await tx.alterar('beneficiario_plano', benef, num(b['versao']), { codigo_controle_ans: i.cco });
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
      pagar: () => pendente('Pagamento da GRU'),
      decidir: () => pendente('Decisão do atendimento do ressarcimento ao SUS'),
      complemento: (x) => gravarComplementoSib(tx, est, x),
    };
  }
}

/** O complemento do SIB do beneficiário do estabelecimento (null: beneficiário de fora; versão 0: sem complemento). */
async function lerComplementoSib(l: Leitor, est: number, beneficiario: number): Promise<DadosComplementoSib | null> {
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
    aceito: retrato === null || retrato === undefined ? null : typeof retrato === 'string' ? retrato : JSON.stringify(retrato),
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
      throw recusa('dominio-nao-cadastrado', 'O cadastro de motivos de movimentação não tem o código informado.', {
        campos: ['motivoCancelamento'],
      });
    motivo = num(m['id']);
  }
  const b = await versaoDe(tx, 'beneficiario_plano', x.beneficiario, 'O beneficiário');
  const op = await tx.uma('SELECT operadora_saude_id FROM contrato_plano WHERE id = ?', [num(b['contrato_plano_id'])]);
  if (x.cco !== null) {
    const outro = await tx.uma(
      `SELECT b.id FROM beneficiario_plano b JOIN contrato_plano k ON k.id = b.contrato_plano_id
        WHERE b.codigo_controle_ans = ? AND b.id <> ? AND k.operadora_saude_id = ? AND b.excluido_em IS NULL LIMIT 1`,
      [x.cco, x.beneficiario, num(op?.['operadora_saude_id'])],
    );
    if (outro) throw recusa('cco-em-uso', 'Este CCO já é de outro beneficiário da operadora.', { campos: ['cco'] });
  }
  if (txtOuNulo(b['codigo_controle_ans']) !== x.cco || bool(b['cobertura_parcial_temporaria']) !== x.coberturaParcial)
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
  const id = await tx.incluir('envio_ans', {
    estabelecimento_id: est,
    operadora_saude_id: g.operadora,
    obrigacao,
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
  for (const i of g.itens)
    await tx.incluir('envio_ans_item', {
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
