// Porta própria do faturamento SUS, família da AIH pela tela (modulos-proprios-2): o ciclo da AIH (laudo, autorização,
// fechamento, reabertura, cancelamento) e a apresentação no arquivo SISAIH (remessa_sisaih), sobre o banco do cliente.
// Modelo (ver 13_SUS/22 e 93_aih_tela): a autorização (autorizacao_internacao_sus) é a raiz — o laudo (procedimento
// solicitado, CID, caráter, solicitante, data e justificativa), o número da faixa, o CNS do autorizador e a negativa ou
// o cancelamento; cada fechamento é uma conta da AIH (conta_aih, numero_fechamento 1, 2, ...), com os itens em
// conta_aih_procedimento (principal, secundário, especial, diária de UTI) e conta_aih_opm (OPM com nota, Anvisa, série
// e lote). A reabertura não apaga nada: a conta fechada passa a "reaberta" com o motivo, e o fechamento seguinte é uma
// conta nova que aponta a anterior (a história fica). A apresentação marca a conta com a competência e a remessa.
// A situação da tela é derivada: a da autorização enquanto não há conta (solicitada, autorizada, negada, cancelada) e,
// depois, a da última conta ("reaberta" volta a "autorizada"). A trava otimista é a versão da autorização: toda
// gravação da AIH, mesmo só na conta, sobe a versão dela (uma versão para a tela, como na porta em memória).
// O "registro" da tela é o id da internação; o prontuário é o número do prontuário do paciente; o solicitante é o CPF
// do profissional da casa ou do solicitante externo (o banco guarda a chave, nunca o CPF de novo).
import { type Escritor, type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import type { SolicitanteAihLido } from './porta-aih.js';
import { gravarRemessa } from './porta-propria-arquivos.js';
import {
  type AihRegistro,
  ErroAih,
  type FiltroAihsPorta,
  type ItemAih,
  type ItemAihParaGravar,
  type NovoArquivoSus,
  type SituacaoAih,
} from './tipos.js';

/** As tabelas que a gravação da AIH escreve, além das de TABELAS_SUS (a transação recusa as outras). */
export const TABELAS_SUS_AIH = [
  'autorizacao_internacao_sus',
  'conta_aih',
  'conta_aih_procedimento',
  'conta_aih_opm',
] as const;

type Linha = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v));
const numOuNulo = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const txtOuNulo = (v: unknown): string | null => {
  const t = txt(v).trim();
  return t === '' ? null : t;
};
const instante = (col: string) => `DATE_FORMAT(${col}, '%Y-%m-%dT%H:%i:%s.%fZ')`;
const dia = (col: string) => `DATE_FORMAT(${col}, '%Y-%m-%d')`;
const login = (col: string) => `(SELECT u.login FROM usuario u WHERE u.id = ${col})`;
const soDigitos = (v: string) => v.replace(/\D/g, '');

/** A última conta (fechamento) de cada autorização. */
const ULTIMA_CONTA = `c.autorizacao_internacao_sus_id = a.id AND c.excluido_em IS NULL
   AND c.numero_fechamento = (SELECT MAX(c2.numero_fechamento) FROM conta_aih c2
                               WHERE c2.autorizacao_internacao_sus_id = a.id AND c2.excluido_em IS NULL)`;

/** A situação da tela derivada da autorização e da última conta (SQL, para filtrar e contar). */
const SITUACAO_SQL = `CASE
    WHEN a.situacao IN ('negada','cancelada','solicitada') THEN a.situacao
    WHEN a.situacao = 'devolvida' THEN 'negada'
    WHEN c.id IS NULL OR c.situacao = 'reaberta' THEN 'autorizada'
    ELSE c.situacao END`;

