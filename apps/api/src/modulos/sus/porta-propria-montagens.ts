// Montagens e leituras dos arquivos do faturamento SUS na porta própria (M51), sobre o banco do cliente: a produção da
// competência lida da conta própria (conta_hospitalar com os itens, o atendimento, a internação, o paciente e a pessoa),
// as linhas guardadas dos arquivos (producao_ambulatorial_sus com os itens no BPA; apac com apac_procedimento na APAC),
// o laudo da APAC (atendimento, domínios do gestor e médicos solicitantes) e a internação da AIH (conta SUS,
// trajetória de leitos e lotes dos itens). Toda leitura filtra o estabelecimento da sessão.
// - CIHA (comunicação de internação hospitalar): as contas de fonte não SUS; a internação entra pela alta no intervalo
//   (a internação em curso não entra), o ambulatorial pela entrada do atendimento.
// - BPA (boletim de produção ambulatorial): as contas das fontes SUS fora da internação, pela entrada do atendimento.
// - O item da conta liga à SIGTAP pela equivalência vigente do item faturável (a do instrumento antes da de todos).
// - O "registro" da tela é o atendimento (CIHA, BPA e APAC) ou a internação (AIH); as contas parciais vão juntas.
// O paciente lido aqui vai só ao arquivo do gestor: nunca à tela, à trilha nem ao log.
import type { Leitor } from '@sgh/nucleo';
import type { AtendimentoBpaLido, AtendimentoLido, DadosBpaLidos, DadosCihaLidos } from './porta.js';
import type { DadosAihLidos } from './porta-aih.js';
import type {
  AtendimentoLaudoApacDados,
  ContaBpa,
  ContaCiha,
  DominiosApacDados,
  FiltroLinhasBpaPorta,
  InternacaoAih,
  ItemBpa,
  ItemContaAih,
  ItemContaSigtap,
  LinhaApac,
  LinhaBpa,
  LoteSaida,
  PacienteDoArquivo,
  PassagemLeito,
  ProcedimentoSigtapRegra,
  RegistroSigtap,
  SolicitanteApacCadastro,
  ValorDominioApac,
} from './tipos.js';

type Linha = Record<string, unknown>;

const num = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v));
const numOuNulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const txtOuNulo = (v: unknown): string | null => {
  const t = txt(v).trim();
  return t === '' ? null : t;
};
const marcadores = (n: number) => Array.from({ length: n }, () => '?').join(', ');
const dia = (col: string) => `DATE_FORMAT(${col}, '%Y-%m-%d')`;
/** O CID guardado no termo, sem o ponto (o arquivo do gestor usa o código corrido). */
const cid = (col: string) => `REPLACE(${col}, '.', '')`;
/** Teto de linhas de uma leitura da produção (a competência de um estabelecimento). */
const TETO_PRODUCAO = 50_000;
const LOTE_IDS = 500;

/** O apoio da porta principal: a SIGTAP dos ids, o CNES, os leitos de UTI e a SIGTAP pelo código. */
export interface ApoioMontagemSus {
  sigtapDosIds(ids: readonly number[]): Promise<{
    procedimentos: ProcedimentoSigtapRegra[];
    registros: RegistroSigtap[];
    compatibilidades: DadosBpaLidos['compatibilidades'];
  }>;
  cnesCadastrados(): Promise<number[]>;
  leitosUti(): Promise<{ tipo: number; nome: string; leitos: number }[]>;
  sigtapPorCodigo(codigo: string): Promise<{ id: number; codigo: string; nome: string } | null>;
}

/** O paciente (pessoa, endereço principal, município, UF, sexo e raça) a partir do paciente de `col`. */
const PACIENTE_COLUNAS = `pa.id AS paciente_id, pa.numero_prontuario, pf.cns, pf.cpf, COALESCE(sx.sigla, sx.codigo_sus) AS sexo,
         ${dia('pf.data_nascimento')} AS nascimento, mi.codigo_ibge AS municipio, pf.nome, ep.logradouro,
         ep.numero AS numero_endereco, ep.complemento, ep.cep, uf.sigla AS uf, ep.bairro_nome, pf.nome_mae,
         COALESCE(rc.codigo_cns, rc.codigo_ibge) AS raca`;
const pacienteJoin = (col: string) => `
    JOIN paciente pa ON pa.id = ${col}
    JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
    LEFT JOIN sexo sx ON sx.id = pf.sexo_id
    LEFT JOIN endereco_pessoa ep ON ep.id = (SELECT e2.id FROM endereco_pessoa e2
                                              WHERE e2.pessoa_fisica_id = pf.id AND e2.excluido_em IS NULL
                                                AND (e2.vigencia_fim IS NULL OR e2.vigencia_fim >= CURRENT_DATE)
                                              ORDER BY e2.principal DESC, e2.id LIMIT 1)
    LEFT JOIN municipio_ibge mi ON mi.id = ep.municipio_ibge_id
    LEFT JOIN unidade_federativa uf ON uf.id = mi.unidade_federativa_id
    LEFT JOIN classificacao_raca_cor rc ON rc.id = pf.classificacao_raca_cor_id`;

