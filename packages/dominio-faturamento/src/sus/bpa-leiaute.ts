// Arquivo do BPA para importação no BPA-Mag / SIA (cap-12 §12.4; ficha do M51, seção 5: `faturamento.gerarBpa`). O
// estabelecimento importa a remessa no aplicativo BPA do Ministério e a entrega ao gestor (municipal ou estadual), que a
// processa no SIA. Descritor pelo leiaute de exportação do BPA (versão 04.10, conhecida do construtor; o documento oficial
// não pôde ser baixado do DATASUS nesta construção): `conferidoContraOficial: false` até o faturamento conferir campo a
// campo na importação de teste (D-LEIAUTE-BPA-51; a tela avisa para não enviar enquanto não conferido).
//   - cabeçalho (registro 01): '01', '#BPA#', competência AAAAMM, número de linhas, número de folhas, campo de controle,
//     órgão de origem, sigla, CNPJ do prestador, órgão de destino, indicador M/E e versão (130 posições);
//   - BPA consolidado (02): CNES, competência, CBO, folha, sequência, procedimento, idade, quantidade e origem 'BPA' (48);
//   - BPA individualizado (03): CNES, competência, CNS e CBO do profissional, data, folha, sequência, procedimento, CNS,
//     sexo, município, CID, idade, quantidade, caráter, autorização, origem, nome, nascimento, raça, etnia, nacionalidade,
//     serviço, classificação, equipe, CNPJ, endereço do paciente, telefone, e-mail e INE (338).
// Campo de controle do cabeçalho: (soma dos códigos de procedimento + soma das quantidades de todas as linhas) módulo
// 1111, mais 1111. Folhas: 20 linhas por folha no consolidado e 99 no individualizado, numeradas em separado.
import type { CompetenciaSus } from '@sgh/contratos';
import type { LinhaBpaC, LinhaBpaI } from './bpa.js';
import { type CampoLeiaute, FIM_DE_LINHA, type Leiaute, montarLinha } from './leiaute.js';

export const VERSAO_BPA = '04.10';
export const LINHAS_POR_FOLHA_BPA_C = 20;
export const LINHAS_POR_FOLHA_BPA_I = 99;

const n = (nome: string, tamanho: number, obrigatorio = false): CampoLeiaute => ({
  nome,
  tamanho,
  tipo: 'N',
  obrigatorio,
});
const nb = (nome: string, tamanho: number): CampoLeiaute => ({
  nome,
  tamanho,
  tipo: 'N',
  obrigatorio: false,
  branco: true,
});
const a = (nome: string, tamanho: number, obrigatorio = false): CampoLeiaute => ({
  nome,
  tamanho,
  tipo: 'A',
  obrigatorio,
});
const fixo = (nome: string, valor: string, tipo: 'N' | 'A' = 'N'): CampoLeiaute => ({
  nome,
  tamanho: valor.length,
  tipo,
  obrigatorio: true,
  fixo: valor,
});