const SQL_AIH = `
  SELECT a.id, ${SITUACAO_SQL} AS situacao_tela, a.situacao AS situacao_autorizacao, a.internacao_id,
         p.numero_prontuario, a.conta_hospitalar_id, a.atendimento_id,
         ps.codigo_sigtap AS procedimento_solicitado, pr.codigo_sigtap AS procedimento_realizado,
         a.codigo_cid10_principal, a.codigo_cid10_secundario, COALESCE(d.codigo_oficial, d.codigo) AS carater,
         COALESCE(pf.cpf, se.cpf) AS solicitante, ${dia('a.data_solicitacao')} AS data_laudo, a.justificativa_laudo,
         a.faixa_numeracao_aih_id, a.numero_aih, a.cns_autorizador, ${dia('a.data_autorizacao')} AS data_autorizacao,
         a.motivo_situacao AS motivo_autorizacao, c.id AS conta_aih_id, c.numero_fechamento, c.situacao AS situacao_conta,
         c.motivo_situacao AS motivo_conta, c.dias_permanencia, c.diarias_uti, c.diarias_uti_mes_anterior,
         CAST(cs.competencia AS CHAR) AS competencia_apresentacao, r.numero AS numero_arquivo,
         (SELECT COUNT(*) FROM conta_aih c3 WHERE c3.autorizacao_internacao_sus_id = a.id AND c3.excluido_em IS NULL
             AND c3.remessa_sisaih_id IS NOT NULL AND c3.numero_fechamento < c.numero_fechamento) AS reapresentacoes,
         ${login('a.criado_por')} AS registrada_por, ${instante('a.criado_em')} AS registrada_em,
         ${login('a.alterado_por')} AS alterada_por, ${instante('a.alterado_em')} AS alterada_em, a.versao
    FROM autorizacao_internacao_sus a
    LEFT JOIN conta_aih c ON ${ULTIMA_CONTA}
    LEFT JOIN paciente p ON p.id = a.paciente_id
    LEFT JOIN procedimento_sigtap ps ON ps.id = a.solicitado_procedimento_sigtap_id
    LEFT JOIN procedimento_sigtap pr ON pr.id = c.realizado_procedimento_sigtap_id
    LEFT JOIN dominio_sus d ON d.id = a.carater_dominio_sus_id
    LEFT JOIN profissional pp ON pp.id = a.solicitante_profissional_id
    LEFT JOIN pessoa_fisica pf ON pf.id = pp.pessoa_fisica_id
    LEFT JOIN solicitante_externo se ON se.id = a.solicitante_externo_id
    LEFT JOIN competencia_sus cs ON cs.id = c.competencia_sus_id
    LEFT JOIN remessa_sisaih r ON r.id = c.remessa_sisaih_id
   WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL`;

const SITUACOES: readonly SituacaoAih[] = [
  'solicitada',
  'autorizada',
  'negada',
  'fechada',
  'apresentada',
  'aprovada',
  'rejeitada',
  'cancelada',
];

function situacaoDaLinha(v: unknown): SituacaoAih {
  const s = txt(v) as SituacaoAih;
  if (!SITUACOES.includes(s)) throw new Error(`Situação de AIH desconhecida no banco: ${txt(v).slice(0, 30)}.`);
  return s;
}