function pacienteDaLinha(x: Linha): PacienteDoArquivo {
  const sexo = txtOuNulo(x['sexo'])?.toUpperCase().slice(0, 1) ?? null;
  return {
    cns: txtOuNulo(x['cns']),
    cpf: txtOuNulo(x['cpf']),
    sexo: sexo === 'M' || sexo === 'F' ? sexo : null,
    nascimento: txtOuNulo(x['nascimento']),
    municipio: numOuNulo(x['municipio']),
    nome: txtOuNulo(x['nome']),
    logradouro: txtOuNulo(x['logradouro']),
    numero: txtOuNulo(x['numero_endereco']),
    complemento: txtOuNulo(x['complemento']),
    cep: txtOuNulo(x['cep']),
  };
}

/** A equivalência SIGTAP vigente do item faturável (a do instrumento antes da de todos). */
const sigtapDoItem = (instrumento: string) => `(SELECT q.procedimento_sigtap_id FROM equivalencia_sigtap_item q
      WHERE q.item_faturavel_id = ci.item_faturavel_id AND q.vigencia_fim IS NULL AND q.excluido_em IS NULL
        AND q.instrumento IN ('${instrumento}', 'todos')
      ORDER BY q.instrumento = 'todos', q.id LIMIT 1)`;

/** O intervalo da competência: [início, fim + 1 dia). */
const NO_INTERVALO = (col: string) => `${col} >= ? AND ${col} < DATE_ADD(?, INTERVAL 1 DAY)`;

const lotes = <T>(xs: readonly T[]): T[][] => {
  const r: T[][] = [];
  for (let i = 0; i < xs.length; i += LOTE_IDS) r.push(xs.slice(i, i + LOTE_IDS));
  return r;
};

/** A remessa do instrumento pelo número do arquivo (o id da tela) no estabelecimento. */
async function remessaDoNumero(
  l: Leitor,
  tabela: 'remessa_bpa' | 'remessa_apac',
  est: number,
  numero: number,
): Promise<number | null> {
  if (!Number.isSafeInteger(numero) || numero <= 0) return null;
  const x = await l.uma(
    `SELECT id FROM ${tabela} WHERE estabelecimento_id = ? AND numero = ? AND excluido_em IS NULL`,
    [est, String(numero)],
  );
  return x ? num(x['id']) : null;
}

export class MontagensSusPropria {
  constructor(
    private readonly l: Leitor,
    private readonly est: number,
    private readonly apoio: ApoioMontagemSus,
  ) {}

  /** Os itens das contas, com a SIGTAP pela equivalência vigente do instrumento. */
  private async itensDasContas(contas: readonly number[], instrumento: string): Promise<Linha[]> {
    const saida: Linha[] = [];
    for (const parte of lotes([...new Set(contas)])) {
      saida.push(
        ...(await this.l.consultar(
          `SELECT ci.id, ci.conta_hospitalar_id, ci.item_faturavel_id, ci.quantidade, ${sigtapDoItem(instrumento)} AS sigtap,
                  ci.executante_profissional_id, i.tipo_item, ci.numero_lote, i.descricao,
                  (SELECT oc.codigo_cbo FROM profissional_ocupacao po JOIN ocupacao_cbo oc ON oc.id = po.ocupacao_cbo_id
                    WHERE po.profissional_id = ci.executante_profissional_id AND po.excluido_em IS NULL AND po.ativo
                    ORDER BY po.principal DESC, po.id LIMIT 1) AS cbo,
                  pfe.cns AS executante_cns, pfe.cpf AS executante_cpf
             FROM conta_hospitalar_item ci
             JOIN item_faturavel i ON i.id = ci.item_faturavel_id
             LEFT JOIN profissional pe ON pe.id = ci.executante_profissional_id
             LEFT JOIN pessoa_fisica pfe ON pfe.id = pe.pessoa_fisica_id
            WHERE ci.conta_hospitalar_id IN (${marcadores(parte.length)}) AND ci.excluido_em IS NULL
            ORDER BY ci.conta_hospitalar_id, ci.sequencia, ci.id`,
          parte,
          { teto: TETO_PRODUCAO },
        )),
      );
    }
    return saida;
  }

  // ── CIHA ──

