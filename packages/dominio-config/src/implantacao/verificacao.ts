// M60, etapa 3: regras puras de `pnpm implantacao:verificar` (ficha do M60, M60-F3). A ferramenta coleta (systemd,
// HTTPS, sondas do M38, conferência do M60.2, fumaça do servidor) e estas funções julgam cada item do relatório, na
// ordem de ITENS_VERIFICACAO_IMPLANTACAO, com o que fazer se falhar (a seção do manual de implantação).
import {
  CABECALHOS_SEGURANCA,
  type ConferenciaInstalacao,
  DERIVA_MAXIMA_MS,
  type FumacaServidor,
  type ItemVerificacao,
  type ItemVerificacaoImplantacao,
  type RelatorioVerificacao,
  type SituacaoItemConferencia,
  type SondaImplantacao,
  type SondasImplantacao,
} from '@sgh/contratos';
import { piorSituacao } from './fumaca.js';

/** HSTS abaixo de 180 dias: alerta (o nginx do pacote usa 1 ano). */
export const HSTS_MINIMO_S = 15_552_000;

/** O que fazer quando o item falha: a seção do manual (docs/implantacao/manual-implantacao.md) que trata dele. */
export const SE_FALHAR: Readonly<Record<ItemVerificacaoImplantacao, string>> = Object.freeze({
  servicos: 'Manual §11.1: veja o journalctl do serviço parado e o sante.env.',
  https: 'Manual §11.2: confira o certificado em /etc/sante-sgh/tls, o nginx -t e o DNS.',
  cabecalhos: 'Manual §11.2: o site do nginx foi alterado à mão; reinstale o site do pacote.',
  'saude-api': 'Manual §11.1: o serviço da API não responde atrás do nginx; veja o log da API.',
  versao: 'Manual §10.4: a versão no ar não é a do pacote; refaça a atualização ou volte a versão.',
  'login-sonda':
    'Manual §6.4: confira a conta técnica de sonda (SONDA_LOGIN e SONDA_SENHA) no banco e no sante.env; com o endereço fora de rede, a §5.1.',
  'conexao-banco': 'Manual §6: conta, papel SGH_APLICACAO, Srp, canal cifrado e charset da conexão.',
  'scripts-sgh': 'Manual §7: aplique os scripts pendentes (sgh:aplicar) ou confira o pacote instalado.',
  'impressao-digital':
    'Manual §11.4: a estrutura do banco mudou; acione o responsável técnico antes de liberar.',
  'consultas-ao-vivo': 'Manual §11.3: veja o detalhe de cada sonda e o log da API.',
  chaves: 'Manual §9: desligue a chave fora da onda em Funcionalidades por estabelecimento.',
  'worker-filas': 'Manual §11.1: confira o serviço do worker e WORKER_SERVICOS.',
  valkey: 'Manual §11.1: confira o serviço valkey-server e VALKEY_URL.',
  'fuso-relogio': 'Manual §3.3: TZ=UTC e NTP sincronizado no servidor de aplicação e no do banco.',
});

const TITULOS: Readonly<Record<ItemVerificacaoImplantacao, string>> = Object.freeze({
  servicos: 'Serviços ativos',
  https: 'HTTPS',
  cabecalhos: 'Cabeçalhos de segurança',
  'saude-api': 'API respondendo',
  versao: 'Versão instalada',
  'login-sonda': 'Login com a conta de teste',
  'conexao-banco': 'Conexão ao banco',
  'scripts-sgh': 'Scripts SGH_ do pacote',
  'impressao-digital': 'Estrutura do banco homologada',
  'consultas-ao-vivo': 'Sondas das consultas ao vivo',
  chaves: 'Chaves de liberação',
  'worker-filas': 'Worker e filas',
  valkey: 'Valkey',
  'fuso-relogio': 'Fuso e relógio',
});

const item = (
  codigo: ItemVerificacaoImplantacao,
  situacao: SituacaoItemConferencia,
  detalhe: string,
): ItemVerificacao => ({ codigo, titulo: TITULOS[codigo], situacao, detalhe, seFalhar: SE_FALHAR[codigo] });

/** Uma unidade do systemd lida com `systemctl is-active`. */
export interface UnidadeLida {
  readonly nome: string;
  /** active, inactive, failed, activating…; nulo se o systemctl não existe. */
  readonly estado: string | null;
}

/** Uma resposta HTTP colhida (sem corpo); `erro` é o código curto do problema (TLS, conexão, tempo). */
export interface RespostaColhida {
  readonly status: number | null;
  readonly cabecalhos: Readonly<Record<string, string>>;
  readonly erro: string | null;
  readonly ms: number;
}

