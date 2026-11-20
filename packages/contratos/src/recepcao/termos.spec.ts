// W1-04 (mercado): o contrato dos termos de consentimento: finalidade do catálogo, tipos de atendimento, meio da
// assinatura (tela com o traço; portal sem imagem), termo faltando por tipo e o conteúdo canônico do hash.
import { describe, expect, it } from 'vitest';
import {
  chegadaPodeSeguir,
  conteudoCanonicoAssinatura,
  esquemaModeloTermo,
  esquemaTermosDoPaciente,
  esquemaAssinarTermo,
  esquemaIncluirModeloTermo,
  type ModeloTermo,
  termosFaltando,
} from './termos.js';

const versao = (id: number, v: number, exigido = true): ModeloTermo['versoes'][number] => ({
  id,
  versao: v,
  titulo: `T${id}`,
  tiposAtendimento: ['consulta'],
  exigido,
  texto: 'x'.repeat(20),
  hashTexto: 'h',
  criadoPor: 'U',
  criadoEm: '2026-11-19',
});
const modelo = (codigo: string, versoes: ModeloTermo['versoes'], ativo = true): ModeloTermo => ({
  codigo,
  finalidade: 'atendimento',
  ativo,
  versoes,
  assinaturas: 0,
});

describe('termos de consentimento (contrato)', () => {
  it('inclusão: código normalizado, tipos únicos e ordenados, finalidade só do catálogo', () => {
    const r = esquemaIncluirModeloTermo.parse({
      codigo: ' LGPD-Consulta ',
      titulo: 'Termo',
      finalidade: 'comunicacao',
      tiposAtendimento: ['pa', 'consulta', 'pa'],
      exigido: false,
      texto: 'Texto do termo com mais de vinte letras.',
    });
    expect(r.codigo).toBe('lgpd-consulta');
    expect(r.tiposAtendimento).toEqual(['consulta', 'pa']);
    expect(esquemaIncluirModeloTermo.safeParse({ ...r, finalidade: 'marketing' }).success).toBe(false);
    expect(esquemaIncluirModeloTermo.safeParse({ ...r, tiposAtendimento: [] }).success).toBe(false);
  });

  it('assinatura: em tela exige o traço; pelo portal, sem imagem', () => {
    const base = {
      modelo: 1,
      prontuario: 10,
      senha: null,
      tipoAtendimento: 'consulta',
      signatario: 1,
      nomeSignatario: 'Ana Maria',
    };
    expect(esquemaAssinarTermo.safeParse({ ...base, meio: 'tela', imagem: null }).success).toBe(false);
    expect(esquemaAssinarTermo.safeParse({ ...base, meio: 'tela', imagem: 'iVBORw0K' }).success).toBe(true);
    expect(esquemaAssinarTermo.safeParse({ ...base, meio: 'portal', imagem: 'iVBORw0K' }).success).toBe(
      false,
    );
    expect(esquemaAssinarTermo.safeParse({ ...base, meio: 'portal', imagem: null }).success).toBe(true);
  });

  it('faltando: só o exigido, ativo, do tipo, sem assinatura válida na versão vigente', () => {
    const modelos = [
      modelo('a', [versao(3, 2), versao(1, 1)]),
      modelo('b', [versao(2, 1, false)]),
      modelo('c', [versao(4, 1)], false),
      modelo('d', [versao(5, 1)]),
    ];
    const assinaturas = [
      { modelo: 1, revogacao: null }, // versão antiga de "a": não vale
      { modelo: 5, revogacao: { motivo: 'm', usuario: 'u', em: 'x' } }, // revogada: não vale
    ];
    expect(termosFaltando(modelos, assinaturas, 'consulta').map((p) => [p.codigo, p.versao])).toEqual([
      ['a', 2],
      ['d', 1],
    ]);
    expect(
      termosFaltando(
        modelos,
        [
          { modelo: 3, revogacao: null },
          { modelo: 5, revogacao: null },
        ],
        'consulta',
      ),
    ).toEqual([]);
    expect(termosFaltando(modelos, [], 'exame')).toEqual([]);
  });

  it('conteúdo canônico: ordem fixa; qualquer campo muda o conteúdo', () => {
    const a = {
      modelo: 1,
      hashTexto: 'h',
      prontuario: 10,
      senha: null,
      tipoAtendimento: 'consulta',
      meio: 'tela' as const,
      signatario: 1,
      nomeSignatario: 'Ana',
      assinadoEm: '2026-11-19 10:00:00',
      hashImagem: 'i',
    };
    expect(conteudoCanonicoAssinatura(a)).toBe(
      '["sgh-termo-v1",1,"h",10,null,"consulta","tela",1,"Ana","2026-11-19 10:00:00","i"]',
    );
    expect(conteudoCanonicoAssinatura({ ...a, nomeSignatario: 'Ana ' })).not.toBe(
      conteudoCanonicoAssinatura(a),
    );
  });

  it('bloqueio suave: só a confirmação de quem atende libera; sem exigir ou sem falta, segue', () => {
    const falta = [{ codigo: 'a', titulo: 'A', versao: 1, modelo: 1 }];
    expect(chegadaPodeSeguir({ faltando: [], bloqueioSuave: false }, false)).toBe(true);
    expect(chegadaPodeSeguir({ faltando: falta, bloqueioSuave: false }, false)).toBe(true);
    expect(chegadaPodeSeguir({ faltando: falta, bloqueioSuave: true }, false)).toBe(false);
    expect(chegadaPodeSeguir({ faltando: falta, bloqueioSuave: true }, true)).toBe(true);
  });

  it('respostas: o modelo e os termos do paciente passam pelos esquemas que a tela usa', () => {
    expect(esquemaModeloTermo.parse(modelo('a', [versao(1, 1)])).versoes[0]!.versao).toBe(1);
    const r = esquemaTermosDoPaciente.parse({
      prontuario: 9,
      signatarios: [{ codigo: 1, rotulo: 'Paciente' }],
      assinaturas: [],
      faltando: [],
      bloqueioSuave: false,
      exigir: false,
    });
    expect(r.signatarios).toHaveLength(1);
    expect(() => esquemaTermosDoPaciente.parse({ ...r, signatarios: undefined })).toThrow();
  });
});