/** A AIH da tela a partir da linha de SQL_AIH. */
export function aihDaLinha(x: Linha): AihRegistro {
  const situacao = situacaoDaLinha(x['situacao_tela']);
  const temConta = x['conta_aih_id'] !== null && x['conta_aih_id'] !== undefined;
  const sitConta = txt(x['situacao_conta']);
  // A justificativa da situação: a da última conta reaberta ou cancelada; senão, a da autorização negada ou cancelada.
  const justificativaSituacao =
    temConta && (sitConta === 'reaberta' || sitConta === 'cancelada')
      ? txtOuNulo(x['motivo_conta'])
      : !temConta || txt(x['situacao_autorizacao']) === 'cancelada'
        ? txtOuNulo(x['motivo_autorizacao'])
        : null;
  const arquivo = txtOuNulo(x['numero_arquivo']);
  return {
    id: num(x['id']),
    situacao,
    registro: num(x['internacao_id']),
    prontuario: numOuNulo(x['numero_prontuario']),
    conta: numOuNulo(x['conta_hospitalar_id']),
    atendimento: numOuNulo(x['atendimento_id']),
    procedimentoSolicitado: txt(x['procedimento_solicitado']),
    procedimentoRealizado: temConta ? txtOuNulo(x['procedimento_realizado']) : null,
    cidPrincipal: txt(x['codigo_cid10_principal']),
    cidSecundario: txtOuNulo(x['codigo_cid10_secundario']),
    carater: txt(x['carater']),
    solicitante: txt(x['solicitante']),
    dataLaudo: txt(x['data_laudo']),
    justificativa: txt(x['justificativa_laudo']),
    faixa: numOuNulo(x['faixa_numeracao_aih_id']),
    numero: txtOuNulo(x['numero_aih']),
    cnsAutorizador: txtOuNulo(x['cns_autorizador']),
    dataAutorizacao: txtOuNulo(x['data_autorizacao']),
    fechamento: temConta ? num(x['numero_fechamento']) : 0,
    permanencia: temConta ? numOuNulo(x['dias_permanencia']) : null,
    diariasUti: temConta ? numOuNulo(x['diarias_uti']) : null,
    diariasUtiAnterior: temConta ? numOuNulo(x['diarias_uti_mes_anterior']) : null,
    competenciaApresentacao: temConta ? txtOuNulo(x['competencia_apresentacao']) : null,
    arquivo: arquivo && /^\d{1,15}$/.test(arquivo) ? Number(arquivo) : null,
    reapresentacoes: temConta ? num(x['reapresentacoes']) : 0,
    justificativaSituacao,
    registradaPor: txt(x['registrada_por']),
    registradaEm: txt(x['registrada_em']),
    alteradaPor: txtOuNulo(x['alterada_por']),
    alteradaEm: txtOuNulo(x['alterada_em']),
    versao: num(x['versao']),
  };
}

const marcadores = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/** As leituras da AIH sobre uma conexão (a somente leitura ou a da transação). */
export class LeiturasAihPropria {
  constructor(
    private readonly l: Leitor,
    private readonly est: number,
    private readonly travador: Escritor | null = null,
  ) {}

  async aih(id: number, travar?: boolean): Promise<AihRegistro | null> {
    if (travar && this.travador)
      await this.travador.consultarParaAtualizar(
        'SELECT id FROM autorizacao_internacao_sus WHERE id = ? AND estabelecimento_id = ?',
        [id, this.est],
      );
    const x = await this.l.uma(`${SQL_AIH} AND a.id = ?`, [this.est, id]);
    return x ? aihDaLinha(x) : null;
  }

  async aihPorNumero(numero: string): Promise<AihRegistro | null> {
    const x = await this.l.uma(`${SQL_AIH} AND a.numero_aih = ? ORDER BY a.id DESC LIMIT 1`, [this.est, numero]);
    return x ? aihDaLinha(x) : null;
  }

  /** As AIHs vivas das internações (sem as negadas e as canceladas). */
  async aihsDasInternacoes(registros: readonly number[]): Promise<AihRegistro[]> {
    const ids = registros.filter((r) => Number.isSafeInteger(r) && r > 0);
    if (ids.length === 0) return [];
    const ls = await this.l.consultar(
      `SELECT * FROM (${SQL_AIH} AND a.internacao_id IN (${marcadores(ids.length)})) t
        WHERE t.situacao_tela NOT IN ('negada','cancelada') ORDER BY t.id`,
      [this.est, ...ids],
      { teto: 5_000 },
    );
    return ls.map(aihDaLinha);
  }

  /** As fechadas e as já apresentadas nesta competência, pelo número. */
  async aihsParaApresentar(competencia: string): Promise<AihRegistro[]> {
    const ls = await this.l.consultar(
      `SELECT * FROM (${SQL_AIH}) t
        WHERE t.situacao_tela = 'fechada' OR (t.situacao_tela = 'apresentada' AND t.competencia_apresentacao = ?)
        ORDER BY t.numero_aih, t.id`,
      [this.est, competencia],
      { teto: 20_000 },
    );
    return ls.map(aihDaLinha);
  }

