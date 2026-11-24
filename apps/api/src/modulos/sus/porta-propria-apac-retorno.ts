// Porta própria do faturamento SUS, família APAC e retorno do gestor (modulos-proprios-2), sobre o banco do cliente.
// APAC (autorização de procedimento ambulatorial de alta complexidade) pela tela: o laudo (laudo_apac) é a raiz e o id
// da APAC na tela; a autorização (autorizacao_apac, uma por laudo) guarda a situação da tela (solicitada, autorizada,
// negada, encerrada, cancelada), o número, o tipo, o autorizador (CNS), a validade (competência inicial e final como
// primeiro e último dia), a última competência de continuidade, o encerramento e os motivos; o complemento de terapia
// renal vai em laudo_apac_nefrologia (sequência 1). O solicitante chega como o CPF (o serviço abre a chave opaca) e é
// guardado como o profissional; o tipo do laudo sai do catálogo tipo_laudo_apac pela família (nefrologia ou outro) e o
// motivo de saída do encerramento da lista oficial motivo_cobranca (dominio_sigtap): catálogo sem o item recusa com
// "catalogo-incompleto" sem gravar nada. Registro clínico nunca é apagado: o complemento retirado na correção fica
// marcado como excluído. A versão vista é a do laudo (toda mudança sobe as duas versões).
// Retorno do gestor por linha: o arquivo de retorno é o cabeçalho (retorno_sus: competência, instrumento, nome e
// SHA-256, um por arquivo no estabelecimento, número pela sequência de negócio); cada linha é um retorno_sus_item (uma
// por identificação no arquivo: a linha repetida não entra). A AIH da tela é a autorização de internação
// (autorizacao_internacao_sus); a linha aponta o último fechamento (conta_aih). Mudar a situação da AIH é regra da
// família da AIH: entra pela ponte (PonteAihDoRetorno: a PonteAihPropria de porta-propria-aih.ts, que o integrador
// injeta); sem ela, recusa com "modelo-pendente".
import { garantirSequencia, type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import {
  type ApacRegistro,
  ErroAih,
  ErroSus,
  type FiltroApacsPorta,
  type FiltroRetornosPorta,
  type LaudoNefrologiaApac,
  type MudancaApac,
  type NovaApac,
  type RetornoSus,
  type RetornoSusParaGravar,
  type SituacaoApac,
} from './tipos.js';

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

/** As tabelas que esta família grava (a operação faturamento.sus.gravacao precisa declará-las). */
export const TABELAS_APAC_RETORNO = [
  'laudo_apac',
  'laudo_apac_nefrologia',
  'autorizacao_apac',
  'retorno_sus',
  'retorno_sus_item',
  'sequencia_negocio',
] as const;

/** As sequências de negócio desta família (por estabelecimento). */
export const SEQUENCIA_LAUDO_APAC = 'laudo_apac';
export const SEQUENCIA_RETORNO_SUS = 'retorno_sus';

/** AAAAMM → primeiro e último dia. */
function diasDaCompetencia(c: string): { inicio: string; fim: string } {
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(c))
    throw new ErroSus('nao-encontrado', 'Competência inválida (AAAAMM).');
  const ano = Number(c.slice(0, 4));
  const mes = Number(c.slice(4, 6));
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const m = String(mes).padStart(2, '0');
  return { inicio: `${ano}-${m}-01`, fim: `${ano}-${m}-${String(ultimo).padStart(2, '0')}` };
}

/** O CID sem ponto, como a tabela guarda. */
const cid = (c: string | null): string | null => (c ? c.replace('.', '').trim().toUpperCase() : null);