export interface ColetaVerificacao {
  /** Nulo: a ferramenta não rodou no servidor (sem systemd local); o item sai em alerta. */
  readonly unidades: readonly UnidadeLida[] | null;
  /** GET https://<endereço>/ (a página do aplicativo pelo nginx). */
  readonly pagina: RespostaColhida;
  /** GET http://<endereço>/ (deve redirecionar para o HTTPS); nulo se não conferido (endereço só HTTPS). */
  readonly http: RespostaColhida | null;
  readonly saude: RespostaColhida;
  /** A identificação de GET /api/versao; nula se não leu. */
  readonly identificacao: string | null;
  readonly versaoEsperada: string | null;
  readonly sondas: SondasImplantacao | null;
  readonly sondasErro: string | null;
  readonly conferencia: ConferenciaInstalacao | null;
  readonly conferenciaErro: string | null;
  readonly fumaca: FumacaServidor | null;
  readonly fumacaErro: string | null;
  /** O relógio da máquina que rodou a verificação no meio da chamada da fumaça (ms). */
  readonly relogioLocalMs: number | null;
  /**
   * M60.3: GET https://<endereço>/api/estabelecimentos, a resolução da rede pelo endereço que as estações usam (404:
   * o domínio não pertence a nenhuma rede e ninguém entra pela tela). Ausente: não conferido.
   */
  readonly rede?: RespostaColhida | null;
}

function itemServicos(c: ColetaVerificacao): ItemVerificacao {
  if (c.unidades === null)
    return item('servicos', 'alerta', 'Não conferido: rode a verificação no próprio servidor de aplicação.');
  if (c.unidades.some((u) => u.estado === null))
    return item('servicos', 'alerta', 'Não conferido: o systemctl não está disponível nesta máquina.');
  const parados = c.unidades.filter((u) => u.estado !== 'active');
  if (parados.length > 0)
    return item('servicos', 'falha', parados.map((u) => `${u.nome} ${u.estado}`).join('; ') + '.');
  return item('servicos', 'ok', `${c.unidades.map((u) => u.nome).join(', ')} ativos.`);
}

function itemHttps(c: ColetaVerificacao): ItemVerificacao {
  const p = c.pagina;
  if (p.erro) return item('https', 'falha', `A página não abriu pelo HTTPS (${p.erro}).`);
  if (p.status !== 200) return item('https', 'falha', `A página respondeu ${p.status ?? 'sem status'}.`);
  if (c.http) {
    const destino = c.http.cabecalhos['location'] ?? '';
    const redireciona =
      c.http.status !== null &&
      [301, 302, 307, 308].includes(c.http.status) &&
      destino.startsWith('https://');
    if (!redireciona)
      return item(
        'https',
        'alerta',
        `Página no HTTPS em ${p.ms} ms, mas o HTTP não redireciona para o HTTPS.`,
      );
  }
  return item('https', 'ok', `Página no HTTPS em ${p.ms} ms${c.http ? '; HTTP redireciona' : ''}.`);
}

/** O max-age do Strict-Transport-Security (segundos); nulo se ausente ou ilegível. */
export function maxAgeHsts(valor: string | undefined): number | null {
  const m = /max-age\s*=\s*"?(\d+)"?/i.exec(valor ?? '');
  return m ? Number(m[1]) : null;
}

function itemCabecalhos(c: ColetaVerificacao): ItemVerificacao {
  if (c.pagina.erro || c.pagina.status === null)
    return item('cabecalhos', 'falha', 'Sem resposta do HTTPS para conferir.');
  const h = c.pagina.cabecalhos;
  const faltam = CABECALHOS_SEGURANCA.filter((n) => !h[n]);
  if (faltam.length > 0) return item('cabecalhos', 'falha', `Faltam: ${faltam.join(', ')}.`);
  const avisos: string[] = [];
  const idade = maxAgeHsts(h['strict-transport-security']);
  if (idade === null || idade < HSTS_MINIMO_S) avisos.push('HSTS com max-age abaixo de 180 dias');
  if ((h['x-content-type-options'] ?? '').toLowerCase() !== 'nosniff')
    avisos.push('X-Content-Type-Options sem nosniff');
  if (
    !/frame-ancestors\s+'none'/i.test(h['content-security-policy'] ?? '') &&
    (h['x-frame-options'] ?? '').toUpperCase() !== 'DENY'
  )
    avisos.push('a página pode ser emoldurada');
  if (h['x-powered-by']) avisos.push('X-Powered-By exposto');
  if (/\d/.test(h['server'] ?? '')) avisos.push('o cabeçalho Server mostra a versão do nginx');
  return avisos.length > 0
    ? item('cabecalhos', 'alerta', `${avisos.join('; ')}.`)
    : item('cabecalhos', 'ok', `${CABECALHOS_SEGURANCA.length} cabeçalhos presentes.`);
}