export const LEIAUTE_BPA_MAG: Leiaute = {
  nome: 'BPA-MAG',
  versao: VERSAO_BPA,
  conferidoContraOficial: false,
  fonte:
    'Leiaute de exportação do BPA (SIA/SUS, versão 04.10), descrito pelo construtor do M51.2; conferir com o documento vigente do DATASUS',
  registros: {
    '01': {
      tipo: '01',
      campos: [
        fixo('ident', '01'),
        fixo('marca', '#BPA#', 'A'),
        n('competencia', 6, true),
        n('linhas', 6, true),
        n('folhas', 6, true),
        n('controle', 4, true),
        a('orgaoOrigem', 30, true),
        a('siglaOrigem', 6),
        n('cnpj', 14, true),
        a('orgaoDestino', 40, true),
        a('indicadorDestino', 1, true),
        a('versao', 10, true),
      ],
    },
    '02': {
      tipo: '02',
      campos: [
        fixo('ident', '02'),
        n('cnes', 7, true),
        n('competencia', 6, true),
        a('cbo', 6, true),
        n('folha', 3, true),
        n('sequencia', 2, true),
        n('procedimento', 10, true),
        n('idade', 3, true),
        n('quantidade', 6, true),
        fixo('origem', 'BPA', 'A'),
      ],
    },
    '03': {
      tipo: '03',
      campos: [
        fixo('ident', '03'),
        n('cnes', 7, true),
        n('competencia', 6, true),
        n('cnsProfissional', 15, true),
        a('cbo', 6, true),
        n('data', 8, true),
        n('folha', 3, true),
        n('sequencia', 2, true),
        n('procedimento', 10, true),
        n('cnsPaciente', 15, true),
        a('sexo', 1, true),
        n('municipio', 6, true),
        a('cid', 4),
        n('idade', 3, true),
        n('quantidade', 6, true),
        n('carater', 2, true),
        a('autorizacao', 13),
        fixo('origem', 'BPA', 'A'),
        a('nome', 30, true),
        n('nascimento', 8, true),
        n('raca', 2, true),
        a('etnia', 4),
        n('nacionalidade', 3, true),
        nb('servico', 3),
        nb('classificacao', 3),
        nb('equipeSequencia', 8),
        nb('equipeArea', 4),
        nb('cnpj', 14),
        nb('cep', 8),
        nb('codigoLogradouro', 3),
        a('endereco', 30),
        a('complemento', 10),
        a('numero', 5),
        a('bairro', 30),
        nb('telefone', 11),
        a('email', 40),
        nb('ine', 10),
      ],
    },
  },
};

export interface CabecalhoBpa {
  readonly orgaoOrigem: string;
  readonly siglaOrigem: string;
  readonly cnpj: string;
  readonly orgaoDestino: string;
  readonly indicadorDestino: 'M' | 'E';
}

/** Os campos do cabeçalho que faltam (a crítica do BPA os acusa antes de gerar). */
export function camposAusentesCabecalhoBpa(c: Partial<CabecalhoBpa>): string[] {
  const f: string[] = [];
  if (!(c.orgaoOrigem ?? '').trim()) f.push('orgaoOrigem');
  if (!/^\d{14}$/.test(c.cnpj ?? '')) f.push('cnpjPrestador');
  if (!(c.orgaoDestino ?? '').trim()) f.push('orgaoDestino');
  if (c.indicadorDestino !== 'M' && c.indicadorDestino !== 'E') f.push('indicadorDestino');
  return f;
}

/** Campo de controle: (Σ procedimentos + Σ quantidades) mod 1111 + 1111 (com BigInt: os códigos têm 10 dígitos). */
export function controleBpa(linhas: readonly { procedimento: string; quantidade: number }[]): number {
  let s = 0n;
  for (const l of linhas) s += BigInt(l.procedimento) + BigInt(Math.round(l.quantidade));
  return Number((s % 1111n) + 1111n);
}

/** Folha e sequência da k-ésima linha (k a partir de 0). */
export function folhaESequencia(k: number, porFolha: number): { folha: number; sequencia: number } {
  return { folha: Math.floor(k / porFolha) + 1, sequencia: (k % porFolha) + 1 };
}

const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'] as const;
const aaaammdd = (d: string) => d.slice(0, 10).replace(/-/g, '');
const corte = (v: string | null, t: number) => (v === null ? null : v.trim().slice(0, t));

export interface LinhaBpaNumerada {
  readonly tipo: 'c' | 'i';
  readonly folha: number;
  readonly sequencia: number;
  readonly procedimento: string;
  readonly cbo: string;
  readonly idade: number;
  readonly quantidade: number;
  readonly data: string | null;
  readonly conta: number | null;
  readonly atendimento: number | null;
}

export interface ArquivoBpaGerado {
  readonly nomeArquivo: string;
  readonly conteudo: string;
  readonly linhas: number;
  /** Atendimentos com produção no arquivo. */
  readonly registros: number;
  /** Linhas de procedimento (consolidadas e individualizadas). */
  readonly procedimentos: number;
  readonly folhas: number;
  readonly controle: number;
  readonly semMovimento: boolean;
  readonly leiaute: string;
  readonly versaoLeiaute: string;
  readonly conferidoContraOficial: boolean;
  /** As linhas na ordem do arquivo, com folha e sequência (sem dado pessoal: o que o banco do Sante guarda). */
  readonly numeradas: readonly LinhaBpaNumerada[];
}