  async dadosCiha(
    intervalo: { readonly inicio: string; readonly fim: string },
    conveniosSus: readonly number[],
    sigtapExtra: readonly number[],
  ): Promise<DadosCihaLidos> {
    const momento = 'CASE WHEN i.id IS NOT NULL THEN i.data_hora_alta ELSE at.entrada_em END';
    const foraSus = conveniosSus.length ? ` AND c.fonte_pagadora_id NOT IN (${marcadores(conveniosSus.length)})` : '';
    const contas = await this.l.consultar(
      `SELECT c.id AS conta, c.atendimento_id, c.fonte_pagadora_id, c.natureza, i.id AS internacao_id,
              ${dia('COALESCE(i.data_hora_entrada, at.entrada_em)')} AS entrada,
              ${dia('COALESCE(i.data_hora_alta, at.saida_em)')} AS saida,
              ${cid('COALESCE(ti1.codigo_termo, ta1.codigo_termo)')} AS cid_principal,
              ${cid('COALESCE(ti2.codigo_termo, ta2.codigo_termo)')} AS cid_secundario,
              ms.codigo_sus AS motivo_alta, i.numero_carteira, i.numero_guia, fp.registro_ans, pj.cnpj,
              (SELECT d.numero FROM declaracao_obito d WHERE d.paciente_id = pa.id AND d.cancelada_em IS NULL
                ORDER BY d.id DESC LIMIT 1) AS declaracao_obito,
              ${PACIENTE_COLUNAS}
         FROM conta_hospitalar c
         JOIN atendimento at ON at.id = c.atendimento_id AND at.excluido_em IS NULL AND at.situacao <> 'cancelado'
         LEFT JOIN internacao i ON i.atendimento_id = at.id AND i.excluido_em IS NULL AND i.situacao <> 'cancelada'
         LEFT JOIN termo_terminologia ti1 ON ti1.id = i.cid_principal_termo_terminologia_id
         LEFT JOIN termo_terminologia ti2 ON ti2.id = i.cid_secundario_termo_terminologia_id
         LEFT JOIN termo_terminologia ta1 ON ta1.id = at.cid_principal_termo_terminologia_id
         LEFT JOIN termo_terminologia ta2 ON ta2.id = at.cid_secundario_termo_terminologia_id
         LEFT JOIN motivo_saida_hospitalar ms ON ms.id = i.motivo_saida_hospitalar_id
         JOIN fonte_pagadora fp ON fp.id = c.fonte_pagadora_id
         LEFT JOIN pessoa_juridica pj ON pj.id = fp.pessoa_juridica_id
         ${pacienteJoin('c.paciente_id')}
        WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL AND c.situacao <> 'cancelada'
          AND ${NO_INTERVALO(momento)}${foraSus}
        ORDER BY c.atendimento_id, c.id`,
      [this.est, intervalo.inicio, intervalo.fim, ...conveniosSus],
      { teto: TETO_PRODUCAO },
    );
    const itens = await this.itensDasContas(
      contas.map((x) => num(x['conta'])),
      'ciha',
    );
    const porConta = new Map<number, ItemContaSigtap[]>();
    for (const x of itens) {
      const conta = num(x['conta_hospitalar_id']);
      const lista = porConta.get(conta) ?? [];
      lista.push({
        conta,
        item: num(x['id']),
        sigtap: numOuNulo(x['sigtap']),
        quantidade: num(x['quantidade']),
        procedimento: numOuNulo(x['item_faturavel_id']),
      });
      porConta.set(conta, lista);
    }
    const porAtendimento = new Map<number, { conta: ContaCiha; contas: number[]; itens: ItemContaSigtap[] }>();
    const cids = new Set<string>();
    for (const x of contas) {
      const registro = num(x['atendimento_id']);
      const id = num(x['conta']);
      const internacao = x['internacao_id'] !== null && x['internacao_id'] !== undefined;
      const ja = porAtendimento.get(registro);
      if (ja) {
        ja.contas.push(id);
        ja.itens.push(...(porConta.get(id) ?? []));
        continue;
      }
      const c1 = txtOuNulo(x['cid_principal']);
      const c2 = txtOuNulo(x['cid_secundario']);
      if (c1) cids.add(c1);
      if (c2) cids.add(c2);
      const cnpj = txtOuNulo(x['cnpj'])?.replace(/\D/g, '') ?? null;
      const conta: ContaCiha = {
        conta: id,
        modalidade: internacao || txt(x['natureza']) === 'internacao' ? 'internacao' : 'ambulatorial',
        registro,
        atendimento: registro,
        convenio: num(x['fonte_pagadora_id']),
        entrada: txtOuNulo(x['entrada']),
        saida: txtOuNulo(x['saida']),
        cidPrincipal: c1,
        cidSecundario: c2,
        paciente: {
          ...pacienteDaLinha(x),
          uf: txtOuNulo(x['uf']),
          prontuario: numOuNulo(x['numero_prontuario']),
          declaracaoObito: txtOuNulo(x['declaracao_obito']),
        },
        motivoAlta: internacao ? numOuNulo(x['motivo_alta']) : null,
        beneficiario: txtOuNulo(x['numero_carteira']),
        guiaTiss: txtOuNulo(x['numero_guia']),
        operadora: {
          regAns: numOuNulo(txtOuNulo(x['registro_ans'])?.replace(/\D/g, '') ?? null),
          cnpj: cnpj && /^\d{14}$/.test(cnpj) ? cnpj : null,
        },
      };
      porAtendimento.set(registro, { conta, contas: [id], itens: [...(porConta.get(id) ?? [])] });
    }
    const atendimentos: AtendimentoLido[] = [...porAtendimento.values()];
    const s = await this.apoio.sigtapDosIds([
      ...sigtapExtra,
      ...itens.map((x) => num(x['sigtap'])).filter((n) => n > 0),
    ]);
    return {
      atendimentos,
      procedimentos: s.procedimentos,
      historico: [],
      registros: s.registros,
      cids,
      cnesCadastrados: await this.apoio.cnesCadastrados(),
    };
  }

  // ── BPA ──

