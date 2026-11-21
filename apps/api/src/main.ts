// Partida da API (F2-L): boot mínimo sobre o banco do cliente pelo @sgh/nucleo. Travas antes de subir: neutralização
// (nada sai para fora fora de produção), configuração do acesso, lista de módulos (API_MODULOS) e o armazém de sessões.
import { criarApp } from './app.js';
import { aplicarArquivoAmbiente, lerConfiguracao, recusaDePartida } from './configuracao.js';
import { logger } from './logger.js';
import { recusaDosModulos } from './modulos/registro.js';
import { criarNucleo, partidaEmSegundoPlano } from './nucleo.js';
import { ArmazemMemoria, type ArmazemSessao } from './sessao/armazem.js';
import { ambienteSintetico, recusaDoAcesso } from './sessao/montar.js';
import { ArmazemValkey } from './sessao/valkey.js';
import { iniciarTelemetria } from './telemetria.js';

const carregou = aplicarArquivoAmbiente();
const arquivoAmbiente = carregou ? 'carregado' : 'ausente';

function recusar(motivo: string, texto: string): never {
  logger.fatal({ arquivoAmbiente }, `${motivo}: a API não sobe`);
  console.error(texto);
  process.exit(1);
}

// Trava de saídas: fora de produção, a API não sobe se algo puder falar com fora (neutralização do núcleo).
const recusa = recusaDePartida(process.env);
if (recusa) recusar('trava de saídas', recusa);
// Acesso: AMBIENTE explícito e ACESSO_FONTE_DEV válido; senão, não sobe.
const recusaAcesso = recusaDoAcesso(process.env);
if (recusaAcesso) recusar('acesso', recusaAcesso);
// Módulos: nome desconhecido ou ainda não migrado em API_MODULOS recusa a partida.
const recusaModulos = recusaDosModulos(process.env);
if (recusaModulos) recusar('módulos', recusaModulos);
// Sessão no servidor: Valkey (VALKEY_URL, só loopback). Fora de dev/ci, sem Valkey não sobe (falha fechada: sessão em
// memória não sobrevive a reinício nem é compartilhada). Em dev/ci sem VALKEY_URL, memória com aviso.
const urlValkey = process.env['VALKEY_URL']?.trim();
if (!urlValkey && !ambienteSintetico(process.env))
  recusar('sessão', 'VALKEY_URL ausente: fora de dev/ci a sessão exige o Valkey.');
process.env['SGH_PROCESSO'] ??= 'api';
const telemetria = iniciarTelemetria('sgh-api');
const configuracao = lerConfiguracao();
const nucleo = criarNucleo(process.env);
// Fora de dev/ci, sem o núcleo a API não sobe (nunca cai para a memória).
if (!nucleo && !ambienteSintetico(process.env))
  recusar('núcleo', 'Núcleo não configurado: fora de dev/ci a API exige o banco do cliente.');
let armazem: ArmazemSessao;
if (urlValkey) {
  armazem = new ArmazemValkey(urlValkey);
} else {
  logger.warn({}, 'VALKEY_URL ausente: sessões em memória (só dev/ci; perdem-se ao reiniciar)');
  armazem = new ArmazemMemoria();
}
let app: Awaited<ReturnType<typeof criarApp>>;
try {
  app = await criarApp(configuracao, nucleo, process.env, { armazem, encerrarNucleo: true });
} catch (e) {
  await nucleo?.encerrar();
  recusar('montagem', e instanceof Error ? e.message : 'falha ao montar a API');
}
// Só loopback: o web (proxy /api) é quem fica na rede.
await app.listen(configuracao.portaApi, '127.0.0.1');
logger.info(
  {
    url: await app.getUrl(),
    ambiente: configuracao.ambiente,
    sessao: urlValkey ? 'valkey' : 'memoria',
    nucleo: nucleo ? 'proprio' : 'ausente',
    arquivoAmbiente,
  },
  'api no ar',
);
partidaEmSegundoPlano(nucleo, configuracao.clientePadrao);
process.once('beforeExit', () => void telemetria?.encerrar());
