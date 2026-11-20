import { describe, expect, it } from 'vitest';
import { chavePessoal, mascararTexto, OCULTO, redigir } from './redacao.js';

// Valores sintéticos com a forma de dado pessoal (nenhum é real).
const CPF = '123.456.789-09';

describe('redação de dado pessoal nos logs', () => {
  it('oculta campos pessoais em qualquer nível e mascara textos', () => {
    const r = redigir({
      cpf: CPF,
      Nome: 'Fulano Fictício',
      dados: { telefone: '(22) 99999-0000', texto_clinico: 'dor torácica', quantidade: 123 },
      paciente: { id: 1 },
      msg: `consulta com CPF ${CPF.replace(/\D/g, '')} e e-mail teste@exemplo.invalid`,
      lista: [{ email: 'x@y.invalid' }],
      vazio: null,
      erro: new Error(`falhou para ${CPF}`),
    });
    expect(r).toEqual({
      cpf: OCULTO,
      Nome: OCULTO,
      dados: { telefone: OCULTO, texto_clinico: OCULTO, quantidade: 123 },
      paciente: OCULTO,
      msg: `consulta com CPF ${OCULTO} e e-mail ${OCULTO}`,
      lista: [{ email: OCULTO }],
      vazio: null,
      erro: { name: 'Error', message: `falhou para ${OCULTO}` },
    });
    expect(JSON.stringify(r)).not.toMatch(/12345678909|Fulano|99999/);
  });

  it('mantém o que não é pessoal e trata ciclo e profundidade', () => {
    expect(mascararTexto('estabelecimento pc, 3 linhas, 120 ms')).toBe(
      'estabelecimento pc, 3 linhas, 120 ms',
    );
    expect(mascararTexto('CNS 898 0000 0000 0001')).toBe(`CNS ${OCULTO}`);
    const ciclo: Record<string, unknown> = { a: 1 };
    ciclo['eu'] = ciclo;
    expect(redigir(ciclo)).toEqual({ a: 1, eu: '[ciclo]' });
    expect(chavePessoal('NOME_COMPLETO')).toBe(true);
    expect(chavePessoal('estabelecimento')).toBe(false);
    let fundo: Record<string, unknown> = { cpf: 'x' };
    for (let i = 0; i < 12; i++) fundo = { f: fundo };
    expect(redigir(fundo)).toBeDefined();
  });
});

describe('nomes compostos e colunas do legado (revisão do M09)', () => {
  it.each([
    'nomePaciente',
    'pacienteNome',
    'cpfResponsavel',
    'emailContato',
    'dataNasc',
    'telefoneCelular',
    'cnsPaciente',
  ])('compostos: %s é pessoal', (k) => {
    expect(chavePessoal(k)).toBe(true);
  });

  it('linha sintética de RICADPAC: todas as colunas pessoais ocultas', () => {
    const linha = {
      ID: 900001,
      PRONT: 123456,
      NOME: 'Paciente Fictício',
      NOMEFNT: 'PACIENTE FICTICIO',
      MAE: 'Mãe Fictícia',
      MAEFNT: 'MAE FICTICIA',
      NASC: '1980-05-17',
      CPF: '12345678909',
      RG: '000000',
      NOME_GUARDIAO: 'Guardião Fictício',
      CPF_GUARDIAO: '52998224725',
      TELEFONE_GUARDIAO: '22999990000',
      LOGRADOURO_END_GUARDIAO: 'Rua Fictícia',
      BAIRRO_END_GUARDIAO: 'Bairro Fictício',
      ALERGIA: 'texto',
      CIRURGIA: 'texto',
      JUSTIFICA_CPF: 'texto',
      TIPOPAC: 'I',
      OTMU: '1',
    };
    const r = redigir(linha);
    const visiveis = Object.entries(r)
      .filter(([, v]) => v !== OCULTO)
      .map(([k]) => k);
    expect(visiveis.sort()).toEqual(['ID', 'OTMU', 'TIPOPAC']);
    expect(JSON.stringify(r)).not.toMatch(/Fictíci|FICTICI|12345678909|52998224725|1980/);
  });

  it('não pessoal: estabelecimento, painel, país, marca, nome de arquivo e do estabelecimento', () => {
    for (const k of [
      'estabelecimento',
      'painel',
      'pais',
      'marca',
      'duracaoMs',
      'nomeArquivo',
      'nomeEstabelecimento',
      'nomeConfere',
      'endpoint',
    ])
      expect(chavePessoal(k), k).toBe(false);
  });
});

describe('argumento de log', () => {
  it('erro com dado pessoal na mensagem vira cópia mascarada', async () => {
    const { redigirArgumentoLog } = await import('./redacao.js');
    const e = redigirArgumentoLog(new TypeError(`falha ${CPF}`)) as Error;
    expect(e.name).toBe('TypeError');
    expect(e.message).toBe(`falha ${OCULTO}`);
    expect(e.stack).not.toContain('123.456.789-09');
    const semPilha = new Error('x');
    semPilha.stack = '';
    expect((redigirArgumentoLog(semPilha) as Error).stack).toBe('');
    expect(redigirArgumentoLog(CPF)).toBe(OCULTO);
    expect(redigirArgumentoLog(3)).toBe(3);
  });
});
