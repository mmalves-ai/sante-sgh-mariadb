// M60.2 (correção da revisão): os scripts de atualização e de volta de versão rodam de verdade numa raiz temporária,
// com systemctl, curl, nginx, chown, id e sleep simulados. Cobre a volta automática do atualizar.sh (o "anterior" não
// pode ficar apontando para a versão que falhou), o site do nginx regerado da versão alvo e as portas do SSH que o
// firewall libera.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const fonte = resolve(import.meta.dirname, '../../../deploy/ubuntu');

let T = '';
let scripts = '';
let bin = '';
let versoes = '';

function exec(arquivo: string, conteudo: string) {
  writeFileSync(arquivo, conteudo);
  chmodSync(arquivo, 0o755);
}

/** Árvore mínima de uma versão: Node falso (conferências passam) e os arquivos gerados com a marca da versão. */
function arvoreDaVersao(raiz: string, marca: string) {
  const g = join(raiz, 'deploy/ubuntu/gerado');
  for (const d of ['systemd', 'firebird', 'logrotate', 'nginx']) mkdirSync(join(g, d), { recursive: true });
  mkdirSync(join(raiz, 'node/bin'), { recursive: true });
  exec(join(raiz, 'node/bin/node'), '#!/bin/sh\nprintf "%s" "' + marca + '"\n');
  for (const u of ['sante-sgh-api.service', 'sante-sgh-worker.service', 'sante-sgh.target'])
    writeFileSync(join(g, 'systemd', u), `# ${marca}\n`);
  writeFileSync(join(g, 'firebird/firebird.conf'), `# ${marca}\n`);
  writeFileSync(join(g, 'logrotate/sante-sgh'), `# ${marca}\n`);
  writeFileSync(
    join(g, 'nginx/sante-sgh.conf'),
    `# ${marca}\nserver_name __DOMINIO__;\nssl_certificate __CERT__;\nssl_certificate_key __CHAVE__;\n`,
  );
}

/** Empacota uma versão como o artefato de release (tar.gz + .sha256 ao lado). */
function artefato(nome: string, marca: string): string {
  const src = join(T, 'src', nome);
  arvoreDaVersao(src, marca);
  const art = join(T, `${nome}.tar.gz`);
  execFileSync('tar', ['-czf', art, '-C', src, '.']);
  execFileSync('sh', ['-c', `cd "${T}" && sha256sum "${nome}.tar.gz" > "${nome}.tar.gz.sha256"`]);
  return art;
}

