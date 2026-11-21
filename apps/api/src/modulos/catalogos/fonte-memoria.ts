// Fonte do M13 em MEMÓRIA (sessão sintética de dev/ci; E2E e testes HTTP): catálogos SINTÉTICOS (códigos em
// faixas que nenhum banco usa e a marca "SINTÉTICO"; nenhum dado real), a área de preparação em memória e a
// publicação dos lotes logo depois da aprovação (o papel do worker). Responsável por catálogo: este sistema
// para CID, SIGTAP, CEP, CBO, listas e fiscais; a carga como hoje para TUSS, Brasíndice e Simpro (o E2E prova a
// recusa). Nada conecta a banco.
import {
  type CodigoCatalogo,
  definicaoCatalogo,
  ENTIDADES_CONSULTA_CATALOGO,
  entidadeConsultaCatalogo,
} from '@sgh/contratos';
import { camposDaChave, LEIAUTE_CEP_PADRAO, type LeituraDoBanco } from '@sgh/dominio-catalogo';
import type {
  CargaDeCatalogo,
  ConsultaCatalogo,
  CtxCatalogos,
  FonteCatalogos,
  HistoricoSigtap,
  LinhaDaCarga,
  MudancaSituacaoCarga,
  PreparoCargaCatalogo,
  Trilha,
} from './fonte.js';

type Valor = string | number | null;
type Campos = Record<string, Valor>;

const S = 'SINTÉTICO';

/** Itens iniciais por entidade (chave natural → campos). */
function semente(): Map<string, Map<string, Campos>> {
  const m = new Map<string, Map<string, Campos>>();
  const pôr = (entidade: string, itens: Campos[], chave: (c: Campos) => string) =>
    m.set(entidade, new Map(itens.map((c) => [chave(c), c])));
  const porCodigo = (c: Campos) => `codigo=${c['codigo']}`;
  pôr(
    'cid10',
    [
      { codigo: 'U990', nome: `DOENCA ${S} 0`, classificacao: '', sexo: '5' },
      { codigo: 'U991', nome: `DOENCA ${S} 1`, classificacao: '*', sexo: '5' },
      { codigo: 'U992', nome: `DOENCA ${S} 2`, classificacao: '', sexo: '3' },
    ],
    porCodigo,
  );
  pôr(
    'ciap',
    [{ codigo: 'Z99', nomeOriginal: `SINTOMA ${S}`, nomeLeigo: `QUEIXA ${S}`, sexo: '5' }],
    porCodigo,
  );
  pôr('cidMorfologia', [], (c) => `cid=${c['cid']};morfologia=${c['morfologia']}`);
  pôr(
    'procedimento',
    [
      {
        codigo: '0399990001',
        nome: `CONSULTA ${S}`,
        complexidade: '2',
        sexo: 'I',
        quantidadeMaxima: 1,
        permanencia: 0,
        pontos: 0,
        idadeMinima: 0,
        idadeMaxima: 9999,
        valorSh: 0,
        valorSa: 10,
        valorSp: 0,
        financiamento: '06',
        tempoPermanencia: 9999,
      },
      {
        codigo: '0399990002',
        nome: `EXAME ${S}`,
        complexidade: '2',
        sexo: 'I',
        quantidadeMaxima: 1,
        permanencia: 0,
        pontos: 0,
        idadeMinima: 0,
        idadeMaxima: 9999,
        valorSh: 0,
        valorSa: 5.5,
        valorSp: 0,
        financiamento: '06',
        tempoPermanencia: 9999,
      },
    ],
    porCodigo,
  );
  pôr('procedimentoCid', [], (c) => `procedimento=${c['procedimento']};cid=${c['cid']}`);
  pôr('procedimentoCbo', [], (c) => `procedimento=${c['procedimento']};cbo=${c['cbo']}`);
  pôr(
    'motivoGlosa',
    [
      { codigo: '0', nome: 'NÃO INFORMADO', inicio: null, fim: null },
      { codigo: '3095', nome: 'RECURSO DE GLOSA ACATADO', inicio: null, fim: null },
    ],
    porCodigo,
  );
  pôr('cboAns', [{ codigo: '999999', nome: `OCUPACAO ANS ${S}`, inicio: null, fim: null }], porCodigo);
  pôr('materialTuss', [], porCodigo);
  pôr(
    'cep',
    [
      {
        cep: '99999001',
        uf: 'ZZ',
        cidade: `CIDADE ${S}`,
        logradouro: `RUA ${S} 1`,
        bairro: 'CENTRO',
        tipoLogradouro: 'RUA',
        ibge: '9999991',
      },
      {
        cep: '99999002',
        uf: 'ZZ',
        cidade: `CIDADE ${S}`,
        logradouro: `RUA ${S} 2`,
        bairro: 'CENTRO',
        tipoLogradouro: 'RUA',
        ibge: '9999991',
      },
    ],
    (c) => `cep=${c['cep']}`,
  );
  pôr('municipio', [{ ibge: '9999991', nome: `CIDADE ${S}`, uf: 'ZZ' }], (c) => `ibge=${c['ibge']}`);
  pôr('cbo', [{ codigo: '999901', nome: `OCUPACAO ${S}` }], porCodigo);
  pôr('ocupacao', [{ codigo: '999', nome: `OCUPACAO ${S}` }], porCodigo);
  pôr('dcb', [{ codigo: '99001', nome: `SUBSTANCIA ${S}`, cas: '' }], porCodigo);
  pôr('fabricante', [{ codigo: '9901', nome: `FABRICANTE ${S}` }], porCodigo);
  pôr('banco', [{ codigo: '999', nome: `BANCO ${S}` }], porCodigo);
  pôr('atividade', [{ codigo: '999', nome: `ATIVIDADE ${S}` }], porCodigo);
  for (const e of [
    'cfop',
    'itemServico',
    'genero',
    'tipoDocumento',
    'cstCofins',
    'cstPis',
    'naturezaCredito',
    'indicadorOperacao',
    'naturezaRetencao',
    'condicaoPj',
    'naturezaReceita',
    'imunidadeIssqn',
  ])
    pôr(
      e,
      e === 'cfop' ? [{ codigo: '9999', nome: `CFOP ${S}`, inicio: '2026-01-01', fim: null }] : [],
      porCodigo,
    );
  pôr('apresentacao', [], porCodigo);
  pôr('produto', [], porCodigo);
  // Catálogos da ANS (M56, F6): códigos sintéticos fora das faixas da ANS.
  pôr('grupoSip', [{ codigo: '999', nome: `GRUPO ${S}` }], porCodigo);
  pôr(
    'procedimentoSip',
    [{ procedimento: '99999901', grupo: '999', inicio: '2026-01-01', fim: '9999-12-31' }],
    (c) => `procedimento=${c['procedimento']};grupo=${c['grupo']};inicio=${c['inicio']}`,
  );
  pôr('classificacaoProcedimentoAns', [{ codigo: '99901', nome: `CLASSIFICACAO ${S}` }], porCodigo);
  pôr(
    'valorTps',
    [{ inicio: '2026-01-01', mes: '3', ano: 2026, valorAnual: 9.99, valorTrimestral: 2.4975 }],
    (c) => `inicio=${c['inicio']}`,
  );
  pôr('classificacaoPrestador', [{ codigo: '999', nome: `CLASSE ${S}` }], porCodigo);
  pôr('disponibilidadeServico', [{ codigo: '999', nome: `DISP ${S}` }], porCodigo);
  pôr(
    'remuneracaoPrestador',
    [{ codigo: '999', nome: `REMUNERACAO ${S}`, inicio: '2026-01-01', fim: null }],
    porCodigo,
  );
  return m;
}

