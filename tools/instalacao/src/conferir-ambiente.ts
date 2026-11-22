// node tools/instalacao/src/conferir-ambiente.ts <arquivo> [--uid=<n>]
// M60, etapa 2: confere o arquivo de ambiente do servidor (usado pelo instalar.sh e pelo atualizar.sh antes de subir os
// serviços) e a pasta de arquivos (ADR 0004). Imprime só NOMES de chave e o motivo; nunca valores. Com --uid, confere também modo 0600 e o dono.
import { readFileSync, statSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { conferirAmbiente, type ProblemaAmbiente } from './ambiente.ts';
import { conferirRaizArquivos } from './arquivos-raiz.ts';

const arquivo = process.argv[2];
if (!arquivo || arquivo.startsWith('--')) {
  console.error('Uso: conferir-ambiente.ts <arquivo> [--uid=<n>]');
  process.exit(2);
}
const uid = process.argv.find((a) => a.startsWith('--uid='))?.slice(6);
const texto = readFileSync(arquivo, 'utf8');
const problemas: ProblemaAmbiente[] = conferirAmbiente(texto);
// ADR 0004: a pasta de arquivos (permissão, dono do serviço e espaço livre, com alerta abaixo do limite).
const env = parseEnv(texto) as Record<string, string | undefined>;
const raizArquivos = conferirRaizArquivos(env['ARQUIVOS_RAIZ'], {
  ...(uid === undefined ? {} : { uid }),
  ...(env['ARQUIVOS_ALERTA_LIVRE_GB'] ? { alertaLivreGb: Number(env['ARQUIVOS_ALERTA_LIVRE_GB']) } : {}),
});
problemas.push(...raizArquivos.problemas.filter((p) => !problemas.some((q) => q.chave === p.chave)));
for (const a of raizArquivos.alertas) console.warn(`  alerta: ${a}`);
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
