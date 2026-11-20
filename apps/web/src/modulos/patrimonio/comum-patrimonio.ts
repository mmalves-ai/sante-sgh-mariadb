// Comuns das telas do patrimônio (M54, etapa 6): valores em reais digitados, competências, o rascunho do cadastro do bem
// (nota ou termo) com as conferências da tela antes do servidor, a alteração a partir do bem lido, a conferência
// impressa dos totais (toda conta agregada com as parcelas) e o nome do setor. O servidor confere tudo de novo.
import type {
  AlterarBem,
  BemPatrimonial,
  GrupoBem,
  ItemNotaParaBem,
  ParcelaDepreciacao,
  RefCentro,
} from '@sgh/contratos';
import { TETO_BENS_POR_CADASTRO } from '@sgh/contratos';
import type { EntradaCadastro } from './api-patrimonio.js';
import { reais } from '../contabil/comum-contabil.js';

export { instante, dataBr } from '../contabil/comum-contabil.js';
export { reais, rotuloCompetencia, competenciasAte } from '../contabil/comum-contabil.js';

/** Centavos de um valor digitado ("1.234,56", "1234.5", "R$ 10"); vazio é 0; inválido é null. */
export function centavosOuZero(texto: string): number | null {
  const t = texto.trim().replace(/\s|R\$/g, '');
  if (!t) return 0;
  let normal: string;
  if (t.includes(',')) normal = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, '');
  else normal = t;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  const [inteiro, dec = ''] = normal.split('.') as [string, string?];
  const c = Number(inteiro) * 100 + Number((dec + '00').slice(0, 2));
  return Number.isSafeInteger(c) ? c : null;
}

/** Valor em centavos como o campo mostra para editar ("1234,56"). */
export const textoDosCentavos = (c: number) => `${Math.trunc(c / 100)},${String(c % 100).padStart(2, '0')}`;

/** Competência (AAAA-MM) de uma data AAAA-MM-DD. */
/**
 * W0-08: o nome do grupo do bem pelo cadastro (apoio: revisão, todos os grupos, inclusive os inativos, para o bem de
 * grupo inativo mostrar o nome cadastrado); sem ele (o código que não está mais no cadastro), o rótulo da semente
 * (i18n) ou o código.
 */
export function nomeDoGrupo(
  grupos: readonly { readonly valor: string; readonly rotulo: string }[] | undefined,
  codigo: string,
  t: (chave: string) => string,
): string {
  const doCadastro = grupos?.find((g) => g.valor === codigo)?.rotulo;
  if (doCadastro) return doCadastro;
  const chave = `patrimonio.grupos.${codigo}`;
  const semente = t(chave);
  return semente === chave ? codigo : semente;
}

export const competenciaDe = (data: string) => data.slice(0, 7);

