// pnpm guardas:legado -- --privilegios [--cliente=<código>] [--estrito]
// Regra 4 do M59 no banco próprio: lê do MariaDB de dev, em transação de leitura, os privilégios da conta da aplicação
// (information_schema) e aponta o desvio: privilégio global, de administração, de estrutura ou com repasse é
// VERMELHO; DELETE no banco inteiro é alerta (vermelho só com --estrito: a imutabilidade clínica pede concessão por
// tabela). Sem banco de dev configurado ou sem cliente: a comparação não é feita (verde, com o motivo).
// Melhoria: confere o banco real do produto, sem plano versionado do sistema de origem.
import { lerConfiguracaoNucleo } from '@sgh/nucleo';
import { lerArgumentos } from './argumentos.ts';
import {
  abrirBancoDev,
  ambienteDoRepositorio,
  clienteDaLeitura,
  motivoRecusaBancoDev,
} from './copia-leitura.ts';
import { desviosDaConta, lerPrivilegiosDaConta } from './privilegios-banco.ts';

export async function principalPrivilegios(argv: readonly string[]): Promise<number> {
  const { bandeiras } = lerArgumentos(argv);
  const env = ambienteDoRepositorio();
  const motivo = motivoRecusaBancoDev(env);
  const cliente = clienteDaLeitura(argv, { ...process.env, ...env });
  if (motivo || !cliente) {
    console.log(
      `[guardas --privilegios] comparação com o banco não feita (${motivo ?? 'cliente não informado: --cliente= ou SGH_CLIENTE_LEITURA'}) → verde`,
    );
    return 0;
  }
  const { nucleo } = abrirBancoDev(cliente, env);
  try {
    const conta = lerConfiguracaoNucleo(env).usuario.trim();
    const privilegios = await nucleo.lerSomente({ cliente, correlacao: 'guardas-privilegios' }, (l) =>
      lerPrivilegiosDaConta(l),
    );
    const d = desviosDaConta(privilegios, conta);
    for (const x of d.excesso.slice(0, 40))
      console.error(`[guardas --privilegios] Desvio: conta da aplicação com ${x}`);
    for (const x of d.alertas.slice(0, 40)) console.log(`[guardas --privilegios] Alerta: ${x}`);
    const vermelho = d.excesso.length > 0 || (bandeiras.has('estrito') && d.alertas.length > 0);
    console.log(
      `[guardas --privilegios] ${cliente}: ${privilegios.length} privilégio(s) lidos; excesso ${d.excesso.length}, ` +
        `alertas ${d.alertas.length} → ${vermelho ? 'VERMELHO' : 'verde'}`,
    );
    return vermelho ? 1 : 0;
  } finally {
    await nucleo.encerrar();
  }
}
