// M60, etapa 2 (entrega 3): os arquivos do servidor, gerados de uma única descrição (`LAYOUT`) para que diretórios,
// usuário e portas nunca divirjam entre as units do systemd, o site do nginx, o cliente do banco e o logrotate. O
// `instalacao:gerar` grava em deploy/ubuntu/gerado/ e o `-- --conferir` falha se o que está versionado diverge.
//
// Desenho (D-LAYOUT-60.2):
//   /opt/sante-sgh/versoes/<versão>/  uma pasta por versão (o artefato de release desempacotado, com o Node fixado)
//   /opt/sante-sgh/atual               link para a versão em uso (a troca do link é a atualização e a volta)
//   /etc/sante-sgh/sante.env           configuração (0600, dono o usuário do serviço)
//   /etc/sante-sgh/firebird/           firebird.conf do CLIENTE (Srp e WireCrypt), lido via FIREBIRD
//   /etc/sante-sgh/tls/                certificado próprio do hospital (quando não for ACME)
//   /var/lib/sante-sgh/                dados do serviço (cofre)
//   /var/log/sante-sgh/                logs da instalação e do nginx do produto (os serviços vão ao journald)

export interface Layout {
  readonly usuario: string;
  readonly opt: string;
  readonly etc: string;
  readonly varLib: string;
  readonly varLog: string;
  readonly portaApi: number;
  readonly prefixoUnit: string;
}

export const LAYOUT: Layout = Object.freeze({
  usuario: 'sante-sgh',
  opt: '/opt/sante-sgh',
  etc: '/etc/sante-sgh',
  varLib: '/var/lib/sante-sgh',
  varLog: '/var/log/sante-sgh',
  portaApi: 3300,
  prefixoUnit: 'sante-sgh',
});

export const caminhos = (l: Layout = LAYOUT) => ({
  atual: `${l.opt}/atual`,
  versoes: `${l.opt}/versoes`,
  node: `${l.opt}/atual/node/bin/node`,
  ambiente: `${l.etc}/sante.env`,
  firebird: `${l.etc}/firebird`,
  tls: `${l.etc}/tls`,
  web: `${l.opt}/atual/apps/web/dist`,
});

const CABECALHO = (arquivo: string, comentario = '#') =>
  `${comentario} Gerado por pnpm instalacao:gerar (tools/instalacao); não edite à mão: ${arquivo}.\n`;

/** Endurecimento comum das duas units (o serviço só escreve em /var/lib e /var/log do produto). */
function endurecimento(l: Layout): string[] {
  return [
    'NoNewPrivileges=true',
    'PrivateTmp=true',
    'PrivateDevices=true',
    'ProtectSystem=strict',
    'ProtectHome=true',
    'ProtectKernelTunables=true',
    'ProtectKernelModules=true',
    'ProtectControlGroups=true',
    'RestrictSUIDSGID=true',
    'LockPersonality=true',
    'RestrictRealtime=true',
    'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
    'CapabilityBoundingSet=',
    'AmbientCapabilities=',
    'UMask=0077',
    `ReadWritePaths=${l.varLib} ${l.varLog}`,
  ];
}

