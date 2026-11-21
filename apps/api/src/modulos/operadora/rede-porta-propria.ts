// Porta própria da rede credenciada da operadora (M56, etapa 4; F2.2 lote 02-10) sobre o banco do cliente pelo
// @sgh/nucleo:
//   - leituras numa transação curta só de leitura, sempre no estabelecimento da sessão e sem as linhas excluídas:
//     prestador_rede (com UF, município, tipo, natureza e regime pelos cadastros), o contrato vigente
//     (contrato_rede_prestador), o último histórico da situação (prestador_rede_historico) e os movimentos do registro
//     de prestadores da ANS (movimento_rede_ans);
//   - gravações pelo Executor (uma operação por gravação, tabelas declaradas, trava otimista pela versão, trilha e
//     idempotência na mesma transação): credenciar, alterar, descredenciar e reincluir.
// A situação vigente é do relógio do banco: o descredenciamento com data futura deixa o prestador credenciado, com a
// saída agendada, até a data efetiva.
// Melhoria: o contrato escrito fica no cadastro próprio (com número único por operadora, vigência e reajuste conferidos
// por CHECK) e a reinclusão abre contrato novo, encerrando o anterior; antes, campos soltos do prestador.
// Melhoria: o documento, o código do prestador e o contrato são únicos no banco (UNIQUE); a recusa sai com o campo.
// Melhoria: cada mudança de situação deixa uma linha de histórico com o motivo, a vigência e o retrato.
// Melhoria: a reinclusão distingue a saída agendada (só desfaz o descredenciamento, o contrato segue) do descredenciado
// de fato (o contrato de mesmo número é reaberto; número novo encerra os abertos e abre outro).
import {
  CLASSIFICACOES_REDE,
  CONTRATACOES_PRESTADOR,
  DISPONIBILIDADES_SERVICO,
  FORMAS_REAJUSTE,
  ISENCOES_ONUS,
  MODELOS_REMUNERACAO,
  MOVIMENTOS_REDE,
} from '@sgh/contratos';
import {
  definirOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type Linha,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  booleano,
  contextoDireto,
  dataIso,
  dominioAusente,
  estabelecimentoDaSessao,
  instanteIso,
  inteiro,
  type MapaRestricoes,
  type NucleoOperadora,
  semEstabelecimento,
  texto,
  textoObrigatorio,
  traduzirRestricao,
  trechoLike,
} from './apoio-banco.js';
import type {
  CamposPrestador,
  ContextoRede,
  ConvenioRede,
  DominioRede,
  FiltroMovimentosPorta,
  FiltroPrestadores,
  GravacaoRede,
  GravadorRede,
  ItemDominioRede,
  MovimentoRede,
  PortaRedeOperadora,
  Prestador,
  TotaisRede,
} from './rede-porta.js';
import { LIMITE_PAGINA_MOVIMENTOS, LIMITE_PAGINA_PRESTADORES } from './rede-porta.js';
import {
  CLASSIFICACAO,
  CONTRATACAO,
  DISPONIBILIDADE,
  FORMA_REAJUSTE,
  ISENCAO_ONUS,
  MOVIMENTO_REDE,
  PESSOA,
  REMUNERACAO,
  type Vocabulario,
} from './vocabulario-banco.js';

/** Tabelas que as gravações da rede escrevem (a transação recusa as outras). */
export const TABELAS_REDE = [
  'prestador_rede',
  'prestador_rede_historico',
  'contrato_rede_prestador',
  'movimento_rede_ans',
  'sequencia_negocio',
] as const;

const RESTRICOES: MapaRestricoes = {
  uq_prestador_rede_cpf: ['documento-ja-credenciado', 'Este CPF já está na rede da operadora.', 'documento'],
  uq_prestador_rede_cnpj: ['documento-ja-credenciado', 'Este CNPJ já está na rede da operadora.', 'documento'],
  uq_prestador_rede_codigo: ['codigo-em-uso', 'O código gerado para o prestador já existe: tente de novo.', 'codigo'],
  uq_contrato_rede_prestador_numero: [
    'contrato-numero-em-uso',
    'Já existe contrato com este número na operadora.',
    'contrato.numero',
  ],
  ck_contrato_rede_prestador_vigencia: [
    'contrato-fim-antes-do-inicio',
    'O fim do contrato não pode ser antes do início.',
    'contrato.fim',
  ],
  ck_prestador_rede_intermediaria: [
    'intermediaria-obrigatoria',
    'Na contratação indireta, informe o registro na ANS da operadora intermediária.',
    'operadoraIntermediaria',
  ],
  ck_prestador_rede_documento: ['documento-invalido', 'O documento não confere com a pessoa.', 'documento'],
};

const desatualizado = () =>
  recusa(
    'prestador-desatualizado',
    'O prestador mudou depois que você abriu (outra pessoa gravou). Abra de novo e confira antes de gravar.',
    { campos: ['versao'] },
  );