/** Tabelas que as telas consultam (contrato): as que nenhuma carga em memória tem saem vazias. */
const SO_CONSULTA = new Set(ENTIDADES_CONSULTA_CATALOGO);

const RESPONSAVEL_NOVO: readonly CodigoCatalogo[] = ['cid', 'sigtap', 'cep', 'cbo', 'listas', 'fiscal'];

export class FonteCatalogosMemoria implements FonteCatalogos {
  readonly destino = 'memoria' as const;
  readonly gravacao = { permitida: true, motivo: null };
  private readonly itens = semente();
  private readonly cargasPorHospital = new Map<string, CargaDeCatalogo[]>();
  private readonly linhasPorCarga = new Map<number, LinhaDaCarga[]>();
  private readonly historicoProc = new Map<string, HistoricoSigtap['competencias']>();
  private proximo = 1;
  private competencia = '202609';
  /** Teste: muda o responsável de um catálogo. */
  readonly responsaveis = new Map<CodigoCatalogo, 'novo' | 'externo'>();

  constructor(
    private readonly registrar?: (t: Trilha & { tabelaAlvo: string; idAlvo: string }) => Promise<void>,
  ) {}

  leituraDoBanco(_c: CtxCatalogos, catalogo: CodigoCatalogo): LeituraDoBanco {
    return {
      atuais: async (entidade, chaves) => {
        const m = this.itens.get(entidade) ?? new Map();
        return new Map(chaves.filter((k) => m.has(k)).map((k) => [k, { ...m.get(k) }]));
      },
      existentes: async (entidade) => [...(this.itens.get(entidade)?.keys() ?? [])],
      edicao: async () => ({
        ultima: catalogo === 'sigtap' ? this.competencia : null,
        versoesTiss: ['4.01.00', '4.02.00'],
      }),
      referencias: async (tabela, codigos) => {
        // O mês de recolhimento da TPS é domínio fixo (1 a 6), sem entidade de carga.
        if (tabela === 'mesRecolhimentoTps') return new Set(codigos.filter((x) => /^[1-6]$/.test(x)));
        const ent = {
          procedimentoSigtap: 'procedimento',
          cid10: 'cid10',
          cboSus: 'cbo',
          grupoSipAns: 'grupoSip',
        }[tabela];
        const m = this.itens.get(ent) ?? new Map();
        return new Set(codigos.filter((x) => m.has(`codigo=${x}`)));
      },
    };
  }
  async leiauteCep() {
    return LEIAUTE_CEP_PADRAO.map((s) => ({ ...s, campos: { ...s.campos } }));
  }
  async responsavel(_c: CtxCatalogos, cat: CodigoCatalogo) {
    return this.responsaveis.get(cat) ?? (RESPONSAVEL_NOVO.includes(cat) ? 'novo' : 'externo');
  }
  async contrato() {
    return false;
  }
  async edicao(_c: CtxCatalogos, cat: CodigoCatalogo) {
    const def = definicaoCatalogo(cat);
    const linhas = (def?.entidades ?? []).reduce((s, e) => s + (this.itens.get(e.codigo)?.size ?? 0), 0);
    return cat === 'sigtap'
      ? { ultima: this.competencia, descricao: 'competência', linhas }
      : { ultima: null, descricao: 'itens', linhas };
  }
  private lista(h: string) {
    return this.cargasPorHospital.get(h) ?? this.cargasPorHospital.set(h, []).get(h) ?? [];
  }
  async cargas(c: CtxCatalogos, cat: string | null) {
    return this.lista(c.hospital)
      .filter((x) => !cat || x.catalogo === cat)
      .slice()
      .reverse();
  }
  async carga(c: CtxCatalogos, id: number) {
    return this.lista(c.hospital).find((x) => x.id === id) ?? null;
  }
  async linhas(
    _c: CtxCatalogos,
    id: number,
    f: { pagina: number; porPagina: number; comparacao?: string | null; resultado?: string | null },
  ) {
    const todas = (this.linhasPorCarga.get(id) ?? []).filter(
      (l) =>
        (!f.comparacao || l.comparacao === f.comparacao) && (!f.resultado || l.resultado === f.resultado),
    );
    return { itens: todas.slice(f.pagina * f.porPagina, (f.pagina + 1) * f.porPagina), total: todas.length };
  }
  async publicadaComHash(c: CtxCatalogos, cat: string, sha: string) {
    return (
      this.lista(c.hospital).find((x) => x.catalogo === cat && x.sha256 === sha && x.situacao === 'publicada')
        ?.id ?? null
    );
  }
  async gravarCarga(c: CtxCatalogos, n: PreparoCargaCatalogo, trilha: Trilha) {
    const id = this.proximo++;
    this.lista(c.hospital).push({
      id,
      hospital: c.hospital,
      catalogo: n.catalogo,
      arquivo: n.arquivo,
      sha256: n.sha256,
      bytes: n.bytes,
      situacao: n.situacao,
      edicao: n.edicao,
      responsavel: n.responsavel,
      aprovador: null,
      criadaEm: new Date().toISOString().slice(0, 19).replace('T', ' '),
      totais: n.totais,
      lotes: { total: n.lotes.total, publicados: 0, tamanho: n.lotes.tamanho },
      motivo: n.motivo,
      arquivoGuardado: n.arquivoGuardado !== null,
      versao: 1,
    });
    this.linhasPorCarga.set(
      id,
      n.linhas.map((l) => ({
        ...l,
        antes: l.antes ? { ...l.antes } : null,
        depois: l.depois ? { ...l.depois } : null,
      })),
    );
    await this.registrar?.({ ...trilha, tabelaAlvo: 'MEMORIA', idAlvo: String(id) });
    return { id };
  }
  async mudarSituacao(
    c: CtxCatalogos,
    m: MudancaSituacaoCarga,
    trilha: Trilha,
  ) {
    const lista = this.lista(c.hospital);
    const i = lista.findIndex((x) => x.id === m.id);
    const atual = lista[i];
    if (!atual || atual.versao !== m.versao)
      throw Object.assign(new Error('A carga mudou desde a leitura. Releia.'), {
        codigo: 'conflito-concorrente',
      });
    if (!m.de.includes(atual.situacao))
      throw Object.assign(new Error('A carga não está numa situação que permita esta ação.'), {
        codigo: 'situacao-invalida',
      });
    lista[i] = {
      ...atual,
      situacao: m.para,
      aprovador: m.aprovador ?? atual.aprovador,
      motivo: m.motivo ?? atual.motivo,
      versao: atual.versao + 1,
    };
    await this.registrar?.({ ...trilha, tabelaAlvo: 'MEMORIA', idAlvo: String(m.id) });
  }

