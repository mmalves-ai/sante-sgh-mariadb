// SPED contábil (M54-F3): ECD e ECF sobre o plano sintético das demonstrações, com a apuração do exercício. Dados
// sintéticos (CNPJ e CPF de teste).
import type { ContaPlano, SignatarioSped } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { PLANO } from './demonstracoes.spec-util.js';
import { planoDaApuracao } from './demonstracoes.js';
import {
  dataSped,
  type EmpresaSped,
  type EntradaSped,
  gerarEcd,
  gerarEcf,
  type LancamentoSped,
  naturezaSped,
  valorSped,
} from './sped.js';

const comRef = (c: ContaPlano): ContaPlano =>
  c.tipo === 'analitica' ? { ...c, referencialTipo: 1, referencialConta: `R.${c.codigo}` } : c;

const EMPRESA: EmpresaSped = {
  codigo: 1,
  nome: 'Hospital Sintético',
  cnpj: '00000000000191',
  uf: 'SP',
  inscricaoEstadual: null,
  codigoMunicipio: '3550308',
  municipio: 'São Paulo',
  inscricaoMunicipal: '123',
  nire: null,
  dataNire: null,
  endereco: 'Rua Sintética',
  numero: '1',
  complemento: null,
  bairro: 'Centro',
  cep: '01000000',
  telefone: null,
  email: null,
  cnae: '8610101',
  planoReferencial: '1',
  naturezaJuridica: '3999',
};

const SIGNATARIOS: SignatarioSped[] = [
  {
    nome: 'Contador Sintético',
    cpf: '00000000191',
    qualificacao: '900',
    crc: 'SP000000',
    email: null,
    telefone: null,
  },
  {
    nome: 'Diretor Sintético',
    cpf: '00000000272',
    qualificacao: '203',
    crc: null,
    email: null,
    telefone: null,
  },
];

const lanc = (id: number, data: string, d: string, c: string, v: number): LancamentoSped => ({
  id,
  data,
  tipo: 'manual',
  historico: `Lançamento ${id}`,
  encerramento: false,
  partidas: [
    { lado: 'D', conta: d, valorCentavos: v, historico: '' },
    { lado: 'C', conta: c, valorCentavos: v, historico: 'Contrapartida | com barra' },
  ],
});

function entrada(extra: Partial<EntradaSped> = {}): EntradaSped {
  const plano = PLANO.map(comRef);
  const ls = [
    lanc(1, '2027-01-05', '1.1.01', '3.1.01', 10_000),
    lanc(2, '2027-02-10', '1.1.02', '4.1.01', 50_000),
    lanc(3, '2027-03-10', '4.1.02', '1.1.02', 2_000),
    lanc(4, '2027-06-30', '5.1.01', '2.1.01', 15_000),
    lanc(5, '2027-11-30', '6.1.01', '1.1.01', 8_000),
  ];
  const saldos = ls.flatMap((l) =>
    l.partidas.map((p) => ({
      conta: p.conta,
      debitos: p.lado === 'D' ? p.valorCentavos : 0,
      creditos: p.lado === 'C' ? p.valorCentavos : 0,
      centroCusto: null,
    })),
  );
  const ap = planoDaApuracao({
    exercicio: 2027,
    plano,
    saldos,
    contaDestino: '3.1.02',
    hoje: '2028-01-10',
    dezembroEncerrado: false,
    apuracaoAtiva: null,
  });
  const apuracao: LancamentoSped = {
    id: 6,
    data: '2027-12-31',
    tipo: 'apuracao',
    historico: 'Apuração',
    encerramento: true,
    partidas: ap.partidas.map((p) => ({
      lado: p.lado,
      conta: p.conta,
      valorCentavos: p.valorCentavos,
      historico: p.historico,
    })),
  };
  return {
    exercicio: 2027,
    empresa: EMPRESA,
    plano,
    saldosIniciais: [],
    lancamentos: [...ls, apuracao],
    encerradas: new Set(Array.from({ length: 12 }, (_, i) => `2027-${String(i + 1).padStart(2, '0')}`)),
    signatarios: SIGNATARIOS,
    numeroOrdem: 3,
    substituta: false,
    hashAnterior: null,
    parcial: false,
    ...extra,
  };
}