const SQL_APAC = `
  SELECT la.id, aa.id AS autorizacao_id, aa.versao AS versao_autorizacao, aa.situacao, la.paciente_id,
         pa.numero_prontuario, la.atendimento_id, at.numero AS atendimento_numero,
         la.solicitado_procedimento_sigtap_id AS sigtap, ps.codigo_sigtap AS procedimento,
         la.codigo_cid10_principal, la.codigo_cid10_secundario, la.codigo_cid10_causa_associada,
         pf.cpf AS solicitante, ${dia('la.data_laudo')} AS data_solicitacao, la.justificativa,
         n.id AS nefrologia_id, n.versao AS nefrologia_versao, n.caracteristica_tratamento_dominio_sus_id,
         n.contraindicacao_transplante_dominio_sus_id, n.situacao_transplante_dominio_sus_id,
         n.acesso_vascular_dominio_sus_id, ${dia('n.data_inicio_tratamento')} AS inicio_tratamento,
         aa.numero_apac, aa.tipo_apac, aa.cns_autorizador, ${dia('aa.data_autorizacao')} AS data_autorizacao,
         DATE_FORMAT(aa.validade_inicio, '%Y%m') AS competencia_inicial,
         DATE_FORMAT(aa.validade_fim, '%Y%m') AS competencia_final, aa.ultima_competencia,
         ds.codigo_sigtap AS motivo_saida, ${dia('aa.data_encerramento')} AS data_encerramento,
         CASE aa.situacao WHEN 'negada' THEN aa.motivo_negativa WHEN 'cancelada' THEN aa.motivo_cancelamento END
           AS justificativa_situacao,
         ${login('la.criado_por')} AS registrada_por, ${instante('la.criado_em')} AS registrada_em,
         ${login('la.alterado_por')} AS alterada_por, ${instante('la.alterado_em')} AS alterada_em, la.versao
    FROM laudo_apac la
    JOIN autorizacao_apac aa ON aa.laudo_apac_id = la.id AND aa.excluido_em IS NULL
    JOIN paciente pa ON pa.id = la.paciente_id
    LEFT JOIN atendimento at ON at.id = la.atendimento_id
    JOIN procedimento_sigtap ps ON ps.id = la.solicitado_procedimento_sigtap_id
    JOIN profissional pr ON pr.id = la.solicitante_profissional_id
    JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
    LEFT JOIN laudo_apac_nefrologia n ON n.laudo_apac_id = la.id AND n.excluido_em IS NULL
     AND n.sequencia = (SELECT MAX(n2.sequencia) FROM laudo_apac_nefrologia n2
                         WHERE n2.laudo_apac_id = la.id AND n2.excluido_em IS NULL)
    LEFT JOIN dominio_sigtap ds ON ds.id = aa.motivo_saida_dominio_sigtap_id
   WHERE la.estabelecimento_id = ? AND la.excluido_em IS NULL`;

const SITUACOES_APAC: readonly SituacaoApac[] = [
  'solicitada',
  'autorizada',
  'negada',
  'encerrada',
  'cancelada',
];

function apacDaLinha(x: Linha): ApacRegistro {
  const situacao = txt(x['situacao']) as SituacaoApac;
  const nefrologia: LaudoNefrologiaApac | null =
    x['nefrologia_id'] === null || x['nefrologia_id'] === undefined
      ? null
      : {
          caracteristicaTratamento: num(x['caracteristica_tratamento_dominio_sus_id']),
          contraindicacaoTransplante: num(x['contraindicacao_transplante_dominio_sus_id']),
          situacaoTransplante: num(x['situacao_transplante_dominio_sus_id']),
          acessoVascular: num(x['acesso_vascular_dominio_sus_id']),
          inicioTratamento: txt(x['inicio_tratamento']),
        };
  const tipo = txtOuNulo(x['tipo_apac']);
  const atendimento = txtOuNulo(x['atendimento_numero']);
  return {
    id: num(x['id']),
    situacao: SITUACOES_APAC.includes(situacao) ? situacao : 'solicitada',
    paciente: num(x['paciente_id']),
    prontuario: numOuNulo(x['numero_prontuario']),
    registro: num(x['atendimento_id']),
    atendimento: atendimento && /^\d{1,15}$/.test(atendimento) ? Number(atendimento) : null,
    sigtap: num(x['sigtap']),
    procedimento: txt(x['procedimento']),
    cidPrincipal: txt(x['codigo_cid10_principal']),
    cidSecundario: txtOuNulo(x['codigo_cid10_secundario']),
    cidAssociado: txtOuNulo(x['codigo_cid10_causa_associada']),
    solicitante: txt(x['solicitante']),
    dataSolicitacao: txt(x['data_solicitacao']),
    justificativa: txt(x['justificativa']),
    laudoEspecifico: nefrologia ? 'nefrologia' : 'nenhum',
    nefrologia,
    numero: txtOuNulo(x['numero_apac']),
    tipo: tipo === 'inicial' || tipo === 'unica' ? tipo : null,
    autorizador: txtOuNulo(x['cns_autorizador']),
    dataAutorizacao: txtOuNulo(x['data_autorizacao']),
    competenciaInicial: txtOuNulo(x['competencia_inicial']),
    competenciaFinal: txtOuNulo(x['competencia_final']),
    ultimaCompetencia: txtOuNulo(x['ultima_competencia']),
    motivoSaida: txtOuNulo(x['motivo_saida']),
    dataEncerramento: txtOuNulo(x['data_encerramento']),
    justificativaSituacao: txtOuNulo(x['justificativa_situacao']),
    registradaPor: txt(x['registrada_por']),
    registradaEm: txt(x['registrada_em']),
    alteradaPor: txtOuNulo(x['alterada_por']),
    alteradaEm: txtOuNulo(x['alterada_em']),
    versao: num(x['versao']),
  };
}

