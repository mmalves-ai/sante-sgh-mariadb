// Declaração da RAIS do ano-base (Decreto 76.900/1975), arquivo de 551 posições do GDRAIS (M53-F7): só nos anos-base
// em que o regime gravado ainda a exige (antes do eSocial). Registros 0 (o responsável), 1 (o estabelecimento), 2
// (cada empregado com vínculo no ano: as 12 remunerações, o 13º por parcela, a admissão e o desligamento) e 9 (os
// totais). Valores com 2 decimais sem vírgula. A remuneração do mês é a base do FGTS sem o 13º dos processamentos do
// mês (D-RAIS-REM-538). D-LEIAUTE-538: tabela de campos conferida no GDRAIS antes da entrega.
import type { PendenciaObrigacao } from '@sgh/contratos';
import {
  admissaoRais,
  cboDaFicha,
  DESLIGAMENTO_RAIS,
  instrucaoRaisCaged,
  RACA_COR_RAIS_CAGED,
  sexoRaisCaged,
  vinculoRais,
} from './correspondencias.js';
import { arquivoDeLinhas, dataDDMMAAAA, type LeiauteRegistro, montarRegistro } from './leiaute-fixo.js';
import { pendenciaObrigacao } from './regime.js';
import { noCatalogo } from './sefip.js';
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

const MESES = Array.from({ length: 12 }, (_, i) => `rem${String(i + 1).padStart(2, '0')}`);

export const LEIAUTE_RAIS: Readonly<Record<'0' | '1' | '2' | '9', LeiauteRegistro>> = {
  '0': {
    registro: '0',
    tamanho: 551,
    campos: [
      N('sequencia', 6),
      N('inscricao', 14),
      F('prefixo', '00'),
      F('tipo', '0'),
      F('constante', '1'),
      N('inscricaoResponsavel', 14),
      F('tipoInscricao', '1'),
      A('razaoSocial', 40),
      A('logradouro', 40),
      N('numero', 6),
      A('complemento', 21),
      A('bairro', 19),
      N('cep', 8),
      N('municipio', 7),
      A('nomeMunicipio', 30),
      A('uf', 2),
      N('ddd', 2),
      N('telefone', 9),
      F('retificacao', '2'),
      N('dataRetificacao', 8),
      N('dataGeracao', 8),
      A('email', 45),
      A('nomeResponsavel', 52),
      B(24),
      N('cpfResponsavel', 11),
      N('crea', 12),
      N('nascimentoResponsavel', 8),
      B(159),
    ],
  },
  '1': {
    registro: '1',
    tamanho: 551,
    campos: [
      N('sequencia', 6),
      N('inscricao', 14),
      F('prefixo', '00'),
      F('tipo', '1'),
      A('razaoSocial', 52),
      A('logradouro', 40),
      N('numero', 6),
      A('complemento', 21),
      A('bairro', 19),
      N('cep', 8),
      N('municipio', 7),
      A('nomeMunicipio', 30),
      A('uf', 2),
      N('ddd', 2),
      N('telefone', 9),
      A('email', 45),
      N('cnae', 7),
      N('naturezaJuridica', 4),
      N('proprietarios', 4),
      N('dataBase', 2),
      F('tipoInscricao', '1'),
      N('tipoRais', 1),
      B(2),
      N('ceiVinculado', 12),
      N('anoBase', 4),
      N('porte', 1),
      F('simples', '2'),
      F('pat', '2'),
      B(247),
    ],
  },
  '2': {
    registro: '2',
    tamanho: 551,
    campos: [
      N('sequencia', 6),
      N('inscricao', 14),
      F('prefixo', '00'),
      F('tipo', '2'),
      N('nis', 11),
      A('nome', 52),
      N('nascimento', 8),
      F('nacionalidade', '10'),
      N('anoChegada', 4),
      N('instrucao', 2),
      N('cpf', 11),
      N('ctps', 8),
      N('serieCtps', 5),
      N('admissao', 8),
      N('tipoAdmissao', 2),
      N('salario', 9),
      F('tipoSalario', '1'),
      N('horas', 2),
      N('cbo', 6),
      N('vinculo', 2),
      N('causaDesligamento', 2),
      N('dataDesligamento', 4),
      ...MESES.map((m) => N(m, 9)),
      N('decimoAdiantamento', 9),
      N('mesAdiantamento', 2),
      N('decimoFinal', 9),
      N('mesFinal', 2),
      N('racaCor', 1),
      N('deficiente', 1),
      N('tipoDeficiencia', 1),
      N('alvara', 1),
      N('avisoIndenizado', 9),
      N('sexo', 1),
      ...[1, 2, 3].flatMap((i) => [N(`afast${i}Motivo`, 2), N(`afast${i}Inicio`, 4), N(`afast${i}Fim`, 4)]),
      N('diasAfastamento', 3),
      N('feriasIndenizadas', 8),
      N('bancoHoras', 8),
      N('mesesBancoHoras', 2),
      N('dissidio', 8),
      N('mesesDissidio', 2),
      N('gratificacoes', 8),
      N('mesesGratificacoes', 2),
      N('multaRescisao', 8),
      B(166),
    ],
  },
  '9': {
    registro: '9',
    tamanho: 551,
    campos: [
      N('sequencia', 6),
      N('inscricao', 14),
      F('prefixo', '00'),
      F('tipo', '9'),
      N('totalRegistros1', 6),
      N('totalRegistros2', 6),
      B(516),
    ],
  },
};