  async paginaAihs(
    f: FiltroAihsPorta,
  ): Promise<{ itens: AihRegistro[]; total: number; porSituacao: Record<string, number> }> {
    const conds: string[] = [];
    const ps: unknown[] = [];
    if (f.situacao) {
      conds.push('t.situacao_tela = ?');
      ps.push(f.situacao);
    }
    if (f.numero) {
      conds.push("t.numero_aih LIKE CONCAT(?, '%')");
      ps.push(f.numero.replace(/[%_\\]/g, ''));
    }
    if (f.prontuario) {
      conds.push('t.numero_prontuario = ?');
      ps.push(f.prontuario);
    }
    if (f.registro) {
      conds.push('t.internacao_id = ?');
      ps.push(f.registro);
    }
    const onde = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const base = `FROM (${SQL_AIH}) t ${onde}`;
    const porPagina = Math.max(1, Math.min(500, Math.trunc(f.porPagina)));
    const pagina = Math.max(0, Math.trunc(f.pagina));
    const itens = (
      await this.l.consultar(
        `SELECT t.* ${base} ORDER BY t.id DESC LIMIT ${porPagina} OFFSET ${pagina * porPagina}`,
        [this.est, ...ps],
        { teto: porPagina },
      )
    ).map(aihDaLinha);
    const total = num((await this.l.uma(`SELECT COUNT(*) AS n ${base}`, [this.est, ...ps]))?.['n']);
    // Como a porta em memória: a contagem por situação é do estabelecimento inteiro (sem o filtro).
    const porSituacao: Record<string, number> = {};
    for (const x of await this.l.consultar(
      `SELECT t.situacao_tela AS s, COUNT(*) AS n FROM (${SQL_AIH}) t GROUP BY t.situacao_tela`,
      [this.est],
      { teto: 20 },
    ))
      porSituacao[txt(x['s'])] = num(x['n']);
    return { itens, total, porSituacao };
  }

  /** Os itens de um fechamento, na ordem gravada (procedimentos e OPM numa só sequência). */
  async itensAih(id: number, fechamento: number): Promise<ItemAih[]> {
    const conta = await this.l.uma(
      `SELECT c.id FROM conta_aih c JOIN autorizacao_internacao_sus a ON a.id = c.autorizacao_internacao_sus_id
        WHERE a.id = ? AND a.estabelecimento_id = ? AND c.numero_fechamento = ? AND c.excluido_em IS NULL`,
      [id, this.est, fechamento],
    );
    if (!conta) return [];
    const cid = num(conta['id']);
    const procs = await this.l.consultar(
      `SELECT x.sequencia, x.tipo, s.codigo_sigtap, x.procedimento_sigtap_id, x.quantidade, o.codigo_cbo,
              x.conta_hospitalar_item_id, x.tipo_leito_uti
         FROM conta_aih_procedimento x JOIN procedimento_sigtap s ON s.id = x.procedimento_sigtap_id
         LEFT JOIN ocupacao_cbo o ON o.id = x.ocupacao_cbo_id
        WHERE x.conta_aih_id = ? AND x.excluido_em IS NULL`,
      [cid],
      { teto: 2_000 },
    );
    const opms = await this.l.consultar(
      `SELECT x.sequencia, s.codigo_sigtap, x.procedimento_sigtap_id, x.quantidade, x.conta_hospitalar_item_id,
              x.cnpj_fornecedor, x.numero_nota_fiscal, x.registro_anvisa, x.serie, x.lote
         FROM conta_aih_opm x JOIN procedimento_sigtap s ON s.id = x.procedimento_sigtap_id
        WHERE x.conta_aih_id = ? AND x.excluido_em IS NULL`,
      [cid],
      { teto: 2_000 },
    );
    const itens: ItemAih[] = [
      ...procs.map(
        (x): ItemAih => ({
          sequencia: num(x['sequencia']),
          tipo: txt(x['tipo']) === 'diaria_uti' ? 'diaria-uti' : (txt(x['tipo']) as ItemAih['tipo']),
          procedimento: txt(x['codigo_sigtap']),
          sigtap: num(x['procedimento_sigtap_id']),
          quantidade: num(x['quantidade']),
          cbo: txtOuNulo(x['codigo_cbo']),
          item: numOuNulo(x['conta_hospitalar_item_id']),
          tipoUti: numOuNulo(x['tipo_leito_uti']),
          opm: null,
        }),
      ),
      ...opms.map(
        (x): ItemAih => ({
          sequencia: num(x['sequencia']),
          tipo: 'opm',
          procedimento: txt(x['codigo_sigtap']),
          sigtap: num(x['procedimento_sigtap_id']),
          quantidade: num(x['quantidade']),
          cbo: null,
          item: numOuNulo(x['conta_hospitalar_item_id']),
          tipoUti: null,
          opm: {
            cnpjFornecedor: txt(x['cnpj_fornecedor']),
            notaFiscal: txt(x['numero_nota_fiscal']),
            registroAnvisa: txt(x['registro_anvisa']),
            serie: txt(x['serie']),
            lote: txt(x['lote']),
          },
        }),
      ),
    ];
    return itens.sort((a, b) => a.sequencia - b.sequencia);
  }

