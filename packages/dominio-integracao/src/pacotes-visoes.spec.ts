// Catálogo das visões exportáveis, tratamento dos campos, montagem do arquivo e transporte (08-INTG L134). Sintético.
import { describe, expect, it } from 'vitest';
import {
  conferirPacoteNoCatalogo,
  montarArquivoPacote,
  pseudonimoDoCampo,
  sha256Texto,
  transporteDaEntrega,
  tratarValor,
  VISOES_EXPORTAVEIS,
} from './pacotes-visoes.js';

const CHAVE = 'chave-sintetica-de-teste-0123456789';
const ctx = { chave: CHAVE, escopo: 'parceiro-a' };
const k = (campo: string, tratamento = 'original', x: Record<string, unknown> = {}) => ({
  entidade: 'internacao',
  campo,
  tratamento: tratamento as never,
  dadoSensivel: false,
  ...x,
});
const pac = { formato: 'csv', periodicidade: 'diaria', anonimizacao: 'pseudonimizada' } as const;
const cods = (e: { codigo: string }[]) => e.map((x) => x.codigo);

describe('catálogo das visões exportáveis', () => {
  it('nenhum campo repetido e todo sensível ou identificador declarado', () => {
    for (const v of VISOES_EXPORTAVEIS) {
      expect(new Set(v.campos.map((x) => x.nome)).size).toBe(v.campos.length);
      expect(v.campos.some((x) => x.identificador)).toBe(true);
    }
  });

  it('recusa entidade e campo fora da lista branca e visões misturadas', () => {
    expect(cods(conferirPacoteNoCatalogo(pac, [k('entrada'), k('senha')]))).toEqual([
      'campo-fora-do-catalogo',
    ]);
    expect(cods(conferirPacoteNoCatalogo(pac, [{ ...k('x'), entidade: 'usuario' }]))).toEqual([
      'entidade-fora-do-catalogo',
    ]);
    expect(
      cods(conferirPacoteNoCatalogo(pac, [k('entrada'), { ...k('entrada'), entidade: 'atendimento' }])),
    ).toEqual(['visoes-misturadas']);
  });

  it('sensível marcado, identificador tratado, anonimizado sem pseudônimo, tratamento que serve', () => {
    expect(cods(conferirPacoteNoCatalogo(pac, [k('cid_principal', 'generalizado')]))).toEqual([
      'sensivel-nao-marcado',
    ]);
    expect(cods(conferirPacoteNoCatalogo(pac, [k('prontuario')]))).toEqual(['identificador-sem-tratamento']);
    expect(conferirPacoteNoCatalogo({ ...pac, anonimizacao: 'nenhuma' }, [k('prontuario')])).toEqual([]);
    expect(
      cods(
        conferirPacoteNoCatalogo({ ...pac, anonimizacao: 'anonimizada' }, [
          k('prontuario', 'pseudonimizado'),
        ]),
      ),
    ).toEqual(['anonimizada-com-pseudonimo']);
    expect(cods(conferirPacoteNoCatalogo(pac, [k('nome', 'generalizado')]))).toEqual([
      'tratamento-nao-serve',
    ]);
    expect(cods(conferirPacoteNoCatalogo(pac, [k('entrada', 'mascarado')]))).toEqual([
      'tratamento-nao-serve',
    ]);
    expect(cods(conferirPacoteNoCatalogo(pac, [k('leito', 'agregado')]))).toEqual([
      'agregado-fora-do-agregado',
    ]);
  });

  it('agendado só em formato que o sistema gera; sob demanda aceita PDF', () => {
    expect(cods(conferirPacoteNoCatalogo({ ...pac, formato: 'pdf' }, [k('entrada')]))).toEqual([
      'formato-sem-geracao',
    ]);
    expect(
      conferirPacoteNoCatalogo({ ...pac, formato: 'pdf', periodicidade: 'sob_demanda' }, [k('entrada')]),
    ).toEqual([]);
  });
});

