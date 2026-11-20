// W0-10 (M3, portabilidade): o Bundle IPS do titular valida contra o perfil da versão fixada (o recorte do pacote
// hl7.fhir.uv.ips 2.0.0 com o SHA-256 conferido) e o validador acusa o que o perfil e as invariantes do documento
// exigem. Dados sintéticos (CPF de teste com dígitos válidos, nunca de pessoa real).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  type EntradaPacoteIps,
  PACOTE_IPS,
  SECOES_IPS,
  pacoteIpsTitular,
  uuidDeterministico,
  validarPacoteIps,
} from './ips.js';

type Json = Record<string, unknown>;

const PDF = new TextEncoder().encode('%PDF-1.4\n% documento sintético\n%%EOF\n');

const ENTRADA: EntradaPacoteIps = {
  protocolo: 'LGPD-2026-000123',
  geradoEm: new Date('2026-11-18T12:00:00Z'),
  paciente: {
    id: 1001,
    cpf: '111.444.777-35',
    cns: null,
    nome: 'Paciente Fictício Um',
    nascimento: new Date('1980-02-03T00:00:00Z'),
    sexo: 'F',
  },
  estabelecimento: {
    cnes: '1234567',
    cnpj: '11.222.333/0001-81',
    nome: 'Hospital Fictício',
    apelido: 'HF',
    cidade: 'São Paulo',
    uf: 'SP',
  },
  problemas: [
    {
      id: 'cid-1',
      descricao: 'Hipertensão essencial',
      cid10: 'I10',
      desde: new Date('2020-01-01'),
      ativo: true,
    },
  ],
  alergias: [{ id: 'al-1', descricao: 'Dipirona', reacao: 'Urticária', critica: true }],
  medicamentos: [
    {
      id: 'med-1',
      descricao: 'Losartana 50 mg',
      posologia: '1 comprimido de 12 em 12 horas',
      desde: new Date('2026-11-10'),
      ativo: true,
    },
  ],
  documentos: [
    {
      id: 'doc-1',
      titulo: 'Sumário de alta',
      emitidoEm: new Date('2026-11-12T10:00:00Z'),
      pdf: PDF,
      assinatura: 'Profissional Fictício, CRM 1234-SP, ICP-Brasil',
    },
  ],
};

const entradas = (b: Json) => b['entry'] as { fullUrl: string; resource: Json }[];
const copia = (b: Json) => JSON.parse(JSON.stringify(b)) as Json;
const mensagens = (b: Json) => validarPacoteIps(b).map((p) => `${p.caminho}: ${p.mensagem}`);

