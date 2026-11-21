// pnpm contas:inventario -- --cliente=<código> [--gravar]
// Inventário da conta da aplicação no MariaDB de dev (regras 4 e 5 do M59 no banco próprio): os privilégios lidos do
// information_schema em transação de leitura, com os desvios (privilegios-banco.ts). Só o rótulo da conta da
// aplicação; as demais contas visíveis entram somadas, sem nome, em faixa ("<5" abaixo de 5). Com --gravar, escreve o
// retrato em tools/verificadores/dados/contas-banco.<cliente>.json. Nunca grava no banco.
// Melhoria: o inventário é o do banco próprio; o relatório das contas do sistema de origem (--relatorio) saiu com a
// convivência (ADR 0003).
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lerConfiguracaoNucleo } from '@sgh/nucleo';
import { lerArgumentos } from './argumentos.ts';
import { abrirBancoDev, ambienteDoRepositorio, clienteDaLeitura } from './copia-leitura.ts';
import { faixaContagem } from './permissoes-dados.ts';
import { desviosDaConta, lerPrivilegiosDaConta, nomeDaConta } from './privilegios-banco.ts';

const raiz = resolve(import.meta.dirname, '../../..');
const argv = process.argv.slice(2);
const { bandeiras } = lerArgumentos(argv);
if (bandeiras.has('relatorio'))
  console.error('--relatorio: retirado (era o relatório das contas do banco de origem; ADR 0003). Use --gravar.');
const env = ambienteDoRepositorio();
const cliente = clienteDaLeitura(argv, { ...process.env, ...env });
if (!cliente) {
  console.error('Uso: pnpm contas:inventario -- --cliente=<código> [--gravar]');
  process.exit(2);
}
const { nucleo } = abrirBancoDev(cliente, env);
let ok = true;
try {
  const conta = lerConfiguracaoNucleo(env).usuario.trim();
  const privilegios = await nucleo.lerSomente({ cliente, correlacao: 'contas-inventario' }, (l) =>
    lerPrivilegiosDaConta(l),
  );
  const daAplicacao = privilegios.filter((p) => nomeDaConta(p.conta) === conta);
  const outras = new Set(privilegios.filter((p) => nomeDaConta(p.conta) !== conta).map((p) => p.conta));
  const desvios = desviosDaConta(privilegios, conta);
  const retrato = {
    formato: 2,
    cliente,
    origem: 'banco de dev (information_schema, leitura)',
    contaDaAplicacao: {
      rotulo: '(aplicacao)',
      privilegios: daAplicacao.map((p) => ({ nivel: p.nivel, alvo: p.alvo, privilegio: p.privilegio, repassa: p.repassa })),
    },
    demaisContasVisiveis: faixaContagem(outras.size),
    desvios,
  };
  for (const p of retrato.contaDaAplicacao.privilegios)
    console.log(`(aplicacao) ${p.nivel.padEnd(7)} ${p.alvo.padEnd(40)} ${p.privilegio}${p.repassa ? ' +repasse' : ''}`);
  console.log(
    `resumo: ${daAplicacao.length} privilégio(s) da conta da aplicação; demais contas visíveis: ${String(retrato.demaisContasVisiveis)}; ` +
      `excesso ${desvios.excesso.length}; alertas ${desvios.alertas.length}`,
  );
  if (bandeiras.has('gravar')) {
    writeFileSync(resolve(raiz, `tools/verificadores/dados/contas-banco.${cliente}.json`), `${JSON.stringify(retrato, null, 2)}\n`);
    console.log(`retrato gravado: tools/verificadores/dados/contas-banco.${cliente}.json`);
  }
} catch (e) {
  ok = false;
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
} finally {
  await nucleo.encerrar();
}
process.exit(ok ? 0 : 1);
