// Arquivo SEFIP.RE do recolhimento do FGTS e das informações à Previdência (GFIP), leiaute SEFIP 8.4 (M53-F7): só nas
// competências em que o regime gravado ainda a exige (antes do FGTS Digital). Registros de 360 posições: 00 (o
// responsável), 10 (a empresa), 30 (cada trabalhador, em ordem de NIS, admissão e categoria), 32 (a movimentação do
// trabalhador desligado na competência, logo depois do 30 dele) e 90 (o fim do arquivo). Valores com 2 decimais sem
// vírgula. O arquivo vai ao programa SEFIP, que calcula a guia: aqui só se informam as remunerações.
//
// D-LEIAUTE-538 (POL-5): as tabelas de campos dos três leiautes (SEFIP, CAGED e RAIS) são dado, num arquivo por
// leiaute; o regime de cada empresa nasce com o leiaute NÃO conferido e a entrega só se registra depois que o DP
// importar um arquivo gerado no programa oficial sem erro e marcar o leiaute como conferido (a prova, como a receita
// não provada sai desligada, POL-3).
import type { PendenciaObrigacao } from '@sgh/contratos';
import { CATEGORIA_SEFIP, cboDaFicha, MOVIMENTACAO_SEFIP } from './correspondencias.js';
import {
  arquivoDeLinhas,
  competenciaAAAAMM,
  dataDDMMAAAA,
  type LeiauteRegistro,
  montarRegistro,
} from './leiaute-fixo.js';
import { pendenciaObrigacao } from './regime.js';
import type {
  ArquivoObrigacao,
  CatalogosObrigacoes,
  EmpresaObrigacao,
  RemuneracaoObrigacao,
  TrabalhadorObrigacao,
} from './tipos.js';

const N = (nome: string, tamanho: number) => ({ nome, tamanho, tipo: 'N' as const });
const A = (nome: string, tamanho: number) => ({ nome, tamanho, tipo: 'A' as const });
const B = (tamanho: number) => ({ nome: 'brancos', tamanho, tipo: 'B' as const });
const F = (nome: string, fixo: string) => ({ nome, tamanho: fixo.length, tipo: 'F' as const, fixo });
const FIM = F('fim', '*');

export const LEIAUTE_SEFIP_84: Readonly<Record<'00' | '10' | '30' | '32' | '90', LeiauteRegistro>> = {
  '00': {
    registro: '00',
    tamanho: 360,
    campos: [
      F('tipo', '00'),
      B(51),
      F('tipoRemessa', '1'),
      F('tipoInscricaoResponsavel', '1'),
      N('inscricaoResponsavel', 14),
      A('nomeResponsavel', 30),
      A('contato', 20),
      A('logradouro', 50),
      A('bairro', 20),
      N('cep', 8),
      A('cidade', 20),
      A('uf', 2),
      N('telefone', 12),
      A('email', 60),
      N('competencia', 6),
      N('codigoRecolhimento', 3),
      A('indicadorFgts', 1),
      A('modalidade', 1),
      A('dataFgts', 8),
      A('indicadorPrevidencia', 1),
      A('dataPrevidencia', 8),
      A('indiceAtraso', 7),
      A('tipoInscricaoFornecedor', 1),
      A('inscricaoFornecedor', 14),
      B(18),
      FIM,
    ],
  },
  '10': {
    registro: '10',
    tamanho: 360,
    campos: [
      F('tipo', '10'),
      F('tipoInscricao', '1'),
      N('inscricao', 14),
      N('zeros', 36),
      A('razaoSocial', 40),
      A('logradouro', 50),
      A('bairro', 20),
      N('cep', 8),
      A('cidade', 20),
      A('uf', 2),
      N('telefone', 12),
      F('alteracaoEndereco', 'N'),
      N('cnae', 7),
      F('alteracaoCnae', 'N'),
      N('aliquotaRat', 2),
      F('centralizacao', '0'),
      F('simples', '1'),
      N('fpas', 3),
      N('outrasEntidades', 4),
      N('codigoGps', 4),
      N('filantropia', 5),
      N('salarioFamilia', 15),
      N('salarioMaternidade', 15),
      N('contribuicao13', 15),
      F('sinal13', '0'),
      N('valorDevido13', 14),
      N('banco', 3),
      N('agencia', 4),
      N('conta', 9),
      N('zerosFinal', 45),
      B(4),
      FIM,
    ],
  },
  '30': {
    registro: '30',
    tamanho: 360,
    campos: [
      F('tipo', '30'),
      F('tipoInscricao', '1'),
      N('inscricao', 14),
      A('tipoInscricaoTomador', 1),
      A('inscricaoTomador', 14),
      N('nis', 11),
      N('admissao', 8),
      N('categoria', 2),
      A('nome', 70),
      A('matricula', 11),
      N('ctps', 7),
      N('serieCtps', 5),
      N('opcao', 8),
      N('nascimento', 8),
      N('cbo', 6),
      N('remuneracao', 15),
      N('remuneracao13', 15),
      A('classe', 2),
      A('ocorrencia', 2),
      N('descontoSegurado', 15),
      N('baseInss', 15),
      N('base13Movimento', 15),
      N('base13Gps', 15),
      B(97),
      FIM,
    ],
  },
  '32': {
    registro: '32',
    tamanho: 360,
    campos: [
      F('tipo', '32'),
      F('tipoInscricao', '1'),
      N('inscricao', 14),
      A('tipoInscricaoTomador', 1),
      A('inscricaoTomador', 14),
      N('nis', 11),
      N('admissao', 8),
      N('categoria', 2),
      A('nome', 70),
      A('movimentacao', 2),
      N('dataMovimentacao', 8),
      A('recolheFgts', 1),
      B(225),
      FIM,
    ],
  },
  '90': {
    registro: '90',
    tamanho: 360,
    campos: [F('tipo', '90'), F('marca', '9'.repeat(51)), B(306), FIM],
  },
};