export interface EntradaRais {
  readonly anoBase: string;
  readonly empresa: EmpresaObrigacao;
  /** Os empregados com vínculo em algum dia do ano-base. */
  readonly trabalhadores: readonly TrabalhadorObrigacao[];
  readonly remuneracoes: ReadonlyMap<number, RemuneracaoObrigacao>;
  readonly catalogos: Pick<CatalogosObrigacoes, 'vinculosRais' | 'desligamentosRais' | 'admissoesRais'>;
  /** A data de geração (AAAA-MM-DD, o relógio do banco). */
  readonly hoje: string;
}

const noAno = (d: string | null, ano: string) => !!d && d.slice(0, 4) === ano;

export function pendenciasRais(x: EntradaRais): PendenciaObrigacao[] {
  const semFicha: number[] = [];
  const semNis: number[] = [];
  const semCbo: number[] = [];
  const semCorresp: number[] = [];
  const fora: number[] = [];
  for (const t of x.trabalhadores) {
    const f = t.ficha;
    if (!f) {
      semFicha.push(t.vinculo);
      continue;
    }
    if (!f.nis) semNis.push(t.vinculo);
    if (!cboDaFicha(f)) semCbo.push(t.vinculo);
    const vin = vinculoRais(f);
    if (!vin) semCorresp.push(t.vinculo);
    else if (!noCatalogo(x.catalogos.vinculosRais, vin)) fora.push(t.vinculo);
    if (!noCatalogo(x.catalogos.admissoesRais, admissaoRais(f))) fora.push(t.vinculo);
    if (noAno(t.desligamento, x.anoBase)) {
      const c = t.modalidadeRescisao ? DESLIGAMENTO_RAIS[t.modalidadeRescisao] : null;
      if (!c) semCorresp.push(t.vinculo);
      else if (!noCatalogo(x.catalogos.desligamentosRais, c)) fora.push(t.vinculo);
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
        'A categoria ou o desligamento não tem código correspondente na RAIS.',
        [...new Set(semCorresp)],
      ),
    );
  if (fora.length)
    ps.push(
      pendenciaObrigacao(
        'codigo-fora-do-catalogo',
        'O código correspondente não está no catálogo oficial da RAIS do banco.',
        [...new Set(fora)],
      ),
    );
  return ps;
}