  /** O médico solicitante pelo CPF: o profissional da casa e, sem ele, o solicitante externo. */
  async solicitanteAih(cpf: string): Promise<SolicitanteAihLido | null> {
    const chave = await this.solicitantePorCpf(cpf);
    return chave?.lido ?? null;
  }

  async solicitantePorCpf(
    cpf: string,
  ): Promise<{ profissional: number | null; externo: number | null; lido: SolicitanteAihLido } | null> {
    const c = soDigitos(cpf).padStart(11, '0');
    if (!/^\d{11}$/.test(c)) return null;
    const p = await this.l.uma(
      `SELECT pp.id, pf.nome, pf.cns FROM profissional pp JOIN pessoa_fisica pf ON pf.id = pp.pessoa_fisica_id
        WHERE pf.cpf = ? AND pp.excluido_em IS NULL ORDER BY pp.id LIMIT 1`,
      [c],
    );
    if (p) return { profissional: num(p['id']), externo: null, lido: { cpf: c, nome: txt(p['nome']), cns: txtOuNulo(p['cns']) } };
    const e = await this.l.uma(
      'SELECT id, nome, cns FROM solicitante_externo WHERE cpf = ? AND excluido_em IS NULL ORDER BY id LIMIT 1',
      [c],
    );
    if (e) return { profissional: null, externo: num(e['id']), lido: { cpf: c, nome: txt(e['nome']), cns: txtOuNulo(e['cns']) } };
    return null;
  }
}

function versaoAlterada(): never {
  throw new ErroAih('versao-alterada', 'O registro mudou desde que a tela foi aberta.');
}

/** As gravações da AIH na transação da operação (mesma transação da trilha e do arquivo). */
export class GravacoesAihPropria {
  private readonly leituras: LeiturasAihPropria;

  constructor(
    private readonly tx: TxOperacao,
    private readonly est: number,
  ) {
    this.leituras = new LeiturasAihPropria(tx, est, tx);
  }

  /** Trava a autorização e confere a versão vista e a situação de origem da tela. */
  private async conferir(a: { id: number; versao: number }, de: readonly SituacaoAih[]): Promise<AihRegistro> {
    const x = await this.leituras.aih(a.id, true);
    if (!x || x.versao !== a.versao || !de.includes(x.situacao)) versaoAlterada();
    return x;
  }

  private async sigtapId(codigo: string): Promise<number | null> {
    const x = await this.tx.uma(
      'SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = ? AND excluido_em IS NULL ORDER BY id DESC LIMIT 1',
      [codigo.trim()],
    );
    return x ? num(x['id']) : null;
  }

  private async contaAtual(autorizacao: number): Promise<{ id: number; versao: number } | null> {
    const ls = await this.tx.consultarParaAtualizar(
      `SELECT id, versao FROM conta_aih WHERE autorizacao_internacao_sus_id = ? AND estabelecimento_id = ?
          AND excluido_em IS NULL ORDER BY numero_fechamento DESC LIMIT 1`,
      [autorizacao, this.est],
    );
    const x = ls[0];
    return x ? { id: num(x['id']), versao: num(x['versao']) } : null;
  }

