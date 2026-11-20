// Extrai do pacote BR Core da versão fixada (ADR 0016: 1.6.1, CC0-1.0) o recorte dos perfis que os mapeadores FHIR do
// M34 usam (Patient, Organization, Practitioner, Immunization): de cada elemento do snapshot, o id, o caminho, a fatia,
// a cardinalidade, o valor fixo ou padrão e os tipos. O recorte vai versionado em
// packages/dominio-integracao/src/fhir/br-core-1.6.1.json com o SHA-256 do pacote (conferido aqui): o validador do CI
// confere os recursos gerados contra ele. Uso: node tools/verificadores/src/br-core-extrair.ts <caminho do package.tgz>
// (baixado de https://hl7.org.br/fhir/core/v1.6.1/package.tgz). Não conecta à rede.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HASH_ESPERADO = '974a20ff4ec49727c75624065826ecfda35b3d368d82a02eadfc0713d537f8c6';
const PERFIS = ['patient', 'organization', 'practitioner', 'immunization'] as const;
const raiz = resolve(import.meta.dirname, '../../..');

const tgz = process.argv[2];
if (!tgz) {
  console.error('Uso: node tools/verificadores/src/br-core-extrair.ts <package.tgz do BR Core 1.6.1>');
  process.exit(2);
}
const hash = createHash('sha256').update(readFileSync(tgz)).digest('hex');
if (hash !== HASH_ESPERADO) {
  console.error(`SHA-256 do pacote diferente do fixado no ADR 0016 (${hash}).`);
  process.exit(1);
}
const pasta = mkdtempSync(join(tmpdir(), 'br-core-'));
try {
  execFileSync('tar', ['xzf', tgz, '-C', pasta]);
  const perfis: Record<string, unknown> = {};
  for (const p of PERFIS) {
    const sd = JSON.parse(
      readFileSync(join(pasta, 'package', `StructureDefinition-br-core-${p}.json`), 'utf8'),
    ) as {
      url: string;
      version: string;
      type: string;
      snapshot: { element: Record<string, unknown>[] };
    };
    perfis[sd.type] = {
      url: sd.url,
      versao: sd.version,
      tipo: sd.type,
      elementos: sd.snapshot.element.map((e) => {
        const fixo = Object.entries(e).find(([k]) => k.startsWith('fixed') || k.startsWith('pattern'));
        return {
          id: e['id'],
          caminho: e['path'],
          ...(e['sliceName'] ? { fatia: e['sliceName'] } : {}),
          min: e['min'],
          max: e['max'],
          ...(fixo ? { fixo: { tipo: fixo[0], valor: fixo[1] } } : {}),
          tipos: ((e['type'] as { code: string }[] | undefined) ?? []).map((t) => t.code),
        };
      }),
    };
  }
  const destino = resolve(raiz, 'packages/dominio-integracao/src/fhir/br-core-1.6.1.json');
  writeFileSync(
    destino,
    `${JSON.stringify({ pacote: 'br.gov.saude.br-core.fhir', versao: '1.6.1', licenca: 'CC0-1.0', sha256: hash, perfis }, null, 1)}\n`,
  );
  console.log(`Recorte dos perfis ${PERFIS.join(', ')} gravado em ${destino}.`);
} finally {
  rmSync(pasta, { recursive: true, force: true });
}
