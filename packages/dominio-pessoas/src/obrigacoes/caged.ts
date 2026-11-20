// Arquivo do CAGED (Lei 4.923/1965), leiaute de 240 posições do aplicativo ACI (M53-F7): só nas competências em que o
// regime gravado ainda o exige (antes do eSocial). Registros A (o autorizado, a própria empresa), B (o estabelecimento,
// com o total de empregados no primeiro dia) e C (cada admissão e cada desligamento da competência). Salário com 2
// decimais sem vírgula. D-LEIAUTE-538: tabela de campos conferida no aplicativo oficial antes da entrega.
import type { PendenciaObrigacao } from '@sgh/contratos';
import {
  admissaoCaged,
  cboDaFicha,
  DESLIGAMENTO_CAGED,
  instrucaoRaisCaged,
  RACA_COR_RAIS_CAGED,
  sexoRaisCaged,
} from './correspondencias.js';
import {
  arquivoDeLinhas,
  competenciaMMAAAA,
  dataDDMMAAAA,
  type LeiauteRegistro,
  montarRegistro,
} from './leiaute-fixo.js';
import { pendenciaObrigacao } from './regime.js';
import { noCatalogo } from './sefip.js';
import type {
  ArquivoObrigacao,
  CatalogosObrigacoes,
  EmpresaObrigacao,
  TrabalhadorObrigacao,
} from './tipos.js';

const N = (nome: string, tamanho: number) => ({ nome, tamanho, tipo: 'N' as const });
const A = (nome: string, tamanho: number) => ({ nome, tamanho, tipo: 'A' as const });
const B = (tamanho: number) => ({ nome: 'brancos', tamanho, tipo: 'B' as const });
const F = (nome: string, fixo: string) => ({ nome, tamanho: fixo.length, tipo: 'F' as const, fixo });

export const LEIAUTE_CAGED: Readonly<Record<'A' | 'B' | 'C', LeiauteRegistro>> = {
  A: {
    registro: 'A',
    tamanho: 240,
    campos: [
      F('tipo', 'A'),
      F('meio', '2'),
      N('competencia', 6),
      F('alteracao', '1'),
      N('sequencia', 5),
      F('tipoIdentificador', '1'),
      N('identificador', 14),
      A('razaoSocial', 35),
      A('endereco', 40),
      N('cep', 8),
      A('uf', 2),
      N('ddd', 4),
      N('telefone', 8),
      N('ramal', 5),
      N('estabelecimentos', 5),
      N('movimentacoes', 5),
      B(99),
    ],
  },
  B: {
    registro: 'B',
    tamanho: 240,
    campos: [
      F('tipo', 'B'),
      F('tipoIdentificador', '1'),
      N('identificador', 14),
      N('sequencia', 5),
      F('primeiraDeclaracao', '2'),
      F('alteracao', '1'),
      N('cep', 8),
      B(5),
      A('razaoSocial', 40),
      A('endereco', 40),
      A('bairro', 20),
      A('uf', 2),
      N('empregadosPrimeiroDia', 5),
      N('porte', 1),
      N('cnae', 7),
      N('ddd', 4),
      N('telefone', 8),
      A('email', 50),
      B(27),
    ],
  },
  C: {
    registro: 'C',
    tamanho: 240,
    campos: [
      F('tipo', 'C'),
      F('tipoIdentificador', '1'),
      N('identificador', 14),
      N('sequencia', 5),
      N('nis', 11),
      N('sexo', 1),
      N('nascimento', 8),
      N('instrucao', 2),
      B(4),
      N('salario', 8),
      N('horas', 2),
      N('admissao', 8),
      N('movimento', 2),
      N('diaDesligamento', 2),
      A('nome', 40),
      N('ctps', 8),
      N('serieCtps', 4),
      B(7),
      N('racaCor', 1),
      N('deficiente', 1),
      N('cbo', 6),
      N('aprendiz', 1),
      A('ufCtps', 2),
      N('tipoDeficiencia', 1),
      N('cpf', 11),
      N('cepResidencia', 8),
      B(81),
    ],
  },
};

export interface EntradaCaged {
  readonly competencia: string;
  readonly empresa: EmpresaObrigacao;
  /** Os trabalhadores admitidos ou desligados na competência. */
  readonly movimentados: readonly TrabalhadorObrigacao[];
  /** Empregados no primeiro dia da competência. */
  readonly empregadosPrimeiroDia: number;
  readonly catalogos: Pick<CatalogosObrigacoes, 'admissoesCaged' | 'desligamentosCaged'>;
}

const noMes = (d: string | null, c: string) => !!d && d.slice(0, 7) === c;