  async inserirAih(p: {
    registro: number;
    prontuario: number | null;
    conta: number | null;
    atendimento: number | null;
    procedimentoSolicitado: string;
    cidPrincipal: string;
    cidSecundario: string | null;
    carater: string;
    solicitante: string;
    dataLaudo: string;
    justificativa: string;
    por: string;
  }): Promise<number> {
    const i = await this.tx.uma(
      'SELECT id, paciente_id, atendimento_id FROM internacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [p.registro, this.est],
    );
    if (!i) throw new ErroAih('nao-encontrado', 'A internação não foi encontrada neste estabelecimento.');
    let conta: number | null = null;
    if (p.conta !== null) {
      const c = await this.tx.uma(
        'SELECT id FROM conta_hospitalar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [p.conta, this.est],
      );
      if (!c) throw new ErroAih('nao-encontrado', 'A conta da internação não foi encontrada neste estabelecimento.');
      conta = num(c['id']);
    }
    const sigtap = await this.sigtapId(p.procedimentoSolicitado);
    if (!sigtap) throw recusa('procedimento-inexistente', 'O procedimento solicitado não existe na tabela unificada.');
    const sol = await this.leituras.solicitantePorCpf(p.solicitante);
    if (!sol) throw recusa('solicitante-inexistente', 'O médico solicitante não está no cadastro.');
    const carater = await this.tx.uma(
      `SELECT id FROM dominio_sus WHERE lista = 'carater_atendimento' AND ativo AND (codigo_oficial = ? OR codigo = ?)
        ORDER BY (codigo_oficial = ?) DESC, id LIMIT 1`,
      [p.carater, p.carater, p.carater],
    );
    return this.tx.incluir('autorizacao_internacao_sus', {
      estabelecimento_id: this.est,
      paciente_id: num(i['paciente_id']),
      atendimento_id: p.atendimento ?? numOuNulo(i['atendimento_id']),
      internacao_id: num(i['id']),
      conta_hospitalar_id: conta,
      data_solicitacao: p.dataLaudo,
      solicitado_procedimento_sigtap_id: sigtap,
      codigo_cid10_principal: p.cidPrincipal.replace('.', '').toUpperCase(),
      codigo_cid10_secundario: p.cidSecundario ? p.cidSecundario.replace('.', '').toUpperCase() : null,
      carater_dominio_sus_id: carater ? num(carater['id']) : null,
      solicitante_profissional_id: sol.profissional,
      solicitante_externo_id: sol.externo,
      justificativa_laudo: p.justificativa.slice(0, 2000),
      situacao: 'solicitada',
      origem: 'sistema',
    });
  }

  async autorizarAih(
    a: { id: number; versao: number },
    p: { faixa: number; numero: string; autorizador: string; dataAutorizacao: string; por: string },
  ): Promise<void> {
    await this.conferir(a, ['solicitada']);
    const f = await this.tx.uma(
      "SELECT id, orgao_emissor FROM faixa_numeracao_aih WHERE id = ? AND estabelecimento_id = ? AND instrumento = 'aih'",
      [p.faixa, this.est],
    );
    if (!f) throw new ErroAih('nao-encontrado', 'A faixa de numeração não foi encontrada.');
    const usado = await this.tx.uma(
      `SELECT (EXISTS (SELECT 1 FROM autorizacao_internacao_sus WHERE estabelecimento_id = ? AND numero_aih = ? AND id <> ?)
            OR EXISTS (SELECT 1 FROM conta_aih WHERE estabelecimento_id = ? AND numero_aih = ?
                          AND (autorizacao_internacao_sus_id IS NULL OR autorizacao_internacao_sus_id <> ?))) AS usado`,
      [this.est, p.numero, a.id, this.est, p.numero, a.id],
    );
    if (num(usado?.['usado']) === 1) throw new ErroAih('numero-em-uso', 'Este número de AIH já foi usado.');
    const cns = soDigitos(p.autorizador);
    await this.tx.alterar('autorizacao_internacao_sus', a.id, a.versao, {
      situacao: 'autorizada',
      faixa_numeracao_aih_id: p.faixa,
      numero_aih: p.numero,
      cns_autorizador: /^\d{15}$/.test(cns) ? cns : null,
      orgao_emissor: txtOuNulo(f['orgao_emissor']),
      data_autorizacao: p.dataAutorizacao,
      recebida_em: new Date(),
      recebida_por_usuario_id: this.tx.contexto.usuario,
      motivo_situacao: null,
    });
  }