const linhasDe = (t: string) => t.split('\r\n').filter((x) => x.length > 0);
const reg = (t: string, r: string) => linhasDe(t).filter((x) => x.startsWith(`|${r}|`));

describe('formatação', () => {
  it('datas, valores e a natureza das contas', () => {
    expect(dataSped('2027-03-09')).toBe('09032027');
    expect(valorSped(123_456)).toBe('1234,56');
    expect(valorSped(-5)).toBe('0,05');
    expect(naturezaSped('ativo')).toBe('01');
    expect(naturezaSped('patrimonioLiquido')).toBe('03');
    expect(naturezaSped('despesa')).toBe('04');
    expect(naturezaSped('compensacao')).toBe('05');
  });
});

describe('ECD', () => {
  it('blocos 0, I, J e 9; total de linhas no termo de abertura, no de encerramento e no 9999', () => {
    const r = gerarEcd(entrada());
    expect(r.impedimentos).toEqual([]);
    const t = r.conteudo;
    const linhas = linhasDe(t);
    expect(linhas[0]).toBe(
      '|0000|LECD|01012027|31122027|Hospital Sintético|00000000000191|SP||3550308|123||0|0|0||0|0||N|N|0|0|1|',
    );
    expect(linhas.at(-1)).toBe(`|9999|${linhas.length}|`);
    expect(r.linhas).toBe(linhas.length);
    expect(reg(t, 'I030')[0]).toContain(`|TERMO DE ABERTURA|3|DIARIO GERAL|${linhas.length}|`);
    expect(reg(t, 'J900')[0]).toContain(`|Hospital Sintético|${linhas.length}|01012027|31122027|`);
    expect(reg(t, 'I150')).toHaveLength(12);
    expect(reg(t, 'I200')).toHaveLength(6);
    expect(reg(t, 'I200').at(-1)).toBe('|I200|6|31122027|500,00|E||');
    // O "|" do histórico vira espaço.
    expect(reg(t, 'I250')[1]).toContain('|Contrapartida com barra|');
    // Contagem do bloco 9 confere com as linhas.
    const n9900 = reg(t, '9900');
    for (const l of n9900) {
      const [, , r9, q] = l.split('|');
      if (r9 === '9900') expect(Number(q)).toBe(n9900.length);
      else expect(Number(q)).toBe(reg(t, r9!).length);
    }
    expect(reg(t, '0990')[0]).toBe('|0990|4|');
    expect(reg(t, 'I990')[0]).toBe(`|I990|${linhas.filter((x) => x.startsWith('|I')).length}|`);
    expect(r.nomeArquivo).toBe('ECD_00000000000191_2027.txt');
  });

  it('saldos mensais, antes do encerramento e as demonstrações pela aglutinação', () => {
    const t = gerarEcd(entrada()).conteudo;
    // Caixa: janeiro com débito de 100,00; novembro com crédito de 80,00 e saldo final 20,00 D.
    expect(reg(t, 'I155')[0]).toBe('|I155|1.1.01||0,00|D|100,00|0,00|100,00|D|');
    expect(reg(t, 'I155')).toContain('|I155|1.1.01||100,00|D|0,00|80,00|20,00|D|');
    // Sem movimento em dezembro, o saldo continua no I155.
    expect(reg(t, 'I155')).toContain('|I155|1.1.01||20,00|D|0,00|0,00|20,00|D|');
    // Receita antes da apuração: 500,00 C; depois do encerramento zera em dezembro.
    expect(reg(t, 'I355')).toContain('|I355|4.1.01||500,00|C|');
    expect(reg(t, 'I155')).toContain('|I155|4.1.01||500,00|C|500,00|0,00|0,00|D|');
    // Balanço: ativo 500,00 D; PL com o superávit (100,00 + 250,00).
    expect(reg(t, 'J100')).toContain('|J100|1|T|1||A|Ativo|0,00|D|500,00|D||');
    expect(reg(t, 'J100')).toContain('|J100|3.1|D|2|3|P|Patrimônio social|0,00|D|350,00|C||');
    expect(reg(t, 'J150').some((x) => x.includes('|4.1|D|2|4|Receita de serviços|0,00|D|480,00|C|R|'))).toBe(
      true,
    );
    expect(reg(t, 'I050')[0]).toBe('|I050|01012027|01|S|1|1||Ativo|');
    expect(reg(t, 'I051')[0]).toBe('|I051||R.1.1.01|');
    expect(reg(t, 'I052')[0]).toBe('|I052||1.1|');
    // Signatários: o responsável legal é o não contador.
    expect(reg(t, 'J930')).toEqual([
      '|J930|Contador Sintético|00000000191|Contador|900|SP000000||||||N|',
      '|J930|Diretor Sintético|00000000272|Diretor|203|||||||S|',
    ]);
  });

  it('substituta, saldos iniciais e os impedimentos', () => {
    const sub = gerarEcd(
      entrada({
        substituta: true,
        hashAnterior: 'ABC',
        saldosIniciais: [{ conta: '1.1.01', debitos: 7, creditos: 0 }],
      }),
    );
    expect(linhasDe(sub.conteudo)[0]).toContain('|0|0|1|ABC|0|0|');
    expect(reg(sub.conteudo, 'I155')[0]).toBe('|I155|1.1.01||0,07|D|100,00|0,00|100,07|D|');
    expect(sub.nomeArquivo).toContain('_SUBSTITUTA');
    const ruim = gerarEcd(
      entrada({
        empresa: { ...EMPRESA, cnpj: null, uf: null, codigoMunicipio: '35', planoReferencial: null },
        plano: PLANO,
        encerradas: new Set(['2027-01']),
        lancamentos: entrada()
          .lancamentos.filter((l) => l.tipo !== 'apuracao')
          .concat(lanc(9, '2027-05-01', '7.1', '1.1.01', 1)),
        signatarios: [SIGNATARIOS[1]!],
        parcial: true,
      }),
    );
    expect(ruim.conteudo).toBe('');
    expect(ruim.impedimentos.map((i) => i.codigo)).toEqual([
      'leitura-parcial',
      'sem-cnpj',
      'sem-uf',
      'sem-municipio',
      'sem-plano-referencial',
      'meses-abertos',
      'sem-apuracao',
      'sem-referencial',
      'fora-do-plano',
      'sem-contador',
    ]);
    expect(ruim.impedimentos.find((i) => i.codigo === 'meses-abertos')!.quantidade).toBe(11);
    expect(ruim.avisos[0]).toContain('sem referencial e sem saldo');
  });
});

