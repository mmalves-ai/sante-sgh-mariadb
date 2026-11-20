// pnpm ambiente:verificar (M01): trava de saídas externas. Sai com 1 se algo puder falar com fora.
// A API e o worker rodam a mesma conferência na partida e não sobem se ela falhar.
// M59-F1 (regra 4): em homologação e produção, confere também as contas do banco de cada estabelecimento (a da
// aplicação e as por módulo nunca são o administrador do servidor nem a dona dos objetos SGH_).
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  formatarResultado,
  lerCodigos,
  lerContasDeModulo,
  verificarAmbiente,
} from '@sgh/legado';
import { conferirContaAplicacao } from '@sgh/dominio-acesso';

const caminho = caminhoArquivoAmbiente();
const { env, carregado } = ambienteEfetivo(caminho);
console.log(`Arquivo de ambiente: ${carregado ? 'carregado' : 'ausente'} (valores não são impressos)`);
const resultado = verificarAmbiente(env);
console.log(formatarResultado(resultado));

let contasOk = true;
const ambiente = env['AMBIENTE']?.trim() ?? '';
if (ambiente === 'homologacao' || ambiente === 'producao') {
  try {
    for (const cod of lerCodigos(env)) {
      const C = cod.toUpperCase();
      const erros = conferirContaAplicacao({
        aplicacao: [
          env[`FB_${C}_USUARIO`] ?? '',
          ...lerContasDeModulo(cod, env).map((c) => c.usuario),
        ].filter((x) => x.trim() !== ''),
        scripts: env[`FB_${C}_SCRIPTS_USUARIO`]?.trim() || null,
        leitura: null,
      });
      for (const e of erros) console.log(`[contas do banco] ${cod}: ${e} (regra 4 do M59)`);
      if (erros.length > 0) contasOk = false;
    }
  } catch (e) {
    console.log(`[contas do banco] ${(e as Error).message}`);
    contasOk = false;
  }
  console.log(`[contas do banco] ${contasOk ? 'verde' : 'VERMELHO'}`);
}
process.exit(resultado.ok && contasOk ? 0 : 1);
