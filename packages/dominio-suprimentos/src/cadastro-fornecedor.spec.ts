// Cadastro do fornecedor, avaliação periódica e ocorrências (05-SUP linha 23): documento conferido, categorias,
// contatos, autorizações com a situação no dia, conta bancária ou Pix, avisos sem trava, a avaliação que reaproveita a
// regra do contrato e o andamento da ocorrência. Documentos sintéticos (dígitos válidos, sem dono real).
import { describe, expect, it } from 'vitest';
import {
  avaliarFornecedor,
  avisosFornecedor,
  chavePixNormalizada,
  conferirAndamentoOcorrencia,
  conferirAvaliacaoPeriodica,
  conferirContaBancaria,
  conferirFornecedor,
  conferirOcorrencia,
  documentoFornecedor,
  type FornecedorEntrada,
  mascararConta,
  mediaPeriodoAvaliacao,
  ocorrenciaEmAberto,
  proximaAvaliacaoFornecedor,
  situacaoAutorizacaoNaData,
} from './index.js';

const CNPJ = '11222333000181';
const CPF = '52998224725';

const BASE: FornecedorEntrada = {
  tipoPessoa: 'juridica',
  documento: '11.222.333/0001-81',
  razaoSocial: 'Distribuidora Fictícia Ltda',
  nomeFantasia: null,
  inscricaoEstadual: null,
  inscricaoMunicipal: null,
  optanteSimples: false,
  contribuinteIcms: true,
  cep: '01001-000',
  logradouro: null,
  numeroEndereco: null,
  complemento: null,
  bairro: null,
  email: 'compras@exemplo.invalid',
  site: null,
  numeroCnes: null,
  prazoEntregaDias: 5,
  diasValidadeAvaliacao: null,
  forneceOpme: false,
  transportadora: false,
  prestadorServico: false,
  disponibilidade: 'comercial',
  situacao: 'ativo',
  motivoSituacao: null,
  observacao: null,
  categorias: [1, 2],
  categoriaPrincipal: 1,
  contatos: [
    {
      finalidade: 'comercial',
      nome: 'Contato',
      cargo: null,
      telefone: '(11) 3000-0000',
      ramal: null,
      email: null,
      principal: true,
    },
  ],
  autorizacoes: [
    {
      tipo: 'afe',
      numero: '1.00000-0',
      orgaoEmissor: 'ANVISA',
      emitidoEm: '2026-01-01',
      validoAte: null,
      diasAviso: 30,
      bloqueiaCompraVencido: true,
      situacao: 'valido',
    },
  ],
};

describe('documento e cadastro', () => {
  it('o CNPJ e o CPF conferem pelos dígitos e saem só com dígitos', () => {
    expect(documentoFornecedor('juridica', '11.222.333/0001-81')).toBe(CNPJ);
    expect(documentoFornecedor('juridica', '11.222.333/0001-82')).toBeNull();
    expect(documentoFornecedor('fisica', '529.982.247-25')).toBe(CPF);
    expect(documentoFornecedor('fisica', CNPJ)).toBeNull();
  });
  it('o cadastro certo passa sem recusa', () => {
    expect(conferirFornecedor(BASE)).toEqual([]);
  });
  it('devolve todas as recusas de uma vez', () => {
    const rs = conferirFornecedor({
      ...BASE,
      documento: '11222333000100',
      razaoSocial: ' ',
      email: 'sem-arroba',
      cep: '123',
      situacao: 'bloqueado',
      categoriaPrincipal: 9,
      contatos: [
        { ...BASE.contatos[0]!, telefone: null, email: null },
        { ...BASE.contatos[0]! },
        { ...BASE.contatos[0]! },
      ],
      autorizacoes: [
        { ...BASE.autorizacoes[0]!, emitidoEm: '2026-05-01', validoAte: '2026-04-01' },
        { ...BASE.autorizacoes[0]! },
      ],
    }).map((r) => r.codigo);
    expect(rs).toEqual([
      'documento-invalido',
      'razao-social',
      'email',
      'cep',
      'motivo-situacao',
      'categoria-principal',
      'contato-meio',
      'contato-principal',
      'autorizacao-vigencia',
      'autorizacao-repetida',
    ]);
  });
});

