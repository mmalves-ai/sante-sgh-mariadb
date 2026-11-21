// pnpm relatorios:triagem -- --cliente=<c> --estabelecimento=<código> --inventario=<arquivo.json> [--so-ler]
// (ficha do M34, regra 2): lê o inventário dos relatórios de consulta livre do editor de origem (só metadado, exportado
// pelo conector; o texto da consulta nunca é lido), propõe destino, papel dono, artefato e onda pelas regras
// versionadas (@sgh/dominio-relatorio) e grava em triagem_relatorio_legado do banco próprio (inclui as que faltam,
// atualiza as propostas que mudaram; a decisão confirmada pela área fica). Sai 1 com relatório sem destino ou sem dono.
// Resumo só com contagens (nenhum nome de pessoa).
// Melhoria: área dona pela chave do domínio (nunca o rótulo livre); relatório fora do inventário é avisado.
// Melhoria: nenhuma leitura do sistema de origem aqui (o conector é o único que lê a origem); grava pelo Executor.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resumirTriagem } from '@sgh/dominio-relatorio';
import { NucleoProprio } from '@sgh/nucleo';
import { lerArgumentos } from './argumentos.ts';
import {
  esquemaInventario,
  gravarPropostasTriagem,
  propostaDoRelatorio,
  resumoTriagemGravada,
} from './relatorios-triagem-banco.ts';

const { opcoes, bandeiras } = lerArgumentos(process.argv.slice(2));
const cliente = (opcoes['cliente'] ?? '').trim();
const codigoEst = (opcoes['estabelecimento'] ?? '').trim();
const arquivo = (opcoes['inventario'] ?? '').trim();
if (!/^[a-z][a-z0-9_]{0,63}$/.test(cliente) || !codigoEst || !arquivo) {
  console.error(
    'Uso: relatorios:triagem -- --cliente=<c> --estabelecimento=<código> --inventario=<arquivo.json> [--so-ler]',
  );
  process.exit(2);
}
const inventario = esquemaInventario.parse(JSON.parse(readFileSync(resolve(arquivo), 'utf8')));
if (inventario.estabelecimento !== codigoEst) {
  console.error('O inventário é de outro estabelecimento.');
  process.exit(2);
}

const nucleo = new NucleoProprio();
let ok = true;
try {
  const est = await nucleo.lerSomente({ cliente, correlacao: 'relatorios-triagem' }, (l) =>
    l.uma<{ id: number } & Record<string, unknown>>('SELECT id FROM estabelecimento WHERE codigo = ?', [
      codigoEst,
    ]),
  );
  if (!est) throw new Error(`Estabelecimento ${codigoEst} não cadastrado no cliente ${cliente}.`);
  const propostas = inventario.relatorios.map(propostaDoRelatorio);
  const resumo = resumirTriagem(
    propostas.map((p) => ({ destino: p.destino!, marco: p.marco, papelDono: p.areaDona, regra: p.regra })),
  );
  console.log(
    `[${codigoEst}] ${resumo.total} relatórios: ${resumo.total - resumo.semDestino} com destino, ${resumo.semDestino} sem destino, ${resumo.semDono} sem dono`,
  );
  console.log(`[${codigoEst}] por destino: ${JSON.stringify(resumo.porDestino)}`);
  console.log(`[${codigoEst}] por marco: ${JSON.stringify(resumo.porMarco)}`);
  if (resumo.semDestino > 0 || resumo.semDono > 0) ok = false;
  if (!bandeiras.has('so-ler') && propostas.length > 0) {
    const s = await gravarPropostasTriagem(
      nucleo.criarExecutor(),
      cliente,
      {
        cliente,
        estabelecimento: Number(est.id),
        usuario: null,
        correlacao: 'relatorios-triagem',
        chaveIdempotencia: `relatorios-triagem-${randomUUID()}`,
      },
      propostas,
    );
    const g = await resumoTriagemGravada(nucleo, cliente, Number(est.id));
    const r = s.resultado;
    console.log(
      `[${codigoEst}] gravado: ${r.incluidas} incluída(s), ${r.atualizadas} atualizada(s), ${r.inalteradas} sem mudança, ${r.preservadas} decisão(ões) da área preservada(s), ${r.excluidasPreservadas} excluída(s) pela área mantida(s); na tabela ${g.total} com ${g.semDono} sem área dona e ${g.confirmadas} confirmada(s)`,
    );
    if (Number(r.ausentes) > 0)
      console.warn(
        `[${codigoEst}] aviso: ${r.ausentes} relatório(s) da triagem fora do inventário atual (a área decide; nada foi apagado): ${String(r.codigosAusentes).split(',').slice(0, 30).join(', ')}`,
      );
    if (g.total < propostas.length || g.semDono > 0) ok = false;
  }
} finally {
  await nucleo.encerrar();
}
console.log(ok ? 'Resultado: verde' : 'Resultado: VERMELHO');
process.exit(ok ? 0 : 1);