/** Unit de um processo Node (api ou worker). */
export function unitNode(processo: 'api' | 'worker', l: Layout = LAYOUT): string {
  const c = caminhos(l);
  const descricao = processo === 'api' ? 'API' : 'Worker (rotinas e filas)';
  return [
    CABECALHO(`${l.prefixoUnit}-${processo}.service`).trimEnd(),
    '[Unit]',
    `Description=Sante SGH: ${descricao}`,
    'After=network-online.target valkey-server.service redis-server.service',
    'Wants=network-online.target',
    `PartOf=${l.prefixoUnit}.target`,
    '',
    '[Service]',
    'Type=simple',
    `User=${l.usuario}`,
    `Group=${l.usuario}`,
    `WorkingDirectory=${c.atual}`,
    // O arquivo de ambiente é lido pelo próprio processo (o do processo tem precedência): nada de EnvironmentFile,
    // que não entende o formato com aspas do arquivo.
    `Environment=SGH_ARQUIVO_AMBIENTE=${c.ambiente}`,
    `Environment=SGH_PROCESSO=${processo}`,
    `Environment=FIREBIRD=${c.firebird}`,
    'Environment=NODE_ENV=production',
    // O núcleo do banco exige os processos em UTC (achado do ensaio).
    'Environment=TZ=UTC',
    `ExecStart=${c.node} --enable-source-maps ${c.atual}/apps/${processo}/dist/main.js`,
    'Restart=on-failure',
    'RestartSec=5',
    'TimeoutStopSec=30',
    'LimitNOFILE=65536',
    ...endurecimento(l),
    '',
    '[Install]',
    `WantedBy=${l.prefixoUnit}.target`,
    '',
  ].join('\n');
}

