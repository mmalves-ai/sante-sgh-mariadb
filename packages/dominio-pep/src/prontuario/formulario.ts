// Layout da época e documento como emitido (regras 3 e 7 da ficha do M15; cap-11 §11.1): o registro abre com o
// layout que ele mesmo carrega (o XML do formulário gravado junto do registro traz, por componente, a classe, o
// nome, a posição, o título e o valor), e o documento emitido (XML comprimido da trilha documental) traz o
// cabeçalho congelado (hospital, paciente, atendimento, lançamento) e os mesmos componentes. Um registro de 2021
// abre como foi feito em 2021; os modelos descontinuados aparecem porque o registro descreve a si mesmo.
import type { CampoFormulario, ComoEmitido, LayoutEpoca, ValorCampoRegistro } from '@sgh/contratos';
import { classeDfm } from '../formulario/dfm/classes.js';
import { colunasDaLargura } from '../formulario/dfm/layout.js';
import { ocultarDocumentosDosCampos } from './documentos.js';
import { pareceRtf, rtfParaTexto, textoCorrido } from './rtf.js';
import {
  type ElementoXml,
  filho,
  filhosElemento,
  lerXml,
  procurar,
  soTexto,
  textoXml,
} from './xml-seguro.js';

function inteiro(v: string | undefined | null): number {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function logico(v: string): boolean {
  return /^(t|s|true|sim|1)$/i.test(v.trim());
}

/** Valor do componente: texto, texto formatado (RTF dentro do valor) ou lista (itens marcados). */
function valorDo(comp: ElementoXml): ValorCampoRegistro {
  const lista = filho(comp, 'value_texto');
  if (lista) {
    const itens = filhosElemento(lista)
      .filter((x) => /^Item\d+$/.test(x.nome))
      .sort((a, b) => inteiro(a.nome.slice(4)) - inteiro(b.nome.slice(4)))
      .map((x) => limpar(textoXml(x)))
      .filter((x) => x !== '');
    if (itens.length > 0) return { tipo: 'lista', itens };
  }
  const bruto = textoXml(filho(comp, 'value'));
  if (pareceRtf(bruto)) {
    const t = rtfParaTexto(bruto);
    return textoCorrido(t) === '' ? { tipo: 'vazio' } : { tipo: 'formatado', texto: t };
  }
  const v = limpar(bruto);
  return v === '' ? { tipo: 'vazio' } : { tipo: 'texto', texto: v };
}

function limpar(s: string): string {
  return s.replace(/\r\n?/g, '\n').trim();
}

/** Um `<componente>` do XML do formulário vira um campo. */
export function campoDoComponente(comp: ElementoXml): CampoFormulario {
  const classe = textoXml(filho(comp, 'className')).trim();
  const titulo = limpar(textoXml(filho(comp, 'title')));
  const valor = valorDo(comp);
  const def = classeDfm(classe);
  const secao = def?.tipo === 'group' || /GroupBox/i.test(classe);
  return {
    nome: textoXml(filho(comp, 'name')).trim(),
    classe,
    titulo,
    secao,
    valor: secao && valor.tipo === 'vazio' ? { tipo: 'vazio' } : valor,
    topo: inteiro(textoXml(filho(comp, 'top'))),
    esquerda: inteiro(textoXml(filho(comp, 'left'))),
    colunas: colunasDaLargura(inteiro(textoXml(filho(comp, 'width'))) || undefined),
    autopreenchido: logico(textoXml(filho(comp, 'autopreenchido'))),
    naoMapeado: !def && !secao,
  };
}

/** Componentes de um elemento `<evolucao>` na ordem do próprio XML (a ordem em que o formulário foi gravado). */
export function camposDaEvolucao(evolucao: ElementoXml): CampoFormulario[] {
  return filhosElemento(evolucao, 'componente').map(campoDoComponente);
}

/**
 * Layout da época: o XML do formulário do registro (UTF-8, já decodificado pelo adaptador). Sem a permissão de
 * ver documentos (`mostrarDocumentos: false`), CPF, cartão de saúde e identidade saem mascarados (D-DOC-1); a
 * conferência cruzada (ferramenta, sem tela) lê com o padrão (inteiro).
 */
export function lerLayoutEpoca(
  xml: string,
  opcoes: { readonly mostrarDocumentos: boolean } = { mostrarDocumentos: true },
): LayoutEpoca {
  const raiz = lerXml(xml);
  const evolucao = raiz.nome === 'evolucao' ? raiz : (filho(raiz, 'evolucao') ?? raiz);
  const modelo = inteiro(evolucao.atributos['id_evolucao']);
  const campos = camposDaEvolucao(evolucao);
  return {
    modelo: modelo > 0 ? modelo : null,
    composicao: evolucao.atributos['nomeComposicao']?.trim() || null,
    campos: opcoes.mostrarDocumentos ? campos : ocultarDocumentosDosCampos(campos),
  };
}

// ── Documento como emitido ───────────────────────────────────────────────────────────────────────────

/** Blocos do cabeçalho congelado, na ordem do documento, com o título que a tela mostra. */
const BLOCOS: readonly (readonly [string, string])[] = [
  ['hospital', 'Estabelecimento'],
  ['paciente', 'Paciente'],
  ['atendimento', 'Atendimento'],
  ['responsavel', 'Responsável'],
  ['lancamento', 'Lançamento'],
];

/** Rótulos dos campos do documento (o resto aparece pelo nome do campo, com espaços). */
const ROTULOS: Readonly<Record<string, string>> = {
  nome: 'Nome',
  cnpj: 'CNPJ',
  cnes: 'CNES',
  prontuario: 'Prontuário',
  nascimento: 'Nascimento',
  sexo: 'Sexo',
  genero_social: 'Gênero',
  cpf: 'CPF',
  identidade: 'Identidade',
  orgao_emissor: 'Órgão emissor',
  uf_identidade: 'UF da identidade',
  nome_pai: 'Pai',
  nome_mae: 'Mãe',
  nacionalidade: 'Nacionalidade',
  pais_nascimento: 'País de nascimento',
  naturalidade: 'Naturalidade',
  uf_naturalidade: 'UF de nascimento',
  cbo: 'Ocupação (CBO)',
  profissao_cbo: 'Profissão',
  logradouro: 'Endereço',
  numero_logradouro: 'Número',
  complemento_logradouro: 'Complemento',
  bairro_logradouro: 'Bairro',
  cidade_logradouro: 'Cidade',
  uf_logradouro: 'UF',
  cep: 'CEP',
  registro: 'Atendimento',
  tipo_atendimento: 'Tipo',
  localizacao: 'Localização',
  unidade_atendimento: 'Unidade',
  nome_bloco: 'Bloco',
  codigo_acomodacao: 'Acomodação',
  nome_acomodacao: 'Acomodação',
  leito: 'Leito',
  medico_solicitante: 'Médico solicitante',
  medico_assistente: 'Médico assistente',
  data_hora_entrada: 'Entrada',
  nome_convenio: 'Convênio',
  nome_clinica: 'Clínica',
  nome_especialidade: 'Especialidade',
  parentesco: 'Parentesco',
  endereco: 'Endereço',
  bairro: 'Bairro',
  cidade: 'Cidade',
  uf: 'UF',
  complemento: 'Complemento',
  tipo_assinatura: 'Tipo de registro',
  situacao_documento: 'Situação',
  data_hora_evento: 'Data e hora',
  profissional_evento: 'Profissional',
  conselho: 'Conselho',
  codigo_conselho: 'Número no conselho',
  uf_conselho: 'UF do conselho',
  descricao_cbo: 'Ocupação',
};

/** Campos de documento pessoal: só saem com a permissão de ver documentos (como na ficha do cadastro). */
export const CAMPOS_DOCUMENTO_PESSOAL: ReadonlySet<string> = new Set([
  'cpf',
  'identidade',
  'orgao_emissor',
  'uf_identidade',
  'cns',
  'cpf_conjuge',
]);

/** Campos técnicos (identificadores internos e códigos) que não aparecem. */
function tecnico(nome: string): boolean {
  return /^id_/.test(nome) || nome === 'codigo_clinica' || nome === 'versaoXML';
}

function rotulo(nome: string): string {
  return ROTULOS[nome] ?? nome.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Data e hora do documento (AAAA-MM-DD[ T]HH:MM[:SS] ou DD/MM/AAAA) para DD/MM/AAAA HH:MM. */
export function dataDoDocumento(v: string): string {
  const s = v.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
  if (iso) {
    if (iso[1] === '1899') return '';
    return `${iso[3]}/${iso[2]}/${iso[1]}${iso[4] ? ` ${iso[4]}:${iso[5]}` : ''}`;
  }
  return /^30\/12\/1899/.test(s) ? '' : s;
}

/** Profissional aninhado (nome, conselho, número e UF) numa linha. */
function profissionalEmLinha(el: ElementoXml): string {
  const t = (n: string) => textoXml(filho(el, n)).trim();
  const conselho = [t('conselho'), t('codigo_conselho'), t('uf_conselho')].filter(Boolean).join(' ');
  return [t('nome'), conselho ? `(${conselho})` : ''].filter(Boolean).join(' ');
}

function camposDoBloco(el: ElementoXml, mostrarDocumentos: boolean): { rotulo: string; valor: string }[] {
  const saida: { rotulo: string; valor: string }[] = [];
  for (const f of filhosElemento(el)) {
    if (tecnico(f.nome)) continue;
    if (!mostrarDocumentos && CAMPOS_DOCUMENTO_PESSOAL.has(f.nome)) continue;
    let valor: string;
    if (soTexto(f)) {
      valor = textoXml(f).trim();
      if (/data|nascimento|entrada/.test(f.nome)) valor = dataDoDocumento(valor);
    } else {
      valor = profissionalEmLinha(f);
    }
    if (valor !== '') saida.push({ rotulo: rotulo(f.nome), valor });
  }
  return saida;
}

/**
 * Documento como emitido: o XML do documento (já descomprimido e decodificado pelo adaptador). Sem a
 * permissão de ver documentos, CPF, identidade e afins não saem (o resto do cabeçalho congelado sai).
 */
export function lerDocumentoEmitido(
  xml: string,
  opcoes: { readonly mostrarDocumentos: boolean },
): Pick<ComoEmitido, 'blocos' | 'campos'> {
  const raiz = lerXml(xml);
  const blocos: ComoEmitido['blocos'] = [];
  for (const [nome, titulo] of BLOCOS) {
    const el = filho(raiz, nome);
    if (!el) continue;
    const campos = camposDoBloco(el, opcoes.mostrarDocumentos);
    if (campos.length > 0) blocos.push({ titulo, campos });
  }
  const evolucao = procurar(raiz, 'evolucao');
  const campos = evolucao ? camposDaEvolucao(evolucao) : [];
  return { blocos, campos: opcoes.mostrarDocumentos ? campos : ocultarDocumentosDosCampos(campos) };
}

/** Texto do valor (conferência e busca). */
export function textoDoValor(v: ValorCampoRegistro): string {
  switch (v.tipo) {
    case 'vazio':
      return '';
    case 'texto':
      return v.texto;
    case 'formatado':
      return textoCorrido(v.texto);
    case 'lista':
      return v.itens.join('; ');
  }
}