function itemSaude(c: ColetaVerificacao): ItemVerificacao {
  const s = c.saude;
  if (s.erro) return item('saude-api', 'falha', `A API não respondeu (${s.erro}).`);
  return s.status === 200
    ? item('saude-api', 'ok', `Responde em ${s.ms} ms.`)
    : item('saude-api', 'falha', `A API respondeu ${s.status ?? 'sem status'}.`);
}

function itemVersao(c: ColetaVerificacao): ItemVerificacao {
  if (!c.identificacao) return item('versao', 'falha', 'A versão instalada não foi lida.');
  if (!c.versaoEsperada)
    return item(
      'versao',
      'alerta',
      `Versão ${c.identificacao} no ar; sem a versão esperada para comparar (--versao=).`,
    );
  return c.identificacao === c.versaoEsperada
    ? item('versao', 'ok', `Versão ${c.identificacao}, a do pacote.`)
    : item('versao', 'falha', `No ar ${c.identificacao}, mas o pacote é ${c.versaoEsperada}.`);
}

function sondaDe(c: ColetaVerificacao, s: SondaImplantacao) {
  return c.sondas?.sondas.find((x) => x.sonda === s) ?? null;
}

function semSondas(codigo: ItemVerificacaoImplantacao, c: ColetaVerificacao): ItemVerificacao {
  return item(codigo, 'falha', `As sondas não responderam (${c.sondasErro ?? 'sem resposta'}).`);
}

function itemLogin(c: ColetaVerificacao): ItemVerificacao {
  if (c.rede?.status === 404)
    return item(
      'login-sonda',
      'falha',
      'O endereço do servidor não pertence a nenhuma rede: ninguém entra pela tela. Confira REDE_ENDERECOS ou DOMINIO_BASE.',
    );
  if (!c.sondas) return semSondas('login-sonda', c);
  const s = sondaDe(c, 'login-sonda');
  if (!s) return item('login-sonda', 'falha', 'A sonda do login não veio na resposta.');
  return item('login-sonda', s.ok ? 'ok' : 'falha', s.detalhe || (s.ok ? 'Entrou e saiu.' : 'Não entrou.'));
}

const ITENS_CONEXAO = [
  'motor',
  'autenticacao',
  'canal-cifrado',
  'charset',
  'conta-propria',
  'papel-aplicacao',
];

function itemConexao(c: ColetaVerificacao): ItemVerificacao {
  const f = c.conferencia;
  if (!f)
    return item(
      'conexao-banco',
      'falha',
      `A conferência não respondeu (${c.conferenciaErro ?? 'sem resposta'}).`,
    );
  const itens = f.itens.filter((i) => ITENS_CONEXAO.includes(i.codigo));
  const situacao = piorSituacao(itens);
  const base = `Firebird ${f.conexao.versaoMotor || '?'}, charset do banco ${f.conexao.charsetBanco}, conexão ${f.conexao.charsetConexao ?? '?'}`;
  const ruins = itens.filter((i) => i.situacao !== 'ok').map((i) => i.detalhe);
  return item('conexao-banco', situacao, ruins.length > 0 ? `${base}. ${ruins.join(' ')}` : `${base}.`);
}

function itemScripts(c: ColetaVerificacao): ItemVerificacao {
  const f = c.conferencia;
  if (!f)
    return item(
      'scripts-sgh',
      'falha',
      `A conferência não respondeu (${c.conferenciaErro ?? 'sem resposta'}).`,
    );
  const i = f.itens.find((x) => x.codigo === 'scripts');
  if (!i) return item('scripts-sgh', 'falha', 'O item dos scripts não veio na conferência.');
  return item('scripts-sgh', i.situacao, i.detalhe);
}

function semFumaca(codigo: ItemVerificacaoImplantacao, c: ColetaVerificacao): ItemVerificacao {
  return item(codigo, 'falha', `A fumaça do servidor não respondeu (${c.fumacaErro ?? 'sem resposta'}).`);
}