export function pendenciasCaged(x: EntradaCaged): PendenciaObrigacao[] {
  const semFicha: number[] = [];
  const semNis: number[] = [];
  const semCbo: number[] = [];
  const semCorresp: number[] = [];
  const fora: number[] = [];
  for (const t of x.movimentados) {
    const f = t.ficha;
    if (!f) {
      semFicha.push(t.vinculo);
      continue;
    }
    if (!f.nis) semNis.push(t.vinculo);
    if (!cboDaFicha(f)) semCbo.push(t.vinculo);
    if (noMes(t.admissao, x.competencia) && !noCatalogo(x.catalogos.admissoesCaged, admissaoCaged(f)))
      fora.push(t.vinculo);
    if (noMes(t.desligamento, x.competencia)) {
      const m = t.modalidadeRescisao ? DESLIGAMENTO_CAGED[t.modalidadeRescisao] : null;
      if (!m) semCorresp.push(t.vinculo);
      else if (!noCatalogo(x.catalogos.desligamentosCaged, m)) fora.push(t.vinculo);
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
  if (semCorresp.length)
    ps.push(
      pendenciaObrigacao(
        'categoria-sem-correspondencia',
        'O desligamento sem a rescisão calculada não tem o tipo de movimento do CAGED.',
        semCorresp,
      ),
    );
  if (fora.length)
    ps.push(
      pendenciaObrigacao(
        'codigo-fora-do-catalogo',
        'O tipo de movimento não está no catálogo oficial do CAGED do banco.',
        [...new Set(fora)],
      ),
    );
  return ps;
}

/** Monta o arquivo do CAGED (uma linha C por movimento: quem foi admitido e desligado no mês tem duas). */
export function montarCaged(x: EntradaCaged): ArquivoObrigacao {
  const e = x.empresa;
  const p = e.parametros;
  const ddd = p.contato.telefone.slice(0, 2);
  const fone = p.contato.telefone.slice(2).slice(-8);
  const movimentos: { t: TrabalhadorObrigacao; movimento: string; dia: string }[] = [];
  for (const t of [...x.movimentados].sort((a, b) => a.vinculo - b.vinculo)) {
    if (noMes(t.admissao, x.competencia)) movimentos.push({ t, movimento: admissaoCaged(t.ficha!), dia: '' });
    if (noMes(t.desligamento, x.competencia))
      movimentos.push({
        t,
        movimento: DESLIGAMENTO_CAGED[t.modalidadeRescisao!],
        dia: t.desligamento!.slice(8, 10),
      });
  }
  let seq = 1;
  const L = LEIAUTE_CAGED;
  const linhas = [
    montarRegistro(L.A, {
      competencia: competenciaMMAAAA(x.competencia),
      sequencia: seq++,
      identificador: e.cnpj,
      razaoSocial: p.razaoSocial,
      endereco: p.endereco.logradouro,
      cep: p.endereco.cep,
      uf: p.endereco.uf,
      ddd,
      telefone: fone,
      estabelecimentos: 1,
      movimentacoes: movimentos.length,
    }),
    montarRegistro(L.B, {
      identificador: e.cnpj,
      sequencia: seq++,
      cep: p.endereco.cep,
      razaoSocial: p.razaoSocial,
      endereco: p.endereco.logradouro,
      bairro: p.endereco.bairro,
      uf: p.endereco.uf,
      empregadosPrimeiroDia: x.empregadosPrimeiroDia,
      porte: 0,
      cnae: e.cnae,
      ddd,
      telefone: fone,
      email: p.contato.email,
    }),
  ];
  for (const m of movimentos) {
    const f = m.t.ficha!;
    linhas.push(
      montarRegistro(L.C, {
        identificador: e.cnpj,
        sequencia: seq++,
        nis: f.nis!,
        sexo: sexoRaisCaged(f.sexo),
        nascimento: dataDDMMAAAA(f.nascimento),
        instrucao: instrucaoRaisCaged(f.grauInstrucao),
        salario: m.t.salario ?? 0,
        horas: Math.min(99, m.t.cargaSemanal),
        admissao: dataDDMMAAAA(m.t.admissao),
        movimento: m.movimento,
        diaDesligamento: m.dia,
        nome: m.t.nome,
        racaCor: RACA_COR_RAIS_CAGED[f.racaCor] ?? '9',
        deficiente: 2,
        cbo: cboDaFicha(f)!,
        aprendiz: f.categoria === '103' ? 1 : 2,
        tipoDeficiencia: 0,
        cpf: m.t.cpf ?? '',
        cepResidencia: f.endereco.cep,
      }),
    );
  }
  return {
    nomeArquivo: `CGED${competenciaMMAAAA(x.competencia)}.txt`,
    conteudo: arquivoDeLinhas(linhas),
    linhas: linhas.length,
  };
}
