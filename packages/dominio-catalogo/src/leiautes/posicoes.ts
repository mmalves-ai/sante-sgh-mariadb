// Leitura dos arquivos oficiais de posições fixas: SIGTAP (DATASUS: tb_procedimento, rl_procedimento_cid e
// rl_procedimento_ocupacao, com os valores em centavos), base de CEP pelo leiaute de posições configurado no
// banco ("Leiautes de importação (CEP)": seções reconhecidas pelo texto do cabeçalho em posições fixas) e os
// arquivos de edição do Brasíndice e do Simpro (leiaute do fornecedor; testados só com arquivo sintético).
import { competenciaValida, decimalDoArquivo, normalizarCodigo, valorEmCentavos } from '../codigo.js';
import {
  camposCsv,
  type ErroArquivo,
  type ItemLido,
  type LeituraArquivo,
  linhasDoTexto,
  trecho,
} from './comum.js';

// ── SIGTAP ─────────────────────────────────────────────────────────────────────────────────────────────

/** tb_procedimento.txt (leiaute DATASUS, tb_procedimento_layout.txt). Posições 1-based, inclusivas. */
export const POSICOES_TB_PROCEDIMENTO = {
  codigo: [1, 10],
  nome: [11, 260],
  complexidade: [261, 261],
  sexo: [262, 262],
  quantidadeMaxima: [263, 266],
  permanencia: [267, 270],
  pontos: [271, 274],
  idadeMinima: [275, 278],
  idadeMaxima: [279, 282],
  valorSh: [283, 294],
  valorSa: [295, 306],
  valorSp: [307, 318],
  financiamento: [319, 320],
  rubrica: [321, 326],
  tempoPermanencia: [327, 330],
  competencia: [331, 336],
} as const;

const INTEIROS = [
  'quantidadeMaxima',
  'permanencia',
  'pontos',
  'idadeMinima',
  'idadeMaxima',
  'tempoPermanencia',
];
const VALORES = ['valorSh', 'valorSa', 'valorSp'];

export function lerTbProcedimento(texto: string): LeituraArquivo {
  const itens: ItemLido[] = [];
  const erros: ErroArquivo[] = [];
  const competencias = new Set<string>();
  for (const l of linhasDoTexto(texto)) {
    if (l.texto.length < 336) {
      erros.push({
        linha: l.linha,
        mensagem: `leiaute: linha com ${l.texto.length} posições (esperadas 336)`,
      });
      continue;
    }
    const campos: Record<string, string | number | null> = {};
    const errosLinha: string[] = [];
    for (const [campo, [ini, fim]] of Object.entries(POSICOES_TB_PROCEDIMENTO)) {
      const v = trecho(l.texto, ini, fim);
      if (campo === 'codigo') {
        const r = normalizarCodigo('sigtap', v);
        if (!r.ok) errosLinha.push(r.erro);
        campos[campo] = r.ok ? r.codigo : v;
      } else if (INTEIROS.includes(campo)) {
        campos[campo] = /^\d+$/.test(v) ? Number(v) : v === '' ? 0 : null;
        if (campos[campo] === null) errosLinha.push(`${campo}: não numérico`);
      } else if (VALORES.includes(campo)) {
        const n = valorEmCentavos(v);
        if (n === null) errosLinha.push(`${campo}: valor inválido`);
        campos[campo] = n;
      } else campos[campo] = v;
    }
    const comp = String(campos['competencia'] ?? '');
    if (!competenciaValida(comp)) errosLinha.push(`competência inválida: ${comp}`);
    else competencias.add(comp);
    delete campos['competencia'];
    delete campos['rubrica'];
    itens.push({ entidade: 'procedimento', linha: l.linha, campos, erros: errosLinha });
  }
  if (competencias.size > 1)
    erros.push({
      linha: null,
      mensagem: `leiaute: o arquivo mistura competências (${[...competencias].sort().join(', ')})`,
    });
  return { itens, erros, edicao: competencias.size === 1 ? ([...competencias][0] as string) : null };
}