  async dadosBpa(
    intervalo: { readonly inicio: string; readonly fim: string },
    conveniosSus: readonly number[],
    sigtapExtra: readonly number[],
  ): Promise<DadosBpaLidos> {
    const vazio = async (): Promise<DadosBpaLidos> => {
      const s = await this.apoio.sigtapDosIds(sigtapExtra);
      return {
        atendimentos: [],
        procedimentos: s.procedimentos,
        historico: [],
        registros: s.registros,
        compatibilidades: s.compatibilidades,
        cids: new Set<string>(),
        cnesCadastrados: await this.apoio.cnesCadastrados(),
      };
    };
    // Sem fonte SUS configurada, não há produção SUS a apresentar.
    if (conveniosSus.length === 0) return vazio();
    const contas = await this.l.consultar(
      `SELECT c.id AS conta, c.atendimento_id, c.fonte_pagadora_id, ${dia('at.entrada_em')} AS data,
              ${cid('ta1.codigo_termo')} AS cid_principal, ${PACIENTE_COLUNAS}
         FROM conta_hospitalar c
         JOIN atendimento at ON at.id = c.atendimento_id AND at.excluido_em IS NULL AND at.situacao <> 'cancelado'
         LEFT JOIN termo_terminologia ta1 ON ta1.id = at.cid_principal_termo_terminologia_id
         ${pacienteJoin('c.paciente_id')}
        WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL AND c.situacao <> 'cancelada'
          AND c.natureza <> 'internacao'
          AND NOT EXISTS (SELECT 1 FROM internacao i WHERE i.atendimento_id = at.id AND i.excluido_em IS NULL)
          AND ${NO_INTERVALO('at.entrada_em')}
          AND c.fonte_pagadora_id IN (${marcadores(conveniosSus.length)})
        ORDER BY c.atendimento_id, c.id`,
      [this.est, intervalo.inicio, intervalo.fim, ...conveniosSus],
      { teto: TETO_PRODUCAO },
    );
    if (contas.length === 0) return vazio();
    const itens = await this.itensDasContas(
      contas.map((x) => num(x['conta'])),
      'bpa',
    );
    const porConta = new Map<number, ItemBpa[]>();
    for (const x of itens) {
      const conta = num(x['conta_hospitalar_id']);
      const lista = porConta.get(conta) ?? [];
      const temExecutante = x['executante_profissional_id'] !== null && x['executante_profissional_id'] !== undefined;
      lista.push({
        conta,
        item: num(x['id']),
        sigtap: numOuNulo(x['sigtap']),
        quantidade: num(x['quantidade']),
        procedimento: numOuNulo(x['item_faturavel_id']),
        executante: temExecutante
          ? {
              cbo: txtOuNulo(x['cbo']),
              cns: txtOuNulo(x['executante_cns']),
              cpf: txtOuNulo(x['executante_cpf']),
            }
          : null,
      });
      porConta.set(conta, lista);
    }
    const porAtendimento = new Map<number, { conta: ContaBpa; contas: number[]; itens: ItemBpa[] }>();
    const cids = new Set<string>();
    for (const x of contas) {
      const registro = num(x['atendimento_id']);
      const id = num(x['conta']);
      const ja = porAtendimento.get(registro);
      if (ja) {
        ja.contas.push(id);
        ja.itens.push(...(porConta.get(id) ?? []));
        continue;
      }
      const c1 = txtOuNulo(x['cid_principal']);
      if (c1) cids.add(c1);
      const conta: ContaBpa = {
        conta: id,
        registro,
        atendimento: registro,
        convenio: num(x['fonte_pagadora_id']),
        data: txtOuNulo(x['data']),
        cidPrincipal: c1,
        pacienteId: numOuNulo(x['paciente_id']),
        paciente: {
          ...pacienteDaLinha(x),
          raca: numOuNulo(x['raca']),
          bairro: txtOuNulo(x['bairro_nome']),
          mae: txtOuNulo(x['nome_mae']),
        },
      };
      porAtendimento.set(registro, { conta, contas: [id], itens: [...(porConta.get(id) ?? [])] });
    }
    const atendimentos: AtendimentoBpaLido[] = [...porAtendimento.values()];
    const s = await this.apoio.sigtapDosIds([
      ...sigtapExtra,
      ...itens.map((x) => num(x['sigtap'])).filter((n) => n > 0),
    ]);
    return {
      atendimentos,
      procedimentos: s.procedimentos,
      historico: [],
      registros: s.registros,
      compatibilidades: s.compatibilidades,
      cids,
      cnesCadastrados: await this.apoio.cnesCadastrados(),
    };
  }

