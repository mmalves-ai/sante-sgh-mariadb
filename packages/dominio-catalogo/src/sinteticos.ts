// Arquivos SINTÉTICOS no leiaute oficial (ficha do M13, seção 10: os arquivos oficiais reais não estão no
// projeto, e o worker não baixa nada da internet fora de produção). Usados nos testes unitários, na integração
// na cópia, na fonte em memória da API e no E2E. Os códigos sintéticos ficam em faixas que o banco não usa
// (CID "U9x", CEP 999xxxxx, SIGTAP 99…, códigos acima de 9000) e os textos levam a marca "SGH M13".

export const MARCA_M13 = 'SGH M13';

const direita = (t: string, n: number) => t.slice(0, n).padEnd(n, ' ');
const zeros = (v: number | string, n: number) => String(v).padStart(n, '0').slice(-n);

export interface ProcedimentoSintetico {
  readonly codigo: string;
  readonly nome: string;
  readonly competencia: string;
  readonly valorSh?: number;
  readonly valorSa?: number;
  readonly valorSp?: number;
  readonly complexidade?: string;
  readonly sexo?: string;
  readonly financiamento?: string;
}

/** Uma linha de tb_procedimento.txt (336 posições; valores em centavos). */
export function linhaTbProcedimento(p: ProcedimentoSintetico): string {
  const c = (v: number | undefined) => zeros(Math.round((v ?? 0) * 100), 12);
  return (
    zeros(p.codigo, 10) +
    direita(p.nome, 250) +
    (p.complexidade ?? '2') +
    (p.sexo ?? 'I') +
    zeros(1, 4) +
    zeros(0, 4) +
    zeros(0, 4) +
    zeros(0, 4) +
    zeros(9999, 4) +
    c(p.valorSh) +
    c(p.valorSa) +
    c(p.valorSp) +
    (p.financiamento ?? '06') +
    zeros(0, 6) +
    zeros(9999, 4) +
    p.competencia
  );
}

export function arquivoTbProcedimento(itens: readonly ProcedimentoSintetico[]): string {
  return `${itens.map(linhaTbProcedimento).join('\r\n')}\r\n`;
}

export function arquivoRelacaoCid(
  pares: readonly { procedimento: string; cid: string }[],
  competencia: string,
): string {
  return pares.map((p) => `${zeros(p.procedimento, 10)}${direita(p.cid, 4)}S${competencia}`).join('\n');
}

export function arquivoRelacaoCbo(
  pares: readonly { procedimento: string; cbo: string }[],
  competencia: string,
): string {
  return pares.map((p) => `${zeros(p.procedimento, 10)}${zeros(p.cbo, 6)}${competencia}`).join('\n');
}

export function arquivoCid10(
  itens: readonly { codigo: string; nome: string; sexo?: 'M' | 'F' | ''; classif?: string }[],
): string {
  return [
    'SUBCAT;CLASSIF;RESTRSEXO;CAUSAOBITO;DESCRICAO;DESCRABREV;REFER;EXCLUIDOS;',
    ...itens.map(
      (i) => `${i.codigo};${i.classif ?? ''};${i.sexo ?? ''};;${i.nome};${i.nome.slice(0, 50)};;;`,
    ),
  ].join('\n');
}

export function arquivoCiap(itens: readonly { codigo: string; original: string; leigo: string }[]): string {
  return [
    'codigo;titulo_original;titulo_leigo;sexo',
    ...itens.map((i) => `${i.codigo};${i.original};${i.leigo};`),
  ].join('\n');
}

export function arquivoCodigoNome(
  cabecalho: string,
  itens: readonly { codigo: string; nome: string }[],
  sep = ';',
): string {
  return [cabecalho, ...itens.map((i) => `${i.codigo}${sep}${i.nome}`)].join('\n');
}

export function arquivoTuss(
  itens: readonly { codigo: string; nome: string; inicio?: string; fim?: string }[],
): string {
  return [
    'Código do Termo;Termo;Data de início de vigência;Data de fim de vigência;Data de fim de implantação',
    ...itens.map((i) => `${i.codigo};${i.nome};${i.inicio ?? '01/01/2026'};${i.fim ?? ''};`),
  ].join('\n');
}

export function arquivoFiscal(
  itens: readonly { codigo: string; nome: string; inicio?: string; fim?: string }[],
): string {
  return [
    'CODIGO|DESCRICAO|DATA_INICIO|DATA_FIM',
    ...itens.map((i) => `${i.codigo}|${i.nome}|${i.inicio ?? '01012026'}|${i.fim ?? ''}`),
  ].join('\n');
}