/**
 * Monta o arquivo: o cabeçalho, as linhas consolidadas (ordenadas por procedimento, CBO e idade) e as individualizadas
 * (por conta e procedimento). A ordem é estável: o mesmo conjunto dá o mesmo arquivo e o mesmo hash.
 */
export function gerarArquivoBpa(
  competencia: CompetenciaSus,
  cnes: string | number,
  cabecalho: CabecalhoBpa,
  consolidado: readonly LinhaBpaC[],
  individualizado: readonly LinhaBpaI[],
  atendimentos: number,
  l: Leiaute = LEIAUTE_BPA_MAG,
): ArquivoBpaGerado {
  const corpo: string[] = [];
  const numeradas: LinhaBpaNumerada[] = [];
  consolidado.forEach((x, k) => {
    const fs = folhaESequencia(k, LINHAS_POR_FOLHA_BPA_C);
    corpo.push(
      montarLinha(l, '02', {
        cnes,
        competencia,
        cbo: x.cbo,
        folha: fs.folha,
        sequencia: fs.sequencia,
        procedimento: x.procedimento,
        idade: x.idade,
        quantidade: x.quantidade,
      }),
    );
    numeradas.push({ tipo: 'c', ...fs, ...x, data: null, conta: null, atendimento: null });
  });
  individualizado.forEach((x, k) => {
    const fs = folhaESequencia(k, LINHAS_POR_FOLHA_BPA_I);
    corpo.push(
      montarLinha(l, '03', {
        cnes,
        competencia,
        cnsProfissional: x.cnsProfissional,
        cbo: x.cbo,
        data: aaaammdd(x.data),
        folha: fs.folha,
        sequencia: fs.sequencia,
        procedimento: x.procedimento,
        cnsPaciente: x.cnsPaciente,
        sexo: x.sexo,
        municipio: String(x.municipio).slice(0, 6),
        cid: x.cid?.slice(0, 4) ?? null,
        idade: x.idade,
        quantidade: x.quantidade,
        carater: '01',
        nome: corte(x.nome, 30),
        nascimento: aaaammdd(x.nascimento),
        raca: x.raca,
        nacionalidade: '010',
        cep: x.cep?.slice(0, 8) ?? null,
        endereco: corte(x.logradouro, 30),
        complemento: corte(x.complemento, 10),
        numero: corte(x.numero, 5),
        bairro: corte(x.bairro, 30),
      }),
    );
    numeradas.push({
      tipo: 'i',
      ...fs,
      procedimento: x.procedimento,
      cbo: x.cbo,
      idade: x.idade,
      quantidade: x.quantidade,
      data: x.data,
      conta: x.conta,
      atendimento: x.atendimento,
    });
  });
  const folhasC = Math.ceil(consolidado.length / LINHAS_POR_FOLHA_BPA_C);
  const folhasI = Math.ceil(individualizado.length / LINHAS_POR_FOLHA_BPA_I);
  const controle = controleBpa([...consolidado, ...individualizado]);
  const cab = montarLinha(l, '01', {
    competencia,
    linhas: corpo.length,
    folhas: folhasC + folhasI,
    controle,
    orgaoOrigem: corte(cabecalho.orgaoOrigem, 30),
    siglaOrigem: corte(cabecalho.siglaOrigem, 6),
    cnpj: cabecalho.cnpj,
    orgaoDestino: corte(cabecalho.orgaoDestino, 40),
    indicadorDestino: cabecalho.indicadorDestino,
    versao: `V${l.versao}`,
  });
  const linhas = [cab, ...corpo];
  const mes = MESES[Number(competencia.slice(4, 6)) - 1] as string;
  return {
    nomeArquivo: `PA${String(cnes).padStart(7, '0')}${competencia}.${mes}`,
    conteudo: linhas.join(FIM_DE_LINHA) + FIM_DE_LINHA,
    linhas: linhas.length,
    registros: atendimentos,
    procedimentos: corpo.length,
    folhas: folhasC + folhasI,
    controle,
    semMovimento: corpo.length === 0,
    leiaute: l.nome,
    versaoLeiaute: l.versao,
    conferidoContraOficial: l.conferidoContraOficial,
    numeradas,
  };
}