describe('ECF', () => {
  it('imune: blocos 0, J, K, U e 9 com os saldos e o referencial', () => {
    const r = gerarEcf({ ...entrada(), formaTributacao: '8', tipoEntidade: '05' });
    expect(r.impedimentos).toEqual([]);
    const t = r.conteudo;
    const linhas = linhasDe(t);
    expect(linhas[0]).toBe(
      '|0000|LECF|0011|00000000000191|Hospital Sintético|0|0|||01012027|31122027|N||0||',
    );
    expect(reg(t, '0010')[0]).toContain('|N|8|');
    expect(reg(t, '0930')).toHaveLength(2);
    expect(reg(t, 'K155')).toContain('|K155|1.1.01||0,00|D|100,00|80,00|20,00|D|');
    expect(reg(t, 'K355')).toContain('|K355|4.1.01||500,00|C|');
    expect(reg(t, 'K356')).toContain('|K356|R.4.1.01|500,00|C|');
    expect(reg(t, 'U100').length).toBeGreaterThan(0);
    expect(reg(t, 'U150')).toContain('|U150|R.4.1.01|R.4.1.01|A|4|04||500,00|C|');
    expect(linhas.at(-1)).toBe(`|9999|${linhas.length}|`);
    expect(r.avisos.at(-1)).toContain('Bloco U');
  });

  it('lucro real ou presumido não é gerado; aviso sem natureza jurídica', () => {
    const r = gerarEcf({
      ...entrada({ empresa: { ...EMPRESA, naturezaJuridica: null } }),
      formaTributacao: '1',
      tipoEntidade: '00',
    });
    expect(r.impedimentos.map((i) => i.codigo)).toEqual(['forma-nao-gerada']);
    expect(r.avisos[0]).toContain('natureza jurídica');
    expect(r.conteudo).toBe('');
    const ret = gerarEcf({
      ...entrada({ substituta: true, hashAnterior: 'H1' }),
      formaTributacao: '9',
      tipoEntidade: '05',
    });
    expect(ret.nomeArquivo).toContain('_RETIFICADORA');
    expect(linhasDe(ret.conteudo)[0]).toContain('|S|H1|');
  });
});