const SQL_RETORNO = `
  SELECT i.id, r.instrumento, c.competencia, i.identificacao, ps.codigo_sigtap AS procedimento,
         ca.autorizacao_internacao_sus_id AS aih, i.producao_ambulatorial_sus_item_id AS linha_bpa,
         COALESCE(rs.numero, rb.numero) AS arquivo, i.situacao, i.motivo, i.valor_apresentado, i.valor_aprovado,
         i.valor_glosado, r.nome_arquivo, r.hash_sha256, i.tratamento, i.justificativa,
         ${login('i.criado_por')} AS importado_por, ${instante('i.criado_em')} AS importado_em,
         ${login('i.tratado_por_usuario_id')} AS tratado_por, ${instante('i.tratado_em')} AS tratado_em, i.versao
    FROM retorno_sus_item i
    JOIN retorno_sus r ON r.id = i.retorno_sus_id
    JOIN competencia_sus c ON c.id = r.competencia_sus_id
    LEFT JOIN procedimento_sigtap ps ON ps.id = i.procedimento_sigtap_id
    LEFT JOIN conta_aih ca ON ca.id = i.conta_aih_id
    LEFT JOIN remessa_sisaih rs ON rs.id = r.remessa_sisaih_id
    LEFT JOIN remessa_bpa rb ON rb.id = r.remessa_bpa_id
   WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND i.excluido_em IS NULL`;

function retornoDaLinha(x: Linha): RetornoSus {
  const situacao = txt(x['situacao']);
  const tratamento = txt(x['tratamento']);
  return {
    id: num(x['id']),
    instrumento: txt(x['instrumento']) === 'bpa' ? 'bpa' : 'aih',
    competencia: txt(x['competencia']),
    identificacao: txt(x['identificacao']),
    procedimento: txtOuNulo(x['procedimento']),
    aih: numOuNulo(x['aih']),
    linhaBpa: numOuNulo(x['linha_bpa']),
    arquivo: numOuNulo(x['arquivo']),
    situacao: situacao === 'rejeitada' || situacao === 'glosada' ? situacao : 'aprovada',
    motivo: txtOuNulo(x['motivo']),
    valorApresentado: numOuNulo(x['valor_apresentado']),
    valorAprovado: numOuNulo(x['valor_aprovado']),
    valorGlosado: num(x['valor_glosado']),
    arquivoRetorno: txt(x['nome_arquivo']),
    hashRetorno: txt(x['hash_sha256']),
    tratamento: tratamento === 'reapresentar' || tratamento === 'aceita' ? tratamento : 'pendente',
    justificativa: txtOuNulo(x['justificativa']),
    importadoPor: txt(x['importado_por']),
    importadoEm: txt(x['importado_em']),
    tratadoPor: txtOuNulo(x['tratado_por']),
    tratadoEm: txtOuNulo(x['tratado_em']),
    versao: num(x['versao']),
  };
}

/** As leituras da APAC e do retorno sobre uma conexão (a somente leitura ou a da transação da gravação). */
export class LeituraApacRetorno {
  constructor(
    protected readonly l: Leitor,
    protected readonly est: number,
  ) {}

  async apac(id: number): Promise<ApacRegistro | null> {
    const x = await this.l.uma(`${SQL_APAC} AND la.id = ?`, [this.est, id]);
    return x ? apacDaLinha(x) : null;
  }