  /** O "worker" da memória: aplica os lotes da carga aprovada aos itens sintéticos. */
  async publicarAgora(c: CtxCatalogos, id: number) {
    const lista = this.lista(c.hospital);
    const i = lista.findIndex((x) => x.id === id);
    const carga = lista[i];
    if (!carga || !['aprovada', 'publicando', 'falhou'].includes(carga.situacao))
      return { lotes: 0, incluidas: 0, alteradas: 0 };
    let incluidas = 0;
    let alteradas = 0;
    for (const l of this.linhasPorCarga.get(id) ?? []) {
      if (l.lote === null) continue;
      const m = this.itens.get(l.entidade) ?? this.itens.set(l.entidade, new Map()).get(l.entidade);
      if (!m) continue;
      const atual = m.get(l.chave);
      if (atual) {
        m.set(l.chave, { ...atual, ...(l.depois ?? {}) });
        alteradas++;
      } else {
        m.set(l.chave, { ...camposDaChave(l.chave), ...(l.depois ?? {}) });
        incluidas++;
      }
      if (l.entidade === 'procedimento' && carga.edicao) {
        const h = this.historicoProc.get(l.chave) ?? [];
        const v = m.get(l.chave) ?? {};
        h.unshift({
          competencia: carga.edicao,
          valorSh: Number(v['valorSh'] ?? 0),
          valorSa: Number(v['valorSa'] ?? 0),
          valorSp: Number(v['valorSp'] ?? 0),
          atributos: { complexidade: v['complexidade'] ?? null, sexo: v['sexo'] ?? null },
        });
        this.historicoProc.set(l.chave, h);
      }
    }
    if (carga.catalogo === 'sigtap' && carga.edicao && carga.edicao > this.competencia)
      this.competencia = carga.edicao;
    lista[i] = {
      ...carga,
      situacao: 'publicada',
      lotes: { ...carga.lotes, publicados: carga.lotes.total },
      versao: carga.versao + 1,
    };
    return { lotes: carga.lotes.total, incluidas, alteradas };
  }