describe('autorização sanitária e avisos', () => {
  const a = { validoAte: '2026-12-10', diasAviso: 30, situacao: 'valido' as const };
  it('a situação no dia pela validade e pelo aviso', () => {
    expect(situacaoAutorizacaoNaData(a, '2026-11-01')).toEqual({ situacao: 'valida', dias: 39 });
    expect(situacaoAutorizacaoNaData(a, '2026-10-01').situacao).toBe('valida');
    expect(situacaoAutorizacaoNaData(a, '2026-11-15')).toEqual({ situacao: 'vencendo', dias: 25 });
    expect(situacaoAutorizacaoNaData(a, '2026-12-11')).toEqual({ situacao: 'vencida', dias: -1 });
    expect(situacaoAutorizacaoNaData({ ...a, situacao: 'suspenso' }, '2026-10-01').situacao).toBe('suspensa');
  });
  it('avisa sem travar: autorização vencida, categoria sem AFE, avaliação vencida, ocorrência e conta', () => {
    const av = avisosFornecedor({
      situacao: 'ativo',
      exigeAutorizacaoSanitaria: true,
      autorizacoes: [{ ...BASE.autorizacoes[0]!, validoAte: '2026-11-01' }],
      proximaAvaliacao: '2026-11-20',
      ultimoResultado: 'desqualificado',
      ocorrenciasAbertas: 2,
      ocorrenciasCriticasAbertas: 1,
      contasAtivas: 0,
      hoje: '2026-11-25',
    });
    expect(av.map((x) => [x.codigo, x.gravidade])).toEqual([
      ['autorizacao-vencida', 'critico'],
      ['sem-autorizacao-sanitaria', 'critico'],
      ['avaliacao-vencida', 'atencao'],
      ['desqualificado', 'critico'],
      ['ocorrencia-critica', 'critico'],
      ['sem-conta', 'informacao'],
    ]);
    expect(
      avisosFornecedor({
        situacao: 'ativo',
        exigeAutorizacaoSanitaria: true,
        autorizacoes: BASE.autorizacoes,
        proximaAvaliacao: '2027-01-01',
        ultimoResultado: 'qualificado',
        ocorrenciasAbertas: 0,
        ocorrenciasCriticasAbertas: 0,
        contasAtivas: 1,
        hoje: '2026-11-25',
      }),
    ).toEqual([]);
  });
});

describe('conta bancária e Pix', () => {
  const conta = {
    banco: 1,
    tipoConta: 'corrente' as const,
    agencia: '0001',
    digitoAgencia: null,
    conta: '123456',
    digitoConta: '7',
    tipoChavePix: null,
    chavePix: null,
    titularNome: 'Distribuidora Fictícia Ltda',
    titularDocumento: CNPJ,
    preferencial: true,
  };
  it('banco e conta, ou Pix coerente com o tipo; titular conferido', () => {
    expect(conferirContaBancaria(conta)).toEqual([]);
    expect(
      conferirContaBancaria({ ...conta, banco: null, conta: null, tipoChavePix: 'cnpj', chavePix: CNPJ }),
    ).toEqual([]);
    expect(
      conferirContaBancaria({
        ...conta,
        banco: null,
        conta: null,
        tipoChavePix: 'email',
        chavePix: 'x',
        titularDocumento: '123',
      }).map((r) => r.codigo),
    ).toEqual(['pix-chave', 'titular-documento']);
    expect(conferirContaBancaria({ ...conta, banco: null, conta: null }).map((r) => r.codigo)).toEqual([
      'conta-destino',
    ]);
  });
  it('a chave normalizada e a conta mascarada', () => {
    expect(chavePixNormalizada('telefone', '+55 (11) 99999-0000')).toBe('+5511999990000');
    expect(chavePixNormalizada('cpf', '529.982.247-25')).toBe(CPF);
    expect(mascararConta('123456', null)).toBe('••••3456');
    expect(mascararConta(null, 'compras@exemplo.invalid')).toBe('com••••id');
  });
});