  async paginaApacs(
    f: FiltroApacsPorta,
  ): Promise<{ itens: ApacRegistro[]; total: number; porSituacao: Record<string, number> }> {
    const cond: string[] = [];
    const p: unknown[] = [this.est];
    if (f.situacao) {
      cond.push('aa.situacao = ?');
      p.push(f.situacao);
    }
    if (f.numero) {
      cond.push('aa.numero_apac LIKE ?');
      p.push(`${f.numero.replace(/\D/g, '')}%`);
    }
    if (f.prontuario) {
      cond.push('pa.numero_prontuario = ?');
      p.push(f.prontuario);
    }
    if (f.competencia) {
      cond.push(
        "aa.situacao IN ('autorizada','encerrada') AND DATE_FORMAT(aa.validade_inicio, '%Y%m') <= ? AND aa.ultima_competencia >= ?",
      );
      p.push(f.competencia, f.competencia);
    }
    const onde = cond.length ? ` AND ${cond.join(' AND ')}` : '';
    const t = await this.l.uma(`SELECT COUNT(*) AS n FROM (${SQL_APAC}${onde}) q`, p);
    const ls = await this.l.consultar(`${SQL_APAC}${onde} ORDER BY la.id DESC LIMIT ? OFFSET ?`, [
      ...p,
      f.porPagina,
      f.pagina * f.porPagina,
    ]);
    const grupos = await this.l.consultar(
      `SELECT aa.situacao, COUNT(*) AS n FROM laudo_apac la
         JOIN autorizacao_apac aa ON aa.laudo_apac_id = la.id AND aa.excluido_em IS NULL
        WHERE la.estabelecimento_id = ? AND la.excluido_em IS NULL GROUP BY aa.situacao`,
      [this.est],
    );
    const porSituacao: Record<string, number> = {};
    for (const g of grupos) porSituacao[txt(g['situacao'])] = num(g['n']);
    return { itens: ls.map(apacDaLinha), total: num(t?.['n']), porSituacao };
  }

  async apacsDaCompetencia(competencia: string): Promise<ApacRegistro[]> {
    const ls = await this.l.consultar(
      `${SQL_APAC} AND aa.situacao IN ('autorizada','encerrada')
         AND DATE_FORMAT(aa.validade_inicio, '%Y%m') <= ? AND aa.ultima_competencia >= ? ORDER BY la.id`,
      [this.est, competencia, competencia],
      { teto: 100_000 },
    );
    return ls.map(apacDaLinha);
  }

  async paginaRetornos(f: FiltroRetornosPorta): Promise<{
    itens: RetornoSus[];
    total: number;
    porSituacao: Record<string, number>;
    valorGlosado: number;
  }> {
    const cond: string[] = [];
    const p: unknown[] = [this.est];
    if (f.instrumento) {
      cond.push('r.instrumento = ?');
      p.push(f.instrumento);
    }
    if (f.competencia) {
      cond.push('c.competencia = ?');
      p.push(f.competencia);
    }
    if (f.situacao) {
      cond.push('i.situacao = ?');
      p.push(f.situacao);
    }
    if (f.tratamento) {
      cond.push('i.tratamento = ?');
      p.push(f.tratamento);
    }
    const onde = cond.length ? ` AND ${cond.join(' AND ')}` : '';
    const grupos = await this.l.consultar(
      `SELECT q.situacao, COUNT(*) AS n, SUM(q.valor_glosado) AS glosado FROM (${SQL_RETORNO}${onde}) q
        GROUP BY q.situacao`,
      p,
    );
    const porSituacao: Record<string, number> = {};
    let total = 0;
    let glosado = 0;
    for (const g of grupos) {
      porSituacao[txt(g['situacao'])] = num(g['n']);
      total += num(g['n']);
      glosado += num(g['glosado']);
    }
    const ls = await this.l.consultar(`${SQL_RETORNO}${onde} ORDER BY i.id DESC LIMIT ? OFFSET ?`, [
      ...p,
      f.porPagina,
      f.pagina * f.porPagina,
    ]);
    return {
      itens: ls.map(retornoDaLinha),
      total,
      porSituacao,
      valorGlosado: Math.round(glosado * 100) / 100,
    };
  }

  async retornoSus(id: number): Promise<RetornoSus | null> {
    const x = await this.l.uma(`${SQL_RETORNO} AND i.id = ?`, [this.est, id]);
    return x ? retornoDaLinha(x) : null;
  }

  async ultimoRetornoDaAih(aih: number): Promise<RetornoSus | null> {
    const x = await this.l.uma(
      `${SQL_RETORNO} AND ca.autorizacao_internacao_sus_id = ? ORDER BY i.id DESC LIMIT 1`,
      [this.est, aih],
    );
    return x ? retornoDaLinha(x) : null;
  }
}