/** A situação vigente no SQL (a saída agendada conta como credenciada até a data efetiva, no relógio do banco). */
const SQL_AGENDADA = `(p.situacao = 'descredenciado' AND p.descredenciado_em > CURRENT_DATE)`;
const SQL_VIGENTE_CREDENCIADO = `(p.situacao IN ('credenciado','suspenso') OR ${SQL_AGENDADA})`;
const SQL_VIGENTE_DESCREDENCIADO = `(p.situacao = 'descredenciado' AND (p.descredenciado_em IS NULL OR p.descredenciado_em <= CURRENT_DATE))`;

/**
 * O prestador completo: com o regime e o contrato escrito (o credenciamento grava os dois; a carga do conector também
 * tem de gravá-los). Sem eles o cadastro não vai à tela nem às contagens (pedido ao conector registrado).
 */
const SQL_COMPLETO = `p.regime_atendimento_rede_id IS NOT NULL AND EXISTS (SELECT 1 FROM contrato_rede_prestador cx
  WHERE cx.prestador_rede_id = p.id AND cx.excluido_em IS NULL)`;

const SELECT_PRESTADOR = `
  SELECT p.id, p.pessoa, p.cpf, p.cnpj, p.nome, p.nome_fantasia, p.codigo_cnes, uf.sigla AS uf, mi.codigo_ibge,
         tp.codigo AS tipo, np.codigo AS natureza, ra.codigo AS regime, p.classificacao, p.contratacao,
         p.operadora_intermediaria_registro_ans, p.disponibilidade, p.isencao_onus, p.atende_urgencia,
         p.forma_remuneracao, p.proprio, est.codigo AS estabelecimento, p.fonte_pagadora_id, p.situacao,
         p.situacao_em, p.descredenciado_em, ${SQL_AGENDADA} AS saida_agendada, p.versao, p.criado_em,
         COALESCE(p.alterado_em, p.criado_em) AS alterado_em, uc.login AS criado_por,
         COALESCE(ua.login, uc.login) AS alterado_por,
         c.numero AS contrato_numero, c.inicio AS contrato_inicio, c.fim AS contrato_fim,
         c.forma_reajuste AS contrato_forma_reajuste, c.mes_reajuste AS contrato_mes_reajuste,
         h.motivo AS motivo_situacao, JSON_VALUE(h.dados, '$.substituto') AS substituto,
         JSON_VALUE(h.dados, '$.avisoBeneficiariosEm') AS aviso_beneficiarios_em,
         JSON_VALUE(h.dados, '$.autorizacaoAns') AS autorizacao_ans
    FROM prestador_rede p
    JOIN unidade_federativa uf ON uf.id = p.unidade_federativa_id
    JOIN municipio_ibge mi ON mi.id = p.municipio_ibge_id
    JOIN tipo_prestador_rede tp ON tp.id = p.tipo_prestador_rede_id
    JOIN natureza_prestador_rede np ON np.id = p.natureza_prestador_rede_id
    LEFT JOIN regime_atendimento_rede ra ON ra.id = p.regime_atendimento_rede_id
    LEFT JOIN estabelecimento est ON est.id = p.proprio_estabelecimento_id
    LEFT JOIN usuario uc ON uc.id = p.criado_por
    LEFT JOIN usuario ua ON ua.id = p.alterado_por
    LEFT JOIN contrato_rede_prestador c ON c.id = (
         SELECT c2.id FROM contrato_rede_prestador c2
          WHERE c2.prestador_rede_id = p.id AND c2.excluido_em IS NULL
          ORDER BY (c2.situacao = 'vigente') DESC, c2.inicio DESC, c2.id DESC LIMIT 1)
    LEFT JOIN prestador_rede_historico h ON h.id = (
         SELECT h2.id FROM prestador_rede_historico h2
          WHERE h2.prestador_rede_id = p.id AND h2.situacao_nova = p.situacao
          ORDER BY h2.id DESC LIMIT 1)
   WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND ${SQL_COMPLETO}`;

const numeroDoCodigo = (v: unknown): number | null => {
  const t = texto(v);
  return t && /^\d{1,5}$/.test(t) ? Number(t) : null;
};

