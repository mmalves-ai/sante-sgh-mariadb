// Leitura dos arquivos oficiais em texto delimitado (CSV, ponto e vírgula, barra vertical): CID-10 (DATASUS),
// CIAP-2, CID-O, terminologias TUSS (ANS), CBO 2002 (MTE), ocupações, DCB (Anvisa), bancos (STR do Banco
// Central), fabricantes, atividades e as tabelas fiscais do SPED (Receita Federal). Cada leitor confere o
// cabeçalho (falta de coluna obrigatória é erro do ARQUIVO: nada é publicado) e devolve os itens no
// vocabulário do novo, com os códigos como texto (regra 8).
import { dataDoArquivo, normalizarCodigo, type TipoCodigo } from '../codigo.js';
import {
  camposCsv,
  type ErroArquivo,
  indicesDoCabecalho,
  type ItemLido,
  type LeituraArquivo,
  linhasDoTexto,
  separadorProvavel,
} from './comum.js';

export interface ColunaCsv {
  readonly campo: string;
  readonly nomes: readonly string[];
  readonly obrigatoria?: boolean;
  /** Código da chave: normalizado pelo tipo (zeros à esquerda, sem ponto). */
  readonly codigo?: TipoCodigo;
  readonly tipo?: 'texto' | 'data' | 'letra';
  /** Troca do valor do arquivo pelo valor que o banco usa (ex.: sexo M/F/branco → 1/3/5). */
  readonly mapa?: Readonly<Record<string, string>>;
  readonly padrao?: string;
}

export interface LeiauteCsv {
  readonly entidade: string;
  readonly colunas: readonly ColunaCsv[];
  /** Separador fixo (sem ele, o mais provável do cabeçalho). */
  readonly separador?: string;
}

/** Lê o texto pelo leiaute: cabeçalho na primeira linha, uma entidade por arquivo. */
export function lerCsv(texto: string, leiaute: LeiauteCsv): LeituraArquivo {
  const linhas = linhasDoTexto(texto);
  const erros: ErroArquivo[] = [];
  const primeira = linhas[0];
  if (!primeira) return { itens: [], erros: [{ linha: null, mensagem: 'arquivo vazio' }], edicao: null };
  const sep = leiaute.separador ?? separadorProvavel(primeira.texto);
  const pedidas = Object.fromEntries(leiaute.colunas.map((c) => [c.campo, c.nomes]));
  const { indices, faltam } = indicesDoCabecalho(
    camposCsv(primeira.texto, sep),
    pedidas,
    leiaute.colunas.filter((c) => c.obrigatoria).map((c) => c.campo),
  );
  if (faltam.length > 0) {
    erros.push({
      linha: primeira.linha,
      mensagem: `leiaute: faltam as colunas ${faltam.join(', ')} no cabeçalho`,
    });
    return { itens: [], erros, edicao: null };
  }
  const itens: ItemLido[] = [];
  for (const l of linhas.slice(1)) {
    const valores = camposCsv(l.texto, sep);
    const campos: Record<string, string | number | null> = {};
    const errosLinha: string[] = [];
    for (const c of leiaute.colunas) {
      const i = indices[c.campo];
      let v = i === undefined ? (c.padrao ?? null) : (valores[i] ?? '');
      if (v !== null && c.mapa) v = c.mapa[v.trim().toUpperCase()] ?? c.mapa['*'] ?? v;
      if (c.codigo) {
        if (v === null || v.trim() === '') {
          if (c.obrigatoria) errosLinha.push(`${c.campo}: vazio`);
          campos[c.campo] = null;
          continue;
        }
        const r = normalizarCodigo(c.codigo, v);
        if (!r.ok) {
          errosLinha.push(`${c.campo}: ${r.erro}`);
          campos[c.campo] = v;
        } else campos[c.campo] = r.codigo;
        continue;
      }
      if (c.tipo === 'data') {
        const d = dataDoArquivo(v);
        if (v !== null && v.trim() !== '' && d === null) errosLinha.push(`${c.campo}: data inválida (${v})`);
        campos[c.campo] = d;
        continue;
      }
      if (c.obrigatoria && (v === null || v.trim() === '')) errosLinha.push(`${c.campo}: vazio`);
      campos[c.campo] = v === null ? null : v.trim();
    }
    itens.push({ entidade: leiaute.entidade, linha: l.linha, campos, erros: errosLinha });
  }
  return { itens, erros, edicao: null };
}