/** A competência anterior (a depreciação se calcula depois do fim do mês). */
export function competenciaAnterior(c: string): string {
  const [a, m] = c.split('-').map(Number) as [number, number];
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

export const rotuloCentro = (c: RefCentro | null | undefined) =>
  c ? (c.codigo !== null ? `${c.codigo} - ${c.nome}` : c.nome) : '';

/** "total = parcela + parcela" com cada parcela impressa (a soma das parcelas tem de dar o total). */
export function conferenciaDasParcelas(totalCent: number, parcelas: readonly ParcelaDepreciacao[]) {
  const soma = parcelas.reduce((t, p) => t + p.valorCent, 0);
  return {
    texto: `${reais(totalCent)} = ${parcelas.map((p) => reais(p.valorCent)).join(' + ') || reais(0)}`,
    fecha: soma === totalCent,
  };
}

/** Rascunho do cadastro como a tela o edita (textos para os valores). */
export interface RascunhoCadastro {
  documento: 'nota' | 'termo';
  nota: number | null;
  itemNota: number | null;
  termoNumero: string;
  termoData: string | null;
  doador: string;
  empresa: number | null;
  dataAquisicao: string | null;
  valor: string;
  descricao: string;
  grupo: GrupoBem;
  origem: number | null;
  centro: number | null;
  localDetalhe: string;
  tipoResponsavel: number | null;
  responsavel: string;
  marca: string;
  modelo: string;
  numeroSerie: string;
  plaqueta: string;
  vidaUtilMeses: string;
  residual: string;
  coeficiente: number | null;
  inicioDepreciacao: string;
  quantidade: number;
}

export function rascunhoVazio(documento: 'nota' | 'termo' = 'nota'): RascunhoCadastro {
  return {
    documento,
    nota: null,
    itemNota: null,
    termoNumero: '',
    termoData: null,
    doador: '',
    empresa: null,
    dataAquisicao: null,
    valor: '',
    descricao: '',
    grupo: 'equipamentoMedico',
    origem: null,
    centro: null,
    localDetalhe: '',
    tipoResponsavel: null,
    responsavel: '',
    marca: '',
    modelo: '',
    numeroSerie: '',
    plaqueta: '',
    vidaUtilMeses: '',
    residual: '',
    coeficiente: null,
    inicioDepreciacao: '',
    quantidade: 1,
  };
}

/** O rascunho a partir do item da nota escolhido: a descrição e todas as unidades ainda sem bem. */
export function rascunhoDoItem(r: RascunhoCadastro, nota: number, item: ItemNotaParaBem): RascunhoCadastro {
  return {
    ...r,
    documento: 'nota',
    nota,
    itemNota: item.id,
    descricao: r.descricao || item.nome.slice(0, 120),
    quantidade: Math.max(1, Math.min(item.disponiveis, TETO_BENS_POR_CADASTRO)),
  };
}

const vazioNulo = (t: string) => (t.trim() === '' ? null : t.trim());

/** O que impede enviar o rascunho (textos da tela; o servidor confere de novo). */
export function problemasDoCadastro(r: RascunhoCadastro, item: ItemNotaParaBem | null): string[] {
  const p: string[] = [];
  if (r.documento === 'nota') {
    if (r.nota === null || r.itemNota === null) p.push('escolhaItem');
    else if (item && r.quantidade > item.disponiveis) p.push('quantidadeAcimaDoItem');
  } else {
    if (!r.termoNumero.trim()) p.push('termoNumero');
    if (!r.termoData) p.push('termoData');
    if (!r.doador.trim()) p.push('doador');
    if (r.empresa === null) p.push('empresa');
    if (!r.dataAquisicao) p.push('dataAquisicao');
    const v = centavosOuZero(r.valor);
    if (v === null || v <= 0) p.push('valor');
  }
  if (!r.descricao.trim()) p.push('descricao');
  if (r.origem === null) p.push('origem');
  if (r.centro === null) p.push('centro');
  if (r.responsavel.trim() && r.tipoResponsavel === null) p.push('tipoResponsavel');
  if (r.quantidade < 1 || r.quantidade > TETO_BENS_POR_CADASTRO) p.push('quantidade');
  if (r.quantidade > 1 && r.numeroSerie.trim()) p.push('serieComVarias');
  if (r.quantidade > 1 && r.plaqueta.trim()) p.push('plaquetaComVarias');
  if (r.plaqueta.trim() && !/^[A-Za-z0-9-]{1,20}$/.test(r.plaqueta.trim())) p.push('plaqueta');
  if (r.vidaUtilMeses.trim() && !/^\d{1,4}$/.test(r.vidaUtilMeses.trim())) p.push('vidaUtil');
  if (centavosOuZero(r.residual) === null) p.push('residual');
  if (r.inicioDepreciacao.trim() && !/^\d{4}-(0[1-9]|1[0-2])$/.test(r.inicioDepreciacao.trim()))
    p.push('inicioDepreciacao');
  return p;
}

/** O corpo do POST /bens (só os campos do documento escolhido: o esquema do servidor é estrito). */
export function corpoDoCadastro(r: RascunhoCadastro): EntradaCadastro {
  const comuns = {
    descricao: r.descricao.trim(),
    grupo: r.grupo,
    origem: r.origem ?? 0,
    centro: r.centro ?? 0,
    localDetalhe: vazioNulo(r.localDetalhe),
    tipoResponsavel: r.tipoResponsavel,
    responsavel: vazioNulo(r.responsavel),
    marca: vazioNulo(r.marca),
    modelo: vazioNulo(r.modelo),
    numeroSerie: vazioNulo(r.numeroSerie),
    plaqueta: vazioNulo(r.plaqueta)?.toUpperCase() ?? null,
    vidaUtilMeses: r.vidaUtilMeses.trim() ? Number(r.vidaUtilMeses.trim()) : null,
    residualCent: centavosOuZero(r.residual) ?? 0,
    coeficiente: r.coeficiente,
    inicioDepreciacao: vazioNulo(r.inicioDepreciacao),
    quantidade: r.quantidade,
  };
  if (r.documento === 'nota')
    return { documento: 'nota', nota: r.nota ?? 0, itemNota: r.itemNota ?? 0, ...comuns };
  return {
    documento: 'termo',
    termoNumero: r.termoNumero.trim(),
    termoData: r.termoData ?? '',
    doador: r.doador.trim(),
    empresa: r.empresa ?? 0,
    dataAquisicao: r.dataAquisicao ?? '',
    valorCent: centavosOuZero(r.valor) ?? 0,
    ...comuns,
  };
}

/** Rascunho da alteração a partir do bem lido (a versão vai junto). */
export interface RascunhoAlteracao {
  descricao: string;
  grupo: GrupoBem;
  localDetalhe: string;
  tipoResponsavel: number | null;
  responsavel: string;
  marca: string;
  modelo: string;
  numeroSerie: string;
  vidaUtilMeses: string;
  residual: string;
  coeficiente: number | null;
  inicioDepreciacao: string;
  depreciavel: boolean;
}

export function rascunhoDoBem(b: BemPatrimonial): RascunhoAlteracao {
  return {
    descricao: b.descricao,
    grupo: b.grupo,
    localDetalhe: b.localDetalhe ?? '',
    tipoResponsavel: b.tipoResponsavel?.id ?? null,
    responsavel: b.responsavel ?? '',
    marca: b.marca ?? '',
    modelo: b.modelo ?? '',
    numeroSerie: b.numeroSerie ?? '',
    vidaUtilMeses: String(b.vidaUtilMeses),
    residual: textoDosCentavos(b.residualCent),
    coeficiente: b.coeficiente?.id ?? null,
    inicioDepreciacao: b.inicioDepreciacao,
    depreciavel: b.depreciavel,
  };
}

export function problemasDaAlteracao(r: RascunhoAlteracao): string[] {
  const p: string[] = [];
  if (!r.descricao.trim()) p.push('descricao');
  if (r.responsavel.trim() && r.tipoResponsavel === null) p.push('tipoResponsavel');
  if (!/^\d{1,4}$/.test(r.vidaUtilMeses.trim()) || Number(r.vidaUtilMeses) < 1) p.push('vidaUtil');
  if (centavosOuZero(r.residual) === null) p.push('residual');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.inicioDepreciacao.trim())) p.push('inicioDepreciacao');
  return p;
}

export function corpoDaAlteracao(r: RascunhoAlteracao, versao: number): AlterarBem {
  return {
    descricao: r.descricao.trim(),
    grupo: r.grupo,
    localDetalhe: vazioNulo(r.localDetalhe),
    tipoResponsavel: r.tipoResponsavel,
    responsavel: vazioNulo(r.responsavel),
    marca: vazioNulo(r.marca),
    modelo: vazioNulo(r.modelo),
    numeroSerie: vazioNulo(r.numeroSerie),
    vidaUtilMeses: Number(r.vidaUtilMeses.trim()),
    residualCent: centavosOuZero(r.residual) ?? 0,
    coeficiente: r.coeficiente,
    inicioDepreciacao: r.inicioDepreciacao.trim(),
    depreciavel: r.depreciavel,
    versao,
  };
}

/** Oferece a etiqueta ZPL como arquivo (a impressora térmica recebe o texto como está). */
export function baixarTexto(nome: string, texto: string): void {
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** A data de hoje no relógio de quem usa (não a UTC: depois das 21 h no Brasil, a UTC já é amanhã). */
export function hojeLocal(agora = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}