export function prestadorDaLinha(x: Linha): Prestador {
  const pessoa = PESSOA.codigo(x['pessoa']) ?? 'J';
  const agendada = booleano(x['saida_agendada']);
  const gravada = textoObrigatorio(x['situacao']);
  const numeroContrato = texto(x['contrato_numero']);
  const inicio = dataIso(x['contrato_inicio']);
  const forma = FORMA_REAJUSTE.codigo(x['contrato_forma_reajuste']);
  const mes = inteiro(x['contrato_mes_reajuste']);
  const situacaoEm = dataIso(x['situacao_em']) ?? '';
  return {
    id: Number(x['id']),
    pessoa,
    documento: textoObrigatorio(pessoa === 'F' ? x['cpf'] : x['cnpj']),
    nome: textoObrigatorio(x['nome']),
    nomeFantasia: texto(x['nome_fantasia']),
    cnes: texto(x['codigo_cnes']),
    uf: textoObrigatorio(x['uf']),
    municipioIbge: inteiro(x['codigo_ibge']) ?? 0,
    tipo: numeroDoCodigo(x['tipo']) ?? 0,
    natureza: numeroDoCodigo(x['natureza']) ?? 0,
    classificacao: CLASSIFICACAO.codigo(x['classificacao']) ?? 0,
    contratacao: CONTRATACAO.codigo(x['contratacao']) ?? 0,
    operadoraIntermediaria: texto(x['operadora_intermediaria_registro_ans']),
    disponibilidade: DISPONIBILIDADE.codigo(x['disponibilidade']) ?? 0,
    isencaoOnus: ISENCAO_ONUS.codigo(x['isencao_onus']) ?? 0,
    urgencia: booleano(x['atende_urgencia']),
    regime: numeroDoCodigo(x['regime']) ?? 0,
    remuneracao: REMUNERACAO.codigo(x['forma_remuneracao']) ?? 0,
    contrato: {
      numero: numeroContrato ?? '',
      inicio: inicio ?? '',
      fim: dataIso(x['contrato_fim']),
      formaReajuste: forma ?? 0,
      mesReajuste: mes ?? 1,
    },
    ehOHospital: booleano(x['proprio']),
    estabelecimento: texto(x['estabelecimento']),
    convenio: inteiro(x['fonte_pagadora_id']),
    situacao: gravada === 'descredenciado' && !agendada ? 'descredenciado' : 'credenciado',
    // Descredenciado (vigente ou com a saída agendada): a data efetiva da saída.
    situacaoEm: gravada === 'descredenciado' ? (dataIso(x['descredenciado_em']) ?? situacaoEm) : situacaoEm,
    saidaEm: agendada ? (dataIso(x['descredenciado_em']) ?? null) : null,
    motivoSituacao: texto(x['motivo_situacao']),
    substituto: inteiro(x['substituto']),
    avisoBeneficiariosEm: dataIso(x['aviso_beneficiarios_em']),
    autorizacaoAns: texto(x['autorizacao_ans']),
    versao: Number(x['versao']),
    criadoEm: instanteIso(x['criado_em']) ?? '',
    criadoPor: texto(x['criado_por']) ?? 'sistema',
    alteradoEm: instanteIso(x['alterado_em']) ?? '',
    alteradoPor: texto(x['alterado_por']) ?? 'sistema',
  };
}