// ── Leiautes (sinônimos de cabeçalho como as fontes publicam) ──────────────────────────────────────────

/** Restrição de sexo do DATASUS (M, F, branco) no código que o banco usa (1, 3, 5). */
const SEXO_CID = { M: '1', F: '3', '': '5', '*': '5' };

export const LEIAUTE_CID10: LeiauteCsv = {
  entidade: 'cid10',
  colunas: [
    { campo: 'codigo', nomes: ['SUBCAT', 'CAT', 'CODIGO', 'COD'], obrigatoria: true, codigo: 'cid' },
    { campo: 'classificacao', nomes: ['CLASSIF'], padrao: '' },
    { campo: 'sexo', nomes: ['RESTRSEXO'], padrao: '', mapa: SEXO_CID },
    { campo: 'nome', nomes: ['DESCRICAO', 'DESCRIÇÃO'], obrigatoria: true },
  ],
};

export const LEIAUTE_CIAP: LeiauteCsv = {
  entidade: 'ciap',
  colunas: [
    { campo: 'codigo', nomes: ['CODIGO', 'CÓDIGO', 'COD'], obrigatoria: true, codigo: 'ciap' },
    { campo: 'nomeOriginal', nomes: ['TITULO_ORIGINAL', 'TÍTULO ORIGINAL', 'TITULO'], obrigatoria: true },
    { campo: 'nomeLeigo', nomes: ['TITULO_LEIGO', 'TÍTULO LEIGO', 'LEIGO'] },
    { campo: 'sexo', nomes: ['SEXO'], padrao: '', mapa: SEXO_CID },
  ],
};

export const LEIAUTE_CID_O: LeiauteCsv = {
  entidade: 'cidMorfologia',
  colunas: [
    { campo: 'cid', nomes: ['CID', 'CID_PRINCIPAL', 'TOPOGRAFIA'], obrigatoria: true, codigo: 'cid' },
    { campo: 'morfologia', nomes: ['MORFOLOGIA', 'CID_O', 'CIDO'], obrigatoria: true, codigo: 'morfologia' },
  ],
};

const termoTuss = (entidade: string, tipoCodigo: TipoCodigo): LeiauteCsv => ({
  entidade,
  colunas: [
    {
      campo: 'codigo',
      nomes: ['Código do Termo', 'CODIGO DO TERMO', 'Codigo', 'Código'],
      obrigatoria: true,
      codigo: tipoCodigo,
    },
    { campo: 'nome', nomes: ['Termo', 'TERMO', 'Descrição'], obrigatoria: true },
    {
      campo: 'inicio',
      nomes: ['Data de início de vigência', 'Data de inicio de vigencia', 'Início de vigência'],
      tipo: 'data',
    },
    {
      campo: 'fim',
      nomes: ['Data de fim de vigência', 'Data de fim de vigencia', 'Fim de vigência'],
      tipo: 'data',
    },
  ],
});

export const LEIAUTE_TUSS_38 = termoTuss('motivoGlosa', 'numerico');
export const LEIAUTE_TUSS_24 = termoTuss('cboAns', 'numerico');
export const LEIAUTE_TUSS_19: LeiauteCsv = {
  entidade: 'materialTuss',
  colunas: [
    {
      campo: 'codigo',
      nomes: ['Código do Termo', 'CODIGO DO TERMO', 'Código'],
      obrigatoria: true,
      codigo: 'numerico',
    },
    { campo: 'nome', nomes: ['Termo', 'TERMO'], obrigatoria: true },
    { campo: 'registroAnvisa', nomes: ['Registro Anvisa', 'Código Anvisa', 'Registro ANVISA'] },
    {
      campo: 'referenciaFabricante',
      nomes: ['Referência do fabricante', 'Referencia do fabricante', 'Modelo'],
    },
  ],
};

export const LEIAUTE_CBO: LeiauteCsv = {
  entidade: 'cbo',
  colunas: [
    { campo: 'codigo', nomes: ['CODIGO', 'CÓDIGO', 'COD'], obrigatoria: true, codigo: 'cbo' },
    { campo: 'nome', nomes: ['TITULO', 'TÍTULO', 'DESCRICAO'], obrigatoria: true },
  ],
};