describe('tratamento dos valores', () => {
  it('pseudônimo estável, por parceiro e por campo; sem chave não gera', () => {
    const a = tratarValor(123, k('prontuario', 'pseudonimizado'), 'codigo', ctx);
    expect(a).toMatch(/^[0-9a-f]{20}$/);
    expect(tratarValor('123', k('prontuario', 'pseudonimizado'), 'codigo', ctx)).toBe(a);
    expect(tratarValor(123, k('prontuario', 'pseudonimizado'), 'codigo', { ...ctx, escopo: 'b' })).not.toBe(
      a,
    );
    expect(pseudonimoDoCampo(CHAVE, 'parceiro-a', 'numero', '123')).not.toBe(a);
    expect(() =>
      tratarValor(1, k('prontuario', 'pseudonimizado'), 'codigo', { ...ctx, chave: null }),
    ).toThrow();
  });

  it('máscara, generalização e original na forma do arquivo', () => {
    expect(tratarValor('A1234567', k('numero', 'mascarado'), 'codigo', ctx)).toBe('****4567');
    expect(tratarValor('AB', k('numero', 'mascarado'), 'codigo', ctx)).toBe('**');
    expect(tratarValor('I21.0', k('cid_principal', 'generalizado'), 'codigo', ctx)).toBe('I21');
    expect(tratarValor('1980-05-17', k('nascimento', 'generalizado'), 'data', ctx)).toBe('1980-05');
    expect(tratarValor(37, k('diarias_previstas', 'generalizado'), 'numero', ctx)).toBe('30-39');
    expect(tratarValor(new Date('2026-11-20T10:00:00Z'), k('entrada'), 'data_hora', ctx)).toBe(
      '2026-11-20T10:00:00.000Z',
    );
    expect(tratarValor(null, k('entrada'), 'data_hora', ctx)).toBeNull();
  });
});

