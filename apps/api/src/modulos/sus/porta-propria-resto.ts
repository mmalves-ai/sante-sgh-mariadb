// O que faltava do faturamento SUS na porta própria (M51, família sus-resto do fecho-1), sobre o banco do cliente:
// - as linhas guardadas dos arquivos gerados, na mesma transação da remessa (gravarRemessa em porta-propria-arquivos.ts):
//   - CIHA (comunicação de internação hospitalar): registro_ciha por atendimento, com os procedimentos em
//     registro_ciha_procedimento; o paciente, o CNS ou o CPF, a internação e as datas vêm da conta no banco (nunca da
//     tela); a fonte de remuneração pela lista fechada `fonte_remuneracao_ciha` do dominio_sus (migração 94);
//   - BPA (boletim de produção ambulatorial): uma producao_ambulatorial_sus por folha (consolidada ou individualizada)
//     e as linhas em producao_ambulatorial_sus_item, com a SIGTAP e o CBO pelo código e o paciente pela conta;
//   - APAC (autorização de procedimento de alta complexidade): uma `apac` por laudo apresentado na competência, com o
//     número e o tipo da autorização, os CID do laudo e os procedimentos em apac_procedimento; a continuidade aponta a
//     APAC anterior da mesma autorização;
// - as leituras do cadastro: o médico solicitante (CRM do cadastro de profissionais) e os parâmetros ambulatoriais
//   (a competência do BPA aberta e o leiaute e o órgão de destino da última remessa).
// A AIH (autorização de internação hospitalar) já grava as contas apresentadas em porta-propria-aih.ts.
// A geração nova da competência substitui a remessa; as linhas da anterior ficam (histórico nunca apagado: a chave única
// das folhas e das APACs inclui a remessa, migração 94). O paciente lido aqui vai só ao banco: nunca à trilha nem ao log.
import { type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import type {
  LinhaApacParaGravar,
  LinhaBpaParaGravar,
  MedicoSolicitante,
  ParametrosSusCadastro,
  RegistroCihaParaGravar,
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
const marcadores = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/** As tabelas que estas gravações escrevem (entram na operação do faturamento SUS, junto de TABELAS_SUS). */
export const TABELAS_SUS_RESTO = [
  'registro_ciha',
  'registro_ciha_procedimento',
  'producao_ambulatorial_sus',
  'producao_ambulatorial_sus_item',
  'apac',
  'apac_procedimento',
] as const;

/** O registro da CIHA com os procedimentos e as quantidades (a montagem os tem em `r.procedimentos`). */
export interface RegistroCihaComItens extends RegistroCihaParaGravar {
  readonly itens: readonly { readonly codigo: string; readonly quantidade: number }[];
}

/** As contagens da remessa da CIHA por modalidade (colunas próprias de remessa_ciha). */
export function contagemCiha(registros: readonly RegistroCihaParaGravar[]): {
  quantidade_registro_internacao: number;
  quantidade_registro_ambulatorial: number;
} {
  const internacao = registros.filter((r) => r.modalidade === 'internacao').length;
  return {
    quantidade_registro_internacao: internacao,
    quantidade_registro_ambulatorial: registros.length - internacao,
  };
}

/** AAAAMM → primeiro e último dia (texto ISO); o mesmo de porta-propria.ts, sem importar a porta (sem ciclo). */
function periodoDaCompetencia(competencia: string): { inicio: string; fim: string } {
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(competencia)) throw new Error('competência AAAAMM');
  const ano = Number(competencia.slice(0, 4));
  const mes = Number(competencia.slice(4, 6));
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const m = String(mes).padStart(2, '0');
  return { inicio: `${ano}-${m}-01`, fim: `${ano}-${m}-${String(ultimo).padStart(2, '0')}` };
}

/** O tipo da APAC no banco pelo tipo no arquivo (1 inicial, 2 continuidade, 3 única). */
export function tipoApacDoArquivo(t: '1' | '2' | '3'): 'inicial' | 'continuidade' | 'unica' {
  return t === '2' ? 'continuidade' : t === '3' ? 'unica' : 'inicial';
}

/**
 * O período da APAC na competência: a interseção da competência com a validade da autorização. Sem interseção (a
 * validade não alcança a competência) devolve null: quem grava recusa (`apac-fora-da-validade`), nunca cai na
 * competência inteira.
 */
export function periodoApac(
  competencia: string,
  validade: { inicio: string | null; fim: string | null },
): { inicio: string; fim: string } | null {
  const c = periodoDaCompetencia(competencia);
  const inicio = validade.inicio && validade.inicio > c.inicio ? validade.inicio : c.inicio;
  const fim = validade.fim && validade.fim < c.fim ? validade.fim : c.fim;
  return fim >= inicio ? { inicio, fim } : null;
}

/**
 * O atendimento da linha: o da conta conferida no banco. O atendimento informado por quem chama só é aceito se for o
 * mesmo da conta (senão recusa `atendimento-divergente`); sem conta, não há como conferir e a linha não leva
 * atendimento informado.
 */
export function atendimentoDaConta(
  informado: number | null | undefined,
  daConta: number | null,
  instrumento: string,
): number | null {
  if (informado !== null && informado !== undefined && informado !== daConta)
    throw recusa(
      'atendimento-divergente',
      `Uma linha ${instrumento} aponta um atendimento que não é o da conta neste estabelecimento.`,
    );
  return daConta;
}

/** As folhas do BPA pela linha numerada: tipo e número da folha, na ordem do arquivo. */
export function folhasDoBpa(
  linhas: readonly LinhaBpaParaGravar[],
): { tipo: 'c' | 'i'; folha: number; linhas: LinhaBpaParaGravar[] }[] {
  const m = new Map<string, { tipo: 'c' | 'i'; folha: number; linhas: LinhaBpaParaGravar[] }>();
  for (const l of linhas) {
    const k = `${l.tipo}:${l.folha}`;
    const f = m.get(k) ?? { tipo: l.tipo, folha: l.folha, linhas: [] };
    f.linhas.push(l);
    m.set(k, f);
  }
  return [...m.values()];
}

/** Os ids da tabela pelo código (procedimento_sigtap.codigo_sigtap, ocupacao_cbo.codigo_cbo). */
async function idsPorCodigo(
  l: Leitor,
  tabela: 'procedimento_sigtap' | 'ocupacao_cbo',
  codigos: readonly string[],
): Promise<Map<string, number>> {
  const col = tabela === 'procedimento_sigtap' ? 'codigo_sigtap' : 'codigo_cbo';
  const unicos = [...new Set(codigos.filter((c) => c !== ''))];
  const m = new Map<string, number>();
  if (unicos.length === 0) return m;
  const ls = await l.consultar(
    `SELECT ${col} AS codigo, MAX(id) AS id FROM ${tabela} WHERE ${col} IN (${marcadores(unicos.length)}) GROUP BY ${col}`,
    unicos,
    { teto: unicos.length },
  );
  for (const x of ls) m.set(txt(x['codigo']), num(x['id']));
  return m;
}

/** As contas do estabelecimento com o paciente, o atendimento, a internação, as datas e os CID (ids). */
async function contasDoEstabelecimento(
  l: Leitor,
  est: number,
  contas: readonly number[],
): Promise<Map<number, Linha>> {
  const unicas = [...new Set(contas.filter((c) => c > 0))];
  const m = new Map<number, Linha>();
  for (let k = 0; k < unicas.length; k += 500) {
    const lote = unicas.slice(k, k + 500);
    const ls = await l.consultar(
      `SELECT c.id, c.paciente_id, c.atendimento_id, i.id AS internacao_id, pf.cns, pf.cpf,
              DATE_FORMAT(COALESCE(i.data_hora_entrada, at.entrada_em), '%Y-%m-%d') AS entrada,
              DATE_FORMAT(COALESCE(i.data_hora_alta, at.saida_em), '%Y-%m-%d') AS saida,
              COALESCE(i.cid_principal_termo_terminologia_id, at.cid_principal_termo_terminologia_id) AS cid1,
              COALESCE(i.cid_secundario_termo_terminologia_id, at.cid_secundario_termo_terminologia_id) AS cid2
         FROM conta_hospitalar c
         JOIN atendimento at ON at.id = c.atendimento_id
         LEFT JOIN internacao i ON i.atendimento_id = at.id AND i.excluido_em IS NULL AND i.situacao <> 'cancelada'
         JOIN paciente pa ON pa.id = c.paciente_id
         JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
        WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL AND c.id IN (${marcadores(lote.length)})`,
      [est, ...lote],
      { teto: lote.length * 2 },
    );
    for (const x of ls) if (!m.has(num(x['id']))) m.set(num(x['id']), x);
  }
  return m;
}

const exigir = <T>(v: T | undefined | null, codigo: string, texto: string): T => {
  if (v === undefined || v === null) throw recusa(codigo, texto);
  return v;
};

/** As gravações das linhas dos arquivos na transação da operação (o Escritor restrito às tabelas declaradas). */
export class GravacoesLinhasSusPropria {
  constructor(
    private readonly tx: TxOperacao,
    private readonly est: number,
  ) {}

  /**
   * Os registros da CIHA da remessa nova, na ordem do arquivo (sequência 1..n). Recusa (nada fica, a transação é
   * desfeita) a conta fora do estabelecimento, o paciente sem CNS nem CPF, a fonte fora da lista e o procedimento
   * fora da tabela unificada.
   */
  async registrosCiha(remessa: number, registros: readonly RegistroCihaComItens[]): Promise<number> {
    if (registros.length === 0) return 0;
    const contas = await contasDoEstabelecimento(
      this.tx,
      this.est,
      registros.map((r) => r.conta),
    );
    const fontes = new Map<string, number>();
    for (const x of await this.tx.consultar(
      "SELECT id, codigo FROM dominio_sus WHERE lista = 'fonte_remuneracao_ciha' AND ativo",
      [],
      { teto: 50 },
    ))
      fontes.set(txt(x['codigo']), num(x['id']));
    const sigtap = await idsPorCodigo(
      this.tx,
      'procedimento_sigtap',
      registros.flatMap((r) => [r.procedimentoPrincipal, ...r.itens.map((i) => i.codigo)]),
    );
    let sequencia = 0;
    for (const r of registros) {
      const c = exigir(
        contas.get(r.conta),
        'conta-inexistente',
        'Uma conta da CIHA não foi encontrada neste estabelecimento.',
      );
      const fonte = exigir(
        fontes.get(r.fonte),
        'fonte-inexistente',
        'A fonte de remuneração da CIHA não está na lista do cliente.',
      );
      const cns = txtOuNulo(c['cns'])?.replace(/\D/g, '') ?? null;
      const cpf = txtOuNulo(c['cpf'])?.replace(/\D/g, '') ?? null;
      const cnsOk = cns && /^\d{15}$/.test(cns) ? cns : null;
      const cpfOk = cpf && /^\d{11}$/.test(cpf) ? cpf : null;
      if (!cnsOk && !cpfOk)
        throw recusa('paciente-sem-documento', 'Um paciente da CIHA está sem CNS e sem CPF no cadastro.');
      const entrada = exigir(
        txtOuNulo(c['entrada']),
        'conta-sem-data',
        'Uma conta da CIHA está sem data de atendimento.',
      );
      const saida = txtOuNulo(c['saida']);
      const alta = saida && saida >= entrada ? saida : null;
      const internacao = r.modalidade === 'internacao' ? numOuNulo(c['internacao_id']) : null;
      const dias =
        internacao !== null && alta
          ? Math.round((Date.parse(`${alta}T00:00:00Z`) - Date.parse(`${entrada}T00:00:00Z`)) / 86_400_000)
          : null;
      sequencia += 1;
      const id = await this.tx.incluir('registro_ciha', {
        remessa_ciha_id: remessa,
        sequencia,
        tipo_registro: r.modalidade,
        forma_geracao: 'automatica',
        paciente_id: num(c['paciente_id']),
        cns: cnsOk,
        cpf: cnsOk ? null : cpfOk,
        atendimento_id: atendimentoDaConta(r.atendimento, numOuNulo(c['atendimento_id']), 'da CIHA'),
        internacao_id: internacao,
        conta_hospitalar_id: r.conta,
        data_atendimento: entrada,
        data_alta: alta,
        dias_internacao: dias,
        cid_principal_termo_terminologia_id: numOuNulo(c['cid1']),
        cid_secundario_termo_terminologia_id: numOuNulo(c['cid2']),
        fonte_remuneracao_dominio_sus_id: fonte,
      });
      const itens = r.itens.length
        ? r.itens
        : r.procedimentoPrincipal
          ? [{ codigo: r.procedimentoPrincipal, quantidade: 1 }]
          : [];
      let k = 0;
      for (const i of itens) {
        k += 1;
        await this.tx.incluir('registro_ciha_procedimento', {
          registro_ciha_id: id,
          sequencia: k,
          procedimento_sigtap_id: exigir(
            sigtap.get(i.codigo),
            'procedimento-inexistente',
            'Um procedimento da CIHA não existe na tabela unificada.',
          ),
          quantidade: i.quantidade,
        });
      }
    }
    return sequencia;
  }

  /**
   * As folhas do BPA da remessa nova (fechadas e exportadas por ela) com as linhas. Recusa o procedimento fora da
   * tabela unificada, o CBO fora do catálogo, a conta fora do estabelecimento e a linha individualizada sem paciente.
   */
  async folhasBpa(
    remessa: number,
    competenciaId: number,
    linhas: readonly LinhaBpaParaGravar[],
  ): Promise<number> {
    if (linhas.length === 0) return 0;
    const sigtap = await idsPorCodigo(
      this.tx,
      'procedimento_sigtap',
      linhas.map((x) => x.procedimento),
    );
    const cbo = await idsPorCodigo(
      this.tx,
      'ocupacao_cbo',
      linhas.map((x) => x.cbo),
    );
    const contas = await contasDoEstabelecimento(
      this.tx,
      this.est,
      linhas.map((x) => x.conta ?? 0),
    );
    const agora = new Date();
    const folhas = folhasDoBpa(linhas);
    for (const f of folhas) {
      const folha = await this.tx.incluir('producao_ambulatorial_sus', {
        estabelecimento_id: this.est,
        competencia_sus_id: competenciaId,
        tipo_folha: f.tipo === 'c' ? 'consolidado' : 'individualizado',
        numero_folha: f.folha,
        remessa_bpa_id: remessa,
        quantidade_linhas: f.linhas.length,
        situacao: 'exportada',
        fechada_em: agora,
        fechada_por_usuario_id: this.tx.contexto.usuario,
      });
      for (const x of f.linhas) {
        const c = x.conta === null ? null : contas.get(x.conta);
        if (x.conta !== null && !c)
          throw recusa('conta-inexistente', 'Uma conta do BPA não foi encontrada neste estabelecimento.');
        const paciente = c ? numOuNulo(c['paciente_id']) : null;
        if (x.tipo === 'i' && paciente === null)
          throw recusa('paciente-ausente', 'Uma linha individualizada do BPA está sem paciente.');
        if (paciente === null && x.idade === null)
          throw recusa('idade-ausente', 'Uma linha consolidada do BPA está sem idade e sem paciente.');
        await this.tx.incluir('producao_ambulatorial_sus_item', {
          producao_ambulatorial_sus_id: folha,
          sequencia: x.sequencia,
          procedimento_sigtap_id: exigir(
            sigtap.get(x.procedimento),
            'procedimento-inexistente',
            'Um procedimento do BPA não existe na tabela unificada.',
          ),
          ocupacao_cbo_id: exigir(
            cbo.get(x.cbo),
            'cbo-inexistente',
            'A ocupação (CBO) de uma linha do BPA não está no catálogo.',
          ),
          paciente_id: paciente,
          atendimento_id: atendimentoDaConta(
            x.atendimento,
            c ? numOuNulo(c['atendimento_id']) : null,
            'do BPA',
          ),
          conta_hospitalar_id: x.conta,
          data_atendimento: x.tipo === 'i' ? x.data : null,
          idade_anos: x.idade,
          quantidade: x.quantidade,
          lancado_automatico: true,
        });
      }
    }
    return folhas.length;
  }

  /**
   * As APACs apresentadas na remessa nova: uma por laudo, com os procedimentos na ordem do arquivo. Só a autorização
   * 'autorizada' ou 'encerrada' cuja validade alcança a competência é apresentada (o mesmo critério da leitura
   * apacsDaCompetencia); havendo várias no laudo, a mais recente (maior id). Recusa o laudo fora do estabelecimento
   * ou sem autorização ('nao-encontrado'), a autorização não autorizada ('apac-nao-autorizada'), a validade que não
   * alcança a competência ('apac-fora-da-validade'), a conta da linha fora do estabelecimento ('conta-inexistente')
   * ou de outro paciente ('conta-de-outro-paciente'), e o procedimento fora da tabela unificada.
   */
  async apacsDaRemessa(
    remessa: number,
    competencia: { id: number; competencia: string },
    linhas: readonly LinhaApacParaGravar[],
  ): Promise<number> {
    if (linhas.length === 0) return 0;
    const porLaudo = new Map<number, LinhaApacParaGravar[]>();
    for (const l of linhas) porLaudo.set(l.apac, [...(porLaudo.get(l.apac) ?? []), l]);
    const laudos = [...porLaudo.keys()];
    const autorizacoes = new Map<number, Linha>();
    for (const x of await this.tx.consultar(
      `SELECT q.* FROM (
         SELECT la.id AS laudo, aa.id AS autorizacao, aa.numero_apac, la.atendimento_id, la.paciente_id,
                la.codigo_cid10_principal, la.codigo_cid10_secundario, la.codigo_cid10_causa_associada,
                DATE_FORMAT(aa.validade_inicio, '%Y-%m-%d') AS validade_inicio,
                DATE_FORMAT(aa.validade_fim, '%Y-%m-%d') AS validade_fim,
                aa.situacao IN ('autorizada','encerrada') AS autorizada,
                COALESCE(DATE_FORMAT(aa.validade_inicio, '%Y%m') <= ? AND aa.ultima_competencia >= ?, FALSE) AS na_validade
           FROM laudo_apac la
           JOIN autorizacao_apac aa ON aa.laudo_apac_id = la.id AND aa.excluido_em IS NULL
          WHERE la.estabelecimento_id = ? AND la.excluido_em IS NULL AND la.id IN (${marcadores(laudos.length)})) q
        ORDER BY q.laudo, q.autorizada DESC, (q.autorizada AND q.na_validade) DESC, q.autorizacao DESC`,
      [competencia.competencia, competencia.competencia, this.est, ...laudos],
      { teto: laudos.length * 20 },
    ))
      if (!autorizacoes.has(num(x['laudo']))) autorizacoes.set(num(x['laudo']), x);
    const sigtap = await idsPorCodigo(
      this.tx,
      'procedimento_sigtap',
      linhas.map((x) => x.procedimento),
    );
    const cbo = await idsPorCodigo(
      this.tx,
      'ocupacao_cbo',
      linhas.map((x) => x.cbo),
    );
    const contas = await contasDoEstabelecimento(
      this.tx,
      this.est,
      linhas.map((x) => x.conta ?? 0),
    );
    const sig = (codigo: string) =>
      exigir(
        sigtap.get(codigo),
        'procedimento-inexistente',
        'Um procedimento da APAC não existe na tabela unificada.',
      );
    for (const [laudo, ls] of porLaudo) {
      const a = exigir(
        autorizacoes.get(laudo),
        'nao-encontrado',
        'A APAC não foi encontrada neste estabelecimento.',
      );
      if (num(a['autorizada']) !== 1)
        throw recusa('apac-nao-autorizada', 'A APAC apresentada não tem autorização vigente do gestor.');
      if (num(a['na_validade']) !== 1)
        throw recusa(
          'apac-fora-da-validade',
          'A validade da autorização da APAC não alcança a competência apresentada.',
        );
      const paciente = num(a['paciente_id']);
      for (const x of ls) {
        if (x.conta === null) continue;
        const c = exigir(
          contas.get(x.conta),
          'conta-inexistente',
          'Uma conta da APAC não foi encontrada neste estabelecimento.',
        );
        if (num(c['paciente_id']) !== paciente)
          throw recusa('conta-de-outro-paciente', 'Uma conta da APAC não é do paciente do laudo.');
      }
      const numero = txt(a['numero_apac']);
      if (!/^\d{13}$/.test(numero))
        throw recusa('apac-sem-numero', 'A APAC apresentada está sem o número da autorização.');
      const cid1 = txtOuNulo(a['codigo_cid10_principal']);
      if (!cid1) throw recusa('cid-ausente', 'A APAC apresentada está sem o CID principal do laudo.');
      const principal = ls.find((x) => x.principal) ?? ls[0];
      if (!principal) continue;
      const tipo = tipoApacDoArquivo(principal.tipoNoArquivo);
      const periodo = exigir(
        periodoApac(competencia.competencia, {
          inicio: txtOuNulo(a['validade_inicio']),
          fim: txtOuNulo(a['validade_fim']),
        }),
        'apac-fora-da-validade',
        'A validade da autorização da APAC não alcança a competência apresentada.',
      );
      const autorizacao = num(a['autorizacao']);
      const anterior =
        tipo === 'continuidade'
          ? numOuNulo(
              (
                await this.tx.uma(
                  `SELECT x.id FROM apac x JOIN competencia_sus c ON c.id = x.competencia_sus_id
                    WHERE x.autorizacao_apac_id = ? AND x.estabelecimento_id = ? AND x.excluido_em IS NULL
                      AND x.situacao <> 'cancelada' AND c.competencia < ?
                    ORDER BY c.competencia DESC, x.id DESC LIMIT 1`,
                  [autorizacao, this.est, competencia.competencia],
                )
              )?.['id'],
            )
          : null;
      const apac = await this.tx.incluir('apac', {
        estabelecimento_id: this.est,
        autorizacao_apac_id: autorizacao,
        competencia_sus_id: competencia.id,
        numero_apac: numero,
        tipo_apac: tipo,
        anterior_apac_id: anterior,
        atendimento_id: numOuNulo(a['atendimento_id']),
        data_inicio: periodo.inicio,
        data_fim: periodo.fim,
        principal_procedimento_sigtap_id: sig(principal.procedimento),
        codigo_cid10_principal: cid1,
        codigo_cid10_secundario: txtOuNulo(a['codigo_cid10_secundario']),
        codigo_cid10_causa_associada: txtOuNulo(a['codigo_cid10_causa_associada']),
        remessa_apac_id: remessa,
        situacao: 'apresentada',
      });
      let k = 0;
      for (const x of ls) {
        k += 1;
        await this.tx.incluir('apac_procedimento', {
          apac_id: apac,
          sequencia: k,
          procedimento_sigtap_id: sig(x.procedimento),
          tipo: x === principal ? 'principal' : 'secundario',
          quantidade: x.quantidade,
          ocupacao_cbo_id: cbo.get(x.cbo) ?? null,
          conta_hospitalar_id: x.conta,
        });
      }
    }
    return porLaudo.size;
  }
}

/** As leituras do cadastro que o faturamento SUS consulta (médico solicitante e parâmetros ambulatoriais). */
export class LeiturasRestoSusPropria {
  constructor(
    private readonly l: Leitor,
    private readonly est: number,
  ) {}

  /** Os médicos com CRM do cadastro pelo começo do CRM ou por parte do nome (até 30). */
  async buscarSolicitantes(termo: string): Promise<MedicoSolicitante[]> {
    const t = termo.trim();
    if (t.length < 2) return [];
    const like = `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const ls = await this.l.consultar(
      `SELECT pr.id, ic.numero_inscricao AS crm, COALESCE(pr.nome_exibicao, pf.nome) AS nome, uf.sigla AS uf,
              oc.codigo_cbo AS cbo, (pr.situacao = 'ativo' AND ic.situacao = 'ativa') AS ativo
         FROM profissional pr
         JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
         JOIN inscricao_conselho ic ON ic.id = (
                SELECT i2.id FROM inscricao_conselho i2 JOIN conselho_classe cc ON cc.id = i2.conselho_classe_id
                 WHERE i2.profissional_id = pr.id AND i2.excluido_em IS NULL AND cc.sigla = 'CRM'
                 ORDER BY i2.principal DESC, i2.id LIMIT 1)
         LEFT JOIN unidade_federativa uf ON uf.id = ic.unidade_federativa_id
         LEFT JOIN ocupacao_cbo oc ON oc.id = ic.ocupacao_cbo_id
        WHERE pr.excluido_em IS NULL AND (ic.numero_inscricao LIKE ? OR pf.nome LIKE ? OR pr.nome_exibicao LIKE ?)
        ORDER BY nome, pr.id LIMIT 30`,
      [/^\d+$/.test(t) ? `${t}%` : '\u0000', like, like],
      { teto: 30 },
    );
    return ls
      .map((x) => ({
        id: num(x['id']),
        conselho: Number(txt(x['crm']).replace(/\D/g, '')),
        nome: txt(x['nome']),
        uf: txtOuNulo(x['uf']),
        cbo: txtOuNulo(x['cbo']),
        ativo: num(x['ativo']) === 1,
      }))
      .filter((x) => Number.isSafeInteger(x.conselho) && x.conselho > 0);
  }

  /**
   * Os parâmetros ambulatoriais do estabelecimento como o banco os guarda: a competência do BPA aberta (a mais
   * recente), a versão do leiaute e o órgão de destino da última remessa do BPA gerada.
   */
  async parametrosCadastro(): Promise<ParametrosSusCadastro> {
    const c = await this.l.uma(
      `SELECT competencia FROM competencia_sus
        WHERE estabelecimento_id = ? AND instrumento = 'bpa' AND situacao IN ('aberta','reaberta') AND excluido_em IS NULL
        ORDER BY competencia DESC LIMIT 1`,
      [this.est],
    );
    const r = await this.l.uma(
      `SELECT versao_leiaute, orgao_destino FROM remessa_bpa
        WHERE estabelecimento_id = ? AND excluido_em IS NULL AND gerada_em IS NOT NULL
          AND situacao NOT IN ('cancelada')
        ORDER BY gerada_em DESC, id DESC LIMIT 1`,
      [this.est],
    );
    return {
      competenciaAmbulatorio: txtOuNulo(c?.['competencia']),
      versao: txtOuNulo(r?.['versao_leiaute']),
      orgao: txtOuNulo(r?.['orgao_destino']),
    };
  }
}