function rodar(script: string, ...args: string[]) {
  return spawnSync('bash', [join(scripts, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env['PATH']}`, RAIZ_TESTE: T, SSH_CONNECTION: '' },
  });
}

const link = (n: string) => basename(readlinkSync(join(T, 'opt/sante-sgh', n)));
const site = () => readFileSync(join(T, 'etc/nginx/sites-available/sante-sgh.conf'), 'utf8');

beforeEach(() => {
  T = realpathSync(mkdtempSync(join(tmpdir(), 'sante-scripts-')));
  scripts = join(T, 'scripts');
  bin = join(T, 'bin');
  versoes = join(T, 'opt/sante-sgh/versoes');
  mkdirSync(join(scripts, 'gerado'), { recursive: true });
  mkdirSync(bin);
  // Cópias dos scripts com toda raiz do sistema dentro da pasta temporária.
  const trocar = (t: string) =>
    t.replaceAll('/etc/', `${T}/etc/`).replaceAll('/opt/', `${T}/opt/`).replaceAll('/var/', `${T}/var/`);
  for (const n of ['lib.sh', 'atualizar.sh', 'voltar-versao.sh', 'migrar.sh', 'verificar.sh', 'liberar.sh'])
    exec(join(scripts, n), trocar(readFileSync(join(fonte, n), 'utf8')));
  writeFileSync(
    join(scripts, 'gerado/layout.env'),
    trocar(readFileSync(join(fonte, 'gerado/layout.env'), 'utf8')),
  );
  // Simulações: a API "quebrada" nunca responde; nginx -t passa; o resto só registra.
  exec(join(bin, 'id'), '#!/bin/sh\necho 0\n');
  exec(join(bin, 'chown'), '#!/bin/sh\nexit 0\n');
  exec(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n');
  exec(join(bin, 'nginx'), '#!/bin/sh\nexit 0\n');
  exec(join(bin, 'systemctl'), `#!/bin/sh\necho "$*" >> "${T}/systemctl.log"\n`);
  exec(
    join(bin, 'curl'),
    `#!/bin/sh\ncase "$(readlink -f "${T}/opt/sante-sgh/atual")" in *quebrada*) exit 7;; esac\nexit 0\n`,
  );
  for (const d of [
    'etc/systemd/system',
    'etc/logrotate.d',
    'etc/nginx/sites-available',
    'etc/nginx/sites-enabled',
    'etc/sante-sgh/firebird',
    'var/log/sante-sgh',
    'var/lib/sante-sgh',
  ])
    mkdirSync(join(T, d), { recursive: true });
  writeFileSync(join(T, 'etc/os-release'), 'ID=ubuntu\nVERSION_ID="24.04"\n');
  // Instalação existente: em uso a 0.9 (boa), anterior a 0.8 (velha), estado do site gravado pelo instalar.sh.
  arvoreDaVersao(join(versoes, 'sante-sgh-0.8.0-velha'), 'velha');
  arvoreDaVersao(join(versoes, 'sante-sgh-0.9.0-boa'), 'boa');
  execFileSync('ln', ['-sfn', join(versoes, 'sante-sgh-0.9.0-boa'), join(T, 'opt/sante-sgh/atual')]);
  execFileSync('ln', ['-sfn', join(versoes, 'sante-sgh-0.8.0-velha'), join(T, 'opt/sante-sgh/anterior')]);
  writeFileSync(
    join(T, 'etc/sante-sgh/instalacao.env'),
    "SITE_DOMINIO='sgh.exemplo.invalid'\nSITE_CERT=/c.crt\nSITE_CHAVE=/c.key\n",
  );
  writeFileSync(join(T, 'etc/nginx/sites-available/sante-sgh.conf'), '# boa\n');
});

afterEach(() => {
  rmSync(T, { recursive: true, force: true });
});

describe('M60.2: atualizar.sh e voltar-versao.sh rodando (systemctl, curl e nginx simulados)', () => {
  it('a volta automática repõe o "anterior" de antes: nunca fica apontando para a versão que falhou', () => {
    const r = rodar('atualizar.sh', artefato('sante-sgh-1.0.0-quebrada', 'quebrada'));
    expect(r.status, r.stderr).not.toBe(0);
    expect(r.stderr).toContain('atualização desfeita');
    expect(link('atual')).toBe('sante-sgh-0.9.0-boa');
    expect(link('anterior')).toBe('sante-sgh-0.8.0-velha');
    // Units e configuração voltam com a versão em uso; o site não foi tocado.
    expect(readFileSync(join(T, 'etc/systemd/system/sante-sgh-api.service'), 'utf8')).toContain('boa');
    expect(readFileSync(join(T, 'etc/sante-sgh/firebird/firebird.conf'), 'utf8')).toContain('boa');
    expect(site()).toBe('# boa\n');
    // E a volta de versão sem argumento (o uso documentado) leva à 0.8, não à quebrada.
    const v = rodar('voltar-versao.sh');
    expect(v.status, v.stderr).toBe(0);
    expect(link('atual')).toBe('sante-sgh-0.8.0-velha');
  });

  it('sem "anterior" antes da troca, a volta automática remove o link', () => {
    rmSync(join(T, 'opt/sante-sgh/anterior'));
    const r = rodar('atualizar.sh', artefato('sante-sgh-1.0.0-quebrada', 'quebrada'));
    expect(r.status).not.toBe(0);
    expect(existsSync(join(T, 'opt/sante-sgh/anterior'))).toBe(false);
  });

  it('a atualização regera o site do nginx da versão nova e a volta de versão o devolve', () => {
    const r = rodar('atualizar.sh', artefato('sante-sgh-1.1.0-nova', 'nova'));
    expect(r.status, r.stderr).toBe(0);
    expect(link('atual')).toBe('sante-sgh-1.1.0-nova');
    expect(link('anterior')).toBe('sante-sgh-0.9.0-boa');
    expect(site()).toContain('# nova');
    expect(site()).toContain('server_name sgh.exemplo.invalid;');
    expect(site()).toContain('ssl_certificate /c.crt;');
    expect(readFileSync(join(T, 'etc/logrotate.d/sante-sgh'), 'utf8')).toContain('nova');
    expect(readFileSync(join(T, 'systemctl.log'), 'utf8')).toMatch(/reload nginx/);
    const v = rodar('voltar-versao.sh');
    expect(v.status, v.stderr).toBe(0);
    expect(link('atual')).toBe('sante-sgh-0.9.0-boa');
    expect(site()).toContain('# boa');
    expect(readFileSync(join(T, 'etc/sante-sgh/firebird/firebird.conf'), 'utf8')).toContain('boa');
  });

  it('nginx -t recusando: o site de antes é reposto e o script falha', () => {
    exec(join(bin, 'nginx'), '#!/bin/sh\nexit 1\n');
    const r = rodar('atualizar.sh', artefato('sante-sgh-1.1.0-nova', 'nova'));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('nginx -t');
    expect(site()).toBe('# boa\n');
  });
});

describe('M60.2: portas_ssh (o firewall libera o SSH onde ele de fato escuta)', () => {
  const portas = (sshd: string, sessao = '') => {
    exec(join(bin, 'sshd'), sshd);
    exec(join(bin, 'ss'), '#!/bin/sh\nexit 1\n');
    return execFileSync('bash', ['-c', `source "${join(scripts, 'lib.sh')}" && portas_ssh`], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env['PATH']}`, SSH_CONNECTION: sessao },
    })
      .trim()
      .split('\n');
  };

  it('usa as portas do sshd -T e a da sessão atual', () => {
    expect(
      portas(
        '#!/bin/sh\nprintf "port 2222\\nport 22\\nx11forwarding no\\n"\n',
        '10.0.0.9 51000 10.0.0.1 2200',
      ),
    ).toEqual(['22', '2200', '2222']);
  });

  it('sem sshd legível nem sessão, cai na 22', () => {
    expect(portas('#!/bin/sh\nexit 1\n')).toEqual(['22']);
  });
});

describe('M60.3: migrar.sh e verificar.sh (runuser, install e o Node da versão simulados)', () => {
  /** O Node da versão em uso registra o diretório, os argumentos e o ambiente que recebeu. */
  const nodeQueRegistra = (rc = 0) => {
    exec(
      join(versoes, 'sante-sgh-0.9.0-boa/node/bin/node'),
      `#!/bin/sh\n{ echo "pwd=$(pwd)"; echo "args=$*"; echo "env=$SGH_ARQUIVO_AMBIENTE|$FIREBIRD|$TZ|$NODE_ENV"; } > "${T}/node.log"\nexit ${rc}\n`,
    );
    exec(join(bin, 'runuser'), `#!/bin/sh\necho "runuser $1 $2" >> "${T}/runuser.log"\nshift 3\nexec "$@"\n`);
    exec(join(bin, 'install'), '#!/bin/sh\nfor a; do d="$a"; done\nmkdir -p "$d"\n');
  };
  const registro = () => readFileSync(join(T, 'node.log'), 'utf8');

  it('migrar.sh roda o sgh:aplicar da versão em uso, como o usuário do serviço, com o ambiente da API', () => {
    nodeQueRegistra();
    writeFileSync(join(T, 'etc/sante-sgh/sante.env'), 'AMBIENTE=producao\n');
    const r = rodar('migrar.sh', '--hospital=pc', '--ambiente=producao', '--simular');
    expect(r.status, r.stderr).toBe(0);
    const l = registro();
    expect(l).toContain(`pwd=${T}/opt/sante-sgh/atual`);
    expect(l).toContain('tools/schema-check/src/sgh-aplicar.ts --hospital=pc --ambiente=producao --simular');
    expect(l).toMatch(/--relatorio=\S+\/var\/lib\/sante-sgh\/migracao\/pc-simular-\d{8}T\d{6}Z\.md/);
    expect(l).toContain(`env=${T}/etc/sante-sgh/sante.env|${T}/etc/sante-sgh/firebird|UTC|production`);
    expect(readFileSync(join(T, 'runuser.log'), 'utf8')).toContain('runuser -u sante-sgh');
  });

  it('migrar.sh respeita o --relatorio informado, devolve o código do aplicador e recusa sem hospital', () => {
    nodeQueRegistra(1);
    writeFileSync(join(T, 'etc/sante-sgh/sante.env'), 'AMBIENTE=producao\n');
    const r = rodar('migrar.sh', '--hospital=pc', '--ambiente=producao', '--relatorio=/tmp/x.md');
    expect(r.status).toBe(1);
    expect(registro().match(/--relatorio=/g)?.length).toBe(1);
    expect(r.stderr).toContain('terminou com código 1');
    const s = rodar('migrar.sh', '--ambiente=producao');
    expect(s.status).not.toBe(0);
    expect(s.stderr).toContain('--hospital');
  });

  it('migrar.sh sem o arquivo de ambiente para antes de chamar o aplicador', () => {
    nodeQueRegistra();
    const r = rodar('migrar.sh', '--hospital=pc', '--ambiente=producao');
    expect(r.status).not.toBe(0);
    expect(existsSync(join(T, 'node.log'))).toBe(false);
  });

  it('M61: liberar.sh roda o liberacao:ligar-tudo da versão em uso, como o usuário do serviço, e guarda o relatório', () => {
    nodeQueRegistra(0);
    writeFileSync(join(T, 'etc/sante-sgh/sante.env'), 'AMBIENTE=producao\n');
    const r = rodar('liberar.sh', '--so-listar', '--hospital=pc');
    expect(r.status, r.stderr).toBe(0);
    const l = registro();
    expect(l).toContain(`pwd=${T}/opt/sante-sgh/atual`);
    expect(l).toContain('tools/instalacao/src/liberacao-ligar-tudo.ts --so-listar --hospital=pc');
    expect(l).toContain(`env=${T}/etc/sante-sgh/sante.env|${T}/etc/sante-sgh/firebird|UTC|production`);
    expect(r.stderr).toMatch(/relatório: \S+\/var\/lib\/sante-sgh\/liberacao\/liberacao-\d{8}T\d{6}Z\.txt/);
    nodeQueRegistra(2);
    expect(rodar('liberar.sh', '--so-listar').status).toBe(2);
  });

  it('verificar.sh roda o implantacao:verificar da versão em uso com relatório padrão em /var/log', () => {
    nodeQueRegistra();
    const r = rodar('verificar.sh', '--hospital=pc');
    expect(r.status, r.stderr).toBe(0);
    const l = registro();
    expect(l).toContain('tools/instalacao/src/verificar-implantacao.ts --hospital=pc --relatorio=');
    expect(l).toMatch(/\/var\/log\/sante-sgh\/verificacao-\d{8}T\d{6}Z\.md/);
    const s = rodar('verificar.sh', '--relatorio=/tmp/r.md');
    expect(s.status).toBe(0);
    expect(registro().match(/--relatorio=/g)?.length).toBe(1);
  });
});