const codigoNome = (
  entidade: string,
  tipoCodigo: TipoCodigo,
  nomes: readonly string[] = ['NOME', 'DESCRICAO'],
): LeiauteCsv => ({
  entidade,
  colunas: [
    { campo: 'codigo', nomes: ['CODIGO', 'CÓDIGO', 'COD'], obrigatoria: true, codigo: tipoCodigo },
    { campo: 'nome', nomes, obrigatoria: true },
  ],
});

export const LEIAUTE_OCUPACAO = codigoNome('ocupacao', 'numerico');
export const LEIAUTE_FABRICANTE = codigoNome('fabricante', 'numerico');
export const LEIAUTE_ATIVIDADE = codigoNome('atividade', 'numerico');

/**
 * M48 (etapa 4): a lista nacional de notificação compulsória, um arquivo por entidade: a periodicidade por CID
 * (código; periodicidade 0, 1 ou 2), os modelos de ficha do Sinan (código; nome) e as perguntas (ficha; pergunta;
 * subpergunta; nome: a chave é a ficha com a pergunta e a subpergunta, o ID nasce no banco).
 */
export const LEIAUTES_AGRAVOS: Readonly<Record<string, LeiauteCsv>> = {
  agravos_cid: {
    entidade: 'cidAgravo',
    colunas: [
      { campo: 'codigo', nomes: ['CID', 'CODIGO', 'CÓDIGO', 'COD'], obrigatoria: true, codigo: 'cid' },
      { campo: 'periodicidade', nomes: ['PERIODICIDADE', 'TP_AGRAVO', 'TIPO'], obrigatoria: true },
    ],
  },
  agravos_fichas: codigoNome('fichaAgravo', 'numerico'),
  agravos_perguntas: {
    entidade: 'perguntaFichaAgravo',
    colunas: [
      { campo: 'ficha', nomes: ['FICHA', 'ID_FICHA', 'MODELO'], obrigatoria: true, codigo: 'numerico' },
      {
        campo: 'pergunta',
        nomes: ['PERGUNTA', 'CODIGO_PERGUNTA', 'CODIGO'],
        obrigatoria: true,
        codigo: 'numerico',
      },
      { campo: 'subpergunta', nomes: ['SUBPERGUNTA', 'SUBCODIGO'], obrigatoria: true, codigo: 'numerico' },
      { campo: 'nome', nomes: ['NOME', 'TEXTO', 'DESCRICAO'], obrigatoria: true },
    ],
  },
};

/** M51 (etapa 4): os domínios dos leiautes do SIH e do SIA (código; nome), um arquivo por domínio. */
export const LEIAUTES_DOMINIOS_SUS: Readonly<Record<string, LeiauteCsv>> = {
  tipos_uti: codigoNome('tipoUtiSih', 'numerico'),
  classificacao_diagnostico: codigoNome('classificacaoDiagnostico', 'numerico'),
  justificativa_sem_identificacao: codigoNome('justificativaSemIdentificacao', 'numerico'),
  caracteristica_tratamento: codigoNome('caracteristicaTratamentoSia', 'numerico'),
  contraindicacao_transplante: codigoNome('contraindicacaoTransplanteSia', 'numerico'),
  situacao_transplante: codigoNome('situacaoTransplanteSia', 'numerico'),
  acesso_vascular: codigoNome('acessoVascularSia', 'numerico'),
};

/** M54.3: as tabelas de código e nome do SPED contábil (código; nome), um arquivo por tabela. */
export const LEIAUTES_SPED_CONTABIL: Readonly<Record<string, LeiauteCsv>> = {
  tipo_item: codigoNome('tipoItemSped', 'numerico'),
  natureza_pj: codigoNome('naturezaPjSped', 'numerico'),
  situacao_especial: codigoNome('situacaoEspecialSped', 'numerico'),
  atividade_preponderante: codigoNome('atividadePreponderanteSped', 'numerico'),
};

export const LEIAUTE_DCB: LeiauteCsv = {
  entidade: 'dcb',
  colunas: [
    {
      campo: 'codigo',
      nomes: ['Nº DCB', 'N DCB', 'NUMERO DCB', 'DCB', 'CODIGO'],
      obrigatoria: true,
      codigo: 'numerico',
    },
    {
      campo: 'nome',
      nomes: ['DENOMINAÇÃO GENÉRICA', 'DENOMINACAO GENERICA', 'DENOMINACAO', 'NOME'],
      obrigatoria: true,
    },
    { campo: 'cas', nomes: ['Nº CAS', 'N CAS', 'CAS'] },
  ],
};

