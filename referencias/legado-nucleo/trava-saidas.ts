// Trava de saídas externas (M01; convencoes.md §1 regra 10 e §10; cap-09 §9.12; DP-44 b).
// Fora de `producao`, o processo não sobe se a configuração permitir falar com o mundo de fora.
// Esta parte é pura (só lê o ambiente); a leitura da neutralização na cópia fica em copia/neutralizacao.ts.
// Mensagens citam nomes de chave e hosts, nunca valores de segredo.
import type { Ambiente } from './arquivo-ambiente.js';
import { ErroConfiguracaoEstabelecimentos, chaveFb, lerEstabelecimentos } from './estabelecimentos.js';

export const AMBIENTES = ['dev', 'ci', 'homolog', 'treino', 'producao'] as const;
export type NomeAmbiente = (typeof AMBIENTES)[number];

/** Portas já ocupadas nesta VM por outros projetos (convencoes.md §10). 3050 é a do `sante-firebird`. */
export const PORTAS_OCUPADAS: readonly number[] = [
  631, 1720, 2000, 3050, 3105, 5038, 5060, 5275, 6435, 6436, 6480, 7070, 8088, 14178,
];
/** Endereço ocupado por host e porta (o banco de dev da Hal-AI). */
export const ENDERECOS_OCUPADOS: readonly string[] = ['127.0.0.55:3306'];

/** Containers de outros projetos que o Sante SGH nunca usa como destino. */
export const CONTAINERS_ALHEIOS: readonly string[] = ['sante-firebird', 'halaidb-55', 'halai-asterisk'];

/** Mailpit do projeto: SMTP em 127.0.0.1:1325 (ou o container `sgh-mailpit`, porta interna 1025). */
export const MAILPIT = { porta: 1325, container: 'sgh-mailpit', portaInterna: 1025 } as const;

/**
 * Container da cópia de dev do código: a compartilhada `redesante-fb-<cod>` de ../banco-dev (desvio do M01
 * de 2026-10-19). Definição única, usada pela trava, pelo isql e pelo destino de `copia:*`.
 */
export function containerDaCopia(codigo: string): string {
  return `redesante-fb-${codigo}`;
}
/** Nome de container de cópia (o grupo 1 é o código). Casa exatamente com containerDaCopia(cod). */
export const CONTAINER_COPIA = /^redesante-fb-([a-z][a-z0-9]{1,9})$/;
/**
 * Servidor de ensaio do Firebird 5 (M58.2, infra/firebird/fase7/ensaio-firebird5): restauração descartável da cópia
 * neutralizada do estabelecimento, só no loopback; a neutralização é conferida nele do mesmo jeito que na cópia.
 */
export const CONTAINER_ENSAIO_FB5 = /^sgh-ensaio-fb5-([a-z][a-z0-9]{1,9})$/;
/** Container de serviço do projeto (Compose `sgh`). */
export const CONTAINER_PROJETO = /^sgh-[a-z0-9-]+$/;

export interface ItemTrava {
  readonly regra: string;
  readonly ok: boolean;
  readonly detalhe: string;
}

export interface ResultadoTrava {
  readonly ambiente: string;
  readonly aplicavel: boolean;
  readonly itens: readonly ItemTrava[];
  readonly ok: boolean;
}

export function ehLoopback(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(?:\.\d{1,3}){3}$/.test(h);
}

/** Destino aceito fora de produção: loopback ou container do próprio projeto (nunca de outro projeto). */
export function ehDestinoLocal(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (CONTAINERS_ALHEIOS.includes(h)) return false;
  return ehLoopback(h) || CONTAINER_COPIA.test(h) || CONTAINER_PROJETO.test(h);
}

/** Marcador de URL que não se consegue ler: tratada como destino desconhecido, nunca impressa crua. */
export const URL_ILEGIVEL = '<URL ilegível>';