const lerJson = (v: unknown): Record<string, unknown> => {
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  if (typeof v !== 'string') return {};
  try {
    const o: unknown = JSON.parse(v);
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const opcoesFixas = (o: Readonly<Record<number, string>>, v: Vocabulario<number>): ItemDominioRede[] =>
  v.codigos().map((codigo) => ({ codigo, rotulo: o[codigo] ?? String(codigo) }));

/** Entrada das operações (o gravador já entrega o objeto montado; a operação só confere a forma). */
const esquemaEntrada = z.record(z.string(), z.unknown());

export class PortaRedeOperadoraPropria implements PortaRedeOperadora {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoOperadora,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoRede, fn: (l: Leitor, est: number) => Promise<T>, vazio: T): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'operadora-rede' }, async (l) => {
      const est = await estabelecimentoDaSessao(c, l);
      return est === null ? vazio : fn(l, est);
    });
  }

  async hoje(c: ContextoRede): Promise<string> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'operadora-rede' }, async (l) => {
      const r = await l.uma<{ hoje: unknown }>('SELECT CURRENT_DATE AS hoje');
      return dataIso(r?.['hoje']) ?? new Date().toISOString().slice(0, 10);
    });
  }

  async dominios(c: ContextoRede): Promise<Record<DominioRede, ItemDominioRede[]>> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'operadora-rede' }, async (l) => {
      // Cadastros do cliente com o código do padrão da ANS (só os códigos numéricos; a lista é pequena).
      const dominio = async (tabela: 'tipo_prestador_rede' | 'natureza_prestador_rede' | 'regime_atendimento_rede') =>
        (
          await l.consultar(
            `SELECT codigo, descricao FROM ${tabela} WHERE ativo = TRUE AND codigo REGEXP '^[0-9]{1,5}$' ORDER BY CAST(codigo AS UNSIGNED)`,
            [],
            { teto: 200 },
          )
        ).map((x) => ({ codigo: Number(x['codigo']), rotulo: textoObrigatorio(x['descricao']) }));
      return {
        tipo: await dominio('tipo_prestador_rede'),
        natureza: await dominio('natureza_prestador_rede'),
        regime: await dominio('regime_atendimento_rede'),
        classificacao: opcoesFixas(CLASSIFICACOES_REDE, CLASSIFICACAO),
        contratacao: opcoesFixas(CONTRATACOES_PRESTADOR, CONTRATACAO),
        disponibilidade: opcoesFixas(DISPONIBILIDADES_SERVICO, DISPONIBILIDADE),
        isencaoOnus: opcoesFixas(ISENCOES_ONUS, ISENCAO_ONUS),
        remuneracao: opcoesFixas(MODELOS_REMUNERACAO, REMUNERACAO),
        formaReajuste: opcoesFixas(FORMAS_REAJUSTE, FORMA_REAJUSTE),
        movimento: opcoesFixas(MOVIMENTOS_REDE, MOVIMENTO_REDE),
      };
    });
  }

  convenios(c: ContextoRede): Promise<ConvenioRede[]> {
    return this.ler(
      c,
      async (l, est) =>
        (
          await l.consultar(
            `SELECT f.id, f.nome, f.registro_ans FROM fonte_pagadora f
              WHERE f.excluido_em IS NULL AND f.situacao = 'ativa'
                AND EXISTS (SELECT 1 FROM fonte_pagadora_estabelecimento fe
                             WHERE fe.fonte_pagadora_id = f.id AND fe.estabelecimento_id = ? AND fe.excluido_em IS NULL)
              ORDER BY f.nome, f.id`,
            [est],
            { teto: 2_000 },
          )
        ).map((x) => ({
          codigo: Number(x['id']),
          nome: textoObrigatorio(x['nome']),
          registroAns: inteiro(texto(x['registro_ans'])?.replace(/\D/g, '') || null),
        })),
      [],
    );
  }

  prestadores(
    c: ContextoRede,
    f: FiltroPrestadores,
  ): Promise<{ itens: Prestador[]; proxima: { nome: string; id: number } | null }> {
    const limite = Math.min(Math.max(1, Math.trunc(f.limite ?? LIMITE_PAGINA_PRESTADORES)), LIMITE_PAGINA_PRESTADORES);
    return this.ler(
      c,
      async (l, est) => {
        const onde: string[] = [];
        const ps: unknown[] = [est];
        const busca = f.busca?.trim() ?? '';
        if (busca) {
          const doc = busca.replace(/[.\-/\s]/g, '').toUpperCase();
          if (/^\d{7}$/.test(doc)) {
            onde.push('(p.codigo_cnes = ? OR p.cpf = ? OR p.cnpj = ?)');
            ps.push(doc, doc, doc);
          } else if (/^[0-9A-Z]{11,14}$/.test(doc) && /\d/.test(doc)) {
            onde.push('(p.cpf = ? OR p.cnpj = ?)');
            ps.push(doc, doc);
          } else {
            onde.push("p.nome LIKE ? ESCAPE '\\\\'");
            ps.push(trechoLike(busca.replace(/\s+/g, ' ').slice(0, 60)));
          }
        }
        if (f.situacao) onde.push(f.situacao === 'credenciado' ? SQL_VIGENTE_CREDENCIADO : SQL_VIGENTE_DESCREDENCIADO);
        if (f.tipo !== undefined) {
          onde.push('tp.codigo = ?');
          ps.push(String(f.tipo));
        }
        if (f.apos) {
          onde.push('(p.nome > ? OR (p.nome = ? AND p.id > ?))');
          ps.push(f.apos.nome, f.apos.nome, f.apos.id);
        }
        const r = await l.consultar(
          `${SELECT_PRESTADOR}${onde.length ? ` AND ${onde.join(' AND ')}` : ''} ORDER BY p.nome, p.id LIMIT ${limite + 1}`,
          ps,
          { teto: limite + 1 },
        );
        const itens = r.slice(0, limite).map(prestadorDaLinha);
        const ultima = itens[limite - 1];
        return { itens, proxima: r.length > limite && ultima ? { nome: ultima.nome, id: ultima.id } : null };
      },
      { itens: [], proxima: null },
    );
  }

  prestador(c: ContextoRede, id: number): Promise<Prestador | null> {
    return this.ler(
      c,
      async (l, est) => {
        const x = await l.uma(`${SELECT_PRESTADOR} AND p.id = ?`, [est, id]);
        return x ? prestadorDaLinha(x) : null;
      },
      null,
    );
  }

  totais(c: ContextoRede): Promise<TotaisRede> {
    const zero: TotaisRede = { credenciados: 0, descredenciados: 0, hospitalares: 0, saidasAgendadas: 0, rpsPendentes: 0 };
    return this.ler(
      c,
      async (l, est) => {
        const p = await l.uma(
          `SELECT SUM(CASE WHEN ${SQL_VIGENTE_CREDENCIADO} THEN 1 ELSE 0 END) AS c,
                  SUM(CASE WHEN ${SQL_VIGENTE_DESCREDENCIADO} THEN 1 ELSE 0 END) AS d,
                  SUM(CASE WHEN ${SQL_VIGENTE_CREDENCIADO} AND (tp.codigo = '3' OR p.classificacao = 'assistencia_hospitalar')
                           THEN 1 ELSE 0 END) AS h,
                  SUM(CASE WHEN ${SQL_AGENDADA} THEN 1 ELSE 0 END) AS a
             FROM prestador_rede p JOIN tipo_prestador_rede tp ON tp.id = p.tipo_prestador_rede_id
            WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND ${SQL_COMPLETO}`,
          [est],
        );
        const m = await l.uma(
          `SELECT COUNT(*) AS n FROM movimento_rede_ans m JOIN prestador_rede p ON p.id = m.prestador_rede_id
            WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND m.envio_ans_id IS NULL`,
          [est],
        );
        return {
          credenciados: inteiro(p?.['c']) ?? 0,
          descredenciados: inteiro(p?.['d']) ?? 0,
          hospitalares: inteiro(p?.['h']) ?? 0,
          saidasAgendadas: inteiro(p?.['a']) ?? 0,
          rpsPendentes: inteiro(m?.['n']) ?? 0,
        };
      },
      zero,
    );
  }

  movimentos(c: ContextoRede, f: FiltroMovimentosPorta): Promise<{ itens: MovimentoRede[]; proxima: number | null }> {
    const limite = LIMITE_PAGINA_MOVIMENTOS;
    return this.ler(
      c,
      async (l, est) => {
        const onde = ['p.estabelecimento_id = ?', 'p.excluido_em IS NULL'];
        const ps: unknown[] = [est];
        if (f.situacao) onde.push(f.situacao === 'pendente' ? 'm.envio_ans_id IS NULL' : 'm.envio_ans_id IS NOT NULL');
        if (f.prestador !== undefined) {
          onde.push('m.prestador_rede_id = ?');
          ps.push(f.prestador);
        }
        if (f.apos !== undefined) {
          onde.push('m.id < ?');
          ps.push(f.apos);
        }
        const r = await l.consultar(
          `SELECT m.id, m.prestador_rede_id, p.nome, m.tipo_movimento, m.dados, m.envio_ans_id, m.ocorrido_em,
                  u.login
             FROM movimento_rede_ans m
             JOIN prestador_rede p ON p.id = m.prestador_rede_id
             LEFT JOIN usuario u ON u.id = m.usuario_id
            WHERE ${onde.join(' AND ')} ORDER BY m.id DESC LIMIT ${limite + 1}`,
          ps,
          { teto: limite + 1 },
        );
        const itens = r.slice(0, limite).map((x): MovimentoRede => {
          const d = lerJson(x['dados']);
          const campos = Array.isArray(d['campos']) ? d['campos'].filter((v): v is string => typeof v === 'string') : [];
          return {
            id: Number(x['id']),
            prestador: Number(x['prestador_rede_id']),
            prestadorNome: textoObrigatorio(x['nome']),
            movimento: MOVIMENTO_REDE.codigo(x['tipo_movimento']) ?? 0,
            campos,
            motivo: typeof d['motivo'] === 'string' && d['motivo'] ? d['motivo'] : null,
            situacao: x['envio_ans_id'] === null || x['envio_ans_id'] === undefined ? 'pendente' : 'enviado',
            registradoEm: instanteIso(x['ocorrido_em']) ?? '',
            registradoPor: texto(x['login']) ?? 'sistema',
          };
        });
        return { itens, proxima: r.length > limite ? (itens[itens.length - 1]?.id ?? null) : null };
      },
      { itens: [], proxima: null },
    );
  }

  async gravar<T extends GravacaoRede>(
    c: ContextoRede,
    trilha: RegistroTrilhaTela | ((r: T) => RegistroTrilhaTela),
    fn: (g: GravadorRede) => Promise<T>,
  ): Promise<T> {
    const est = await this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'operadora-rede' }, (l) =>
      estabelecimentoDaSessao(c, l),
    );
    if (est === null) throw semEstabelecimento();
    const fixa = typeof trilha === 'function' ? null : trilha;
    const operacao = definirOperacao<Record<string, unknown>, T>({
      nome: 'operadora.rede.gravacao',
      tabelas: TABELAS_REDE,
      entrada: esquemaEntrada,
      acao: 'operacao',
      gravar: async (tx) => {
        try {
          return await fn(new GravadorRedeBanco(tx, est));
        } catch (e) {
          throw traduzirRestricao(e, RESTRICOES);
        }
      },
      alvo: (_e, r) => ({ tabela: 'prestador_rede', id: r.id }),
      trilha: (_e, r) => {
        const l = typeof trilha === 'function' ? trilha(r) : trilha;
        return { dados: l.dadosDepois, motivo: l.motivo ?? null };
      },
    });
    const r = await this.executor.executar(operacao, this.cliente, {}, contextoDireto(this.cliente, est, c, fixa));
    return r.resultado;
  }
}

