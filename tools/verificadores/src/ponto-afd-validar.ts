// pnpm ponto:afd-validar (M52.4; ficha, regra 12 e critério de aceite; Desvio da fase: entra na tabela de comandos de
// convencoes.md §13): valida o arquivo do relógio de ponto (AFD) pelo leiaute do domínio, sem banco e sem gravar nada.
//   --arquivo=<caminho>      valida um arquivo: imprime a situação, as contagens e as falhas (código e linha, NUNCA o
//                            conteúdo da linha, que tem o CPF); sai 0 se válido e 2 se em quarentena;
//   --arquivo=sinteticos     valida os seis arquivos sintéticos de @sgh/testes (um válido e cinco com defeito): sai 0
//                            só se o válido entra e os cinco com defeito vão inteiros para a quarentena;
//   --gravar=<pasta>         grava os arquivos sintéticos na pasta (para validar um a um com --arquivo);
//   --leiaute=003 --sem-crc  a versão do leiaute aceita e a conferência do CRC (os parâmetros do estabelecimento).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FALHAS_AFD } from '@sgh/contratos';
import { type ResultadoAfd, validarAfd } from '@sgh/dominio-pessoas';
import { ARQUIVOS_AFD_SINTETICOS } from '@sgh/testes';
import { lerArgumentos } from './argumentos.ts';

const { opcoes, bandeiras } = lerArgumentos(process.argv.slice(2));
const params = { leiaute: opcoes['leiaute'] ?? '003', conferirCrc: !bandeiras.has('sem-crc') };

function resumo(nome: string, r: ResultadoAfd): string {
  const falhas = r.falhas.map(
    (f) => `${f.codigo} (${FALHAS_AFD[f.codigo]})${f.linha ? ` na linha ${f.linha}` : ''}`,
  );
  return [
    `[ponto:afd-validar] ${nome}: ${r.situacao === 'valido' ? 'válido' : 'QUARENTENA'}; ${r.linhas} linha(s), ${r.marcacoes.length} marcação(ões)`,
    ...(r.totalFalhas > 0 ? [`  ${r.totalFalhas} falha(s): ${falhas.join('; ')}`] : []),
  ].join('\n');
}

if (opcoes['gravar']) {
  const pasta = resolve(opcoes['gravar']);
  mkdirSync(pasta, { recursive: true });
  for (const a of ARQUIVOS_AFD_SINTETICOS)
    writeFileSync(resolve(pasta, `afd-${a.nome}.txt`), a.conteudo, 'latin1');
  console.log(
    `[ponto:afd-validar] ${ARQUIVOS_AFD_SINTETICOS.length} arquivo(s) sintético(s) gravado(s) em ${pasta}`,
  );
}

const alvo = opcoes['arquivo'];
if (!alvo) {
  if (!opcoes['gravar']) {
    console.error('Use --arquivo=<caminho> ou --arquivo=sinteticos (e, se quiser, --gravar=<pasta>).');
    process.exit(1);
  }
} else if (alvo === 'sinteticos') {
  let erros = 0;
  for (const a of ARQUIVOS_AFD_SINTETICOS) {
    const r = validarAfd(a.conteudo, params);
    const certo =
      r.situacao === a.esperado && (a.falha === null || r.falhas.some((f) => f.codigo === a.falha));
    if (!certo) erros++;
    console.log(`${resumo(`sintético ${a.nome} (${a.descricao})`, r)}${certo ? '' : '  ← INESPERADO'}`);
  }
  const defeito = ARQUIVOS_AFD_SINTETICOS.filter((a) => a.esperado === 'quarentena').length;
  console.log(
    erros === 0
      ? `[ponto:afd-validar] verde: os ${defeito} arquivos sintéticos com defeito em quarentena e o válido importável`
      : `[ponto:afd-validar] ${erros} resultado(s) inesperado(s)`,
  );
  process.exit(erros === 0 ? 0 : 1);
} else {
  const r = validarAfd(readFileSync(resolve(alvo), 'latin1'), params);
  console.log(resumo(alvo, r));
  process.exit(r.situacao === 'valido' ? 0 : 2);
}