/** rl_procedimento_cid.txt (CO_PROCEDIMENTO 10, CO_CID 4, ST_PRINCIPAL 1, DT_COMPETENCIA 6) e rl_procedimento_ocupacao.txt (CO_PROCEDIMENTO 10, CO_OCUPACAO 6, DT_COMPETENCIA 6). */
export function lerRelacaoSigtap(texto: string, tipo: 'cid' | 'cbo'): LeituraArquivo {
  const itens: ItemLido[] = [];
  const erros: ErroArquivo[] = [];
  const tam = tipo === 'cid' ? 4 : 6;
  const minimo = 10 + tam + (tipo === 'cid' ? 1 : 0) + 6;
  const competencias = new Set<string>();
  for (const l of linhasDoTexto(texto)) {
    if (l.texto.length < minimo) {
      erros.push({
        linha: l.linha,
        mensagem: `leiaute: linha com ${l.texto.length} posições (esperadas ${minimo})`,
      });
      continue;
    }
    const proc = normalizarCodigo('sigtap', trecho(l.texto, 1, 10));
    const outro = normalizarCodigo(tipo, trecho(l.texto, 11, 10 + tam));
    const comp = trecho(l.texto, minimo - 5, minimo);
    const errosLinha = [proc, outro].flatMap((r) => (r.ok ? [] : [r.erro]));
    if (!competenciaValida(comp)) errosLinha.push(`competência inválida: ${comp}`);
    else competencias.add(comp);
    itens.push({
      entidade: tipo === 'cid' ? 'procedimentoCid' : 'procedimentoCbo',
      linha: l.linha,
      campos: { procedimento: proc.ok ? proc.codigo : null, [tipo]: outro.ok ? outro.codigo : null },
      erros: errosLinha,
    });
  }
  if (competencias.size > 1)
    erros.push({
      linha: null,
      mensagem: `leiaute: o arquivo mistura competências (${[...competencias].sort().join(', ')})`,
    });
  return { itens, erros, edicao: competencias.size === 1 ? ([...competencias][0] as string) : null };
}

// ── CEP ────────────────────────────────────────────────────────────────────────────────────────────────

/** Seção do leiaute de CEP: o texto do cabeçalho e onde ele aparece, e as posições de cada campo. */
export interface SecaoLeiauteCep {
  readonly cabecalho: string;
  readonly inicio: number;
  readonly fim: number;
  readonly campos: Readonly<Record<string, readonly [number, number]>>;
}

/**
 * Leiaute padrão (o que o banco do estabelecimento tem hoje; a tela "Leiautes de importação (CEP)" é a
 * fonte em execução, este é só o retrato do dia para os testes).
 */
export const LEIAUTE_CEP_PADRAO: readonly SecaoLeiauteCep[] = [
  { cabecalho: 'UNIDADES DA FEDERAÇÃO', inicio: 62, fim: 82, campos: { UF: [4, 5], NOME: [10, 81] } },
  {
    cabecalho: 'LOCALIDADES',
    inicio: 62,
    fim: 72,
    campos: { NOME: [20, 91], UF: [4, 5], CEP: [92, 99], COD: [155, 161] },
  },
  {
    cabecalho: 'TIPOS DE LOGRADOURO',
    inicio: 62,
    fim: 80,
    campos: { NOME: [8, 79], SIGLA: [80, 94], COD: [5, 7] },
  },
  {
    cabecalho: 'LOGRADOUROS',
    inicio: 62,
    fim: 72,
    campos: {
      CEP: [519, 526],
      CIDADE: [18, 89],
      LOGRA: [375, 446],
      BAIRRO: [103, 174],
      UF: [2, 3],
      SITUACAO: [528, 528],
      TIPO_LOGRA: [260, 285],
    },
  },
];

const comparavel = (t: string) =>
  t.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();

/**
 * Base de CEP pelo leiaute de posições: a linha cujo trecho do cabeçalho é o texto de uma seção abre a
 * seção; as linhas seguintes são registros dela. Localidades dão o código IBGE da cidade (por nome + UF);
 * logradouros dão os CEPs; a localidade com CEP próprio (cidade de CEP único) também vira CEP.
 */
