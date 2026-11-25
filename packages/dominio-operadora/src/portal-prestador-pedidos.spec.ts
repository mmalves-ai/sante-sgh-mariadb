// C2-074: regras puras do portal do prestador (pedido de cadastro e alteração, avisos, regras de arquivo). Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  type AvisoPortalLido,
  avisosDoPrestador,
  documentosPendentes,
  type PedidoWebPrestadorEntrada,
  problemasDoArquivo,
  problemasDoAvisoPortal,
  problemasDoPedidoWeb,
  proximaSituacaoPedidoWeb,
  type RegraArquivoPrestador,
  regrasDoPrestador,
} from './portal-prestador-pedidos.js';
import { cnpjSintetico, cpfSintetico } from './sinteticos.js';

const CPF = cpfSintetico('123456789');
const CNPJ = cnpjSintetico('112223330001');
const base: PedidoWebPrestadorEntrada = {
  tipo: 'alteracao_cadastral',
  prestador: 7,
  pessoa: 'juridica',
  nome: 'Clínica Sintética',
  cpf: null,
  cnpj: CNPJ,
  conselho: { classe: null, numero: null, uf: null },
  cnes: '1234567',
  banco: { banco: null, agencia: null, conta: null },
  email: 'contato@exemplo.test',
  cep: '01001000',
  detalhes: null,
};
const codigos = (p: Partial<PedidoWebPrestadorEntrada>) =>
  problemasDoPedidoWeb({ ...base, ...p }).map((x) => x.codigo);

describe('pedido de cadastro e alteração do prestador', () => {
  it('aceita a alteração completa do prestador da sessão', () => {
    expect(codigos({})).toEqual([]);
  });
  it('alteração exige o prestador; credenciamento não aponta prestador', () => {
    expect(codigos({ prestador: null })).toContain('alteracao-sem-prestador');
    expect(codigos({ tipo: 'credenciamento' })).toContain('credenciamento-de-credenciado');
  });
  it('documento segue a pessoa, com o dígito conferido', () => {
    expect(codigos({ cnpj: '11222333000100' })).toContain('cnpj-invalido');
    expect(codigos({ pessoa: 'fisica', cnpj: null, cpf: CPF })).toEqual([]);
    expect(codigos({ pessoa: 'fisica', cpf: CPF })).toContain('documento-da-outra-pessoa');
    expect(codigos({ pessoa: 'fisica', cnpj: null, cpf: '11111111111' })).toContain('cpf-invalido');
  });
  it('credenciamento de pessoa física exige conselho completo e e-mail; jurídica exige CNES', () => {
    const pf = {
      tipo: 'credenciamento' as const,
      prestador: null,
      pessoa: 'fisica' as const,
      cnpj: null,
      cpf: CPF,
    };
    expect(codigos(pf)).toContain('conselho-obrigatorio');
    expect(codigos({ ...pf, conselho: { classe: 1, numero: '123', uf: null } })).toContain(
      'conselho-incompleto',
    );
    expect(codigos({ ...pf, conselho: { classe: 1, numero: '123', uf: 35 }, email: null })).toEqual([
      'email-obrigatorio',
    ]);
    expect(codigos({ tipo: 'credenciamento', prestador: null, cnes: null })).toContain('cnes-obrigatorio');
  });
  it('conta bancária completa ou ausente; CNES, CEP e e-mail no formato', () => {
    expect(codigos({ banco: { banco: 1, agencia: '1', conta: null } })).toContain(
      'conta-bancaria-incompleta',
    );
    expect(codigos({ cnes: '12', cep: '0100', email: 'x@' })).toEqual([
      'cnes-invalido',
      'email-invalido',
      'cep-invalido',
    ]);
  });
  it('endereço, especialidade e qualificação exigem o que muda', () => {
    expect(codigos({ tipo: 'endereco' })).toEqual(['detalhes-obrigatorios']);
    expect(codigos({ tipo: 'especialidade', detalhes: { especialidade: 'x' } })).toEqual([]);
  });
});

describe('situação do pedido', () => {
  it('recebido vai à análise e é decidido; decidido não volta', () => {
    expect(proximaSituacaoPedidoWeb('recebido', 'analisar', null)).toEqual({ situacao: 'em_analise' });
    expect(proximaSituacaoPedidoWeb('em_analise', 'aprovar', null)).toEqual({ situacao: 'aprovado' });
    expect(proximaSituacaoPedidoWeb('aprovado', 'cancelar', null)).toEqual({
      problema: { codigo: 'pedido-ja-decidido', campo: 'situacao' },
    });
    expect(proximaSituacaoPedidoWeb('em_analise', 'analisar', null)).toHaveProperty('problema');
  });
  it('a recusa exige motivo', () => {
    expect(proximaSituacaoPedidoWeb('em_analise', 'recusar', ' ')).toEqual({
      problema: { codigo: 'recusa-sem-motivo', campo: 'motivo' },
    });
    expect(proximaSituacaoPedidoWeb('recebido', 'recusar', 'Falta o alvará')).toEqual({
      situacao: 'recusado',
    });
  });
});