  async negarAih(a: { id: number; versao: number }, justificativa: string): Promise<void> {
    await this.conferir(a, ['solicitada']);
    await this.tx.alterar('autorizacao_internacao_sus', a.id, a.versao, {
      situacao: 'negada',
      motivo_situacao: justificativa.slice(0, 500),
    });
  }

  async reabrirAih(a: { id: number; versao: number }, justificativa: string): Promise<void> {
    await this.conferir(a, ['fechada']);
    const c = await this.contaAtual(a.id);
    if (!c) versaoAlterada();
    await this.tx.alterar('conta_aih', c.id, c.versao, {
      situacao: 'reaberta',
      motivo_situacao: justificativa.slice(0, 500),
    });
    await this.tx.alterar('autorizacao_internacao_sus', a.id, a.versao, {});
  }

  async cancelarAih(a: { id: number; versao: number }, justificativa: string): Promise<void> {
    const x = await this.conferir(a, ['solicitada', 'autorizada', 'fechada']);
    const motivo = justificativa.slice(0, 500);
    if (x.situacao === 'fechada') {
      const c = await this.contaAtual(a.id);
      if (!c) versaoAlterada();
      await this.tx.alterar('conta_aih', c.id, c.versao, { situacao: 'cancelada', motivo_situacao: motivo });
    }
    await this.tx.alterar('autorizacao_internacao_sus', a.id, a.versao, {
      situacao: 'cancelada',
      motivo_situacao: motivo,
    });
  }

  async fecharAih(
    a: { id: number; versao: number; fechamento: number },
    p: {
      procedimentoRealizado: string;
      permanencia: number;
      diariasUti: number;
      diariasUtiAnterior: number;
      itens: readonly ItemAihParaGravar[];
      por: string;
    },
  ): Promise<void> {
    const x = await this.conferir(a, ['autorizada']);
    if (x.fechamento !== a.fechamento) versaoAlterada();
    const base = await this.tx.uma(
      `SELECT a.paciente_id, a.internacao_id, a.conta_hospitalar_id, a.carater_dominio_sus_id,
              a.solicitado_procedimento_sigtap_id, a.solicitante_profissional_id, a.autorizador_sus_id,
              ${dia('i.data_hora_entrada')} AS entrada, ${dia('i.data_hora_alta')} AS alta
         FROM autorizacao_internacao_sus a JOIN internacao i ON i.id = a.internacao_id
        WHERE a.id = ? AND a.estabelecimento_id = ?`,
      [a.id, this.est],
    );
    if (!base) throw new ErroAih('nao-encontrado', 'A internação da AIH não foi encontrada.');
    if (base['carater_dominio_sus_id'] === null || base['carater_dominio_sus_id'] === undefined)
      throw recusa('carater-inexistente', 'O caráter do atendimento da AIH não está no domínio do SUS do cliente.');
    const realizado = await this.sigtapId(p.procedimentoRealizado);
    if (!realizado) throw recusa('procedimento-inexistente', 'O procedimento realizado não existe na tabela unificada.');
    const anterior = await this.contaAtual(a.id);
    const conta = await this.tx.incluir('conta_aih', {
      estabelecimento_id: this.est,
      internacao_id: num(base['internacao_id']),
      paciente_id: num(base['paciente_id']),
      autorizacao_internacao_sus_id: a.id,
      conta_hospitalar_id: numOuNulo(base['conta_hospitalar_id']),
      numero_aih: x.numero,
      anterior_conta_aih_id: anterior?.id ?? null,
      numero_fechamento: a.fechamento + 1,
      data_internacao: txt(base['entrada']),
      data_saida: txtOuNulo(base['alta']),
      carater_dominio_sus_id: num(base['carater_dominio_sus_id']),
      solicitado_procedimento_sigtap_id: num(base['solicitado_procedimento_sigtap_id']),
      realizado_procedimento_sigtap_id: realizado,
      codigo_cid10_principal: x.cidPrincipal,
      solicitante_profissional_id: numOuNulo(base['solicitante_profissional_id']),
      autorizador_sus_id: numOuNulo(base['autorizador_sus_id']),
      dias_permanencia: p.permanencia,
      diarias_uti: p.diariasUti,
      diarias_uti_mes_anterior: p.diariasUtiAnterior,
      situacao: 'fechada',
      fechada_em: new Date(),
      fechada_por_usuario_id: this.tx.contexto.usuario,
      origem: 'sistema',
    });
    let sequencia = 0;
    for (const item of p.itens) {
      sequencia += 1;
      const sigtap = item.sigtap ?? (await this.sigtapId(item.procedimento));
      if (!sigtap) throw recusa('procedimento-inexistente', 'Um item do fechamento não existe na tabela unificada.');
      if (item.tipo === 'opm') {
        const cnpj = soDigitos(item.opm?.cnpjFornecedor ?? '');
        await this.tx.incluir('conta_aih_opm', {
          conta_aih_id: conta,
          sequencia,
          procedimento_sigtap_id: sigtap,
          conta_hospitalar_item_id: item.item,
          quantidade: item.quantidade,
          registro_anvisa: txtOuNulo(item.opm?.registroAnvisa)?.slice(0, 20) ?? null,
          lote: txtOuNulo(item.opm?.lote)?.slice(0, 40) ?? null,
          serie: txtOuNulo(item.opm?.serie)?.slice(0, 40) ?? null,
          cnpj_fornecedor: /^\d{14}$/.test(cnpj) ? cnpj : null,
          numero_nota_fiscal: txtOuNulo(item.opm?.notaFiscal)?.slice(0, 20) ?? null,
          origem: 'sistema',
        });
        continue;
      }
      let cbo: number | null = null;
      if (item.cbo) {
        const o = await this.tx.uma('SELECT id FROM ocupacao_cbo WHERE codigo_cbo = ? ORDER BY id LIMIT 1', [
          item.cbo,
        ]);
        if (!o) throw recusa('cbo-inexistente', 'A ocupação (CBO) de um item não está no catálogo.');
        cbo = num(o['id']);
      }
      const uti = item.tipo === 'diaria-uti';
      if (uti && item.tipoUti === null)
        throw recusa('tipo-uti-ausente', 'A diária de UTI precisa do tipo do leito habilitado.');
      await this.tx.incluir('conta_aih_procedimento', {
        conta_aih_id: conta,
        sequencia,
        procedimento_sigtap_id: sigtap,
        tipo: uti ? 'diaria_uti' : item.tipo,
        tipo_leito_uti: uti ? item.tipoUti : null,
        quantidade: item.quantidade,
        ocupacao_cbo_id: cbo,
        conta_hospitalar_item_id: item.item,
        origem: 'sistema',
      });
    }
    await this.tx.alterar('autorizacao_internacao_sus', a.id, a.versao, {});
  }

