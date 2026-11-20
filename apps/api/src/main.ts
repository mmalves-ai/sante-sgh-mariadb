import { aplicarArquivoAmbiente, caminhoArquivoAmbiente, recusaDePartida } from '@sgh/legado';
import { criarApp } from './app.js';
import { lerConfiguracao } from './configuracao.js';
import { logger } from './logger.js';
import { recusaDasContasDoBanco } from './modulos/acesso/contas-banco/partida.js';
import { criarNucleo, partidaEmSegundoPlano } from './nucleo.js';
import { ArmazemMemoria, type ArmazemSessao } from './sessao/armazem.js';
import { ambienteSintetico, recusaDoAcesso } from './sessao/montar.js';
import { ArmazemValkey } from './sessao/valkey.js';
import { iniciarTelemetria } from './telemetria.js';

const carregou = aplicarArquivoAmbiente(caminhoArquivoAmbiente());
// Trava de saídas (M01): fora de produção, a API não sobe se algo puder falar com fora.
const recusa = recusaDePartida(process.env);
if (recusa) {
  logger.fatal({ arquivoAmbiente: carregou ? 'carregado' : 'ausente' }, 'trava de saídas: a API não sobe');
  console.error(recusa);
  process.exit(1);
}
// Acesso (M05): AMBIENTE explícito e, fora de dev/ci, a combinação do spike fixada; senão, não sobe.
const recusaAcesso = recusaDoAcesso(process.env);
if (recusaAcesso) {
  logger.fatal({ arquivoAmbiente: carregou ? 'carregado' : 'ausente' }, 'acesso: a API não sobe');
  console.error(recusaAcesso);
  process.exit(1);
}
// Contas do banco (M59, regra 4): em homologação e produção, nunca o administrador do servidor nem a dos scripts.
const recusaContas = recusaDasContasDoBanco(process.env);
if (recusaContas) {
  logger.fatal({ arquivoAmbiente: carregou ? 'carregado' : 'ausente' }, 'contas do banco: a API não sobe');
  console.error(recusaContas);
  process.exit(1);
}
// Sessão no servidor (M05): Valkey (VALKEY_URL, só loopback). Fora de dev/ci, sem Valkey não sobe (falha
// fechada: sessão em memória não sobrevive a reinício nem é compartilhada). Em dev/ci sem VALKEY_URL,
// memória com aviso.
const urlValkey = process.env['VALKEY_URL']?.trim();
if (!urlValkey && !ambienteSintetico(process.env)) {
  logger.fatal({}, 'VALKEY_URL ausente: fora de dev/ci a sessão exige o Valkey; a API não sobe');
  process.exit(1);
}
process.env['SGH_PROCESSO'] ??= 'api'; // marca das conexões no MON$ (coletor do M09)
const telemetria = iniciarTelemetria('sgh-api');
const configuracao = lerConfiguracao();
const nucleo = criarNucleo();
// M08: fora de dev/ci, sem o núcleo do legado a API não sobe (nunca cai para a memória).
if (!nucleo && !ambienteSintetico(process.env)) {
  logger.fatal({}, 'núcleo do legado não configurado: fora de dev/ci a API não sobe');
  process.exit(1);
}
let armazem: ArmazemSessao;
if (urlValkey) {
  armazem = new ArmazemValkey(urlValkey);
} else {
  logger.warn({}, 'VALKEY_URL ausente: sessões em memória (só dev/ci; perdem-se ao reiniciar)');
  armazem = new ArmazemMemoria();
}
const app = await criarApp(configuracao, nucleo, process.env, { armazem });
// Só loopback (convencoes.md §10).
await app.listen(configuracao.portaApi, '127.0.0.1');
logger.info(
  {
    url: await app.getUrl(),
    ambiente: configuracao.ambiente,
    sessao: urlValkey ? 'valkey' : 'memoria',
    arquivoAmbiente: carregou ? 'carregado' : 'ausente',
  },
  'api no ar',
);
// Verificação de schema e conferência do nome de cada estabelecimento (ARQ-1), sem segurar a partida.
partidaEmSegundoPlano(nucleo);
process.once('beforeExit', () => void telemetria?.encerrar());
