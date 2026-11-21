// pnpm ambiente:verificar (M01): trava de saídas externas. Sai com 1 se algo puder falar com fora.
// A API e o worker rodam a mesma conferência na partida e não sobem se ela falhar.
// Em homologação e produção, confere também a conta do MariaDB da aplicação (regra 4 do M59): nunca o administrador
// do servidor nem a conta interna do MariaDB.
// Melhoria: a conta conferida é a do banco próprio (configuração do núcleo), não as contas por estabelecimento antigas.
import { conferirContaAplicacao } from '@sgh/dominio-acesso';
import {
  ambienteDe,
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  formatarNeutralizacao,
  lerConfiguracaoNucleo,
  verificarNeutralizacao,
} from '@sgh/nucleo';

/** Contas do próprio servidor MariaDB que a aplicação nunca usa. */
const CONTAS_DO_SERVIDOR = ['root', 'mariadb.sys', 'mysql', 'admin'];

const caminho = caminhoArquivoAmbiente();
const { env, carregado } = ambienteEfetivo(process.env, caminho);
console.log(`Arquivo de ambiente: ${carregado ? 'carregado' : 'ausente'} (valores não são impressos)`);
const resultado = verificarNeutralizacao(env);
console.log(formatarNeutralizacao(resultado));

let contasOk = true;
const ambiente = ambienteDe(env);
if (ambiente === 'homolog' || ambiente === 'producao') {
  try {
    const usuario = lerConfiguracaoNucleo(env).usuario.trim();
    const erros = [
      ...conferirContaAplicacao({ aplicacao: [usuario], scripts: null, leitura: null }),
      ...(CONTAS_DO_SERVIDOR.includes(usuario.toLowerCase())
        ? ['a conta da aplicação é uma conta do próprio servidor MariaDB']
        : []),
    ];
    for (const e of erros) console.log(`[conta do banco] ${e} (regra 4 do M59)`);
    if (erros.length > 0) contasOk = false;
  } catch (e) {
    console.log(`[conta do banco] ${e instanceof Error ? e.message : 'configuração inválida'}`);
    contasOk = false;
  }
  console.log(`[conta do banco] ${contasOk ? 'verde' : 'VERMELHO'}`);
}
process.exit(resultado.ok && contasOk ? 0 : 1);