export function lerBaseCep(
  texto: string,
  leiaute: readonly SecaoLeiauteCep[] = LEIAUTE_CEP_PADRAO,
): LeituraArquivo {
  const itens: ItemLido[] = [];
  const erros: ErroArquivo[] = [];
  let secao: SecaoLeiauteCep | null = null;
  const ibgeDaCidade = new Map<string, string>();
  const pendentes: { linha: number; campos: Record<string, string> }[] = [];
  const municipios: ItemLido[] = [];
  for (const l of linhasDoTexto(texto)) {
    const abre = leiaute.find(
      (s) => comparavel(trecho(l.texto, s.inicio, s.fim)) === comparavel(s.cabecalho),
    );
    if (abre) {
      secao = abre;
      continue;
    }
    if (!secao) {
      erros.push({ linha: l.linha, mensagem: 'leiaute: registro antes de qualquer seção conhecida' });
      continue;
    }
    const campos: Record<string, string> = {};
    for (const [campo, [ini, fim]] of Object.entries(secao.campos)) campos[campo] = trecho(l.texto, ini, fim);
    if (secao.cabecalho === 'LOCALIDADES') {
      const ibge = normalizarCodigo('ibge', campos['COD'] ?? '');
      if (ibge.ok) {
        ibgeDaCidade.set(`${comparavel(campos['NOME'] ?? '')}|${campos['UF'] ?? ''}`, ibge.codigo);
        municipios.push({
          entidade: 'municipio',
          linha: l.linha,
          campos: { ibge: ibge.codigo, nome: campos['NOME'] ?? '', uf: campos['UF'] ?? '' },
          erros: [],
        });
      }
      if ((campos['CEP'] ?? '').trim() !== '')
        pendentes.push({
          linha: l.linha,
          campos: {
            CEP: campos['CEP'] ?? '',
            CIDADE: campos['NOME'] ?? '',
            UF: campos['UF'] ?? '',
            LOGRA: '',
            BAIRRO: '',
            TIPO_LOGRA: '',
          },
        });
    } else if (secao.cabecalho === 'LOGRADOUROS') pendentes.push({ linha: l.linha, campos });
  }
  for (const p of pendentes) {
    const cep = normalizarCodigo('cep', p.campos['CEP'] ?? '');
    const uf = (p.campos['UF'] ?? '').toUpperCase();
    const cidade = p.campos['CIDADE'] ?? '';
    const errosLinha = cep.ok ? [] : [cep.erro];
    if (!/^[A-Z]{2}$/.test(uf)) errosLinha.push(`UF inválida: ${uf}`);
    const ibge = ibgeDaCidade.get(`${comparavel(cidade)}|${uf}`) ?? null;
    itens.push({
      entidade: 'cep',
      linha: p.linha,
      campos: {
        cep: cep.ok ? cep.codigo : (p.campos['CEP'] ?? null),
        uf,
        cidade,
        logradouro: p.campos['LOGRA'] ?? '',
        bairro: p.campos['BAIRRO'] ?? '',
        tipoLogradouro: p.campos['TIPO_LOGRA'] ?? '',
        ibge,
      },
      erros: errosLinha,
    });
  }
  if (itens.length === 0 && erros.length === 0)
    erros.push({ linha: null, mensagem: 'leiaute: nenhuma seção de CEP reconhecida' });
  return { itens: [...municipios, ...itens], erros, edicao: null };
}

// ── Brasíndice e Simpro (leiaute do fornecedor; só com contrato, DP-36) ─────────────────────────────────

/**
 * Brasíndice (arquivo da edição, texto com aspas e ponto e vírgula): "LAB";"NOME_LAB";"CODIGO";"NOME";
 * "APRESENTACAO" (código de 4);"PMC";"PFB";"EDICAO";"TIPO" (1 material, 2 medicamento);"FATOR";"TUSS". A edição
 * é a do próprio arquivo (todas as linhas iguais).
 */