/** O gravador da rede sobre a transação da operação (o estabelecimento é o da sessão). */
class GravadorRedeBanco implements GravadorRede {
  constructor(
    private readonly tx: TxOperacao,
    private readonly est: number,
  ) {}

  private async hoje(): Promise<string> {
    const r = await this.tx.uma<{ hoje: unknown }>('SELECT CURRENT_DATE AS hoje');
    return dataIso(r?.['hoje']) ?? new Date().toISOString().slice(0, 10);
  }

  private async idDoCodigo(tabela: string, codigo: number, rotulo: string, campo: string): Promise<number> {
    const r = await this.tx.uma<{ id: unknown }>(`SELECT id FROM ${tabela} WHERE codigo = ? AND ativo = TRUE`, [String(codigo)]);
    if (!r) throw dominioAusente(rotulo, campo);
    return Number(r['id']);
  }

  private valor(v: Vocabulario<number>, c: number, campo: string): string {
    const b = v.banco(c);
    if (b === null) throw recusa('dominio-invalido', 'Código fora do domínio aceito.', { campos: [campo] });
    return b;
  }

  /** As colunas do prestador a partir dos campos da tela (cadastros resolvidos por código; recusa com o campo). */
  private async colunas(x: CamposPrestador, proprioId: number | null): Promise<Record<string, unknown>> {
    const mun = await this.tx.uma(
      `SELECT mi.id, mi.unidade_federativa_id, uf.sigla FROM municipio_ibge mi
         JOIN unidade_federativa uf ON uf.id = mi.unidade_federativa_id WHERE mi.codigo_ibge = ?`,
      [String(x.municipioIbge).padStart(7, '0')],
    );
    if (!mun) throw recusa('municipio-inexistente', 'O município não está no cadastro do IBGE do cliente.', { campos: ['municipioIbge'] });
    if (textoObrigatorio(mun['sigla']) !== x.uf)
      throw recusa('municipio-fora-da-uf', 'O município não é da UF informada.', { campos: ['municipioIbge'] });
    if (x.convenio !== null) {
      const f = await this.tx.uma(
        `SELECT f.id FROM fonte_pagadora f WHERE f.id = ? AND f.excluido_em IS NULL
            AND EXISTS (SELECT 1 FROM fonte_pagadora_estabelecimento fe
                         WHERE fe.fonte_pagadora_id = f.id AND fe.estabelecimento_id = ? AND fe.excluido_em IS NULL)`,
        [x.convenio, this.est],
      );
      if (!f) throw recusa('convenio-inexistente', 'O convênio não está no cadastro do estabelecimento.', { campos: ['convenio'] });
    }
    return {
      nome: x.nome,
      nome_fantasia: x.nomeFantasia,
      codigo_cnes: x.cnes,
      municipio_ibge_id: Number(mun['id']),
      unidade_federativa_id: Number(mun['unidade_federativa_id']),
      tipo_prestador_rede_id: await this.idDoCodigo('tipo_prestador_rede', x.tipo, 'tipos de prestador', 'tipo'),
      natureza_prestador_rede_id: await this.idDoCodigo('natureza_prestador_rede', x.natureza, 'naturezas de prestador', 'natureza'),
      regime_atendimento_rede_id: await this.idDoCodigo('regime_atendimento_rede', x.regime, 'regimes de atendimento', 'regime'),
      classificacao: this.valor(CLASSIFICACAO, x.classificacao, 'classificacao'),
      contratacao: this.valor(CONTRATACAO, x.contratacao, 'contratacao'),
      operadora_intermediaria_registro_ans: x.operadoraIntermediaria,
      disponibilidade: this.valor(DISPONIBILIDADE, x.disponibilidade, 'disponibilidade'),
      isencao_onus: this.valor(ISENCAO_ONUS, x.isencaoOnus, 'isencaoOnus'),
      forma_remuneracao: this.valor(REMUNERACAO, x.remuneracao, 'remuneracao'),
      atende_urgencia: x.urgencia,
      proprio: x.ehOHospital,
      proprio_estabelecimento_id: proprioId,
      fonte_pagadora_id: x.convenio,
    };
  }