  async consultar(
    _c: CtxCatalogos,
    entidade: string,
    f: { busca: string | null; pagina: number; porPagina: number; competencia?: string | null },
  ): Promise<ConsultaCatalogo | null> {
    if (!SO_CONSULTA.has(entidade)) return null;
    const ent = definicaoDaEntidade(entidade);
    const m = this.itens.get(entidade);
    if (!ent || !m) {
      // Tabelas só de consulta (sem carga por este sistema): vazias na memória.
      return {
        titulo: entidadeConsultaCatalogo(entidade)?.titulo ?? entidade,
        colunas: [
          { campo: 'codigo', rotulo: 'Código' },
          { campo: 'nome', rotulo: 'Descrição' },
        ],
        itens: [],
        total: 0,
      };
    }
    const b = (f.busca ?? '').trim().toUpperCase();
    // Código com máscara (CEP 01001-000, procedimento 03.01.01): também pelos dígitos, como na fonte do banco.
    const digitos = /^[\d.\-\s/]+$/.test(b) ? b.replace(/\D/g, '') : null;
    const todos = [...m.values()].filter(
      (x) =>
        !b ||
        Object.values(x).some((v) => {
          const t = String(v ?? '').toUpperCase();
          return t.includes(b) || (digitos !== null && digitos !== '' && t.includes(digitos));
        }),
    );
    return {
      titulo: ent.titulo,
      colunas: ent.campos.map((c) => ({ campo: c.nome, rotulo: c.titulo })),
      itens: todos.slice(f.pagina * f.porPagina, (f.pagina + 1) * f.porPagina),
      total: todos.length,
    };
  }
  async historico(_c: CtxCatalogos, procedimento: string): Promise<HistoricoSigtap | null> {
    const p = this.itens.get('procedimento')?.get(`codigo=${procedimento}`);
    if (!p) return null;
    return {
      procedimento,
      nome: String(p['nome'] ?? ''),
      competencias: this.historicoProc.get(`codigo=${procedimento}`) ?? [],
    };
  }
}

function definicaoDaEntidade(entidade: string) {
  for (const c of [
    'cid',
    'sigtap',
    'tuss',
    'cep',
    'cbo',
    'listas',
    'fiscal',
    'brasindice',
    'simpro',
    'ans',
    'dominiosSus',
    'spedContabil',
    'agravos',
  ] as const) {
    const e = definicaoCatalogo(c)?.entidades.find((x) => x.codigo === entidade);
    if (e) return e;
  }
  return null;
}