export function lerBrasindice(texto: string): LeituraArquivo {
  const itens: ItemLido[] = [];
  const erros: ErroArquivo[] = [];
  const edicoes = new Set<string>();
  for (const l of linhasDoTexto(texto)) {
    const c = camposCsv(l.texto, l.texto.includes(';') ? ';' : ',');
    if (c.length < 8) {
      erros.push({ linha: l.linha, mensagem: `leiaute: ${c.length} campos (esperados 8)` });
      continue;
    }
    const [
      lab = '',
      ,
      codigo = '',
      nome = '',
      apres = '',
      pmc = '',
      pfb = '',
      edicao = '',
      tipo = '',
      fator = '',
      tuss = '',
    ] = c;
    if (!/^\d+$/.test(codigo)) {
      // cabeçalho opcional
      if (l.linha === 1) continue;
      erros.push({ linha: l.linha, mensagem: 'leiaute: código não numérico' });
      continue;
    }
    const errosLinha: string[] = [];
    const vPmc = decimalDoArquivo(pmc);
    const vPfb = decimalDoArquivo(pfb);
    if (vPmc === null) errosLinha.push('pmc: valor inválido');
    if (vPfb === null) errosLinha.push('pfb: valor inválido');
    if (/^\d{1,6}$/.test(edicao)) edicoes.add(edicao);
    else errosLinha.push(`edição inválida: ${edicao}`);
    itens.push({
      entidade: 'apresentacao',
      linha: l.linha,
      campos: {
        codigo,
        nome,
        laboratorio: /^\d+$/.test(lab) ? Number(lab) : null,
        pmc: vPmc,
        pfb: vPfb,
        classificacao: /^\d+$/.test(tipo) ? Number(tipo) : null,
        apresentacao: apres.slice(0, 4),
        fator: /^\d+$/.test(fator) ? Number(fator) : 1,
        tuss: /^\d+$/.test(tuss) ? Number(tuss) : null,
      },
      erros: errosLinha,
    });
  }
  if (edicoes.size > 1) erros.push({ linha: null, mensagem: 'leiaute: o arquivo mistura edições' });
  return { itens, erros, edicao: edicoes.size === 1 ? ([...edicoes][0] as string) : null };
}

/**
 * Simpro (posições fixas): CODIGO 1-10, DESCRICAO 11-110, VALOR 111-122 (centavos), EDICAO 123-128, e os
 * opcionais CLASSIF 129-130, UNIDADE 131-136, FABRICANTE 137-141, ANVISA 142-155, REFERÊNCIA 156-185,
 * IDENTIFICAÇÃO 186 e TUSS 187-196.
 */
export function lerSimpro(texto: string): LeituraArquivo {
  const itens: ItemLido[] = [];
  const erros: ErroArquivo[] = [];
  const edicoes = new Set<string>();
  for (const l of linhasDoTexto(texto)) {
    if (l.texto.length < 128) {
      erros.push({
        linha: l.linha,
        mensagem: `leiaute: linha com ${l.texto.length} posições (esperadas 128)`,
      });
      continue;
    }
    const codigo = trecho(l.texto, 1, 10).replace(/^0+(?=\d)/, '');
    const valor = valorEmCentavos(trecho(l.texto, 111, 122));
    const edicao = trecho(l.texto, 123, 128).replace(/^0+(?=\d)/, '');
    const errosLinha: string[] = [];
    if (!/^\d+$/.test(codigo)) errosLinha.push('código não numérico');
    if (valor === null) errosLinha.push('valor inválido');
    if (/^\d{1,6}$/.test(edicao)) edicoes.add(edicao);
    else errosLinha.push('edição inválida');
    const n = (ini: number, fim: number) => {
      const t = trecho(l.texto, ini, fim);
      return /^\d+$/.test(t) ? Number(t) : null;
    };
    itens.push({
      entidade: 'produto',
      linha: l.linha,
      campos: {
        codigo,
        nome: trecho(l.texto, 11, 110),
        valor,
        classificacao: n(129, 130),
        unidade: trecho(l.texto, 131, 136),
        fabricante: n(137, 141),
        registroAnvisa: trecho(l.texto, 142, 155),
        referenciaFabricante: trecho(l.texto, 156, 185),
        identificacao: trecho(l.texto, 186, 186),
        tuss: n(187, 196),
      },
      erros: errosLinha,
    });
  }
  if (edicoes.size > 1) erros.push({ linha: null, mensagem: 'leiaute: o arquivo mistura edições' });
  return { itens, erros, edicao: edicoes.size === 1 ? ([...edicoes][0] as string) : null };
}
