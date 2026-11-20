// W0-10 (M3, portabilidade): extrai do pacote IPS da versão fixada (hl7.fhir.uv.ips 2.0.0, CC0-1.0, FHIR R4 4.0.1) o
// recorte dos perfis que o gerador do pacote do titular usa (Bundle, Composition, Patient, Condition,
// AllergyIntolerance, MedicationStatement, Organization): de cada elemento do snapshot até o terceiro nível, o id, o
// caminho, a fatia, a cardinalidade, o valor fixo ou padrão e os tipos (o mesmo formato do recorte do BR Core). O
// recorte vai versionado em packages/dominio-integracao/src/fhir/ips-2.0.0.json com o SHA-256 do pacote (conferido
// aqui): o validador do CI confere o Bundle IPS gerado contra ele. Uso:
//   ./pnpm exec node tools/verificadores/src/ips-extrair.ts <package.tgz>
// (baixado de https://packages.fhir.org/hl7.fhir.uv.ips/2.0.0). Não conecta à rede.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HASH_ESPERADO = 'b3964eba08ee699bc121b905c4290641e54dd34f2cf3b5cd3edeb08a40a66979';
const PERFIS = [
  'Bundle',
  'Composition',
  'Patient',
  'Condition',
  'AllergyIntolerance',
  'MedicationStatement',
  'Organization',
] as const;
const raiz = resolve(import.meta.dirname, '../../..');

const tgz = process.argv[2];
if (!tgz) {
  console.error('Uso: ./pnpm exec node tools/verificadores/src/ips-extrair.ts <package.tgz do IPS 2.0.0>');
  process.exit(2);
}
const hash = createHash('sha256').update(readFileSync(tgz)).digest('hex');
if (hash !== HASH_ESPERADO) {
  console.error(`SHA-256 do pacote diferente do fixado (${hash}).`);
  process.exit(1);
}
const pasta = mkdtempSync(join(tmpdir(), 'ips-'));
try {
  execFileSync('tar', ['xzf', tgz, '-C', pasta]);
  const perfis: Record<string, unknown> = {};
  for (const p of PERFIS) {
    const sd = JSON.parse(
      readFileSync(join(pasta, 'package', `StructureDefinition-${p}-uv-ips.json`), 'utf8'),
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
      elementos: sd.snapshot.element
        // Até o terceiro nível (o validador confere o recurso, os filhos e os netos das fatias); sem extensões.
        .filter((e) => String(e['id']).split('.').length <= 3 && !String(e['id']).includes('extension'))
        .map((e) => {
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
  const destino = resolve(raiz, 'packages/dominio-integracao/src/fhir/ips-2.0.0.json');
  writeFileSync(
    destino,
    `${JSON.stringify({ pacote: 'hl7.fhir.uv.ips', versao: '2.0.0', licenca: 'CC0-1.0', sha256: hash, perfis }, null, 1)}\n`,
  );
  console.log(`Recorte dos perfis ${PERFIS.join(', ')} gravado em ${destino}.`);
} finally {
  rmSync(pasta, { recursive: true, force: true });
}