  /** As linhas guardadas do arquivo do BPA (as folhas da remessa), com o resumo por tipo de folha. */
  async linhasBpa(f: FiltroLinhasBpaPorta): Promise<{
    itens: LinhaBpa[];
    total: number;
    porTipo: Record<string, { linhas: number; quantidade: number }>;
  }> {
    const remessa = await remessaDoNumero(this.l, 'remessa_bpa', this.est, f.arquivo);
    if (remessa === null) return { itens: [], total: 0, porTipo: {} };
    const base = `FROM producao_ambulatorial_sus pa
      JOIN producao_ambulatorial_sus_item it ON it.producao_ambulatorial_sus_id = pa.id AND it.excluido_em IS NULL
      JOIN procedimento_sigtap ps ON ps.id = it.procedimento_sigtap_id
      JOIN ocupacao_cbo oc ON oc.id = it.ocupacao_cbo_id
     WHERE pa.remessa_bpa_id = ? AND pa.estabelecimento_id = ? AND pa.excluido_em IS NULL`;
    const tipoSql = "CASE pa.tipo_folha WHEN 'consolidado' THEN 'c' ELSE 'i' END";
    const resumo = await this.l.consultar(
      `SELECT ${tipoSql} AS tipo, COUNT(*) AS linhas, COALESCE(SUM(it.quantidade), 0) AS quantidade ${base}
        GROUP BY pa.tipo_folha`,
      [remessa, this.est],
      { teto: 10 },
    );
    const porTipo: Record<string, { linhas: number; quantidade: number }> = {};
    for (const x of resumo) porTipo[txt(x['tipo'])] = { linhas: num(x['linhas']), quantidade: num(x['quantidade']) };
    let filtro = '';
    const p: unknown[] = [remessa, this.est];
    if (f.tipo) {
      filtro += ' AND pa.tipo_folha = ?';
      p.push(f.tipo === 'c' ? 'consolidado' : 'individualizado');
    }
    if (f.procedimento) {
      filtro += ' AND ps.codigo_sigtap LIKE ?';
      p.push(`${f.procedimento.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    const total = num((await this.l.uma(`SELECT COUNT(*) AS n ${base}${filtro}`, p))?.['n']);
    const porPagina = Math.max(1, Math.min(500, Math.trunc(f.porPagina)));
    const pagina = Math.max(0, Math.trunc(f.pagina));
    const ls = await this.l.consultar(
      `SELECT it.id, ${tipoSql} AS tipo, pa.numero_folha, it.sequencia, ps.codigo_sigtap, oc.codigo_cbo, it.idade_anos,
              it.quantidade, ${dia('it.data_atendimento')} AS data, it.conta_hospitalar_id, it.atendimento_id
         ${base}${filtro}
        ORDER BY pa.tipo_folha, pa.numero_folha, it.sequencia, it.id LIMIT ? OFFSET ?`,
      [...p, porPagina, pagina * porPagina],
      { teto: porPagina },
    );
    return {
      itens: ls.map((x) => ({
        id: num(x['id']),
        tipo: txt(x['tipo']) === 'c' ? 'c' : 'i',
        folha: num(x['numero_folha']),
        sequencia: num(x['sequencia']),
        procedimento: txt(x['codigo_sigtap']),
        cbo: txt(x['codigo_cbo']),
        idade: numOuNulo(x['idade_anos']),
        quantidade: num(x['quantidade']),
        data: txtOuNulo(x['data']),
        conta: numOuNulo(x['conta_hospitalar_id']),
        atendimento: numOuNulo(x['atendimento_id']),
      })),
      total,
      porTipo,
    };
  }

  /** A linha do BPA vigente da competência pela folha e sequência (o retorno do gestor aponta a linha). */
  async linhaBpaDaCompetencia(
    competencia: string,
    p: { tipo: 'c' | 'i'; folha: number; sequencia: number },
  ): Promise<{ linha: number; arquivo: number; procedimento: string } | null> {
    const x = await this.l.uma(
      `SELECT it.id, r.numero, ps.codigo_sigtap
         FROM competencia_sus c
         JOIN producao_ambulatorial_sus pa ON pa.competencia_sus_id = c.id AND pa.excluido_em IS NULL
         JOIN remessa_bpa r ON r.id = pa.remessa_bpa_id AND r.situacao NOT IN ('substituida', 'cancelada')
           AND r.excluido_em IS NULL
         JOIN producao_ambulatorial_sus_item it ON it.producao_ambulatorial_sus_id = pa.id AND it.excluido_em IS NULL
         JOIN procedimento_sigtap ps ON ps.id = it.procedimento_sigtap_id
        WHERE c.estabelecimento_id = ? AND c.instrumento = 'bpa' AND c.competencia = ? AND c.excluido_em IS NULL
          AND pa.tipo_folha = ? AND pa.numero_folha = ? AND it.sequencia = ?
        ORDER BY r.id DESC LIMIT 1`,
      [this.est, competencia, p.tipo === 'c' ? 'consolidado' : 'individualizado', p.folha, p.sequencia],
    );
    if (!x) return null;
    const arquivo = Number(txt(x['numero']));
    return Number.isSafeInteger(arquivo)
      ? { linha: num(x['id']), arquivo, procedimento: txt(x['codigo_sigtap']) }
      : null;
  }

  // ── APAC ──

  /** O atendimento do laudo: a conta SUS vem primeiro quando o atendimento tem várias. */
  async atendimentoLaudoApac(
    registro: number,
    conveniosSus: readonly number[],
  ): Promise<AtendimentoLaudoApacDados | null> {
    const sus = conveniosSus.length
      ? `c.fonte_pagadora_id IN (${marcadores(conveniosSus.length)})`
      : 'FALSE';
    const x = await this.l.uma(
      `SELECT at.id, ${dia('at.entrada_em')} AS data, at.fonte_pagadora_id, ${cid('ta1.codigo_termo')} AS cid_principal,
              (SELECT c.fonte_pagadora_id FROM conta_hospitalar c
                WHERE c.atendimento_id = at.id AND c.excluido_em IS NULL AND c.situacao <> 'cancelada'
                ORDER BY ${sus} DESC, c.id LIMIT 1) AS fonte_conta,
              pa.id AS paciente_id, pa.numero_prontuario, pf.cns
         FROM atendimento at
         JOIN paciente pa ON pa.id = at.paciente_id
         JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
         LEFT JOIN termo_terminologia ta1 ON ta1.id = at.cid_principal_termo_terminologia_id
        WHERE at.id = ? AND at.estabelecimento_id = ? AND at.excluido_em IS NULL`,
      [...conveniosSus, registro, this.est],
    );
    if (!x) return null;
    return {
      registro,
      atendimento: num(x['id']),
      pacienteId: numOuNulo(x['paciente_id']),
      prontuario: numOuNulo(x['numero_prontuario']),
      data: txtOuNulo(x['data']),
      convenio: numOuNulo(x['fonte_conta']) ?? numOuNulo(x['fonte_pagadora_id']),
      cns: txtOuNulo(x['cns']),
      cidPrincipal: txtOuNulo(x['cid_principal']),
    };
  }

  /** Os domínios do gestor no laudo da APAC (nefrologia), vigentes hoje, pelo código oficial. */
  async dominiosApac(): Promise<DominiosApacDados> {
    const ls = await this.l.consultar(
      `SELECT lista, COALESCE(codigo_oficial, codigo) AS codigo, descricao FROM dominio_sus
        WHERE lista IN ('caracteristica_tratamento_dialitico', 'contraindicacao_transplante', 'situacao_transplante',
                        'acesso_vascular')
          AND ativo AND (vigencia_inicio IS NULL OR vigencia_inicio <= CURRENT_DATE)
          AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
        ORDER BY lista, ordem, codigo`,
      [],
      { teto: 2_000 },
    );
    const de = (lista: string): ValorDominioApac[] =>
      ls
        .filter((x) => txt(x['lista']) === lista && /^\d{1,9}$/.test(txt(x['codigo'])))
        .map((x) => ({ id: Number(txt(x['codigo'])), nome: txt(x['descricao']) }));
    return {
      caracteristicaTratamento: de('caracteristica_tratamento_dialitico'),
      contraindicacaoTransplante: de('contraindicacao_transplante'),
      situacaoTransplante: de('situacao_transplante'),
      acessoVascular: de('acesso_vascular'),
    };
  }

  private static readonly SQL_SOLICITANTE = `
    SELECT pf.cpf, COALESCE(pr.nome_exibicao, pf.nome) AS nome, pf.cns,
           (SELECT ic.numero_inscricao FROM inscricao_conselho ic JOIN conselho_classe cc ON cc.id = ic.conselho_classe_id
             WHERE ic.profissional_id = pr.id AND ic.excluido_em IS NULL AND cc.sigla = 'CRM'
             ORDER BY ic.principal DESC, ic.id LIMIT 1) AS crm
      FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
     WHERE pr.excluido_em IS NULL AND pf.cpf IS NOT NULL`;

  private static solicitante(x: Linha): SolicitanteApacCadastro {
    const crm = txt(x['crm']).replace(/\D/g, '');
    return {
      chave: txt(x['cpf']),
      nome: txt(x['nome']),
      crm: /^\d{1,12}$/.test(crm) ? Number(crm) : null,
      cns: txtOuNulo(x['cns']),
    };
  }

  /** Os médicos (com CRM) do cadastro pelo nome ou pelo começo do CRM. */
  async buscarSolicitantesApac(termo: string): Promise<SolicitanteApacCadastro[]> {
    const t = termo.trim();
    if (t.length < 2) return [];
    const like = `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const ls = await this.l.consultar(
      `SELECT * FROM (${MontagensSusPropria.SQL_SOLICITANTE}) s
        WHERE s.crm IS NOT NULL AND (s.crm LIKE ? OR s.nome LIKE ?)
        ORDER BY s.nome, s.cpf LIMIT 30`,
      [/^\d+$/.test(t) ? `${t}%` : '\u0000', like],
      { teto: 30 },
    );
    return ls.map(MontagensSusPropria.solicitante);
  }

  /** Os solicitantes pela chave (o CPF que o serviço abriu da chave opaca). */
  async solicitantesApacPorChave(chaves: readonly string[]): Promise<SolicitanteApacCadastro[]> {
    const cpfs = [...new Set(chaves.map((c) => c.replace(/\D/g, '')).filter((c) => /^\d{11}$/.test(c)))];
    if (cpfs.length === 0) return [];
    const ls = await this.l.consultar(
      `${MontagensSusPropria.SQL_SOLICITANTE} AND pf.cpf IN (${marcadores(cpfs.length)}) ORDER BY pr.id`,
      cpfs,
      { teto: cpfs.length * 4 },
    );
    const vistos = new Set<string>();
    return ls.map(MontagensSusPropria.solicitante).filter((x) => !vistos.has(x.chave) && vistos.add(x.chave));
  }

  /** As linhas guardadas do arquivo da APAC (os procedimentos das APACs da remessa). */
  async linhasApac(f: {
    arquivo: number;
    pagina: number;
    porPagina: number;
  }): Promise<{ itens: LinhaApac[]; total: number; apacs: number; quantidade: number }> {
    const remessa = await remessaDoNumero(this.l, 'remessa_apac', this.est, f.arquivo);
    if (remessa === null) return { itens: [], total: 0, apacs: 0, quantidade: 0 };
    const base = `FROM apac a
      JOIN apac_procedimento ap ON ap.apac_id = a.id AND ap.excluido_em IS NULL
      JOIN autorizacao_apac aa ON aa.id = a.autorizacao_apac_id
      JOIN procedimento_sigtap ps ON ps.id = ap.procedimento_sigtap_id
      LEFT JOIN ocupacao_cbo oc ON oc.id = ap.ocupacao_cbo_id
     WHERE a.remessa_apac_id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`;
    const r = await this.l.uma(
      `SELECT COUNT(*) AS n, COUNT(DISTINCT a.id) AS apacs, COALESCE(SUM(ap.quantidade), 0) AS quantidade ${base}`,
      [remessa, this.est],
    );
    const porPagina = Math.max(1, Math.min(500, Math.trunc(f.porPagina)));
    const pagina = Math.max(0, Math.trunc(f.pagina));
    const ls = await this.l.consultar(
      `SELECT ap.id, aa.laudo_apac_id, a.numero_apac, a.tipo_apac, ps.codigo_sigtap, ap.tipo, oc.codigo_cbo, ap.quantidade,
              (SELECT c.id FROM conta_hospitalar c WHERE c.atendimento_id = a.atendimento_id AND c.excluido_em IS NULL
                ORDER BY c.id LIMIT 1) AS conta
         ${base}
        ORDER BY a.numero_apac, ap.sequencia, ap.id LIMIT ? OFFSET ?`,
      [remessa, this.est, porPagina, pagina * porPagina],
      { teto: porPagina },
    );
    const tipo = (t: string): '1' | '2' | '3' => (t === 'continuidade' ? '2' : t === 'unica' ? '3' : '1');
    return {
      itens: ls.map((x) => ({
        id: num(x['id']),
        apac: num(x['laudo_apac_id']),
        numero: txt(x['numero_apac']),
        tipoNoArquivo: tipo(txt(x['tipo_apac'])),
        procedimento: txt(x['codigo_sigtap']),
        principal: txt(x['tipo']) === 'principal',
        cbo: txt(x['codigo_cbo']),
        quantidade: num(x['quantidade']),
        conta: numOuNulo(x['conta']),
      })),
      total: num(r?.['n']),
      apacs: num(r?.['apacs']),
      quantidade: num(r?.['quantidade']),
    };
  }

  // ── AIH ──

  private async internacoesDe(registros: readonly number[], conveniosSus: readonly number[]): Promise<InternacaoAih[]> {
    const ids = [...new Set(registros.filter((r) => Number.isSafeInteger(r) && r > 0))];
    const saida: InternacaoAih[] = [];
    for (const parte of lotes(ids)) {
      const ls = await this.l.consultar(
        `SELECT i.id, i.atendimento_id, i.fonte_pagadora_id, ${dia('i.data_hora_entrada')} AS entrada,
                ${dia('i.data_hora_alta')} AS alta, ms.codigo_sus AS motivo_saida, ca.urgencia,
                ${cid('ti1.codigo_termo')} AS cid_principal, ${cid('ti2.codigo_termo')} AS cid_secundario,
                ${PACIENTE_COLUNAS}
           FROM internacao i
           LEFT JOIN motivo_saida_hospitalar ms ON ms.id = i.motivo_saida_hospitalar_id
           LEFT JOIN carater_admissao ca ON ca.id = i.carater_admissao_id
           LEFT JOIN termo_terminologia ti1 ON ti1.id = i.cid_principal_termo_terminologia_id
           LEFT JOIN termo_terminologia ti2 ON ti2.id = i.cid_secundario_termo_terminologia_id
           ${pacienteJoin('i.paciente_id')}
          WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL AND i.id IN (${marcadores(parte.length)})
          ORDER BY i.id`,
        [this.est, ...parte],
        { teto: parte.length },
      );
      const contas = await this.l.consultar(
        `SELECT c.id, c.atendimento_id, c.fonte_pagadora_id FROM conta_hospitalar c
          WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL AND c.situacao <> 'cancelada'
            AND c.atendimento_id IN (SELECT i.atendimento_id FROM internacao i WHERE i.id IN (${marcadores(parte.length)}))
          ORDER BY c.id`,
        [this.est, ...parte],
        { teto: TETO_PRODUCAO },
      );
      for (const x of ls) {
        const at = num(x['atendimento_id']);
        const doAt = contas.filter((c) => num(c['atendimento_id']) === at);
        const sus = doAt.filter((c) => conveniosSus.includes(num(c['fonte_pagadora_id'])));
        const escolhida = sus[0] ?? doAt[0] ?? null;
        saida.push({
          registro: num(x['id']),
          prontuario: numOuNulo(x['numero_prontuario']),
          atendimento: at,
          conta: escolhida ? num(escolhida['id']) : null,
          contasSus: sus.map((c) => num(c['id'])),
          convenio: escolhida ? num(escolhida['fonte_pagadora_id']) : num(x['fonte_pagadora_id']),
          entrada: txtOuNulo(x['entrada']),
          alta: txtOuNulo(x['alta']),
          motivoSaida: numOuNulo(x['motivo_saida']),
          carater: x['urgencia'] === null || x['urgencia'] === undefined ? null : num(x['urgencia']) ? '2' : '1',
          // A especialidade do leito no SIH não é guardada na internação: a montagem usa a da SIGTAP do principal.
          especialidadeLeito: null,
          cidPrincipal: txtOuNulo(x['cid_principal']),
          cidSecundario: txtOuNulo(x['cid_secundario']),
          paciente: { ...pacienteDaLinha(x), raca: numOuNulo(x['raca']) },
        });
      }
    }
    return saida;
  }

  async internacaoAih(registro: number, conveniosSus: readonly number[]): Promise<InternacaoAih | null> {
    return (await this.internacoesDe([registro], conveniosSus))[0] ?? null;
  }

  /** As internações com alta no intervalo e com conta de fonte SUS (a primeira conta SUS de cada uma). */
  async internacoesSus(
    intervalo: { readonly inicio: string; readonly fim: string },
    conveniosSus: readonly number[],
  ): Promise<{ registro: number; conta: number }[]> {
    if (conveniosSus.length === 0) return [];
    const ls = await this.l.consultar(
      `SELECT i.id, MIN(c.id) AS conta FROM internacao i
         JOIN conta_hospitalar c ON c.atendimento_id = i.atendimento_id AND c.excluido_em IS NULL
           AND c.situacao <> 'cancelada' AND c.fonte_pagadora_id IN (${marcadores(conveniosSus.length)})
        WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL AND i.situacao <> 'cancelada'
          AND ${NO_INTERVALO('i.data_hora_alta')}
        GROUP BY i.id ORDER BY i.id`,
      [...conveniosSus, this.est, intervalo.inicio, intervalo.fim],
      { teto: TETO_PRODUCAO },
    );
    return ls.map((x) => ({ registro: num(x['id']), conta: num(x['conta']) }));
  }

  async dadosAih(
    registros: readonly number[],
    codigos: readonly string[],
    sigtapExtra: readonly number[],
    conveniosSus: readonly number[],
  ): Promise<DadosAihLidos> {
    const internacoes = await this.internacoesDe(registros, conveniosSus);
    const contas = internacoes.flatMap((i) => (i.contasSus.length ? i.contasSus : i.conta ? [i.conta] : []));
    const brutos = await this.itensDasContas(contas, 'aih');
    const itens: ItemContaAih[] = brutos.map((x) => ({
      conta: num(x['conta_hospitalar_id']),
      item: num(x['id']),
      tipo: txt(x['tipo_item']) === 'procedimento' ? 1 : 2,
      sigtap: numOuNulo(x['sigtap']),
      quantidade: num(x['quantidade']),
      procedimento: numOuNulo(x['item_faturavel_id']),
      cbo: txtOuNulo(x['cbo']),
    }));
    const passagens: PassagemLeito[] = [];
    for (const parte of lotes(internacoes.map((i) => i.registro))) {
      const ls = await this.l.consultar(
        `SELECT o.internacao_id, ${dia('o.data_hora_inicio')} AS entrada, ${dia('o.data_hora_fim')} AS saida,
                COALESCE(a.codigo_enfermaria_aih, o.acomodacao_id) AS acomodacao
           FROM ocupacao_leito o LEFT JOIN acomodacao a ON a.id = o.acomodacao_id
          WHERE o.estabelecimento_id = ? AND o.excluido_em IS NULL AND o.internacao_id IN (${marcadores(parte.length)})
          ORDER BY o.internacao_id, o.data_hora_inicio, o.id`,
        [this.est, ...parte],
        { teto: TETO_PRODUCAO },
      );
      for (const x of ls)
        passagens.push({
          registro: num(x['internacao_id']),
          entrada: txt(x['entrada']),
          saida: txtOuNulo(x['saida']),
          acomodacao: num(x['acomodacao']),
        });
    }
    const porCodigo: { id: number; codigo: string; nome: string }[] = [];
    for (const c of [...new Set(codigos)]) {
      const x = await this.apoio.sigtapPorCodigo(c);
      if (x) porCodigo.push(x);
    }
    const s = await this.apoio.sigtapDosIds([
      ...sigtapExtra,
      ...porCodigo.map((p) => p.id),
      ...itens.map((x) => x.sigtap ?? 0).filter((n) => n > 0),
    ]);
    const cids = new Set<string>();
    for (const i of internacoes) {
      if (i.cidPrincipal) cids.add(i.cidPrincipal);
      if (i.cidSecundario) cids.add(i.cidSecundario);
    }
    return {
      internacoes,
      itens,
      passagens,
      procedimentos: s.procedimentos,
      historico: [],
      registros: s.registros,
      compatibilidades: s.compatibilidades,
      porCodigo,
      cids,
      leitosUti: await this.apoio.leitosUti(),
      cnesCadastrados: await this.apoio.cnesCadastrados(),
    };
  }

  /** Os lotes dos itens das contas da internação (a rastreabilidade da OPM no espelho). */
  async lotesSaida(registro: number): Promise<LoteSaida[]> {
    const ls = await this.l.consultar(
      `SELECT ci.item_faturavel_id, f.descricao, SUM(ci.quantidade) AS quantidade, ci.numero_lote
         FROM internacao i
         JOIN conta_hospitalar c ON c.atendimento_id = i.atendimento_id AND c.excluido_em IS NULL
         JOIN conta_hospitalar_item ci ON ci.conta_hospitalar_id = c.id AND ci.excluido_em IS NULL
         JOIN item_faturavel f ON f.id = ci.item_faturavel_id
        WHERE i.id = ? AND i.estabelecimento_id = ? AND ci.numero_lote IS NOT NULL AND ci.numero_lote <> ''
        GROUP BY ci.item_faturavel_id, f.descricao, ci.numero_lote
        ORDER BY ci.item_faturavel_id, ci.numero_lote`,
      [registro, this.est],
      { teto: 5_000 },
    );
    return ls.map((x) => ({
      item: num(x['item_faturavel_id']),
      nome: txt(x['descricao']),
      quantidade: num(x['quantidade']),
      lote: txt(x['numero_lote']),
    }));
  }
}