/** O que a família da AIH faz na AIH quando o retorno pede (a regra da situação da AIH é dela). */
export interface PonteAihDoRetorno {
  aplicarRetornoNaAih(
    tx: TxOperacao,
    est: number,
    aih: number,
    situacao: 'aprovada' | 'rejeitada',
    por: string,
  ): Promise<boolean>;
  /** A AIH rejeitada volta a fechada para reapresentar; outra situação recusa com ErroAih('versao-alterada'). */
  reapresentarAih(tx: TxOperacao, est: number, aih: number): Promise<void>;
}

const erroSemPonteAih = (): Error =>
  recusa(
    'modelo-pendente',
    'O banco do cliente ainda não muda a situação da AIH pelo retorno: nada mudou (pedido de modelo registrado).',
  );

/** As gravações da APAC e do retorno na transação da operação (o Escritor restrito às tabelas declaradas). */
export class GravacaoApacRetorno extends LeituraApacRetorno {
  constructor(
    private readonly tx: TxOperacao,
    est: number,
    private readonly ponteAih: PonteAihDoRetorno | null = null,
  ) {
    super(tx, est);
  }

  private async proximo(tipo: string): Promise<number> {
    await garantirSequencia(
      this.tx,
      { tipo, estabelecimento: this.est },
      { usuario: this.tx.contexto.usuario, agora: new Date() },
    );
    return (await this.tx.proximoNumero(tipo)).valor;
  }

  /** O profissional solicitante pelo CPF (o serviço já abriu a chave opaca). */
  private async solicitante(cpf: string): Promise<number> {
    const x = await this.tx.uma(
      `SELECT pr.id FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
        WHERE pf.cpf = ? AND pr.excluido_em IS NULL ORDER BY pr.id LIMIT 1`,
      [cpf.replace(/\D/g, '')],
    );
    if (!x)
      throw new ErroSus('nao-encontrado', 'Médico solicitante não encontrado no cadastro de profissionais.');
    return num(x['id']);
  }

  private async tipoLaudo(nefrologia: boolean): Promise<number> {
    const grupo = nefrologia ? 'nefrologia' : 'outro';
    const x = await this.tx.uma(
      'SELECT id FROM tipo_laudo_apac WHERE grupo_laudo = ? AND ativo = TRUE ORDER BY id LIMIT 1',
      [grupo],
    );
    if (!x)
      throw recusa(
        'catalogo-incompleto',
        `O catálogo de tipos de laudo de APAC não tem o tipo da família "${grupo}": nada foi gravado.`,
      );
    return num(x['id']);
  }

  private async gravarNefrologia(laudo: number, n: LaudoNefrologiaApac | null, atual: ApacRegistro | null) {
    const existente = atual
      ? await this.tx.uma(
          `SELECT id, versao FROM laudo_apac_nefrologia WHERE laudo_apac_id = ? AND excluido_em IS NULL
            ORDER BY sequencia DESC LIMIT 1`,
          [laudo],
        )
      : null;
    if (!n) {
      if (existente)
        await this.tx.alterar('laudo_apac_nefrologia', num(existente['id']), num(existente['versao']), {
          excluido_em: new Date(),
          excluido_por: this.tx.contexto.usuario,
        });
      return;
    }
    const campos = {
      caracteristica_tratamento_dominio_sus_id: n.caracteristicaTratamento,
      contraindicacao_transplante_dominio_sus_id: n.contraindicacaoTransplante,
      situacao_transplante_dominio_sus_id: n.situacaoTransplante,
      acesso_vascular_dominio_sus_id: n.acessoVascular,
      data_inicio_tratamento: n.inicioTratamento,
    };
    if (existente)
      await this.tx.alterar('laudo_apac_nefrologia', num(existente['id']), num(existente['versao']), campos);
    else {
      // O complemento retirado antes fica marcado como excluído (nunca apagado): o que volta pela correção entra
      // na sequência seguinte do laudo (a leitura usa o não excluído de maior sequência).
      const seq = await this.tx.uma(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM laudo_apac_nefrologia WHERE laudo_apac_id = ?',
        [laudo],
      );
      await this.tx.incluir('laudo_apac_nefrologia', {
        laudo_apac_id: laudo,
        sequencia: num(seq?.['s']),
        ...campos,
      });
    }
  }