describe('avisos do portal', () => {
  const aviso = {
    tipo: 'comunicado' as const,
    titulo: 'T',
    conteudo: 'C',
    documento: null,
    link: null,
    exibirDe: '2026-11-01T00:00:00',
    exibirAte: null,
    tipoPrestador: null,
    prestador: null,
  };
  it('documento e link conforme o tipo, link https, período em ordem, um recorte só', () => {
    expect(problemasDoAvisoPortal(aviso)).toEqual([]);
    expect(problemasDoAvisoPortal({ ...aviso, tipo: 'documento' }).map((x) => x.codigo)).toEqual([
      'documento-obrigatorio',
    ]);
    expect(
      problemasDoAvisoPortal({ ...aviso, tipo: 'link', link: 'http://x.test' }).map((x) => x.codigo),
    ).toEqual(['link-inseguro']);
    expect(
      problemasDoAvisoPortal({
        ...aviso,
        exibirAte: '2026-10-01T00:00:00',
        tipoPrestador: 1,
        prestador: 2,
      }).map((x) => x.codigo),
    ).toEqual(['periodo-invertido', 'publico-duplo']);
  });
  it('o prestador vê só os ativos, no período, do público e do recorte dele, destaque primeiro', () => {
    const a = (id: number, x: Partial<AvisoPortalLido>): AvisoPortalLido => ({
      id,
      ativo: true,
      publico: 'prestadores',
      tipoPrestador: null,
      prestador: null,
      exibirDe: '2026-11-01T00:00:00',
      exibirAte: null,
      destaque: false,
      ...x,
    });
    const lista = [
      a(1, {}),
      a(2, { ativo: false }),
      a(3, { publico: 'beneficiarios' }),
      a(4, { exibirAte: '2026-11-10T00:00:00' }),
      a(5, { prestador: 99 }),
      a(6, { tipoPrestador: 3, exibirDe: '2026-11-15T00:00:00' }),
      a(7, { tipoPrestador: 4 }),
      a(8, { destaque: true, publico: 'todos' }),
      a(9, { exibirDe: '2026-12-01T00:00:00' }),
    ];
    expect(
      avisosDoPrestador(lista, { prestador: 7, tipoPrestador: 3 }, '2026-11-20T10:00:00').map((x) => x.id),
    ).toEqual([8, 6, 1]);
  });
});

describe('regras de arquivo por tipo de prestador', () => {
  const r = (id: number, x: Partial<RegraArquivoPrestador>): RegraArquivoPrestador => ({
    id,
    descricao: `Regra ${id}`,
    tipoPrestador: null,
    natureza: null,
    obrigatorio: true,
    extensoes: 'pdf, .JPG',
    tamanhoMaximoKb: 100,
    ativo: true,
    ...x,
  });
  it('vale a regra ativa do tipo e da natureza do prestador', () => {
    const regras = [
      r(1, {}),
      r(2, { tipoPrestador: 5 }),
      r(3, { natureza: 'fisica' }),
      r(4, { ativo: false }),
    ];
    expect(regrasDoPrestador(regras, { tipoPrestador: 3, natureza: 'juridica' }).map((x) => x.id)).toEqual([
      1,
    ]);
    expect(regrasDoPrestador(regras, { tipoPrestador: 5, natureza: 'fisica' }).map((x) => x.id)).toEqual([
      1, 2, 3,
    ]);
  });
  it('confere extensão e tamanho; aponta o obrigatório que falta', () => {
    expect(problemasDoArquivo(r(1, {}), { nome: 'alvara.jpg', bytes: 2048 })).toEqual([]);
    expect(
      problemasDoArquivo(r(1, {}), { nome: 'alvara.exe', bytes: 200 * 1024 }).map((x) => x.codigo),
    ).toEqual(['extensao-nao-aceita', 'arquivo-grande']);
    expect(
      documentosPendentes([r(1, {}), r(2, { obrigatorio: false }), r(3, {})], new Set([3])).map((x) => x.id),
    ).toEqual([1]);
  });
});