/** O alvo que agrupa a api e o worker (o web é o estático do nginx). */
export function unitAlvo(l: Layout = LAYOUT): string {
  return [
    CABECALHO(`${l.prefixoUnit}.target`).trimEnd(),
    '[Unit]',
    'Description=Sante SGH (api e worker)',
    `Wants=${l.prefixoUnit}-api.service ${l.prefixoUnit}-worker.service`,
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
}

/**
 * Cabeçalhos de segurança do site (conferidos pela fumaça do M60-F3). O connect-src abre o loopback da ESTAÇÃO: o
 * agente local de assinatura (http://127.0.0.1) e a impressão local (wss://localhost) são chamados pelo navegador.
 */
export const CABECALHOS_SEGURANCA: readonly [string, string][] = [
  ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()'],
  [
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:* wss://localhost:*; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  ],
];

/**
 * O site do nginx: 80 só redireciona (e atende o desafio ACME); 443 com TLS 1.2+ serve o estático das telas e
 * encaminha /api à API local. Os marcadores __DOMINIO__, __CERT__ e __CHAVE__ são trocados pelo instalar.sh.
 */
export function siteNginx(l: Layout = LAYOUT): string {
  const c = caminhos(l);
  const cab = CABECALHOS_SEGURANCA.map(([k, v]) => `    add_header ${k} "${v}" always;`);
  return [
    CABECALHO('nginx/sante-sgh.conf').trimEnd(),
    `# Domínios: __DOMINIO__ (o de DOMINIO_BASE e os da rede). Certificado: __CERT__ e __CHAVE__.`,
    'server {',
    '    listen 80;',
    '    listen [::]:80;',
    '    server_name __DOMINIO__;',
    '    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }',
    '    location / { return 301 https://$host$request_uri; }',
    '}',
    '',
    'server {',
    // nginx 1.24 do Ubuntu 24.04: HTTP/2 no listen (a diretiva "http2 on" só existe do 1.25.1 em diante).
    '    listen 443 ssl http2;',
    '    listen [::]:443 ssl http2;',
    '    server_name __DOMINIO__;',
    '    ssl_certificate __CERT__;',
    '    ssl_certificate_key __CHAVE__;',
    '    ssl_protocols TLSv1.2 TLSv1.3;',
    '    ssl_prefer_server_ciphers off;',
    '    ssl_session_cache shared:sante_sgh:10m;',
    '    ssl_session_timeout 1d;',
    '    server_tokens off;',
    '    client_max_body_size 50m;',
    `    access_log ${l.varLog}/nginx-acesso.log;`,
    `    error_log ${l.varLog}/nginx-erro.log warn;`,
    ...cab,
    '',
    `    root ${c.web};`,
    '    index index.html;',
    '',
    '    location /api/ {',
    `        proxy_pass http://127.0.0.1:${l.portaApi};`,
    '        proxy_http_version 1.1;',
    '        proxy_set_header Host $host;',
    '        proxy_set_header X-Forwarded-For $remote_addr;',
    '        proxy_set_header X-Forwarded-Proto https;',
    '        proxy_set_header Connection "";',
    // Eventos ao vivo (SSE) e relatórios longos: sem buffer e com leitura longa.
    '        proxy_buffering off;',
    '        proxy_read_timeout 300s;',
    '    }',
    '',
    '    location /assets/ {',
    '        expires 1y;',
    '        add_header Cache-Control "public, immutable" always;',
    ...cab.map((x) => `    ${x}`),
    '        try_files $uri =404;',
    '    }',
    '',
    '    location / {',
    '        add_header Cache-Control "no-cache" always;',
    ...cab.map((x) => `    ${x}`),
    '        try_files $uri $uri/ /index.html;',
    '    }',
    '}',
    '',
  ].join('\n');
}

/** O firebird.conf do CLIENTE no servidor de aplicação: autenticação Srp e canal cifrado obrigatório. */
export function firebirdCliente(): string {
  return [
    CABECALHO('firebird/firebird.conf').trimEnd(),
    '# Cliente do banco do servidor de aplicação (lido pela libfbclient via FIREBIRD, definida nas units).',
    '# Srp256 primeiro; nunca Legacy_Auth. O servidor do banco tem de aceitar Srp (AuthServer) e WireCrypt.',
    'AuthClient = Srp256, Srp',
    'WireCrypt = Required',
    'WireCompression = false',
    '',
  ].join('\n');
}

/** logrotate dos logs do produto (os dos serviços ficam no journald). */
export function logrotate(l: Layout = LAYOUT): string {
  return [
    CABECALHO('logrotate/sante-sgh').trimEnd(),
    `${l.varLog}/*.log {`,
    '    daily',
    '    rotate 30',
    '    missingok',
    '    notifempty',
    '    compress',
    '    delaycompress',
    `    su root ${l.usuario}`,
    `    create 0640 www-data ${l.usuario}`,
    '    sharedscripts',
    '    postrotate',
    '        [ -s /run/nginx.pid ] && kill -USR1 "$(cat /run/nginx.pid)" || true',
    '    endscript',
    '}',
    '',
  ].join('\n');
}

/** Os arquivos gerados, pelo caminho relativo a deploy/ubuntu/gerado/. */
export function arquivosGerados(l: Layout = LAYOUT): Record<string, string> {
  return {
    [`systemd/${l.prefixoUnit}-api.service`]: unitNode('api', l),
    [`systemd/${l.prefixoUnit}-worker.service`]: unitNode('worker', l),
    [`systemd/${l.prefixoUnit}.target`]: unitAlvo(l),
    'nginx/sante-sgh.conf': siteNginx(l),
    'firebird/firebird.conf': firebirdCliente(),
    'logrotate/sante-sgh': logrotate(l),
    'layout.env': layoutShell(l),
  };
}

/** O mesmo layout para os scripts de shell (deploy/ubuntu/*.sh fazem `source` deste arquivo). */
export function layoutShell(l: Layout = LAYOUT): string {
  const c = caminhos(l);
  return [
    CABECALHO('layout.env').trimEnd(),
    `SANTE_USUARIO=${l.usuario}`,
    `SANTE_OPT=${l.opt}`,
    `SANTE_ETC=${l.etc}`,
    `SANTE_VAR_LIB=${l.varLib}`,
    `SANTE_VAR_LOG=${l.varLog}`,
    `SANTE_ATUAL=${c.atual}`,
    `SANTE_VERSOES=${c.versoes}`,
    `SANTE_AMBIENTE=${c.ambiente}`,
    `SANTE_FIREBIRD=${c.firebird}`,
    `SANTE_TLS=${c.tls}`,
    `SANTE_PORTA_API=${l.portaApi}`,
    `SANTE_UNIT=${l.prefixoUnit}`,
    '',
  ].join('\n');
}