export function arquivoDcb(itens: readonly { codigo: string; nome: string; cas?: string }[]): string {
  return [
    'Nº DCB;DENOMINAÇÃO GENÉRICA;Nº CAS',
    ...itens.map((i) => `${i.codigo};${i.nome};${i.cas ?? ''}`),
  ].join('\n');
}

export function arquivoBancos(itens: readonly { codigo: string; nome: string }[]): string {
  return [
    'ISPB,Nome_Reduzido,Número_Código,Participa_da_Compe,Acesso_Principal,Nome_Extenso,Início_da_Operação',
    ...itens.map((i) => `00000000,${i.nome},${i.codigo},Sim,RSFN,${i.nome},01/01/2026`),
  ].join('\n');
}

export interface CepSintetico {
  readonly cep: string;
  readonly uf: string;
  readonly cidade: string;
  readonly logradouro: string;
  readonly bairro: string;
  readonly tipo?: string;
}

const linhaPos = (tam: number, campos: readonly [number, string][]) => {
  const l = Array.from({ length: tam }, () => ' ');
  for (const [ini, v] of campos) for (let i = 0; i < v.length; i++) l[ini - 1 + i] = v[i] as string;
  return l.join('');
};

/** Base de CEP no leiaute de posições padrão (seções LOCALIDADES e LOGRADOUROS). */
export function arquivoBaseCep(
  ceps: readonly CepSintetico[],
  municipios: readonly { ibge: string; nome: string; uf: string }[],
): string {
  const cab = (texto: string) => linhaPos(100, [[62, texto]]);
  const linhas = [cab('LOCALIDADES')];
  for (const m of municipios)
    linhas.push(
      linhaPos(170, [
        [4, m.uf],
        [20, direita(m.nome, 72)],
        [155, zeros(m.ibge, 7)],
      ]),
    );
  linhas.push(cab('LOGRADOUROS'));
  for (const c of ceps)
    linhas.push(
      linhaPos(530, [
        [2, c.uf],
        [18, direita(c.cidade, 72)],
        [103, direita(c.bairro, 72)],
        [260, direita(c.tipo ?? 'Rua', 26)],
        [375, direita(c.logradouro, 72)],
        [519, zeros(c.cep, 8)],
        [528, 'A'],
      ]),
    );
  return linhas.join('\n');
}

export function arquivoBrasindice(
  itens: readonly {
    codigo: string;
    nome: string;
    laboratorio: number;
    pmc: number;
    pfb: number;
    tipo?: number;
    fator?: number;
    tuss?: number;
    apresentacao?: string;
  }[],
  edicao: string,
): string {
  const f = (v: number) => v.toFixed(2).replace('.', ',');
  return [
    '"LAB";"NOME_LAB";"CODIGO";"NOME";"APRESENTACAO";"PMC";"PFB";"EDICAO";"TIPO";"FATOR";"TUSS"',
    ...itens.map(
      (i) =>
        `"${i.laboratorio}";"LAB ${MARCA_M13}";"${i.codigo}";"${i.nome}";"${i.apresentacao ?? 'SG01'}";"${f(i.pmc)}";"${f(i.pfb)}";"${edicao}";"${i.tipo ?? 2}";"${i.fator ?? 1}";"${i.tuss ?? 90000001}"`,
    ),
  ].join('\n');
}

export function arquivoSimpro(
  itens: readonly {
    codigo: string;
    nome: string;
    valor: number;
    classificacao?: number;
    unidade?: string;
    fabricante?: number;
    registroAnvisa?: string;
    referencia?: string;
    identificacao?: string;
    tuss?: number;
  }[],
  edicao: string,
): string {
  return itens
    .map(
      (i) =>
        `${zeros(i.codigo, 10)}${direita(i.nome, 100)}${zeros(Math.round(i.valor * 100), 12)}${zeros(edicao, 6)}` +
        `${zeros(i.classificacao ?? 1, 2)}${direita(i.unidade ?? 'UN', 6)}${zeros(i.fabricante ?? 1, 5)}` +
        `${direita(i.registroAnvisa ?? '80000000000', 14)}${direita(i.referencia ?? 'REF SGH', 30)}${i.identificacao ?? 'F'}${zeros(i.tuss ?? 0, 10)}`,
    )
    .join('\n');
}

/** Um milhão (ou n) de CEPs sintéticos na faixa 9999xxxx… por UF fictícia (só para medir a carga). */
export function cepsSinteticos(n: number, uf = 'ZZ'): CepSintetico[] {
  return Array.from({ length: n }, (_, i) => ({
    cep: String(90_000_000 + i).padStart(8, '0'),
    uf,
    cidade: `CIDADE ${MARCA_M13}`,
    logradouro: `RUA ${i}`,
    bairro: 'CENTRO',
  }));
}