  async incluirApac(a: NovaApac): Promise<ApacRegistro> {
    const solicitante = await this.solicitante(a.solicitante);
    const tipo = await this.tipoLaudo(a.nefrologia !== null);
    const numero = await this.proximo(SEQUENCIA_LAUDO_APAC);
    const id = await this.tx.incluir('laudo_apac', {
      estabelecimento_id: this.est,
      numero_laudo: String(numero),
      paciente_id: a.paciente,
      atendimento_id: a.registro,
      tipo_laudo_apac_id: tipo,
      data_laudo: a.dataSolicitacao,
      solicitado_procedimento_sigtap_id: a.sigtap,
      quantidade_solicitada: 1,
      codigo_cid10_principal: cid(a.cidPrincipal),
      codigo_cid10_secundario: cid(a.cidSecundario),
      codigo_cid10_causa_associada: cid(a.cidAssociado),
      solicitante_profissional_id: solicitante,
      justificativa: a.justificativa,
      situacao: 'solicitado',
    });
    await this.tx.incluir('autorizacao_apac', {
      estabelecimento_id: this.est,
      laudo_apac_id: id,
      data_solicitacao: a.dataSolicitacao,
      codigo_cid10: cid(a.cidPrincipal),
      situacao: 'solicitada',
    });
    await this.gravarNefrologia(id, a.nefrologia, null);
    const x = await this.apac(id);
    if (!x) throw new Error('APAC incluída não lida.');
    return x;
  }

  async mudarApac(p: {
    id: number;
    versao: number;
    por: string;
    mudanca: MudancaApac;
  }): Promise<{ antes: ApacRegistro; depois: ApacRegistro }> {
    await this.tx.consultarParaAtualizar(
      'SELECT id FROM laudo_apac WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [p.id, this.est],
    );
    const x = await this.tx.uma(`${SQL_APAC} AND la.id = ?`, [this.est, p.id]);
    if (!x) throw new ErroSus('nao-encontrado', 'APAC não encontrada.');
    const antes = apacDaLinha(x);
    if (antes.versao !== p.versao)
      throw new ErroSus('apac-alterada', 'A APAC mudou desde que você abriu a tela. Recarregue.');
    const autorizacao = num(x['autorizacao_id']);
    const versaoAut = num(x['versao_autorizacao']);
    const m = p.mudanca;
    let aut: Record<string, unknown> = {};
    let laudo: Record<string, unknown> = {};
    switch (m.acao) {
      case 'autorizar': {
        const dup = await this.tx.consultarParaAtualizar(
          'SELECT id FROM autorizacao_apac WHERE estabelecimento_id = ? AND numero_apac = ? AND id <> ? LIMIT 1',
          [this.est, m.numero, autorizacao],
        );
        if (dup.length)
          throw new ErroSus(
            'apac-numero-duplicado',
            'Este número de APAC já está registrado neste estabelecimento.',
          );
        aut = {
          situacao: 'autorizada',
          numero_apac: m.numero,
          tipo_apac: m.tipo,
          cns_autorizador: m.autorizador,
          data_autorizacao: m.dataAutorizacao,
          validade_inicio: diasDaCompetencia(m.competenciaInicial).inicio,
          validade_fim: diasDaCompetencia(m.competenciaFinal).fim,
          ultima_competencia: m.competenciaInicial,
        };
        laudo = { situacao: 'autorizado' };
        break;
      }
      case 'negar':
        aut = { situacao: 'negada', motivo_negativa: m.justificativa.slice(0, 500) };
        laudo = { situacao: 'negado' };
        break;
      case 'cancelar':
        aut = { situacao: 'cancelada', motivo_cancelamento: m.justificativa.slice(0, 500) };
        laudo = { situacao: 'cancelado' };
        break;
      case 'continuar':
        aut = { ultima_competencia: m.ultimaCompetencia };
        break;
      case 'corrigir':
        laudo = {
          codigo_cid10_principal: cid(m.cidPrincipal),
          codigo_cid10_secundario: cid(m.cidSecundario),
          codigo_cid10_causa_associada: cid(m.cidAssociado),
          solicitante_profissional_id: await this.solicitante(m.solicitante),
          data_laudo: m.dataSolicitacao,
          justificativa: m.justificativa,
        };
        aut = { data_solicitacao: m.dataSolicitacao, codigo_cid10: cid(m.cidPrincipal) };
        if ((m.nefrologia !== null) !== (antes.nefrologia !== null))
          laudo['tipo_laudo_apac_id'] = await this.tipoLaudo(m.nefrologia !== null);
        await this.gravarNefrologia(p.id, m.nefrologia, antes);
        break;
      case 'encerrar': {
        const motivo = await this.tx.uma(
          "SELECT id FROM dominio_sigtap WHERE lista = 'motivo_cobranca' AND codigo_sigtap = ? ORDER BY vigencia_fim IS NULL DESC, id DESC LIMIT 1",
          [m.motivo],
        );
        if (!motivo)
          throw recusa(
            'catalogo-incompleto',
            'O motivo de saída não está na lista oficial carregada (motivo de cobrança): nada foi gravado.',
          );
        aut = {
          situacao: 'encerrada',
          motivo_saida_dominio_sigtap_id: num(motivo['id']),
          data_encerramento: m.dataEncerramento,
          ultima_competencia: m.ultimaCompetencia,
        };
        laudo = { situacao: 'encerrado' };
        break;
      }
    }
    // As duas versões sobem juntas: a da tela é a do laudo.
    await this.tx.alterar('autorizacao_apac', autorizacao, versaoAut, aut);
    await this.tx.alterar('laudo_apac', p.id, antes.versao, laudo);
    const depois = await this.apac(p.id);
    if (!depois) throw new Error('APAC alterada não lida.');
    return { antes, depois };
  }