export function montarRais(x: EntradaRais): ArquivoObrigacao {
  const e = x.empresa;
  const p = e.parametros;
  const ddd = p.contato.telefone.slice(0, 2);
  const fone = p.contato.telefone.slice(2).slice(-9);
  const L = LEIAUTE_RAIS;
  let seq = 1;
  const linhas = [
    montarRegistro(L['0'], {
      sequencia: seq++,
      inscricao: e.cnpj,
      inscricaoResponsavel: e.cnpj,
      razaoSocial: p.razaoSocial,
      logradouro: p.endereco.logradouro,
      bairro: p.endereco.bairro,
      cep: p.endereco.cep,
      municipio: p.endereco.municipio,
      nomeMunicipio: p.endereco.cidade,
      uf: p.endereco.uf,
      ddd,
      telefone: fone,
      dataGeracao: dataDDMMAAAA(x.hoje),
      email: p.contato.email,
      nomeResponsavel: p.contato.nome,
    }),
    montarRegistro(L['1'], {
      sequencia: seq++,
      inscricao: e.cnpj,
      razaoSocial: p.razaoSocial,
      logradouro: p.endereco.logradouro,
      bairro: p.endereco.bairro,
      cep: p.endereco.cep,
      municipio: p.endereco.municipio,
      nomeMunicipio: p.endereco.cidade,
      uf: p.endereco.uf,
      ddd,
      telefone: fone,
      email: p.contato.email,
      cnae: e.cnae,
      naturezaJuridica: p.naturezaJuridica,
      dataBase: 1,
      tipoRais: x.trabalhadores.length ? 0 : 1,
      anoBase: x.anoBase,
    }),
  ];
  const ordenados = [...x.trabalhadores].sort((a, b) => a.vinculo - b.vinculo);
  for (const t of ordenados) {
    const f = t.ficha!;
    const r = x.remuneracoes.get(t.vinculo);
    const meses = Object.fromEntries(
      MESES.map((m, i) => [m, r?.porMes?.[`${x.anoBase}-${String(i + 1).padStart(2, '0')}`] ?? 0]),
    );
    const desligado = noAno(t.desligamento, x.anoBase);
    linhas.push(
      montarRegistro(L['2'], {
        sequencia: seq++,
        inscricao: e.cnpj,
        nis: f.nis!,
        nome: t.nome,
        nascimento: dataDDMMAAAA(f.nascimento),
        instrucao: instrucaoRaisCaged(f.grauInstrucao),
        cpf: t.cpf ?? '',
        admissao: dataDDMMAAAA(t.admissao),
        tipoAdmissao: admissaoRais(f),
        salario: t.salario ?? 0,
        horas: Math.min(99, t.cargaSemanal),
        cbo: cboDaFicha(f)!,
        vinculo: vinculoRais(f)!,
        causaDesligamento: desligado ? DESLIGAMENTO_RAIS[t.modalidadeRescisao!] : '',
        dataDesligamento: desligado ? dataDDMMAAAA(t.desligamento).slice(0, 4) : '',
        ...meses,
        decimoAdiantamento: r?.decimoAdiantamento?.valor ?? 0,
        mesAdiantamento: r?.decimoAdiantamento?.mes ?? 0,
        decimoFinal: r?.decimoFinal?.valor ?? 0,
        mesFinal: r?.decimoFinal?.mes ?? 0,
        racaCor: RACA_COR_RAIS_CAGED[f.racaCor] ?? '9',
        deficiente: 2,
        alvara: 2,
        sexo: sexoRaisCaged(f.sexo),
        multaRescisao: r?.rescisorio ?? 0,
      }),
    );
  }
  linhas.push(
    montarRegistro(L['9'], {
      sequencia: seq,
      inscricao: e.cnpj,
      totalRegistros1: 1,
      totalRegistros2: ordenados.length,
    }),
  );
  return { nomeArquivo: `RAIS${x.anoBase}.txt`, conteudo: arquivoDeLinhas(linhas), linhas: linhas.length };
}