  /** O estabelecimento próprio pelo código (só quando é o próprio hospital) e a unicidade dele na rede. */
  private async proprio(x: CamposPrestador, exceto: number | null): Promise<number | null> {
    if (!x.ehOHospital || !x.estabelecimento) return null;
    const e = await this.tx.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [x.estabelecimento]);
    if (!e) throw recusa('estabelecimento-inexistente', 'O estabelecimento da Rede não existe.', { campos: ['estabelecimento'] });
    const id = Number(e['id']);
    const outro = await this.tx.uma(
      `SELECT id FROM prestador_rede WHERE estabelecimento_id = ? AND proprio_estabelecimento_id = ? AND excluido_em IS NULL
          AND id <> ?`,
      [this.est, id, exceto ?? 0],
    );
    if (outro)
      throw recusa('hospital-ja-na-rede', 'Este estabelecimento da Rede já está credenciado como prestador da operadora.', {
        campos: ['estabelecimento'],
      });
    return id;
  }

  /** A operadora do estabelecimento (vigente; a principal primeiro): o contrato com o prestador é dela. */
  private async operadora(): Promise<number> {
    const r = await this.tx.uma(
      `SELECT operadora_saude_id FROM operadora_saude_estabelecimento
        WHERE estabelecimento_id = ? AND excluido_em IS NULL AND vigencia_inicio <= CURRENT_DATE
          AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
        ORDER BY principal DESC, vigencia_inicio DESC, id DESC LIMIT 1`,
      [this.est],
    );
    if (!r)
      throw recusa(
        'operadora-nao-cadastrada',
        'O estabelecimento não tem operadora cadastrada: cadastre a operadora antes de credenciar a rede.',
      );
    return Number(r['operadora_saude_id']);
  }

  private async incluirContrato(prestador: number, x: Pick<CamposPrestador, 'contrato' | 'contratacao'>, regime: unknown) {
    return this.tx.incluir('contrato_rede_prestador', {
      estabelecimento_id: this.est,
      operadora_saude_id: await this.operadora(),
      prestador_rede_id: prestador,
      numero: x.contrato.numero,
      regime_atendimento_rede_id: regime,
      relacao: x.contratacao === 2 ? 'indireta' : 'direta',
      inicio: x.contrato.inicio,
      fim: x.contrato.fim,
      tipo_vigencia: x.contrato.fim ? 'determinada' : 'indeterminada',
      forma_reajuste: this.valor(FORMA_REAJUSTE, x.contrato.formaReajuste, 'contrato.formaReajuste'),
      mes_reajuste: x.contrato.mesReajuste,
      situacao: 'vigente',
      assinado_em: x.contrato.inicio,
    });
  }

  private async historico(
    prestador: number,
    operacao: 'inclusao' | 'alteracao',
    antes: string | null,
    depois: string,
    vigencia: string,
    motivo: string | null,
    dados: Record<string, unknown>,
  ): Promise<void> {
    await this.tx.incluir('prestador_rede_historico', {
      prestador_rede_id: prestador,
      operacao,
      dados: JSON.stringify(dados),
      ocorrido_em: new Date(),
      usuario_id: this.tx.contexto.usuario,
      situacao_anterior: antes,
      situacao_nova: depois,
      vigencia,
      motivo,
    });
  }

  private async movimento(
    prestador: number,
    tipo: 1 | 2 | 3 | 4,
    campos: readonly string[],
    motivo: string | null,
    hoje: string,
  ): Promise<number> {
    const codigo = MOVIMENTO_REDE.banco(tipo) ?? 'inclusao';
    const s = await this.tx.uma('SELECT id FROM situacao_movimento_rede WHERE codigo = ? AND ativo = TRUE', [codigo]);
    if (!s) throw dominioAusente('situações do movimento da rede', 'movimento');
    return this.tx.incluir('movimento_rede_ans', {
      prestador_rede_id: prestador,
      operacao: 'inclusao',
      dados: JSON.stringify({ campos: [...campos], motivo }),
      ocorrido_em: new Date(),
      usuario_id: this.tx.contexto.usuario,
      tipo_movimento: codigo,
      data_movimento: hoje,
      situacao_movimento_rede_id: Number(s['id']),
    });
  }

  /** Trava o prestador do estabelecimento e confere a versão vista (e a situação, quando pedida). */
  private async travar(id: number, versao: number): Promise<Linha> {
    const [p] = await this.tx.consultarParaAtualizar(
      `SELECT id, versao, situacao, descredenciado_em, (situacao = 'descredenciado' AND descredenciado_em > CURRENT_DATE) AS agendada,
              pessoa, cpf, cnpj
         FROM prestador_rede WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [id, this.est],
      { teto: 1 },
    );
    if (!p || Number(p['versao']) !== versao) throw desatualizado();
    return p;
  }

  async credenciar(x: Parameters<GravadorRede['credenciar']>[0]) {
    const hoje = await this.hoje();
    const proprioId = await this.proprio(x, null);
    const colunas = await this.colunas(x, proprioId);
    await garantirSequencia(
      this.tx,
      { tipo: 'prestador_rede', estabelecimento: this.est },
      { usuario: this.tx.contexto.usuario, agora: new Date() },
    );
    const codigo = await this.tx.proximoNumero('prestador_rede');
    const pessoa = PESSOA.banco(x.pessoa) ?? 'juridica';
    const id = await this.tx.incluir('prestador_rede', {
      ...colunas,
      estabelecimento_id: this.est,
      codigo: codigo.formatado,
      pessoa,
      cpf: x.pessoa === 'F' ? x.documento : null,
      cnpj: x.pessoa === 'J' ? x.documento : null,
      credenciado_em: hoje,
      situacao: 'credenciado',
      situacao_em: hoje,
    });
    await this.incluirContrato(id, x, colunas['regime_atendimento_rede_id']);
    await this.historico(id, 'inclusao', null, 'credenciado', hoje, null, { codigo: codigo.formatado });
    const movimento = await this.movimento(id, 1, [], null, hoje);
    return { id, versao: 1, movimento };
  }

  async alterar(x: Parameters<GravadorRede['alterar']>[0]) {
    const atual = await this.travar(x.id, x.versao);
    if (textoObrigatorio(atual['situacao']) === 'descredenciado') throw desatualizado();
    const proprioId = await this.proprio(x, x.id);
    const colunas = await this.colunas(x, proprioId);
    const versao = await this.tx.alterar('prestador_rede', x.id, x.versao, colunas);
    // O contrato vigente acompanha a alteração (número, vigência e reajuste); sem contrato (carga), abre um.
    const c = await this.tx.uma(
      `SELECT id, versao, numero, inicio, fim, forma_reajuste, mes_reajuste FROM contrato_rede_prestador
        WHERE prestador_rede_id = ? AND excluido_em IS NULL ORDER BY (situacao = 'vigente') DESC, inicio DESC, id DESC LIMIT 1`,
      [x.id],
    );
    const forma = this.valor(FORMA_REAJUSTE, x.contrato.formaReajuste, 'contrato.formaReajuste');
    if (!c) await this.incluirContrato(x.id, x, colunas['regime_atendimento_rede_id']);
    else
      await this.tx.alterar('contrato_rede_prestador', Number(c['id']), Number(c['versao']), {
        numero: x.contrato.numero,
        inicio: x.contrato.inicio,
        fim: x.contrato.fim,
        tipo_vigencia: x.contrato.fim ? 'determinada' : 'indeterminada',
        forma_reajuste: forma,
        mes_reajuste: x.contrato.mesReajuste,
        regime_atendimento_rede_id: colunas['regime_atendimento_rede_id'],
        relacao: x.contratacao === 2 ? 'indireta' : 'direta',
      });
    const hoje = await this.hoje();
    const movimento = x.camposRps.length ? await this.movimento(x.id, 2, x.camposRps, null, hoje) : null;
    return { id: x.id, versao, movimento };
  }

  async descredenciar(x: Parameters<GravadorRede['descredenciar']>[0]) {
    const atual = await this.travar(x.id, x.versao);
    if (textoObrigatorio(atual['situacao']) === 'descredenciado') throw desatualizado();
    if (x.substituto !== null) {
      const s = await this.tx.uma(
        `SELECT id FROM prestador_rede p WHERE p.id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL
            AND p.situacao IN ('credenciado','suspenso')`,
        [x.substituto, this.est],
      );
      if (!s)
        throw recusa('substituto-nao-credenciado', 'O substituto não está credenciado na rede.', { campos: ['substituto'] });
    }
    const hoje = await this.hoje();
    const versao = await this.tx.alterar('prestador_rede', x.id, x.versao, {
      situacao: 'descredenciado',
      situacao_em: hoje,
      descredenciado_em: x.efetivoEm,
    });
    await this.historico(x.id, 'alteracao', textoObrigatorio(atual['situacao']), 'descredenciado', x.efetivoEm, x.motivo, {
      substituto: x.substituto,
      avisoBeneficiariosEm: x.avisoBeneficiariosEm,
      autorizacaoAns: x.autorizacaoAns,
    });
    const movimento = await this.movimento(x.id, 3, [], x.motivo, hoje);
    return { id: x.id, versao, movimento };
  }

  /**
   * Reinclusão em dois casos:
   *   - saída agendada (ainda credenciado): só desfaz o descredenciamento; o contrato vigente continua (a mesma linha,
   *     com os termos informados);
   *   - descredenciado de fato: o contrato com o mesmo número (deste prestador) é reaberto; com número novo, os abertos
   *     se encerram e entra o contrato novo. O número de outro prestador da operadora é recusado.
   */
  async reincluir(x: Parameters<GravadorRede['reincluir']>[0]) {
    const atual = await this.travar(x.id, x.versao);
    if (textoObrigatorio(atual['situacao']) !== 'descredenciado') throw desatualizado();
    const agendada = booleano(atual['agendada']);
    const hoje = await this.hoje();
    const p = await this.tx.uma('SELECT regime_atendimento_rede_id, contratacao FROM prestador_rede WHERE id = ?', [x.id]);
    const contratacao = CONTRATACAO.codigo(p?.['contratacao']) ?? 1;
    const regime = p?.['regime_atendimento_rede_id'] ?? null;
    const contratos = await this.tx.consultar(
      `SELECT id, versao, numero, situacao FROM contrato_rede_prestador
        WHERE prestador_rede_id = ? AND excluido_em IS NULL ORDER BY (situacao = 'vigente') DESC, inicio DESC, id DESC`,
      [x.id],
      { teto: 50 },
    );
    const abertos = contratos.filter((k) => ['rascunho', 'vigente', 'suspenso'].includes(textoObrigatorio(k['situacao'])));
    const termos = {
      numero: x.contrato.numero,
      inicio: x.contrato.inicio,
      fim: x.contrato.fim,
      tipo_vigencia: x.contrato.fim ? 'determinada' : 'indeterminada',
      forma_reajuste: this.valor(FORMA_REAJUSTE, x.contrato.formaReajuste, 'contrato.formaReajuste'),
      mes_reajuste: x.contrato.mesReajuste,
    };
    const mesmoNumero = contratos.find((k) => textoObrigatorio(k['numero']) === x.contrato.numero);
    // Saída agendada: o contrato vigente segue (o de mesmo número, senão o primeiro aberto).
    const manter = agendada ? (mesmoNumero && abertos.includes(mesmoNumero) ? mesmoNumero : abertos[0]) : mesmoNumero;
    for (const k of abertos)
      if (k !== manter)
        await this.tx.alterar('contrato_rede_prestador', Number(k['id']), Number(k['versao']), {
          situacao: 'encerrado',
          encerrado_em: hoje,
          motivo_encerramento: 'Prestador reincluído com outro contrato',
        });
    if (manter)
      await this.tx.alterar('contrato_rede_prestador', Number(manter['id']), Number(manter['versao']), {
        ...termos,
        situacao: 'vigente',
        encerrado_em: null,
        motivo_encerramento: null,
      });
    else await this.incluirContrato(x.id, { contrato: x.contrato, contratacao }, regime);
    const versao = await this.tx.alterar('prestador_rede', x.id, x.versao, {
      situacao: 'credenciado',
      situacao_em: hoje,
      descredenciado_em: null,
    });
    await this.historico(x.id, 'alteracao', 'descredenciado', 'credenciado', hoje, x.motivo, {
      saidaAgendadaCancelada: agendada,
    });
    const movimento = await this.movimento(x.id, 4, [], x.motivo, hoje);
    return { id: x.id, versao, movimento };
  }
}