  /**
   * A apresentação das AIHs no arquivo: a remessa do SISAIH e, em cada AIH fechada ou já apresentada na competência,
   * a última conta passa a "apresentada" com a competência e a remessa (a versão da autorização sobe).
   */
  async gravarArquivoSisaih(
    a: NovoArquivoSus,
    aihs: readonly { id: number; versao: number }[],
  ): Promise<{ substituidos: number; remessa: number }> {
    const { substituidos, remessa } = await gravarRemessa(this.tx, this.est, a, 'aih', {
      quantidade_aih: aihs.length,
    });
    await this.apresentarAihs(remessa, { id: a.competencia.id, competencia: a.competencia.competencia }, aihs);
    return { substituidos, remessa };
  }

  async apresentarAihs(
    remessa: number,
    competencia: { id: number; competencia: string },
    aihs: readonly { id: number; versao: number }[],
  ): Promise<void> {
    for (const ref of aihs) {
      const x = await this.conferir(ref, ['fechada', 'apresentada']);
      if (x.situacao === 'apresentada' && x.competenciaApresentacao !== competencia.competencia) versaoAlterada();
      const c = await this.contaAtual(ref.id);
      if (!c) versaoAlterada();
      await this.tx.alterar('conta_aih', c.id, c.versao, {
        situacao: 'apresentada',
        competencia_sus_id: competencia.id,
        remessa_sisaih_id: remessa,
      });
      await this.tx.alterar('autorizacao_internacao_sus', ref.id, ref.versao, {});
    }
  }
}