export const LEIAUTE_BANCO: LeiauteCsv = {
  entidade: 'banco',
  colunas: [
    {
      campo: 'codigo',
      nomes: ['Número_Código', 'Numero_Codigo', 'NUMERO CODIGO', 'CODIGO', 'COMPE'],
      obrigatoria: true,
      codigo: 'banco',
    },
    { campo: 'nome', nomes: ['Nome_Reduzido', 'NOME REDUZIDO', 'NOME'], obrigatoria: true },
  ],
};

/** Tabelas do SPED: código|descrição|início|fim (datas DDMMAAAA), sem cabeçalho na fonte: a primeira linha é o nome das colunas. */
export const leiauteFiscal = (entidade: string): LeiauteCsv => ({
  entidade,
  separador: '|',
  colunas: [
    { campo: 'codigo', nomes: ['CODIGO', 'CÓDIGO', 'COD'], obrigatoria: true, codigo: 'numerico' },
    { campo: 'nome', nomes: ['DESCRICAO', 'DESCRIÇÃO', 'NOME'], obrigatoria: true },
    { campo: 'inicio', nomes: ['DATA_INICIO', 'INICIO', 'DT_INI'], tipo: 'data' },
    { campo: 'fim', nomes: ['DATA_FIM', 'FIM', 'DT_FIM'], tipo: 'data' },
  ],
});

// ── Catálogos da ANS (ficha do M56, seção 9; D-IMPORT-56) ───────────────────────────────────────────────
const vigencia = (campo: 'inicio' | 'fim', obrigatoria = false): ColunaCsv => ({
  campo,
  nomes:
    campo === 'inicio'
      ? ['INICIO', 'INÍCIO', 'DATA_INICIO', 'INICIO_VIGENCIA', 'INÍCIO DA VIGÊNCIA', 'VIGENCIA', 'VIGÊNCIA']
      : ['FIM', 'DATA_FIM', 'FIM_VIGENCIA', 'FIM DA VIGÊNCIA'],
  tipo: 'data',
  ...(obrigatoria ? { obrigatoria } : {}),
});

export const LEIAUTE_ANS_GRUPO_SIP = codigoNome('grupoSip', 'numerico');
export const LEIAUTE_ANS_PROCEDIMENTO_SIP: LeiauteCsv = {
  entidade: 'procedimentoSip',
  colunas: [
    {
      campo: 'procedimento',
      nomes: ['PROCEDIMENTO', 'CODIGO', 'CÓDIGO', 'COD'],
      obrigatoria: true,
      codigo: 'numerico',
    },
    {
      campo: 'grupo',
      nomes: ['GRUPO', 'GRUPO_SIP', 'ITEM', 'ITEM_SIP'],
      obrigatoria: true,
      codigo: 'numerico',
    },
    vigencia('inicio', true),
    { ...vigencia('fim'), padrao: '9999-12-31' },
  ],
};
export const LEIAUTE_ANS_CLASSIFICACAO_PROCEDIMENTO = codigoNome('classificacaoProcedimentoAns', 'numerico');
export const LEIAUTE_ANS_TPS: LeiauteCsv = {
  entidade: 'valorTps',
  colunas: [
    vigencia('inicio', true),
    { campo: 'mes', nomes: ['MES', 'MÊS', 'MES_RECOLHIMENTO', 'MÊS DE RECOLHIMENTO'], obrigatoria: true },
    { campo: 'ano', nomes: ['ANO', 'ANO_RECOLHIMENTO', 'ANO DE RECOLHIMENTO'], obrigatoria: true },
    { campo: 'valorAnual', nomes: ['VALOR_ANUAL', 'VALOR ANUAL'], obrigatoria: true },
    { campo: 'valorTrimestral', nomes: ['VALOR_TRIMESTRAL', 'VALOR TRIMESTRAL'], obrigatoria: true },
  ],
};
export const LEIAUTE_ANS_CLASSIFICACAO_PRESTADOR = codigoNome('classificacaoPrestador', 'numerico');
export const LEIAUTE_ANS_DISPONIBILIDADE = codigoNome('disponibilidadeServico', 'numerico');
export const LEIAUTE_ANS_REMUNERACAO: LeiauteCsv = {
  entidade: 'remuneracaoPrestador',
  colunas: [...codigoNome('remuneracaoPrestador', 'numerico').colunas, vigencia('inicio'), vigencia('fim')],
};
