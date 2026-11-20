// pnpm datamart:carregar -- --hospital=<cod>|todos [--sem-rede] (ficha do M16, regra 17; ficha do M57, etapa 3,
// regra 9; ADR 0025 e 0030): carga do data mart pseudonimizado a partir da CÓPIA (em dev, a cópia local faz o papel
// da cópia diária; DP-15), nunca do banco em uso. Grava um arquivo SQLite por estabelecimento em DATA_MART_DIR (padrão
// .tmp/data-mart, fora do repositório versionado e de qualquer banco do legado) e, no fim, o arquivo da Rede
// (`rede.sqlite`: a união dos arquivos dos estabelecimentos da rede COM o BI da Rede liberado, `rede.bi`, lido no
// banco de cada um: o desligado fica fora, D-LIB-BI-57; com a dimensão estabelecimento). O paciente e a
// internação viram pseudônimo HMAC com a chave DATA_MART_CHAVE (cofre; em dev, sem a chave, uma chave aleatória desta
// carga: os pseudônimos não se repetem entre cargas); o pseudônimo do paciente é por estabelecimento, salvo com a
// liberação `rede.pseudonimoComum` (DP-42) ligada em TODOS os estabelecimentos. O nascimento vira faixa etária. Antes
// de publicar, cada arquivo passa pelo verificador (nenhuma coluna identificadora). O arquivo da Rede recusa as cargas
// de chaves diferentes ou de ciclos distantes: carregar um só estabelecimento e juntar com a carga antiga dos outros
// pede `--hospital=todos`. Só contagens no console.
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { colunasIdentificadoras, ESQUEMA_DATAMART, modoDoPseudonimo } from '@sgh/dominio-relatorio/datamart';
import { ambienteEfetivo, caminhoArquivoAmbiente } from '@sgh/legado';
import { abrirNucleoCopia } from './copia-leitura.ts';
import {
  biRedeLiberado,
  carregarEstabelecimento,
  consolidarRede,
  pseudonimoComumLiberado,
} from './datamart-carga.ts';

const raiz = resolve(import.meta.dirname, '../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const args = process.argv.slice(2);
const hospital = args.find((a) => a.startsWith('--hospital='))?.slice(11);
if (!hospital) {
  console.error('Uso: pnpm datamart:carregar -- --hospital=<cod>|todos [--sem-rede]');
  process.exit(2);
}
const problemas = colunasIdentificadoras(ESQUEMA_DATAMART);
if (problemas.length > 0) {
  console.error(`Esquema do data mart com coluna identificadora: ${problemas.join(', ')}`);
  process.exit(1);
}
let chave: string | Buffer = env['DATA_MART_CHAVE']?.trim() ?? '';
if (!chave) {
  if ((env['AMBIENTE'] ?? '').trim() !== 'dev') {
    console.error('DATA_MART_CHAVE ausente: fora de dev, a chave do pseudônimo vem do cofre.');
    process.exit(1);
  }
  console.warn(
    '[aviso] DATA_MART_CHAVE ausente: chave aleatória desta carga (os pseudônimos mudam a cada carga).',
  );
  chave = randomBytes(32);
}
const pasta = resolve(raiz, env['DATA_MART_DIR']?.trim() || '.tmp/data-mart');

const { nucleo, codigos } = abrirNucleoCopia();
try {
  const alvo = hospital === 'todos' ? codigos : [hospital];
  for (const h of alvo)
    if (!codigos.includes(h))
      throw new Error(`${h}: não é um estabelecimento desta rede (ESTABELECIMENTOS).`);
  // O modo do pseudônimo vale para a rede inteira: comum só com a liberação em TODOS os estabelecimentos.
  const modo = modoDoPseudonimo(await pseudonimoComumLiberado(nucleo, codigos));
  for (const h of alvo) {
    const r = await carregarEstabelecimento(nucleo, { hospital: h, chave, modo, pasta });
    console.log(
      `[${h}] data mart (pseudônimo ${r.modo}): ${r.internacoes} internações, ${r.pacientesDia} pacientes-dia, ${r.atendimentos} grupos de atendimento, ${r.itens} grupos de itens de conta, ${r.dispensacoes} meses de dispensação em ${r.segundos} s → ${r.arquivo.slice(raiz.length + 1)}`,
    );
  }
  if (!args.includes('--sem-rede')) {
    if (hospital !== 'todos')
      console.warn(
        `[aviso] carga só de ${hospital}: o arquivo da Rede junta as cargas anteriores dos demais (recusado se a chave ou o ciclo não conferirem; use --hospital=todos).`,
      );
    // Só os estabelecimentos com o BI da Rede liberado entram no arquivo da Rede (D-LIB-BI-57; recolher = desligar).
    const bi = await biRedeLiberado(nucleo, codigos);
    const liberados = codigos.filter((_, k) => bi[k]);
    const r = consolidarRede(pasta, codigos, liberados);
    if (r.foraDoBi.length > 0)
      console.log(`[rede] fora do arquivo da Rede (BI da Rede não liberado): ${r.foraDoBi.join(', ')}`);
    for (const a of r.avisos) console.warn(`[aviso] ${a}`);
    if (r.modo === null)
      console.log(
        '[rede] nenhum estabelecimento com o BI da Rede liberado e carregado: arquivo da Rede apagado.',
      );
    else {
      const faltam = liberados.filter((c) => !r.estabelecimentos.includes(c));
      console.log(
        `[rede] arquivo da Rede (pseudônimo ${r.modo}) com ${r.estabelecimentos.join(', ')}${faltam.length ? ` (sem carga: ${faltam.join(', ')})` : ''} → ${r.arquivo.slice(raiz.length + 1)}`,
      );
    }
  }
} finally {
  await nucleo.encerrar();
}