/** O código está no catálogo (os numéricos do banco vêm sem zero à esquerda: 01 = 1). */
export const noCatalogo = (catalogo: ReadonlySet<string>, codigo: string): boolean =>
  catalogo.has(codigo) || (/^\d+$/.test(codigo) && catalogo.has(String(Number(codigo))));

/** Vencimento do FGTS da competência: dia 7 do mês seguinte (Lei 8.036/1990, art. 15, na redação anterior). */
export function vencimentoFgtsSefip(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number) as [number, number];
  const ano = m === 12 ? a + 1 : a;
  const mes = m === 12 ? 1 : m + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-07`;
}

export interface EntradaSefip {
  readonly competencia: string;
  readonly empresa: EmpresaObrigacao;
  readonly trabalhadores: readonly TrabalhadorObrigacao[];
  readonly remuneracoes: ReadonlyMap<number, RemuneracaoObrigacao>;
  readonly catalogos: Pick<CatalogosObrigacoes, 'categoriasSefip' | 'movimentacoesSefip'>;
  /** A data do recolhimento do FGTS (nula: o vencimento). */
  readonly recolhimento: string | null;
}

/** O desligamento do trabalhador cai na competência (vai ao registro 32). */
const desligadoNa = (t: TrabalhadorObrigacao, c: string) =>
  !!t.desligamento && t.desligamento.slice(0, 7) === c;

/** As pendências do trabalhador para a SEFIP (dados obrigatórios e correspondências). */
export function pendenciasSefip(x: EntradaSefip): PendenciaObrigacao[] {
  const semFicha: number[] = [];
  const semNis: number[] = [];
  const semCbo: number[] = [];
  const semCategoria: number[] = [];
  const foraCatalogo: number[] = [];
  for (const t of x.trabalhadores) {
    const f = t.ficha;
    if (!f) {
      semFicha.push(t.vinculo);
      continue;
    }
    if (!f.nis) semNis.push(t.vinculo);
    if (!cboDaFicha(f)) semCbo.push(t.vinculo);
    const cat = CATEGORIA_SEFIP[f.categoria];
    if (!cat) semCategoria.push(t.vinculo);
    else if (!noCatalogo(x.catalogos.categoriasSefip, cat)) foraCatalogo.push(t.vinculo);
    if (desligadoNa(t, x.competencia)) {
      const mov = t.modalidadeRescisao ? MOVIMENTACAO_SEFIP[t.modalidadeRescisao] : null;
      if (!mov) semCategoria.push(t.vinculo);
      else if (!noCatalogo(x.catalogos.movimentacoesSefip, mov)) foraCatalogo.push(t.vinculo);
    }
  }
  const ps: PendenciaObrigacao[] = [];
  if (semFicha.length)
    ps.push(pendenciaObrigacao('sem-ficha', 'Colaboradores sem a ficha do eSocial preenchida.', semFicha));
  if (semNis.length)
    ps.push(
      pendenciaObrigacao('sem-nis', 'Colaboradores sem o NIS (PIS/PASEP) na ficha do eSocial.', semNis),
    );
  if (semCbo.length) ps.push(pendenciaObrigacao('sem-cbo', 'Colaboradores sem o CBO do cargo.', semCbo));
  if (semCategoria.length)
    ps.push(
      pendenciaObrigacao(
        'categoria-sem-correspondencia',
        'A categoria ou a modalidade de desligamento não tem código correspondente na SEFIP.',
        [...new Set(semCategoria)],
      ),
    );
  if (foraCatalogo.length)
    ps.push(
      pendenciaObrigacao(
        'codigo-fora-do-catalogo',
        'O código correspondente não está no catálogo oficial da SEFIP do banco.',
        [...new Set(foraCatalogo)],
      ),
    );
  return ps;
}

/** Monta o SEFIP.RE (só sem pendência; quem chama confere `pendenciasSefip` antes). */
export function montarSefip(x: EntradaSefip): ArquivoObrigacao {
  const e = x.empresa;
  const p = e.parametros;
  const comp = competenciaAAAAMM(x.competencia);
  const recolhimento = x.recolhimento ?? vencimentoFgtsSefip(x.competencia);
  const noPrazo = recolhimento <= vencimentoFgtsSefip(x.competencia);
  const L = LEIAUTE_SEFIP_84;
  const linhas: string[] = [
    montarRegistro(L['00'], {
      inscricaoResponsavel: e.cnpj,
      nomeResponsavel: p.razaoSocial,
      contato: p.contato.nome,
      logradouro: p.endereco.logradouro,
      bairro: p.endereco.bairro,
      cep: p.endereco.cep,
      cidade: p.endereco.cidade,
      uf: p.endereco.uf,
      telefone: p.contato.telefone,
      email: p.contato.email,
      competencia: comp,
      codigoRecolhimento: p.codigoRecolhimentoSefip,
      indicadorFgts: noPrazo ? '1' : '2',
      modalidade: ' ',
      dataFgts: noPrazo ? '' : dataDDMMAAAA(recolhimento),
      indicadorPrevidencia: '1',
    }),
    montarRegistro(L['10'], {
      inscricao: e.cnpj,
      razaoSocial: p.razaoSocial,
      logradouro: p.endereco.logradouro,
      bairro: p.endereco.bairro,
      cep: p.endereco.cep,
      cidade: p.endereco.cidade,
      uf: p.endereco.uf,
      telefone: p.contato.telefone,
      cnae: e.cnae,
      aliquotaRat: e.aliqRat * 10,
      fpas: e.fpas,
      outrasEntidades: e.codTerceiros,
      codigoGps: p.codigoPagamentoGps,
    }),
  ];
  const ordenados = [...x.trabalhadores].sort(
    (a, b) =>
      (a.ficha?.nis ?? '').localeCompare(b.ficha?.nis ?? '') ||
      a.admissao.localeCompare(b.admissao) ||
      (a.ficha?.categoria ?? '').localeCompare(b.ficha?.categoria ?? ''),
  );
  for (const t of ordenados) {
    const f = t.ficha!;
    const r = x.remuneracoes.get(t.vinculo);
    const categoria = CATEGORIA_SEFIP[f.categoria]!;
    const cbo = cboDaFicha(f)!;
    linhas.push(
      montarRegistro(L['30'], {
        inscricao: e.cnpj,
        nis: f.nis!,
        admissao: dataDDMMAAAA(t.admissao),
        categoria,
        nome: t.nome,
        matricula: t.matricula ?? '',
        opcao: dataDDMMAAAA(t.admissao),
        nascimento: dataDDMMAAAA(f.nascimento),
        // O leiaute leva a família do CBO (4 dígitos) precedida de zero (D-LEIAUTE-538: conferir no programa).
        cbo: `0${cbo.slice(0, 4)}`,
        remuneracao: r?.remuneracao ?? 0,
        remuneracao13: r?.remuneracaoDecimo ?? 0,
        classe: '',
        ocorrencia: '',
      }),
    );
    if (desligadoNa(t, x.competencia))
      linhas.push(
        montarRegistro(L['32'], {
          inscricao: e.cnpj,
          nis: f.nis!,
          admissao: dataDDMMAAAA(t.admissao),
          categoria,
          nome: t.nome,
          movimentacao: MOVIMENTACAO_SEFIP[t.modalidadeRescisao!],
          dataMovimentacao: dataDDMMAAAA(t.desligamento),
          recolheFgts: (r?.rescisorio ?? 0) > 0 ? 'S' : 'N',
        }),
      );
  }
  linhas.push(montarRegistro(L['90'], {}));
  return { nomeArquivo: 'SEFIP.RE', conteudo: arquivoDeLinhas(linhas), linhas: linhas.length };
}