  private async cabecalhoDoRetorno(r: RetornoSusParaGravar): Promise<number> {
    const h = await this.tx.consultarParaAtualizar(
      `SELECT r.id, r.instrumento, c.competencia FROM retorno_sus r JOIN competencia_sus c ON c.id = r.competencia_sus_id
        WHERE r.estabelecimento_id = ? AND r.hash_sha256 = ?`,
      [this.est, r.hashRetorno],
    );
    const ja = h[0];
    if (ja) {
      if (txt(ja['instrumento']) !== r.instrumento || txt(ja['competencia']) !== r.competencia)
        throw new ErroSus(
          'versao-alterada',
          'Este arquivo de retorno já foi importado para outro instrumento ou competência.',
        );
      return num(ja['id']);
    }
    const c = await this.tx.uma(
      'SELECT id FROM competencia_sus WHERE estabelecimento_id = ? AND instrumento = ? AND competencia = ?',
      [this.est, r.instrumento, r.competencia],
    );
    if (!c)
      throw new ErroSus(
        'competencia-nao-aberta',
        'A competência do retorno não foi aberta neste estabelecimento.',
      );
    let remessa: Record<string, unknown> = {};
    if (r.arquivo !== null) {
      const t = r.instrumento === 'aih' ? 'remessa_sisaih' : 'remessa_bpa';
      const x = await this.tx.uma(`SELECT id FROM ${t} WHERE estabelecimento_id = ? AND numero = ?`, [
        this.est,
        String(r.arquivo),
      ]);
      if (x) remessa = { [`${t}_id`]: num(x['id']) };
    }
    const numero = await this.proximo(SEQUENCIA_RETORNO_SUS);
    const agora = new Date();
    return this.tx.incluir('retorno_sus', {
      estabelecimento_id: this.est,
      competencia_sus_id: num(c['id']),
      numero: String(numero),
      instrumento: r.instrumento,
      ...remessa,
      situacao: 'importado',
      nome_arquivo: r.arquivoRetorno.slice(0, 255),
      hash_sha256: r.hashRetorno,
      importado_em: agora,
      importador_usuario_id: this.tx.contexto.usuario,
    });
  }

  /** Quem trata a linha fica registrado (o banco exige): sem usuário na sessão, nada é gravado. */
  private usuarioQueTrata(): number {
    const u = this.tx.contexto.usuario;
    if (u === null || u === undefined)
      throw recusa(
        'usuario-obrigatorio',
        'O tratamento do retorno precisa do usuário da sessão: nada foi gravado.',
      );
    return u;
  }

