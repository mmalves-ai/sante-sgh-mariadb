// Regras 1, 2, 4 e 7 do M49: o serviço isolado só manda ao provedor o hash do documento emitido aqui, do autor, com a
// prévia igual; o certificado errado recusa o lote inteiro; e cada mídia tem pelo menos duas ACs.
import { describe, expect, it } from 'vitest';
import { lerCertificado } from './certificado.js';
import { CPF_TESTE_A, CPF_TESTE_B, certificadoTeste } from './certificados-teste.spec-util.js';
import {
  midiasSemAutoridadesSuficientes,
  planejarAssinatura,
  type CertificadoParaAssinar,
  type DocumentoEmitido,
} from './servico.js';

const agora = new Date('2026-10-24T12:00:00Z');
const H1 = '1'.repeat(64);
const H2 = '2'.repeat(64);
const H3 = '3'.repeat(64);
const doc = (x: Partial<DocumentoEmitido> & Pick<DocumentoEmitido, 'id' | 'hash'>): DocumentoEmitido => ({
  tipo: 'atestado',
  conselho: 'CRM',
  destino: 'externo',
  autor: 'medico.teste',
  jaAssinadoIcp: false,
  ...x,
});
const docs = new Map([
  [1, doc({ id: 1, hash: H1 })],
  [2, doc({ id: 2, hash: H2, tipo: 'registro-clinico', destino: 'interno' })],
  [3, doc({ id: 3, hash: H3, autor: 'outro.medico' })],
  [4, doc({ id: 4, hash: H1, jaAssinadoIcp: true })],
]);
const cert = (o: Parameters<typeof certificadoTeste>[0] = {}, ativo = true): CertificadoParaAssinar => ({
  midia: 'nuvem',
  lido: lerCertificado(certificadoTeste(o)),
  ativo,
});
const usuario: { login: string; cpf: string | null } = { login: 'medico.teste', cpf: CPF_TESTE_A };
const plano = (pedido: { documentos: number[]; hashes: string[] }, c = cert(), u = usuario) =>
  planejarAssinatura({ pedido, documentos: docs, usuario: u, certificado: c, regras: [], agora });

describe('planejar a assinatura', () => {
  it('documento do autor, com a prévia igual: vai ao provedor só com o hash; atestado externo pede carimbo', () => {
    const p = plano({ documentos: [1, 2], hashes: [H1, H2] });
    expect(p.recusados).toEqual([]);
    expect(p.aAssinar.map((x) => [x.documento, x.hash, x.exigencia.nivel])).toEqual([
      [1, H1, 'icp-brasil'],
      [2, H2, 'eletronica-avancada'],
    ]);
    expect(p.pedeCarimbo).toBe(true);
    expect(p.politica).toBe('AD-RT');
  });

  it('só evolução interna: sem carimbo, AD-RB', () => {
    const p = plano({ documentos: [2], hashes: [H2] });
    expect(p).toMatchObject({ pedeCarimbo: false, politica: 'AD-RB' });
  });

  it('regra 7: documento sem prova (do outro sistema) é recusado, nunca reassinado', () => {
    expect(plano({ documentos: [99], hashes: [H1] }).recusados).toEqual([
      { documento: 99, motivo: 'documento-sem-prova' },
    ]);
  });

  it('regra 4: prévia diferente do documento recusa só aquele item', () => {
    const p = plano({ documentos: [1, 2], hashes: [H1, H3] });
    expect(p.aAssinar.map((x) => x.documento)).toEqual([1]);
    expect(p.recusados).toEqual([{ documento: 2, motivo: 'hash-divergente' }]);
  });

  it('outro autor e documento já assinado: recusa o item', () => {
    expect(plano({ documentos: [3, 4], hashes: [H3, H1] }).recusados).toEqual([
      { documento: 3, motivo: 'nao-e-o-autor' },
      { documento: 4, motivo: 'ja-assinado' },
    ]);
  });

  it('regra 2: CPF do certificado diferente do usuário recusa o lote inteiro', () => {
    const p = plano({ documentos: [1, 2], hashes: [H1, H2] }, cert({ cpf: CPF_TESTE_B }));
    expect(p.aAssinar).toEqual([]);
    expect(p.recusados).toEqual([
      { documento: 1, motivo: 'cpf-divergente' },
      { documento: 2, motivo: 'cpf-divergente' },
    ]);
    expect(
      plano({ documentos: [1], hashes: [H1] }, cert(), { login: 'medico.teste', cpf: null }).recusados[0]
        ?.motivo,
    ).toBe('usuario-sem-cpf');
  });

  it('certificado vencido, fora da ICP, sem não repúdio ou desativado: recusa o lote', () => {
    const motivo = (c: CertificadoParaAssinar) =>
      plano({ documentos: [1], hashes: [H1] }, c).recusados[0]?.motivo;
    expect(motivo(cert({ validoAte: new Date('2026-01-31T00:00:00Z') }))).toBe(
      'certificado-fora-da-vigencia',
    );
    expect(motivo(cert({ validoDe: new Date('2026-12-01T00:00:00Z') }))).toBe('certificado-fora-da-vigencia');
    expect(motivo(cert({ politicas: ['1.2.3'] }))).toBe('certificado-fora-da-icp');
    expect(motivo(cert({ usoDaChave: 0x80 }))).toBe('uso-da-chave');
    expect(motivo(cert({}, false))).toBe('provedor-desligado');
  });
});

describe('regra 1: pelo menos duas ACs por mídia', () => {
  const p = (codigo: string, midias: ('nuvem' | 'a1' | 'a3')[], autoridades: string[], ativo = true) => ({
    codigo,
    ativo,
    midias,
    autoridades,
  });
  it('soma as ACs dos provedores ativos, sem repetir', () => {
    expect(
      midiasSemAutoridadesSuficientes([p('x', ['nuvem'], ['AC 1']), p('y', ['nuvem'], ['ac 2'])], 2),
    ).toEqual([]);
    expect(
      midiasSemAutoridadesSuficientes([p('x', ['nuvem', 'a3'], ['AC 1']), p('y', ['nuvem'], ['AC 1 '])], 2),
    ).toEqual([
      { midia: 'a3', autoridades: 1 },
      { midia: 'nuvem', autoridades: 1 },
    ]);
  });
  it('provedor desligado não conta', () => {
    expect(
      midiasSemAutoridadesSuficientes([p('x', ['a1'], ['AC 1']), p('y', ['a1'], ['AC 2'], false)], 2),
    ).toEqual([{ midia: 'a1', autoridades: 1 }]);
  });
});