const ESQUEMA_URL = /[a-z][a-z0-9+.-]*:\/\/[^\s,;"']*/gi;

/** Host de um valor sem esquema (`host`, `host:porta`, `host/caminho`, `usuario:senha@host`), sem credencial. */
function hostSemEsquema(trecho: string): string {
  const semCredencial = trecho.includes('@') ? trecho.slice(trecho.lastIndexOf('@') + 1) : trecho;
  if (/^\[[0-9a-f:.]+\]/i.test(semCredencial)) return semCredencial.slice(0, semCredencial.indexOf(']') + 1);
  return semCredencial.split(/[/:?#]/)[0] ?? '';
}

/** Valor sem esquema que tem cara de host: IPv4, `[IPv6]`, `localhost` ou nome com ponto e rótulo final alfabético. */
function pareceHost(h: string): boolean {
  return (
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) ||
    /^\[[0-9a-f:.]+\]$/i.test(h) ||
    h.toLowerCase() === 'localhost' ||
    /^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*$/i.test(h)
  );
}

/** Número puro ou booleano nunca é host (ex.: `SGX_AESM_ADDR=1` do runner do GitHub Actions). */
const NAO_EH_HOST = /^(?:\d+|true|false|yes|no|on|off|sim|nao|não)$/i;

/**
 * Hosts citados num valor. Toda URL com esquema (`esquema://`) conta, em qualquer chave. Em chave de
 * endereço (ehChaveDeEndereco), o valor sem esquema também conta: em chave com sufixo de endereço
 * (`_HOST`, `_URL`, `_ENDPOINT`…) como host, qualquer que seja a forma (menos número puro ou
 * booleano); em chave só da família (`TISS_`,
 * `HALAI_`…) quando tem cara de host. Credencial (`usuario:senha@`) nunca entra no resultado.
 */
export function hostsDoValor(valor: string, chave: string): string[] {
  const v = valor.trim();
  if (v === '') return [];
  const urls = [...v.matchAll(ESQUEMA_URL)].map((m) => m[0]);
  if (urls.length > 0) {
    return urls.map((u) => {
      try {
        const h = new URL(u).hostname;
        return h === '' ? URL_ILEGIVEL : h;
      } catch {
        return URL_ILEGIVEL;
      }
    });
  }
  if (!ehChaveDeEndereco(chave)) return [];
  const sufixo = SUFIXO_ENDERECO.test(chave);
  return v
    .split(/[\s,;]+/)
    .filter((t) => t !== '')
    .map(hostSemEsquema)
    .filter((h) => h !== '' && !NAO_EH_HOST.test(h) && (sufixo || pareceHost(h)));
}

// Chaves que carregam endereço de saída: sufixos de endereço e famílias de integração externa.
const SUFIXO_ENDERECO =
  /_(?:URL|URI|URLS|ENDPOINT|HOST|HOSTNAME|WEBHOOK|SERVIDOR|SERVER|DSN|WSDL|WS|API|ADDR|ADDRESS|ENDERECO)$/;
const FAMILIA_EXTERNA =
  /^(?:HALAI|HAL_AI|TISS|ANS|OPERADORA|CONVENIO|LABORATORIO|LAB|BANCO_EXTERNO|EXTERNO|INTEGRACAO|FTP|SMTP|EMAIL|MAIL|OTEL|S3|VALKEY|GOTENBERG|WEBHOOK|NOTIFICACAO|PSP|PIX|ADQUIRENTE|PAGAMENTO|CARTAO|GATEWAY|ASSINATURA|ICP|PSC|ACT|SNCR|ATESTA|REGULACAO|GERINT|GERCON|SISREG|ESOCIAL|REINF|FGTS|FOLHA_EXTERNA)(?:_|$)/;
// Canal próprio de mensagem ao paciente (o Sante SGH não tem: DP-44 b). Basta a chave existir.
const CANAL_PROPRIO =
  /(?:^|_)(?:WHATSAPP|WHATS|WPP|ZAPI|TWILIO|SMS|TELEGRAM|EVOLUTION|GUPSHUP|ZENVIA|WABA|INFOBIP|SINCH|VONAGE|NEXMO|DIALOG360|WEBCHAT)(?:_|$)/;
// Chaves do sistema operacional, das ferramentas (pnpm, Nx, editor) e do runner de CI (GitHub Actions:
// GITHUB_SERVER_URL, GITHUB_API_URL, ACTIONS_RUNTIME_URL, RUNNER_TEMP…), que não são configuração do
// projeto e chegam pelo ambiente do processo; só estas ficam fora da procura de URL em toda chave.
const CHAVE_DO_SISTEMA =
  /^(?:npm_|PNPM_|NX_|GITHUB_|ACTIONS_|RUNNER_|ImageOS$|ImageVersion$|COREPACK_|VSCODE_|TERM_|XDG_|GIT_|GNOME_|GTK_|DBUS_|SSH_|DESKTOP_|WINDOWID$|DISPLAY$|WAYLAND_|LS_COLORS$|PATH$|MANPATH$|INFOPATH$|HOME$|PWD$|OLDPWD$|SHELL$|USER$|LOGNAME$|LANG$|LC_|SHLVL$|_$|TMPDIR$|EDITOR$|VISUAL$|PAGER$|BROWSER$|COLORTERM$|TERM$|SESSION_MANAGER$|CLAUDE|ANTHROPIC_|MCP_|OTEL_SDK_DISABLED$|NODE_OPTIONS$|NODE_PATH$|NODE_ENV$|INIT_CWD$|SNAP|DEBUGINFOD_URLS$)/;

export function ehChaveDeCanalProprio(chave: string): boolean {
  return CANAL_PROPRIO.test(chave.toUpperCase());
}

export function ehChaveDeEndereco(chave: string): boolean {
  return SUFIXO_ENDERECO.test(chave) || FAMILIA_EXTERNA.test(chave);
}

/** Chave do sistema ou das ferramentas (fora da procura de URL); nunca uma de endereço do projeto. */
export function ehChaveDoSistema(chave: string): boolean {
  return CHAVE_DO_SISTEMA.test(chave);
}

function smtp(env: Ambiente): ItemTrava[] {
  const regra = 'SMTP só para o Mailpit';
  const itens: ItemTrava[] = [];
  // Porta de SMTP em chave solta (SMTP_PORTA, EMAIL_PORT…): só a do Mailpit (1325, ou 1025 no container).
  for (const chave of Object.keys(env).sort()) {
    if (!/^(?:SMTP|EMAIL|MAIL)_(?:[A-Z0-9_]*_)?(?:PORTA|PORT)$/.test(chave)) continue;
    const p = (env[chave] ?? '').trim();
    if (p === '' || p === String(MAILPIT.porta) || p === String(MAILPIT.portaInterna)) continue;
    itens.push({
      regra,
      ok: false,
      detalhe: `${chave}=${/^\d{1,5}$/.test(p) ? p : '?'}; fora de produção só a porta ${MAILPIT.porta} (Mailpit)`,
    });
  }
  const valor = env['SMTP_URL']?.trim() ?? '';
  if (valor === '') {
    if (itens.length === 0) itens.push({ regra, ok: true, detalhe: 'SMTP_URL ausente: nenhum e-mail sai' });
    return itens;
  }
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return [...itens, { regra, ok: false, detalhe: 'SMTP_URL ilegível' }];
  }
  const porta = Number(url.port || (url.protocol === 'smtps:' ? 465 : 25));
  const ok =
    url.protocol === 'smtp:' &&
    ((ehLoopback(url.hostname) && porta === MAILPIT.porta) ||
      (url.hostname === MAILPIT.container && porta === MAILPIT.portaInterna));
  itens.push({
    regra,
    ok,
    detalhe: ok
      ? `SMTP_URL → ${url.hostname}:${porta} (Mailpit)`
      : `SMTP_URL aponta para ${url.hostname || URL_ILEGIVEL}:${porta}; fora de produção só smtp://127.0.0.1:${MAILPIT.porta} (Mailpit)`,
  });
  return itens;
}

function bancos(env: Ambiente): ItemTrava[] {
  let lista;
  try {
    lista = lerEstabelecimentos(env);
  } catch (e) {
    if (e instanceof ErroConfiguracaoEstabelecimentos) {
      return [{ regra: 'estabelecimentos', ok: false, detalhe: e.message }];
    }
    throw e;
  }
  if (lista.length === 0) {
    return [
      { regra: 'estabelecimentos', ok: true, detalhe: 'ESTABELECIMENTOS vazio: nenhum banco configurado' },
    ];
  }
  return lista.map((e) => {
    const regra = `${chaveFb(e.codigo, 'HOST')} só loopback ou o container da cópia`;
    const host = e.host.toLowerCase();
    if (CONTAINERS_ALHEIOS.includes(host)) {
      return {
        regra,
        ok: false,
        detalhe: `${e.codigo}: ${host} é container de outro projeto e nunca é destino`,
      };
    }
    if (!ehLoopback(host) && host !== containerDaCopia(e.codigo)) {
      const motivo =
        CONTAINER_PROJETO.test(host) || CONTAINER_COPIA.test(host)
          ? `não é o container da cópia de "${e.codigo}" (${containerDaCopia(e.codigo)})`
          : 'está fora do loopback (possível servidor real)';
      return { regra, ok: false, detalhe: `${e.codigo}: ${host} ${motivo}` };
    }
    if (ehLoopback(host) && PORTAS_OCUPADAS.includes(e.porta)) {
      const dono = e.porta === 3050 ? ' (cópia de referência sante-firebird)' : '';
      return { regra, ok: false, detalhe: `${e.codigo}: porta ${e.porta} é ocupada${dono}` };
    }
    if (ENDERECOS_OCUPADOS.includes(`${host}:${e.porta}`)) {
      return { regra, ok: false, detalhe: `${e.codigo}: ${host}:${e.porta} é ocupado por outro projeto` };
    }
    return { regra, ok: true, detalhe: `${e.codigo}: ${host}:${e.porta}` };
  });
}

function enderecos(env: Ambiente): ItemTrava[] {
  const conferidasAParte = /^(?:FB_[A-Z0-9]+_HOST|SMTP_URL)$/; // regras próprias (bancos e smtp)
  const itens: ItemTrava[] = [];
  // Recusa por padrão: toda chave com URL (qualquer nome) e toda chave de endereço, fora as do sistema.
  for (const chave of Object.keys(env).sort()) {
    if (conferidasAParte.test(chave) || ehChaveDoSistema(chave)) continue;
    const fora = hostsDoValor(env[chave] ?? '', chave).filter((h) => !ehDestinoLocal(h));
    if (fora.length === 0) continue;
    const halai = /^(?:HALAI|HAL_AI)_/.test(chave)
      ? ' (fora de produção, a Hal-AI é um dublê em loopback)'
      : /^(?:PSP|PIX|ADQUIRENTE|PAGAMENTO|CARTAO|GATEWAY)_/.test(chave)
        ? ' (M30: fora de produção, Pix e cartão só pelo conector simulado)'
        : /^(?:ESOCIAL|REINF|FGTS|FOLHA_EXTERNA)_/.test(chave) || /esocial\.gov\.br/i.test(env[chave] ?? '')
          ? ' (M53: fora de produção, o eSocial e a folha externa só pelo coletor local)'
          : '';
    itens.push({
      regra: 'nenhum endpoint externo real',
      ok: false,
      detalhe: `${chave} aponta para ${[...new Set(fora)].join(', ')}${halai}`,
    });
  }
  if (itens.length === 0) {
    itens.push({
      regra: 'nenhum endpoint externo real',
      ok: true,
      detalhe: 'todos os endereços em loopback',
    });
  }
  return itens;
}

function canais(env: Ambiente): ItemTrava {
  const regra = 'nenhum canal próprio de mensagem (DP-44 b)';
  const achadas = Object.keys(env).filter(ehChaveDeCanalProprio).sort();
  return achadas.length === 0
    ? { regra, ok: true, detalhe: 'nenhuma chave de WhatsApp, SMS ou outro canal' }
    : {
        regra,
        ok: false,
        detalhe: `chave(s) ${achadas.join(', ')}: o Sante SGH não tem canal próprio; toda mensagem ao paciente vai pela Hal-AI`,
      };
}

/**
 * M49 (ficha, critério "ambiente:verificar: PSC, ACT e Atesta CFM no simulador ou desligados"): fora de produção, a
 * assinatura ICP-Brasil só no simulador ou desligada; os endereços do provedor, da ACT e da volta do OAuth caem na
 * regra dos endereços (loopback); o Atesta CFM e o SNCR são desligados por parâmetro e chave (sem configuração aqui).
 */
function assinaturaIcp(env: Ambiente): ItemTrava {
  const regra = 'assinatura ICP-Brasil no simulador ou desligada';
  const modo = env['ASSINATURA_ICP_MODO']?.trim() ?? '';
  return modo === '' || modo === 'simulador' || modo === 'desligado'
    ? { regra, ok: true, detalhe: `modo ${modo || 'simulador (padrão)'}; provedor, ACT e LCR simulados` }
    : {
        regra,
        ok: false,
        detalhe: `ASSINATURA_ICP_MODO=${modo.slice(0, 20)}: fora de produção, só simulador ou desligado`,
      };
}

/**
 * M44 (etapa 3; ficha, critério "ambiente:verificar: regulação apontando para o simulador"): fora de produção, o conector
 * com a central de regulação só no simulador ou desligado (DP-29); o endereço da central cai na regra dos endereços.
 */
function regulacaoEstadual(env: Ambiente): ItemTrava {
  const regra = 'regulação estadual no simulador ou desligada';
  const modo = env['REGULACAO_MODO']?.trim() ?? '';
  return modo === '' || modo === 'simulador' || modo === 'desligado'
    ? { regra, ok: true, detalhe: `modo ${modo || 'simulador (padrão)'}; a central é simulada (DP-29)` }
    : {
        regra,
        ok: false,
        detalhe: `REGULACAO_MODO=${modo.slice(0, 20)}: fora de produção, só simulador ou desligado`,
      };
}

/**
 * M50 (etapa 2; ficha, critério "ambiente:verificar: gateway ... no simulador ou desligados"): fora de produção, o
 * pagamento do portal do paciente só pelo gateway simulado ou desligado (o endereço do gateway real cairia na regra dos
 * endereços; o contrato e as credenciais são pré-requisito da chave `portal.pagamento`, autorização do dono).
 */
function gatewayPortal(env: Ambiente): ItemTrava {
  const regra = 'gateway de pagamento do portal no simulador ou desligado';
  const modo = env['PORTAL_PAGAMENTO_MODO']?.trim() ?? '';
  return modo === '' || modo === 'simulador' || modo === 'desligado'
    ? { regra, ok: true, detalhe: `modo ${modo || 'simulador (padrão)'}; nenhuma cobrança real` }
    : {
        regra,
        ok: false,
        detalhe: `PORTAL_PAGAMENTO_MODO=${modo.slice(0, 20)}: fora de produção, só simulador ou desligado`,
      };
}

/**
 * M50, etapa 4 (ficha, seção 11: "provedor de teleconsulta no simulador ou desligado"): fora de produção, a sala da
 * teleconsulta é a do provedor SIMULADO (nada sai da máquina) ou nenhuma; o provedor real depende da autorização do dono
 * (pré-requisito da chave `telemedicina`, POL-3).
 */
function provedorTeleconsulta(env: Ambiente): ItemTrava {
  const regra = 'provedor de teleconsulta no simulador ou desligado';
  const modo = env['TELECONSULTA_PROVEDOR_MODO']?.trim() ?? '';
  return modo === '' || modo === 'simulador' || modo === 'desligado'
    ? { regra, ok: true, detalhe: `modo ${modo || 'simulador (padrão)'}; nenhuma sala de vídeo real` }
    : {
        regra,
        ok: false,
        detalhe: `TELECONSULTA_PROVEDOR_MODO=${modo.slice(0, 20)}: fora de produção, só simulador ou desligado`,
      };
}
/**
 * M47 (etapa 3; ficha, regra 9 e critério "ambiente:verificar: PACS e equipamentos no simulador"): fora de produção, a
 * lista de trabalho DICOM e o status do exame só pelo simulador de modalidade ou desligados; o endereço do PACS
 * (INTEGRACAO_DESTINO_<parceiro>) cai na regra dos endereços (loopback).
 */
function pacsWorklist(env: Ambiente): ItemTrava {
  const regra = 'PACS, RIS e modalidades no simulador ou desligados';
  const modo = env['PACS_MODO']?.trim() ?? '';
  return modo === '' || modo === 'simulador' || modo === 'desligado'
    ? {
        regra,
        ok: true,
        detalhe: `modo ${modo || 'simulador (padrão)'}; a modalidade e o PACS são simulados`,
      }
    : {
        regra,
        ok: false,
        detalhe: `PACS_MODO=${modo.slice(0, 20)}: fora de produção, só simulador ou desligado`,
      };
}

/**
 * M53, etapa 6 (ficha, regra 3: "nenhuma mensagem ao governo fora de produção"): fora de produção, os lotes do eSocial
 * e a troca com a folha externa vão só ao coletor local, ou a transmissão fica desligada; qualquer endereço do eSocial,
 * do EFD-Reinf, do FGTS Digital ou da folha externa fora do loopback cai na regra dos endereços.
 */
function transmissorEsocial(env: Ambiente): ItemTrava {
  const regra = 'eSocial e folha externa só no coletor ou desligados';
  const modos = (['ESOCIAL_MODO', 'FOLHA_EXTERNA_MODO'] as const).map(
    (k) => [k, env[k]?.trim() ?? ''] as const,
  );
  const fora = modos.find(([, m]) => !(m === '' || m === 'coletor' || m === 'desligado'));
  return fora
    ? {
        regra,
        ok: false,
        detalhe: `${fora[0]}=${fora[1].slice(0, 20)}: fora de produção, só coletor ou desligado`,
      }
    : {
        regra,
        ok: true,
        detalhe: 'lotes e arquivos ficam no coletor local; nada vai ao governo nem à folha externa',
      };
}

/** Confere a configuração (parte pura da trava). Em `producao` a trava não se aplica. */
export function verificarConfiguracao(env: Ambiente): ResultadoTrava {
  const ambiente = env['AMBIENTE']?.trim() || 'dev';
  if (!(AMBIENTES as readonly string[]).includes(ambiente)) {
    const itens = [
      { regra: 'AMBIENTE válido', ok: false, detalhe: `AMBIENTE deve ser ${AMBIENTES.join(' | ')}` },
    ];
    return { ambiente, aplicavel: true, itens, ok: false };
  }
  if (ambiente === 'producao') return { ambiente, aplicavel: false, itens: [], ok: true };
  const itens = [
    ...bancos(env),
    ...smtp(env),
    ...enderecos(env),
    canais(env),
    assinaturaIcp(env),
    regulacaoEstadual(env),
    gatewayPortal(env),
    provedorTeleconsulta(env),
    pacsWorklist(env),
    transmissorEsocial(env),
  ];
  return { ambiente, aplicavel: true, itens, ok: itens.every((i) => i.ok) };
}

export function juntarResultados(base: ResultadoTrava, extras: readonly ItemTrava[]): ResultadoTrava {
  const itens = [...base.itens, ...extras];
  return { ...base, itens, ok: itens.every((i) => i.ok) };
}

export function formatarResultado(r: ResultadoTrava): string {
  if (!r.aplicavel) return `AMBIENTE=${r.ambiente}: trava de saídas não se aplica (só pelo pipeline).`;
  const linhas = r.itens.map((i) => `  ${i.ok ? 'ok   ' : 'FALHA'}  ${i.regra}: ${i.detalhe}`);
  return [
    `Trava de saídas (AMBIENTE=${r.ambiente}):`,
    ...linhas,
    r.ok ? 'Resultado: ok (nada sai para fora)' : 'Resultado: FALHA (o processo não sobe)',
  ].join('\n');
}