function daFumaca(
  codigo: ItemVerificacaoImplantacao,
  c: ColetaVerificacao,
  fontes: readonly string[],
): ItemVerificacao {
  if (!c.fumaca) return semFumaca(codigo, c);
  const itens = c.fumaca.itens.filter((i) => fontes.includes(i.codigo));
  if (itens.length === 0) return item(codigo, 'falha', 'O item não veio na fumaça do servidor.');
  return item(codigo, piorSituacao(itens), itens.map((i) => i.detalhe).join(' '));
}

function itemConsultas(c: ColetaVerificacao): ItemVerificacao {
  if (!c.sondas) return semSondas('consultas-ao-vivo', c);
  const nomes: SondaImplantacao[] = ['saude', 'painel-leitos', 'recusa-negocio'];
  const lidas = nomes.map((n) => ({ n, s: sondaDe(c, n) }));
  const ruins = lidas.filter((x) => !x.s?.ok);
  if (ruins.length > 0)
    return item(
      'consultas-ao-vivo',
      'falha',
      ruins.map((x) => `${x.n}: ${x.s ? x.s.detalhe || 'falhou' : 'ausente'}`).join('; ') + '.',
    );
  return item('consultas-ao-vivo', 'ok', lidas.map((x) => `${x.n} em ${x.s?.ms ?? 0} ms`).join('; ') + '.');
}

function itemFusoRelogio(c: ColetaVerificacao): ItemVerificacao {
  const base = daFumaca('fuso-relogio', c, ['fuso', 'relogio']);
  if (!c.fumaca || c.relogioLocalMs === null) return base;
  const servidor = Date.parse(c.fumaca.relogio.servidorEm);
  if (Number.isNaN(servidor)) return base;
  const d = Math.abs(servidor - c.relogioLocalMs);
  if (d <= DERIVA_MAXIMA_MS) return base;
  const seg = (d / 1000).toFixed(1).replace('.', ',');
  return item(
    'fuso-relogio',
    base.situacao === 'falha' ? 'falha' : 'alerta',
    `${base.detalhe} O relógio desta máquina difere ${seg} s do servidor de aplicação.`,
  );
}

/** Os itens do relatório, na ordem de ITENS_VERIFICACAO_IMPLANTACAO. */
export function itensDaVerificacao(c: ColetaVerificacao): ItemVerificacao[] {
  return [
    itemServicos(c),
    itemHttps(c),
    itemCabecalhos(c),
    itemSaude(c),
    itemVersao(c),
    itemLogin(c),
    itemConexao(c),
    itemScripts(c),
    daFumaca('impressao-digital', c, ['impressao-digital']),
    itemConsultas(c),
    daFumaca('chaves', c, ['chaves']),
    daFumaca('worker-filas', c, ['worker', 'filas']),
    daFumaca('valkey', c, ['valkey']),
    itemFusoRelogio(c),
  ];
}

const ROTULO_SITUACAO: Readonly<Record<SituacaoItemConferencia, string>> = Object.freeze({
  ok: 'OK',
  alerta: 'ALERTA',
  falha: 'FALHA',
});

const celula = (t: string) => t.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** O relatório em Markdown (o arquivo de --relatorio=), sem segredo: só códigos, contagens e tempos. */
export function relatorioEmMarkdown(r: RelatorioVerificacao): string {
  const linhas = [
    '# Verificação pós-implantação',
    '',
    `- Estabelecimento: \`${r.hospital}\``,
    `- Endereço: ${r.endereco}`,
    `- Em: ${r.em} (${(r.duracaoMs / 1000).toFixed(1).replace('.', ',')} s)`,
    `- Versão esperada: ${r.versaoEsperada ?? 'não informada'}`,
    `- **Resultado: ${ROTULO_SITUACAO[r.situacao]}** (${r.itens.filter((i) => i.situacao === 'ok').length} de ${r.itens.length} itens OK)`,
    '',
    '| # | Item | Situação | Detalhe |',
    '|---|---|---|---|',
    ...r.itens.map(
      (i, n) => `| ${n + 1} | ${celula(i.titulo)} | ${ROTULO_SITUACAO[i.situacao]} | ${celula(i.detalhe)} |`,
    ),
  ];
  const ruins = r.itens.filter((i) => i.situacao !== 'ok');
  if (ruins.length > 0) {
    linhas.push('', '## O que fazer', '');
    for (const i of ruins) linhas.push(`- **${i.titulo}** (${ROTULO_SITUACAO[i.situacao]}): ${i.seFalhar}`);
  }
  linhas.push('');
  return linhas.join('\n');
}