describe('montagem do arquivo', () => {
  const cab = {
    pacote: 'uti',
    periodoInicio: new Date('2026-11-19T05:00:00Z'),
    periodoFim: new Date('2026-11-20T05:00:00Z'),
    geradoEm: new Date('2026-11-20T05:01:00Z'),
  };
  const campos = [
    {
      sequencia: 2,
      entidade: 'internacao',
      campo: 'entrada',
      rotuloSaida: 'entrada',
      tratamento: 'original' as const,
    },
    {
      sequencia: 1,
      entidade: 'internacao',
      campo: 'prontuario',
      rotuloSaida: 'paciente',
      tratamento: 'pseudonimizado' as const,
    },
    {
      sequencia: 3,
      entidade: 'internacao',
      campo: 'leito',
      rotuloSaida: 'leito;sala',
      tratamento: 'original' as const,
    },
  ];
  const linhas = [
    { prontuario: 10, entrada: new Date('2026-11-19T12:00:00Z'), leito: 'UTI "1"', nome: 'Fulano Sintético' },
    { prontuario: 11, entrada: new Date('2026-11-19T13:00:00Z'), leito: null, nome: 'Beltrano Sintético' },
  ];

  it('CSV na ordem da sequência, com aspas onde precisa, só os campos do pacote e o hash do conteúdo', () => {
    const r = montarArquivoPacote({
      formato: 'csv',
      anonimizacao: 'pseudonimizada',
      campos,
      linhas,
      cabecalho: cab,
      tratamento: ctx,
    });
    if (!r.ok) throw new Error('recusado');
    const l = r.conteudo.split('\r\n');
    expect(l[0]).toBe('paciente;entrada;"leito;sala"');
    expect(l[1]).toMatch(/^[0-9a-f]{20};2026-11-19T12:00:00.000Z;"UTI ""1"""$/);
    expect(l[2]).toMatch(/;$/);
    expect(r.conteudo).not.toContain('Sintético');
    expect(r.quantidadeRegistros).toBe(2);
    expect(r.hashSha256).toBe(sha256Texto(r.conteudo));
    expect(r.tamanhoBytes).toBe(Buffer.byteLength(r.conteudo));
  });

  it('JSON, XML e FHIR com o período e os registros', () => {
    const j = montarArquivoPacote({
      formato: 'json',
      anonimizacao: 'pseudonimizada',
      campos,
      linhas,
      cabecalho: cab,
      tratamento: ctx,
    });
    if (!j.ok) throw new Error('recusado');
    const o = JSON.parse(j.conteudo);
    expect(o.periodoFim).toBe('2026-11-20T05:00:00.000Z');
    expect(Object.keys(o.registros[0])).toEqual(['paciente', 'entrada', 'leito;sala']);
    const x = montarArquivoPacote({
      formato: 'xml',
      anonimizacao: 'pseudonimizada',
      campos,
      linhas,
      cabecalho: cab,
      tratamento: ctx,
    });
    if (!x.ok) throw new Error('recusado');
    expect(x.conteudo).toContain('<campo nome="leito;sala">UTI &quot;1&quot;</campo>');
    expect(x.conteudo.match(/<registro>/g)).toHaveLength(2);
    const f = montarArquivoPacote({
      formato: 'fhir',
      anonimizacao: 'pseudonimizada',
      campos,
      linhas,
      cabecalho: cab,
      tratamento: ctx,
    });
    if (!f.ok) throw new Error('recusado');
    const b = JSON.parse(f.conteudo);
    expect(b.resourceType).toBe('Bundle');
    expect(b.entry).toHaveLength(2);
    expect(b.entry[1].resource.extension).toHaveLength(2);
  });

  it('agregado: agrupa pelos generalizados e conta', () => {
    const r = montarArquivoPacote({
      formato: 'csv',
      anonimizacao: 'agregada',
      campos: [
        {
          sequencia: 1,
          entidade: 'internacao',
          campo: 'entrada',
          rotuloSaida: 'mes',
          tratamento: 'generalizado',
        },
        {
          sequencia: 2,
          entidade: 'internacao',
          campo: 'leito',
          rotuloSaida: 'com_leito',
          tratamento: 'agregado',
        },
      ],
      linhas,
      cabecalho: cab,
      tratamento: ctx,
    });
    if (!r.ok) throw new Error('recusado');
    expect(r.conteudo).toBe('mes;com_leito;quantidade\r\n2026-11;1;2\r\n');
    expect(r.quantidadeRegistros).toBe(1);
  });

  it('recusa formato que não gera, pseudônimo sem chave e campo fora do catálogo', () => {
    const e = (x: Partial<Parameters<typeof montarArquivoPacote>[0]>) => {
      const r = montarArquivoPacote({
        formato: 'csv',
        anonimizacao: 'pseudonimizada',
        campos,
        linhas,
        cabecalho: cab,
        tratamento: ctx,
        ...x,
      });
      return r.ok ? [] : cods(r.erros);
    };
    expect(e({ formato: 'parquet' })).toEqual(['formato-sem-geracao']);
    expect(e({ tratamento: { chave: null, escopo: 'a' } })).toEqual(['sem-chave-pseudonimo']);
    expect(e({ campos: [{ ...campos[0]!, campo: 'cpf' }] })).toEqual(['campo-fora-do-catalogo']);
  });
});

describe('transporte', () => {
  it('fora de produção sempre simulado; produção por HTTP só API e webhook', () => {
    expect(transporteDaEntrega('webhook', 'dev').modo).toBe('simulado');
    expect(transporteDaEntrega('sftp', 'homologacao').modo).toBe('simulado');
    expect(transporteDaEntrega('api', 'producao').modo).toBe('http');
    expect(transporteDaEntrega('sftp', 'producao').modo).toBe('operador');
    expect(transporteDaEntrega('email_seguro', 'producao').modo).toBe('operador');
  });
});