describe('W0-10 (M3): pacote IPS do titular', () => {
  it('o recorte é do pacote IPS 2.0.0 com o hash fixado e traz os perfis usados', () => {
    expect(PACOTE_IPS.versao).toBe('2.0.0');
    expect(PACOTE_IPS.sha256).toBe('b3964eba08ee699bc121b905c4290641e54dd34f2cf3b5cd3edeb08a40a66979');
    for (const t of [
      'Bundle',
      'Composition',
      'Patient',
      'Condition',
      'AllergyIntolerance',
      'MedicationStatement',
    ])
      expect(PACOTE_IPS.perfis[t]?.versao).toBe('2.0.0');
  });

  it('o Bundle completo valida contra o perfil (IPS e BR Core) sem problema', () => {
    const b = pacoteIpsTitular(ENTRADA);
    expect(mensagens(b)).toEqual([]);
    expect(b['type']).toBe('document');
    const [comp, pac] = entradas(b);
    expect(comp!.resource['resourceType']).toBe('Composition');
    expect(pac!.resource['resourceType']).toBe('Patient');
    const codigos = (comp!.resource['section'] as Json[]).map(
      (s) => ((s['code'] as Json)['coding'] as Json[] | undefined)?.[0]?.['code'],
    );
    expect(codigos.slice(0, 3)).toEqual([
      SECOES_IPS.problemas.codigo,
      SECOES_IPS.alergias.codigo,
      SECOES_IPS.medicamentos.codigo,
    ]);
  });

  it('sem registros clínicos e sem data de nascimento: seções com emptyReason e o _birthDate ausente valida', () => {
    const b = pacoteIpsTitular({
      ...ENTRADA,
      paciente: { ...ENTRADA.paciente, nascimento: null },
      problemas: [],
      alergias: [],
      medicamentos: [],
      documentos: [],
    });
    expect(mensagens(b)).toEqual([]);
    const secoes = entradas(b)[0]!.resource['section'] as Json[];
    expect(secoes).toHaveLength(3);
    for (const s of secoes) expect(s['emptyReason']).toBeTruthy();
  });

  it('estabelecimento sem cidade e UF no cadastro: o endereço da Organization leva só o país e valida', () => {
    const b = pacoteIpsTitular({
      ...ENTRADA,
      estabelecimento: { ...ENTRADA.estabelecimento, cidade: '', uf: '' },
    });
    expect(mensagens(b)).toEqual([]);
    const org = entradas(b).find((x) => x.resource['resourceType'] === 'Organization')!.resource;
    expect(org['address']).toEqual([{ country: 'BRA' }]);
  });

  it('o PDF assinado vai inteiro no DocumentReference, com o hash SHA-1 do FHIR', () => {
    const b = pacoteIpsTitular(ENTRADA);
    const doc = entradas(b).find((e) => e.resource['resourceType'] === 'DocumentReference')!.resource;
    const anexo = (doc['content'] as Json[])[0]!['attachment'] as Json;
    const bytes = Buffer.from(String(anexo['data']), 'base64');
    expect(bytes.equals(Buffer.from(PDF))).toBe(true);
    expect(anexo['hash']).toBe(createHash('sha1').update(PDF).digest('base64'));
    expect(anexo['contentType']).toBe('application/pdf');
    expect(doc['description']).toContain('ICP-Brasil');
  });

  it('é determinístico: a mesma entrada dá o mesmo JSON; fullUrl são urn:uuid únicos', () => {
    const a = JSON.stringify(pacoteIpsTitular(ENTRADA));
    expect(JSON.stringify(pacoteIpsTitular(ENTRADA))).toBe(a);
    const urls = entradas(JSON.parse(a) as Json).map((e) => e.fullUrl);
    expect(new Set(urls).size).toBe(urls.length);
    for (const u of urls)
      expect(u).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidDeterministico('x')).not.toBe(uuidDeterministico('y'));
  });

  describe('o validador recusa o que o perfil proíbe', () => {
    it('sem a seção de alergias (fatia obrigatória)', () => {
      const b = copia(pacoteIpsTitular(ENTRADA));
      const comp = entradas(b)[0]!.resource;
      comp['section'] = (comp['section'] as Json[]).filter((_, k) => k !== 1);
      expect(mensagens(b).join('\n')).toContain('48765-2');
    });

    it('seção obrigatória sem entry nem emptyReason (ips-comp-1) e com os dois (cmp-2)', () => {
      const b = copia(pacoteIpsTitular(ENTRADA));
      const secoes = entradas(b)[0]!.resource['section'] as Json[];
      delete secoes[0]!['entry'];
      secoes[1]!['emptyReason'] = { coding: [{ code: 'unavailable' }] };
      const m = mensagens(b).join('\n');
      expect(m).toContain('ips-comp-1');
      expect(m).toContain('cmp-2');
    });

    it('a Composition fora do primeiro lugar (bdl-11) e uma segunda Composition (bdl-ips-1)', () => {
      const b = copia(pacoteIpsTitular(ENTRADA));
      const e = entradas(b);
      b['entry'] = [e[1], e[0], ...e.slice(2), { ...e[0], fullUrl: 'urn:uuid:outra' }];
      const m = mensagens(b).join('\n');
      expect(m).toContain('bdl-11');
      expect(m).toContain('bdl-ips-1');
    });

    it('fullUrl repetido (bdl-7), referência fora do documento e Bundle sem identificador (bdl-9)', () => {
      const b = copia(pacoteIpsTitular(ENTRADA));
      const e = entradas(b);
      e[3]!.fullUrl = e[2]!.fullUrl;
      delete b['identifier'];
      const m = mensagens(b).join('\n');
      expect(m).toContain('bdl-7');
      expect(m).toContain('referência fora do documento');
      expect(m).toContain('bdl-9');
    });

    it('tipo de documento diferente do sumário IPS (LOINC 60591-5) e perfil de outra versão', () => {
      const b = copia(pacoteIpsTitular(ENTRADA));
      const comp = entradas(b)[0]!.resource;
      comp['type'] = { coding: [{ system: 'http://loinc.org', code: '34133-9' }] };
      comp['meta'] = { profile: ['http://hl7.org/fhir/uv/ips/StructureDefinition/Composition-uv-ips|1.1.0'] };
      const m = mensagens(b).join('\n');
      expect(m).toContain('Composition.type');
      expect(m).toContain('versão fixada');
    });

    it('Patient sem data de nascimento nem motivo, e alergia com reação sem manifestação', () => {
      const b = copia(pacoteIpsTitular(ENTRADA));
      const e = entradas(b);
      delete e[1]!.resource['birthDate'];
      const alergia = e.find((x) => x.resource['resourceType'] === 'AllergyIntolerance')!.resource;
      alergia['reaction'] = [{ description: 'sem manifestação' }];
      const m = mensagens(b).join('\n');
      expect(m).toContain('Patient.birthDate');
      expect(m).toContain('AllergyIntolerance.reaction.manifestation');
    });

    it('medicamento sem período de uso (effective[x] obrigatório no IPS)', () => {
      const b = copia(pacoteIpsTitular(ENTRADA));
      const med = entradas(b).find((x) => x.resource['resourceType'] === 'MedicationStatement')!.resource;
      delete med['effectiveDateTime'];
      expect(mensagens(b).join('\n')).toContain('MedicationStatement.effective[x]');
    });
  });
});