  async inserirRetornoSus(r: RetornoSusParaGravar): Promise<number | null> {
    const tratador = r.situacao === 'aprovada' ? this.usuarioQueTrata() : null;
    const cab = await this.cabecalhoDoRetorno(r);
    const ja = await this.tx.uma(
      'SELECT id FROM retorno_sus_item WHERE retorno_sus_id = ? AND identificacao = ?',
      [cab, r.identificacao.slice(0, 30)],
    );
    if (ja) return null;
    let conta: number | null = null;
    if (r.aih !== null) {
      const x = await this.tx.uma(
        `SELECT ca.id FROM conta_aih ca JOIN autorizacao_internacao_sus a ON a.id = ca.autorizacao_internacao_sus_id
          WHERE a.id = ? AND a.estabelecimento_id = ? ORDER BY ca.numero_fechamento DESC LIMIT 1`,
        [r.aih, this.est],
      );
      if (!x) throw new ErroAih('nao-encontrado', 'AIH do retorno não encontrada neste estabelecimento.');
      conta = num(x['id']);
    }
    const sigtap = r.procedimento
      ? await this.tx.uma('SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = ?', [r.procedimento])
      : null;
    const seq = await this.tx.uma(
      'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM retorno_sus_item WHERE retorno_sus_id = ?',
      [cab],
    );
    const agora = new Date();
    const id = await this.tx.incluir('retorno_sus_item', {
      retorno_sus_id: cab,
      sequencia: num(seq?.['s']),
      identificacao: r.identificacao.slice(0, 30),
      conta_aih_id: conta,
      producao_ambulatorial_sus_item_id: r.linhaBpa,
      procedimento_sigtap_id: sigtap ? num(sigtap['id']) : null,
      situacao: r.situacao,
      motivo: r.motivo ? r.motivo.slice(0, 500) : null,
      valor_apresentado: r.valorApresentado,
      valor_aprovado: r.valorAprovado,
      valor_glosado: r.valorGlosado,
      // A linha aprovada não pede tratamento: entra aceita, com o registro de quem importou.
      tratamento: r.situacao === 'aprovada' ? 'aceita' : 'pendente',
      ...(r.situacao === 'aprovada'
        ? {
            justificativa: 'Aprovada no retorno do gestor.',
            tratado_em: agora,
            tratado_por_usuario_id: tratador,
          }
        : {}),
    });
    // As contagens e os valores do cabeçalho acompanham as linhas (alteração auditada, com a versão lida).
    const h = await this.tx.uma(
      `SELECT versao, quantidade_registros, quantidade_aprovados, quantidade_rejeitados, quantidade_glosados,
              valor_apresentado, valor_aprovado, valor_glosado FROM retorno_sus WHERE id = ?`,
      [cab],
    );
    if (!h) throw new Error('Cabeçalho do retorno não lido.');
    const dinheiro = (v: number) => Math.round(v * 100) / 100;
    await this.tx.alterar('retorno_sus', cab, num(h['versao']), {
      quantidade_registros: num(h['quantidade_registros']) + 1,
      quantidade_aprovados: num(h['quantidade_aprovados']) + (r.situacao === 'aprovada' ? 1 : 0),
      quantidade_rejeitados: num(h['quantidade_rejeitados']) + (r.situacao === 'rejeitada' ? 1 : 0),
      quantidade_glosados: num(h['quantidade_glosados']) + (r.situacao === 'glosada' ? 1 : 0),
      valor_apresentado: dinheiro(num(h['valor_apresentado']) + (r.valorApresentado ?? 0)),
      valor_aprovado: dinheiro(num(h['valor_aprovado']) + (r.valorAprovado ?? 0)),
      valor_glosado: dinheiro(num(h['valor_glosado']) + r.valorGlosado),
    });
    return id;
  }

  aplicarRetornoNaAih(aih: number, situacao: 'aprovada' | 'rejeitada', por: string): Promise<boolean> {
    if (!this.ponteAih) return Promise.reject(erroSemPonteAih());
    return this.ponteAih.aplicarRetornoNaAih(this.tx, this.est, aih, situacao, por);
  }

  async tratarRetornoSus(
    r: { id: number; versao: number },
    p: { decisao: 'reapresentar' | 'aceita'; justificativa: string; por: string; aih: number | null },
  ): Promise<void> {
    await this.tx.consultarParaAtualizar(
      `SELECT i.id FROM retorno_sus_item i JOIN retorno_sus r ON r.id = i.retorno_sus_id
        WHERE i.id = ? AND r.estabelecimento_id = ?`,
      [r.id, this.est],
    );
    const x = await this.retornoSus(r.id);
    if (!x || x.versao !== r.versao || x.tratamento !== 'pendente')
      throw new ErroAih('versao-alterada', 'O retorno mudou desde que você abriu a tela. Recarregue.');
    await this.tx.alterar('retorno_sus_item', r.id, r.versao, {
      tratamento: p.decisao,
      justificativa: p.justificativa.slice(0, 1000),
      tratado_em: new Date(),
      tratado_por_usuario_id: this.usuarioQueTrata(),
    });
    if (p.decisao === 'reapresentar' && p.aih !== null) {
      if (!this.ponteAih) throw erroSemPonteAih();
      await this.ponteAih.reapresentarAih(this.tx, this.est, p.aih);
    }
  }
}