describe('avaliação periódica (a regra do contrato)', () => {
  const e = {
    avaliadoEm: '2026-11-20',
    periodoInicio: '2026-05-01',
    periodoFim: '2026-10-31',
    notas: { qualidade: 5, prazo: 4, atendimento: 4, documentacao: 3 },
    parecer: null,
  };
  it('notas de 1 a 5, sem data futura, período coerente; a desqualificação pede parecer', () => {
    expect(conferirAvaliacaoPeriodica(e, '2026-11-25')).toEqual([]);
    expect(
      conferirAvaliacaoPeriodica(
        { ...e, avaliadoEm: '2026-11-30', notas: { ...e.notas, prazo: 6, documentacao: 1 } },
        '2026-11-25',
      ).map((r) => r.codigo),
    ).toEqual(['nota', 'avaliado-futuro', 'parecer']);
    expect(avaliarFornecedor(e.notas)).toMatchObject({ media: 4, resultado: 'qualificado' });
  });
  it('a média do período com a conta impressa', () => {
    expect(mediaPeriodoAvaliacao([3.25, 4], 2.5)).toEqual({
      media: 3.25,
      conta: '(3.25 + 4.00 + 2.50) ÷ 3 = 3.25',
    });
  });
  it('a próxima: o prazo do fornecedor em dias ou 6/12 meses', () => {
    expect(proximaAvaliacaoFornecedor({ ultima: '2026-11-20', diasValidade: 90, critico: false })).toBe(
      '2027-02-18',
    );
    expect(proximaAvaliacaoFornecedor({ ultima: '2026-11-20', diasValidade: null, critico: true })).toBe(
      '2027-05-20',
    );
    expect(proximaAvaliacaoFornecedor({ ultima: '2026-11-20', diasValidade: null, critico: false })).toBe(
      '2027-11-20',
    );
  });
});

describe('ocorrência do fornecedor', () => {
  const o = {
    tipo: 'avaria' as const,
    gravidade: 'alta' as const,
    ocorridoEm: '2026-11-24T10:00',
    quantidadeAfetada: 3,
    valorAfetado: 150,
    descricao: 'Caixas amassadas na entrega',
  };
  it('a ocorrência sem data futura, com a quantidade quando o tipo pede', () => {
    expect(conferirOcorrencia(o, '2026-11-25')).toEqual([]);
    expect(
      conferirOcorrencia(
        { ...o, ocorridoEm: '2026-11-26T08:00', quantidadeAfetada: null, descricao: '' },
        '2026-11-25',
      ).map((r) => r.codigo),
    ).toEqual(['descricao', 'ocorrido-futuro', 'quantidade-obrigatoria']);
  });
  it('o andamento: transição permitida, tratativa para encerrar, e-mail para notificar', () => {
    expect(
      conferirAndamentoOcorrencia({
        de: 'aberta',
        para: 'notificada',
        tratativa: null,
        email: 'a@b.invalid',
      }),
    ).toEqual([]);
    expect(
      conferirAndamentoOcorrencia({ de: 'aberta', para: 'notificada', tratativa: null, email: null }).map(
        (r) => r.codigo,
      ),
    ).toEqual(['email-notificacao']);
    expect(
      conferirAndamentoOcorrencia({ de: 'em_tratativa', para: 'resolvida', tratativa: ' ', email: null }).map(
        (r) => r.codigo,
      ),
    ).toEqual(['tratativa']);
    expect(
      conferirAndamentoOcorrencia({ de: 'resolvida', para: 'aberta', tratativa: 'x', email: null }).map(
        (r) => r.codigo,
      ),
    ).toEqual(['transicao']);
    expect(
      ['aberta', 'notificada', 'em_tratativa', 'resolvida'].map((s) => ocorrenciaEmAberto(s as never)),
    ).toEqual([true, true, true, false]);
  });
});
