// node tools/instalacao/src/conferir-ambiente.ts <arquivo> [--uid=<n>]
// M60, etapa 2: confere o arquivo de ambiente do servidor (usado pelo instalar.sh e pelo atualizar.sh antes de subir os
// serviços). Imprime só NOMES de chave e o motivo; nunca valores. Com --uid, confere também modo 0600 e o dono.
import { readFileSync, statSync } from 'node:fs';
import { conferirAmbiente, type ProblemaAmbiente } from './ambiente.ts';

const arquivo = process.argv[2];
if (!arquivo || arquivo.startsWith('--')) {
  console.error('Uso: conferir-ambiente.ts <arquivo> [--uid=<n>]');
  process.exit(2);
}
const uid = process.argv.find((a) => a.startsWith('--uid='))?.slice(6);
const problemas: ProblemaAmbiente[] = conferirAmbiente(readFileSync(arquivo, 'utf8'));
if (uid !== undefined) {
  const s = statSync(arquivo);
  if ((s.mode & 0o777) !== 0o600)
    problemas.push({ chave: '(arquivo)', motivo: `modo ${(s.mode & 0o777).toString(8)}; use 0600.` });
  if (String(s.uid) !== uid)
    problemas.push({ chave: '(arquivo)', motivo: 'o dono não é o usuário do serviço.' });
}
if (problemas.length) {
  for (const p of problemas) console.error(`  ${p.chave}: ${p.motivo}`);
  console.error(`Arquivo de ambiente recusado: ${problemas.length} problema(s).`);
  process.exit(1);
}
console.log('Arquivo de ambiente conferido.');
